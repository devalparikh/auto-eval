import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist", import.meta.url));
for (const file of await readdir(new URL("../src", import.meta.url))) {
  if (file.endsWith(".js"))
    execFileSync(process.execPath, [
      "--check",
      new URL(`../src/${file}`, import.meta.url).pathname,
    ]);
  await copyFile(
    new URL(`../src/${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
}
