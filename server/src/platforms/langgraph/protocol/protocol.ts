export const LANGGRAPH_PROTOCOL_VERSION = 1 as const;

export type LangGraphPlatformStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "unknown";
export type LangGraphFailureKind =
  | "configuration"
  | "pre_dispatch"
  | "provider"
  | "timeout"
  | "cancelled"
  | "outcome_unknown"
  | "internal"
  | "reconciliation";

export interface LangGraphStartRequest {
  readonly protocolVersion: typeof LANGGRAPH_PROTOCOL_VERSION;
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: { readonly provider: "fake" | "openrouter"; readonly model: string };
  readonly graph: "baseline";
  readonly threadId: string;
  readonly durability: "sqlite-sync";
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}

export interface LangGraphStartResponse {
  readonly protocolVersion: typeof LANGGRAPH_PROTOCOL_VERSION;
  readonly executionId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly graph: "baseline";
  readonly status: LangGraphPlatformStatus;
  readonly idempotent: boolean;
}

export interface LangGraphHealthResponse {
  readonly protocolVersion: typeof LANGGRAPH_PROTOCOL_VERSION;
  readonly service: "langgraph";
  readonly serviceVersion: string;
  readonly langgraphVersion: string;
  readonly pythonVersion: string;
  readonly status: "ready" | "unavailable";
  readonly checkpointPath: string;
  readonly checkpointPathWritable: boolean;
  readonly message: string;
}

export interface LangGraphEvent {
  readonly source: "langgraph-service";
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

export interface LangGraphError {
  readonly code: string;
  readonly message: string;
  readonly failureKind: LangGraphFailureKind;
  readonly retryable: boolean;
}

export interface LangGraphResult {
  readonly status: LangGraphPlatformStatus;
  readonly runId: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly output: string | null;
  readonly error: LangGraphError | null;
  readonly attemptCount: number;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
  };
}

export interface LangGraphInspection {
  readonly protocolVersion: typeof LANGGRAPH_PROTOCOL_VERSION;
  readonly executionId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly graph: "baseline";
  readonly status: LangGraphPlatformStatus;
  readonly checkpoint: {
    readonly checkpointId: string | null;
    readonly step: number | null;
    readonly count: number;
    readonly pendingWrites: number;
  };
  readonly events: readonly LangGraphEvent[];
  readonly result: LangGraphResult | null;
  readonly trajectory: {
    readonly phases: readonly { readonly name: string; readonly startedAt: string; readonly finishedAt: string | null }[];
  };
  readonly metrics: {
    readonly modelCallCount: number;
    readonly modelAttemptCount: number;
    readonly checkpointCount: number;
    readonly durationMs: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
  };
}

export interface LangGraphCancelResponse {
  readonly protocolVersion: typeof LANGGRAPH_PROTOCOL_VERSION;
  readonly executionId: string;
  readonly status: LangGraphPlatformStatus;
  readonly accepted: boolean;
  readonly alreadyTerminal: boolean;
  readonly message: string;
}

export function parseHealthResponse(value: unknown): LangGraphHealthResponse {
  const object = requireObject(value, "LangGraph health response");
  requireOnly(object, ["protocolVersion", "service", "serviceVersion", "langgraphVersion", "pythonVersion", "status", "checkpointPath", "checkpointPathWritable", "message"], "LangGraph health response");
  requireProtocol(object);
  requireString(object, "service");
  if (object.service !== "langgraph") throw new Error("LangGraph health response has an invalid service.");
  requireString(object, "serviceVersion");
  requireString(object, "langgraphVersion");
  requireString(object, "pythonVersion");
  if (object.status !== "ready" && object.status !== "unavailable") throw new Error("LangGraph health response has an invalid status.");
  requireString(object, "checkpointPath");
  requireBoolean(object, "checkpointPathWritable");
  requireString(object, "message");
  return object as unknown as LangGraphHealthResponse;
}

export function parseStartResponse(value: unknown): LangGraphStartResponse {
  const object = requireObject(value, "LangGraph start response");
  requireOnly(object, ["protocolVersion", "executionId", "runId", "threadId", "graph", "status", "idempotent"], "LangGraph start response");
  requireProtocol(object);
  requireString(object, "executionId");
  requireString(object, "runId");
  requireString(object, "threadId");
  if (object.graph !== "baseline") throw new Error("LangGraph start response has an invalid graph.");
  requireStatus(object.status);
  requireBoolean(object, "idempotent");
  return object as unknown as LangGraphStartResponse;
}

export function parseInspection(value: unknown): LangGraphInspection {
  const object = requireObject(value, "LangGraph inspection response");
  requireOnly(object, ["protocolVersion", "executionId", "runId", "threadId", "graph", "status", "checkpoint", "events", "result", "trajectory", "metrics"], "LangGraph inspection response");
  requireProtocol(object);
  requireString(object, "executionId");
  requireString(object, "runId");
  requireString(object, "threadId");
  if (object.graph !== "baseline") throw new Error("LangGraph inspection has an invalid graph.");
  requireStatus(object.status);
  const checkpoint = requireObject(object.checkpoint, "LangGraph checkpoint");
  requireOnly(checkpoint, ["checkpointId", "step", "count", "pendingWrites"], "LangGraph checkpoint");
  if (checkpoint.checkpointId !== null && typeof checkpoint.checkpointId !== "string") throw new Error("Invalid checkpoint ID.");
  if (checkpoint.step !== null && !isInteger(checkpoint.step)) throw new Error("Invalid checkpoint step.");
  requireNonNegativeInteger(checkpoint, "count");
  requireNonNegativeInteger(checkpoint, "pendingWrites");
  if (!Array.isArray(object.events)) throw new Error("LangGraph inspection events must be an array.");
  object.events.forEach(validateEvent);
  if (object.result !== null) validateResult(object.result);
  const trajectory = requireObject(object.trajectory, "LangGraph trajectory");
  if (!Array.isArray(trajectory.phases)) throw new Error("LangGraph trajectory phases must be an array.");
  const metrics = requireObject(object.metrics, "LangGraph metrics");
  for (const key of ["modelCallCount", "modelAttemptCount", "checkpointCount"] as const) requireNonNegativeInteger(metrics, key);
  if (metrics.durationMs !== null && !isInteger(metrics.durationMs)) throw new Error("Invalid LangGraph duration.");
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (metrics[key] !== null && !isInteger(metrics[key])) throw new Error(`Invalid LangGraph ${key}.`);
  }
  return object as unknown as LangGraphInspection;
}

export function parseCancelResponse(value: unknown): LangGraphCancelResponse {
  const object = requireObject(value, "LangGraph cancel response");
  requireOnly(object, ["protocolVersion", "executionId", "status", "accepted", "alreadyTerminal", "message"], "LangGraph cancel response");
  requireProtocol(object);
  requireString(object, "executionId");
  requireStatus(object.status);
  requireBoolean(object, "accepted");
  requireBoolean(object, "alreadyTerminal");
  requireString(object, "message");
  return object as unknown as LangGraphCancelResponse;
}

function validateEvent(value: unknown): void {
  const event = requireObject(value, "LangGraph event");
  requireOnly(event, ["source", "sourceSequence", "kind", "runId", "occurredAt", "payload"], "LangGraph event");
  if (event.source !== "langgraph-service") throw new Error("LangGraph event has an invalid source.");
  requirePositiveInteger(event, "sourceSequence");
  requireString(event, "kind");
  requireString(event, "runId");
  requireString(event, "occurredAt");
  requireObject(event.payload, "LangGraph event payload");
}

function validateResult(value: unknown): void {
  const result = requireObject(value, "LangGraph result");
  requireOnly(result, ["status", "runId", "startedAt", "finishedAt", "output", "error", "attemptCount", "usage"], "LangGraph result");
  requireStatus(result.status);
  requireString(result, "runId");
  if (result.startedAt !== null && typeof result.startedAt !== "string") throw new Error("Invalid LangGraph start time.");
  if (result.finishedAt !== null && typeof result.finishedAt !== "string") throw new Error("Invalid LangGraph finish time.");
  if (result.output !== null && typeof result.output !== "string") throw new Error("Invalid LangGraph output.");
  if (result.error !== null) {
    const error = requireObject(result.error, "LangGraph result error");
    requireOnly(error, ["code", "message", "failureKind", "retryable"], "LangGraph result error");
    requireString(error, "code");
    requireString(error, "message");
    requireFailureKind(error.failureKind);
    requireBoolean(error, "retryable");
  }
  requireNonNegativeInteger(result, "attemptCount");
  const usage = requireObject(result.usage, "LangGraph result usage");
  requireOnly(usage, ["inputTokens", "outputTokens", "totalTokens"], "LangGraph result usage");
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (usage[key] !== null && !isInteger(usage[key])) throw new Error(`Invalid LangGraph usage ${key}.`);
  }
}

function requireProtocol(value: Record<string, unknown>): void {
  if (value.protocolVersion !== LANGGRAPH_PROTOCOL_VERSION) throw new Error("Unsupported LangGraph protocol version.");
}

function requireStatus(value: unknown): asserts value is LangGraphPlatformStatus {
  if (!isStatus(value)) throw new Error("Invalid LangGraph execution status.");
}

function requireFailureKind(value: unknown): asserts value is LangGraphFailureKind {
  if (!isFailureKind(value)) throw new Error("Invalid LangGraph failure kind.");
}

function isStatus(value: unknown): value is LangGraphPlatformStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "cancelled" || value === "unknown";
}

function isFailureKind(value: unknown): value is LangGraphFailureKind {
  return value === "configuration" || value === "pre_dispatch" || value === "provider" || value === "timeout" || value === "cancelled" || value === "outcome_unknown" || value === "internal" || value === "reconciliation";
}

function requireObject(value: unknown, label: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, any>;
}

function requireOnly(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) throw new Error(`${label} contains an unexpected field: ${unexpected}.`);
}

function requireString(value: Record<string, unknown>, key: string): void {
  if (typeof value[key] !== "string" || value[key].length === 0) throw new Error(`LangGraph response is missing ${key}.`);
}

function requireBoolean(value: Record<string, unknown>, key: string): void {
  if (typeof value[key] !== "boolean") throw new Error(`LangGraph response has an invalid ${key}.`);
}

function requirePositiveInteger(value: Record<string, unknown>, key: string): void {
  if (!isInteger(value[key]) || value[key] < 1) throw new Error(`LangGraph response has an invalid ${key}.`);
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string): void {
  if (!isInteger(value[key]) || value[key] < 0) throw new Error(`LangGraph response has an invalid ${key}.`);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
