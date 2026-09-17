import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { WorkspaceAccessError } from "../runtime/errors.js";

export interface WorkspaceLimits {
  readonly maxFileBytes: number;
  readonly maxDirectoryEntries: number;
  readonly maxTreeEntries?: number;
  readonly maxTreeBytes?: number;
  readonly maxTreeDepth?: number;
  /** Aggregate resulting UTF-8 bytes allowed for one multi-file patch set. */
  readonly maxPatchSetBytes?: number;
}

export const WORKSPACE_QUARANTINE_DIRECTORY = ".anesu-trash";
export const WORKSPACE_TRANSACTION_DIRECTORY = ".anesu-transactions";

export interface ResolvedWorkspacePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface ResolvedMutationTarget extends ResolvedWorkspacePath {
  readonly exists: boolean;
  /** Device containing the target, or its existing parent when the target is absent. */
  readonly device: number;
  readonly kind?: "file" | "directory" | "other";
  readonly mode?: number;
}

function isWithin(root: string, candidate: string): boolean {
  if (root === path.parse(root).root) return candidate.startsWith(root);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function relativeDisplay(root: string, candidate: string): string {
  return path.relative(root, candidate) || ".";
}

function isReservedWorkspacePath(relativePath: string): boolean {
  const first = relativePath.replaceAll("\\", "/").split("/").filter((part) => part.length > 0 && part !== ".")[0];
  return first === WORKSPACE_QUARANTINE_DIRECTORY || first === WORKSPACE_TRANSACTION_DIRECTORY;
}

export class WorkspaceSecurityPolicy {
  private realRoot: string | undefined;

  constructor(
    readonly configuredRoot: string,
    readonly limits: WorkspaceLimits,
  ) {}

  async initialize(): Promise<void> {
    const root = await realpath(this.configuredRoot).catch((error) => {
      throw new WorkspaceAccessError(`Workspace root '${this.configuredRoot}' cannot be resolved.`, { cause: error });
    });
    const rootStats = await stat(root).catch((error) => {
      throw new WorkspaceAccessError(`Workspace root '${root}' cannot be inspected.`, { cause: error });
    });
    if (!rootStats.isDirectory()) throw new WorkspaceAccessError(`Workspace root '${root}' is not a directory.`);
    this.realRoot = root;
  }

  async resolve(relativePath = "."): Promise<ResolvedWorkspacePath> {
    const root = this.realRoot;
    if (!root) throw new WorkspaceAccessError("Workspace security policy has not been initialized.");
    if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
      throw new WorkspaceAccessError("A workspace-relative path is required.");
    }
    if (isReservedWorkspacePath(relativePath)) throw new WorkspaceAccessError("The requested workspace path is reserved for internal recovery data.");
    if (path.isAbsolute(relativePath)) throw new WorkspaceAccessError("Absolute paths are not allowed; use a path relative to the workspace root.");
    const lexicalPath = path.resolve(root, relativePath);
    if (!isWithin(root, lexicalPath)) throw new WorkspaceAccessError("The requested path is outside the workspace root.");
    const resolved = await realpath(lexicalPath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' does not exist or cannot be resolved.`, { cause: error });
    });
    if (!isWithin(root, resolved)) throw new WorkspaceAccessError("The requested path resolves outside the workspace root.");
    return { absolutePath: resolved, relativePath: relativeDisplay(root, resolved) };
  }

  async resolveMetadata(relativePath = "."): Promise<ResolvedWorkspacePath> {
    const root = this.realRoot;
    if (!root) throw new WorkspaceAccessError("Workspace security policy has not been initialized.");
    if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
      throw new WorkspaceAccessError("A workspace-relative path is required.");
    }
    if (isReservedWorkspacePath(relativePath)) throw new WorkspaceAccessError("The requested workspace path is reserved for internal recovery data.");
    if (path.isAbsolute(relativePath)) throw new WorkspaceAccessError("Absolute paths are not allowed; use a path relative to the workspace root.");
    const lexicalPath = path.resolve(root, relativePath);
    if (!isWithin(root, lexicalPath)) throw new WorkspaceAccessError("The requested path is outside the workspace root.");

    if (lexicalPath !== root) {
      const parentPath = path.dirname(lexicalPath);
      const resolvedParent = await realpath(parentPath).catch((error) => {
        throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' does not exist or cannot be resolved.`, { cause: error });
      });
      if (!isWithin(root, resolvedParent)) throw new WorkspaceAccessError("The requested path resolves outside the workspace root.");
      if (resolvedParent !== parentPath) throw new WorkspaceAccessError(`Workspace path '${relativePath}' contains a symbolic link parent.`);
    }
    await lstat(lexicalPath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' does not exist or cannot be inspected.`, { cause: error });
    });
    return { absolutePath: lexicalPath, relativePath: relativeDisplay(root, lexicalPath) };
  }

  async resolveMutationTarget(relativePath: string): Promise<ResolvedMutationTarget> {
    const root = this.realRoot;
    if (!root) throw new WorkspaceAccessError("Workspace security policy has not been initialized.");
    if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
      throw new WorkspaceAccessError("A workspace-relative mutation path is required.");
    }
    if (isReservedWorkspacePath(relativePath)) throw new WorkspaceAccessError("The requested workspace path is reserved for internal recovery data.");
    if (path.isAbsolute(relativePath)) throw new WorkspaceAccessError("Absolute paths are not allowed; use a path relative to the workspace root.");
    const lexicalPath = path.resolve(root, relativePath);
    if (!isWithin(root, lexicalPath)) throw new WorkspaceAccessError("The requested mutation path is outside the workspace root.");

    const parentPath = path.dirname(lexicalPath);
    const resolvedParent = await realpath(parentPath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' does not exist or cannot be resolved.`, { cause: error });
    });
    if (!isWithin(root, resolvedParent)) throw new WorkspaceAccessError("The requested mutation parent resolves outside the workspace root.");
    if (resolvedParent !== parentPath) throw new WorkspaceAccessError(`Workspace mutation path '${relativePath}' contains a symbolic link parent.`);
    const parentStats = await stat(resolvedParent).catch((error) => {
      throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' cannot be inspected.`, { cause: error });
    });
    if (!parentStats.isDirectory()) throw new WorkspaceAccessError(`Workspace parent for '${relativePath}' is not a directory.`);

    let targetStats;
    try {
      targetStats = await lstat(lexicalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { absolutePath: lexicalPath, relativePath: relativeDisplay(root, lexicalPath), exists: false, device: parentStats.dev };
      }
      throw new WorkspaceAccessError(`Workspace mutation target '${relativePath}' cannot be inspected.`, { cause: error });
    }
    if (targetStats.isSymbolicLink()) throw new WorkspaceAccessError(`Workspace mutation target '${relativePath}' is a symbolic link.`);
    const resolvedTarget = await realpath(lexicalPath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace mutation target '${relativePath}' cannot be resolved.`, { cause: error });
    });
    if (resolvedTarget !== lexicalPath || !isWithin(root, resolvedTarget)) {
      throw new WorkspaceAccessError(`Workspace mutation target '${relativePath}' resolves outside the workspace root.`);
    }
    const kind = targetStats.isFile() ? "file" : targetStats.isDirectory() ? "directory" : "other";
    return {
      absolutePath: lexicalPath,
      relativePath: relativeDisplay(root, lexicalPath),
      exists: true,
      device: targetStats.dev,
      kind,
      mode: targetStats.mode & 0o7777,
    };
  }
}
