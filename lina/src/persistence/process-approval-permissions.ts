import { constants as fsConstants } from "node:fs";
import { mkdir, open, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LinaError } from "../runtime/errors.js";
import { atomicWriteJson, safePathSegment } from "./json.js";
import { SessionLock } from "./lock.js";

export type ProcessPermissionScope = "conversation" | "local";

export interface ProcessPermissionGrant {
  readonly id: string;
  readonly scope: ProcessPermissionScope;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
}

interface StoredProcessPermission extends ProcessPermissionGrant {
  readonly identityHash: string;
  readonly sessionId?: string;
}

interface PermissionDocument {
  readonly schemaVersion: 1;
  readonly grants: readonly StoredProcessPermission[];
}

const MAX_PERMISSION_FILE_BYTES = 512 * 1024;
const MAX_PERMISSION_COUNT = 128;
const MAX_LABEL_LENGTH = 512;
const ID_PATTERN = /^(?:conversation|local)_[a-f0-9]{32}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateDocument(value: unknown, scope: ProcessPermissionScope, sessionId: string | undefined): PermissionDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LinaError("persistence", "Saved process permissions are invalid; no saved permission was used.");
  }
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.grants) || document.grants.length > MAX_PERMISSION_COUNT) {
    throw new LinaError("persistence", "Saved process permissions have an unsupported or invalid format; no saved permission was used.");
  }
  const ids = new Set<string>();
  const grants = document.grants.map((entry): StoredProcessPermission => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new LinaError("persistence", "A saved process permission is invalid; no saved permission was used.");
    }
    const grant = entry as Record<string, unknown>;
    if (typeof grant.id !== "string"
      || !ID_PATTERN.test(grant.id)
      || ids.has(grant.id)
      || grant.scope !== scope
      || (sessionId === undefined ? grant.sessionId !== undefined : grant.sessionId !== sessionId)
      || typeof grant.identityHash !== "string"
      || !HASH_PATTERN.test(grant.identityHash)
      || typeof grant.label !== "string"
      || grant.label.length === 0
      || grant.label.length > MAX_LABEL_LENGTH
      || !validTimestamp(grant.createdAt)
      || (grant.lastUsedAt !== undefined && !validTimestamp(grant.lastUsedAt))) {
      throw new LinaError("persistence", "A saved process permission failed validation; no saved permission was used.");
    }
    ids.add(grant.id);
    return grant as unknown as StoredProcessPermission;
  });
  return { schemaVersion: 1, grants };
}

async function assertDirectory(directory: string, create: boolean): Promise<boolean> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new LinaError("persistence", "The saved-permission directory is not a regular directory.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return false;
    if (error instanceof LinaError) throw error;
    throw new LinaError("persistence", "The saved-permission directory could not be inspected.", { cause: error });
  }
}

export class ProcessApprovalPermissions {
  private readonly conversationFile: string;
  private readonly conversationLock: string;
  private readonly localFile: string;
  private readonly localLock: string;

  constructor(
    stateDir: string,
    sessionDirectory: string,
    readonly sessionId: string,
    profileId: string,
  ) {
    const safeSessionId = safePathSegment(sessionId, "Session ID");
    const safeProfileId = safePathSegment(profileId, "Profile ID");
    this.conversationFile = path.join(sessionDirectory, "process-permissions.json");
    this.conversationLock = path.join(sessionDirectory, ".process-permissions.lock");
    const profileDirectory = path.join(stateDir, "permissions", safeProfileId);
    this.localFile = path.join(profileDirectory, "process.json");
    this.localLock = path.join(profileDirectory, ".process.lock");
  }

  async find(identityHash: string): Promise<ProcessPermissionGrant | undefined> {
    if (!HASH_PATTERN.test(identityHash)) return undefined;
    const conversation = await this.findIn("conversation", identityHash);
    return conversation ?? await this.findIn("local", identityHash);
  }

  async save(scope: ProcessPermissionScope, identityHash: string, label: string): Promise<ProcessPermissionGrant> {
    if (!HASH_PATTERN.test(identityHash)) {
      throw new LinaError("invalid-input", "The process permission identity is invalid.");
    }
    const safeLabel = label.trim().slice(0, MAX_LABEL_LENGTH);
    if (!safeLabel) throw new LinaError("invalid-input", "A process permission needs a readable command description.");
    return this.mutate(scope, (grants) => {
      const existing = grants.find((grant) => grant.identityHash === identityHash);
      if (existing) return { grants, result: existing };
      if (grants.length >= MAX_PERMISSION_COUNT) {
        throw new LinaError("persistence", "The saved process permission limit was reached; revoke an unused permission first.");
      }
      const createdAt = new Date().toISOString();
      const grant: StoredProcessPermission = {
        id: `${scope}_${randomUUID().replaceAll("-", "")}`,
        scope,
        ...(scope === "conversation" ? { sessionId: this.sessionId } : {}),
        identityHash,
        label: safeLabel,
        createdAt,
      };
      return { grants: [...grants, grant], result: grant };
    });
  }

  async list(): Promise<readonly ProcessPermissionGrant[]> {
    const [conversation, local] = await Promise.all([
      this.read("conversation"),
      this.read("local"),
    ]);
    return [...conversation, ...local]
      .map(({ id, scope, label, createdAt, lastUsedAt }) => ({ id, scope, label, createdAt, ...(lastUsedAt ? { lastUsedAt } : {}) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  }

  async revoke(id: string): Promise<boolean> {
    const scope = id.startsWith("conversation_") ? "conversation" : id.startsWith("local_") ? "local" : undefined;
    if (!scope || !ID_PATTERN.test(id)) return false;
    return this.mutate(scope, (grants) => {
      const next = grants.filter((grant) => grant.id !== id);
      return next.length === grants.length
        ? { grants, result: false }
        : { grants: next, result: true };
    });
  }

  private async findIn(scope: ProcessPermissionScope, identityHash: string): Promise<ProcessPermissionGrant | undefined> {
    if (!(await this.read(scope)).some((grant) => grant.identityHash === identityHash)) return undefined;
    let matched: StoredProcessPermission | undefined;
    await this.mutate(scope, (grants) => {
      matched = grants.find((grant) => grant.identityHash === identityHash);
      if (!matched) return { grants, result: undefined };
      const lastUsedAt = new Date().toISOString();
      matched = { ...matched, lastUsedAt };
      return {
        grants: grants.map((grant) => grant.id === matched?.id ? matched! : grant),
        result: undefined,
      };
    });
    if (!matched) return undefined;
    return {
      id: matched.id,
      scope: matched.scope,
      label: matched.label,
      createdAt: matched.createdAt,
      ...(matched.lastUsedAt ? { lastUsedAt: matched.lastUsedAt } : {}),
    };
  }

  private async read(scope: ProcessPermissionScope): Promise<readonly StoredProcessPermission[]> {
    const { file } = this.paths(scope);
    const parentExists = await assertDirectory(path.dirname(file), false);
    if (!parentExists) return [];
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_PERMISSION_FILE_BYTES) {
        throw new LinaError("persistence", "Saved process permissions are not a bounded regular file; no saved permission was used.");
      }
      const value = JSON.parse(await handle.readFile("utf8")) as unknown;
      return validateDocument(value, scope, scope === "conversation" ? this.sessionId : undefined).grants;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof LinaError) throw error;
      throw new LinaError("persistence", "Saved process permissions could not be read; no saved permission was used.", { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async mutate<T>(
    scope: ProcessPermissionScope,
    update: (grants: readonly StoredProcessPermission[]) => { readonly grants: readonly StoredProcessPermission[]; readonly result: T },
  ): Promise<T> {
    const { file, lock } = this.paths(scope);
    await assertDirectory(path.dirname(file), true);
    const held = await SessionLock.acquire(lock, { waitMs: 1_000 });
    try {
      const current = await this.read(scope);
      const next = update(current);
      if (next.grants !== current) {
        await atomicWriteJson(file, { schemaVersion: 1, grants: next.grants } satisfies PermissionDocument);
      }
      return next.result;
    } finally {
      await held.release();
    }
  }

  private paths(scope: ProcessPermissionScope): { readonly file: string; readonly lock: string } {
    return scope === "conversation"
      ? { file: this.conversationFile, lock: this.conversationLock }
      : { file: this.localFile, lock: this.localLock };
  }
}
