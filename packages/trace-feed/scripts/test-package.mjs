import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "autoeval-consumer-"));
try {
  execFileSync("npm", ["pack", "--pack-destination", directory], {
    cwd: root,
    stdio: "inherit",
  });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--no-audit",
      "--no-fund",
      "./devalparikh-autoeval-0.1.0.tgz",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  const source = (
    await readFile(new URL("../test/feed.test.mjs", import.meta.url), "utf8")
  )
    .replace('"../src/index.js"', '"@devalparikh/autoeval"')
    .replace('"../src/server.js"', '"@devalparikh/autoeval/server"');
  await writeFile(join(directory, "consumer.test.mjs"), source);
  execFileSync(process.execPath, ["--test", "consumer.test.mjs"], {
    cwd: directory,
    stdio: "inherit",
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
