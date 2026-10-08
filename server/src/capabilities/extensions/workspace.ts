import { lstat, realpath, readdir, mkdir, rename, unlink, open, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, relative, sep } from "node:path";
import { constants } from "node:fs";
import type { HostedToolContribution } from "./contracts.js";
import type { ToolExecutionContext } from "../tools/contracts.js";
import { aborted, contribution, digest, integerSchema, objectSchema, relativePathSchema, textSchema, type PackageIdentity } from "./package-utils.js";

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

export interface WorkspaceOptions { readonly isolateSessions?: boolean; readonly stateRoot?: string }

export async function workspaceContributions(identity: PackageIdentity, configuredRoot: string, writeDirectories: readonly string[] = ["artifacts"], options: WorkspaceOptions = {}): Promise<HostedToolContribution[]> {
  if (options.isolateSessions) return isolatedWorkspaceContributions(identity, configuredRoot, writeDirectories, options);
  const root = await realpath(configuredRoot);
  if (!(await lstat(root)).isDirectory()) throw new Error("Workspace root must be a directory.");
  const writable = writeDirectories.map((directory) => {
    if (!directory || directory.startsWith("/") || directory.includes("\\") || directory.split("/").some((part) => !part || part === ".." || part === ".")) throw new Error("Write directories must be explicit relative directories.");
    return directory;
  });
  // The path stays private, but changing the server-owned workspace binding must
  // change the snapshot identity so an old run cannot silently target a new root.
  const revision = digest(JSON.stringify({ identity, source: "workspace-v1", root, writeDirectories: writable }));
  const pathProperties = { path: relativePathSchema };
  const make = (operation: string, description: string, schema: Record<string, unknown>, risk: "read" | "write", execute: HostedToolContribution["implementation"]["execute"]) => contribution(identity, operation, description, schema, risk, execute, revision);
  let mutations = Promise.resolve();
  async function mutate<T>(task: () => Promise<T>): Promise<T> { const before = mutations; let release!: () => void; mutations = new Promise<void>((resolveValue) => { release = resolveValue; }); await before; try { return await task(); } finally { release(); } }
  async function write(pathInput: string, content: string, expectedDigest?: string): Promise<Record<string, unknown>> {
    if (!writable.some((directory) => pathInput.startsWith(`${directory}/`))) throw new Error(`Writes are limited to: ${writable.join(", ")}.`);
    if (Buffer.byteLength(content) > 128 * 1024) throw new Error("File content exceeds 131072 bytes.");
    const path = await confinedPath(root, pathInput, true);
    await mkdir(dirname(path), { recursive: true });
    await confinedPath(root, pathInput, true);
    let previous: string | null = null;
    try { previous = await readBoundedText(path); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    if (previous !== null && expectedDigest !== digest(previous)) throw new Error("Existing file requires its current expectedDigest. Read the file before replacing it.");
    if (previous === null && expectedDigest !== undefined) throw new Error("File does not exist; expectedDigest cannot match.");
    const temporary = resolve(dirname(path), `.agentlab-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(content, "utf8"); } finally { await handle.close(); }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => undefined); }
    return { path: pathInput, bytes: Buffer.byteLength(content), digest: digest(content), previousDigest: previous === null ? null : digest(previous) };
  }
  return [
    make("list_files", "List entries in the task workspace, with bounded pagination. Symbolic links are listed but cannot be read.", objectSchema({ ...pathProperties, offset: integerSchema(0, 100_000), limit: integerSchema(1, 200) }), "read", async (args, context) => {
      aborted(context.signal); const path = await confinedPath(root, String(args.path ?? "."));
      const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      const offset = Number(args.offset ?? 0); const limit = Number(args.limit ?? 100);
      return JSON.stringify({ path: args.path ?? ".", entries: entries.slice(offset, offset + limit).map((entry) => ({ name: entry.name, kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" })), nextOffset: offset + limit < entries.length ? offset + limit : null });
    }),
    make("read_file", "Read a UTF-8 task file with line bounds. The digest identifies the complete file for safe edits.", objectSchema({ ...pathProperties, startLine: integerSchema(1, 100_000), maxLines: integerSchema(1, 2000) }, ["path"]), "read", async (args, context) => {
      aborted(context.signal); const text = await readBoundedText(await confinedPath(root, String(args.path))); const lines = text.split("\n"); const first = Number(args.startLine ?? 1); const count = Number(args.maxLines ?? 200);
      return JSON.stringify({ path: args.path, digest: digest(text), totalLines: lines.length, startLine: first, content: lines.slice(first - 1, first - 1 + count).join("\n"), truncated: first - 1 + count < lines.length });
    }),
    make("search_files", "Search literal text across UTF-8 workspace files. Returns bounded matching lines and reports skipped files.", objectSchema({ query: { type: "string", minLength: 1, maxLength: 512 }, path: relativePathSchema, caseSensitive: { type: "boolean" }, maxMatches: integerSchema(1, 200) }, ["query"]), "read", async (args, context) => {
      const matches: Record<string, unknown>[] = []; let scanned = 0; let skipped = 0; let truncated = false; const maximum = Number(args.maxMatches ?? 50); const query = args.caseSensitive ? String(args.query) : String(args.query).toLowerCase();
      async function visit(path: string, depth: number): Promise<void> {
        aborted(context.signal); if (depth > 8 || scanned >= 1000 || matches.length >= maximum) { truncated = true; return; }
        const stat = await lstat(path); if (stat.isSymbolicLink()) { skipped++; return; }
        if (stat.isDirectory()) { for (const entry of (await readdir(path)).sort()) { if ([".git", "node_modules"].includes(entry)) continue; await visit(resolve(path, entry), depth + 1); } return; }
        scanned++; let text: string; try { text = await readBoundedText(path); } catch { skipped++; return; }
        const lines = text.split("\n"); for (let index = 0; index < lines.length && matches.length < maximum; index++) { if ((args.caseSensitive ? lines[index] : lines[index].toLowerCase()).includes(query)) matches.push({ path: relative(root, path).split(sep).join("/"), line: index + 1, text: lines[index].slice(0, 1000) }); }
        if (matches.length >= maximum) truncated = true;
      }
      await visit(await confinedPath(root, String(args.path ?? ".")), 0); return JSON.stringify({ matches, scannedFiles: scanned, skippedFiles: skipped, truncated });
    }),
    make("write_file", "Create an output file, or replace a previously read file using expectedDigest. Writes require the package write grant.", objectSchema({ ...pathProperties, content: textSchema, expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["path", "content"]), "write", async (args, context) => mutate(async () => { aborted(context.signal); return JSON.stringify(await write(String(args.path), String(args.content), args.expectedDigest as string | undefined)); })),
    make("patch_file", "Replace exactly one text occurrence in a previously read output file. Requires expectedDigest and fails if the text is absent or ambiguous.", objectSchema({ ...pathProperties, oldText: { type: "string", minLength: 1 }, newText: textSchema, expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["path", "oldText", "newText", "expectedDigest"]), "write", async (args, context) => mutate(async () => {
      aborted(context.signal); const original = await readBoundedText(await confinedPath(root, String(args.path))); const oldText = String(args.oldText); const first = original.indexOf(oldText);
      if (first < 0 || original.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText must match exactly one occurrence.");
      return JSON.stringify(await write(String(args.path), original.slice(0, first) + String(args.newText) + original.slice(first + oldText.length), String(args.expectedDigest)));
    })),
  ];
}

/** Copies a bounded frozen template once per host-admitted session identity. */
async function isolatedWorkspaceContributions(identity: PackageIdentity, configuredRoot: string, writeDirectories: readonly string[], options: WorkspaceOptions): Promise<HostedToolContribution[]> {
  if (!options.stateRoot) throw new Error("An isolated workspace requires a configured stateRoot.");
  const templateRoot = await realpath(configuredRoot);
  await mkdir(options.stateRoot, { recursive: true, mode: 0o700 });
  const stateRoot = await realpath(options.stateRoot);
  if (inside(templateRoot, stateRoot)) throw new Error("Workspace stateRoot cannot be inside its template root.");
  const entries: { path: string; bytes: Buffer }[] = []; const directoryPaths: string[] = []; let totalBytes = 0; let directories = 0;
  async function capture(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Workspace templates cannot contain symbolic links.");
    if (stat.isDirectory()) {
      if (++directories > 256) throw new Error("Workspace template exceeds 256 directories.");
      const name = relative(templateRoot, path).split(sep).join("/"); if (name) directoryPaths.push(name);
      for (const name of (await readdir(path)).sort()) await capture(resolve(path, name));
    } else if (stat.isFile()) {
      if (entries.length >= 256 || totalBytes + stat.size > 10 * 1024 * 1024) throw new Error("Workspace template exceeds 256 files or 10 MiB.");
      const bytes = await readBoundedBytes(path, 10 * 1024 * 1024); totalBytes += bytes.length;
      if (totalBytes > 10 * 1024 * 1024) throw new Error("Workspace template exceeds 10 MiB.");
      const name = relative(templateRoot, path).split(sep).join("/");
      if (name === ".agentlab-workspace.json") throw new Error("Workspace template contains the reserved ownership marker.");
      entries.push({ path: name, bytes });
    } else throw new Error("Workspace template contains an unsupported special file.");
  }
  await capture(templateRoot);
  const revision = digest(JSON.stringify({ identity, source: "isolated-workspace-v1", templateRoot, stateRoot, writeDirectories, directories: directoryPaths, template: entries.map((entry) => ({ path: entry.path, digest: digest(entry.bytes) })) }));
  const declarations = await workspaceContributions(identity, templateRoot, writeDirectories);
  const sessions = new Map<string, Promise<HostedToolContribution[]>>();
  async function forSession(context: ToolExecutionContext): Promise<HostedToolContribution[]> {
    const sessionId = context.sessionId;
    if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId) || sessionId === "." || sessionId === "..") throw new Error("Isolated workspace requires a safe host-admitted session identity.");
    let pending = sessions.get(sessionId);
    if (!pending) {
      pending = createSession(sessionId);
      sessions.set(sessionId, pending);
      pending.catch(() => sessions.delete(sessionId));
    }
    return pending;
  }
  async function createSession(sessionId: string): Promise<HostedToolContribution[]> {
    const target = resolve(stateRoot, sessionId); const markerName = ".agentlab-workspace.json";
    const marker = JSON.stringify({ schemaVersion: 1, packageId: identity.id, packageVersion: identity.version, revision, sessionId });
    let exists = false;
    try { const stat = await lstat(target); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Session workspace is not a regular directory."); exists = true; }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    if (!exists) {
      const temporary = resolve(stateRoot, `.creating-${randomUUID()}`); await mkdir(temporary, { mode: 0o700 });
      try {
        for (const directory of directoryPaths) await mkdir(resolve(temporary, directory), { recursive: true, mode: 0o700 });
        for (const entry of entries) {
          const path = resolve(temporary, entry.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const handle = await open(path, "wx", 0o600); try { await handle.writeFile(entry.bytes); } finally { await handle.close(); }
        }
        const handle = await open(resolve(temporary, markerName), "wx", 0o600); try { await handle.writeFile(marker); } finally { await handle.close(); }
        try { await rename(temporary, target); } catch (error) { if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY")) throw error; }
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    await confinedPath(stateRoot, `${sessionId}/${markerName}`);
    if (await readBoundedText(resolve(target, markerName)) !== marker) throw new Error("Session workspace belongs to another package revision. Start a new session.");
    return workspaceContributions(identity, target, writeDirectories);
  }
  return declarations.map((tool, index) => ({
    descriptor: { ...tool.descriptor, source: { ...identity, digest: revision } },
    implementation: { ...tool.implementation, execute: async (args, context) => {
      context.signal.throwIfAborted();
      const tools = await forSession(context); context.signal.throwIfAborted();
      return tools[index].implementation.execute(args, context);
    } },
  }));
}
