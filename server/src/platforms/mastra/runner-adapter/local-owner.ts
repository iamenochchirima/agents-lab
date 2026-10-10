import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** A local PID lease. It provides one owner on this host, not distributed ownership. */
export async function acquireLocalOwner(directory: string): Promise<(() => Promise<void>) | null> {
  const path = join(directory, "owner.json");
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, "wx", 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); } finally { await file.close(); }
      return async () => {
        const owner = JSON.parse(await readFile(path, "utf8"));
        if (owner.token === token) await unlink(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid: number; token: string };
      try { owner = JSON.parse(await readFile(path, "utf8")); } catch { return null; }
      if (!Number.isInteger(owner.pid) || owner.pid < 1 || !owner.token) return null;
      try { process.kill(owner.pid, 0); return null; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return null;
      }
      // Serialize dead-owner reclamation. A token check followed by unlink alone
      // could delete a new live lease if two contenders reclaim concurrently.
      const reclaimPath = join(directory, "owner-reclaim.lock");
      let reclaim;
      try { reclaim = await open(reclaimPath, "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return null; throw error; }
      try {
        const current = JSON.parse(await readFile(path, "utf8"));
        if (current.token !== owner.token) return null;
        await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
      } finally { await reclaim.close(); await unlink(reclaimPath); }

    }
  }
  return null;
}
