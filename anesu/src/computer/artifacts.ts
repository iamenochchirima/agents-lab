import { randomUUID } from "node:crypto";
import { constants, copyFile, lstat, mkdir, readFile, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, safePathSegment } from "../persistence/json.js";
import { SessionLock } from "../persistence/lock.js";
import type { ComputerEnvironmentObservation } from "./contracts.js";

export type ComputerArtifactErrorCode = "artifact-violation";

export class ComputerArtifactError extends Error {
  readonly code: ComputerArtifactErrorCode;

  constructor(code: ComputerArtifactErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ComputerArtifactError";
    this.code = code;
  }
}

export interface ComputerObservationArtifact {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly runId: string;
  readonly observationId: string;
  readonly path: string;
  /** Path relative to the managed computer-artifacts root. */
  readonly relativePath: string;
  readonly mimeType: "image/png";
  readonly byteSize: number;
  readonly createdAt: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ComputerArtifactStoreOptions {
  readonly maxBytes?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly now?: () => string;
  readonly createArtifactId?: () => string;
}

export interface ComputerArtifactCleanupOptions {
  readonly maxAgeMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

export interface ComputerArtifactCleanupResult {
  readonly scanned: number;
  readonly removed: number;
  readonly retained: number;
  readonly skipped: number;
  readonly failed: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_WIDTH = 1_920;
const DEFAULT_MAX_HEIGHT = 1_080;

function defaultArtifactId(): string {
  return `computer_artifact_${randomUUID().replaceAll("-", "")}`;
}

function emptyCleanupResult(): ComputerArtifactCleanupResult {
  return { scanned: 0, removed: 0, retained: 0, skipped: 0, failed: 0, truncated: false };
}

function managedPath(rootDirectory: string, relativePath: string): string {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ComputerArtifactError("artifact-violation", "The computer artifact path escaped its managed root.");
  }
  return target;
}

function artifactPathSegment(value: string, label: string): string {
  try {
    return safePathSegment(value, label);
  } catch (error) {
    throw new ComputerArtifactError("artifact-violation", `${label} contains unsupported characters.`, { cause: error });
  }
}

async function ensureManagedDirectory(rootDirectory: string, directory: string): Promise<void> {
  const root = path.resolve(rootDirectory);
  const target = managedPath(root, path.relative(root, directory));
  await mkdir(root, { recursive: true });
  const rootMetadata = await lstat(root).catch((error) => {
    throw new ComputerArtifactError("artifact-violation", "The computer artifact root could not be inspected.", { cause: error });
  });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new ComputerArtifactError("artifact-violation", "The computer artifact root must be a regular directory.");
  }
  await mkdir(target, { recursive: true });
  const targetMetadata = await lstat(target).catch((error) => {
    throw new ComputerArtifactError("artifact-violation", "The computer artifact directory could not be inspected.", { cause: error });
  });
  if (!targetMetadata.isDirectory() || targetMetadata.isSymbolicLink()) {
    throw new ComputerArtifactError("artifact-violation", "The computer artifact directory must not be a symlink.");
  }
}

function validDimension(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

function validateArtifact(value: unknown, expectedRunId?: string): asserts value is ComputerObservationArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComputerArtifactError("artifact-violation", "Computer artifact metadata is not an object.");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1
    || typeof candidate.artifactId !== "string" || candidate.artifactId.trim().length === 0
    || typeof candidate.runId !== "string" || candidate.runId.trim().length === 0
    || (expectedRunId !== undefined && candidate.runId !== expectedRunId)
    || typeof candidate.observationId !== "string" || candidate.observationId.trim().length === 0
    || typeof candidate.path !== "string" || candidate.path.trim().length === 0
    || typeof candidate.relativePath !== "string" || candidate.relativePath.trim().length === 0
    || candidate.mimeType !== "image/png"
    || !Number.isSafeInteger(candidate.byteSize) || (candidate.byteSize as number) < 0
    || typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))
    || !validDimension(candidate.width as number | undefined)
    || !validDimension(candidate.height as number | undefined)) {
    throw new ComputerArtifactError("artifact-violation", "Computer artifact metadata is invalid.");
  }
  artifactPathSegment(candidate.artifactId, "Computer artifact ID");
  artifactPathSegment(candidate.runId, "Computer run ID");
  artifactPathSegment(candidate.observationId, "Computer observation ID");
}

/** Owns opt-in immutable native observation copies and their bounded metadata. */
export class ComputerArtifactStore {
  private readonly maxBytes: number;
  private readonly maxWidth: number;
  private readonly maxHeight: number;
  private readonly now: () => string;
  private readonly createArtifactId: () => string;
  private readonly activeRuns = new Set<string>();

  constructor(private readonly rootDirectory: string, options: ComputerArtifactStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
    this.maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || !Number.isSafeInteger(this.maxWidth) || this.maxWidth <= 0 || !Number.isSafeInteger(this.maxHeight) || this.maxHeight <= 0) {
      throw new ComputerArtifactError("artifact-violation", "Computer artifact limits must be positive safe integers.");
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.createArtifactId = options.createArtifactId ?? defaultArtifactId;
  }

  beginRun(runId: string): void {
    this.activeRuns.add(artifactPathSegment(runId, "Computer run ID"));
  }

  endRun(runId: string): void {
    this.activeRuns.delete(artifactPathSegment(runId, "Computer run ID"));
  }

  async captureObservation(runId: string, observation: ComputerEnvironmentObservation): Promise<ComputerObservationArtifact | undefined> {
    const safeRunId = artifactPathSegment(runId, "Computer run ID");
    const safeObservationId = artifactPathSegment(observation.observationId, "Computer observation ID");
    if (!observation.screenshotPath) return undefined;
    const source = await lstat(observation.screenshotPath).catch((error) => {
      throw new ComputerArtifactError("artifact-violation", "The native observation screenshot could not be inspected.", { cause: error });
    });
    if (!source.isFile() || source.isSymbolicLink()) throw new ComputerArtifactError("artifact-violation", "The native observation screenshot must be a regular file.");
    if (source.size > this.maxBytes) throw new ComputerArtifactError("artifact-violation", `The native observation screenshot exceeded the ${this.maxBytes}-byte artifact limit.`);
    if (observation.screenWidth !== undefined && observation.screenWidth > this.maxWidth) throw new ComputerArtifactError("artifact-violation", `The native observation exceeded the ${this.maxWidth}-pixel artifact width limit.`);
    if (observation.screenHeight !== undefined && observation.screenHeight > this.maxHeight) throw new ComputerArtifactError("artifact-violation", `The native observation exceeded the ${this.maxHeight}-pixel artifact height limit.`);
    const artifactId = artifactPathSegment(this.createArtifactId(), "Computer artifact ID");
    const relativePath = path.posix.join(safeRunId, `${artifactId}.png`);
    const runDirectory = managedPath(this.rootDirectory, safeRunId);
    await ensureManagedDirectory(this.rootDirectory, runDirectory);
    const target = managedPath(this.rootDirectory, relativePath);
    const metadataPath = `${target}.json`;
    try {
      await copyFile(observation.screenshotPath, target, constants.COPYFILE_EXCL);
      const copied = await lstat(target);
      if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== source.size) throw new Error("the copied artifact did not match its source");
      const artifact: ComputerObservationArtifact = {
        schemaVersion: 1,
        artifactId,
        runId: safeRunId,
        observationId: safeObservationId,
        path: target,
        relativePath,
        mimeType: "image/png",
        byteSize: copied.size,
        createdAt: this.now(),
        ...(observation.screenWidth !== undefined ? { width: observation.screenWidth } : {}),
        ...(observation.screenHeight !== undefined ? { height: observation.screenHeight } : {}),
      };
      await atomicWriteJson(metadataPath, artifact);
      return artifact;
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      await rm(metadataPath, { force: true }).catch(() => undefined);
      if (error instanceof ComputerArtifactError) throw error;
      throw new ComputerArtifactError("artifact-violation", "The native observation artifact could not be published.", { cause: error });
    }
  }

  async cleanupExpired(options: ComputerArtifactCleanupOptions): Promise<ComputerArtifactCleanupResult> {
    if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) throw new ComputerArtifactError("artifact-violation", "Computer artifact cleanup maxAgeMs must be a non-negative integer.");
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) throw new ComputerArtifactError("artifact-violation", "Computer artifact cleanup maxEntries must be a positive integer.");
    const result = { ...emptyCleanupResult() } as { -readonly [K in keyof ComputerArtifactCleanupResult]: ComputerArtifactCleanupResult[K] };
    let runEntries;
    try {
      runEntries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
      throw new ComputerArtifactError("artifact-violation", "The computer artifact root could not be scanned.", { cause: error });
    }
    const currentTime = options.now ?? Date.now;
    for (const runEntry of runEntries) {
      if (result.scanned >= options.maxEntries) {
        result.truncated = true;
        break;
      }
      if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) {
        result.skipped += 1;
        continue;
      }
      let safeRunId: string;
      try {
        safeRunId = safePathSegment(runEntry.name, "Computer run ID");
      } catch {
        result.skipped += 1;
        continue;
      }
      if (this.activeRuns.has(safeRunId)) {
        // An active run is intentionally retained. Count its bounded artifact
        // pairs as retained so callers can distinguish retention from a scan
        // skip and verify that an in-flight run was not deleted.
        try {
          const activeEntries = await readdir(path.join(this.rootDirectory, safeRunId), { withFileTypes: true });
          result.retained += activeEntries.filter((entry) => !entry.isDirectory() && !entry.isSymbolicLink() && entry.name.endsWith(".png")).length;
        } catch {
          result.failed += 1;
        }
        continue;
      }
      const runDirectory = path.join(this.rootDirectory, safeRunId);
      let entries;
      try {
        entries = await readdir(runDirectory, { withFileTypes: true });
      } catch {
        result.failed += 1;
        continue;
      }
      // One PNG is one retention entry; its JSON sidecar belongs to that same
      // pair and must not consume a second cleanup budget slot.
      for (const entry of entries.filter((candidate) => !candidate.isDirectory() && !candidate.isSymbolicLink() && candidate.name.endsWith(".png"))) {
        if (result.scanned >= options.maxEntries) {
          result.truncated = true;
          break;
        }
        const dataName = entry.name;
        const artifactId = dataName.slice(0, -4);
        result.scanned += 1;
        try {
        artifactPathSegment(artifactId, "Computer artifact ID");
          const dataPath = path.join(runDirectory, `${artifactId}.png`);
          const metadataPath = `${dataPath}.json`;
          const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
          validateArtifact(metadata, safeRunId);
          const timestamp = Date.parse(metadata.createdAt);
          if (timestamp > currentTime() - options.maxAgeMs) {
            result.retained += 1;
            continue;
          }
          const lease = await SessionLock.acquire(path.join(this.rootDirectory, `.${safeRunId}-${artifactId}.retention.lock`)).catch((error: unknown) => {
            if (error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "lock") return undefined;
            throw error;
          });
          if (!lease) {
            result.retained += 1;
            continue;
          }
          try {
            await rm(dataPath, { force: true });
            await rm(metadataPath, { force: true });
            result.removed += 1;
          } finally {
            await lease.release().catch(() => undefined);
          }
        } catch {
          result.failed += 1;
        }
      }
      try {
        if ((await readdir(runDirectory)).length === 0) await rmdir(runDirectory);
      } catch {
        // Retention should report the artifact result even if empty-directory cleanup is unavailable.
      }
    }
    return result;
  }
}
