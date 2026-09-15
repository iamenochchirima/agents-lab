import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { WorkspaceAccessError } from "../runtime/errors.js";

export interface WorkspaceLimits {
  readonly maxFileBytes: number;
  readonly maxDirectoryEntries: number;
}

export interface ResolvedWorkspacePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function relativeDisplay(root: string, candidate: string): string {
  return path.relative(root, candidate) || ".";
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
    if (path.isAbsolute(relativePath)) throw new WorkspaceAccessError("Absolute paths are not allowed; use a path relative to the workspace root.");
    const lexicalPath = path.resolve(root, relativePath);
    if (!isWithin(root, lexicalPath)) throw new WorkspaceAccessError("The requested path is outside the workspace root.");
    const resolved = await realpath(lexicalPath).catch((error) => {
      throw new WorkspaceAccessError(`Workspace path '${relativePath}' does not exist or cannot be resolved.`, { cause: error });
    });
    if (!isWithin(root, resolved)) throw new WorkspaceAccessError("The requested path resolves outside the workspace root.");
    return { absolutePath: resolved, relativePath: relativeDisplay(root, resolved) };
  }
}
