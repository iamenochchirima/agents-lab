import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VercelWorkflowProgress } from "../contracts.js";

/** Step-owned projection. Workflow history remains authoritative for replay. */
export class ProgressStore {
  constructor(readonly directory: string) {}
  private path(runId: string): string {
    return join(this.directory, `${createHash("sha256").update(runId).digest("hex")}.json`);
  }
  async read(runId: string): Promise<VercelWorkflowProgress | null> {
    try { return JSON.parse(await readFile(this.path(runId), "utf8")) as VercelWorkflowProgress; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async write(runId: string, progress: VercelWorkflowProgress): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.path(runId);
    const prior = await this.read(runId);
    // A replayed step whose acknowledgement was lost must not roll back the
    // later projection. Each write includes the complete monotonic event list.
    if (prior && prior.eventIntents.length > progress.eventIntents.length) return;
    await writeFile(`${path}.tmp`, JSON.stringify(progress), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
}
