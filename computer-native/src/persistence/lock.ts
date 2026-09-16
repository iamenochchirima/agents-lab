import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ComputerNativeError } from "../runtime/errors.js";
import { ensureDirectory } from "./json.js";

export class SessionLock {
  private constructor(private readonly filePath: string, private readonly handle: Awaited<ReturnType<typeof open>>) {}

  static async acquire(filePath: string, options: { readonly waitMs?: number } = {}): Promise<SessionLock> {
    await ensureDirectory(path.dirname(filePath));
    try {
      const handle = await open(filePath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.sync();
      return new SessionLock(filePath, handle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ComputerNativeError("lock", "Could not acquire the session lock.", { cause: error });
      }
      let ownerPid: number | undefined;
      try {
        const content = JSON.parse(await readFile(filePath, "utf8")) as { pid?: unknown };
        ownerPid = typeof content.pid === "number" ? content.pid : undefined;
      } catch {
        await rm(filePath, { force: true });
        return SessionLock.acquire(filePath);
      }
      if (ownerPid !== undefined) {
        try {
          process.kill(ownerPid, 0);
          if ((options.waitMs ?? 0) > 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(10, options.waitMs ?? 0)));
            return SessionLock.acquire(filePath, { waitMs: Math.max(0, (options.waitMs ?? 0) - 10) });
          }
          throw new ComputerNativeError("lock", `Session is already in use by process ${ownerPid}.`);
        } catch (probeError) {
          if (probeError instanceof ComputerNativeError) throw probeError;
        }
      }
      await rm(filePath, { force: true });
      return SessionLock.acquire(filePath);
    }
  }

  async release(): Promise<void> {
    await this.handle.close();
    await rm(this.filePath, { force: true });
  }
}
