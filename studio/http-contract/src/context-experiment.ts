import {
  STUDIO_CHAT_API_VERSION,
  isStudioChatAssemblyResponse,
  isStudioChatTurnResponse,
  type StudioChatAssembly,
  type StudioChatComponentIdentity,
  type StudioChatTurnResponse,
  type StudioJsonValue,
} from "./chat.js";

export const STUDIO_CONTEXT_EXPERIMENT_API_VERSION = "1" as const;
export const STUDIO_CONTEXT_EXPERIMENT_ID = "context-retention" as const;
export const STUDIO_CONTEXT_EXPERIMENT_VERSION = "1" as const;
export const STUDIO_CONTEXT_EXPERIMENT_CASE_ID = "old-important-fact-v1" as const;

export const STUDIO_CONTEXT_STRATEGY_IDENTITIES = Object.freeze([
  { id: "deterministic-context-assembler", version: "0.4.0" },
  { id: "fixed-recent-message-window", version: "0.1.0" },
] as const);

export const STUDIO_CONTEXT_TOKEN_BUDGET = Object.freeze({
  contextWindowTokens: 8_192,
  reservedOutputTokens: 512,
  safetyMarginTokens: 256,
  tokenizer: "utf8-bytes-div4-estimate-v1",
} as const);

export interface StudioContextExperimentRequest {
  readonly apiVersion: typeof STUDIO_CONTEXT_EXPERIMENT_API_VERSION;
  readonly comparisonId: string;
  readonly caseId: typeof STUDIO_CONTEXT_EXPERIMENT_CASE_ID;
  readonly maxRecentMessages: number;
}

export type StudioContextComparisonStatus =
  | "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted" | "unknown";

export type StudioContextVariantStatus =
  | "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "unknown";

export type StudioContextExperimentFailureCode =
  | "VARIANT_FAILED" | "VARIANT_CANCELLED" | "RUN_ARTIFACT_PERSISTENCE_FAILED" | "OUTCOME_UNKNOWN";

export interface StudioContextExperimentFailure {
  readonly code: StudioContextExperimentFailureCode;
  readonly message: string;
}

export interface StudioContextExperimentVariant {
  readonly strategy: StudioChatComponentIdentity;
  readonly runId: string | null;
  readonly status: StudioContextVariantStatus;
  readonly evidence: StudioChatTurnResponse | null;
  readonly failure: StudioContextExperimentFailure | null;
}

export interface StudioContextExperimentResponse {
  readonly apiVersion: typeof STUDIO_CONTEXT_EXPERIMENT_API_VERSION;
  readonly experiment: { readonly id: typeof STUDIO_CONTEXT_EXPERIMENT_ID; readonly version: typeof STUDIO_CONTEXT_EXPERIMENT_VERSION };
  readonly comparisonId: string;
  readonly status: StudioContextComparisonStatus;
  readonly case: {
    readonly scenarioId: "context-stress";
    readonly fixtureId: "old-important-fact";
    readonly fixtureVersion: "1";
  };
  readonly sharedControls: {
    readonly taskId: "old-important-fact:task:v1";
    readonly model: { readonly id: string; readonly version: string };
    readonly modelParameters: Readonly<Record<string, StudioJsonValue>>;
    readonly contextBudget: typeof STUDIO_CONTEXT_TOKEN_BUDGET;
    readonly assembly: StudioChatAssembly;
  };
  readonly changedVariable: { readonly id: "max-recent-context-messages"; readonly maxRecentMessages: number };
  readonly variants: readonly [StudioContextExperimentVariant, StudioContextExperimentVariant];
  readonly createdAt: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

export type StudioContextExperimentErrorCode =
  | "INVALID_REQUEST" | "UNSUPPORTED_API_VERSION" | "COMPARISON_NOT_FOUND"
  | "COMPARISON_ID_REUSED" | "COMPARISON_PERSISTENCE_FAILED";

export interface StudioContextExperimentError {
  readonly apiVersion: typeof STUDIO_CONTEXT_EXPERIMENT_API_VERSION;
  readonly error: { readonly code: StudioContextExperimentErrorCode; readonly message: string };
}

const COMPARISON_STATUSES: readonly StudioContextComparisonStatus[] = Object.freeze([
  "running", "completed", "partial", "failed", "cancelled", "interrupted", "unknown",
]);
const VARIANT_STATUSES: readonly StudioContextVariantStatus[] = Object.freeze([
  "pending", "running", "completed", "failed", "cancelled", "interrupted", "unknown",
]);
const HTTP_ERROR_CODES: readonly StudioContextExperimentErrorCode[] = Object.freeze([
  "INVALID_REQUEST", "UNSUPPORTED_API_VERSION", "COMPARISON_NOT_FOUND", "COMPARISON_ID_REUSED", "COMPARISON_PERSISTENCE_FAILED",
]);
const FAILURE_CODES: readonly StudioContextExperimentFailureCode[] = Object.freeze([
  "VARIANT_FAILED", "VARIANT_CANCELLED", "RUN_ARTIFACT_PERSISTENCE_FAILED", "OUTCOME_UNKNOWN",
]);

/** Strictly validates the only request accepted by the fixed Context comparison endpoint. */
export function isStudioContextExperimentRequest(value: unknown): value is StudioContextExperimentRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["apiVersion", "comparisonId", "caseId", "maxRecentMessages"])) return false;
  let encodedBytes: number;
  try {
    encodedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return false;
  }
  return encodedBytes <= 4_096
    && value.apiVersion === STUDIO_CONTEXT_EXPERIMENT_API_VERSION
    && isUuid(value.comparisonId)
    && value.caseId === STUDIO_CONTEXT_EXPERIMENT_CASE_ID
    && Number.isInteger(value.maxRecentMessages)
    && (value.maxRecentMessages as number) >= 1
    && (value.maxRecentMessages as number) <= 12;
}

/** Validates the safe comparison projection returned by POST and GET. */
export function isStudioContextExperimentResponse(value: unknown): value is StudioContextExperimentResponse {
  if (!isRecord(value) || !hasExactKeys(value, [
    "apiVersion", "experiment", "comparisonId", "status", "case", "sharedControls",
    "changedVariable", "variants", "createdAt", "startedAt", "updatedAt", "finishedAt",
  ])) return false;
  if (value.apiVersion !== STUDIO_CONTEXT_EXPERIMENT_API_VERSION || !isUuid(value.comparisonId)
    || !COMPARISON_STATUSES.includes(value.status as StudioContextComparisonStatus)
    || !isTimestamp(value.createdAt) || !isTimestamp(value.startedAt) || !isTimestamp(value.updatedAt)
    || !(value.finishedAt === null || isTimestamp(value.finishedAt))) return false;
  if (!isRecord(value.experiment) || !hasExactKeys(value.experiment, ["id", "version"])
    || value.experiment.id !== STUDIO_CONTEXT_EXPERIMENT_ID || value.experiment.version !== STUDIO_CONTEXT_EXPERIMENT_VERSION) return false;
  if (!isRecord(value.case) || !hasExactKeys(value.case, ["scenarioId", "fixtureId", "fixtureVersion"])
    || value.case.scenarioId !== "context-stress" || value.case.fixtureId !== "old-important-fact"
    || value.case.fixtureVersion !== "1") return false;
  if (!isRecord(value.sharedControls) || !hasExactKeys(value.sharedControls, ["taskId", "model", "modelParameters", "contextBudget", "assembly"])
    || value.sharedControls.taskId !== "old-important-fact:task:v1"
    || !isIdentity(value.sharedControls.model) || !isJsonObject(value.sharedControls.modelParameters)
    || !isStudioJsonValue(value.sharedControls.modelParameters)
    || !isExactBudget(value.sharedControls.contextBudget)
    || !isStudioChatAssemblyResponse({ apiVersion: STUDIO_CHAT_API_VERSION, assembly: value.sharedControls.assembly })) return false;
  const baselineAssemblyContext = (value.sharedControls.assembly as StudioChatAssembly).components.find((component) => component.area === "context");
  const modelComponent = (value.sharedControls.assembly as StudioChatAssembly).components.find((component) => component.area === "model-interface");
  if (!baselineAssemblyContext || !isStrategy(baselineAssemblyContext, 0, 4)
    || !modelComponent || !sameJson(value.sharedControls.model, modelComponent.implementation)
    || !sameJson(value.sharedControls.modelParameters, modelComponent.configuration)) return false;
  if (!isRecord(value.changedVariable) || !hasExactKeys(value.changedVariable, ["id", "maxRecentMessages"])
    || value.changedVariable.id !== "max-recent-context-messages"
    || !Number.isInteger(value.changedVariable.maxRecentMessages)
    || (value.changedVariable.maxRecentMessages as number) < 1 || (value.changedVariable.maxRecentMessages as number) > 12) return false;
  if (!Array.isArray(value.variants) || value.variants.length !== 2
    || !isVariant(value.variants[0], 0, value.changedVariable.maxRecentMessages as number, value.sharedControls.assembly as StudioChatAssembly)
    || !isVariant(value.variants[1], 1, value.changedVariable.maxRecentMessages as number, value.sharedControls.assembly as StudioChatAssembly)) return false;

  const statuses = value.variants.map((variant) => (variant as StudioContextExperimentVariant).status);
  switch (value.status) {
    case "completed":
      return statuses.every((status) => status === "completed") && value.finishedAt !== null;
    case "partial":
      return statuses.filter((status) => status === "completed").length === 1
        && statuses.filter((status) => status === "failed").length === 1 && value.finishedAt !== null;
    case "failed":
      return statuses.every((status) => status === "failed") && value.finishedAt !== null;
    case "running":
      return value.finishedAt === null;
    case "cancelled":
      return statuses.some((status) => status === "cancelled") && value.finishedAt !== null;
    case "interrupted":
      return value.finishedAt !== null && statuses.some((status) => status === "interrupted");
    case "unknown":
      return value.finishedAt !== null && statuses.some((status) => status === "unknown");
  }
  return false;
}

/** Validates the versioned, path-free error shape used by Context experiment routes. */
export function isStudioContextExperimentError(value: unknown): value is StudioContextExperimentError {
  return isRecord(value) && hasExactKeys(value, ["apiVersion", "error"])
    && value.apiVersion === STUDIO_CONTEXT_EXPERIMENT_API_VERSION
    && isRecord(value.error) && hasExactKeys(value.error, ["code", "message"])
    && HTTP_ERROR_CODES.includes(value.error.code as StudioContextExperimentErrorCode)
    && isSafeMessage(value.error.message);
}

function isVariant(
  value: unknown,
  index: 0 | 1,
  maxRecentMessages: number,
  baselineAssembly: StudioChatAssembly,
): value is StudioContextExperimentVariant {
  if (!isRecord(value) || !hasExactKeys(value, ["strategy", "runId", "status", "evidence", "failure"])
    || !isStrategy(value.strategy, index, maxRecentMessages)
    || !(value.runId === null || isUuid(value.runId))
    || !VARIANT_STATUSES.includes(value.status as StudioContextVariantStatus)
    || !(value.evidence === null || isStudioChatTurnResponse(value.evidence))
    || !(value.failure === null || isFailure(value.failure))) return false;
  const status = value.status as StudioContextVariantStatus;
  if (status === "pending") return value.runId === null && value.evidence === null && value.failure === null;
  if (status === "completed") return isUuid(value.runId) && value.evidence !== null && value.failure === null
    && value.evidence.runId === value.runId
    && contextStrategyMatches(value.evidence.assembly, value.strategy)
    && assembliesDifferOnlyByContext(baselineAssembly, value.evidence.assembly);
  if (status === "running") return isUuid(value.runId) && value.evidence === null && value.failure === null;
  return value.failure !== null && (value.runId === null || isUuid(value.runId)) && value.evidence === null;
}

function isStrategy(value: unknown, index: 0 | 1, maxRecentMessages: number): value is StudioChatComponentIdentity {
  if (!isRecord(value) || !hasExactKeys(value, ["area", "packageName", "packageVersion", "implementation", "configuration"])
    || value.area !== "context" || value.packageName !== "@agent-harness-lab/module-context"
    || value.packageVersion !== "0.6.0" || !isIdentity(value.implementation)
    || !isJsonObject(value.configuration) || !isStudioJsonValue(value.configuration)
    || !isStrategyConfiguration(value.configuration, index, maxRecentMessages)) return false;
  return value.implementation.id === STUDIO_CONTEXT_STRATEGY_IDENTITIES[index].id
    && value.implementation.version === STUDIO_CONTEXT_STRATEGY_IDENTITIES[index].version;
}

function contextStrategyMatches(assembly: StudioChatAssembly, strategy: StudioChatComponentIdentity): boolean {
  const context = assembly.components.find((component) => component.area === "context");
  return context !== undefined && sameJson(context, strategy);
}

function assembliesDifferOnlyByContext(baseline: StudioChatAssembly, candidate: StudioChatAssembly): boolean {
  if (baseline.schemaVersion !== candidate.schemaVersion || baseline.id !== candidate.id
    || baseline.version !== candidate.version || baseline.mode !== candidate.mode
    || !sameJson(baseline.limitations, candidate.limitations) || baseline.components.length !== 12
    || candidate.components.length !== 12) return false;
  const baselineByArea = new Map(baseline.components.map((component) => [component.area, component]));
  const candidateByArea = new Map(candidate.components.map((component) => [component.area, component]));
  if (baselineByArea.size !== 12 || candidateByArea.size !== 12 || baselineByArea.size !== candidateByArea.size) return false;
  for (const [area, component] of baselineByArea) {
    const other = candidateByArea.get(area);
    if (!other) return false;
    if (area === "context") continue;
    if (!sameJson(component, other)) return false;
  }
  return true;
}

function isStrategyConfiguration(value: Record<string, unknown>, index: 0 | 1, maxRecentMessages: number): boolean {
  const expectedKeys = index === 0
    ? ["maxMessages", "maxSourceBytes", "minAvailableInputTokens", "budget"]
    : ["maxMessages", "maxSourceBytes", "minAvailableInputTokens", "maxRecentMessages", "budget"];
  return hasExactKeys(value, expectedKeys)
    && value.maxMessages === 100
    && value.maxSourceBytes === 16_000
    && value.minAvailableInputTokens === 1
    && (index === 0 || value.maxRecentMessages === maxRecentMessages)
    && isExactBudget(value.budget);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isFailure(value: unknown): value is StudioContextExperimentFailure {
  return isRecord(value) && hasExactKeys(value, ["code", "message"])
    && FAILURE_CODES.includes(value.code as StudioContextExperimentFailureCode)
    && isSafeMessage(value.message);
}

function isExactBudget(value: unknown): value is typeof STUDIO_CONTEXT_TOKEN_BUDGET {
  return isRecord(value) && hasExactKeys(value, ["contextWindowTokens", "reservedOutputTokens", "safetyMarginTokens", "tokenizer"])
    && value.contextWindowTokens === STUDIO_CONTEXT_TOKEN_BUDGET.contextWindowTokens
    && value.reservedOutputTokens === STUDIO_CONTEXT_TOKEN_BUDGET.reservedOutputTokens
    && value.safetyMarginTokens === STUDIO_CONTEXT_TOKEN_BUDGET.safetyMarginTokens
    && value.tokenizer === STUDIO_CONTEXT_TOKEN_BUDGET.tokenizer;
}

function isIdentity(value: unknown): value is { readonly id: string; readonly version: string } {
  return isRecord(value) && hasExactKeys(value, ["id", "version"])
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.version === "string" && value.version.length > 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value.replace(/Z$/, ""));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isStudioJsonValue(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
