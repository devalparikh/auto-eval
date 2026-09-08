export const MANIFEST_NAME = "autoeval.json";
export const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_ENTRIES = 10_000;
const ignoredDirectories = new Set([
  ".git",
  ".venv",
  "venv",
  "node_modules",
  ".next",
  "__pycache__",
  "dist",
  "build",
]);

export type ManifestFile = { path: string; file: File };

function allowedPath(path: string): boolean {
  return !path
    .split("/")
    .some((part) => ignoredDirectories.has(part) || part.startsWith("."));
}

export function findManifestFiles(files: File[]): ManifestFile[] {
  if (files.length > MAX_ENTRIES) {
    throw new Error(
      "This folder is too large. Select the agent's subfolder or autoeval.json directly.",
    );
  }
  return files
    .map((file) => ({ path: file.webkitRelativePath || file.name, file }))
    .filter(
      ({ file, path }) => file.name === MANIFEST_NAME && allowedPath(path),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** Enumerate names, then read only manifest files. Source and environment files stay local. */
export async function manifestsFromDrop(
  transfer: DataTransfer,
): Promise<ManifestFile[]> {
  // Capture handles before the browser clears the drag data store.
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  const fallback = Array.from(transfer.files);
  if (!entries.some(Boolean)) return findManifestFiles(fallback);
  const found: ManifestFile[] = [];
  let visited = 0;
  async function visit(entry: FileSystemEntry, parent: string): Promise<void> {
    if (++visited > MAX_ENTRIES) {
      throw new Error(
        "This folder is too large. Select the agent's subfolder or autoeval.json directly.",
      );
    }
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (!allowedPath(path)) return;
    if (entry.isFile) {
      if (entry.name !== MANIFEST_NAME) return;
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      found.push({ path, file });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await visit(child, path);
      }
    }
  }
  for (const entry of entries) if (entry) await visit(entry, "");
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readManifest(file: File): Promise<unknown> {
  if (file.size > MAX_MANIFEST_BYTES) {
    throw new Error("autoeval.json must be 512 KB or smaller.");
  }
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(
      "autoeval.json contains invalid JSON. Check commas, quotes, and brackets.",
    );
  }
}
