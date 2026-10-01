import type { CapabilityDescriptor, JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseExecutionEnvironmentConfig, type ExecutionEnvironmentConfig } from "./config.js";
import type {
  EnvironmentCloseReceipt,
  EnvironmentDescriptor,
  EnvironmentFailure,
  EnvironmentInvocation,
  EnvironmentInvocationReceipt,
  EnvironmentOpenResult,
  EnvironmentSession,
  ExecutionEnvironmentModule,
  OpenEnvironmentSessionRequest,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "controlled-reference-environment", version: "0.2.0" });
const CALCULATOR_ID = "calculator";
const CALCULATOR_VERSION = "1.0.0";
const CALCULATOR_KIND = "pure";
const CALCULATOR_OPERATIONS = Object.freeze(["add"]);
const COMPUTER_ID = "computer";
const COMPUTER_VERSION = "1.0.0";
const COMPUTER_KIND = "computer";
const COMPUTER_OPERATIONS = Object.freeze(["observe", "click"]);
let nextSessionNumber = 1;

/** The capability descriptor callers must allow and request to use this implementation. */
export const CALCULATOR_CAPABILITY: CapabilityDescriptor = Object.freeze({
  id: CALCULATOR_ID,
  version: CALCULATOR_VERSION,
  kind: CALCULATOR_KIND,
  operations: CALCULATOR_OPERATIONS,
});

export const COMPUTER_FIXTURE_CAPABILITY: CapabilityDescriptor = Object.freeze({
  id: COMPUTER_ID,
  version: COMPUTER_VERSION,
  kind: COMPUTER_KIND,
  operations: COMPUTER_OPERATIONS,
});

const SUPPORTED_CAPABILITIES = Object.freeze([CALCULATOR_CAPABILITY, COMPUTER_FIXTURE_CAPABILITY]);

/**
 * An in-process deterministic fixture for pure addition and a controlled
 * accessibility-tree computer page. It has no filesystem, process, network,
 * or external browser access.
 */
class CalculatorEnvironment implements ExecutionEnvironmentModule {
  readonly identity = IDENTITY;
  private readonly config: ExecutionEnvironmentConfig;

  constructor(config: ExecutionEnvironmentConfig) {
    this.config = config;
  }

  describe(): EnvironmentDescriptor {
    return Object.freeze({ identity: this.identity, capabilities: SUPPORTED_CAPABILITIES });
  }

  async openSession(request: OpenEnvironmentSessionRequest, signal: AbortSignal): Promise<EnvironmentOpenResult> {
    if (!isAbortSignal(signal)) return openFailure("INVALID_SIGNAL", "A valid AbortSignal is required.");
    if (signal.aborted) return openFailure("CANCELLED", "Environment session opening was cancelled.");
    const validation = validateOpenRequest(request);
    if (validation) return openFailure(validation.code, validation.message);

    const grants: CapabilityDescriptor[] = [];
    for (const requested of request.requestedCapabilities) {
      const supported = SUPPORTED_CAPABILITIES.find((entry) => entry.id === requested.id && entry.version === requested.version);
      if (!supported) {
        return openFailure("UNSUPPORTED_CAPABILITY", `Capability ${JSON.stringify(requested.id)} at version ${JSON.stringify(requested.version)} is not supported.`);
      }
      const configured = this.config.allowedCapabilities.find((entry) => entry.id === requested.id && entry.version === requested.version);
      if (!configured) return openFailure("CAPABILITY_NOT_ALLOWED", `Capability ${JSON.stringify(requested.id)} is not enabled by environment configuration.`);
      if (configured.kind !== supported.kind) {
        return openFailure("CAPABILITY_CONFIGURATION_MISMATCH", `Capability ${JSON.stringify(requested.id)} must be configured with kind ${JSON.stringify(supported.kind)}.`);
      }
      const requestedOperations = requested.operations;
      const uniqueOperations = new Set(requestedOperations);
      if (uniqueOperations.size !== requestedOperations.length || requestedOperations.some((operation) => !supported.operations.includes(operation))) {
        return openFailure("UNSUPPORTED_OPERATION", `Capability ${JSON.stringify(requested.id)} requested an unsupported or duplicate operation.`);
      }
      if (requestedOperations.some((operation) => !configured.operations.includes(operation))) {
        return openFailure("CAPABILITY_NOT_ALLOWED", `Capability ${JSON.stringify(requested.id)} requested an operation not enabled by environment configuration.`);
      }
      grants.push(Object.freeze({
        id: supported.id,
        version: supported.version,
        kind: supported.kind,
        operations: Object.freeze(supported.operations.filter((operation) => requestedOperations.includes(operation))),
      }));
    }

    const session: EnvironmentSession = new CalculatorSession(
      `calculator-session:${request.scope.runId}:${nextSessionNumber++}`,
      request.scope,
      Object.freeze(grants),
    );
    return Object.freeze({ outcome: "opened", session });
  }
}

class CalculatorSession implements EnvironmentSession {
  private closed = false;
  private readonly completedByOperationId = new Map<string, { readonly inputKey: string; readonly receipt: EnvironmentInvocationReceipt }>();
  private readonly completedByIdempotencyKey = new Map<string, { readonly inputKey: string; readonly output: JsonValue }>();
  private computerButtonClicked = false;

  constructor(
    readonly sessionId: string,
    readonly scope: RunScope,
    readonly capabilities: readonly CapabilityDescriptor[],
  ) {}

  async invoke(request: EnvironmentInvocation, signal: AbortSignal): Promise<EnvironmentInvocationReceipt> {
    const operationId = typeof request?.operationId === "string" ? request.operationId : "";
    if (this.closed) return rejected(operationId, "SESSION_CLOSED", "The environment session is closed.");
    if (!isAbortSignal(signal)) return rejected(operationId, "INVALID_SIGNAL", "A valid AbortSignal is required.");
    const invalid = validateInvocation(request);
    if (invalid) return rejected(operationId, "INVALID_INVOCATION", invalid);
    if (signal.aborted) return rejected(operationId, "CANCELLED", "Environment invocation was cancelled before it began.");

    const inputKey = invocationKey(request);
    const previousOperation = this.completedByOperationId.get(request.operationId);
    if (previousOperation) {
      if (previousOperation.inputKey !== inputKey) {
        return rejected(operationId, "OPERATION_ID_REUSED", "This operationId was already used with a different environment invocation.");
      }
      return previousOperation.receipt;
    }

    const granted = this.capabilities.find((capability) => capability.id === request.capabilityId
      && capability.version === request.capabilityVersion && capability.operations.includes(request.operation));
    if (!granted) return rejected(operationId, "CAPABILITY_NOT_GRANTED", "This session does not grant the requested environment operation.");

    if (signal.aborted) return rejected(operationId, "CANCELLED", "Environment invocation was cancelled before it began.");
    if (request.idempotencyKey !== undefined) {
      const previousKey = this.completedByIdempotencyKey.get(request.idempotencyKey);
      if (previousKey && previousKey.inputKey !== inputKey) {
        return rejected(operationId, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with a different environment invocation.");
      }
      if (previousKey) return completed(operationId, previousKey.output);
    }

    let output: JsonValue;
    if (request.capabilityId === CALCULATOR_ID && request.operation === "add") {
      const operands = parseAdditionInput(request.input);
      if (!operands) return rejected(operationId, "INVALID_ARGUMENTS", "calculator.add input must be an object with only finite numeric left and right fields.");
      const sum = operands.left + operands.right;
      if (!Number.isFinite(sum)) return rejected(operationId, "RESULT_OUT_OF_RANGE", "calculator.add result is outside the finite number range.");
      output = Object.freeze({ sum });
      // Pure arithmetic can be safely repeated; receipts still disambiguate IDs.
    } else if (request.capabilityId === COMPUTER_ID && request.operation === "observe") {
      if (!isEmptyObject(request.input)) return rejected(operationId, "INVALID_ARGUMENTS", "computer.observe input must be an empty object.");
      output = this.computerObservation(operationId);
    } else if (request.capabilityId === COMPUTER_ID && request.operation === "click") {
      const target = parseClickInput(request.input);
      if (!target) return rejected(operationId, "INVALID_ARGUMENTS", "computer.click input must contain only the known target field.");
      if (target !== "say-hello") return rejected(operationId, "TARGET_NOT_FOUND", "The controlled page has no element with that target ID.");
      const startedAt = new Date().toISOString();
      this.computerButtonClicked = true;
      const finishedAt = new Date().toISOString();
      output = Object.freeze({ status: "completed", startedAt, finishedAt, detail: "Clicked the Say hello button in the controlled page." });
    } else {
      return rejected(operationId, "UNSUPPORTED_OPERATION", "The environment does not implement this capability operation.");
    }

    const receipt = completed(operationId, output);
    this.completedByOperationId.set(request.operationId, { inputKey, receipt });
    if (request.idempotencyKey !== undefined) {
      this.completedByIdempotencyKey.set(request.idempotencyKey, { inputKey, output });
    }
    return receipt;
  }

  private computerObservation(operationId: string): JsonValue {
    return Object.freeze({
      observationId: `computer-observation:${encodeURIComponent(operationId)}`,
      kind: "accessibility-tree",
      capturedAt: new Date().toISOString(),
      content: {
        url: "studio://controlled-page/greeting",
        title: "Controlled greeting page",
        elements: [{
          id: "say-hello",
          role: "button",
          label: "Say hello",
          text: this.computerButtonClicked ? "Hello from the controlled page." : "Click to reveal a greeting.",
        }],
      },
    });
  }

  async close(): Promise<EnvironmentCloseReceipt> {
    if (this.closed) return Object.freeze({ outcome: "already-closed" });
    this.closed = true;
    this.completedByOperationId.clear();
    this.completedByIdempotencyKey.clear();
    return Object.freeze({ outcome: "closed" });
  }
}

/** Create the bounded, pure calculator environment using the package config contract. */
export function createControlledReferenceExecutionEnvironment(config: unknown = {}): ExecutionEnvironmentModule {
  return new CalculatorEnvironment(parseExecutionEnvironmentConfig(config));
}

/** Backwards-compatible name for the original calculator-only assembly call site. */
export function createCalculatorExecutionEnvironment(config: unknown = {}): ExecutionEnvironmentModule {
  return createControlledReferenceExecutionEnvironment(config);
}

function validateOpenRequest(value: unknown): { readonly code: string; readonly message: string } | undefined {
  if (!isRecord(value)) return { code: "INVALID_OPEN_REQUEST", message: "Environment open request must be an object." };
  if (!isRecord(value.scope) || !isIdentifier(value.scope.runId)
    || (value.scope.sessionId !== undefined && !isIdentifier(value.scope.sessionId))
    || (value.scope.turnId !== undefined && !isIdentifier(value.scope.turnId))) {
    return { code: "INVALID_OPEN_REQUEST", message: "Environment open request requires a valid run scope." };
  }
  if (!Array.isArray(value.requestedCapabilities)) {
    return { code: "INVALID_OPEN_REQUEST", message: "requestedCapabilities must be an array." };
  }
  for (const [index, requested] of value.requestedCapabilities.entries()) {
    if (!isRecord(requested) || !isIdentifier(requested.id) || !isIdentifier(requested.version)
      || !Array.isArray(requested.operations) || requested.operations.some((operation) => !isIdentifier(operation))) {
      return { code: "INVALID_OPEN_REQUEST", message: `Requested capability ${index} is invalid.` };
    }
  }
  const ids = value.requestedCapabilities.map((entry) => (entry as Record<string, unknown>).id);
  if (new Set(ids).size !== ids.length) return { code: "INVALID_OPEN_REQUEST", message: "Requested capability IDs must not be duplicated." };
  return undefined;
}

function validateInvocation(value: unknown): string | undefined {
  if (!isRecord(value)) return "Environment invocation must be an object.";
  if (!isIdentifier(value.operationId) || !isIdentifier(value.capabilityId) || !isIdentifier(value.capabilityVersion)
    || !isIdentifier(value.operation)) return "Invocation identity fields must be non-empty identifiers.";
  const capability = SUPPORTED_CAPABILITIES.find((entry) => entry.id === value.capabilityId && entry.version === value.capabilityVersion);
  if (!capability || !capability.operations.includes(value.operation)) {
    return "The capability operation is not implemented at the requested version.";
  }
  if (value.idempotencyKey !== undefined && !isIdentifier(value.idempotencyKey)) return "idempotencyKey must be a valid identifier when provided.";
  if (!isJsonValue(value.input)) return "Invocation input must be a JSON value.";
  return undefined;
}

function parseAdditionInput(value: unknown): { readonly left: number; readonly right: number } | undefined {
  if (!isRecord(value) || !isPlainRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("left") || !keys.includes("right")) return undefined;
  if (typeof value.left !== "number" || !Number.isFinite(value.left)
    || typeof value.right !== "number" || !Number.isFinite(value.right)) return undefined;
  return { left: value.left, right: value.right };
}

function parseClickInput(value: unknown): string | undefined {
  if (!isRecord(value) || !isPlainRecord(value) || Object.keys(value).length !== 1 || typeof value.target !== "string") return undefined;
  return value.target;
}

function isEmptyObject(value: unknown): boolean {
  return isRecord(value) && isPlainRecord(value) && Object.keys(value).length === 0;
}

function invocationKey(request: EnvironmentInvocation): string {
  return JSON.stringify({ capabilityId: request.capabilityId, capabilityVersion: request.capabilityVersion,
    operation: request.operation, input: request.input });
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isPlainRecord(value) && Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object" && value !== null && typeof (value as AbortSignal).aborted === "boolean";
}

function openFailure(code: string, message: string): EnvironmentOpenResult {
  const failure: EnvironmentFailure = Object.freeze({ code, message, retryable: false });
  return Object.freeze({ outcome: "failed", resourceState: "not-created", failure });
}

function rejected(operationId: string, code: string, message: string): EnvironmentInvocationReceipt {
  const failure: EnvironmentFailure = Object.freeze({ code, message, retryable: false });
  return Object.freeze({ outcome: "rejected", operationId, failure });
}

function completed(operationId: string, output: JsonValue): EnvironmentInvocationReceipt {
  return Object.freeze({ outcome: "completed", operationId, output });
}
