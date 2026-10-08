import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { parseDocument } from "yaml";
import { skillContributions } from "../extensions/skills.js";
import { emptyManagedState, validateManagedState, type ManagedConnectionRecord, type ManagedInstallationRecord, type ManagedPackageRecord } from "./records.js";

export interface PluginManifest {
  schemaVersion: 1; id: string; version: string; skills?: string;
  packages?: ManagedPackageRecord[];
  connections?: ManagedConnectionRecord[];
  dependencies?: { id: string; version: string }[];
  requiredSecrets?: { name: string; description: string }[];
}
export type InstallationOrigin = { kind: "upload" } | { kind: "git"; url: string; commit: string; subdirectory?: string };
export interface InstallationPreview {
  digest: string; manifest: PluginManifest; origin: InstallationOrigin;
  files: { path: string; bytes: number }[];
  skills: { name: string; description: string; digest: string }[];
  requiredSecrets: { name: string; description: string }[];
}
export interface PreparedInstallation {
  installation: ManagedInstallationRecord; packages: ManagedPackageRecord[]; connections: ManagedConnectionRecord[]; preview: InstallationPreview;
}
export interface SkillImportIdentity { id: string; version: string }
const MAX_ARCHIVE = 8 * 1024 * 1024, MAX_TOTAL = 16 * 1024 * 1024, MAX_FILE = 256 * 1024, MAX_FILES = 1024;
const run = promisify(execFile);

/**
 * Integration-host installation only. Files are inspected as data, never executed.
 * Returned definitions are published by the state repository; installation does
 * not connect an account or enable a profile. Old digest directories survive
 * logical removal so admitted runs remain pinned.
 */
export class PackageInstaller {
  constructor(private readonly root: string) {}

  async previewZip(archive: Buffer, installed: readonly ManagedInstallationRecord[] = [], identity?: SkillImportIdentity): Promise<InstallationPreview> {
    const staged = await this.stage(archive, installed, { kind: "upload" }, identity);
    try { return staged.preview; } finally { await rm(staged.directory, { recursive: true, force: true }); }
  }

  async installZip(archive: Buffer, installed: readonly ManagedInstallationRecord[] = [], identity?: SkillImportIdentity): Promise<PreparedInstallation> {
    return this.publish(await this.stage(archive, installed, { kind: "upload" }, identity));
  }

  async previewGit(source: { url: string; commit: string; subdirectory?: string }, installed: readonly ManagedInstallationRecord[] = [], identity?: SkillImportIdentity): Promise<InstallationPreview> {
    const staged = await this.stage(await this.gitArchive(source), installed, { kind: "git", ...source }, identity);
    try { return staged.preview; } finally { await rm(staged.directory, { recursive: true, force: true }); }
  }

  async importGit(source: { url: string; commit: string; subdirectory?: string }, installed: readonly ManagedInstallationRecord[] = [], identity?: SkillImportIdentity): Promise<PreparedInstallation> {
    return this.publish(await this.stage(await this.gitArchive(source), installed, { kind: "git", ...source }, identity));
  }

  private async stage(archive: Buffer, installed: readonly ManagedInstallationRecord[], origin: InstallationOrigin, identity?: SkillImportIdentity) {
    const files = unzip(archive);
    if (!files.has("lab-plugin.json") && !files.has("SKILL.md")) {
      const first = [...files.keys()][0]?.split("/")[0];
      if (first && [...files.keys()].every(path => path.startsWith(first + "/"))) {
        const unwrapped = new Map([...files].map(([path, bytes]) => [path.slice(first.length + 1), bytes]));
        files.clear(); for (const [path, bytes] of unwrapped) files.set(path, bytes);
      }
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.root, ".staging-"));
    try {
      let manifest: PluginManifest;
      const manifestBytes = files.get("lab-plugin.json");
      if (manifestBytes) manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
      else {
        if (!identity) throw new Error("A standard skill archive requires an explicit package ID and exact version.");
        manifest = parseManifest({ schemaVersion: 1, ...identity, skills: "skills" });
        if (files.has("SKILL.md")) {
          const text = files.get("SKILL.md")!.toString("utf8");
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
          const document = frontmatter ? parseDocument(frontmatter, { uniqueKeys: true }) : undefined;
          const metadata: unknown = document && !document.errors.length ? document.toJSON() : null;
          const name = object(metadata) ? metadata.name : null;
          if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Single skill upload requires a valid name in SKILL.md frontmatter.");
          const nested = new Map([...files].map(([path, bytes]) => ["skills/" + name + "/" + path, bytes]));
          files.clear(); for (const [path, bytes] of nested) files.set(path, bytes);
        } else {
          const nested = new Map([...files].map(([path, bytes]) => ["skills/" + path, bytes]));
          files.clear(); for (const [path, bytes] of nested) files.set(path, bytes);
        }
      }
      validateDependencies(manifest, installed);
      if (files.has(".lab-installation.json")) throw new Error("Bundle may not replace installation metadata.");
      const hash = createHash("sha256");
      hash.update(JSON.stringify(manifest));
      for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(JSON.stringify([path, bytes.length])); hash.update(bytes);
        await mkdir(join(directory, path, ".."), { recursive: true, mode: 0o700 });
        await writeFile(join(directory, path), bytes, { flag: "wx", mode: 0o600 });
      }
      const digest = hash.digest("hex");
      if (installed.some(record => record.id === manifest.id && record.version === manifest.version && record.digest !== digest)) throw new Error("Installed package identity/version already has different content. Publish a new version.");
      const skills = manifest.skills ? [...(await skillContributions({ id: manifest.id, version: manifest.version }, join(directory, manifest.skills))).skills] : [];
      if (manifest.skills && !skills.length) throw new Error("Declared skill root contains no valid SKILL.md packages.");
      const preview: InstallationPreview = { digest, manifest, origin, files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length })), skills,
        requiredSecrets: manifest.requiredSecrets ?? [] };
      return { directory, preview };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }

  private async publish(staged: { directory: string; preview: InstallationPreview }): Promise<PreparedInstallation> {
    const { directory, preview } = staged, root = join(this.root, preview.digest);
    try {
      await writeFile(join(directory, ".lab-installation.json"), JSON.stringify({ schemaVersion: 1, digest: preview.digest, origin: preview.origin, manifest: preview.manifest }) + "\n", { mode: 0o600, flag: "wx" });
      try { await rename(directory, root); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) throw error;
        const previous = JSON.parse(await readFile(join(root, ".lab-installation.json"), "utf8"));
        if (previous.digest !== preview.digest) throw new Error("Installed content digest does not match its directory.");
        for (const file of preview.files) {
          if (!(await readFile(join(root, file.path))).equals(await readFile(join(directory, file.path)))) throw new Error("Previously installed content changed after publication.");
        }
      }
      for (const file of preview.files) await chmod(join(root, file.path), 0o444);
      await chmod(join(root, ".lab-installation.json"), 0o444);
      const manifest = preview.manifest;
      const packages: ManagedPackageRecord[] = (manifest.packages ?? []).map(template => ({ ...template, enabled: false, installationRef: manifest.id }));
      if (manifest.skills) packages.push({ id: manifest.id + "-skills", version: manifest.version, source: "skills", root: join(root, manifest.skills), enabled: false, installationRef: manifest.id });
      const connections = structuredClone(manifest.connections ?? []);
      return { installation: { id: manifest.id, version: manifest.version, digest: preview.digest, root, packageIds: packages.map(p => p.id), connectionRefs: connections.map(connection => connection.ref), dependencies: manifest.dependencies ?? [], installedAt: new Date().toISOString() }, packages, connections, preview };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  private async gitArchive(source: { url: string; commit: string; subdirectory?: string }): Promise<Buffer> {
    let url: URL; try { url = new URL(source.url); } catch { throw new Error("Git import requires an explicit HTTPS repository URL."); }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(source.commit)) throw new Error("Git import requires a credential-free HTTPS URL and full pinned commit hash.");
    if (source.subdirectory) safePath(source.subdirectory);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.root, ".git-"));
    const options = { cwd: directory, timeout: 60_000, maxBuffer: MAX_ARCHIVE, encoding: "buffer" as const,
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" } };
    const command = (...args: string[]) => run("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-c", "http.followRedirects=false", ...args], options);
    try {
      await command("init", "--quiet");
      await command("remote", "add", "origin", source.url);
      await command("fetch", "--no-tags", "--depth=1", "origin", source.commit);
      const { stdout } = await command("archive", "--format=zip", source.commit + (source.subdirectory ? ":" + source.subdirectory : ""));
      return Buffer.from(stdout);
    } catch { throw new Error("Pinned Git import failed. Verify the repository URL, commit, package path and Git availability."); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

function parseManifest(value: unknown): PluginManifest {
  if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !["schemaVersion", "id", "version", "skills", "packages", "connections", "dependencies", "requiredSecrets"].includes(key))
    || typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(value.id) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error("Plugin manifest requires schemaVersion 1, a safe ID and exact semantic version; hooks and foreign formats are unsupported.");
  if (value.skills !== undefined) { if (typeof value.skills !== "string") throw new Error("Plugin skills must name a relative directory."); safePath(value.skills); }
  if (value.connections !== undefined) {
    if (!Array.isArray(value.connections) || value.connections.length > 32 || value.connections.some(connection => !object(connection)
      || typeof connection.ref !== "string" || !connection.ref.startsWith(value.id + "-") || connection.owner !== "local-workspace"
      || connection.enabled !== false || !object(connection.auth) || connection.auth.kind !== "anonymous")) throw new Error("Plugin connections must be namespaced, disabled anonymous templates owned by the local workspace.");
    const state = emptyManagedState(); state.connections = value.connections as ManagedConnectionRecord[]; validateManagedState(state);
  }
  if (value.packages !== undefined) {
    if (!Array.isArray(value.packages) || value.packages.length > 32 || value.packages.some(p => !object(p) || !["mcp", "http"].includes(String(p.source)) || p.installationRef !== undefined || p.enabled === true)) throw new Error("Plugin source templates permit MCP/HTTP definitions only, without connected accounts or automatic enablement.");
    for (const pkg of value.packages) if (!object(pkg) || typeof pkg.id !== "string" || !pkg.id.startsWith(value.id + "-")) throw new Error("Plugin tool source IDs must be namespaced by the plugin ID.");
    if (value.skills && value.packages.some(pkg => object(pkg) && pkg.id === value.id + "-skills")) throw new Error("Plugin source ID collides with its generated skills package.");
    const state = emptyManagedState(); state.connections = (value.connections ?? []) as ManagedConnectionRecord[]; state.packages = value.packages as ManagedPackageRecord[]; validateManagedState(state);
    for (const pkg of state.packages) if ('connectionRef' in pkg && pkg.connectionRef) {
      const connection = state.connections.find(connection => connection.ref === pkg.connectionRef)!;
      const endpoint = pkg.source === 'mcp' ? pkg.endpoint : pkg.source === 'http' ? pkg.baseUrl : undefined;
      if (!endpoint || new URL(endpoint).origin !== new URL(connection.resource).origin || pkg.source === 'mcp' && new URL(endpoint).href !== new URL(connection.resource).href) throw new Error("Plugin source endpoint must match its declared connection resource.");
    }
  }
  if (value.dependencies !== undefined && (!Array.isArray(value.dependencies) || value.dependencies.length > 32 || value.dependencies.some(d => !object(d) || Object.keys(d).some(key => !["id", "version"].includes(key)) || typeof d.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(d.id) || typeof d.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(d.version)) || new Set(value.dependencies.map(d => d.id)).size !== value.dependencies.length)) throw new Error("Plugin dependencies require distinct exact ID/version pairs.");
  if (value.requiredSecrets !== undefined && (!Array.isArray(value.requiredSecrets) || value.requiredSecrets.length > 32 || value.requiredSecrets.some(s => !object(s) || Object.keys(s).some(key => !["name", "description"].includes(key)) || typeof s.name !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(s.name) || typeof s.description !== "string" || !s.description.length || s.description.length > 1024) || new Set(value.requiredSecrets.map(s => s.name)).size !== value.requiredSecrets.length)) throw new Error("Required secrets declare names/descriptions only, never values.");
  if (!value.skills && !(value.packages as unknown[] | undefined)?.length) throw new Error("Plugin must contain skills or MCP/HTTP source templates.");
  return value as unknown as PluginManifest;
}

function validateDependencies(manifest: PluginManifest, installed: readonly ManagedInstallationRecord[]): void {
  const graph = new Map(installed.map(record => [record.id, { version: record.version, dependencies: record.dependencies }]));
  graph.set(manifest.id, { version: manifest.version, dependencies: manifest.dependencies ?? [] });
  const active = new Set<string>(), complete = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error("Plugin dependency cycle detected.");
    if (complete.has(id)) return;
    active.add(id);
    for (const dependency of graph.get(id)!.dependencies) {
      if (graph.get(dependency.id)?.version !== dependency.version) throw new Error("Plugin dependency is missing or has a different exact version.");
      visit(dependency.id);
    }
    active.delete(id); complete.add(id);
  }
  for (const id of graph.keys()) visit(id);
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function safePath(path: string): void {
  if (!path || path.length > 512 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || /[\x00-\x1f\x7f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..") || path.split("/").length > 10) throw new Error("Archive or package path is unsafe.");
}

/** ZIP central-directory parser; excludes ZIP64, encryption and links. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > MAX_ARCHIVE || bytes.length < 22) throw new Error("ZIP archive exceeds the upload limit or is incomplete.");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)) throw new Error("ZIP requires a single disk and a valid central directory.");
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > MAX_FILES || start + directorySize !== end) throw new Error("ZIP entry count or central directory is invalid; ZIP64 is unsupported.");
  let offset = start, total = 0; const files = new Map<string, Buffer>(), names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP central directory is invalid.");
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), crc = bytes.readUInt32LE(offset + 16), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameBytes = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), mode = bytes.readUInt32LE(offset + 38) >>> 16, local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + nameBytes + extra + comment > end || flags & 0x41 || ![0, 8].includes(method) || bytes.readUInt16LE(offset + 34) || size > MAX_FILE || compressed > MAX_ARCHIVE || size > Math.max(compressed * 200, 4096) || (mode & 0xf000) === 0xa000 || ((mode & 0xf000) !== 0 && ![0x8000, 0x4000].includes(mode & 0xf000))) throw new Error("ZIP contains unsupported encryption, compression, links or unbounded entries.");
    let name: string; try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameBytes)); } catch { throw new Error("ZIP filenames must be UTF-8."); }
    const directory = name.endsWith("/"); const path = directory ? name.slice(0, -1) : name; safePath(path);
    if (names.has(path)) throw new Error("ZIP contains duplicate paths."); names.add(path);
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags) throw new Error("ZIP local file header is invalid.");
    const localNameSize = bytes.readUInt16LE(local + 26), data = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (data + compressed > start || bytes.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== name) throw new Error("ZIP local path or data bounds are invalid.");
    let content: Buffer; try { const payload = bytes.subarray(data, data + compressed); content = method === 8 ? inflateRawSync(payload, { maxOutputLength: MAX_FILE }) : Buffer.from(payload); } catch { throw new Error("ZIP entry could not be decompressed within its limit."); }
    if (content.length !== size || crc32(content) !== crc || (directory && size !== 0) || (total += size) > MAX_TOTAL) throw new Error("ZIP size, checksum or expanded size limit failed.");
    if (!directory) files.set(path, content);
    offset += 46 + nameBytes + extra + comment;
  }
  if (offset !== end || !files.size) throw new Error("ZIP contains no files or trailing directory data.");
  return files;
}
function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
