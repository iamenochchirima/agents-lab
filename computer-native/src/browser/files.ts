import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import type { WorkspaceSecurityPolicy } from "../security/workspace-policy.js";
import { BrowserError } from "./errors.js";
import type { BrowserFileIdentity, BrowserUploadSource } from "./contracts.js";

export interface BrowserFilePolicyOptions {
  readonly maxUploadBytes: number;
}

/** Resolves browser upload sources through the same symlink/traversal policy as workspace mutations. */
export class BrowserFilePolicy {
  constructor(
    private readonly workspacePolicy: WorkspaceSecurityPolicy,
    private readonly options: BrowserFilePolicyOptions,
  ) {
    if (!Number.isInteger(options.maxUploadBytes) || options.maxUploadBytes <= 0) {
      throw new BrowserError("artifact-violation", "The browser upload byte limit must be a positive integer.");
    }
  }

  async resolveUpload(requestedPath: string): Promise<BrowserUploadSource> {
    try {
      const target = await this.workspacePolicy.resolveMutationTarget(requestedPath);
      if (!target.exists || target.kind !== "file") {
        throw new BrowserError("artifact-violation", "Browser uploads require an existing regular workspace file.");
      }
      const file = await lstat(target.absolutePath);
      if (file.isSymbolicLink() || !file.isFile()) {
        throw new BrowserError("artifact-violation", "Browser uploads require an existing regular workspace file.");
      }
      if (file.size > this.options.maxUploadBytes) {
        throw new BrowserError("artifact-violation", `The browser upload exceeds the ${this.options.maxUploadBytes}-byte limit.`);
      }
      const identity: BrowserFileIdentity = {
        device: file.dev,
        inode: file.ino,
        mode: file.mode & 0o7777,
        size: file.size,
        modifiedAtMs: file.mtimeMs,
        contentHash: await contentHash(target.absolutePath),
      };
      return { requestedPath: target.relativePath, absolutePath: target.absolutePath, byteSize: file.size, identity };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("artifact-violation", error instanceof Error ? error.message : "The browser upload path was rejected.", { cause: error });
    }
  }
}

async function contentHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function sameBrowserFileIdentity(left: BrowserFileIdentity, right: BrowserFileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.size === right.size
    && left.modifiedAtMs === right.modifiedAtMs
    && left.contentHash === right.contentHash;
}
