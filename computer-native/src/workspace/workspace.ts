import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, link, mkdir, open, readdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isRuntimeInterruptionError, MutationError, WorkspaceAccessError } from "../runtime/errors.js";
import { WORKSPACE_QUARANTINE_DIRECTORY, WORKSPACE_TRANSACTION_DIRECTORY, WorkspaceSecurityPolicy, type WorkspaceLimits } from "../security/workspace-policy.js";
import { contentHash, describePatch, prepareFileWrite, preparePatch as preparePurePatch, type PreparedPatch } from "./patch.js";
import { MAX_MUTATION_SET_FILES, MAX_MUTATION_SET_REQUEST_BYTES, type MutationJournal, type MutationJournalMember, type MutationJournalState, type MutationMember, type WorkspaceMutationRecord } from "./mutation.js";

export interface WorkspaceDirectoryEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly sizeBytes?: number;
}

export interface WorkspaceDirectoryListing {
  readonly path: string;
  readonly entries: readonly WorkspaceDirectoryEntry[];
  readonly truncated: boolean;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly content: string;
}

export interface WorkspaceMetadata {
  readonly path: string;
  readonly kind: WorkspaceDirectoryEntry["kind"];
  readonly sizeBytes: number;
  readonly mode: number;
  readonly modifiedAt: string;
  readonly accessedAt: string;
  readonly createdAt: string;
  readonly changedAt: string;
  readonly linkCount: number;
}

export interface WorkspaceSearchMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

export interface WorkspaceSearchResult {
  readonly path: string;
  readonly query: string;
  readonly namePattern?: string;
  readonly matches: readonly WorkspaceSearchMatch[];
  readonly nameMatches: readonly string[];
  readonly truncated: boolean;
  readonly filesScanned: number;
}

export interface QuarantineEntry {
  readonly mutationId: string;
  readonly originalPath: string;
  readonly kind: "file" | "directory";
  readonly beforeHash?: string;
  readonly bytes: number;
  readonly mode: number;
  readonly createdAt: string;
  readonly entryCount?: number;
  readonly maxDepth?: number;
  readonly manifestHash?: string;
  readonly payloadAvailable: boolean;
}

export interface QuarantineListing {
  readonly entries: readonly QuarantineEntry[];
  readonly truncated: boolean;
}

export interface PreparedDirectoryCreation {
  readonly operation: "mkdir";
  readonly path: string;
  readonly preview: string;
  readonly alreadyExists: boolean;
}

export interface PreparedDirectoryDeletion {
  readonly operation: "delete-directory";
  readonly path: string;
  readonly preview: string;
}

export interface TreeManifestEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
  readonly mode: number;
  readonly hash?: string;
}

export interface PreparedDirectoryTreeDeletion {
  readonly operation: "delete-directory-tree";
  readonly path: string;
  readonly preview: string;
  readonly mutationId: string;
  readonly quarantinePath: string;
  readonly manifestHash: string;
  readonly entryCount: number;
  readonly totalBytes: number;
  readonly maxDepth: number;
  readonly mode: number;
}

export interface PreparedDirectoryRestore {
  readonly operation: "restore-directory";
  readonly path: string;
  readonly preview: string;
  readonly sourceMutationId: string;
  readonly quarantinePath: string;
  readonly manifestHash: string;
  readonly entryCount: number;
  readonly totalBytes: number;
  readonly maxDepth: number;
}

export interface PreparedQuarantinePurge {
  readonly operation: "purge-quarantine";
  readonly path: string;
  readonly preview: string;
  readonly sourceMutationId: string;
  readonly quarantinePath: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
}

export interface PreparedFileDeletion {
  readonly operation: "delete";
  readonly path: string;
  readonly preview: string;
  readonly beforeHash: string;
  readonly bytes: number;
  readonly mode: number;
  readonly mutationId: string;
  readonly quarantinePath: string;
}

export interface PreparedFileRestore {
  readonly operation: "restore";
  readonly path: string;
  readonly preview: string;
  readonly beforeHash: string;
  readonly bytes: number;
  readonly mode: number;
  readonly sourceMutationId: string;
  readonly quarantinePath: string;
}

export interface PreparedFileCopy {
  readonly operation: "copy";
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly sourcePath: string;
  readonly preview: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly bytes: number;
  readonly mode: number;
  readonly manifestHash?: string;
  readonly entryCount?: number;
  readonly maxDepth?: number;
}

export interface PreparedFileMove {
  readonly operation: "move";
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly sourcePath: string;
  readonly preview: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly bytes: number;
  readonly mode: number;
  readonly manifestHash?: string;
  readonly entryCount?: number;
  readonly maxDepth?: number;
}

export interface PreparedRename {
  readonly operation: "rename";
  readonly kind: "file" | "directory";
  readonly path: string;
  readonly sourcePath: string;
  readonly preview: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly bytes: number;
  readonly mode: number;
  readonly manifestHash?: string;
  readonly entryCount?: number;
  readonly maxDepth?: number;
}

export interface PreparedPatchSet {
  readonly operation: "patch-set";
  readonly path: string;
  readonly paths: readonly string[];
  readonly preview: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly patches: readonly PreparedPatch[];
  readonly members: readonly MutationMember[];
  readonly journal: MutationJournal;
}

export type PreparedWorkspaceMutation = PreparedPatch | PreparedPatchSet | PreparedDirectoryCreation | PreparedDirectoryDeletion | PreparedDirectoryTreeDeletion | PreparedDirectoryRestore | PreparedQuarantinePurge | PreparedFileDeletion | PreparedFileRestore | PreparedFileCopy | PreparedFileMove | PreparedRename;

export interface DirectoryCommit {
  readonly path: string;
  readonly created: boolean;
}

export interface DirectoryDeletionCommit {
  readonly path: string;
  readonly removed: boolean;
}

export interface DirectoryTreeDeletionCommit {
  readonly path: string;
  readonly quarantinePath: string;
  readonly bytes: number;
  readonly entryCount: number;
}

export interface DirectoryRestoreCommit {
  readonly path: string;
  readonly sourceMutationId: string;
  readonly bytes: number;
  readonly entryCount: number;
}

export interface QuarantinePurgeCommit {
  readonly sourceMutationId: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
}

export interface FileQuarantineCommit {
  readonly path: string;
  readonly quarantinePath: string;
  readonly bytes: number;
}

export interface FileRestoreCommit {
  readonly path: string;
  readonly sourceMutationId: string;
  readonly bytes: number;
}

export interface FileTransferCommit {
  readonly path: string;
  readonly sourcePath: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
}

export interface PatchSetCommit {
  readonly paths: readonly string[];
  readonly journal: MutationJournal;
}

export const DEFAULT_SEARCH_MAX_MATCHES = 100;
export const MAX_SEARCH_MATCHES = 200;
export const MAX_SEARCH_QUERY_BYTES = 4 * 1024;

const MAX_SEARCH_FILES = 5_000;
const MAX_SEARCH_LINE_BYTES = 512;
const MAX_SEARCH_NAME_PATTERN_BYTES = 256;
export const MAX_QUARANTINE_ENTRIES = 100;
export const DEFAULT_MAX_TREE_ENTRIES = 2_000;
export const DEFAULT_MAX_TREE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_TREE_DEPTH = 32;
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024;
const MAX_QUARANTINE_MANIFEST_BYTES = 8 * 1024 * 1024;
interface QuarantineManifest {
  readonly schemaVersion: 1;
  readonly mutationId: string;
  readonly originalPath: string;
  readonly kind?: "file" | "directory";
  readonly beforeHash?: string;
  readonly bytes: number;
  readonly mode: number;
  readonly createdAt: string;
  readonly entryCount?: number;
  readonly maxDepth?: number;
  readonly manifestHash?: string;
  readonly entries?: readonly TreeManifestEntry[];
}

export interface WorkspaceCommit {
  readonly path: string;
  readonly afterHash: string;
  readonly bytesWritten: number;
}

export type AtomicWorkspaceWriter = (absolutePath: string, content: string, existingMode: number | undefined, temporaryPath?: string) => Promise<void>;

export interface WorkspaceOpenOptions {
  /** Internal deterministic seam for exercising commit failure and recovery paths. */
  readonly atomicWriter?: AtomicWorkspaceWriter;
}

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): WorkspaceDirectoryEntry["kind"] {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

function excludedSearchName(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith(".")) return true;
  if (["node_modules", ".git", "dist", "build", "coverage", "credentials", "credential", "secrets", "secret", "tokens", "token", "id_rsa"].includes(lower)) return true;
  return /\.(?:pem|key|p12|pfx|secret)$/u.test(lower);
}

function excludedSearchPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/u).filter((part) => part.length > 0 && part !== ".").some(excludedSearchName);
}

function boundedSearchLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= MAX_SEARCH_LINE_BYTES) return line;
  const bytes = Buffer.from(line, "utf8").subarray(0, MAX_SEARCH_LINE_BYTES);
  return `${bytes.toString("utf8").replace(/�/gu, "")}[line truncated]`;
}

function namePatternMatcher(pattern: string): (relativePath: string) => boolean {
  if (pattern.length === 0 || Buffer.byteLength(pattern, "utf8") > MAX_SEARCH_NAME_PATTERN_BYTES || pattern.includes("\u0000") || pattern.includes("\\") || pattern.startsWith("/") || pattern.split("/").includes("..") || /[\[\]]/u.test(pattern)) {
    throw new WorkspaceAccessError("Invalid name pattern: use a bounded relative pattern with '*' or '?' wildcards; bracket expressions, traversal, and absolute paths are not supported.");
  }
  let expression = "^";
  for (const character of pattern) {
    if (character === "*") expression += ".*";
    else if (character === "?") expression += ".";
    else if (".+^${}()|".includes(character)) expression += `\\${character}`;
    else if (character === "/") expression += "\\/";
    else expression += character;
  }
  const matcher = new RegExp(`${expression}$`, "u");
  return (relativePath: string): boolean => matcher.test(relativePath.replaceAll(path.sep, "/"));
}

function validMutationId(mutationId: string): boolean {
  return /^mutation_[A-Za-z0-9_]+$/u.test(mutationId);
}

function reconciliationRequired(record: WorkspaceMutationRecord, reason: string): WorkspaceMutationRecord {
  return { ...record, status: "reconciliation_required", errorCode: "reconciliation-required", reason };
}

async function atomicWriteFile(absolutePath: string, content: string, existingMode: number | undefined, temporaryPathOverride?: string): Promise<void> {
  const temporaryPath = temporaryPathOverride ?? `${absolutePath}.computer-native-${randomUUID()}.tmp`;
  const mode = existingMode ?? 0o600;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw new WorkspaceAccessError(`Workspace file '${absolutePath}' could not be committed atomically.`, { cause: error });
  }
}

async function atomicCreateFile(absolutePath: string, content: Uint8Array, mode: number): Promise<void> {
  const temporaryPath = `${absolutePath}.computer-native-${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Linking the staged inode into place is atomic and refuses an existing destination.
    await link(temporaryPath, absolutePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw new WorkspaceAccessError(`Workspace file '${absolutePath}' could not be created atomically.`, { cause: error });
  }
  // The destination link is already committed; cleanup failure must not report a false
  // failure that would encourage a retry over an existing destination.
  await unlink(temporaryPath).catch(() => undefined);
}

/**
 * Read from an already opened descriptor without allowing a growing file to
 * bypass the caller's byte limit. One extra byte is probed so callers can
 * distinguish an exact-bound read from an over-limit read.
 */
async function readHandleAtMost(handle: Awaited<ReturnType<typeof open>>, maxBytes: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const readSize = Math.min(BOUNDED_READ_CHUNK_BYTES, Math.max(1, maxBytes - totalBytes + 1));
    const chunk = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) return Buffer.concat(chunks, totalBytes);
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) return undefined;
    chunks.push(chunk.subarray(0, bytesRead));
  }
}

async function hashHandleAtMost(handle: Awaited<ReturnType<typeof open>>, maxBytes: number): Promise<{ readonly bytes: number; readonly hash: string } | undefined> {
  const hash = createHash("sha256");
  let totalBytes = 0;
  while (true) {
    const readSize = Math.min(BOUNDED_READ_CHUNK_BYTES, Math.max(1, maxBytes - totalBytes + 1));
    const chunk = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) return { bytes: totalBytes, hash: hash.digest("hex") };
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) return undefined;
    hash.update(chunk.subarray(0, bytesRead));
  }
}

/**
 * Stream a prepared regular-file copy into a same-directory temporary inode.
 * The source is hashed while it is copied, so the approved source identity is
 * checked without retaining a second full file buffer at commit time.
 */
async function atomicCopyFile(
  sourceAbsolutePath: string,
  destinationAbsolutePath: string,
  sourceDisplayPath: string,
  expectedHash: string,
  expectedBytes: number,
  maxBytes: number,
  mode: number,
): Promise<number> {
  const temporaryPath = `${destinationAbsolutePath}.computer-native-${randomUUID()}.tmp`;
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      sourceHandle = await open(sourceAbsolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new MutationError("mutation-stale", `Workspace copy source '${sourceDisplayPath}' could not be opened safely.`, { cause: error });
    }
    const sourceStats = await sourceHandle.stat();
    if (!sourceStats.isFile() || sourceStats.size !== expectedBytes) {
      throw new MutationError("mutation-stale", `Workspace copy source '${sourceDisplayPath}' changed before it could be copied.`);
    }
    if (sourceStats.size > maxBytes) {
      throw new WorkspaceAccessError(`Workspace file '${sourceDisplayPath}' is ${sourceStats.size} bytes; the limit is ${maxBytes} bytes.`);
    }
    destinationHandle = await open(temporaryPath, "wx", mode);
    const hash = createHash("sha256");
    let totalBytes = 0;
    while (true) {
      const readSize = Math.min(BOUNDED_READ_CHUNK_BYTES, Math.max(1, maxBytes - totalBytes + 1));
      const chunk = Buffer.alloc(readSize);
      const { bytesRead } = await sourceHandle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new WorkspaceAccessError(`Workspace file '${sourceDisplayPath}' grew beyond the ${maxBytes}-byte limit while it was being copied.`);
      }
      const content = chunk.subarray(0, bytesRead);
      hash.update(content);
      await destinationHandle.writeFile(content);
    }
    const afterStats = await sourceHandle.stat();
    if (!afterStats.isFile() || afterStats.size !== expectedBytes || totalBytes !== expectedBytes || hash.digest("hex") !== expectedHash) {
      throw new MutationError("mutation-stale", `Workspace copy source '${sourceDisplayPath}' changed while it was being copied.`);
    }
    await destinationHandle.chmod(mode);
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = undefined;
    await link(temporaryPath, destinationAbsolutePath);
  } catch (error) {
    if (!(error instanceof MutationError) && !(error instanceof WorkspaceAccessError)) {
      throw new MutationError("mutation-failed", `Workspace file '${sourceDisplayPath}' could not be copied safely.`, { cause: error });
    }
    throw error;
  } finally {
    await sourceHandle?.close().catch(() => undefined);
    await destinationHandle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
  return expectedBytes;
}

export class Workspace {
  constructor(
    readonly policy: WorkspaceSecurityPolicy,
    private readonly atomicWriter: AtomicWorkspaceWriter = atomicWriteFile,
  ) {}

  static async open(root: string, limits: WorkspaceLimits, options: WorkspaceOpenOptions = {}): Promise<Workspace> {
    const policy = new WorkspaceSecurityPolicy(root, limits);
    await policy.initialize();
    return new Workspace(policy, options.atomicWriter);
  }

  private treeLimit(name: "maxTreeEntries" | "maxTreeBytes" | "maxTreeDepth"): number {
    const configured = this.policy.limits[name];
    if (configured !== undefined) return configured;
    if (name === "maxTreeEntries") return DEFAULT_MAX_TREE_ENTRIES;
    if (name === "maxTreeBytes") return DEFAULT_MAX_TREE_BYTES;
    return DEFAULT_MAX_TREE_DEPTH;
  }

  private async assertDirectoryCreationBounds(relativePath: string, absolutePath: string): Promise<void> {
    const depth = relativePath === "." ? 0 : relativePath.split(path.sep).filter((part) => part.length > 0 && part !== ".").length;
    const maxDepth = this.treeLimit("maxTreeDepth");
    if (depth > maxDepth) throw new WorkspaceAccessError(`Workspace directory '${relativePath}' exceeds the ${maxDepth}-level depth limit.`);
    const parentEntries = await readdir(path.dirname(absolutePath)).catch((error) => {
      throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' cannot be inspected for directory-entry limits.`, { cause: error });
    });
    if (parentEntries.length >= this.policy.limits.maxDirectoryEntries) {
      throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' already has the ${this.policy.limits.maxDirectoryEntries}-entry limit.`);
    }
  }

  private async scanDirectoryTree(absolutePath: string, displayPath: string): Promise<{
    readonly entries: readonly TreeManifestEntry[];
    readonly entryCount: number;
    readonly totalBytes: number;
    readonly maxDepth: number;
    readonly manifestHash: string;
    readonly mode: number;
  }> {
    const entries: TreeManifestEntry[] = [];
    let totalBytes = 0;
    let maxDepth = 0;
    const maxEntries = this.treeLimit("maxTreeEntries");
    const maxBytes = this.treeLimit("maxTreeBytes");
    const maxDepthLimit = this.treeLimit("maxTreeDepth");
    const addEntry = (entry: TreeManifestEntry): void => {
      entries.push(entry);
      if (entries.length > maxEntries) {
        throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' exceeds the ${maxEntries}-entry limit.`);
      }
    };
    const visit = async (currentAbsolutePath: string, currentPath: string, depth: number): Promise<void> => {
      if (depth > maxDepthLimit) {
        throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' exceeds the ${maxDepthLimit}-level depth limit.`);
      }
      maxDepth = Math.max(maxDepth, depth);
      const metadata = await lstat(currentAbsolutePath).catch((error) => {
        throw new WorkspaceAccessError(`Workspace tree entry '${currentPath}' cannot be inspected safely.`, { cause: error });
      });
      if (metadata.isSymbolicLink()) throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' contains a symbolic link at '${currentPath}'.`);
      if (metadata.isDirectory()) {
        addEntry({ path: currentPath, kind: "directory", bytes: 0, mode: metadata.mode & 0o7777 });
        const children = (await readdir(currentAbsolutePath, { withFileTypes: true }).catch((error) => {
          throw new WorkspaceAccessError(`Workspace directory tree '${currentPath}' cannot be inspected safely.`, { cause: error });
        })).sort((left, right) => left.name.localeCompare(right.name));
        for (const child of children) {
          if (child.name === WORKSPACE_QUARANTINE_DIRECTORY || child.name === WORKSPACE_TRANSACTION_DIRECTORY) {
            throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' contains a reserved internal entry '${child.name}'.`);
          }
          await visit(path.join(currentAbsolutePath, child.name), currentPath === "." ? child.name : path.join(currentPath, child.name), depth + 1);
        }
        return;
      }
      if (!metadata.isFile()) throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' contains an unsupported filesystem entry at '${currentPath}'.`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(currentAbsolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const fileStats = await handle.stat();
        if (!fileStats.isFile()) throw new WorkspaceAccessError(`Workspace tree file '${currentPath}' changed while it was being inspected.`);
        const remainingBytes = maxBytes - totalBytes;
        if (fileStats.size > remainingBytes) {
          throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' exceeds the ${maxBytes}-byte limit.`);
        }
        const observation = await hashHandleAtMost(handle, remainingBytes);
        if (!observation || observation.bytes !== fileStats.size) {
          throw new WorkspaceAccessError(`Workspace tree file '${currentPath}' changed while it was being inspected.`);
        }
        const after = await handle.stat();
        if (!after.isFile() || after.size !== fileStats.size) {
          throw new WorkspaceAccessError(`Workspace tree file '${currentPath}' changed while it was being inspected.`);
        }
        totalBytes += observation.bytes;
        addEntry({ path: currentPath, kind: "file", bytes: observation.bytes, mode: fileStats.mode & 0o7777, hash: observation.hash });
      } catch (error) {
        if (error instanceof WorkspaceAccessError) throw error;
        throw new WorkspaceAccessError(`Workspace tree file '${currentPath}' cannot be read for its manifest.`, { cause: error });
      } finally {
        await handle?.close().catch(() => undefined);
      }
      if (totalBytes > maxBytes) {
        throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' exceeds the ${maxBytes}-byte limit.`);
      }
    };
    const rootMetadata = await lstat(absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' cannot be inspected safely.`, { cause: error });
    });
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new WorkspaceAccessError(`Workspace directory tree '${displayPath}' must be a regular directory.`);
    await visit(absolutePath, ".", 0);
    return {
      entries,
      entryCount: entries.length,
      totalBytes,
      maxDepth,
      manifestHash: contentHash(JSON.stringify(entries)),
      mode: rootMetadata.mode & 0o7777,
    };
  }

  async listDirectory(relativePath = "."): Promise<WorkspaceDirectoryListing> {
    const resolved = await this.policy.resolve(relativePath);
    const directoryStats = await stat(resolved.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' cannot be inspected.`, { cause: error });
    });
    if (!directoryStats.isDirectory()) throw new WorkspaceAccessError(`Workspace path '${relativePath}' is not a directory.`);
    const allEntries = (await readdir(resolved.absolutePath, { withFileTypes: true }).catch((error) => {
      throw new WorkspaceAccessError(`Workspace directory '${relativePath}' cannot be listed.`, { cause: error });
    }))
      .filter((entry) => entry.name !== WORKSPACE_QUARANTINE_DIRECTORY && entry.name !== WORKSPACE_TRANSACTION_DIRECTORY)
      .sort((left, right) => left.name.localeCompare(right.name));
    const entries = allEntries.slice(0, this.policy.limits.maxDirectoryEntries);
    const output: WorkspaceDirectoryEntry[] = [];
    for (const entry of entries) {
      const item: WorkspaceDirectoryEntry = { name: entry.name, kind: entryKind(entry) };
      if (entry.isFile()) {
        const entryPath = await this.policy.resolve(`${resolved.relativePath}/${entry.name}`);
        const entryStats = await stat(entryPath.absolutePath).catch((error) => {
          throw new WorkspaceAccessError(`Workspace entry '${entry.name}' cannot be inspected.`, { cause: error });
        });
        output.push({ ...item, sizeBytes: entryStats.size });
      } else {
        output.push(item);
      }
    }
    return {
      path: resolved.relativePath,
      entries: output,
      truncated: allEntries.length > this.policy.limits.maxDirectoryEntries,
    };
  }

  async readFile(relativePath: string): Promise<WorkspaceFile> {
    const resolved = await this.policy.resolve(relativePath);
    const bytes = await this.readMutationBytes(resolved.absolutePath, relativePath);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' is not valid UTF-8 text.`, { cause: error });
    }
    return { path: resolved.relativePath, sizeBytes: bytes.byteLength, content };
  }

  async stat(relativePath = "."): Promise<WorkspaceMetadata> {
    const resolved = await this.policy.resolveMetadata(relativePath);
    const metadata = await lstat(resolved.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' cannot be inspected.`, { cause: error });
    });
    return {
      path: resolved.relativePath,
      kind: entryKind(metadata),
      sizeBytes: metadata.size,
      mode: metadata.mode & 0o7777,
      modifiedAt: metadata.mtime.toISOString(),
      accessedAt: metadata.atime.toISOString(),
      createdAt: metadata.birthtime.toISOString(),
      changedAt: metadata.ctime.toISOString(),
      linkCount: metadata.nlink,
    };
  }

  async searchFiles(
    relativePath = ".",
    query: string,
    maxMatches = DEFAULT_SEARCH_MAX_MATCHES,
    signal?: AbortSignal,
    namePattern?: string,
  ): Promise<WorkspaceSearchResult> {
    if (typeof query !== "string") throw new WorkspaceAccessError("The search query must be a string.");
    if (typeof namePattern !== "undefined" && typeof namePattern !== "string") throw new WorkspaceAccessError("The name pattern must be a string.");
    if (query.length === 0 && !namePattern) throw new WorkspaceAccessError("A non-empty query or a name pattern is required.");
    if (query.length > 0 && Buffer.byteLength(query, "utf8") > MAX_SEARCH_QUERY_BYTES) {
      throw new WorkspaceAccessError(`The search query is larger than the ${MAX_SEARCH_QUERY_BYTES}-byte limit.`);
    }
    const matchesName = namePattern ? namePatternMatcher(namePattern) : undefined;
    if (!Number.isInteger(maxMatches) || maxMatches <= 0 || maxMatches > MAX_SEARCH_MATCHES) {
      throw new WorkspaceAccessError(`maxMatches must be an integer between 1 and ${MAX_SEARCH_MATCHES}.`);
    }
    const resolved = await this.policy.resolveMetadata(relativePath);
    const rootStats = await lstat(resolved.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace search path '${relativePath}' cannot be inspected.`, { cause: error });
    });
    if (rootStats.isSymbolicLink()) throw new WorkspaceAccessError(`Workspace search path '${relativePath}' is a symbolic link; search its target explicitly inside the workspace.`);
    if (excludedSearchPath(resolved.relativePath)) {
      throw new WorkspaceAccessError(`Workspace search path '${relativePath}' is hidden or sensitive and is not searched.`);
    }

    const matches: WorkspaceSearchMatch[] = [];
    const nameMatches: string[] = [];
    let truncated = false;
    let filesScanned = 0;
    const resultCount = (): number => matches.length + nameMatches.length;
    const throwIfCancelled = (): void => {
      if (signal?.aborted) throw new WorkspaceAccessError("Workspace search was cancelled.");
    };
    const visit = async (absolutePath: string, currentPath: string): Promise<void> => {
      throwIfCancelled();
      if (resultCount() >= maxMatches) {
        truncated = true;
        return;
      }
      const metadata = await lstat(absolutePath).catch((error) => {
        throw new WorkspaceAccessError(`Workspace search path '${currentPath}' cannot be inspected.`, { cause: error });
      });
      if (metadata.isSymbolicLink() || excludedSearchPath(currentPath)) return;
      if (matchesName && currentPath !== "." && matchesName(currentPath)) {
        nameMatches.push(currentPath);
        if (resultCount() >= maxMatches) {
          truncated = true;
          return;
        }
      }
      if (metadata.isFile()) {
        if (query.length === 0) return;
        if (filesScanned >= MAX_SEARCH_FILES) {
          truncated = true;
          return;
        }
        filesScanned += 1;
        const content = await this.readSearchFile(absolutePath, currentPath, signal);
        if (content === undefined) return;
        const lines = content.split(/\r?\n/u);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex]!;
          let offset = 0;
          while ((offset = line.indexOf(query, offset)) >= 0) {
            matches.push({ path: currentPath, line: lineIndex + 1, column: offset + 1, text: boundedSearchLine(line) });
            if (resultCount() >= maxMatches) {
              truncated = true;
              return;
            }
            offset += Math.max(1, query.length);
          }
          throwIfCancelled();
        }
        return;
      }
      if (!metadata.isDirectory()) return;
      const entries = (await readdir(absolutePath, { withFileTypes: true }).catch((error) => {
        throw new WorkspaceAccessError(`Workspace directory '${currentPath}' cannot be searched.`, { cause: error });
      })).sort((left, right) => left.name.localeCompare(right.name));
      const boundedEntries = entries.slice(0, this.policy.limits.maxDirectoryEntries);
      if (entries.length > boundedEntries.length) truncated = true;
      for (const entry of boundedEntries) {
        if (excludedSearchName(entry.name)) continue;
        const childPath = currentPath === "." ? entry.name : path.join(currentPath, entry.name);
        await visit(path.join(absolutePath, entry.name), childPath);
        if (resultCount() >= maxMatches) return;
      }
    };

    await visit(resolved.absolutePath, resolved.relativePath);
    return { path: resolved.relativePath, query, ...(namePattern ? { namePattern } : {}), matches, nameMatches, truncated, filesScanned };
  }

  async listQuarantine(maxEntries = MAX_QUARANTINE_ENTRIES): Promise<QuarantineListing> {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_QUARANTINE_ENTRIES) {
      throw new WorkspaceAccessError(`The quarantine entry limit must be an integer between 1 and ${MAX_QUARANTINE_ENTRIES}.`);
    }
    const root = await this.policy.resolve(".");
    const quarantineRoot = path.join(root.absolutePath, WORKSPACE_QUARANTINE_DIRECTORY);
    let rootStats;
    try {
      rootStats = await lstat(quarantineRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], truncated: false };
      throw new WorkspaceAccessError("The workspace quarantine area could not be inspected safely.", { cause: error });
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || (rootStats.mode & 0o077) !== 0) {
      throw new WorkspaceAccessError("The workspace quarantine area is not a restricted regular directory.");
    }
    const directoryEntries = (await readdir(quarantineRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    const selected = directoryEntries.slice(0, maxEntries);
    const entries: QuarantineEntry[] = [];
    for (const directoryEntry of selected) {
      if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory() || !validMutationId(directoryEntry.name)) {
        throw new WorkspaceAccessError("The workspace quarantine area contains an invalid recovery entry.");
      }
      const entryPath = path.join(quarantineRoot, directoryEntry.name);
      const entryStats = await lstat(entryPath).catch((error) => {
        throw new WorkspaceAccessError("A workspace quarantine entry could not be inspected safely.", { cause: error });
      });
      if (entryStats.isSymbolicLink() || !entryStats.isDirectory() || (entryStats.mode & 0o077) !== 0) {
        throw new WorkspaceAccessError("A workspace quarantine entry is not a restricted regular directory.");
      }
      const manifest = await this.readQuarantineManifest(directoryEntry.name);
      const payloadPath = path.join(entryPath, "payload");
      const kind = manifest.kind ?? "file";
      const payloadAvailable = await lstat(payloadPath).then((metadata) => {
        if (metadata.isSymbolicLink()) throw new WorkspaceAccessError("A workspace quarantine payload is a symbolic link.");
        if (kind === "file" && !metadata.isFile()) throw new WorkspaceAccessError("A file quarantine payload is not a regular file.");
        if (kind === "directory" && !metadata.isDirectory()) throw new WorkspaceAccessError("A directory quarantine payload is not a regular directory.");
        return true;
      }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        if (error instanceof WorkspaceAccessError) throw error;
        throw new WorkspaceAccessError("A workspace quarantine payload could not be inspected safely.", { cause: error });
      });
      entries.push({
        mutationId: manifest.mutationId,
        originalPath: manifest.originalPath,
        kind,
        beforeHash: manifest.beforeHash,
        bytes: manifest.bytes,
        mode: manifest.mode,
        createdAt: manifest.createdAt,
        ...(manifest.entryCount !== undefined ? { entryCount: manifest.entryCount } : {}),
        ...(manifest.maxDepth !== undefined ? { maxDepth: manifest.maxDepth } : {}),
        ...(manifest.manifestHash ? { manifestHash: manifest.manifestHash } : {}),
        payloadAvailable,
      });
    }
    return { entries, truncated: directoryEntries.length > selected.length };
  }

  async prepareWrite(relativePath: string, content: string): Promise<PreparedPatch> {
    const target = await this.policy.resolveMutationTarget(relativePath);
    if (target.exists && target.kind !== "file") {
      throw new WorkspaceAccessError(`Workspace mutation target '${relativePath}' is not a regular file.`);
    }
    if (Buffer.byteLength(content, "utf8") > this.policy.limits.maxFileBytes) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' would exceed the ${this.policy.limits.maxFileBytes}-byte limit.`);
    }
    const existingContent = target.exists ? await this.readMutationContent(target.absolutePath, relativePath) : "";
    return prepareFileWrite(target.relativePath, existingContent, content);
  }

  async prepareDirectory(relativePath: string): Promise<PreparedDirectoryCreation> {
    const target = await this.policy.resolveMutationTarget(relativePath);
    if (target.exists && target.kind !== "directory") {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' already exists and is not a directory.`);
    }
    if (!target.exists) await this.assertDirectoryCreationBounds(target.relativePath, target.absolutePath);
    return {
      operation: "mkdir",
      path: target.relativePath,
      preview: target.exists
        ? `Directory already exists: ${target.relativePath}`
        : `Create directory: ${target.relativePath}/\nParent directory already exists; no recursive parent creation is planned.`,
      alreadyExists: target.exists,
    };
  }

  async commitDirectory(prepared: PreparedDirectoryCreation): Promise<DirectoryCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (target.exists) {
      if (target.kind === "directory") return { path: prepared.path, created: false };
      throw new MutationError("mutation-stale", `Workspace path '${prepared.path}' appeared and is not a directory.`);
    }
    try {
      await this.assertDirectoryCreationBounds(prepared.path, target.absolutePath);
    } catch (error) {
      if (error instanceof WorkspaceAccessError) throw new MutationError("mutation-stale", error.message, { cause: error });
      throw error;
    }
    try {
      await mkdir(target.absolutePath);
    } catch (error) {
      throw new MutationError("mutation-failed", `Workspace directory '${prepared.path}' could not be created.`, { cause: error });
    }
    return { path: prepared.path, created: true };
  }

  async prepareDirectoryDeletion(relativePath: string): Promise<PreparedDirectoryDeletion> {
    const target = await this.policy.resolveMutationTarget(relativePath);
    if (target.relativePath === ".") throw new WorkspaceAccessError("The workspace root cannot be deleted.");
    if (!target.exists || target.kind !== "directory") {
      throw new WorkspaceAccessError(`Workspace directory deletion target '${relativePath}' must be an existing directory.`);
    }
    const entries = await readdir(target.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace directory '${relativePath}' cannot be inspected for safe deletion.`, { cause: error });
    });
    if (entries.length > 0) {
      throw new WorkspaceAccessError(`Workspace directory '${relativePath}' is not empty; recursive directory deletion is not supported.`);
    }
    return {
      operation: "delete-directory",
      path: target.relativePath,
      preview: `Delete empty directory: ${target.relativePath}/\nRecursive deletion is not performed; the directory must remain empty until approval is committed.`,
    };
  }

  async commitDirectoryDeletion(prepared: PreparedDirectoryDeletion): Promise<DirectoryDeletionCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (!target.exists || target.kind !== "directory") {
      throw new MutationError("mutation-stale", `Workspace directory '${prepared.path}' changed before deletion.`);
    }
    const entries = await readdir(target.absolutePath).catch((error) => {
      throw new MutationError("mutation-failed", `Workspace directory '${prepared.path}' could not be inspected for safe deletion.`, { cause: error });
    });
    if (entries.length > 0) {
      throw new MutationError("mutation-stale", `Workspace directory '${prepared.path}' is no longer empty; refusing recursive deletion.`);
    }
    try {
      await rmdir(target.absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY" || (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new MutationError("mutation-stale", `Workspace directory '${prepared.path}' is no longer empty; refusing recursive deletion.`, { cause: error });
      }
      throw new MutationError("mutation-failed", `Workspace directory '${prepared.path}' could not be deleted.`, { cause: error });
    }
    return { path: prepared.path, removed: true };
  }

  async prepareDirectoryTreeDeletion(relativePath: string, mutationId: string): Promise<PreparedDirectoryTreeDeletion> {
    if (!validMutationId(mutationId)) throw new WorkspaceAccessError("The deletion recovery token is invalid.");
    const target = await this.policy.resolveMutationTarget(relativePath);
    if (target.relativePath === ".") throw new WorkspaceAccessError("The workspace root cannot be deleted.");
    if (!target.exists || target.kind !== "directory") {
      throw new WorkspaceAccessError(`Workspace directory tree deletion target '${relativePath}' must be an existing directory.`);
    }
    const scanned = await this.scanDirectoryTree(target.absolutePath, target.relativePath);
    const quarantinePath = path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId, "payload");
    return {
      operation: "delete-directory-tree",
      path: target.relativePath,
      preview: `Delete bounded directory tree: ${target.relativePath}/\nEntries: ${scanned.entryCount} · bytes: ${scanned.totalBytes} · depth: ${scanned.maxDepth}\nManifest hash: ${scanned.manifestHash}\nThe tree will be moved into workspace quarantine and can be restored with token ${mutationId}.`,
      mutationId,
      quarantinePath,
      manifestHash: scanned.manifestHash,
      entryCount: scanned.entryCount,
      totalBytes: scanned.totalBytes,
      maxDepth: scanned.maxDepth,
      mode: scanned.mode,
    };
  }

  async commitDirectoryTreeDeletion(prepared: PreparedDirectoryTreeDeletion): Promise<DirectoryTreeDeletionCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (!target.exists || target.kind !== "directory") throw new MutationError("mutation-stale", `Workspace directory tree '${prepared.path}' changed before quarantine.`);
    const scanned = await this.scanDirectoryTree(target.absolutePath, target.relativePath);
    if (scanned.manifestHash !== prepared.manifestHash) {
      throw new MutationError("mutation-stale", `Workspace directory tree '${prepared.path}' changed after the deletion proposal was prepared; refusing to quarantine it.`);
    }
    const quarantine = await this.createQuarantineEntry(prepared.mutationId);
    const manifest: QuarantineManifest = {
      schemaVersion: 1,
      mutationId: prepared.mutationId,
      originalPath: prepared.path,
      kind: "directory",
      bytes: prepared.totalBytes,
      mode: prepared.mode,
      createdAt: new Date().toISOString(),
      entryCount: prepared.entryCount,
      maxDepth: prepared.maxDepth,
      manifestHash: prepared.manifestHash,
      entries: scanned.entries,
    };
    try {
      await atomicWriteFile(quarantine.manifestPath, `${JSON.stringify(manifest)}\n`, 0o600);
      await rename(target.absolutePath, quarantine.payloadPath);
    } catch (error) {
      await unlink(quarantine.manifestPath).catch(() => undefined);
      const payloadExists = await lstat(quarantine.payloadPath).then(() => true).catch(() => false);
      if (!payloadExists) await rmdir(quarantine.directoryPath).catch(() => undefined);
      throw new MutationError("mutation-failed", `Workspace directory tree '${prepared.path}' could not be quarantined safely.`, { cause: error });
    }
    return { path: prepared.path, quarantinePath: prepared.quarantinePath, bytes: prepared.totalBytes, entryCount: prepared.entryCount };
  }

  async prepareDirectoryRestore(mutationId: string): Promise<PreparedDirectoryRestore> {
    const manifest = await this.readQuarantineManifest(mutationId);
    if ((manifest.kind ?? "file") !== "directory" || !manifest.manifestHash || !manifest.entries || manifest.entryCount === undefined || manifest.maxDepth === undefined) {
      throw new WorkspaceAccessError(`Recovery token '${mutationId}' does not refer to a quarantined directory tree.`);
    }
    const target = await this.policy.resolveMutationTarget(manifest.originalPath);
    if (target.exists) throw new WorkspaceAccessError(`Workspace restore target '${manifest.originalPath}' already exists; refusing to overwrite it.`);
    const payloadPath = await this.quarantineAbsolutePath(mutationId, "payload");
    const scanned = await this.scanDirectoryTree(payloadPath, `${WORKSPACE_QUARANTINE_DIRECTORY}/${mutationId}/payload`);
    if (scanned.manifestHash !== manifest.manifestHash || scanned.entryCount !== manifest.entryCount || scanned.totalBytes !== manifest.bytes) {
      throw new WorkspaceAccessError(`Quarantined directory tree '${mutationId}' failed its recorded manifest check.`);
    }
    return {
      operation: "restore-directory",
      path: target.relativePath,
      preview: `Restore directory tree: ${target.relativePath}/\nEntries: ${manifest.entryCount} · bytes: ${manifest.bytes} · depth: ${manifest.maxDepth}\nThe quarantined tree for token ${mutationId} will be restored without overwriting an existing path.`,
      sourceMutationId: mutationId,
      quarantinePath: path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId, "payload"),
      manifestHash: manifest.manifestHash,
      entryCount: manifest.entryCount,
      totalBytes: manifest.bytes,
      maxDepth: manifest.maxDepth,
    };
  }

  async commitDirectoryRestore(prepared: PreparedDirectoryRestore): Promise<DirectoryRestoreCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (target.exists) throw new MutationError("mutation-stale", `Workspace restore target '${prepared.path}' appeared before restore; refusing to overwrite it.`);
    const payloadPath = await this.quarantineAbsolutePath(prepared.sourceMutationId, "payload");
    const scanned = await this.scanDirectoryTree(payloadPath, prepared.quarantinePath);
    if (scanned.manifestHash !== prepared.manifestHash || scanned.entryCount !== prepared.entryCount || scanned.totalBytes !== prepared.totalBytes) {
      throw new MutationError("mutation-stale", `Quarantined directory tree '${prepared.sourceMutationId}' changed before restore; refusing to restore it.`);
    }
    try {
      await rename(payloadPath, target.absolutePath);
    } catch (error) {
      throw new MutationError("mutation-failed", `Workspace directory tree '${prepared.path}' could not be restored safely.`, { cause: error });
    }
    await unlink(path.join(path.dirname(payloadPath), "manifest.json")).catch(() => undefined);
    await rmdir(path.dirname(payloadPath)).catch(() => undefined);
    return { path: prepared.path, sourceMutationId: prepared.sourceMutationId, bytes: prepared.totalBytes, entryCount: prepared.entryCount };
  }

  async prepareQuarantinePurge(mutationId: string): Promise<PreparedQuarantinePurge> {
    const manifest = await this.readQuarantineManifest(mutationId);
    const kind = manifest.kind ?? "file";
    const quarantinePath = path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId, "payload");
    return {
      operation: "purge-quarantine",
      path: path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId),
      preview: `Permanently purge ${kind} quarantine entry ${mutationId} for original path ${manifest.originalPath}.\nThis is irreversible and requires explicit approval.`,
      sourceMutationId: mutationId,
      quarantinePath,
      kind,
      bytes: manifest.bytes,
    };
  }

  async commitQuarantinePurge(prepared: PreparedQuarantinePurge): Promise<QuarantinePurgeCommit> {
    const manifest = await this.readQuarantineManifest(prepared.sourceMutationId);
    const kind = manifest.kind ?? "file";
    if (kind !== prepared.kind) throw new MutationError("mutation-stale", `Quarantine entry '${prepared.sourceMutationId}' changed before purge.`);
    const entryDirectory = path.dirname(await this.quarantineAbsolutePath(prepared.sourceMutationId, "payload"));
    const entryMetadata = await lstat(entryDirectory).catch((error) => {
      throw new MutationError("mutation-stale", `Quarantine entry '${prepared.sourceMutationId}' is no longer available.`, { cause: error });
    });
    if (entryMetadata.isSymbolicLink() || !entryMetadata.isDirectory() || (entryMetadata.mode & 0o077) !== 0) {
      throw new MutationError("mutation-stale", `Quarantine entry '${prepared.sourceMutationId}' is not a restricted directory.`);
    }
    let started = false;
    try {
      const payloadPath = await this.quarantineAbsolutePath(prepared.sourceMutationId, "payload");
      const payloadExists = await lstat(payloadPath).then((metadata) => {
        if (metadata.isSymbolicLink()) throw new WorkspaceAccessError("A workspace quarantine payload is a symbolic link.");
        if (kind === "file" && !metadata.isFile()) throw new WorkspaceAccessError("A file quarantine payload is not a regular file.");
        if (kind === "directory" && !metadata.isDirectory()) throw new WorkspaceAccessError("A directory quarantine payload is not a regular directory.");
        return true;
      }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      });
      if (payloadExists) {
        started = true;
        await this.removeTreeNoFollow(payloadPath);
      }
      started = true;
      await unlink(path.join(entryDirectory, "manifest.json"));
      await rmdir(entryDirectory);
    } catch (error) {
      throw new MutationError(started ? "reconciliation-required" : "mutation-failed", `Quarantine entry '${prepared.sourceMutationId}' could not be purged completely; inspect the quarantine entry before retrying.`, { cause: error });
    }
    return { sourceMutationId: prepared.sourceMutationId, kind, bytes: manifest.bytes };
  }

  async prepareDelete(relativePath: string, mutationId: string): Promise<PreparedFileDeletion> {
    if (!validMutationId(mutationId)) throw new WorkspaceAccessError("The deletion recovery token is invalid.");
    const target = await this.policy.resolveMutationTarget(relativePath);
    if (!target.exists || target.kind !== "file") {
      throw new WorkspaceAccessError(`Workspace deletion target '${relativePath}' must be an existing regular file.`);
    }
    const observation = await this.readMutationHash(target.absolutePath, relativePath);
    const quarantinePath = path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId, "payload");
    return {
      operation: "delete",
      path: target.relativePath,
      preview: `Delete file: ${target.relativePath}\nThe file will be moved to workspace quarantine and can be restored with token ${mutationId}.`,
      beforeHash: observation.hash,
      bytes: observation.bytes,
      mode: target.mode ?? 0o600,
      mutationId,
      quarantinePath,
    };
  }

  async commitDelete(prepared: PreparedFileDeletion): Promise<FileQuarantineCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (!target.exists || target.kind !== "file") {
      throw new MutationError("mutation-stale", `Workspace deletion target '${prepared.path}' changed before quarantine.`);
    }
    const current = await this.readMutationHash(target.absolutePath, prepared.path);
    if (current.hash !== prepared.beforeHash) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.path}' changed after the deletion proposal was prepared; refusing to quarantine it.`);
    }
    const quarantine = await this.createQuarantineEntry(prepared.mutationId);
    const manifest: QuarantineManifest = {
      schemaVersion: 1,
      mutationId: prepared.mutationId,
      originalPath: prepared.path,
      beforeHash: prepared.beforeHash,
      bytes: prepared.bytes,
      mode: prepared.mode,
      createdAt: new Date().toISOString(),
    };
    try {
      await atomicWriteFile(quarantine.manifestPath, `${JSON.stringify(manifest)}\n`, 0o600);
      await rename(target.absolutePath, quarantine.payloadPath);
    } catch (error) {
      await unlink(quarantine.manifestPath).catch(() => undefined);
      await unlink(quarantine.payloadPath).catch(() => undefined);
      await rmdir(quarantine.directoryPath).catch(() => undefined);
      throw new MutationError("mutation-failed", `Workspace file '${prepared.path}' could not be quarantined safely.`, { cause: error });
    }
    return { path: prepared.path, quarantinePath: prepared.quarantinePath, bytes: prepared.bytes };
  }

  async prepareRestore(mutationId: string): Promise<PreparedFileRestore> {
    const manifest = await this.readQuarantineManifest(mutationId);
    if ((manifest.kind ?? "file") !== "file" || !manifest.beforeHash) {
      throw new WorkspaceAccessError(`Recovery token '${mutationId}' does not refer to a quarantined regular file.`);
    }
    const target = await this.policy.resolveMutationTarget(manifest.originalPath);
    if (target.exists) throw new WorkspaceAccessError(`Workspace restore target '${manifest.originalPath}' already exists; refusing to overwrite it.`);
    const quarantinePath = path.join(WORKSPACE_QUARANTINE_DIRECTORY, mutationId, "payload");
    const payload = await this.readMutationHash(await this.quarantineAbsolutePath(mutationId, "payload"), quarantinePath);
    if (payload.hash !== manifest.beforeHash) {
      throw new WorkspaceAccessError(`Quarantined file '${mutationId}' failed its recorded hash check.`);
    }
    return {
      operation: "restore",
      path: target.relativePath,
      preview: `Restore file: ${target.relativePath}\nThe quarantined file for token ${mutationId} will be restored without overwriting an existing path.`,
      beforeHash: manifest.beforeHash,
      bytes: payload.bytes,
      mode: manifest.mode,
      sourceMutationId: mutationId,
      quarantinePath,
    };
  }

  async commitRestore(prepared: PreparedFileRestore): Promise<FileRestoreCommit> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (target.exists) throw new MutationError("mutation-stale", `Workspace restore target '${prepared.path}' appeared before restore; refusing to overwrite it.`);
    const payloadPath = await this.quarantineAbsolutePath(prepared.sourceMutationId, "payload");
    const payload = await this.readMutationHash(payloadPath, prepared.quarantinePath);
    if (payload.hash !== prepared.beforeHash) {
      throw new MutationError("mutation-stale", `Quarantined file '${prepared.sourceMutationId}' changed before restore; refusing to restore it.`);
    }
    const quarantineDirectory = path.dirname(payloadPath);
    try {
      await rename(payloadPath, target.absolutePath);
    } catch (error) {
      throw new MutationError("mutation-failed", `Workspace file '${prepared.path}' could not be restored safely.`, { cause: error });
    }
    await unlink(path.join(quarantineDirectory, "manifest.json")).catch(() => undefined);
    await rmdir(quarantineDirectory).catch(() => undefined);
    return { path: prepared.path, sourceMutationId: prepared.sourceMutationId, bytes: prepared.bytes };
  }

  async prepareCopy(sourcePath: string, destinationPath: string): Promise<PreparedFileCopy> {
    return this.prepareFileTransfer("copy", sourcePath, destinationPath);
  }

  async prepareMove(sourcePath: string, destinationPath: string): Promise<PreparedFileMove> {
    return this.prepareFileTransfer("move", sourcePath, destinationPath);
  }

  async prepareRename(sourcePath: string, destinationPath: string): Promise<PreparedRename> {
    return this.prepareFileTransfer("rename", sourcePath, destinationPath);
  }

  async commitCopy(prepared: PreparedFileCopy): Promise<FileTransferCommit> {
    const source = await this.policy.resolveMutationTarget(prepared.sourcePath);
    const destination = await this.policy.resolveMutationTarget(prepared.path);
    if (!source.exists || source.kind !== prepared.kind) throw new MutationError("mutation-stale", `Workspace copy source '${prepared.sourcePath}' changed before copy.`);
    if (destination.exists) throw new MutationError("mutation-stale", `Workspace copy destination '${prepared.path}' appeared before copy.`);
    if (prepared.kind === "directory") {
      const scanned = await this.scanDirectoryTree(source.absolutePath, source.relativePath);
      if (scanned.manifestHash !== prepared.beforeHash) {
        throw new MutationError("mutation-stale", `Workspace directory '${prepared.sourcePath}' changed after the copy proposal was prepared; refusing to copy it.`);
      }
      await this.copyDirectoryTree(source.absolutePath, destination.absolutePath, scanned);
      return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes: scanned.totalBytes };
    }
    const bytes = await atomicCopyFile(
      source.absolutePath,
      destination.absolutePath,
      prepared.sourcePath,
      prepared.beforeHash,
      prepared.bytes,
      this.policy.limits.maxFileBytes,
      prepared.mode,
    );
    return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes };
  }

  async commitMove(prepared: PreparedFileMove): Promise<FileTransferCommit> {
    const source = await this.policy.resolveMutationTarget(prepared.sourcePath);
    const destination = await this.policy.resolveMutationTarget(prepared.path);
    if (!source.exists || source.kind !== prepared.kind) throw new MutationError("mutation-stale", `Workspace move source '${prepared.sourcePath}' changed before move.`);
    if (destination.exists) throw new MutationError("mutation-stale", `Workspace move destination '${prepared.path}' appeared before move.`);
    if (source.device !== destination.device) throw new MutationError("mutation-stale", `Workspace move source '${prepared.sourcePath}' and destination '${prepared.path}' changed to different filesystems before move.`);
    if (prepared.kind === "directory") {
      const scanned = await this.scanDirectoryTree(source.absolutePath, source.relativePath);
      if (scanned.manifestHash !== prepared.beforeHash) {
        throw new MutationError("mutation-stale", `Workspace directory '${prepared.sourcePath}' changed after the move proposal was prepared; refusing to move it.`);
      }
      try {
        await rename(source.absolutePath, destination.absolutePath);
      } catch (error) {
        throw new MutationError("mutation-failed", `Workspace directory '${prepared.sourcePath}' could not be moved atomically.`, { cause: error });
      }
      return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes: scanned.totalBytes };
    }
    const observation = await this.readMutationHash(source.absolutePath, prepared.sourcePath);
    if (observation.hash !== prepared.beforeHash) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.sourcePath}' changed after the move proposal was prepared; refusing to move it.`);
    }
    try {
      // link() refuses an existing destination, avoiding rename()'s replacement
      // semantics. The unlink is the second half of the move and is reconciled if the
      // process stops between the two filesystem operations.
      await link(source.absolutePath, destination.absolutePath);
      await unlink(source.absolutePath);
    } catch (error) {
      throw new MutationError("mutation-failed", `Workspace file '${prepared.sourcePath}' could not be moved atomically.`, { cause: error });
    }
    return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes: observation.bytes };
  }

  async commitRename(prepared: PreparedRename): Promise<FileTransferCommit> {
    const source = await this.policy.resolveMutationTarget(prepared.sourcePath);
    const destination = await this.policy.resolveMutationTarget(prepared.path);
    if (!source.exists || source.kind !== prepared.kind) throw new MutationError("mutation-stale", `Workspace rename source '${prepared.sourcePath}' changed before rename.`);
    if (destination.exists) throw new MutationError("mutation-stale", `Workspace rename destination '${prepared.path}' appeared before rename.`);
    if (source.device !== destination.device) throw new MutationError("mutation-stale", `Workspace rename source '${prepared.sourcePath}' and destination '${prepared.path}' changed to different filesystems before rename.`);
    if (prepared.kind === "directory") {
      const scanned = await this.scanDirectoryTree(source.absolutePath, source.relativePath);
      if (scanned.manifestHash !== prepared.beforeHash) {
        throw new MutationError("mutation-stale", `Workspace directory '${prepared.sourcePath}' changed after the rename proposal was prepared; refusing to rename it.`);
      }
      try {
        await rename(source.absolutePath, destination.absolutePath);
      } catch (error) {
        throw new MutationError("mutation-failed", `Workspace directory '${prepared.sourcePath}' could not be renamed atomically.`, { cause: error });
      }
      return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes: scanned.totalBytes };
    }
    const observation = await this.readMutationHash(source.absolutePath, prepared.sourcePath);
    if (observation.hash !== prepared.beforeHash) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.sourcePath}' changed after the rename proposal was prepared; refusing to rename it.`);
    }
    try {
      await link(source.absolutePath, destination.absolutePath);
      await unlink(source.absolutePath);
    } catch (error) {
      throw new MutationError("mutation-failed", `Workspace file '${prepared.sourcePath}' could not be renamed atomically.`, { cause: error });
    }
    return { path: prepared.path, sourcePath: prepared.sourcePath, kind: prepared.kind, bytes: observation.bytes };
  }

  async preparePatchSet(patchTexts: readonly string[], mutationId: string): Promise<PreparedPatchSet> {
    if (!Array.isArray(patchTexts) || patchTexts.length < 2 || patchTexts.length > MAX_MUTATION_SET_FILES) {
      throw new WorkspaceAccessError(`A patch set must contain between 2 and ${MAX_MUTATION_SET_FILES} file patches.`);
    }
    const requestBytes = patchTexts.reduce((total, patchText) => total + Buffer.byteLength(patchText, "utf8"), 0);
    if (requestBytes > MAX_MUTATION_SET_REQUEST_BYTES) {
      throw new WorkspaceAccessError(`The patch set request is larger than the ${MAX_MUTATION_SET_REQUEST_BYTES}-byte limit.`);
    }
    const preparedPatches = await Promise.all(patchTexts.map((patchText) => this.preparePatch(patchText)));
    const sortedPatches = [...preparedPatches].sort((left, right) => left.path.localeCompare(right.path));
    const paths = sortedPatches.map((prepared) => prepared.path);
    if (new Set(paths).size !== paths.length) throw new WorkspaceAccessError("A patch set cannot contain duplicate target paths.");
    const members: MutationMember[] = sortedPatches.map((prepared) => ({
      path: prepared.path,
      operation: prepared.operation === "add" ? "add" : "update",
      beforeHash: prepared.beforeHash,
      afterHash: prepared.afterHash,
      addedLines: prepared.addedLines,
      removedLines: prepared.removedLines,
      diff: prepared.diff,
    }));
    const journalMembers: MutationJournalMember[] = members.map((member, index) => ({
      path: member.path,
      beforeHash: member.beforeHash,
      afterHash: member.afterHash,
      commitOrder: index + 1,
      state: "pending",
    }));
    const preview = [
      `Apply patch set: ${paths.length} files`,
      ...paths.map((targetPath) => `- ${targetPath}`),
      "",
      ...sortedPatches.map((prepared) => prepared.diff),
    ].join("\n");
    if (Buffer.byteLength(preview, "utf8") > MAX_MUTATION_SET_REQUEST_BYTES) {
      throw new WorkspaceAccessError(`The patch set preview is larger than the ${MAX_MUTATION_SET_REQUEST_BYTES}-byte review limit.`);
    }
    const journal: MutationJournal = {
      schemaVersion: 1,
      state: "prepared",
      transactionPath: path.join(WORKSPACE_TRANSACTION_DIRECTORY, mutationId),
      members: journalMembers,
    };
    return {
      operation: "patch-set",
      path: paths[0]!,
      paths,
      preview,
      addedLines: sortedPatches.reduce((total, prepared) => total + prepared.addedLines, 0),
      removedLines: sortedPatches.reduce((total, prepared) => total + prepared.removedLines, 0),
      patches: sortedPatches,
      members,
      journal,
    };
  }

  async commitPatchSet(prepared: PreparedPatchSet, onJournal?: (journal: MutationJournal) => Promise<void> | void, signal?: AbortSignal): Promise<PatchSetCommit> {
    // A complete stale preflight happens before the transaction directory is created,
    // so a rejected proposal does not leave recovery state behind.
    for (const patch of prepared.patches) await this.assertPatchCurrent(patch);
    if (signal?.aborted) throw new MutationError("mutation-failed", "The multi-file patch set was cancelled before commit; no members were changed.");

    const transactionDirectory = await this.createPatchSetTransactionDirectory(prepared.journal.transactionPath);
    const throwIfCancelled = (): void => {
      if (signal?.aborted) {
        throw new MutationError("reconciliation-required", "The multi-file patch set requires reconciliation after cancellation began during its transaction; inspect the persisted journal and member hashes before retrying. Do not retry automatically.");
      }
    };
    let journal: MutationJournal = { ...prepared.journal, state: "staging" };
    try {
      throwIfCancelled();
      await onJournal?.(journal);
      journal = { ...journal, state: "committing" };
      await onJournal?.(journal);
      for (const patch of prepared.patches) {
        throwIfCancelled();
        const member = journal.members.find((candidate) => candidate.path === patch.path);
        if (!member) throw new MutationError("mutation-failed", `Patch-set journal is missing member '${patch.path}'.`);
        const temporaryPath = path.join(transactionDirectory.absolutePath, `member-${member.commitOrder}.tmp`);
        const temporaryRelativePath = path.join(transactionDirectory.relativePath, `member-${member.commitOrder}.tmp`);
        journal = {
          ...journal,
          members: journal.members.map((candidate) => candidate.path === patch.path
            ? { ...candidate, state: "staged" as const, temporaryPath: temporaryRelativePath }
            : candidate),
        };
        await onJournal?.(journal);
        await this.commitPatch(patch, temporaryPath);
        journal = {
          ...journal,
          members: journal.members.map((member) => member.path === patch.path ? { ...member, state: "committed" as const } : member),
        };
        await onJournal?.(journal);
      }
      journal = { ...journal, state: "committed" };
      await onJournal?.(journal);
      // Successful atomic renames consume the temporary paths. A non-empty directory
      // is intentionally left for inspection rather than recursively deleted.
      await rmdir(transactionDirectory.absolutePath).catch(() => undefined);
      return { paths: prepared.paths, journal };
    } catch (error) {
      if (isRuntimeInterruptionError(error)) throw error;
      journal = { ...journal, state: "reconciliation_required" };
      try {
        await onJournal?.(journal);
      } catch {
        // The filesystem outcome remains authoritative if durable progress reporting fails.
      }
      if (journal.state === "reconciliation_required" && !(error instanceof MutationError && error.mutationCode === "reconciliation-required")) {
        throw new MutationError("reconciliation-required", "The multi-file patch set requires reconciliation after a partial or uncertain commit. Inspect the persisted journal and member hashes before retrying. Do not retry automatically.", { cause: error });
      }
      throw error;
    }
  }

  private async createPatchSetTransactionDirectory(transactionPath: string): Promise<{ readonly absolutePath: string; readonly relativePath: string }> {
    const expectedPrefix = `${WORKSPACE_TRANSACTION_DIRECTORY}${path.sep}`;
    if (!transactionPath.startsWith(expectedPrefix)) throw new WorkspaceAccessError("The patch-set transaction path is invalid.");
    const mutationId = transactionPath.slice(expectedPrefix.length);
    if (!validMutationId(mutationId)) throw new WorkspaceAccessError("The patch-set transaction identifier is invalid.");
    const root = await this.policy.resolve(".");
    const transactionRoot = path.join(root.absolutePath, WORKSPACE_TRANSACTION_DIRECTORY);
    try {
      await mkdir(transactionRoot, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new WorkspaceAccessError("The workspace transaction area could not be created safely.", { cause: error });
      }
    }
    const rootStats = await lstat(transactionRoot).catch((error) => {
      throw new WorkspaceAccessError("The workspace transaction area could not be inspected safely.", { cause: error });
    });
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new WorkspaceAccessError("The workspace transaction area is not a regular directory.");
    }
    if ((rootStats.mode & 0o077) !== 0) {
      throw new WorkspaceAccessError("The workspace transaction area is accessible to other users.");
    }
    const absolutePath = path.join(transactionRoot, mutationId);
    try {
      await mkdir(absolutePath, { mode: 0o700 });
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace transaction '${mutationId}' already exists or cannot be created.`, { cause: error });
    }
    return { absolutePath, relativePath: transactionPath };
  }

  async preparePatch(patchText: string): Promise<PreparedPatch> {
    const descriptor = describePatch(patchText);
    const target = await this.policy.resolveMutationTarget(descriptor.path);
    if (descriptor.operation === "add" && target.exists) {
      throw new WorkspaceAccessError(`Workspace file '${descriptor.path}' already exists; an add patch cannot replace it.`);
    }
    if (descriptor.operation === "update" && !target.exists) {
      throw new WorkspaceAccessError(`Workspace file '${descriptor.path}' does not exist; an update patch cannot create it.`);
    }
    if (target.exists && target.kind !== "file") {
      throw new WorkspaceAccessError(`Workspace mutation target '${descriptor.path}' is not a regular file.`);
    }
    const existingContent = target.exists ? await this.readMutationContent(target.absolutePath, descriptor.path) : "";
    const prepared = preparePurePatch(patchText, existingContent);
    if (prepared.path !== target.relativePath) {
      throw new WorkspaceAccessError(`Workspace mutation path '${prepared.path}' must use the canonical relative path '${target.relativePath}'.`);
    }
    if (Buffer.byteLength(prepared.afterContent, "utf8") > this.policy.limits.maxFileBytes) {
      throw new WorkspaceAccessError(`Workspace file '${prepared.path}' would exceed the ${this.policy.limits.maxFileBytes}-byte limit.`);
    }
    return prepared;
  }

  async commitPatch(prepared: PreparedPatch, temporaryPath?: string): Promise<WorkspaceCommit> {
    const target = await this.assertPatchCurrent(prepared);
    if (Buffer.byteLength(prepared.afterContent, "utf8") > this.policy.limits.maxFileBytes) {
      throw new WorkspaceAccessError(`Workspace file '${prepared.path}' would exceed the ${this.policy.limits.maxFileBytes}-byte limit.`);
    }
    try {
      await this.atomicWriter(target.absolutePath, prepared.afterContent, target.mode, temporaryPath);
    } catch (error) {
      if (error instanceof MutationError) throw error;
      throw new MutationError("mutation-failed", `Workspace file '${prepared.path}' could not be committed atomically.`, { cause: error });
    }
    return {
      path: prepared.path,
      afterHash: contentHash(prepared.afterContent),
      bytesWritten: Buffer.byteLength(prepared.afterContent, "utf8"),
    };
  }

  private async assertPatchCurrent(prepared: PreparedPatch): Promise<{ readonly absolutePath: string; readonly mode?: number }> {
    const target = await this.policy.resolveMutationTarget(prepared.path);
    if (prepared.operation === "add" && target.exists) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.path}' appeared after the proposal was prepared.`);
    }
    if (target.exists && target.kind !== "file") {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.path}' changed after the proposal was prepared.`);
    }
    if (prepared.operation === "update" && (!target.exists || target.kind !== "file")) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.path}' changed after the proposal was prepared.`);
    }
    const currentContent = target.exists ? await this.readMutationContent(target.absolutePath, prepared.path) : "";
    if (contentHash(currentContent) !== prepared.beforeHash) {
      throw new MutationError("mutation-stale", `Workspace file '${prepared.path}' changed after the proposal was prepared; refusing to overwrite it.`);
    }
    return { absolutePath: target.absolutePath, mode: target.mode };
  }

  async reconcileMutation(record: WorkspaceMutationRecord): Promise<WorkspaceMutationRecord> {
    if (record.status !== "approved" && record.status !== "applying") return record;
    try {
      if (record.operation === "purge-quarantine") return this.reconcileQuarantinePurge(record);
      const target = await this.policy.resolveMutationTarget(record.path);
      if (record.operation === "delete") return this.reconcileDelete(record, target);
      if (record.operation === "delete-directory") return this.reconcileDirectoryDeletion(record, target);
      if (record.operation === "delete-directory-tree") return this.reconcileDirectoryTreeDeletion(record, target);
      if (record.operation === "restore") return this.reconcileRestore(record, target);
      if (record.operation === "restore-directory") return this.reconcileDirectoryRestore(record, target);
      if (record.operation === "copy" || record.operation === "move" || record.operation === "rename") return this.reconcileTransfer(record, target);
      if (record.operation === "patch-set") return this.reconcilePatchSet(record);
      if (record.operation === "mkdir") {
        if (!target.exists) {
          return { ...record, status: "reconciled", reason: "The directory was absent during restart reconciliation; the mutation was not replayed." };
        }
        if (target.kind === "directory") {
          return { ...record, status: "committed", reason: "The directory was present during restart reconciliation; creation completed before the record update." };
        }
        return reconciliationRequired(record, "The recorded directory path contained a non-directory during restart reconciliation.");
      }
      if (!record.beforeHash || !record.afterHash) {
        return reconciliationRequired(record, "The mutation record has no content hashes for safe restart reconciliation.");
      }
      const currentContent = target.exists ? await this.readMutationContent(target.absolutePath, record.path) : "";
      const currentHash = contentHash(currentContent);
      if (currentHash === record.afterHash) {
        return { ...record, status: "committed", reason: "The after-hash was present during restart reconciliation; the atomic commit completed before the record update." };
      }
      if (currentHash === record.beforeHash) {
        return { ...record, status: "reconciled", reason: "The before-hash was present during restart reconciliation; no commit was observed and the mutation was not replayed." };
      }
      return reconciliationRequired(record, "Neither the recorded before-hash nor after-hash matched during restart reconciliation.");
    } catch (error) {
      return reconciliationRequired(
        record,
        error instanceof Error ? `The mutation target could not be safely inspected during restart reconciliation: ${error.message}` : "The mutation target could not be safely inspected during restart reconciliation.",
      );
    }
  }

  private async reconcileDelete(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!record.quarantinePath || record.quarantinePath !== path.join(WORKSPACE_QUARANTINE_DIRECTORY, record.mutationId, "payload") || !record.beforeHash) {
      return reconciliationRequired(record, "The deletion record does not contain a safe quarantine reference and hash.");
    }
    const payloadPath = await this.quarantineAbsolutePath(record.mutationId, "payload");
    const payloadExists = await lstat(payloadPath).then((metadata) => metadata.isFile()).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (target.exists && payloadExists) {
      return reconciliationRequired(record, "Both the original and quarantined deletion paths exist; manual reconciliation is required.");
    }
    if (!target.exists && payloadExists) {
      return { ...record, status: "committed", reason: "The quarantined payload was present during restart reconciliation; deletion completed before the record update." };
    }
    if (target.exists && target.kind === "file") {
      const current = await this.readMutationHash(target.absolutePath, record.path);
      if (current.hash === record.beforeHash) {
        return { ...record, status: "reconciled", reason: "The original file was present and unchanged during restart reconciliation; deletion was not replayed." };
      }
    }
    return reconciliationRequired(record, "The deletion record does not prove whether the original file or quarantine payload is authoritative.");
  }

  private async reconcileDirectoryDeletion(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!target.exists) {
      return { ...record, status: "committed", reason: "The directory was absent during restart reconciliation; deletion completed before the record update." };
    }
    if (target.kind !== "directory") {
      return reconciliationRequired(record, "The recorded directory path contained a non-directory during restart reconciliation.");
    }
    const entries = await readdir(target.absolutePath).catch(() => undefined);
    if (entries === undefined) return reconciliationRequired(record, "The directory could not be inspected during restart reconciliation.");
    if (entries.length === 0) {
      return { ...record, status: "reconciled", reason: "The empty directory was present during restart reconciliation; deletion was not replayed." };
    }
    return reconciliationRequired(record, "The directory contained entries during restart reconciliation; manual reconciliation is required.");
  }

  private async reconcileDirectoryTreeDeletion(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!record.quarantinePath || record.quarantinePath !== path.join(WORKSPACE_QUARANTINE_DIRECTORY, record.mutationId, "payload") || !record.manifestHash) {
      return reconciliationRequired(record, "The directory-tree deletion record does not contain a safe quarantine reference and manifest hash.");
    }
    const payloadPath = await this.quarantineAbsolutePath(record.mutationId, "payload");
    const payloadExists = await lstat(payloadPath).then((metadata) => metadata.isDirectory()).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (target.exists && payloadExists) return reconciliationRequired(record, "Both the original directory tree and quarantined payload exist; manual reconciliation is required.");
    if (!target.exists && payloadExists) return { ...record, status: "committed", reason: "The quarantined directory-tree payload was present during restart reconciliation; deletion completed before the record update." };
    if (target.exists && target.kind === "directory") {
      const scanned = await this.scanDirectoryTree(target.absolutePath, record.path);
      if (scanned.manifestHash === record.manifestHash) return { ...record, status: "reconciled", reason: "The original directory tree matched its recorded manifest during restart reconciliation; deletion was not replayed." };
    }
    return reconciliationRequired(record, "The directory-tree deletion record does not prove whether the original tree or quarantine payload is authoritative.");
  }

  private async reconcileRestore(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!record.quarantinePath || !record.sourceMutationId || !record.beforeHash || record.quarantinePath !== path.join(WORKSPACE_QUARANTINE_DIRECTORY, record.sourceMutationId, "payload")) {
      return reconciliationRequired(record, "The restore record does not contain a safe quarantine reference and hash.");
    }
    const payloadPath = await this.quarantineAbsolutePath(record.sourceMutationId, "payload");
    const payloadExists = await lstat(payloadPath).then((metadata) => metadata.isFile()).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (target.exists && payloadExists) {
      return reconciliationRequired(record, "Both the restore target and quarantined payload exist; manual reconciliation is required.");
    }
    if (!target.exists && payloadExists) {
      return { ...record, status: "reconciled", reason: "The quarantined payload was present and the restore target was absent; restore was not replayed." };
    }
    if (target.exists && target.kind === "file") {
      const current = await this.readMutationHash(target.absolutePath, record.path);
      if (current.hash === record.beforeHash) {
        return { ...record, status: "committed", reason: "The restored file was present during restart reconciliation; restoration completed before the record update." };
      }
    }
    return reconciliationRequired(record, "The restore record does not prove whether the target or quarantine payload is authoritative.");
  }

  private async reconcileDirectoryRestore(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!record.quarantinePath || !record.sourceMutationId || record.quarantinePath !== path.join(WORKSPACE_QUARANTINE_DIRECTORY, record.sourceMutationId, "payload") || !record.manifestHash) {
      return reconciliationRequired(record, "The directory restore record does not contain a safe quarantine reference and manifest hash.");
    }
    const payloadPath = await this.quarantineAbsolutePath(record.sourceMutationId, "payload");
    const payloadExists = await lstat(payloadPath).then((metadata) => metadata.isDirectory()).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (target.exists && payloadExists) return reconciliationRequired(record, "Both the restored directory tree and quarantined payload exist; manual reconciliation is required.");
    if (!target.exists && payloadExists) return { ...record, status: "reconciled", reason: "The quarantined directory-tree payload was present and the restore target was absent; restore was not replayed." };
    if (target.exists && target.kind === "directory") {
      const scanned = await this.scanDirectoryTree(target.absolutePath, record.path);
      if (scanned.manifestHash === record.manifestHash) return { ...record, status: "committed", reason: "The restored directory tree matched its recorded manifest during restart reconciliation." };
    }
    return reconciliationRequired(record, "The directory restore record does not prove whether the target or quarantine payload is authoritative.");
  }

  private async reconcileQuarantinePurge(record: WorkspaceMutationRecord): Promise<WorkspaceMutationRecord> {
    if (!record.sourceMutationId || !record.quarantinePath || record.quarantinePath !== path.join(WORKSPACE_QUARANTINE_DIRECTORY, record.sourceMutationId, "payload")) {
      return reconciliationRequired(record, "The quarantine purge record does not contain a safe exact token reference.");
    }
    const entryPath = path.dirname(await this.quarantineAbsolutePath(record.sourceMutationId, "payload"));
    const entryExists = await lstat(entryPath).then((metadata) => metadata.isDirectory()).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (!entryExists) return { ...record, status: "committed", reason: "The exact quarantine entry was absent during restart reconciliation; purge completed before the record update." };
    const manifestExists = await lstat(path.join(entryPath, "manifest.json")).then((metadata) => metadata.isFile()).catch(() => false);
    const payloadExists = await lstat(path.join(entryPath, "payload")).then(() => true).catch(() => false);
    if (manifestExists && payloadExists) return { ...record, status: "reconciled", reason: "The exact quarantine entry remained intact during restart reconciliation; purge was not replayed." };
    return reconciliationRequired(record, "The quarantine entry is partially removed; manual reconciliation is required before retrying purge.");
  }

  private async reconcileTransfer(record: WorkspaceMutationRecord, target: { readonly absolutePath: string; readonly exists: boolean; readonly kind?: WorkspaceDirectoryEntry["kind"] }): Promise<WorkspaceMutationRecord> {
    if (!record.sourcePath || !record.sourceHash || !record.afterHash) {
      return reconciliationRequired(record, "The transfer record does not contain a safe source path and hash.");
    }
    const source = await this.policy.resolveMutationTarget(record.sourcePath);
    const destinationMatches = target.exists && target.kind === "directory" && record.manifestHash
      ? (await this.scanDirectoryTree(target.absolutePath, record.path)).manifestHash === record.manifestHash
      : target.exists && target.kind === "file"
        && (await this.readMutationHash(target.absolutePath, record.path)).hash === record.afterHash;
    if (record.operation === "copy" && destinationMatches) {
      return { ...record, status: "committed", reason: "The copied destination matched its recorded hash during restart reconciliation." };
    }
    if ((record.operation === "move" || record.operation === "rename") && destinationMatches && !source.exists) {
      return { ...record, status: "committed", reason: `The ${record.operation}d destination matched its recorded hash and the source was absent during restart reconciliation.` };
    }
    if (!target.exists && source.exists) {
      const sourceHash = source.kind === "directory" && record.manifestHash
        ? (await this.scanDirectoryTree(source.absolutePath, record.sourcePath)).manifestHash
        : source.kind === "file"
          ? (await this.readMutationHash(source.absolutePath, record.sourcePath)).hash
          : undefined;
      if (sourceHash === record.sourceHash) return { ...record, status: "reconciled", reason: "The source was present and the destination was absent during restart reconciliation; the transfer was not replayed." };
    }
    return reconciliationRequired(record, "The transfer record does not prove whether the source or destination is authoritative.");
  }

  private async reconcilePatchSet(record: WorkspaceMutationRecord): Promise<WorkspaceMutationRecord> {
    if (!record.members || record.members.length < 2) {
      return reconciliationRequired(record, "The patch-set record does not contain the complete member hash set.");
    }
    const existingJournal: MutationJournal = record.journal ?? {
      schemaVersion: 1,
      state: "committing",
      transactionPath: path.join(WORKSPACE_TRANSACTION_DIRECTORY, record.mutationId),
      members: record.members.map((member, index) => ({
        path: member.path,
        beforeHash: member.beforeHash,
        afterHash: member.afterHash,
        commitOrder: index + 1,
        state: "pending" as const,
      })),
    };
    const journalMembers: MutationJournalMember[] = [];
    let conflict = false;
    for (const member of record.members) {
      const target = await this.policy.resolveMutationTarget(member.path);
      let currentHash = contentHash("");
      if (target.exists && target.kind === "file") currentHash = (await this.readMutationHash(target.absolutePath, member.path)).hash;
      else if (target.exists) conflict = true;
      const prior = existingJournal.members.find((candidate) => candidate.path === member.path);
      const state = currentHash === member.afterHash ? "committed" : currentHash === member.beforeHash ? "pending" : "pending";
      if (currentHash !== member.afterHash && currentHash !== member.beforeHash) conflict = true;
      journalMembers.push({
        path: member.path,
        beforeHash: member.beforeHash,
        afterHash: member.afterHash,
        commitOrder: prior?.commitOrder ?? journalMembers.length + 1,
        state,
        ...(prior?.temporaryPath ? { temporaryPath: prior.temporaryPath } : {}),
      });
    }
    const committedCount = journalMembers.filter((member) => member.state === "committed").length;
    const journalState: MutationJournalState = conflict || (committedCount > 0 && committedCount < journalMembers.length)
      ? "reconciliation_required"
      : committedCount === journalMembers.length
        ? "committed"
        : "reconciled";
    const journal: MutationJournal = { ...existingJournal, state: journalState, members: journalMembers };
    if (journalState === "committed") {
      await this.removeEmptyPatchSetTransactionDirectory(journal.transactionPath);
      return { ...record, status: "committed", journal, reason: "Every patch-set member matched its recorded after-hash during restart reconciliation." };
    }
    if (journalState === "reconciled") {
      await this.removeEmptyPatchSetTransactionDirectory(journal.transactionPath);
      return { ...record, status: "reconciled", journal, reason: "Every patch-set member matched its recorded before-hash during restart reconciliation; the set was not replayed." };
    }
    return { ...reconciliationRequired(record, "The patch-set journal contains a partial or conflicting member state; manual reconciliation is required."), journal };
  }

  private async removeEmptyPatchSetTransactionDirectory(transactionPath: string): Promise<void> {
    const expectedPrefix = `${WORKSPACE_TRANSACTION_DIRECTORY}${path.sep}`;
    if (!transactionPath.startsWith(expectedPrefix)) return;
    const mutationId = transactionPath.slice(expectedPrefix.length);
    if (!validMutationId(mutationId)) return;
    const root = await this.policy.resolve(".").catch(() => undefined);
    if (!root) return;
    await rmdir(path.join(root.absolutePath, WORKSPACE_TRANSACTION_DIRECTORY, mutationId)).catch(() => undefined);
  }

  private prepareFileTransfer(operation: "copy", sourcePath: string, destinationPath: string): Promise<PreparedFileCopy>;
  private prepareFileTransfer(operation: "move", sourcePath: string, destinationPath: string): Promise<PreparedFileMove>;
  private prepareFileTransfer(operation: "rename", sourcePath: string, destinationPath: string): Promise<PreparedRename>;
  private async prepareFileTransfer(operation: "copy" | "move" | "rename", sourcePath: string, destinationPath: string): Promise<PreparedFileCopy | PreparedFileMove | PreparedRename> {
    const source = await this.policy.resolveMutationTarget(sourcePath);
    if (!source.exists || (source.kind !== "file" && source.kind !== "directory")) {
      throw new WorkspaceAccessError(`Workspace ${operation} source '${sourcePath}' must be an existing regular file or directory.`);
    }
    if (source.relativePath === ".") throw new WorkspaceAccessError(`Workspace ${operation} cannot use the workspace root as its source.`);
    const destination = await this.policy.resolveMutationTarget(destinationPath);
    if (destination.exists) throw new WorkspaceAccessError(`Workspace ${operation} destination '${destinationPath}' already exists.`);
    if (source.relativePath === destination.relativePath) throw new WorkspaceAccessError(`Workspace ${operation} source and destination must be different paths.`);
    if (source.kind === "directory" && destination.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
      throw new WorkspaceAccessError(`Workspace ${operation} destination '${destination.relativePath}' cannot be inside source directory '${source.relativePath}'.`);
    }
    if (operation === "rename" && path.dirname(source.absolutePath) !== path.dirname(destination.absolutePath)) {
      throw new WorkspaceAccessError(`Workspace rename source '${source.relativePath}' and destination '${destination.relativePath}' must share a parent directory.`);
    }
    if (operation !== "copy" && source.device !== destination.device) {
      throw new WorkspaceAccessError(`Workspace ${operation} source '${source.relativePath}' and destination '${destination.relativePath}' are on different filesystems; cross-device operations are not supported.`);
    }
    if (source.kind === "directory") {
      const scanned = await this.scanDirectoryTree(source.absolutePath, source.relativePath);
      const action = operation === "copy" ? "Copy" : operation === "move" ? "Move" : "Rename";
      const prepared = {
        operation,
        kind: source.kind,
        path: destination.relativePath,
        sourcePath: source.relativePath,
        preview: `${action} directory tree: ${source.relativePath} → ${destination.relativePath}\nEntries: ${scanned.entryCount} · bytes: ${scanned.totalBytes} · depth: ${scanned.maxDepth}\nManifest hash: ${scanned.manifestHash}\nThe destination must remain absent until approval.`,
        beforeHash: scanned.manifestHash,
        afterHash: scanned.manifestHash,
        bytes: scanned.totalBytes,
        mode: source.mode ?? 0o700,
        manifestHash: scanned.manifestHash,
        entryCount: scanned.entryCount,
        maxDepth: scanned.maxDepth,
      } as const;
      return prepared;
    }
    const observation = await this.readMutationHash(source.absolutePath, source.relativePath);
    const action = operation === "copy" ? "Copy" : operation === "move" ? "Move" : "Rename";
    return {
      operation,
      kind: source.kind,
      path: destination.relativePath,
      sourcePath: source.relativePath,
      preview: `${action} file: ${source.relativePath} → ${destination.relativePath}\nSource hash: ${observation.hash}\nThe destination must remain absent until approval.`,
      beforeHash: observation.hash,
      afterHash: observation.hash,
      bytes: observation.bytes,
      mode: source.mode ?? 0o600,
    };
  }

  private async copyDirectoryTree(sourceAbsolutePath: string, destinationAbsolutePath: string, scanned: {
    readonly entries: readonly TreeManifestEntry[];
    readonly totalBytes: number;
    readonly mode: number;
    readonly manifestHash: string;
  }): Promise<void> {
    await mkdir(destinationAbsolutePath, { mode: scanned.mode });
    try {
      for (const entry of scanned.entries) {
        if (entry.path === ".") continue;
        const sourcePath = path.join(sourceAbsolutePath, entry.path);
        const destinationPath = path.join(destinationAbsolutePath, entry.path);
        if (entry.kind === "directory") {
          await mkdir(destinationPath, { mode: entry.mode });
          continue;
        }
        const sourceMetadata = await lstat(sourcePath).catch((error) => {
          throw new MutationError("mutation-stale", `Workspace tree entry '${entry.path}' changed while it was being copied.`, { cause: error });
        });
        if (!sourceMetadata.isFile()) throw new MutationError("mutation-stale", `Workspace tree entry '${entry.path}' changed while it was being copied.`);
        if (!entry.hash) throw new MutationError("mutation-failed", `Workspace tree entry '${entry.path}' has no recorded content hash.`);
        await atomicCopyFile(
          sourcePath,
          destinationPath,
          entry.path,
          entry.hash,
          entry.bytes,
          this.policy.limits.maxFileBytes,
          entry.mode,
        );
      }
      const after = await this.scanDirectoryTree(sourceAbsolutePath, ".");
      if (after.manifestHash !== scanned.manifestHash) {
        throw new MutationError("mutation-stale", "The source directory changed during the copy; the destination was not retained.");
      }
    } catch (error) {
      await this.removeTreeNoFollow(destinationAbsolutePath).catch(() => undefined);
      throw error;
    }
  }

  private async createQuarantineEntry(mutationId: string): Promise<{ readonly directoryPath: string; readonly payloadPath: string; readonly manifestPath: string }> {
    if (!validMutationId(mutationId)) throw new WorkspaceAccessError("The deletion recovery token is invalid.");
    const root = await this.policy.resolve(".");
    const quarantineRoot = path.join(root.absolutePath, WORKSPACE_QUARANTINE_DIRECTORY);
    try {
      const metadata = await lstat(quarantineRoot);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new WorkspaceAccessError("The workspace quarantine area is not a regular directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(quarantineRoot, { mode: 0o700 });
      } catch (createError) {
        throw new WorkspaceAccessError("The workspace quarantine area could not be created safely.", { cause: createError });
      }
    }
    const directoryPath = path.join(quarantineRoot, mutationId);
    try {
      await mkdir(directoryPath, { mode: 0o700 });
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace quarantine entry '${mutationId}' already exists or cannot be created.`, { cause: error });
    }
    return {
      directoryPath,
      payloadPath: path.join(directoryPath, "payload"),
      manifestPath: path.join(directoryPath, "manifest.json"),
    };
  }

  private async removeTreeNoFollow(absolutePath: string): Promise<void> {
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new WorkspaceAccessError("Refusing to remove a symbolic-link quarantine payload.");
    if (metadata.isFile()) {
      await unlink(absolutePath);
      return;
    }
    if (!metadata.isDirectory()) throw new WorkspaceAccessError("Refusing to remove an unsupported quarantine payload.");
    const children = (await readdir(absolutePath, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) await this.removeTreeNoFollow(path.join(absolutePath, child.name));
    await rmdir(absolutePath);
  }

  private async quarantineAbsolutePath(mutationId: string, leaf: "payload" | "manifest.json"): Promise<string> {
    if (!validMutationId(mutationId)) throw new WorkspaceAccessError("The recovery token is invalid.");
    const root = await this.policy.resolve(".");
    return path.join(root.absolutePath, WORKSPACE_QUARANTINE_DIRECTORY, mutationId, leaf);
  }

  private async readQuarantineManifest(mutationId: string): Promise<QuarantineManifest> {
    const manifestPath = await this.quarantineAbsolutePath(mutationId, "manifest.json");
    const metadata = await lstat(manifestPath).catch((error) => {
      throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is missing or cannot be inspected safely.`, { cause: error });
    });
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is not a regular file; symbolic links are not allowed.`);
    }
    let value: unknown;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const fileStats = await handle.stat();
      if (!fileStats.isFile() || fileStats.size > MAX_QUARANTINE_MANIFEST_BYTES) {
        throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is missing or invalid.`);
      }
      const bytes = await readHandleAtMost(handle, MAX_QUARANTINE_MANIFEST_BYTES);
      const afterStats = await handle.stat();
      if (!bytes || !afterStats.isFile() || afterStats.size !== fileStats.size || bytes.byteLength !== fileStats.size) {
        throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' changed while it was being read.`);
      }
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      if (error instanceof WorkspaceAccessError) throw error;
      throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is missing or invalid.`, { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
    if (!value || typeof value !== "object") throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is invalid.`);
    const manifest = value as Partial<QuarantineManifest>;
    if (
      manifest.schemaVersion !== 1
      || manifest.mutationId !== mutationId
      || typeof manifest.originalPath !== "string"
      || (manifest.kind !== undefined && manifest.kind !== "file" && manifest.kind !== "directory")
      || (manifest.kind !== "directory" && typeof manifest.beforeHash !== "string")
      || typeof manifest.bytes !== "number"
      || !Number.isSafeInteger(manifest.bytes)
      || manifest.bytes < 0
      || typeof manifest.mode !== "number"
      || typeof manifest.createdAt !== "string"
      || (manifest.kind === "directory" && (typeof manifest.manifestHash !== "string" || !Array.isArray(manifest.entries) || typeof manifest.entryCount !== "number" || typeof manifest.maxDepth !== "number"))
    ) throw new WorkspaceAccessError(`Recovery manifest '${mutationId}' is invalid.`);
    return manifest as QuarantineManifest;
  }

  private async readMutationHash(absolutePath: string, relativePath: string): Promise<{ readonly bytes: number; readonly hash: string }> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be opened for a safe read.`, { cause: error });
    }
    try {
      const fileStats = await handle.stat();
      if (!fileStats.isFile()) throw new WorkspaceAccessError(`Workspace path '${relativePath}' is not a regular file.`);
      if (fileStats.size > this.policy.limits.maxFileBytes) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' is ${fileStats.size} bytes; the limit is ${this.policy.limits.maxFileBytes} bytes.`);
      }
      const observation = await hashHandleAtMost(handle, this.policy.limits.maxFileBytes);
      if (!observation) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' grew beyond the ${this.policy.limits.maxFileBytes}-byte limit while it was being read.`);
      }
      const afterStats = await handle.stat();
      if (!afterStats.isFile() || afterStats.size !== fileStats.size || observation.bytes !== fileStats.size) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' changed while it was being read safely.`);
      }
      return observation;
    } catch (error) {
      if (error instanceof WorkspaceAccessError) throw error;
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be read safely.`, { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async readMutationBytes(absolutePath: string, relativePath: string): Promise<Buffer> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be opened for a safe read.`, { cause: error });
    }
    try {
      const fileStats = await handle.stat();
      if (!fileStats.isFile()) throw new WorkspaceAccessError(`Workspace path '${relativePath}' is not a regular file.`);
      if (fileStats.size > this.policy.limits.maxFileBytes) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' is ${fileStats.size} bytes; the limit is ${this.policy.limits.maxFileBytes} bytes.`);
      }
      const bytes = await readHandleAtMost(handle, this.policy.limits.maxFileBytes);
      if (!bytes) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' grew beyond the ${this.policy.limits.maxFileBytes}-byte limit while it was being read.`);
      }
      const afterStats = await handle.stat();
      if (!afterStats.isFile() || afterStats.size !== fileStats.size || bytes.byteLength !== fileStats.size) {
        throw new WorkspaceAccessError(`Workspace file '${relativePath}' changed while it was being read safely.`);
      }
      return bytes;
    } catch (error) {
      if (error instanceof WorkspaceAccessError) throw error;
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be read safely.`, { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async readMutationContent(absolutePath: string, relativePath: string): Promise<string> {
    const bytes = await this.readMutationBytes(absolutePath, relativePath);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' is not valid UTF-8 text.`, { cause: error });
    }
  }

  private async readSearchFile(absolutePath: string, relativePath: string, signal?: AbortSignal): Promise<string | undefined> {
    if (signal?.aborted) throw new WorkspaceAccessError("Workspace search was cancelled.");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const fileStats = await handle.stat();
      if (!fileStats.isFile() || fileStats.size > this.policy.limits.maxFileBytes) return undefined;
      const bytes = await readHandleAtMost(handle, this.policy.limits.maxFileBytes);
      if (!bytes || bytes.byteLength !== fileStats.size) return undefined;
      const afterStats = await handle.stat();
      if (!afterStats.isFile() || afterStats.size !== fileStats.size) return undefined;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return undefined;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ELOOP" || code === "EACCES") return undefined;
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be searched safely.`, { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

}
