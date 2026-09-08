import { describe, expect, it, vi } from "vitest";
import {
  findManifestFiles,
  manifestsFromDrop,
  readManifest,
  MAX_MANIFEST_BYTES,
} from "@/features/systems/import-files";

function file(path: string, content = "{}") {
  const value = new File([content], path.split("/").at(-1)!);
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  Object.defineProperty(value, "text", { value: vi.fn(async () => content) });
  return value;
}

describe("manifest files", () => {
  it("finds manifests without reading source, hidden files, or dependencies", () => {
    const files = [
      file("agent/agent.py"),
      file("agent/.env"),
      file("agent/node_modules/pkg/autoeval.json"),
      file("agent/.git/autoeval.json"),
      file("agent/autoeval.json"),
      file("agent/second/autoeval.json"),
    ];
    expect(findManifestFiles(files).map((item) => item.path)).toEqual([
      "agent/autoeval.json",
      "agent/second/autoeval.json",
    ]);
    files.forEach((item) => expect(item.text).not.toHaveBeenCalled());
  });

  it("enforces the size limit before reading", async () => {
    const value = file("autoeval.json", "x".repeat(MAX_MANIFEST_BYTES + 1));
    await expect(readManifest(value)).rejects.toThrow("512 KB");
    expect(value.text).not.toHaveBeenCalled();
  });

  it("provides a useful JSON error", async () => {
    await expect(
      readManifest(file("autoeval.json", "not JSON")),
    ).rejects.toThrow("invalid JSON");
    await expect(
      readManifest(file("autoeval.json", '{"schema_version":1}')),
    ).resolves.toEqual({ schema_version: 1 });
  });

  it("drains folder batches but opens only manifests", async () => {
    const readSource = vi.fn();
    const manifest = file("autoeval.json");
    const batches = [
      [{ name: "agent.py", isFile: true, file: readSource }],
      [
        {
          name: "autoeval.json",
          isFile: true,
          file: (resolve: (file: File) => void) => resolve(manifest),
        },
      ],
      [],
    ];
    const root = {
      name: "agent",
      isDirectory: true,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) =>
          resolve(batches.shift() ?? []),
      }),
    };
    const transfer = {
      items: [{ kind: "file", webkitGetAsEntry: () => root }],
      files: [],
    } as unknown as DataTransfer;
    expect(await manifestsFromDrop(transfer)).toEqual([
      { path: "agent/autoeval.json", file: manifest },
    ]);
    expect(readSource).not.toHaveBeenCalled();
  });
});
