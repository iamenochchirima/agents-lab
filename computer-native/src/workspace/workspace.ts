import { readFile, readdir, stat } from "node:fs/promises";
import { WorkspaceAccessError } from "../runtime/errors.js";
import { WorkspaceSecurityPolicy, type WorkspaceLimits } from "../security/workspace-policy.js";

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

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): WorkspaceDirectoryEntry["kind"] {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

export class Workspace {
  constructor(readonly policy: WorkspaceSecurityPolicy) {}

  static async open(root: string, limits: WorkspaceLimits): Promise<Workspace> {
    const policy = new WorkspaceSecurityPolicy(root, limits);
    await policy.initialize();
    return new Workspace(policy);
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
    const fileStats = await stat(resolved.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be inspected.`, { cause: error });
    });
    if (!fileStats.isFile()) throw new WorkspaceAccessError(`Workspace path '${relativePath}' is not a regular file.`);
    if (fileStats.size > this.policy.limits.maxFileBytes) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' is ${fileStats.size} bytes; the limit is ${this.policy.limits.maxFileBytes} bytes.`);
    }
    const bytes = await readFile(resolved.absolutePath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' cannot be read.`, { cause: error });
    });
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new WorkspaceAccessError(`Workspace file '${relativePath}' is not valid UTF-8 text.`, { cause: error });
    }
    return { path: resolved.relativePath, sizeBytes: bytes.byteLength, content };
  }
}
