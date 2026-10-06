export const STUDIO_CHAT_API_VERSION = "6" as const;

export type StudioChatRole = "system" | "developer" | "user" | "assistant" | "tool";
export type StudioChatMaterialKind = "instruction" | "task" | "turn" | "memory" | "planning" | "tool-result";

export type StudioJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StudioJsonValue[]
  | { readonly [key: string]: StudioJsonValue };

export interface StudioChatTurnRequest {
  readonly conversationId: string;
  /** Browser-generated idempotency key, scoped to this conversation. */
  readonly requestId: string;
  readonly text: string;
  readonly remember: boolean;
}

/** Starts the fixed calculator fixture; callers cannot choose tool arguments or task text. */
export interface StudioChatScenarioTurnRequest {
  readonly conversationId: string;
  readonly requestId: string;
}

export interface StudioChatComponentIdentity {
  readonly area: "input" | "memory" | "context" | "planning" | "control" | "tool-use" | "computer-use" | "safety" | "execution-environment" | "output-actions" | "model-interface" | "observability";
  readonly packageName: string;
  readonly packageVersion: string;
  readonly implementation: { readonly id: string; readonly version: string };
  readonly configuration: StudioJsonValue;
}

export interface StudioChatAssembly {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly mode: "deterministic-reference";
  readonly components: readonly StudioChatComponentIdentity[];
  readonly limitations: readonly string[];
  readonly scenario?: { readonly id: string; readonly fixture: { readonly id: string; readonly version: string } };
}

export interface StudioChatToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: StudioJsonValue;
}

export interface StudioChatMessage {
  readonly role: StudioChatRole;
  readonly content: string | null;
  readonly sourceIds: readonly string[];
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly StudioChatToolCall[];
}

export interface StudioChatAgentMessage {
  readonly role: StudioChatRole;
  readonly content: string | null;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly StudioChatToolCall[];
}

export interface StudioChatModelCallEvidence {
  readonly context: StudioChatContextAssembly;
  readonly request: {
    readonly scope: { readonly runId: string; readonly sessionId?: string; readonly turnId?: string };
    readonly model: { readonly provider: string; readonly name: string; readonly revision?: string };
    readonly messages: readonly StudioChatAgentMessage[];
    readonly tools?: readonly { readonly name: string; readonly description: string; readonly parameters: StudioJsonValue }[];
    readonly parameters: Readonly<Record<string, StudioJsonValue>>;
    readonly idempotencyKey?: string;
  };
  readonly response: {
    readonly provider: {
      readonly provider: string;
      readonly model: string;
      readonly adapter: { readonly id: string; readonly version: string };
      readonly requestId?: string;
    };
    readonly text: string | null;
    readonly toolCalls: readonly StudioChatToolCall[];
    readonly finishReason: string;
    readonly usage: {
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly totalTokens: number | null;
      readonly basis: "provider-reported" | "estimated" | "unknown";
    };
    readonly providerDetail?: StudioJsonValue;
  };
}

export interface StudioChatObservabilityEvidence {
  readonly status: "not-configured" | "durable" | "partial" | "failed" | "unknown";
  readonly recorder: { readonly id: string; readonly version: string } | null;
  readonly eventsAttempted: number;
  readonly appendReceipts: readonly StudioJsonValue[];
  readonly flushReceipt: StudioJsonValue | null;
  readonly failure?: { readonly message: string };
}

export interface StudioChatContextAssembly {
  readonly messages: readonly StudioChatMessage[];
  readonly includedSourceIds: readonly string[];
  readonly omissions: readonly { readonly sourceId: string; readonly reason: "budget" | "invalid-source" | "window" }[];
  readonly sourceLedger: readonly StudioChatContextSource[];
  readonly tokenCount: { readonly value: number; readonly basis: string; readonly quality: "exact" | "estimated" };
}

export interface StudioChatContextSource {
  readonly sourceId: string;
  readonly kind: StudioChatMaterialKind;
  readonly role: StudioChatRole;
  readonly trust: "trusted" | "untrusted";
  readonly provenance: Readonly<Record<string, string>>;
  readonly disposition: { readonly status: "included" } | {
    readonly status: "omitted";
    readonly reason: "budget" | "invalid-source" | "window";
  };
}

export type StudioChatPlanStepKind = "respond" | "tool" | "computer" | "gather-information";

export interface StudioChatPlanningInput {
  readonly task: string;
  readonly context: readonly {
    readonly role: StudioChatRole;
    readonly content: string;
    readonly sourceIds: readonly string[];
  }[];
  readonly observations: readonly {
    readonly observationId: string;
    readonly kind: "tool-result" | "computer-observation" | "user-update" | "system-event";
    readonly summary: string;
    readonly sourceId: string;
  }[];
}

export interface StudioChatPlanningProposal {
  readonly planId: string;
  readonly summary: string;
  readonly steps: readonly {
    readonly stepId: string;
    readonly kind: StudioChatPlanStepKind;
    readonly description: string;
    readonly target?: string;
  }[];
  readonly completionCondition: string;
  readonly assumptions: readonly string[];
  readonly evidence: { readonly sourceIdsConsidered: readonly string[] };
}

export interface StudioChatPlanningEvidence {
  readonly module: { readonly id: string; readonly version: string };
  readonly input: StudioChatPlanningInput;
  readonly proposal: StudioChatPlanningProposal;
}

export interface StudioChatMemoryCandidate {
  readonly record: {
    readonly recordId: string;
    readonly content: string;
    readonly kind: "working" | "fact" | "episode" | "procedure";
    readonly provenance: {
      readonly sourceId: string;
      readonly sourceKind: string;
      readonly trust: "trusted" | "untrusted";
      readonly observedAt: string;
    };
    readonly logicalKey: string | null;
    readonly createdAt: string;
    readonly revision: number;
  };
  readonly rank: number;
  readonly score: number | null;
  readonly reason: string;
}

export interface StudioChatTurnResponse {
  readonly apiVersion: typeof STUDIO_CHAT_API_VERSION;
  readonly conversationId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly receivedAt: string;
  readonly assembly: StudioChatAssembly;
  readonly input: {
    readonly task: string;
    readonly source: {
      readonly sourceId: string;
      readonly kind: "user";
      readonly trust: "untrusted";
      readonly receivedAt: string;
    };
    readonly parts: readonly ({ readonly partId: string; readonly kind: "text"; readonly content: string })[];
  };
  readonly memory: {
    readonly stateRevision: number;
    readonly candidates: readonly StudioChatMemoryCandidate[];
    readonly writeReceipt: {
      readonly outcome: "applied" | "skipped" | "unknown";
      readonly stateRevision: number;
      readonly storedRecordIds: readonly string[];
      readonly skippedObservations: readonly {
        readonly observationId: string;
        readonly reason: "duplicate" | "capacity";
      }[];
    } | null;
  };
  readonly context: {
    readonly messages: readonly StudioChatMessage[];
    readonly includedSourceIds: readonly string[];
    readonly omissions: readonly { readonly sourceId: string; readonly reason: "budget" | "invalid-source" | "window" }[];
    readonly sourceLedger: readonly StudioChatContextSource[];
    readonly tokenCount: { readonly value: number; readonly basis: string; readonly quality: "exact" | "estimated" };
  };
  readonly planning: StudioChatPlanningEvidence;
  /** Paired Context, exact Model Interface request, and response for every model call. */
  readonly modelCalls: readonly StudioChatModelCallEvidence[];
  /** Normalized Tool Use, Safety, Environment, and lifecycle records for this run. */
  readonly runEvidence: readonly StudioJsonValue[];
  /** Recorder acknowledgements are separate from generated response text. */
  readonly observability: StudioChatObservabilityEvidence;
  readonly control: {
    readonly termination: "model-finished" | "delivery-rejected" | "delivery-uncertain";
    readonly modelCalls: number;
    readonly toolCalls: number;
    readonly observations: readonly StudioJsonValue[];
  };
  readonly model: {
    readonly provider: string;
    readonly name: string;
    readonly adapter: { readonly id: string; readonly version: string };
    readonly requestId?: string;
    readonly finishReason: string;
    readonly usage: {
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      readonly totalTokens: number | null;
      readonly basis: "provider-reported" | "estimated" | "unknown";
    };
    readonly detail?: StudioJsonValue;
  };
  readonly assistantMessage: { readonly sourceId: string; readonly content: string };
}

export interface StudioChatAssemblyResponse {
  readonly apiVersion: typeof STUDIO_CHAT_API_VERSION;
  readonly assembly: StudioChatAssembly;
}

export interface StudioChatClearResponse {
  readonly apiVersion: typeof STUDIO_CHAT_API_VERSION;
  readonly conversationId: string;
  readonly status: "cleared" | "not-found";
}

export interface StudioChatApiError {
  readonly apiVersion: typeof STUDIO_CHAT_API_VERSION;
  readonly error: { readonly code: string; readonly message: string };
  readonly evidence?: {
    readonly assembly: StudioChatAssembly;
    readonly contextRequests: readonly StudioChatContextAssembly[];
    readonly planning?: StudioChatPlanningEvidence;
    readonly modelRequests: readonly StudioChatModelCallEvidence["request"][];
    readonly modelResponses: readonly StudioChatModelCallEvidence["response"][];
    readonly observations: readonly StudioJsonValue[];
    readonly runEvidence: readonly StudioJsonValue[];
    readonly observability?: StudioChatObservabilityEvidence;
  };
}

export function isStudioChatTurnRequest(value: unknown): value is StudioChatTurnRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["conversationId", "requestId", "text", "remember"])) return false;
  return isSafeId(value.conversationId, 128)
    && isSafeId(value.requestId, 128)
    && typeof value.text === "string"
    && value.text.trim().length > 0
    && new TextEncoder().encode(value.text).byteLength <= 16_000
    && isWellFormedUnicode(value.text)
    && typeof value.remember === "boolean";
}

export function isStudioChatScenarioTurnRequest(value: unknown): value is StudioChatScenarioTurnRequest {
  return isRecord(value) && hasExactKeys(value, ["conversationId", "requestId"])
    && isSafeId(value.conversationId, 128)
    && isSafeId(value.requestId, 128);
}

export function isStudioChatAssembly(value: unknown): value is StudioChatAssembly {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== "string"
    || typeof value.version !== "string" || value.mode !== "deterministic-reference"
    || !Array.isArray(value.components) || !Array.isArray(value.limitations)) return false;
  return value.components.every((component) => isRecord(component)
    && ["input", "memory", "context", "planning", "control", "tool-use", "computer-use", "safety", "execution-environment", "output-actions", "model-interface", "observability"].includes(String(component.area))
    && typeof component.packageName === "string"
    && typeof component.packageVersion === "string"
    && isIdentity(component.implementation)
    && isStudioJsonValue(component.configuration))
    && value.limitations.every((limitation) => typeof limitation === "string")
    && (value.scenario === undefined || (isRecord(value.scenario) && typeof value.scenario.id === "string" && isIdentity(value.scenario.fixture)));
}

export function isStudioChatAssemblyResponse(value: unknown): value is StudioChatAssemblyResponse {
  return isRecord(value)
    && value.apiVersion === STUDIO_CHAT_API_VERSION
    && isStudioChatAssembly(value.assembly);
}

export function isStudioChatTurnResponse(value: unknown): value is StudioChatTurnResponse {
  if (!isRecord(value) || value.apiVersion !== STUDIO_CHAT_API_VERSION
    || !isSafeId(value.conversationId, 128) || !isSafeId(value.requestId, 128)
    || !isSafeId(value.runId, 128) || !isSafeId(value.turnId, 128)
    || typeof value.receivedAt !== "string" || !isStudioChatAssembly(value.assembly)) return false;
  if (!isRecord(value.input) || typeof value.input.task !== "string" || !isRecord(value.input.source)
    || !Array.isArray(value.input.parts)) return false;
  if (!isRecord(value.memory) || !Number.isSafeInteger(value.memory.stateRevision)
    || !Array.isArray(value.memory.candidates)
    || (value.memory.writeReceipt !== null && !isRecord(value.memory.writeReceipt))) return false;
  if (!isStudioChatContextAssembly(value.context) || !isStudioChatPlanningEvidence(value.planning)
    || !isStudioChatObservabilityEvidence(value.observability) || !Array.isArray(value.modelCalls)
    || !value.modelCalls.every(isStudioChatModelCallEvidence)
    || !Array.isArray(value.runEvidence) || !value.runEvidence.every((item) => isStudioJsonValue(item))) return false;
  if (!isRecord(value.control) || !["model-finished", "delivery-rejected", "delivery-uncertain"].includes(String(value.control.termination))
    || !Number.isSafeInteger(value.control.modelCalls) || !Number.isSafeInteger(value.control.toolCalls)
    || !Array.isArray(value.control.observations)) return false;
  if (!isRecord(value.model) || typeof value.model.provider !== "string" || typeof value.model.name !== "string"
    || !isIdentity(value.model.adapter) || typeof value.model.finishReason !== "string"
    || !isRecord(value.model.usage)) return false;
  return isRecord(value.assistantMessage) && typeof value.assistantMessage.sourceId === "string"
    && typeof value.assistantMessage.content === "string";
}

export function isStudioChatClearResponse(value: unknown): value is StudioChatClearResponse {
  return isRecord(value) && value.apiVersion === STUDIO_CHAT_API_VERSION
    && isSafeId(value.conversationId, 128)
    && (value.status === "cleared" || value.status === "not-found");
}

export function isStudioChatApiError(value: unknown): value is StudioChatApiError {
  if (!isRecord(value) || value.apiVersion !== STUDIO_CHAT_API_VERSION || !isRecord(value.error)
    || typeof value.error.code !== "string" || typeof value.error.message !== "string") return false;
  if (value.evidence === undefined) return true;
  return isRecord(value.evidence)
    && isStudioChatAssembly(value.evidence.assembly)
    && Array.isArray(value.evidence.contextRequests) && value.evidence.contextRequests.every(isStudioChatContextAssembly)
    && (value.evidence.planning === undefined || isStudioChatPlanningEvidence(value.evidence.planning))
    && Array.isArray(value.evidence.modelRequests) && value.evidence.modelRequests.every(isStudioChatModelRequest)
    && Array.isArray(value.evidence.modelResponses) && value.evidence.modelResponses.every(isStudioChatModelResponse)
    && Array.isArray(value.evidence.observations) && value.evidence.observations.every((item) => isStudioJsonValue(item))
    && Array.isArray(value.evidence.runEvidence) && value.evidence.runEvidence.every((item) => isStudioJsonValue(item))
    && (value.evidence.observability === undefined || isStudioChatObservabilityEvidence(value.evidence.observability));
}

function isStudioChatObservabilityEvidence(value: unknown): value is StudioChatObservabilityEvidence {
  return isRecord(value)
    && ["not-configured", "durable", "partial", "failed", "unknown"].includes(String(value.status))
    && (value.recorder === null || isIdentity(value.recorder))
    && Number.isSafeInteger(value.eventsAttempted)
    && Array.isArray(value.appendReceipts) && value.appendReceipts.every((item) => isStudioJsonValue(item))
    && (value.flushReceipt === null || isStudioJsonValue(value.flushReceipt))
    && (value.failure === undefined || (isRecord(value.failure) && typeof value.failure.message === "string"));
}

function isStudioChatPlanningEvidence(value: unknown): value is StudioChatPlanningEvidence {
  if (!isRecord(value) || !isIdentity(value.module) || !isRecord(value.input)
    || typeof value.input.task !== "string" || !Array.isArray(value.input.context)
    || !Array.isArray(value.input.observations) || !isRecord(value.proposal)) return false;
  if (!value.input.context.every((message) => isRecord(message)
    && ["system", "developer", "user", "assistant", "tool"].includes(String(message.role))
    && typeof message.content === "string"
    && Array.isArray(message.sourceIds) && message.sourceIds.every((sourceId) => typeof sourceId === "string"))) return false;
  if (!value.input.observations.every((observation) => isRecord(observation)
    && typeof observation.observationId === "string"
    && ["tool-result", "computer-observation", "user-update", "system-event"].includes(String(observation.kind))
    && typeof observation.summary === "string" && typeof observation.sourceId === "string")) return false;
  const proposal = value.proposal;
  return typeof proposal.planId === "string" && typeof proposal.summary === "string"
    && Array.isArray(proposal.steps) && proposal.steps.every((step) => isRecord(step)
      && typeof step.stepId === "string"
      && ["respond", "tool", "computer", "gather-information"].includes(String(step.kind))
      && typeof step.description === "string"
      && (step.target === undefined || typeof step.target === "string"))
    && typeof proposal.completionCondition === "string"
    && Array.isArray(proposal.assumptions) && proposal.assumptions.every((item) => typeof item === "string")
    && isRecord(proposal.evidence) && Array.isArray(proposal.evidence.sourceIdsConsidered)
    && proposal.evidence.sourceIdsConsidered.every((sourceId) => typeof sourceId === "string");
}

function isStudioChatContextAssembly(value: unknown): value is StudioChatContextAssembly {
  return isRecord(value) && Array.isArray(value.messages) && value.messages.every(isStudioChatMessage)
    && Array.isArray(value.includedSourceIds) && value.includedSourceIds.every((sourceId) => typeof sourceId === "string")
    && Array.isArray(value.omissions) && value.omissions.every(isStudioChatContextOmission)
    && Array.isArray(value.sourceLedger) && value.sourceLedger.every(isStudioChatContextSource)
    && isRecord(value.tokenCount) && typeof value.tokenCount.value === "number"
    && typeof value.tokenCount.basis === "string" && ["exact", "estimated"].includes(String(value.tokenCount.quality));
}

function isStudioChatContextOmission(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["sourceId", "reason"])
    && typeof value.sourceId === "string"
    && ["budget", "invalid-source", "window"].includes(String(value.reason));
}

function isStudioChatContextSource(value: unknown): value is StudioChatContextSource {
  if (!isRecord(value) || !hasExactKeys(value, ["sourceId", "kind", "role", "trust", "provenance", "disposition"])
    || typeof value.sourceId !== "string"
    || !["instruction", "task", "turn", "memory", "planning", "tool-result"].includes(String(value.kind))
    || !["system", "developer", "user", "assistant", "tool"].includes(String(value.role))
    || !["trusted", "untrusted"].includes(String(value.trust))
    || !isRecord(value.provenance) || !Object.values(value.provenance).every((item) => typeof item === "string")
    || !isRecord(value.disposition)) return false;
  if (value.disposition.status === "included") return hasExactKeys(value.disposition, ["status"]);
  return value.disposition.status === "omitted"
    && hasExactKeys(value.disposition, ["status", "reason"])
    && ["budget", "invalid-source", "window"].includes(String(value.disposition.reason));
}

function isStudioChatMessage(value: unknown): value is StudioChatMessage {
  return isRecord(value) && ["system", "developer", "user", "assistant", "tool"].includes(String(value.role))
    && (typeof value.content === "string" || value.content === null)
    && Array.isArray(value.sourceIds) && value.sourceIds.every((sourceId) => typeof sourceId === "string")
    && (value.name === undefined || typeof value.name === "string")
    && (value.toolCallId === undefined || typeof value.toolCallId === "string")
    && (value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every(isStudioChatToolCall)));
}

function isStudioChatAgentMessage(value: unknown): value is StudioChatAgentMessage {
  return isRecord(value) && ["system", "developer", "user", "assistant", "tool"].includes(String(value.role))
    && (typeof value.content === "string" || value.content === null)
    && (value.name === undefined || typeof value.name === "string")
    && (value.toolCallId === undefined || typeof value.toolCallId === "string")
    && (value.toolCalls === undefined || (Array.isArray(value.toolCalls) && value.toolCalls.every(isStudioChatToolCall)));
}

function isStudioChatToolCall(value: unknown): value is StudioChatToolCall {
  return isRecord(value) && typeof value.callId === "string" && typeof value.name === "string"
    && isStudioJsonValue(value.arguments);
}

function isStudioChatModelCallEvidence(value: unknown): value is StudioChatModelCallEvidence {
  return isRecord(value) && isStudioChatContextAssembly(value.context)
    && isStudioChatModelRequest(value.request) && isStudioChatModelResponse(value.response);
}

function isStudioChatModelRequest(value: unknown): value is StudioChatModelCallEvidence["request"] {
  return isRecord(value) && isRecord(value.scope) && typeof value.scope.runId === "string"
    && (value.scope.sessionId === undefined || typeof value.scope.sessionId === "string")
    && (value.scope.turnId === undefined || typeof value.scope.turnId === "string")
    && isRecord(value.model) && typeof value.model.provider === "string" && typeof value.model.name === "string"
    && Array.isArray(value.messages) && value.messages.every(isStudioChatAgentMessage)
    && (value.tools === undefined || (Array.isArray(value.tools) && value.tools.every((tool) => isRecord(tool)
      && typeof tool.name === "string" && typeof tool.description === "string" && isStudioJsonValue(tool.parameters))))
    && isRecord(value.parameters) && isStudioJsonValue(value.parameters)
    && (value.idempotencyKey === undefined || typeof value.idempotencyKey === "string");
}

function isStudioChatModelResponse(value: unknown): value is StudioChatModelCallEvidence["response"] {
  return isRecord(value) && isRecord(value.provider) && typeof value.provider.provider === "string"
    && typeof value.provider.model === "string" && isIdentity(value.provider.adapter)
    && (value.provider.requestId === undefined || typeof value.provider.requestId === "string")
    && (typeof value.text === "string" || value.text === null)
    && Array.isArray(value.toolCalls) && value.toolCalls.every(isStudioChatToolCall)
    && typeof value.finishReason === "string" && isRecord(value.usage)
    && (value.usage.inputTokens === null || typeof value.usage.inputTokens === "number")
    && (value.usage.outputTokens === null || typeof value.usage.outputTokens === "number")
    && (value.usage.totalTokens === null || typeof value.usage.totalTokens === "number")
    && ["provider-reported", "estimated", "unknown"].includes(String(value.usage.basis))
    && (value.providerDetail === undefined || isStudioJsonValue(value.providerDetail));
}

function isIdentity(value: unknown): value is { readonly id: string; readonly version: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.version === "string";
}

function isStudioJsonValue(value: unknown, seen = new Set<object>()): value is StudioJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isStudioJsonValue(entry, seen))
    : Object.values(value as Record<string, unknown>).every((entry) => isStudioJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isSafeId(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= maximumLength
    && value.trim() === value && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
