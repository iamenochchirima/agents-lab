import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { WorkspaceSecurityPolicy } from "../security/workspace-policy.js";
import { BrowserError } from "./errors.js";
import type { BrowserFileIdentity, BrowserUploadSource } from "./contracts.js";

export interface BrowserFilePolicyOptions {
  readonly maxUploadBytes: number;
}

const UPLOAD_HASH_CHUNK_BYTES = 64 * 1024;

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
      const identity = await contentIdentity(target.absolutePath, this.options.maxUploadBytes);
      return { requestedPath: target.relativePath, absolutePath: target.absolutePath, byteSize: identity.size, identity };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("artifact-violation", error instanceof Error ? error.message : "The browser upload path was rejected.", { cause: error });
    }
  }
}

async function contentIdentity(filePath: string, maxBytes: number): Promise<BrowserFileIdentity> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const hash = createHash("sha256");
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      throw new BrowserError("artifact-violation", `The browser upload exceeds the ${maxBytes}-byte limit.`);
    }
    let bytes = 0;
    while (true) {
      const readSize = Math.min(UPLOAD_HASH_CHUNK_BYTES, Math.max(1, maxBytes - bytes + 1));
      const chunk = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maxBytes) {
        throw new BrowserError("artifact-violation", `The browser upload exceeds the ${maxBytes}-byte limit.`);
      }
      hash.update(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== bytes
      || after.mtimeMs !== before.mtimeMs || (after.mode & 0o7777) !== (before.mode & 0o7777)) {
      throw new BrowserError("artifact-violation", "The browser upload source changed while its identity was being prepared.");
    }
    return {
      device: after.dev,
      inode: after.ino,
      mode: after.mode & 0o7777,
      size: bytes,
      modifiedAtMs: after.mtimeMs,
      contentHash: hash.digest("hex"),
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function sameBrowserFileIdentity(left: BrowserFileIdentity, right: BrowserFileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.size === right.size
    && left.modifiedAtMs === right.modifiedAtMs
    && left.contentHash === right.contentHash;
}
