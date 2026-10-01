import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import { parsePlanningConfig, type PlanningConfig } from "./config.js";
import {
  PlanningError,
  type Planner,
  type PlanningInput,
  type PlanningMessage,
  type PlanningObservation,
  type ProposedPlan,
  type ProposedStep,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "single-step-response-planner", version: "0.1.0" });
const MESSAGE_ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);
const OBSERVATION_KINDS = new Set(["tool-result", "computer-observation", "user-update", "system-event"]);
const STEP_KINDS = new Set(["respond", "tool", "computer", "gather-information"]);
const SUMMARY = "Produce a response to the supplied task.";
const STEP_DESCRIPTION = "Respond to the supplied task.";
const COMPLETION_CONDITION = "The task has a recorded response.";

/**
 * A deterministic contract baseline. It proposes one text response without
 * interpreting task meaning, choosing tools, or deciding whether Control loops.
 */
class SingleStepResponsePlanner implements Planner {
  readonly identity = IDENTITY;

  constructor(private readonly config: PlanningConfig) {}

  async propose(value: PlanningInput, signal: AbortSignal): Promise<ProposedPlan> {
    if (!isAbortSignal(signal)) throw invalidInput("A valid AbortSignal is required.");
    throwIfCancelled(signal);
    const input = validateInput(value);

    if (this.config.maxSteps < 1) {
      throw new PlanningError("PLAN_LIMIT_EXCEEDED", "The configured step limit cannot fit the required response step.");
    }

    const descriptions = [SUMMARY, STEP_DESCRIPTION, COMPLETION_CONDITION];
    const oversized = descriptions.find((description) => utf8Bytes(description) > this.config.maxDescriptionBytes);
    if (oversized !== undefined) {
      throw new PlanningError(
        "PLAN_LIMIT_EXCEEDED",
        `A fixed plan description is ${utf8Bytes(oversized)} UTF-8 bytes; the configured limit is ${this.config.maxDescriptionBytes}.`,
      );
    }

    const sourceIdsConsidered = collectSourceIds(input.context, input.observations);
    const planId = createPlanId(input);
    const step: ProposedStep = Object.freeze({
      stepId: `${planId}:respond`,
      kind: "respond",
      description: STEP_DESCRIPTION,
    });
    const plan: ProposedPlan = Object.freeze({
      planId,
      summary: SUMMARY,
      steps: Object.freeze([step]),
      completionCondition: COMPLETION_CONDITION,
      assumptions: Object.freeze([]),
      evidence: Object.freeze({ sourceIdsConsidered: Object.freeze(sourceIdsConsidered) }),
    });

    throwIfCancelled(signal);
    return plan;
  }
}

/** Create the deterministic one-response-step planner. */
export function createSingleStepResponsePlanner(config: unknown = {}): Planner {
  return new SingleStepResponsePlanner(parsePlanningConfig(config));
}

function validateInput(value: unknown): PlanningInput {
  if (!isRecord(value)) throw invalidInput("Planning input must be an object.");
  const scope = value.scope;
  if (!isRecord(scope) || !isIdentifier(scope.runId)
    || (scope.sessionId !== undefined && !isIdentifier(scope.sessionId))
    || (scope.turnId !== undefined && !isIdentifier(scope.turnId))) {
    throw invalidInput("Planning scope requires a valid runId and optional valid sessionId and turnId values.");
  }
  if (typeof value.task !== "string" || value.task.trim().length === 0 || !isWellFormedUnicode(value.task)) {
    throw invalidInput("Planning task must be non-empty, well-formed Unicode text.");
  }
  if (!Array.isArray(value.context)) throw invalidInput("Planning context must be an array.");
  const context = value.context.map((message, index) => validateMessage(message, index));
  if (!Array.isArray(value.observations)) throw invalidInput("Planning observations must be an array.");
  const observations = value.observations.map((observation, index) => validateObservation(observation, index));
  const previousPlan = value.previousPlan === undefined ? undefined : validatePreviousPlan(value.previousPlan);

  return {
    scope: {
      runId: scope.runId,
      ...(scope.sessionId === undefined ? {} : { sessionId: scope.sessionId }),
      ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
    },
    task: value.task,
    context,
    observations,
    ...(previousPlan === undefined ? {} : { previousPlan }),
  } as unknown as PlanningInput;
}

function validateMessage(value: unknown, index: number): PlanningMessage {
  if (!isRecord(value) || typeof value.role !== "string" || !MESSAGE_ROLES.has(value.role)
    || typeof value.content !== "string" || !isWellFormedUnicode(value.content)
    || !Array.isArray(value.sourceIds) || !value.sourceIds.every(isIdentifier)) {
    throw invalidInput(`Planning context message ${index} is invalid.`);
  }
  return {
    role: value.role as PlanningMessage["role"],
    content: value.content,
    sourceIds: [...value.sourceIds] as string[],
  };
}

function validateObservation(value: unknown, index: number): PlanningObservation {
  if (!isRecord(value) || !isIdentifier(value.observationId)
    || typeof value.kind !== "string" || !OBSERVATION_KINDS.has(value.kind)
    || typeof value.summary !== "string" || value.summary.trim().length === 0 || !isWellFormedUnicode(value.summary)
    || !isIdentifier(value.sourceId)) {
    throw invalidInput(`Planning observation ${index} is invalid.`);
  }
  return {
    observationId: value.observationId,
    kind: value.kind as PlanningObservation["kind"],
    summary: value.summary,
    sourceId: value.sourceId,
  };
}

function validatePreviousPlan(value: unknown): ProposedPlan {
  if (!isRecord(value) || !isIdentifier(value.planId)
    || typeof value.summary !== "string" || value.summary.trim().length === 0
    || !Array.isArray(value.steps) || value.steps.length === 0
    || typeof value.completionCondition !== "string" || value.completionCondition.trim().length === 0
    || !Array.isArray(value.assumptions) || !value.assumptions.every((item) => typeof item === "string")
    || !isRecord(value.evidence) || !Array.isArray(value.evidence.sourceIdsConsidered)
    || !value.evidence.sourceIdsConsidered.every(isIdentifier)) {
    throw invalidInput("previousPlan is invalid.");
  }
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || !isIdentifier(step.stepId)
      || typeof step.kind !== "string" || !STEP_KINDS.has(step.kind)
      || typeof step.description !== "string" || step.description.trim().length === 0
      || (step.target !== undefined && typeof step.target !== "string")) {
      throw invalidInput(`previousPlan step ${index} is invalid.`);
    }
  }
  return value as unknown as ProposedPlan;
}

function collectSourceIds(
  context: readonly PlanningMessage[],
  observations: readonly PlanningObservation[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const message of context) {
    for (const sourceId of message.sourceIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      result.push(sourceId);
    }
  }
  for (const observation of observations) {
    if (seen.has(observation.sourceId)) continue;
    seen.add(observation.sourceId);
    result.push(observation.sourceId);
  }
  return result;
}

function createPlanId(input: PlanningInput): string {
  const seed = JSON.stringify({
    runId: input.scope.runId,
    sessionId: input.scope.sessionId ?? null,
    turnId: input.scope.turnId ?? null,
    task: input.task,
    context: input.context.map(({ role, content, sourceIds }) => ({ role, content, sourceIds })),
    observations: input.observations.map(({ observationId, kind, summary, sourceId }) => ({ observationId, kind, summary, sourceId })),
    previousPlanId: input.previousPlan?.planId ?? null,
  });
  return `single-response:${encodeURIComponent(input.scope.runId)}:${hashText(seed)}`;
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && isWellFormedUnicode(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return isRecord(value) && typeof value.aborted === "boolean"
    && typeof value.addEventListener === "function" && typeof value.removeEventListener === "function";
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Planning proposal was cancelled.");
  error.name = "AbortError";
  throw error;
}

function invalidInput(message: string): PlanningError {
  return new PlanningError("INVALID_PLANNING_INPUT", message);
}
