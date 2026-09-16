import { stat } from "node:fs/promises";
import type { WorkspaceSecurityPolicy } from "../security/workspace-policy.js";
import { BrowserError } from "./errors.js";
import type { BrowserUploadSource } from "./contracts.js";

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
      const file = await stat(target.absolutePath);
      if (file.size > this.options.maxUploadBytes) {
        throw new BrowserError("artifact-violation", `The browser upload exceeds the ${this.options.maxUploadBytes}-byte limit.`);
      }
      return { requestedPath: target.relativePath, absolutePath: target.absolutePath, byteSize: file.size };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("artifact-violation", error instanceof Error ? error.message : "The browser upload path was rejected.", { cause: error });
    }
  }
}
