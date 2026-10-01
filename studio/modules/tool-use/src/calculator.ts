import type { CapabilityDescriptor, JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseToolUseConfig } from "./config.js";
import {
  ToolUseError,
  type ProposedToolCall,
  type ToolDefinition,
  type ToolExecutionReceipt,
  type ToolExecutor,
  type ToolRegistration,
  type ToolUseModule,
  type ToolUseDependencies,
  type ToolValidationResult,
  type ValidatedToolCall,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "strict-tool-use", version: "0.2.0" });
const DEFINITION: ToolDefinition = Object.freeze({
  name: "calculator.add",
  version: "0.1.0",
  description: "Add two finite numbers. Returns an object containing the numeric sum.",
  risk: "pure" as const,
  capability: Object.freeze({
    id: "calculator",
    version: "1.0.0",
    kind: "pure",
    operations: Object.freeze(["add"]),
  }),
  capabilityOperation: "add",
  inputSchema: deepFreeze({
    type: "object",
    properties: {
      left: { type: "number" },
      right: { type: "number" },
    },
    required: ["left", "right"],
    additionalProperties: false,
  } satisfies ToolDefinition["inputSchema"]),
});

/** A strict registration for the first planned Tool Use example. */
export function createCalculatorAddRegistration(): ToolRegistration {
  return Object.freeze({
    definition: DEFINITION,
    validateArguments(value: unknown) {
      if (!isPlainRecord(value)) throw new TypeError("Arguments must be a JSON object.");
      const keys = Object.keys(value);
      if (keys.length !== 2 || !keys.includes("left") || !keys.includes("right")) {
        throw new TypeError('Arguments must contain exactly the numeric fields "left" and "right".');
      }
      if (typeof value.left !== "number" || !Number.isFinite(value.left)
        || typeof value.right !== "number" || !Number.isFinite(value.right)) {
        throw new TypeError('Arguments "left" and "right" must be finite numbers.');
      }
      return Object.freeze({ left: value.left, right: value.right });
    },
  });
}

/**
 * Create a Tool Use module from registered tools and a scoped executor. The
 * first package baseline exports `calculator.add` as its concrete registration.
 */
export function createToolUseModule(config: unknown, dependencies: ToolUseDependencies): ToolUseModule {
  const parsedConfig = parseToolUseConfig(config);
  const registrations = validateDependencies(dependencies);
  const registrationByName = new Map(registrations.map((registration) => [registration.definition.name, registration]));
  const definitions = Object.freeze(registrations.map(({ definition }) => definition));
  const validateCall = (call: ProposedToolCall): ToolValidationResult => validateRegisteredCall(
    call,
    registrationByName,
    parsedConfig.maxArgumentBytes,
  );

  return Object.freeze({
    identity: IDENTITY,
    definitions: () => definitions,
    validate: validateCall,
    async dispatch(call: ValidatedToolCall, scope: RunScope, signal: AbortSignal): Promise<ToolExecutionReceipt> {
      validateDispatchInputs(scope, signal);
      if (signal.aborted) throw new ToolUseError("TOOL_USE_CANCELLED", "Tool dispatch was cancelled before execution began.");

      const checked = validateCall({ callId: call?.callId, name: call?.definition?.name, arguments: call?.arguments });
      if (!checked.accepted || !sameDefinition(call?.definition, checked.accepted ? checked.call.definition : undefined)) {
        throw new ToolUseError("TOOL_EXECUTION_FAILED", checked.accepted
          ? "The validated call definition does not match the registered tool."
          : `Cannot dispatch an invalid call: ${checked.message}`);
      }

      const executor = dependencies.executor;
      const result = await executeWithBounds(
        executor,
        { scope, call: checked.call },
        signal,
        parsedConfig.timeoutMs,
      );
      return validateReceipt(result, parsedConfig.maxResultBytes);
    },
  });
}

/** Convenient typed factory for the calculator.add baseline. */
export function createCalculatorAddToolUse(config: unknown, executor: ToolExecutor): ToolUseModule {
  return createToolUseModule(config, {
    registrations: [createCalculatorAddRegistration()],
    executor,
  });
}

function validateRegisteredCall(
  call: ProposedToolCall,
  registrationByName: ReadonlyMap<string, ToolRegistration>,
  maxArgumentBytes: number,
): ToolValidationResult {
  const invalidCall = validateProposedCallShape(call);
  if (invalidCall) return { accepted: false, code: "INVALID_CALL", message: invalidCall };

  const registration = registrationByName.get(call.name);
  if (!registration) return { accepted: false, code: "UNKNOWN_TOOL", message: `Tool ${JSON.stringify(call.name)} is not registered.` };

  const rawArguments = serializeJsonObject(call.arguments);
  if (!rawArguments) return { accepted: false, code: "INVALID_ARGUMENTS", message: "Tool arguments must be a finite JSON object." };
  if (rawArguments.byteLength > maxArgumentBytes) {
    return {
      accepted: false,
      code: "ARGUMENTS_TOO_LARGE",
      message: `Serialized arguments are ${rawArguments.byteLength} bytes; the limit is ${maxArgumentBytes}.`,
    };
  }

  let validatedArguments: unknown;
  try {
    validatedArguments = registration.validateArguments(rawArguments.value);
  } catch (error) {
    return { accepted: false, code: "INVALID_ARGUMENTS", message: safeErrorMessage(error, "Tool arguments did not match its registration.") };
  }
  const normalizedArguments = serializeJsonObject(validatedArguments);
  if (!normalizedArguments) {
    return { accepted: false, code: "INVALID_ARGUMENTS", message: "The tool registration returned non-JSON arguments." };
  }
  if (normalizedArguments.byteLength > maxArgumentBytes) {
    return {
      accepted: false,
      code: "ARGUMENTS_TOO_LARGE",
      message: `Validated arguments are ${normalizedArguments.byteLength} bytes; the limit is ${maxArgumentBytes}.`,
    };
  }

  return {
    accepted: true,
    call: Object.freeze({
      callId: call.callId,
      definition: registration.definition,
      arguments: deepFreeze(normalizedArguments.value),
    }),
  };
}

function validateDependencies(dependencies: ToolUseDependencies): readonly ToolRegistration[] {
  if (!dependencies || !Array.isArray(dependencies.registrations) || dependencies.registrations.length === 0
    || !dependencies.executor || typeof dependencies.executor.execute !== "function") {
    throw new TypeError("Tool Use requires at least one registration and an executor with execute().");
  }
  const seen = new Set<string>();
  const registrations = dependencies.registrations.map((registration) => {
    if (!registration || typeof registration.validateArguments !== "function") {
      throw new TypeError("Each tool registration requires validateArguments().");
    }
    const definition = validateAndCopyDefinition(registration.definition);
    if (seen.has(definition.name)) throw new TypeError(`Tool ${JSON.stringify(definition.name)} is registered more than once.`);
    seen.add(definition.name);
    return Object.freeze({ definition, validateArguments: registration.validateArguments });
  });
  return Object.freeze(registrations);
}

function validateAndCopyDefinition(value: unknown): ToolDefinition {
  const risk = isPlainRecord(value) ? value.risk : undefined;
  const hasCapability = isPlainRecord(value) && value.capability !== undefined;
  const hasCapabilityOperation = isPlainRecord(value) && value.capabilityOperation !== undefined;
  if (!isPlainRecord(value) || !isText(value.name) || !isText(value.version) || !isText(value.description)
    || hasCapability !== hasCapabilityOperation
    || !hasExactDataProperties(value, hasCapability
      ? ["name", "version", "description", "risk", "inputSchema", "capability", "capabilityOperation"]
      : ["name", "version", "description", "risk", "inputSchema"])
    || (risk !== "pure" && risk !== "read" && risk !== "write" && risk !== "external")) {
    throw new TypeError("Tool definition requires a name, version, description, risk, and a complete capability operation when a capability is declared.");
  }
  const schema = serializeJsonObject(value.inputSchema);
  if (!schema) throw new TypeError("Tool definition inputSchema must be a finite JSON object.");
  const capability = value.capability === undefined ? undefined : validateCapabilityDescriptor(value.capability);
  let capabilityOperation: string | undefined;
  if (capability) {
    if (!isText(value.capabilityOperation) || !capability.operations.includes(value.capabilityOperation)) {
      throw new TypeError("Tool capabilityOperation must appear in the capability descriptor operations.");
    }
    capabilityOperation = value.capabilityOperation;
  }
  return Object.freeze({
    name: value.name,
    version: value.version,
    description: value.description,
    risk,
    inputSchema: deepFreeze(schema.value),
    ...(capability ? { capability } : {}),
    ...(capabilityOperation ? { capabilityOperation } : {}),
  });
}

function validateCapabilityDescriptor(value: unknown): CapabilityDescriptor {
  if (!isPlainRecord(value) || !hasExactDataProperties(value, ["id", "version", "kind", "operations"])
    || !isText(value.id) || !isText(value.version) || !isText(value.kind)
    || hasControlCharacters(value.id) || hasControlCharacters(value.version) || hasControlCharacters(value.kind)
    || !Array.isArray(value.operations) || value.operations.length === 0
    || !value.operations.every((operation) => isText(operation) && !hasControlCharacters(operation))
    || new Set(value.operations).size !== value.operations.length) {
    throw new TypeError("Tool capability must have an ID, version, kind, and unique non-empty operations.");
  }
  return Object.freeze({
    id: value.id,
    version: value.version,
    kind: value.kind,
    operations: Object.freeze([...value.operations]),
  });
}

function validateProposedCallShape(value: unknown): string | undefined {
  if (!isPlainRecord(value)) return "Tool call must be an object.";
  if (!isText(value.callId) || hasControlCharacters(value.callId)) return "Tool call requires a valid callId.";
  if (!isText(value.name) || hasControlCharacters(value.name)) return "Tool call requires a valid tool name.";
  if (!Object.prototype.hasOwnProperty.call(value, "arguments")) return "Tool call requires arguments.";
  return undefined;
}

function validateDispatchInputs(scope: RunScope, signal: AbortSignal): void {
  if (!scope || typeof scope.runId !== "string" || !isText(scope.runId) || hasControlCharacters(scope.runId)) {
    throw new ToolUseError("TOOL_EXECUTION_FAILED", "Tool dispatch requires a valid runId.");
  }
  if (scope.sessionId !== undefined && (!isText(scope.sessionId) || hasControlCharacters(scope.sessionId))) {
    throw new ToolUseError("TOOL_EXECUTION_FAILED", "Tool dispatch sessionId is invalid.");
  }
  if (scope.turnId !== undefined && (!isText(scope.turnId) || hasControlCharacters(scope.turnId))) {
    throw new ToolUseError("TOOL_EXECUTION_FAILED", "Tool dispatch turnId is invalid.");
  }
  if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function"
    || typeof signal.removeEventListener !== "function") {
    throw new ToolUseError("TOOL_EXECUTION_FAILED", "Tool dispatch requires an AbortSignal.");
  }
}

async function executeWithBounds(
  executor: ToolExecutor,
  input: { readonly scope: RunScope; readonly call: ValidatedToolCall },
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCallerAbort: (() => void) | undefined;
  let rejectInterruption: ((error: DispatchInterrupted) => void) | undefined;
  let interruptionStarted = false;

  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const interrupt = (reason: "cancelled" | "timed-out"): void => {
    if (interruptionStarted) return;
    interruptionStarted = true;
    controller.abort();
    rejectInterruption?.(new DispatchInterrupted(reason));
  };

  onCallerAbort = () => interrupt("cancelled");
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  timer = setTimeout(() => interrupt("timed-out"), timeoutMs);

  try {
    let execution: Promise<ToolExecutionReceipt>;
    try {
      execution = Promise.resolve(executor.execute(input, controller.signal));
    } catch (error) {
      throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", `Executor threw after dispatch began: ${safeErrorMessage(error, "unknown executor error")}`);
    }
    return await Promise.race([execution, interruption]);
  } catch (error) {
    if (error instanceof DispatchInterrupted && error.reason === "timed-out") {
      throw new ToolUseError("TOOL_TIMEOUT", `Tool exceeded ${timeoutMs} ms; its external outcome may be unknown.`);
    }
    if (error instanceof DispatchInterrupted && error.reason === "cancelled") {
      throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", "Tool dispatch was cancelled after execution began; its external outcome may be unknown.");
    }
    if (error instanceof ToolUseError) throw error;
    throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", `Executor failed after dispatch began: ${safeErrorMessage(error, "unknown executor error")}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onCallerAbort) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

function validateReceipt(value: unknown, maxResultBytes: number): ToolExecutionReceipt {
  if (!isPlainRecord(value)) throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", "Executor returned a malformed receipt; do not retry the call automatically.");
  const allowedKeys = ["status", "output", "error", "durationMs", "attemptCount"];
  if (!hasExactDataProperties(value, allowedKeys)) {
    throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", "Executor receipt did not match the declared receipt fields; outcome is not trusted.");
  }

  const status = value.status;
  const output = value.output;
  const error = value.error;
  const durationMs = value.durationMs;
  const attemptCount = value.attemptCount;
  if (!isToolStatus(status) || !Object.prototype.hasOwnProperty.call(value, "output")
    || !(output === null || isJsonValue(output))
    || !(error === null || isReceiptError(error))
    || !(durationMs === null || (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0))
    || typeof attemptCount !== "number" || !Number.isSafeInteger(attemptCount) || attemptCount < 1
    || status === "completed" && error !== null
    || status === "failed" && error === null) {
    throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", "Executor returned an invalid receipt; outcome is not trusted.");
  }

  const receipt = {
    status,
    output: output === null ? null : deepFreeze(output),
    error: error === null ? null : Object.freeze({ code: error.code, message: error.message }),
    durationMs,
    attemptCount,
  } as ToolExecutionReceipt;
  const serialized = JSON.stringify(receipt);
  const resultBytes = new TextEncoder().encode(serialized).byteLength;
  if (resultBytes > maxResultBytes) {
    throw new ToolUseError("TOOL_OUTCOME_UNKNOWN", `Executor receipt is ${resultBytes} bytes; the ${maxResultBytes}-byte limit was exceeded after dispatch.`);
  }
  return Object.freeze(receipt);
}

function serializeJsonObject(value: unknown): { readonly value: Readonly<Record<string, JsonValue>>; readonly byteLength: number } | undefined {
  if (!isPlainRecord(value) || !isJsonValue(value)) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return undefined;
    return {
      value: JSON.parse(serialized) as Readonly<Record<string, JsonValue>>,
      byteLength: new TextEncoder().encode(serialized).byteLength,
    };
  } catch {
    return undefined;
  }
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;
  ancestors.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value);
    valid = ownKeys.every((key) => key === "length" || typeof key === "string" && isArrayIndex(key, value.length));
    for (let index = 0; valid && index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      valid = descriptor !== undefined && "value" in descriptor && !!descriptor.enumerable && isJsonValue(descriptor.value, ancestors);
    }
  } else {
    const keys = Reflect.ownKeys(value);
    valid = keys.every((key) => typeof key === "string");
    for (const key of keys) {
      if (!valid) break;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      valid = descriptor !== undefined && !!descriptor.enumerable && "value" in descriptor && isJsonValue(descriptor.value, ancestors);
    }
  }
  ancestors.delete(value);
  return valid;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function isReceiptError(value: unknown): value is { readonly code: string; readonly message: string } {
  return isPlainRecord(value)
    && hasExactDataProperties(value, ["code", "message"])
    && isText(value.code)
    && isText(value.message)
    && !hasControlCharacters(value.code)
    && !hasControlCharacters(value.message);
}

function hasExactDataProperties(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) return false;
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
  });
}

function isToolStatus(value: unknown): value is ToolExecutionReceipt["status"] {
  return value === "completed" || value === "failed" || value === "cancelled"
    || value === "timed-out" || value === "unknown" || value === "rejected";
}

function isArrayIndex(value: string, length: number): boolean {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === value;
}

function sameDefinition(left: ToolDefinition | undefined, right: ToolDefinition | undefined): boolean {
  return !!left && !!right && left.name === right.name && left.version === right.version
    && left.description === right.description && left.risk === right.risk
    && JSON.stringify(left.inputSchema) === JSON.stringify(right.inputSchema)
    && JSON.stringify(left.capability ?? null) === JSON.stringify(right.capability ?? null)
    && (left.capabilityOperation ?? null) === (right.capabilityOperation ?? null);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

class DispatchInterrupted extends Error {
  constructor(readonly reason: "cancelled" | "timed-out") {
    super(reason);
  }
}
