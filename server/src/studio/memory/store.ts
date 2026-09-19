import type {
  StudioMemoryConsolidationResult,
  StudioMemoryLimits,
  StudioMemoryPolicy,
  StudioMemoryReadResult,
  StudioMemoryRepository,
  StudioMemorySeed,
  StudioMemoryStoreAdapter,
  StudioMemoryWriteResult,
} from "./contracts.js";

export class PolicyMemoryStore implements StudioMemoryStoreAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly scope: StudioMemoryPolicy["scope"];

  constructor(
    private readonly policy: StudioMemoryPolicy,
    private readonly repository: StudioMemoryRepository,
    private readonly limits: StudioMemoryLimits,
  ) {
    this.adapterId = policy.adapterId;
    this.adapterVersion = policy.adapterVersion;
    this.scope = policy.scope;
  }

  async seed(seeds: readonly StudioMemorySeed[], operationId: string): Promise<void> {
    // The control condition receives the same fixture setup at the harness
    // boundary, but it must not persist or expose records as if memory were
    // enabled. This keeps the control comparable without giving it a hidden
    // store that later consolidation could observe.
    if (this.policy.scope === "none") return;
    await this.repository.seed(seeds, operationId);
  }

  async read(input: { readonly task: string; readonly now?: string; readonly signal: AbortSignal }): Promise<StudioMemoryReadResult> {
    throwIfAborted(input.signal, "Memory retrieval was cancelled.");
    const state = await this.repository.load();
    throwIfAborted(input.signal, "Memory retrieval was cancelled.");
    return {
      ...this.policy.retrieve({ state, task: input.task, now: input.now ?? new Date().toISOString(), limits: this.limits }),
      stateRecovered: this.repository.lastLoadRecovered ?? false,
    };
  }

  async write(input: {
    readonly trialId?: string;
    readonly task: string;
    readonly turnId: string;
    readonly output: string;
    readonly now?: string;
    readonly signal: AbortSignal;
  }): Promise<StudioMemoryWriteResult> {
    throwIfAborted(input.signal, "Memory persistence was cancelled before planning.");
    const state = await this.repository.load();
    const mutations = this.policy.proposeWrite({
      state,
      task: input.task ?? "",
      turnId: input.turnId ?? "studio-turn",
      output: input.output,
      now: input.now ?? new Date().toISOString(),
    });
    throwIfAborted(input.signal, "Memory persistence was cancelled before applying a decision.");
    const applied = await this.repository.apply(mutations);
    throwIfAborted(input.signal, "Memory persistence completed but the turn was cancelled.");
    return writeResult(applied);
  }

  async consolidate(input: { readonly now?: string; readonly signal: AbortSignal }): Promise<StudioMemoryConsolidationResult> {
    throwIfAborted(input.signal, "Memory consolidation was cancelled before planning.");
    const state = await this.repository.load();
    const mutations = this.policy.proposeConsolidation({ state, now: input.now ?? new Date().toISOString() });
    throwIfAborted(input.signal, "Memory consolidation was cancelled before applying a decision.");
    const applied = await this.repository.apply(mutations);
    return {
      stateRevision: applied.state.revision,
      decisions: applied.decisions,
      expiredRecordIds: applied.decisions.filter((decision) => decision.operation === "expire" && decision.recordId !== null).map((decision) => decision.recordId!),
      activeRecordIds: applied.state.records.filter((record) => record.state === "active").map((record) => record.recordId),
      scopes: [...new Set(applied.state.records.filter((record) => record.state === "active").map((record) => record.scope))],
    };
  }
}

function writeResult(result: Awaited<ReturnType<StudioMemoryRepository["apply"]>>): StudioMemoryWriteResult {
  return {
    stateRevision: result.state.revision,
    decisions: result.decisions,
    writtenRecordIds: result.decisions.filter((decision) => decision.operation === "add" && decision.recordId !== null).map((decision) => decision.recordId!),
    updatedRecordIds: result.decisions.filter((decision) => decision.operation === "update" && decision.recordId !== null).map((decision) => decision.recordId!),
    discardedRecordIds: result.decisions.filter((decision) => decision.operation === "delete" && decision.recordId !== null).map((decision) => decision.recordId!),
    expiredRecordIds: result.decisions.filter((decision) => decision.operation === "expire" && decision.recordId !== null).map((decision) => decision.recordId!),
    activeRecordIds: result.state.records.filter((record) => record.state === "active").map((record) => record.recordId),
    scopes: [...new Set(result.state.records.filter((record) => record.state === "active").map((record) => record.scope))],
  };
}

function throwIfAborted(signal: AbortSignal, message: string): void {
  if (!signal.aborted) return;
  const error = new Error(message);
  error.name = "AbortError";
  throw error;
}
