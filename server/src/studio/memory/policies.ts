import type {
  StudioMemoryCandidate,
  StudioMemoryLimits,
  StudioMemoryMutation,
  StudioMemoryPolicy,
  StudioMemoryReadResult,
  StudioMemoryRecord,
  StudioMemoryState,
  StudioMemoryWriteCandidate,
} from "./contracts.js";

const BASELINE_VERSION = "1";
const STOP_WORDS = new Set(["the", "and", "for", "with", "what", "should", "this", "that", "from", "are", "was", "use"]);

abstract class LexicalMemoryPolicy implements StudioMemoryPolicy {
  abstract readonly adapterId: string;
  readonly adapterVersion = BASELINE_VERSION;
  abstract readonly scope: "working" | "episodic" | "semantic" | "procedural";
  protected abstract readonly writeScope: "working" | "episodic" | "semantic" | "procedural";
  protected abstract readonly writeSource: string;
  protected abstract readonly allowLogicalFacts: boolean;

  retrieve(input: { readonly state: StudioMemoryState; readonly task: string; readonly now: string; readonly limits: StudioMemoryLimits }): StudioMemoryReadResult {
    const queryTerms = [...terms(input.task)];
    const candidates = input.state.records
      .filter((record) => record.scope === this.scope && record.state === "active")
      .filter((record) => record.expiresAt === null || record.expiresAt > input.now)
      .map((record) => candidateFor(record, queryTerms))
      .sort((left, right) => right.score - left.score || Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt) || left.record.recordId.localeCompare(right.record.recordId));
    const selected = candidates.filter((candidate) => candidate.score > 0).slice(0, input.limits.maxRetrievedRecords);
    const selectedIds = new Set(selected.map((candidate) => candidate.record.recordId));
    const marked = candidates.map((candidate) => ({ ...candidate, selected: selectedIds.has(candidate.record.recordId) }));
    return {
      stateRevision: input.state.revision,
      queryTerms,
      candidates: marked,
      records: selected.map((candidate) => candidate.record),
      retrievedRecordIds: selected.map((candidate) => candidate.record.recordId),
      omittedRecordIds: candidates.filter((candidate) => !selectedIds.has(candidate.record.recordId)).map((candidate) => candidate.record.recordId),
    };
  }

  proposeWrite(input: { readonly state: StudioMemoryState; readonly task: string; readonly turnId: string; readonly output: string; readonly now: string }): readonly StudioMemoryMutation[] {
    const candidate = this.extractCandidate(input);
    if (!candidate || !candidate.content) return [];
    const logicalKey = candidate.logicalKey ?? null;
    const existing = logicalKey === null
      ? undefined
      : input.state.records.find((record) => record.scope === this.scope && record.state === "active" && record.logicalKey === logicalKey);
    if (existing && normalize(existing.content) === normalize(candidate.content)) {
      return [{
        operationId: operationId(input.turnId, "noop", existing.recordId),
        operation: "noop",
        targetRecordId: existing.recordId,
        reason: "The candidate matches the active logical record.",
      }];
    }
    if (existing && this.allowLogicalFacts) {
      return [{
        operationId: operationId(input.turnId, "update", existing.recordId),
        operation: "update",
        targetRecordId: existing.recordId,
        candidate,
        reason: "The candidate changes an active logical record and creates a new revision.",
      }];
    }
    const duplicate = input.state.records.find((record) => record.scope === this.scope && record.state === "active" && record.logicalKey === logicalKey && normalize(record.content) === normalize(candidate.content));
    if (duplicate) {
      return [{
        operationId: operationId(input.turnId, "noop", duplicate.recordId),
        operation: "noop",
        targetRecordId: duplicate.recordId,
        reason: "The candidate is already active in this Memory scope.",
      }];
    }
    return [{
      operationId: operationId(input.turnId, "add", logicalKey ?? "output"),
      operation: "add",
      candidate,
      reason: "The Memory policy accepted a new candidate from the turn output.",
    }];
  }

  proposeConsolidation(input: { readonly state: StudioMemoryState; readonly now: string }): readonly StudioMemoryMutation[] {
    return input.state.records
      .filter((record) => record.scope === this.scope && record.state === "active" && record.expiresAt !== null && record.expiresAt <= input.now)
      .map((record) => ({
        operationId: operationId(`consolidation-${input.now}`, "expire", record.recordId),
        operation: "expire" as const,
        targetRecordId: record.recordId,
        reason: "The record passed its explicit expiry time.",
      }));
  }

  protected extractCandidate(input: { readonly output: string; readonly task: string; readonly turnId: string; readonly now: string }): StudioMemoryWriteCandidate | null {
    if (this.allowLogicalFacts) {
      const fact = input.output.match(/^(?:fact|preference)\s*:\s*([a-z0-9._-]+)\s*=\s*(.+)$/i);
      if (!fact) return null;
      return {
        scope: this.writeScope,
        content: fact[2].trim(),
        logicalKey: fact[1].toLowerCase(),
        source: this.writeSource,
        sourceMessageIds: [input.turnId],
        createdAt: input.now,
        metadata: { task: normalize(input.task) },
      };
    }
    return {
      scope: this.writeScope,
      content: input.output,
      logicalKey: null,
      source: this.writeSource,
      sourceMessageIds: [input.turnId],
      createdAt: input.now,
      metadata: { task: normalize(input.task) },
    };
  }
}

export class NoMemoryPolicy implements StudioMemoryPolicy {
  readonly adapterId = "no-memory";
  readonly adapterVersion = BASELINE_VERSION;
  readonly scope = "none" as const;

  retrieve(_input: { readonly state: StudioMemoryState; readonly task: string; readonly now: string; readonly limits: StudioMemoryLimits }): StudioMemoryReadResult {
    return emptyReadResult(0, []);
  }

  proposeWrite(_input: { readonly state: StudioMemoryState; readonly task: string; readonly turnId: string; readonly output: string; readonly now: string }): readonly StudioMemoryMutation[] {
    return [];
  }

  proposeConsolidation(_input: { readonly state: StudioMemoryState; readonly now: string }): readonly StudioMemoryMutation[] {
    return [];
  }
}

export class WorkingMemoryPolicy extends LexicalMemoryPolicy {
  readonly adapterId = "working-memory";
  readonly scope = "working" as const;

  protected writeScope = "working" as const;
  protected readonly writeSource = "studio-turn-output";
  protected readonly allowLogicalFacts = false;
}

export class EpisodicLexicalPolicy extends LexicalMemoryPolicy {
  readonly adapterId = "episodic-lexical";
  readonly scope = "episodic" as const;

  protected writeScope = "episodic" as const;
  protected readonly writeSource = "studio-turn-output";
  protected readonly allowLogicalFacts = false;
}

export class SemanticFactPolicy extends LexicalMemoryPolicy {
  readonly adapterId = "semantic-keyed-facts";
  readonly scope = "semantic" as const;

  protected writeScope = "semantic" as const;
  protected readonly writeSource = "studio-fact-extraction";
  protected readonly allowLogicalFacts = true;
}

export class ProceduralCachePolicy extends LexicalMemoryPolicy {
  readonly adapterId = "procedural-cache";
  readonly scope = "procedural" as const;

  protected writeScope = "procedural" as const;
  protected readonly writeSource = "studio-procedure-extraction";
  protected readonly allowLogicalFacts = true;

  protected extractCandidate(input: { readonly output: string; readonly task: string; readonly turnId: string; readonly now: string }): StudioMemoryWriteCandidate | null {
    const match = input.output.match(/^procedure\s*:\s*([a-z0-9._-]+)\s*=>\s*(.+)$/i);
    if (!match) return null;
    return {
      scope: this.writeScope,
      content: match[2].trim(),
      logicalKey: match[1].toLowerCase(),
      source: this.writeSource,
      sourceMessageIds: [input.turnId],
      createdAt: input.now,
      metadata: { task: normalize(input.task) },
    };
  }
}

export function memoryPolicies(): readonly StudioMemoryPolicy[] {
  return [
    new NoMemoryPolicy(),
    new WorkingMemoryPolicy(),
    new EpisodicLexicalPolicy(),
    new SemanticFactPolicy(),
    new ProceduralCachePolicy(),
  ];
}

function candidateFor(record: StudioMemoryRecord, queryTerms: readonly string[]): StudioMemoryCandidate {
  const recordTerms = terms(`${record.logicalKey ?? ""} ${record.content}`);
  let score = 0;
  for (const term of queryTerms) if (recordTerms.has(term)) score += 1;
  return {
    record,
    score,
    reason: score > 0 ? `Matched ${score} normalized task terms.` : "No normalized task terms matched.",
    selected: false,
  };
}

function emptyReadResult(stateRevision: number, queryTerms: readonly string[]): StudioMemoryReadResult {
  return { stateRevision, queryTerms, candidates: [], records: [], retrievedRecordIds: [], omittedRecordIds: [] };
}

function operationId(turnId: string, operation: string, key: string): string {
  return `${turnId}-${operation}-${key}`.replace(/[^A-Za-z0-9._:-]/g, "-");
}

function terms(value: string): ReadonlySet<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !STOP_WORDS.has(term)) ?? []);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
