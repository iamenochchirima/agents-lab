import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { emptyManagedState, MAX_MANAGED_STATE_BYTES, validateManagedState, type ManagedState } from "./records.js";

export class ManagedRevisionConflict extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) { super("Capability configuration changed. Reload before saving."); this.name = "ManagedRevisionConflict"; }
}
export class ManagedWriterConflict extends Error { constructor() { super("Another capability management writer owns this storage directory."); this.name = "ManagedWriterConflict"; } }
type Seed = Omit<ManagedState, "schemaVersion" | "revision" | "operations" | "installations"> & Partial<Pick<ManagedState, "operations" | "installations">>;
interface WriterLock { pid: number; token: string }

/** Single local writer with immutable generations and atomic publication.
 * A complete, fsynced generation precedes the current pointer. Readers never use
 * unreferenced generations; a crash before pointer publication preserves the
 * previous configuration. This is local-disk durability, not a distributed lock.
 */
export class ManagedRepository {
  private state: ManagedState = emptyManagedState();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private constructor(readonly root: string, private readonly lock: WriterLock) {}
  static async open(root: string): Promise<ManagedRepository> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lock = { pid: process.pid, token: randomUUID() };
    await acquireLock(root, lock);
    const repository = new ManagedRepository(root, lock);
    try {
      const pointer = await readBounded(join(root, "current.json"), 1024).catch(error => { if (missing(error)) return null; throw error; });
      if (pointer !== null) {
        const revision = pointerRevision(pointer);
        const value: unknown = JSON.parse(await readBounded(repository.generationPath(revision), MAX_MANAGED_STATE_BYTES));
        validateManagedState(value); if (value.revision !== revision) throw new Error("Managed generation revision does not match the published pointer.");
        repository.state = value;
      }
      return repository;
    } catch (error) { await repository.close(); throw error; }
  }
  /** Return a copy so callers cannot mutate the published in-memory generation. */
  read(): ManagedState { this.assertOpen(); return structuredClone(this.state); }
  /** Read only the ancestry of published states, oldest first. Orphaned staged
   * generations are never history even if their number is below the current one.
   * Repositories predating ancestry records expose their current state as the
   * migration boundary; we cannot infer which earlier files were published.
   */
  async readGenerations(): Promise<ManagedState[]> {
    this.assertOpen();
    const states: ManagedState[] = [];
    let revision = this.state.revision;
    while (revision > 0) {
      if (states.length >= 10_000) throw new Error("Managed publication history exceeds its inspection limit.");
      const value: unknown = JSON.parse(await readBounded(this.generationPath(revision), MAX_MANAGED_STATE_BYTES));
      validateManagedState(value);
      if (value.revision !== revision) throw new Error("Managed history generation identity is invalid.");
      states.push(value);
      const parentText = await readBounded(this.parentPath(revision), 1024).catch(error => { if (missing(error)) return null; throw error; });
      if (parentText === null) break;
      const parent: unknown = JSON.parse(parentText);
      if (!parent || typeof parent !== "object" || Array.isArray(parent) || Object.keys(parent).some(key => !["schemaVersion", "revision", "parentRevision"].includes(key))) throw new Error("Managed publication ancestry is invalid.");
      const entry = parent as { schemaVersion: number; revision: number; parentRevision: number };
      if (entry.schemaVersion !== 1 || entry.revision !== revision || !Number.isSafeInteger(entry.parentRevision) || entry.parentRevision < 0 || entry.parentRevision >= revision) throw new Error("Managed publication ancestry is invalid.");
      revision = entry.parentRevision;
    }
    return states.reverse();
  }
  generations(): Promise<ManagedState[]> { return this.readGenerations(); }
  mutate(expectedRevision: number, edit: (draft: ManagedState) => void | Promise<void>): Promise<ManagedState> {
    const operation = this.queue.then(async () => {
      this.assertOpen(); await this.assertLock();
      if (expectedRevision !== this.state.revision) throw new ManagedRevisionConflict(expectedRevision, this.state.revision);
      const draft = structuredClone(this.state); await edit(draft);
      draft.schemaVersion = 1; draft.revision = this.state.revision + 1;
      validateManagedState(draft);
      // Keep revision numbers monotonic even when a previous crash left a staged generation.
      const names = await readdir(this.root);
      let revision = draft.revision;
      while (names.includes(`generation-${revision}.json`)) revision++;
      draft.revision = revision;
      const generation = this.generationPath(revision);
      await durableWrite(generation, JSON.stringify(draft), "wx");
      await durableWrite(this.parentPath(revision), JSON.stringify({ schemaVersion: 1, revision, parentRevision: this.state.revision }), "wx");
      await syncDirectory(this.root);
      const temporaryPointer = join(this.root, `current-${this.lock.token}.tmp`);
      await durableWrite(temporaryPointer, JSON.stringify({ schemaVersion: 1, revision }), "w");
      await rename(temporaryPointer, join(this.root, "current.json"));
      // Publication has occurred. Keep this process aligned even if the final
      // directory flush fails; a failed acknowledgement must not invite replay.
      this.state = structuredClone(draft);
      await syncDirectory(this.root);
      return this.read();
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  /** Trusted development import is explicit and never overwrites managed records. */
  importSeed(seed: Seed, expectedRevision = this.state.revision): Promise<ManagedState> {
    return this.mutate(expectedRevision, draft => {
      for (const field of ["connections", "packages", "profiles", "installations"] as const) {
        const incoming = seed[field] ?? [];
        const current = draft[field] as unknown as Record<string, unknown>[];
        for (const item of incoming) {
          const key = field === "connections" ? "ref" : "id";
          if (!current.some(existing => existing[key] === (item as unknown as Record<string, unknown>)[key])) current.push(structuredClone(item) as unknown as Record<string, unknown>);
        }
      }
    });
  }
  /** Unfinished intents are inspectable; reconciliation decides cleanup explicitly. */
  pendingOperations(): ManagedState["operations"] { return this.read().operations.filter(operation => operation.status === "staged"); }
  async reconcileOperations(resolve: (operation: ManagedState["operations"][number]) => Promise<"committed" | "abandoned">): Promise<ManagedState> {
    const snapshot = this.read(); const outcomes = new Map<string, "committed" | "abandoned">();
    for (const operation of snapshot.operations.filter(value => value.status === "staged")) outcomes.set(operation.id, await resolve(structuredClone(operation)));
    if (!outcomes.size) return snapshot;
    return this.mutate(snapshot.revision, draft => { for (const operation of draft.operations) { const status = outcomes.get(operation.id); if (status) operation.status = status; } });
  }
  async close(): Promise<void> {
    await this.queue; if (this.closed) return; this.closed = true;
    try { const existing = JSON.parse(await readBounded(join(this.root, "writer.lock"), 1024)) as WriterLock; if (existing.token === this.lock.token) await rm(join(this.root, "writer.lock")); } catch (error) { if (!missing(error)) throw error; }
  }
  private assertOpen(): void { if (this.closed) throw new Error("Capability management repository is closed."); }
  private async assertLock(): Promise<void> { const lock: unknown = JSON.parse(await readBounded(join(this.root, "writer.lock"), 1024)); if (!lock || typeof lock !== "object" || (lock as WriterLock).token !== this.lock.token) throw new ManagedWriterConflict(); }
  private generationPath(revision: number): string { return join(this.root, `generation-${revision}.json`); }
  private parentPath(revision: number): string { return join(this.root, `generation-${revision}.parent.json`); }
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
function pointerRevision(value: string): number { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some(key => !["schemaVersion", "revision"].includes(key)) || (parsed as { schemaVersion?: number }).schemaVersion !== 1 || !Number.isSafeInteger((parsed as { revision?: number }).revision) || Number((parsed as { revision?: number }).revision) < 0) throw new Error("Managed current generation pointer is invalid."); return (parsed as { revision: number }).revision; }
async function readBounded(path: string, maximum: number): Promise<string> { if ((await stat(path)).size > maximum) throw new Error("Managed repository file exceeds its size limit."); const bytes = await readFile(path); if (bytes.length > maximum) throw new Error("Managed repository file exceeds its size limit."); return bytes.toString("utf8"); }
async function durableWrite(path: string, value: string, flags: "w" | "wx"): Promise<void> { const file = await open(path, flags, 0o600); try { await file.writeFile(value); await file.sync(); } finally { await file.close(); } }
async function syncDirectory(path: string): Promise<void> { const directory = await open(path, "r"); try { await directory.sync(); } finally { await directory.close(); } }
async function acquireLock(root: string, wanted: WriterLock): Promise<void> {
  const path = join(root, "writer.lock");
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await durableWrite(path, JSON.stringify(wanted), "wx"); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    let bytes: string;
    try { bytes = await readBounded(path, 1024); } catch (error) { if (missing(error)) continue; throw error; }
    let existing: WriterLock; try { existing = JSON.parse(bytes) as WriterLock; } catch { throw new ManagedWriterConflict(); }
    if (!Number.isSafeInteger(existing.pid) || existing.pid <= 0 || typeof existing.token !== "string") throw new ManagedWriterConflict();
    try { process.kill(existing.pid, 0); throw new ManagedWriterConflict(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    // Serialize stale-owner cleanup. Without this separate exclusive guard,
    // two reclaimers could delete the new winner's lock after checking the old PID.
    const reclaimPath = join(root, "writer-reclaim.lock");
    let reclaim;
    try { reclaim = await open(reclaimPath, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ManagedWriterConflict(); throw error; }
    try {
      if (await readBounded(path, 1024).catch(error => { if (missing(error)) return ""; throw error; }) === bytes) await rm(path, { force: true });
      // Acquire while the reclaim guard is held, so a second stale reclaimer
      // cannot act on a previously observed dead owner after we publish our lease.
      try { await durableWrite(path, JSON.stringify(wanted), "wx"); return; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { await reclaim.close(); await rm(reclaimPath, { force: true }); }
  }
  throw new ManagedWriterConflict();
}
