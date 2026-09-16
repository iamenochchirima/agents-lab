import { open, readFile, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { ComputerNativeError } from "../runtime/errors.js";
import { ensureDirectory } from "./json.js";

interface LockProcessIdentity {
  readonly platform: NodeJS.Platform;
  readonly executablePath: string;
  readonly startTime: string;
}

interface LockRecord {
  readonly pid?: unknown;
  readonly createdAt?: unknown;
  readonly processIdentity?: unknown;
}

async function readProcessIdentity(pid: number): Promise<LockProcessIdentity | undefined> {
  if (process.platform !== "linux") return undefined;
  try {
    const [executablePath, stat] = await Promise.all([
      readlink(`/proc/${pid}/exe`),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return undefined;
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
    const startTime = fields[19];
    if (!startTime) return undefined;
    return { platform: process.platform, executablePath, startTime };
  } catch {
    return undefined;
  }
}

function isProcessIdentity(value: unknown): value is LockProcessIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.platform === process.platform
    && typeof candidate.executablePath === "string"
    && candidate.executablePath.length > 0
    && typeof candidate.startTime === "string"
    && candidate.startTime.length > 0;
}

function sameProcessIdentity(left: LockProcessIdentity, right: LockProcessIdentity): boolean {
  return left.platform === right.platform
    && left.executablePath === right.executablePath
    && left.startTime === right.startTime;
}

export class SessionLock {
  private constructor(private readonly filePath: string, private readonly handle: Awaited<ReturnType<typeof open>>) {}

  static async acquire(filePath: string, options: { readonly waitMs?: number } = {}): Promise<SessionLock> {
    await ensureDirectory(path.dirname(filePath));
    try {
      const handle = await open(filePath, "wx", 0o600);
      const processIdentity = await readProcessIdentity(process.pid);
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        ...(processIdentity ? { processIdentity } : {}),
      }));
      await handle.sync();
      return new SessionLock(filePath, handle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ComputerNativeError("lock", "Could not acquire the session lock.", { cause: error });
      }
      let ownerPid: number | undefined;
      let ownerIdentity: LockProcessIdentity | undefined;
      let rawContent: string;
      try {
        rawContent = await readFile(filePath, "utf8");
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") return SessionLock.acquire(filePath, options);
        throw new ComputerNativeError("lock", "The existing session lock could not be inspected.", { cause: readError });
      }
      let content: LockRecord;
      try {
        content = JSON.parse(rawContent) as LockRecord;
      } catch (parseError) {
        // Exclusive creation happens before metadata can be written. A competing
        // opener may briefly observe an empty or partial file; wait for the owner
        // to finish publishing it instead of deleting a potentially live lock.
        if ((options.waitMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(10, options.waitMs ?? 0)));
          return SessionLock.acquire(filePath, { waitMs: Math.max(0, (options.waitMs ?? 0) - 10) });
        }
        throw new ComputerNativeError("lock", "The existing session lock metadata is invalid; refusing to remove it.", { cause: parseError });
      }
      ownerPid = typeof content.pid === "number" && Number.isSafeInteger(content.pid) && content.pid > 0 ? content.pid : undefined;
      ownerIdentity = isProcessIdentity(content.processIdentity) ? content.processIdentity : undefined;
      if (ownerPid !== undefined) {
        const currentIdentity = ownerIdentity ? await readProcessIdentity(ownerPid) : undefined;
        if (ownerIdentity && currentIdentity && !sameProcessIdentity(ownerIdentity, currentIdentity)) {
          await rm(filePath, { force: true });
          return SessionLock.acquire(filePath, options);
        }
        try {
          process.kill(ownerPid, 0);
          if ((options.waitMs ?? 0) > 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(10, options.waitMs ?? 0)));
            return SessionLock.acquire(filePath, { waitMs: Math.max(0, (options.waitMs ?? 0) - 10) });
          }
          throw new ComputerNativeError(
            "lock",
            ownerIdentity && !currentIdentity
              ? `Session ownership for process ${ownerPid} could not be verified; refusing to remove the lock.`
              : `Session is already in use by process ${ownerPid}.`,
          );
        } catch (probeError) {
          if (probeError instanceof ComputerNativeError) throw probeError;
          if ((probeError as NodeJS.ErrnoException | undefined)?.code === "EPERM") {
            throw new ComputerNativeError("lock", `Session owner process ${ownerPid} exists but could not be probed.`, { cause: probeError });
          }
        }
      }
      await rm(filePath, { force: true });
      return SessionLock.acquire(filePath, options);
    }
  }

  async release(): Promise<void> {
    await this.handle.close();
    await rm(this.filePath, { force: true });
  }
}
