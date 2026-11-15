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
      `./devalparikh-autoeval-${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version}.tgz`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  const source = (
    await readFile(new URL("../test/feed.test.mjs", import.meta.url), "utf8")
  ).replace(/(["'])\.\.\/src\/index\.js\1/g, '"@devalparikh/autoeval"');
  await writeFile(join(directory, "consumer.test.mjs"), source);
  const envTest = (
    await readFile(new URL("../test/env.test.mjs", import.meta.url), "utf8")
  ).replace(/(["'])\.\.\/src\/index\.js\1/g, '"@devalparikh/autoeval"');
  await writeFile(join(directory, "env.test.mjs"), envTest);
  const types = await readFile(
    new URL("../test/types.mts", import.meta.url),
    "utf8",
  );
  await writeFile(join(directory, "types.mts"), types);
  const compiler = new URL(
    "../../../frontend/node_modules/typescript/bin/tsc",
    import.meta.url,
  );
  // Full repo checks compile the installed consumer too; package-only CI has no TS dependency.
  try {
    await readFile(compiler);
    execFileSync(
      process.execPath,
      [
        fileURLToPath(compiler),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "types.mts",
      ],
      { cwd: directory, stdio: "inherit" },
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  execFileSync(
    process.execPath,
    ["--test", "consumer.test.mjs", "env.test.mjs"],
    {
      cwd: directory,
      stdio: "inherit",
    },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
