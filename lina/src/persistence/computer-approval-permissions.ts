import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { LinaError } from "../runtime/errors.js";
import { atomicWriteJson, safePathSegment } from "./json.js";
import { SessionLock } from "./lock.js";

export interface ComputerPermissionGrant {
  readonly id: string;
  readonly scope: "conversation";
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
}

interface StoredComputerPermission extends ComputerPermissionGrant {
  readonly sessionId: string;
  readonly matcherHash: string;
}

interface PermissionDocument {
  readonly schemaVersion: 1;
  readonly grants: readonly StoredComputerPermission[];
}

const MAX_PERMISSION_FILE_BYTES = 512 * 1024;
const MAX_PERMISSION_COUNT = 128;
const MAX_LABEL_LENGTH = 512;
const ID_PATTERN = /^computer_[a-f0-9]{32}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function publicGrant(grant: StoredComputerPermission): ComputerPermissionGrant {
  return {
    id: grant.id,
    scope: grant.scope,
    label: grant.label,
    createdAt: grant.createdAt,
    ...(grant.lastUsedAt ? { lastUsedAt: grant.lastUsedAt } : {}),
  };
}

function validateDocument(value: unknown, sessionId: string): PermissionDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LinaError("persistence", "Saved computer permissions are invalid; no saved permission was used.");
  }
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.grants) || document.grants.length > MAX_PERMISSION_COUNT) {
    throw new LinaError("persistence", "Saved computer permissions have an unsupported or invalid format; no saved permission was used.");
  }
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const grants = document.grants.map((entry): StoredComputerPermission => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new LinaError("persistence", "A saved computer permission is invalid; no saved permission was used.");
    }
    const grant = entry as Record<string, unknown>;
    if (typeof grant.id !== "string"
      || !ID_PATTERN.test(grant.id)
      || ids.has(grant.id)
      || grant.scope !== "conversation"
      || grant.sessionId !== sessionId
      || typeof grant.matcherHash !== "string"
      || !HASH_PATTERN.test(grant.matcherHash)
      || hashes.has(grant.matcherHash)
      || typeof grant.label !== "string"
      || grant.label.length === 0
      || grant.label.length > MAX_LABEL_LENGTH
      || grant.label.trim() !== grant.label
      || CONTROL_PATTERN.test(grant.label)
      || !validTimestamp(grant.createdAt)
      || (grant.lastUsedAt !== undefined && !validTimestamp(grant.lastUsedAt))) {
      throw new LinaError("persistence", "A saved computer permission failed validation; no saved permission was used.");
    }
    ids.add(grant.id);
    hashes.add(grant.matcherHash);
    return grant as unknown as StoredComputerPermission;
  });
  return { schemaVersion: 1, grants };
}

async function assertDirectory(directory: string, create: boolean): Promise<boolean> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new LinaError("persistence", "The saved computer permission directory is not a regular directory.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) return false;
    if (error instanceof LinaError) throw error;
    throw new LinaError("persistence", "The saved computer permission directory could not be inspected.", { cause: error });
  }
}

/**
 * Durable task grants for one conversation. The caller must provide a hash of the
 * approved matcher and a display label free of raw goals, credentials, and secrets.
 * A malformed file fails closed; missing storage means no grants.
 */
export class ComputerApprovalPermissions {
  private readonly file: string;
  private readonly lock: string;
  readonly sessionId: string;

  constructor(sessionDirectory: string, sessionId: string) {
    this.sessionId = safePathSegment(sessionId, "Session ID");
    this.file = path.join(sessionDirectory, "computer-permissions.json");
    this.lock = path.join(sessionDirectory, ".computer-permissions.lock");
  }

  async find(matcherHash: string): Promise<ComputerPermissionGrant | undefined> {
    if (!HASH_PATTERN.test(matcherHash)) return undefined;
    if (!(await this.read()).some((grant) => grant.matcherHash === matcherHash)) return undefined;
    return this.mutate((grants) => {
      const existing = grants.find((grant) => grant.matcherHash === matcherHash);
      if (!existing) return { grants, result: undefined };
      const used = { ...existing, lastUsedAt: new Date().toISOString() };
      return {
        grants: grants.map((grant) => grant.id === used.id ? used : grant),
        result: publicGrant(used),
      };
    });
  }

  async save(matcherHash: string, label: string): Promise<ComputerPermissionGrant> {
    if (!HASH_PATTERN.test(matcherHash)) {
      throw new LinaError("invalid-input", "The computer permission matcher hash is invalid.");
    }
    const safeLabel = label.trim();
    if (!safeLabel || safeLabel.length > MAX_LABEL_LENGTH || CONTROL_PATTERN.test(safeLabel)) {
      throw new LinaError("invalid-input", "A computer permission needs a bounded, readable task description.");
    }
    return this.mutate((grants) => {
      const existing = grants.find((grant) => grant.matcherHash === matcherHash);
      if (existing) return { grants, result: publicGrant(existing) };
      if (grants.length >= MAX_PERMISSION_COUNT) {
        throw new LinaError("persistence", "The saved computer permission limit was reached; revoke an unused permission first.");
      }
      const grant: StoredComputerPermission = {
        id: `computer_${randomUUID().replaceAll("-", "")}`,
        scope: "conversation",
        sessionId: this.sessionId,
        matcherHash,
        label: safeLabel,
        createdAt: new Date().toISOString(),
      };
      return { grants: [...grants, grant], result: publicGrant(grant) };
    });
  }

  async list(): Promise<readonly ComputerPermissionGrant[]> {
    return (await this.read())
      .map(publicGrant)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  }

  async revoke(id: string): Promise<boolean> {
    if (!ID_PATTERN.test(id)) return false;
    return this.mutate((grants) => {
      const next = grants.filter((grant) => grant.id !== id);
      return next.length === grants.length
        ? { grants, result: false }
        : { grants: next, result: true };
    });
  }

  private async read(): Promise<readonly StoredComputerPermission[]> {
    if (!(await assertDirectory(path.dirname(this.file), false))) return [];
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_PERMISSION_FILE_BYTES) {
        throw new LinaError("persistence", "Saved computer permissions are not a bounded regular file; no saved permission was used.");
      }
      return validateDocument(JSON.parse(await handle.readFile("utf8")) as unknown, this.sessionId).grants;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof LinaError) throw error;
      throw new LinaError("persistence", "Saved computer permissions could not be read; no saved permission was used.", { cause: error });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async mutate<T>(
    update: (grants: readonly StoredComputerPermission[]) => { readonly grants: readonly StoredComputerPermission[]; readonly result: T },
  ): Promise<T> {
    await assertDirectory(path.dirname(this.file), true);
    const held = await SessionLock.acquire(this.lock, { waitMs: 1_000 });
    try {
      const current = await this.read();
      const next = update(current);
      if (next.grants !== current) {
        await atomicWriteJson(this.file, { schemaVersion: 1, grants: next.grants } satisfies PermissionDocument);
      }
      return next.result;
    } finally {
      await held.release();
    }
  }
}
