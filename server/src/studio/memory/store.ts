import { createHash } from "node:crypto";

import {
  StudioMemoryCancellationError,
  type StudioMemoryConsolidationResult,
  type StudioMemoryLimits,
  type StudioMemoryMutation,
  type StudioMemoryPolicy,
  type StudioMemoryReadResult,
  type StudioMemoryRepository,
  type StudioMemorySeed,
  type StudioMemoryStoreAdapter,
  type StudioMemoryWriteResult,
} from "./contracts.js";

export class PolicyMemoryStore implements StudioMemoryStoreAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly scope: StudioMemoryPolicy["scope"];

  constructor(
    private readonly policy: StudioMemoryPolicy,
    private readonly repository: StudioMemoryRepository,
    private readonly limits: StudioMemoryLimits,
    private readonly reopenStore?: () => StudioMemoryStoreAdapter,
    private readonly afterApply?: () => void,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.adapterId = policy.adapterId;
    this.adapterVersion = policy.adapterVersion;
    this.scope = policy.scope;
  }

  get reopen(): (() => StudioMemoryStoreAdapter) | undefined {
    return this.reopenStore;
  }

  async seed(seeds: readonly StudioMemorySeed[], operationId: string): Promise<void> {
    // The control condition receives the same fixture setup at the harness
    // boundary, but it must not persist or expose records as if memory were
    // enabled. This keeps the control comparable without giving it a hidden
    // store that later consolidation could observe.
    if (this.policy.scope === "none") return;
    await this.repository.seed(seeds, operationId, journalContext(this.adapterId, this.adapterVersion, seeds[0]?.createdAt ?? this.now()));
  }

  async read(input: { readonly task: string; readonly now?: string; readonly signal: AbortSignal }): Promise<StudioMemoryReadResult> {
    throwIfAborted(input.signal, "Memory retrieval was cancelled before it started.", "before-retrieval", false);
    const state = await this.repository.load();
    throwIfAborted(input.signal, "Memory retrieval was cancelled before the policy decision.", "before-retrieval", false);
    return {
      ...this.policy.retrieve({ state, task: input.task, now: input.now ?? this.now(), limits: this.limits }),
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
    throwIfAborted(input.signal, "Memory persistence was cancelled before planning.", "before-persistence", false);
    const state = await this.repository.load();
    const mutations = this.policy.proposeWrite({
      state,
      task: input.task ?? "",
      turnId: input.turnId ?? "studio-turn",
      output: input.output,
      now: input.now ?? this.now(),
    });
    throwIfAborted(input.signal, "Memory persistence was cancelled before applying a decision.", "before-persistence", false);
    const normalized = normalizeMutations(mutations, this.repository.namespace, this.adapterId, this.adapterVersion, input.turnId ?? "studio-turn");
    let applied: Awaited<ReturnType<StudioMemoryRepository["apply"]>>;
    try {
      applied = await this.repository.apply(normalized, journalContext(this.adapterId, this.adapterVersion, input.now ?? this.now()));
      this.afterApply?.();
    } catch (error) {
      if (input.signal.aborted) {
        throw makeCancellationError("during-persistence", false, "Memory persistence was interrupted before acknowledgement; the state must be reconciled from the journal.");
      }
      throw error;
    }
    throwIfAborted(input.signal, "Memory persistence completed but the turn was cancelled; the write remains applied.", "after-persistence", true);
    return writeResult(applied);
  }

  async consolidate(input: { readonly turnId?: string; readonly now?: string; readonly signal: AbortSignal }): Promise<StudioMemoryConsolidationResult> {
    throwIfAborted(input.signal, "Memory consolidation was cancelled before planning.", "before-persistence", false);
    const state = await this.repository.load();
    const mutations = this.policy.proposeConsolidation({ state, now: input.now ?? this.now() });
    if (mutations.length > this.limits.maxConsolidationOperations) {
      throw new Error(`Memory consolidation limit exceeded: ${mutations.length} operations exceed the configured consolidation limit.`);
    }
    throwIfAborted(input.signal, "Memory consolidation was cancelled before applying a decision.", "before-persistence", false);
    const normalized = normalizeMutations(mutations, this.repository.namespace, this.adapterId, this.adapterVersion, input.turnId ?? "consolidation");
    let applied: Awaited<ReturnType<StudioMemoryRepository["apply"]>>;
    try {
      applied = await this.repository.apply(normalized, journalContext(this.adapterId, this.adapterVersion, input.now ?? this.now()));
      this.afterApply?.();
    } catch (error) {
      if (input.signal.aborted) {
        throw makeCancellationError("during-persistence", false, "Memory consolidation was interrupted before acknowledgement; the state must be reconciled from the journal.");
      }
      throw error;
    }
    throwIfAborted(input.signal, "Memory consolidation completed but the turn was cancelled; persisted decisions remain applied.", "after-persistence", true);
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

function throwIfAborted(signal: AbortSignal, message: string, phase: Parameters<typeof makeCancellationError>[0], persisted: boolean): void {
  if (!signal.aborted) return;
  throw makeCancellationError(phase, persisted, message);
}

function makeCancellationError(phase: ConstructorParameters<typeof StudioMemoryCancellationError>[0], persisted: boolean, message: string): StudioMemoryCancellationError {
  return new StudioMemoryCancellationError(phase, persisted, phase === "before-retrieval" || phase === "before-persistence" ? "not-started" : persisted ? "applied" : "unknown", message);
}

function journalContext(policyId: string, policyVersion: string, timestamp: string) {
  return { policyId, policyVersion, timestamp } as const;
}

function normalizeMutations(
  mutations: readonly StudioMemoryMutation[],
  namespace: StudioMemoryRepositoryNamespace,
  policyId: string,
  policyVersion: string,
  turnId: string,
): readonly StudioMemoryMutation[] {
  return mutations.map((mutation) => {
    const candidate = mutation.candidate && !mutation.candidate.recordId && mutation.operation === "add"
      ? { ...mutation.candidate, recordId: stableGeneratedRecordId(mutation.operationId) }
      : mutation.candidate;
    return {
      ...mutation,
      candidate,
      operationId: deriveMemoryOperationId({
        namespace,
        policyId,
        policyVersion,
        turnId,
        operation: mutation.operation,
        identity: {
          candidate: mutation.candidate ?? null,
          targetRecordId: mutation.targetRecordId ?? null,
        },
      }),
    };
  });
}

type StudioMemoryRepositoryNamespace = {
  readonly comparisonId: string;
  readonly trialId: string;
  readonly scenarioId: string;
  readonly sessionId: string;
};

export function deriveMemoryOperationId(input: {
  readonly namespace: StudioMemoryRepositoryNamespace;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly turnId: string;
  readonly operation: string;
  readonly identity: unknown;
}): string {
  const payload = stableJson(input);
  return `memory-${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stableGeneratedRecordId(operationId: string): string {
  const readable = `${operationId}-record`.replace(/[^A-Za-z0-9_-]/g, "-");
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(readable)) return readable;
  return `memory-record-${createHash("sha256").update(operationId).digest("hex").slice(0, 24)}`;
}
