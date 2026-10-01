import type { JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseComputerUseConfig, type ComputerUseConfig } from "./config.js";
import {
  ComputerUseError,
  type ComputerAction,
  type ComputerActionReceipt,
  type ComputerActionResult,
  type ComputerEnvironmentCapability,
  type ComputerObservation,
  type ComputerUseDependencies,
  type ComputerUseModule,
  type ComputerVerification,
} from "./contract.js";

export const SCOPED_COMPUTER_USE_IDENTITY: ModuleIdentity = Object.freeze({ id: "scoped-computer-use", version: "0.2.0" });
const IDENTITY = SCOPED_COMPUTER_USE_IDENTITY;
const OBSERVATION_KINDS = new Set(["accessibility-tree", "dom", "screenshot-reference"]);
const ACTION_KINDS = new Set(["click", "type", "keypress", "scroll", "navigate"]);
const RECEIPT_STATUSES = new Set(["completed", "failed", "cancelled", "timed-out", "unknown"]);
const COMPUTER_CAPABILITY = Object.freeze({
  id: "computer",
  version: "1.0.0",
  kind: "computer",
  operations: Object.freeze(["observe", "click"]),
});

type PerformOutcome =
  | { readonly kind: "receipt"; readonly value: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "cancelled-before-dispatch" }
  | { readonly kind: "rejected"; readonly reason: unknown };

type ObserveOutcome =
  | { readonly kind: "observed"; readonly value: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "rejected"; readonly reason: unknown };

/**
 * Scoped adapter around a host computer capability. It records observations,
 * applies action/time/size limits, and leaves Safety approval to its caller.
 */
class ScopedComputerUse implements ComputerUseModule {
  readonly identity = IDENTITY;
  private readonly attemptedActionsByTurn = new Map<string, number>();

  constructor(
    private readonly config: ComputerUseConfig,
    private readonly dependencies: ComputerUseDependencies,
  ) {}

  requiredCapabilities() {
    return Object.freeze([COMPUTER_CAPABILITY]);
  }

  async observe(scopeValue: RunScope, signal: AbortSignal): Promise<ComputerObservation> {
    const scope = validateScope(scopeValue);
    assertSignal(signal);
    throwIfCancelled(signal);
    const outcome = await observeWithDeadline(
      this.dependencies.environment,
      scope,
      signal,
      this.config.actionTimeoutMs,
    );
    if (outcome.kind === "cancelled") throw cancelledBeforeAction();
    if (outcome.kind === "timeout") {
      throw new ComputerUseError("ENVIRONMENT_UNAVAILABLE", "Computer environment observation exceeded its configured timeout.");
    }
    if (outcome.kind === "rejected") {
      if (signal.aborted || isAbortError(outcome.reason)) throw cancelledBeforeAction();
      throw new ComputerUseError("ENVIRONMENT_UNAVAILABLE", errorMessage(outcome.reason, "Computer environment observation failed."));
    }
    throwIfCancelled(signal);
    return validateObservation(outcome.value, this.config.maxObservationBytes);
  }

  async act(actionValue: ComputerAction, scopeValue: RunScope, signal: AbortSignal): Promise<ComputerActionResult> {
    const scope = validateScope(scopeValue);
    const action = validateAction(actionValue);
    assertSignal(signal);
    throwIfCancelled(signal);
    this.assertActionAvailable(scope);

    const before = await this.observe(scope, signal);
    throwIfCancelled(signal);
    // Observation is asynchronous; another action may consume this turn's last
    // slot while this call waits. Recheck synchronously before reserving it.
    this.assertActionAvailable(scope);
    this.consumeActionSlot(scope);

    const startedAt = new Date().toISOString();
    const outcome = await performWithDeadline(
      this.dependencies.environment,
      scope,
      action,
      signal,
      this.config.actionTimeoutMs,
    );
    if (outcome.kind === "cancelled-before-dispatch") {
      this.releaseActionSlot(scope);
      throw cancelledBeforeAction();
    }
    const finishedAt = new Date().toISOString();
    const receipt = outcomeToReceipt(outcome, startedAt, finishedAt);

    let after: ComputerObservation | null = null;
    let verification: ComputerVerification;
    if (!signal.aborted) {
      try {
        after = await this.observe(scope, signal);
      } catch (error) {
        verification = notVerified(`Could not capture the post-action state: ${errorMessage(error, "observation failed")}`);
        return freezeResult({ action, receipt, before, after, verification });
      }
    }

    try {
      verification = validateVerification(this.dependencies.verify({ action, before, after }));
    } catch (error) {
      verification = { status: "failed", evidence: `Verification failed: ${errorMessage(error, "the verifier returned an error")}` };
    }
    return freezeResult({ action, receipt, before, after, verification });
  }

  private assertActionAvailable(scope: RunScope): void {
    const used = this.attemptedActionsByTurn.get(turnKey(scope)) ?? 0;
    if (used >= this.config.maxActionsPerTurn) {
      throw new ComputerUseError(
        "COMPUTER_ACTION_LIMIT_EXCEEDED",
        `This turn has reached its configured limit of ${this.config.maxActionsPerTurn} computer action attempts.`,
      );
    }
  }

  private consumeActionSlot(scope: RunScope): void {
    const key = turnKey(scope);
    this.attemptedActionsByTurn.set(key, (this.attemptedActionsByTurn.get(key) ?? 0) + 1);
  }

  private releaseActionSlot(scope: RunScope): void {
    const key = turnKey(scope);
    const used = this.attemptedActionsByTurn.get(key) ?? 0;
    if (used <= 1) this.attemptedActionsByTurn.delete(key);
    else this.attemptedActionsByTurn.set(key, used - 1);
  }
}

/** Create the injected-environment Computer Use baseline. */
export function createScopedComputerUse(config: unknown, dependencies: ComputerUseDependencies): ComputerUseModule {
  const parsed = parseComputerUseConfig(config);
  if (!isRecord(dependencies) || !isRecord(dependencies.environment)
    || typeof dependencies.environment.observe !== "function"
    || typeof dependencies.environment.perform !== "function"
    || typeof dependencies.verify !== "function") {
    throw new ComputerUseError("ENVIRONMENT_UNAVAILABLE", "Computer Use requires observe, perform, and verification dependencies.");
  }
  return new ScopedComputerUse(parsed, dependencies);
}

function validateScope(value: unknown): RunScope {
  if (!isRecord(value) || !isIdentifier(value.runId)
    || (value.sessionId !== undefined && !isIdentifier(value.sessionId))
    || (value.turnId !== undefined && !isIdentifier(value.turnId))) {
    throw new ComputerUseError("INVALID_COMPUTER_INPUT", "Computer operation scope requires a valid runId and optional valid sessionId and turnId values.");
  }
  return {
    runId: value.runId,
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(value.turnId === undefined ? {} : { turnId: value.turnId }),
  } as unknown as RunScope;
}

function validateAction(value: unknown): ComputerAction {
  if (!isRecord(value) || !isIdentifier(value.actionId)
    || typeof value.kind !== "string" || !ACTION_KINDS.has(value.kind)
    || (value.target !== undefined && !isWellFormedText(value.target))
    || (value.value !== undefined && !isWellFormedText(value.value))
    || (value.parameters !== undefined && !isJsonValue(value.parameters))) {
    throw new ComputerUseError("INVALID_COMPUTER_INPUT", "Computer action must have a valid ID, supported kind, and valid optional fields.");
  }
  return Object.freeze({
    actionId: value.actionId,
    kind: value.kind as ComputerAction["kind"],
    ...(value.target === undefined ? {} : { target: value.target }),
    ...(value.value === undefined ? {} : { value: value.value }),
    ...(value.parameters === undefined ? {} : { parameters: freezeJson(value.parameters) }),
  });
}

function validateObservation(value: unknown, maxBytes: number): ComputerObservation {
  if (!isRecord(value) || !isIdentifier(value.observationId)
    || typeof value.kind !== "string" || !OBSERVATION_KINDS.has(value.kind)
    || typeof value.capturedAt !== "string" || !isRfc3339DateTime(value.capturedAt)
    || !isJsonValue(value.content)) {
    throw new ComputerUseError("COMPUTER_OBSERVATION_INVALID", "Environment returned an invalid computer observation.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ComputerUseError("COMPUTER_OBSERVATION_INVALID", "Computer observation cannot be serialized as JSON.");
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new ComputerUseError("COMPUTER_OBSERVATION_TOO_LARGE", `Computer observation exceeds the configured ${maxBytes}-byte limit.`);
  }
  return Object.freeze({
    observationId: value.observationId,
    kind: value.kind as ComputerObservation["kind"],
    capturedAt: value.capturedAt,
    content: freezeJson(value.content),
  });
}

function validateVerification(value: unknown): ComputerVerification {
  if (!isRecord(value) || !["verified", "not-verified", "failed"].includes(String(value.status))
    || typeof value.evidence !== "string" || !isWellFormedUnicode(value.evidence)) {
    throw new TypeError("Verifier returned an invalid ComputerVerification.");
  }
  return Object.freeze({
    status: value.status as ComputerVerification["status"],
    evidence: value.evidence,
  });
}

function outcomeToReceipt(outcome: PerformOutcome, startedAt: string, finishedAt: string): ComputerActionReceipt {
  if (outcome.kind === "cancelled-before-dispatch") {
    return Object.freeze({ status: "cancelled", startedAt, finishedAt, detail: "Action was cancelled before dispatch." });
  }
  if (outcome.kind === "receipt") {
    const value = outcome.value;
    if (isRecord(value) && typeof value.status === "string" && RECEIPT_STATUSES.has(value.status)
      && typeof value.startedAt === "string" && isRfc3339DateTime(value.startedAt)
      && (value.finishedAt === null || (typeof value.finishedAt === "string" && isRfc3339DateTime(value.finishedAt)))
      && (value.detail === null || typeof value.detail === "string")) {
      return Object.freeze({
        status: value.status as ComputerActionReceipt["status"],
        startedAt: value.startedAt,
        finishedAt: value.finishedAt,
        detail: value.detail,
      });
    }
    return Object.freeze({ status: "unknown", startedAt, finishedAt, detail: "Environment returned an invalid receipt; action outcome is unknown." });
  }
  if (outcome.kind === "timeout") {
    return Object.freeze({ status: "unknown", startedAt, finishedAt, detail: "Action exceeded its timeout; the environment may have completed it." });
  }
  if (outcome.kind === "cancelled") {
    return Object.freeze({ status: "unknown", startedAt, finishedAt, detail: "Cancellation arrived after dispatch; action outcome is unknown." });
  }
  return Object.freeze({
    status: "unknown",
    startedAt,
    finishedAt,
    detail: `Environment operation rejected after dispatch; action outcome is unknown: ${errorMessage(outcome.reason, "no error detail")}`,
  });
}

function performWithDeadline(
  environment: ComputerEnvironmentCapability,
  scope: RunScope,
  action: ComputerAction,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<PerformOutcome> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let dispatchStarted = false;
    const finish = (outcome: PerformOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
      resolve(outcome);
    };
    const onParentAbort = () => {
      controller.abort();
      finish(dispatchStarted ? { kind: "cancelled" } : { kind: "cancelled-before-dispatch" });
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({ kind: "timeout" });
    }, timeoutMs);
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    if (parentSignal.aborted) {
      onParentAbort();
      return;
    }

    dispatchStarted = true;
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(environment.perform({ scope, action }, controller.signal));
    } catch (reason) {
      finish({ kind: "rejected", reason });
      return;
    }
    pending.then((receipt) => {
        if (!settled) finish({ kind: "receipt", value: receipt });
      })
      .catch((reason: unknown) => {
        if (!settled) finish({ kind: "rejected", reason });
      });
  });
}

function observeWithDeadline(
  environment: ComputerEnvironmentCapability,
  scope: RunScope,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<ObserveOutcome> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (outcome: ObserveOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
      resolve(outcome);
    };
    const onParentAbort = () => {
      controller.abort();
      finish({ kind: "cancelled" });
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({ kind: "timeout" });
    }, timeoutMs);
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    if (parentSignal.aborted) {
      onParentAbort();
      return;
    }

    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(environment.observe({ scope }, controller.signal));
    } catch (reason) {
      finish({ kind: "rejected", reason });
      return;
    }
    pending.then((value) => {
      if (!settled) finish({ kind: "observed", value });
    }, (reason: unknown) => {
      if (!settled) finish({ kind: "rejected", reason });
    });
  });
}

function freezeResult(value: ComputerActionResult): ComputerActionResult {
  return Object.freeze({ ...value });
}

function notVerified(evidence: string): ComputerVerification {
  return Object.freeze({ status: "not-verified", evidence });
}

function cancelledBeforeAction(): ComputerUseError {
  return new ComputerUseError("COMPUTER_USE_CANCELLED", "Computer operation was cancelled before an action was dispatched.");
}

function turnKey(scope: RunScope): string {
  return JSON.stringify([scope.runId, scope.turnId ?? null]);
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledBeforeAction();
}

function assertSignal(value: unknown): asserts value is AbortSignal {
  if (!isRecord(value) || typeof value.aborted !== "boolean"
    || typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function") {
    throw new ComputerUseError("INVALID_COMPUTER_INPUT", "A valid AbortSignal is required.");
  }
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string") return typeof value !== "string" || isWellFormedUnicode(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeJson(entry)));
  if (!Array.isArray(value) && typeof value === "object" && value !== null) {
    const copy: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(copy, key, { value: freezeJson(entry), enumerable: true, writable: false, configurable: false });
    }
    return Object.freeze(copy);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && isWellFormedUnicode(value);
}

function isWellFormedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && isWellFormedUnicode(value);
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

function isRfc3339DateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
