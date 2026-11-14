import { compareRuns } from "./compare.js";
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, lstatSync } from "node:fs";
import {
  MAX_BYTES,
  POLICY,
  canonical,
  object,
  requireValue,
  uuid,
  validateDataset,
  validateExperiment,
  validateGrant,
  validatePolicy,
  validateTrace,
} from "./contract.js";

const digest = (value) => createHash("sha256").update(value).digest();
class Rejection extends Error {
  constructor(status) {
    super("Feed request rejected");
    this.status = status;
  }
}
const reject = (ok, status = 400) => {
  if (!ok) throw new Rejection(status);
};

function openStore(path) {
  // The caller owns a dedicated private directory; reject symlinks/permissive existing files.
  if (path !== ":memory:") {
    try {
      closeSync(openSync(path, "wx", 0o600));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = lstatSync(path);
    requireValue(stat.isFile() && (stat.mode & 0o077) === 0);
  }
  const db = new DatabaseSync(path, {
    timeout: 1000,
    enableDoubleQuotedStringLiterals: false,
  });
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON;",
  );
  const version = db.prepare("PRAGMA user_version").get().user_version;
  requireValue(version === 0 || version === 1);
  if (version === 0) {
    // Refuse to use an unrelated database. This never opens the workbench database.
    requireValue(
      db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
        .get().n === 0,
    );
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE policies (project TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE datasets (project TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project,hash));
      CREATE TABLE experiments (project TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project,id));
      CREATE TABLE grants (project TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project,id));
      CREATE TABLE observations (project TEXT NOT NULL, id TEXT NOT NULL, grant_id TEXT NOT NULL, experiment_id TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project,id));
      CREATE INDEX observation_expiry ON observations(expires);
      CREATE INDEX observation_grant ON observations(project,grant_id);
      PRAGMA user_version=1; COMMIT;`);
  }
  return db;
}

/** A dedicated single-process loopback service, NOT a public or serverless deployment. */
export async function startFeed({
  path,
  principals,
  projects,
  allowProduction = false,
  ttlMs = 86400000,
  now = Date.now,
  port = 0,
}) {
  requireValue(
    Number.isSafeInteger(ttlMs) && ttlMs >= 1000 && ttlMs <= 30 * 86400000,
  );
  requireValue(
    Array.isArray(projects) && projects.length > 0 && projects.length <= 32,
  );
  const policies = new Map();
  for (const project of projects) {
    object(project, ["id", "policy"]);
    uuid(project.id);
    validatePolicy(project.policy);
    requireValue(!policies.has(project.id));
    policies.set(project.id, structuredClone(project.policy));
  }
  requireValue(
    Array.isArray(principals) &&
      principals.length > 0 &&
      principals.length <= 96,
  );
  const keys = principals.map(({ token, project, role }) => {
    requireValue(
      typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token),
    );
    requireValue(
      policies.has(project) && ["ingest", "read", "admin"].includes(role),
    );
    return { hash: digest(token), project, role, count: 0, window: 0 };
  });
  requireValue(
    new Set(keys.map((key) => key.hash.toString("hex"))).size === keys.length,
  );
  const db = openStore(path);
  try {
    for (const [project, policy] of policies) {
      const prior = db
        .prepare("SELECT body FROM policies WHERE project=?")
        .get(project);
      requireValue(!prior || prior.body === canonical(policy));
      db.prepare("INSERT OR IGNORE INTO policies VALUES (?,?)").run(
        project,
        canonical(policy),
      );
    }
  } catch (error) {
    db.close();
    throw error;
  }
  const atomic = (operation) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const purge = () =>
    db.prepare("DELETE FROM observations WHERE expires<=?").run(now());
  purge();
  const timer = setInterval(purge, Math.min(ttlMs, 60000));
  timer.unref();
  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json");
    response.setHeader("x-content-type-options", "nosniff");
    const send = (status, result = {}) => {
      response.writeHead(status);
      response.end(JSON.stringify(result));
    };
    try {
      reject(
        !request.headers.origin && !request.headers["sec-fetch-site"],
        403,
      );
      const auth = request.headers.authorization || "";
      reject(/^Bearer [A-Za-z0-9_-]{32,128}$/.test(auth), 401);
      const candidate = digest(auth.slice(7));
      const principal = keys.find((key) =>
        timingSafeEqual(candidate, key.hash),
      );
      reject(principal, 401);
      if (now() - principal.window >= 60000) {
        principal.window = now();
        principal.count = 0;
      }
      reject(++principal.count <= 120, 429);
      purge();
      const url = new URL(request.url, "http://127.0.0.1");
      reject(!url.search && !url.hash && url.pathname.length < 160);
      const project = principal.project;
      const policy = policies.get(project);
      const role = (expected) => reject(principal.role === expected, 403);
      const readBody = async () => {
        reject(request.headers["content-type"] === "application/json", 415);
        reject(!request.headers["content-encoding"], 415);
        reject(
          !request.headers["content-length"] ||
            Number(request.headers["content-length"]) <= MAX_BYTES,
          413,
        );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          reject(bytes <= MAX_BYTES, 413);
          chunks.push(chunk);
        }
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      };
      if (request.method === "POST" && url.pathname === "/v1/datasets") {
        role("admin");
        const dataset = await readBody();
        validateDataset(dataset);
        const body = canonical(dataset);
        const hash = digest(body).toString("hex");
        const prior = db
          .prepare("SELECT hash FROM datasets WHERE project=? AND hash=?")
          .get(project, hash);
        reject(
          prior ||
            db
              .prepare("SELECT count(*) AS n FROM datasets WHERE project=?")
              .get(project).n < 10000,
          429,
        );
        db.prepare("INSERT OR IGNORE INTO datasets VALUES (?,?,?)").run(
          project,
          hash,
          body,
        );
        return send(prior ? 200 : 201, { hash });
      }
      if (request.method === "POST" && url.pathname === "/v1/experiments") {
        role("admin");
        const experiment = await readBody();
        validateExperiment(experiment);
        reject(
          experiment.datasetHash === null ||
            db
              .prepare("SELECT hash FROM datasets WHERE project=? AND hash=?")
              .get(project, experiment.datasetHash),
          409,
        );
        const body = canonical(experiment);
        const prior = db
          .prepare("SELECT body FROM experiments WHERE project=? AND id=?")
          .get(project, experiment.id);
        reject(!prior || prior.body === body, 409);
        reject(
          prior ||
            db
              .prepare("SELECT count(*) AS n FROM experiments WHERE project=?")
              .get(project).n < 10000,
          429,
        );
        db.prepare("INSERT OR IGNORE INTO experiments VALUES (?,?,?)").run(
          project,
          experiment.id,
          body,
        );
        reject(
          db
            .prepare("SELECT body FROM experiments WHERE project=? AND id=?")
            .get(project, experiment.id).body === body,
          409,
        );
        return send(prior ? 200 : 201);
      }
      if (request.method === "POST" && url.pathname === "/v1/grants") {
        role("admin");
        const grant = await readBody();
        validateGrant(grant);
        reject(grant.source === "synthetic" || allowProduction, 403);
        reject(
          grant.expiresAt > now() && grant.expiresAt <= now() + 30 * 86400000,
        );
        const prior = db
          .prepare("SELECT body,revoked FROM grants WHERE project=? AND id=?")
          .get(project, grant.id);
        reject(
          !prior || (!prior.revoked && prior.body === canonical(grant)),
          409,
        );
        reject(
          prior ||
            db
              .prepare("SELECT count(*) AS n FROM grants WHERE project=?")
              .get(project).n < 10000,
          429,
        );
        db.prepare(
          "INSERT OR IGNORE INTO grants(project,id,body,expires) VALUES (?,?,?,?)",
        ).run(project, grant.id, canonical(grant), grant.expiresAt);
        const saved = db
          .prepare("SELECT body,revoked FROM grants WHERE project=? AND id=?")
          .get(project, grant.id);
        reject(!saved.revoked && saved.body === canonical(grant), 409);
        return send(prior ? 200 : 201);
      }
      const grantMatch = /^\/v1\/grants\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && grantMatch) {
        role("admin");
        uuid(grantMatch[1]);
        // A tombstone prevents reusing the same consent after withdrawal.
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "UPDATE grants SET revoked=1 WHERE project=? AND id=?",
          ).run(project, grantMatch[1]);
          db.prepare(
            "DELETE FROM observations WHERE project=? AND grant_id=?",
          ).run(project, grantMatch[1]);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return send(200);
      }
      if (request.method === "POST" && url.pathname === "/v1/traces") {
        role("ingest");
        const trace = await readBody();
        validateTrace(trace, policy);
        reject(trace.source === "synthetic" || allowProduction, 403);
        reject(
          trace.endedAt <= now() + 60000 && trace.startedAt >= now() - ttlMs,
        );
        const receipt = atomic(() => {
          const grantRow = db
            .prepare(
              "SELECT body,expires,revoked FROM grants WHERE project=? AND id=?",
            )
            .get(project, trace.grantId);
          reject(
            grantRow && !grantRow.revoked && grantRow.expires > now(),
            403,
          );
          const grant = JSON.parse(grantRow.body);
          reject(
            grant.source === trace.source && grant.policy === trace.policy,
            403,
          );
          const experimentRow = db
            .prepare("SELECT body FROM experiments WHERE project=? AND id=?")
            .get(project, trace.experimentId);
          reject(experimentRow, 409);
          const experiment = JSON.parse(experimentRow.body);
          if (experiment.datasetHash !== null) {
            const dataset = JSON.parse(
              db
                .prepare("SELECT body FROM datasets WHERE project=? AND hash=?")
                .get(project, experiment.datasetHash).body,
            );
            reject(
              trace.source === "synthetic" &&
                dataset.caseIds.includes(trace.caseId),
              409,
            );
          } else reject(trace.caseId === null, 409);
          const body = canonical(trace);
          const prior = db
            .prepare("SELECT body FROM observations WHERE project=? AND id=?")
            .get(project, trace.id);
          reject(!prior || prior.body === body, 409);
          reject(
            prior ||
              db
                .prepare(
                  "SELECT count(*) AS n FROM observations WHERE project=?",
                )
                .get(project).n < 10000,
            429,
          );
          // Event-time expiry: retries cannot extend retention, even after expiry/purge.
          const expires = Math.min(trace.startedAt + ttlMs, grantRow.expires);
          reject(expires > now(), 410);
          db.prepare(
            "INSERT OR IGNORE INTO observations VALUES (?,?,?,?,?,?)",
          ).run(
            project,
            trace.id,
            trace.grantId,
            trace.experimentId,
            expires,
            body,
          );
          return [
            prior ? 200 : 201,
            {
              id: trace.id,
              hash: digest(body).toString("hex"),
            },
          ];
        });
        return send(...receipt);
      }
      const comparisonMatch = /^\/v1\/comparisons\/([^/]+)\/([^/]+)$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && comparisonMatch) {
        role("read");
        const runs = comparisonMatch.slice(1).map((id) => {
          uuid(id);
          const row = db
            .prepare("SELECT body FROM experiments WHERE project=? AND id=?")
            .get(project, id);
          reject(row, 404);
          const experiment = JSON.parse(row.body);
          const traces = db
            .prepare(
              "SELECT body FROM observations WHERE project=? AND experiment_id=?",
            )
            .all(project, id)
            .map((item) => JSON.parse(item.body));
          return { experiment, traces };
        });
        const datasetRow = db
          .prepare("SELECT body FROM datasets WHERE project=? AND hash=?")
          .get(project, runs[0].experiment.datasetHash);
        reject(datasetRow, 409);
        try {
          return send(
            200,
            compareRuns(JSON.parse(datasetRow.body), runs[0], runs[1], policy),
          );
        } catch {
          throw new Rejection(409);
        }
      }
      const traceMatch = /^\/v1\/traces\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && traceMatch) {
        role("read");
        uuid(traceMatch[1]);
        const row = db
          .prepare("SELECT body FROM observations WHERE project=? AND id=?")
          .get(project, traceMatch[1]);
        reject(row, 404);
        return send(200, JSON.parse(row.body));
      }
      throw new Rejection(404);
    } catch (error) {
      // No raw request, provider body, token or error text leaves the service.
      send(
        error instanceof Rejection
          ? error.status
          : error instanceof SyntaxError ||
              error.message === "Invalid feed contract"
            ? 400
            : 500,
      );
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  server.maxConnections = 32;
  try {
    await new Promise((resolve, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    clearInterval(timer);
    db.close();
    throw error;
  }
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    async close() {
      clearInterval(timer);
      await new Promise((resolve, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolve())),
      );
      db.close();
    },
  };
}
