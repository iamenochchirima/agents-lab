import { chmod, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { safePathSegment } from "../persistence/json.js";
import { AnesuError } from "../runtime/errors.js";
import { SessionLock } from "../persistence/lock.js";

export interface BrowserCleanupOptions {
  readonly maxAgeMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

export interface BrowserCleanupResult {
  readonly scanned: number;
  readonly removed: number;
  readonly retained: number;
  readonly skipped: number;
  readonly failed: number;
  readonly truncated: boolean;
}

function validateOptions(options: BrowserCleanupOptions): void {
  if (!Number.isInteger(options.maxAgeMs) || options.maxAgeMs < 0) {
    throw new TypeError("Browser cleanup maxAgeMs must be a non-negative integer.");
  }
  if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
    throw new TypeError("Browser cleanup maxEntries must be a positive integer.");
  }
}

function emptyResult(): BrowserCleanupResult {
  return { scanned: 0, removed: 0, retained: 0, skipped: 0, failed: 0, truncated: false };
}

function managedProfileName(name: string): boolean {
  return /^browser_[a-f0-9]{32}$/u.test(name);
}

export interface BrowserProfileLease {
  release(): Promise<void>;
}

/**
 * Owns one managed browser profile for the lifetime of a local browser session.
 * The lock file is intentionally inside the profile so cleanup can distinguish an
 * old abandoned profile from one still owned by another process.
 */
export async function acquireBrowserProfileLease(profileDirectory: string): Promise<BrowserProfileLease> {
  await ensurePrivateProfileDirectory(profileDirectory);
  return SessionLock.acquire(path.join(profileDirectory, ".anesu-profile.lock"));
}

/**
 * Removes only old, generated browser profile directories below the caller's
 * explicit managed root. Recent profiles, unknown entries, symlinks, and entries
 * beyond the operation bound are retained for an operator to inspect.
 */
export async function cleanupOrphanedBrowserProfiles(
  rootDirectory: string,
  options: BrowserCleanupOptions,
): Promise<BrowserCleanupResult> {
  validateOptions(options);
  const now = options.now ?? Date.now;
  let entries;
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyResult();
    throw error;
  }

  const root = path.resolve(rootDirectory);
  const result = { ...emptyResult() } as { -readonly [K in keyof BrowserCleanupResult]: BrowserCleanupResult[K] };
  for (const entry of entries) {
    if (result.scanned >= options.maxEntries) {
      result.truncated = true;
      break;
    }
    result.scanned += 1;
    if (!managedProfileName(entry.name)) {
      result.skipped += 1;
      continue;
    }
    const safeName = safePathSegment(entry.name, "Browser profile name");
    const candidate = path.resolve(root, safeName);
    if (!candidate.startsWith(`${root}${path.sep}`)) {
      result.skipped += 1;
      continue;
    }
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch {
      result.skipped += 1;
      continue;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      result.skipped += 1;
      continue;
    }
    if (metadata.mtimeMs > now() - options.maxAgeMs) {
      result.retained += 1;
      continue;
    }
    let lease: BrowserProfileLease | undefined;
    try {
      lease = await acquireCleanupProfileLease(path.join(candidate, ".anesu-profile.lock"));
    } catch {
      result.skipped += 1;
      continue;
    }
    if (!lease) {
      result.retained += 1;
      continue;
    }
    try {
      await rm(candidate, { recursive: true, force: true });
      result.removed += 1;
    } catch {
      result.failed += 1;
    } finally {
      await lease.release().catch(() => undefined);
    }
  }
  return result;
}

async function acquireCleanupProfileLease(lockPath: string): Promise<BrowserProfileLease | undefined> {
  try {
    return await SessionLock.acquire(lockPath);
  } catch (error) {
    if (error instanceof AnesuError && error.code === "lock") return undefined;
    throw error;
  }
}

async function ensurePrivateProfileDirectory(profileDirectory: string): Promise<void> {
  try {
    const metadata = await lstat(profileDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Browser profile directory must be a real directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  }
  await chmod(profileDirectory, 0o700);
}
