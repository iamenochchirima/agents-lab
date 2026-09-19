import type { ContextMessage } from "../../capabilities/context/contracts.js";
import { ToolRegistry } from "../../capabilities/tools/registry.js";
import type { ToolCall, ToolDefinition, ToolValidationResult } from "../../capabilities/tools/contracts.js";
import type { StudioModelAdapter, StudioModelResponse } from "../adapters/replay-model.js";
import type {
  StudioComputerUseAdapter,
  StudioControlLoop,
  StudioExecutionEnvironmentAdapter,
  StudioHarnessComponentFactory,
  StudioHarnessComponents,
  StudioInputNormalizer,
  StudioMemoryRecord,
  StudioMemoryStore,
  StudioObservabilityAdapter,
  StudioOutputAdapter,
  StudioPlanner,
  StudioSafetyGate,
  StudioToolUseAdapter,
} from "./contracts.js";
import type { ContextStrategy } from "../strategies/context-strategy.js";

const BASELINE_VERSION = "1";

export function createBaselineStudioComponents(options: {
  readonly context: ContextStrategy;
  readonly model: StudioModelAdapter;
  readonly memory?: StudioMemoryStore;
  readonly now?: () => string;
}): StudioHarnessComponents {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    input: new BaselineInputNormalizer(),
    memory: options.memory ?? new FixtureMemoryStore(now),
    context: options.context,
    planner: new SingleStepPlanner(),
    tools: new FixtureToolUseAdapter(),
    computerUse: new UnavailableComputerUseAdapter(),
    control: new BoundedControlLoop(),
    environment: new ContainedExecutionEnvironment(),
    output: new ResponseCollector(),
    safety: new FailClosedSafetyGate(),
    model: options.model,
    observability: new StudioEventObservability(),
  };
}

export const baselineStudioComponentFactory: StudioHarnessComponentFactory = ({ context, model, memory, now }) =>
  createBaselineStudioComponents({ context, model, memory, now });

export class BaselineInputNormalizer implements StudioInputNormalizer {
  readonly adapterId = "canonical-input-normalizer";
  readonly adapterVersion = BASELINE_VERSION;

  normalize(input: { readonly task: string; readonly messages: readonly ContextMessage[] }) {
    const trustedMessageIds = input.messages
      .filter((message) => message.source === "system" || message.source === "transcript")
      .map((message) => message.messageId);
    const untrustedMessageIds = input.messages
      .filter((message) => !trustedMessageIds.includes(message.messageId))
      .map((message) => message.messageId);
    return {
      task: input.task,
      messages: [...input.messages],
      trustedMessageIds,
      untrustedMessageIds,
    };
  }
}

export class FixtureMemoryStore implements StudioMemoryStore {
  readonly adapterId = "fixture-memory";
  readonly adapterVersion = BASELINE_VERSION;
  readonly scope = "working" as const;
  private readonly records = new Map<string, StudioMemoryRecord>();

  constructor(private readonly now: () => string) {}

  async read(_input: { readonly task: string; readonly now?: string; readonly signal: AbortSignal }) {
    const records = [...this.records.values()];
    return {
      stateRevision: records.length,
      queryTerms: [],
      candidates: records.map((record) => ({ record, score: 1, reason: "Fixture Memory returns all working records.", selected: true })),
      records,
      retrievedRecordIds: records.map((record) => record.recordId),
      omittedRecordIds: [],
    };
  }

  async write(input: { readonly trialId?: string; readonly task: string; readonly turnId: string; readonly output: string; readonly now?: string; readonly signal: AbortSignal }) {
    if (input.signal.aborted) throw abortError("Memory write was cancelled.");
    const turnId = input.trialId ?? input.turnId;
    const recordId = `working-${turnId}`;
    this.records.set(recordId, {
      schemaVersion: 1,
      recordId,
      namespace: { comparisonId: "fixture", trialId: turnId, scenarioId: "fixture", sessionId: `studio-${turnId}` },
      scope: "working",
      content: input.output,
      logicalKey: null,
      source: "studio-turn-output",
      sourceMessageIds: [input.turnId],
      createdAt: input.now ?? this.now(),
      updatedAt: input.now ?? this.now(),
      revision: this.records.size + 1,
      state: "active",
      supersedesRecordId: null,
      expiresAt: null,
      metadata: {},
    });
    return {
      stateRevision: this.records.size,
      decisions: [],
      writtenRecordIds: [recordId],
      updatedRecordIds: [],
      discardedRecordIds: [],
      expiredRecordIds: [],
      activeRecordIds: [...this.records.keys()],
      scopes: ["working"] as const,
    };
  }

  async consolidate(_input: { readonly now?: string; readonly signal: AbortSignal }) {
    return { stateRevision: this.records.size, decisions: [], expiredRecordIds: [], activeRecordIds: [...this.records.keys()], scopes: ["working"] as const };
  }
}

export class SingleStepPlanner implements StudioPlanner {
  readonly adapterId = "single-step-planner";
  readonly adapterVersion = BASELINE_VERSION;

  plan(_input: { readonly task: string; readonly context: readonly ContextMessage[] }) {
    return { intent: "respond" as const, reason: "The baseline planner answers the current task in one bounded step." };
  }
}

export class FixtureToolUseAdapter implements StudioToolUseAdapter {
  readonly adapterId = "fixture-tool-dispatcher";
  readonly adapterVersion = BASELINE_VERSION;
  readonly registry: ToolRegistry;

  constructor() {
    this.registry = new ToolRegistry({ enabledNames: ["studio_echo"] });
    this.registry.register({
      definition: {
        schemaVersion: 1,
        name: "studio_echo",
        description: "Return a bounded fixture value for tool-call experiments.",
        inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        riskClass: "pure",
        executionKind: "in_process",
        limits: { maxArgumentBytes: 4_096, maxResultBytes: 8_192, timeoutMs: 1_000 },
      },
      validateArguments(value) {
        if (value === null || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).value !== "string") {
          throw new Error("studio_echo requires a string value.");
        }
        return { value: (value as Record<string, string>).value };
      },
      async execute(argumentsValue) {
        return JSON.stringify({ value: argumentsValue.value });
      },
    });
  }

  inspectModelResponse(_response: StudioModelResponse) {
    return { status: "not-requested" as const, toolCallCount: 0 };
  }

  definitions(): readonly ToolDefinition[] {
    return this.registry.definitions();
  }

  validate(call: ToolCall): ToolValidationResult {
    return this.registry.validateCall(call);
  }
}

export class UnavailableComputerUseAdapter implements StudioComputerUseAdapter {
  readonly adapterId = "computer-use-unavailable";
  readonly adapterVersion = BASELINE_VERSION;

  inspectModelResponse(_response: StudioModelResponse) {
    return {
      status: "unavailable" as const,
      reason: "Computer use is disabled in the deterministic Studio environment.",
    };
  }
}

export class BoundedControlLoop implements StudioControlLoop {
  readonly adapterId = "bounded-sequential-loop";
  readonly adapterVersion = BASELINE_VERSION;
  readonly maxTurns = 1;

  async run(input: { readonly signal: AbortSignal; readonly act: () => Promise<StudioModelResponse> }) {
    if (input.signal.aborted) throw abortError("Control loop was cancelled before the first turn.");
    const response = await input.act();
    if (input.signal.aborted) throw abortError("Control loop was cancelled after the model turn.");
    return response;
  }
}

export class ContainedExecutionEnvironment implements StudioExecutionEnvironmentAdapter {
  readonly adapterId = "contained-deterministic-environment";
  readonly adapterVersion = BASELINE_VERSION;
  readonly network = "disabled" as const;
  readonly filesystem = "fixture-only" as const;
  readonly sideEffects = "disabled" as const;
}

export class ResponseCollector implements StudioOutputAdapter {
  readonly adapterId = "response-collector";
  readonly adapterVersion = BASELINE_VERSION;

  collect(response: StudioModelResponse) {
    return { output: response.output, sideEffect: "none" as const };
  }
}

export class FailClosedSafetyGate implements StudioSafetyGate {
  readonly adapterId = "fail-closed-safety-gate";
  readonly adapterVersion = BASELINE_VERSION;

  check(input: { readonly output: string; readonly trustedMessageIds: readonly string[] }) {
    if (!input.output.trim()) return { allowed: false, reason: "The model returned an empty output." };
    return {
      allowed: true,
      reason: `Output passed the baseline gate with ${input.trustedMessageIds.length} trusted input sources.`,
    };
  }
}

export class StudioEventObservability implements StudioObservabilityAdapter {
  readonly adapterId = "studio-event-observability";
  readonly adapterVersion = BASELINE_VERSION;
}

export function memoryRecordsAsMessages(records: readonly StudioMemoryRecord[], sessionId: string, now: string): readonly ContextMessage[] {
  return records.map((record, index) => ({
    schemaVersion: 1,
    messageId: `memory-${record.recordId}`,
    sessionId,
    sequence: -(records.length - index),
    role: "system" as const,
    content: record.content,
    source: "memory" as const,
    createdAt: record.createdAt || now,
    metadata: { scope: record.scope, recordId: record.recordId },
  }));
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
