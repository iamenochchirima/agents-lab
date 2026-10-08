import { lstat, open } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { constants } from "node:fs";

/** Internal skill/config storage utilities, never registered as agent tools. */
/** Application path confinement; this is not an operating-system sandbox. */
export async function confinedPath(root: string, input: string, allowMissing = false): Promise<string> {
  if (!input || input.includes("\\") || input.includes("\0") || input.startsWith("/") || input.split("/").includes("..")) throw new Error("Use a relative package path without traversal.");
  const path = resolve(root, input);
  if (!inside(root, path)) throw new Error("Path leaves the configured root.");
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not accessible through workspace tools."); }
    catch (error) { if (allowMissing && hasCode(error, "ENOENT")) continue; throw error; }
  }
  return path;
}
function inside(root: string, path: string): boolean { const tail = relative(root, path); return tail === "" || (!tail.startsWith(`..${sep}`) && tail !== ".." && !tail.startsWith(sep)); }
function hasCode(error: unknown, code: string): boolean { return error !== null && typeof error === "object" && "code" in error && error.code === code; }
export async function readBoundedBytes(path: string, maxBytes = 128 * 1024): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Read requires a regular UTF-8 file of at most ${maxBytes} bytes.`);
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error("File exceeds the read byte limit.");
    return bytes;
  } finally { await handle.close(); }
}
export async function readBoundedText(path: string, maxBytes = 128 * 1024): Promise<string> {
  const bytes = await readBoundedBytes(path, maxBytes);
  if (bytes.includes(0)) throw new Error("File contains binary content.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
