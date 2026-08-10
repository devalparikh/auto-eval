export function systemPath(systemKey: string, section = "") {
  const root = `/systems/${encodeURIComponent(systemKey)}`;
  return section ? `${root}/${section}` : root;
}
