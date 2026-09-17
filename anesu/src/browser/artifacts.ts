import { randomUUID } from "node:crypto";
import { atomicWriteJson, safePathSegment } from "../persistence/json.js";
import { AnesuError } from "../runtime/errors.js";
import { SessionLock } from "../persistence/lock.js";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { BrowserError } from "./errors.js";
import type { BrowserSessionId, BrowserTabId } from "./contracts.js";
import type { BrowserScreenshotCapture } from "./contracts.js";
import type { BrowserCleanupOptions, BrowserCleanupResult } from "./cleanup.js";

export interface BrowserArtifactInfo {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly kind: "screenshot" | "download";
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly path: string;
  readonly mimeType: "image/png" | "application/octet-stream";
  readonly byteSize: number;
  readonly createdAt: string;
  readonly width?: number;
  readonly height?: number;
  readonly fileName?: string;
}

export interface BrowserScreenshotTarget {
  readonly artifactId: string;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly path: string;
  readonly maxBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface BrowserDownloadTarget {
  readonly artifactId: string;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly path: string;
  readonly maxBytes: number;
}

export interface BrowserDownloadCapture {
  readonly byteSize: number;
  readonly fileName: string;
}

export interface BrowserArtifactStoreOptions {
  readonly maxScreenshotBytes?: number;
  readonly maxScreenshotWidth?: number;
  readonly maxScreenshotHeight?: number;
  readonly maxDownloadBytes?: number;
  readonly now?: () => string;
  readonly createArtifactId?: () => string;
}

function defaultArtifactId(): string {
  return `artifact_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Owns browser-generated files. Callers receive a target only inside the managed root;
 * finalization verifies the resulting file before writing durable metadata. A failed
 * or oversized capture is removed rather than being exposed as a usable artifact.
 */
export class BrowserArtifactStore {
  private readonly maxScreenshotBytes: number;
  private readonly maxScreenshotWidth: number;
  private readonly maxScreenshotHeight: number;
  private readonly maxDownloadBytes: number;
  private readonly now: () => string;
  private readonly createArtifactId: () => string;
  private readonly artifactLeases = new Map<string, SessionLock>();

  constructor(private readonly rootDirectory: string, options: BrowserArtifactStoreOptions = {}) {
    this.maxScreenshotBytes = options.maxScreenshotBytes ?? 4 * 1024 * 1024;
    if (!Number.isInteger(this.maxScreenshotBytes) || this.maxScreenshotBytes <= 0) {
      throw new BrowserError("artifact-violation", "The browser screenshot byte limit must be a positive integer.");
    }
    this.maxScreenshotWidth = options.maxScreenshotWidth ?? 1_920;
    if (!Number.isInteger(this.maxScreenshotWidth) || this.maxScreenshotWidth <= 0) {
      throw new BrowserError("artifact-violation", "The browser screenshot width limit must be a positive integer.");
    }
    this.maxScreenshotHeight = options.maxScreenshotHeight ?? 1_080;
    if (!Number.isInteger(this.maxScreenshotHeight) || this.maxScreenshotHeight <= 0) {
      throw new BrowserError("artifact-violation", "The browser screenshot height limit must be a positive integer.");
    }
    this.maxDownloadBytes = options.maxDownloadBytes ?? this.maxScreenshotBytes;
    if (!Number.isInteger(this.maxDownloadBytes) || this.maxDownloadBytes <= 0) {
      throw new BrowserError("artifact-violation", "The browser download byte limit must be a positive integer.");
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.createArtifactId = options.createArtifactId ?? defaultArtifactId;
  }

  async createScreenshotTarget(sessionId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserScreenshotTarget> {
    const safeSession = safePathSegment(sessionId, "Browser session ID");
    safePathSegment(tabId, "Browser tab ID");
    const artifactId = safePathSegment(this.createArtifactId(), "Browser artifact ID");
    const directory = path.join(this.rootDirectory, safeSession, "screenshots");
    await ensureManagedDirectory(this.rootDirectory, directory);
    const targetPath = path.join(directory, `${artifactId}.png`);
    await this.acquireArtifactLease(targetPath);
    return {
      artifactId,
      sessionId,
      tabId,
      path: targetPath,
      maxBytes: this.maxScreenshotBytes,
      maxWidth: this.maxScreenshotWidth,
      maxHeight: this.maxScreenshotHeight,
    };
  }

  async finalizeScreenshot(target: BrowserScreenshotTarget, capture: BrowserScreenshotCapture): Promise<BrowserArtifactInfo> {
    this.requireArtifactLease(target.path);
    let file;
    try {
      file = await lstat(target.path);
    } catch (error) {
      await this.discardScreenshot(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", "The browser screenshot was not created.", { cause: error });
    }
    const dimensions = file.isFile() && !file.isSymbolicLink() && file.size <= target.maxBytes
      ? await readPngDimensions(target.path)
      : undefined;
    if (!file.isFile() || file.size > target.maxBytes || !dimensions
      || dimensions.width > target.maxWidth || dimensions.height > target.maxHeight
      || capture.byteSize !== file.size || capture.width !== dimensions.width || capture.height !== dimensions.height) {
      await this.discardScreenshot(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", `The browser screenshot exceeded its ${target.maxBytes}-byte, ${target.maxWidth}x${target.maxHeight} pixel, or PNG validity limit.`);
    }
    const artifact: BrowserArtifactInfo = {
      schemaVersion: 1,
      artifactId: target.artifactId,
      kind: "screenshot",
      sessionId: target.sessionId,
      tabId: target.tabId,
      path: target.path,
      mimeType: "image/png",
      byteSize: file.size,
      createdAt: this.now(),
      width: dimensions.width,
      height: dimensions.height,
    };
    try {
      await atomicWriteJson(`${target.path}.json`, artifact);
    } catch (error) {
      await this.discardScreenshot(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", "Browser screenshot metadata could not be persisted.", { cause: error });
    }
    await this.releaseArtifactLease(target.path);
    return artifact;
  }

  async createDownloadTarget(sessionId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserDownloadTarget> {
    const safeSession = safePathSegment(sessionId, "Browser session ID");
    safePathSegment(tabId, "Browser tab ID");
    const artifactId = safePathSegment(this.createArtifactId(), "Browser artifact ID");
    const directory = path.join(this.rootDirectory, safeSession, "downloads");
    await ensureManagedDirectory(this.rootDirectory, directory);
    const targetPath = path.join(directory, `${artifactId}.download`);
    await this.acquireArtifactLease(targetPath);
    return {
      artifactId,
      sessionId,
      tabId,
      path: targetPath,
      maxBytes: this.maxDownloadBytes,
    };
  }

  async finalizeDownload(target: BrowserDownloadTarget, capture: BrowserDownloadCapture): Promise<BrowserArtifactInfo> {
    this.requireArtifactLease(target.path);
    let file;
    try {
      file = await lstat(target.path);
    } catch (error) {
      await this.discardDownload(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", "The browser download was not created.", { cause: error });
    }
    if (!file.isFile() || file.isSymbolicLink() || file.size > target.maxBytes || capture.byteSize !== file.size) {
      await this.discardDownload(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", `The browser download exceeded the ${target.maxBytes}-byte limit or did not match the adapter observation.`);
    }
    const artifact: BrowserArtifactInfo = {
      schemaVersion: 1,
      artifactId: target.artifactId,
      kind: "download",
      sessionId: target.sessionId,
      tabId: target.tabId,
      path: target.path,
      mimeType: "application/octet-stream",
      byteSize: file.size,
      fileName: sanitizeFileName(capture.fileName),
      createdAt: this.now(),
    };
    try {
      await atomicWriteJson(`${target.path}.json`, artifact);
    } catch (error) {
      await this.discardDownload(target).catch(() => undefined);
      throw new BrowserError("artifact-violation", "Browser download metadata could not be persisted.", { cause: error });
    }
    await this.releaseArtifactLease(target.path);
    return artifact;
  }

  async discardScreenshot(target: BrowserScreenshotTarget): Promise<void> {
    try {
      await rm(target.path, { force: true });
      await rm(`${target.path}.json`, { force: true });
    } finally {
      await this.releaseArtifactLease(target.path).catch(() => undefined);
    }
  }

  async discardDownload(target: BrowserDownloadTarget): Promise<void> {
    try {
      await rm(target.path, { force: true });
      await rm(`${target.path}.json`, { force: true });
    } finally {
      await this.releaseArtifactLease(target.path).catch(() => undefined);
    }
  }

  /**
   * Removes only expired managed artifact pairs or incomplete artifact files. The
   * retention age and candidate count are explicit so cleanup cannot become an
   * unbounded deletion pass over the state directory.
   */
  async cleanupExpired(options: BrowserCleanupOptions): Promise<BrowserCleanupResult> {
    if (!Number.isInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
      throw new BrowserError("artifact-violation", "Browser artifact cleanup maxAgeMs must be a non-negative integer.");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new BrowserError("artifact-violation", "Browser artifact cleanup maxEntries must be a positive integer.");
    }
    const now = options.now ?? Date.now;
    let sessionEntries;
    try {
      sessionEntries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyCleanupResult();
      throw new BrowserError("artifact-violation", "The managed browser artifact root could not be scanned.", { cause: error });
    }

    const result = { ...emptyCleanupResult() } as { -readonly [K in keyof BrowserCleanupResult]: BrowserCleanupResult[K] };
    const root = path.resolve(this.rootDirectory);
    for (const sessionEntry of sessionEntries) {
      if (result.scanned >= options.maxEntries) {
        result.truncated = true;
        break;
      }
      if (!sessionEntry.isDirectory() || sessionEntry.isSymbolicLink()) {
        result.skipped += 1;
        continue;
      }
      let sessionName: string;
      try {
        sessionName = safePathSegment(sessionEntry.name, "Browser session ID");
      } catch {
        result.skipped += 1;
        continue;
      }
      const sessionDirectory = path.resolve(root, sessionName);
      if (!sessionDirectory.startsWith(`${root}${path.sep}`)) {
        result.skipped += 1;
        continue;
      }
      for (const kind of ["screenshots", "downloads"] as const) {
        if (result.scanned >= options.maxEntries) {
          result.truncated = true;
          break;
        }
        const kindDirectory = path.join(sessionDirectory, kind);
        let kindMetadata;
        try {
          kindMetadata = await lstat(kindDirectory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.failed += 1;
          continue;
        }
        if (!kindMetadata.isDirectory() || kindMetadata.isSymbolicLink()) {
          result.skipped += 1;
          continue;
        }
        let artifactEntries;
        try {
          artifactEntries = await readdir(kindDirectory, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.failed += 1;
          continue;
        }
        const dataExtension = kind === "screenshots" ? ".png" : ".download";
        const candidates = new Set<string>();
        const temporaryMetadataByDataName = new Map<string, string[]>();
        for (const entry of artifactEntries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) continue;
          if (entry.name.endsWith(dataExtension)) candidates.add(entry.name);
          else if (entry.name.endsWith(`${dataExtension}.json`)) candidates.add(entry.name.slice(0, -5));
          else {
            const dataName = temporaryMetadataDataName(entry.name, dataExtension);
            if (dataName) {
              candidates.add(dataName);
              const paths = temporaryMetadataByDataName.get(dataName) ?? [];
              paths.push(path.join(kindDirectory, entry.name));
              temporaryMetadataByDataName.set(dataName, paths);
            }
          }
        }
        for (const dataName of candidates) {
          if (result.scanned >= options.maxEntries) {
            result.truncated = true;
            break;
          }
          result.scanned += 1;
          const baseName = dataName.slice(0, -dataExtension.length);
          try {
            safePathSegment(baseName, "Browser artifact ID");
          } catch {
            result.skipped += 1;
            continue;
          }
          const dataPath = path.join(kindDirectory, dataName);
          const metadataPath = path.join(kindDirectory, `${dataName}.json`);
          const temporaryMetadataPaths = temporaryMetadataByDataName.get(dataName) ?? [];
          const dataExists = await regularFile(dataPath);
          const metadataExists = await regularFile(metadataPath);
          if (!dataExists && !metadataExists && temporaryMetadataPaths.length === 0) {
            result.skipped += 1;
            continue;
          }
          const timestamp = await artifactTimestamp(metadataPath, dataPath, temporaryMetadataPaths);
          if (timestamp > now() - options.maxAgeMs) {
            result.retained += 1;
            continue;
          }
          const lease = await acquireCleanupLease(`${dataPath}.lock`);
          if (!lease) {
            result.retained += 1;
            continue;
          }
          try {
            if (dataExists) await rm(dataPath, { force: true });
            if (metadataExists) await rm(metadataPath, { force: true });
            for (const temporaryMetadataPath of temporaryMetadataPaths) {
              await rm(temporaryMetadataPath, { force: true });
            }
            result.removed += 1;
          } catch {
            result.failed += 1;
          } finally {
            await lease.release().catch(() => undefined);
          }
        }
      }
    }
    return result;
  }

  private async acquireArtifactLease(filePath: string): Promise<void> {
    try {
      const lease = await SessionLock.acquire(`${filePath}.lock`);
      this.artifactLeases.set(filePath, lease);
    } catch (error) {
      if (error instanceof AnesuError && error.code === "lock") {
        throw new BrowserError("artifact-violation", "The browser artifact target is already in use.", { cause: error });
      }
      throw error;
    }
  }

  private requireArtifactLease(filePath: string): void {
    if (!this.artifactLeases.has(filePath)) {
      throw new BrowserError("artifact-violation", "The browser artifact target is not owned by this artifact store.");
    }
  }

  private async releaseArtifactLease(filePath: string): Promise<void> {
    const lease = this.artifactLeases.get(filePath);
    if (!lease) return;
    this.artifactLeases.delete(filePath);
    await lease.release();
  }
}

function emptyCleanupResult(): BrowserCleanupResult {
  return { scanned: 0, removed: 0, retained: 0, skipped: 0, failed: 0, truncated: false };
}

async function acquireCleanupLease(filePath: string): Promise<SessionLock | undefined> {
  try {
    return await SessionLock.acquire(filePath);
  } catch (error) {
    if (error instanceof AnesuError && error.code === "lock") return undefined;
    throw error;
  }
}

async function ensureManagedDirectory(rootDirectory: string, directory: string): Promise<void> {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(directory);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new BrowserError("artifact-violation", "The browser artifact directory escaped its managed root.");
  }
  try {
    await mkdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new BrowserError("artifact-violation", "The browser artifact root could not be created.", { cause: error });
    }
  }
  const rootMetadata = await lstat(root).catch((error) => {
    throw new BrowserError("artifact-violation", "The browser artifact root could not be inspected.", { cause: error });
  });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new BrowserError("artifact-violation", "The browser artifact root must be a regular directory.");
  }
  const parts = path.relative(root, target).split(path.sep).filter((part) => part.length > 0);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new BrowserError("artifact-violation", "The browser artifact directory could not be created.", { cause: error });
      }
    }
    const metadata = await lstat(current).catch((error) => {
      throw new BrowserError("artifact-violation", "The browser artifact directory could not be inspected.", { cause: error });
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new BrowserError("artifact-violation", "The browser artifact directory contains a symbolic link or non-directory entry.");
    }
  }
}

export async function readPngDimensions(filePath: string): Promise<{ readonly width: number; readonly height: number } | undefined> {
  let header: Buffer;
  try {
    header = await readFile(filePath);
  } catch {
    return undefined;
  }
  if (header.length < 24) return undefined;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!header.subarray(0, 8).equals(signature)) return undefined;
  if (header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR") return undefined;
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

async function regularFile(filePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function artifactTimestamp(metadataPath: string, dataPath: string, temporaryMetadataPaths: readonly string[] = []): Promise<number> {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { readonly createdAt?: unknown };
    if (typeof metadata.createdAt === "string") {
      const parsed = Date.parse(metadata.createdAt);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // Fall back to the file mtime for a partial or malformed metadata record.
  }
  try {
    return (await lstat(dataPath)).mtimeMs;
  } catch {
    let latestTemporaryTimestamp = 0;
    for (const temporaryMetadataPath of temporaryMetadataPaths) {
      try {
        latestTemporaryTimestamp = Math.max(latestTemporaryTimestamp, (await lstat(temporaryMetadataPath)).mtimeMs);
      } catch {
        // A concurrent cleanup may remove a temporary candidate before its timestamp is read.
      }
    }
    return latestTemporaryTimestamp > 0 ? latestTemporaryTimestamp : Date.now();
  }
}

function temporaryMetadataDataName(name: string, dataExtension: ".png" | ".download"): string | undefined {
  const marker = `${dataExtension}.json.tmp-`;
  const markerIndex = name.indexOf(marker);
  if (markerIndex <= 0 || markerIndex + marker.length >= name.length) return undefined;
  return name.slice(0, markerIndex + dataExtension.length);
}

function sanitizeFileName(value: string): string {
  const base = path.basename(value).replace(/[\u0000-\u001f/\\]/gu, "_").trim();
  return base.length > 0 && base !== "." && base !== ".." ? base.slice(0, 128) : "download.bin";
}
