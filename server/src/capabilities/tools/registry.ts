import type {
  ToolCall,
  ToolExecutionContext,
  ToolExecutionError,
  ToolExecutionResult,
  ToolImplementation,
  ToolPolicyDecision,
  ToolValidationResult,
} from "./contracts.js";
import { TOOL_SCHEMA_VERSION } from "./contracts.js";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ERROR_MESSAGE_BYTES = 512;

export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRegistrationError";
  }
}

export class ToolRegistry {
  private readonly implementations = new Map<string, ToolImplementation>();
  private readonly enabledNames: ReadonlySet<string>;

  constructor(options: { readonly enabledNames: readonly string[] }) {
    this.enabledNames = new Set(options.enabledNames);
    if (this.enabledNames.size !== options.enabledNames.length) {
      throw new ToolRegistrationError("The enabled tool list contains duplicate names.");
    }
    for (const name of this.enabledNames) {
      if (!TOOL_NAME_PATTERN.test(name)) {
        throw new ToolRegistrationError(`Invalid enabled tool name: ${name}`);
      }
    }
  }

  register(implementation: ToolImplementation): void {
    const { definition } = implementation;
    if (!TOOL_NAME_PATTERN.test(definition.name)) {
      throw new ToolRegistrationError(`Invalid tool name: ${definition.name}`);
    }
    if (definition.schemaVersion !== TOOL_SCHEMA_VERSION) {
      throw new ToolRegistrationError(`Unsupported tool schema version for ${definition.name}.`);
    }
    if (definition.description.trim().length === 0) {
      throw new ToolRegistrationError(`Tool ${definition.name} must declare a description.`);
    }
    if (!isRecord(definition.inputSchema)) {
      throw new ToolRegistrationError(`Tool ${definition.name} must declare an object input schema.`);
    }
    if (definition.inputSchema.type !== "object") {
      throw new ToolRegistrationError(`Tool ${definition.name} input schema must have type object.`);
    }
    if (this.implementations.has(definition.name)) {
      throw new ToolRegistrationError(`Tool is already registered: ${definition.name}`);
    }
    validateLimits(definition.limits, definition.name);
    this.implementations.set(definition.name, implementation);
  }

  definitions(): readonly ToolImplementation["definition"][] {
    return [...this.implementations.values()]
      .filter((implementation) => this.enabledNames.has(implementation.definition.name))
      .map((implementation) => implementation.definition);
  }

  resolve(name: string): ToolImplementation | undefined {
    if (!this.enabledNames.has(name)) return undefined;
    return this.implementations.get(name);
  }

  validateCall(call: ToolCall): ToolValidationResult {
    if (!TOOL_CALL_ID_PATTERN.test(call.toolCallId)) {
      return rejected("INVALID_CALL_ID", "Tool call ID is missing or unsafe.", call);
    }
    if (!TOOL_NAME_PATTERN.test(call.name)) {
      return rejected("INVALID_TOOL_NAME", "Tool name is missing or unsafe.", call);
    }
    if (!Number.isInteger(call.round) || call.round < 1) {
      return rejected("INVALID_ROUND", "Tool call round must be a positive integer.", call);
    }

    const implementation = this.resolve(call.name);
    if (!implementation) {
      return rejected("UNKNOWN_TOOL", `Tool is not enabled: ${call.name}`, call);
    }

    const argumentBytes = byteLength(call.arguments);
    if (argumentBytes === null || argumentBytes > implementation.definition.limits.maxArgumentBytes) {
      return rejected("ARGUMENTS_TOO_LARGE", `Arguments exceed the ${call.name} input limit.`, call);
    }

    try {
      const normalizedArguments = implementation.validateArguments(call.arguments);
      return {
        accepted: true,
        call: { ...call, arguments: normalizedArguments },
        definition: implementation.definition,
      };
    } catch (error) {
      return rejected("INVALID_ARGUMENTS", safeErrorMessage(error, `Invalid arguments for ${call.name}.`), call);
    }
  }

  authorize(call: ToolCall): ToolPolicyDecision {
    const implementation = this.resolve(call.name);
    if (!implementation) {
      return { allowed: false, code: "UNKNOWN_TOOL", message: `Tool is not enabled: ${call.name}` };
    }
    if (implementation.definition.riskClass !== "pure") {
      return {
        allowed: false,
        code: "TOOL_RISK_NOT_ALLOWED",
        message: `Tool risk class is not allowed in this slice: ${call.name}`,
      };
    }
    return { allowed: true, code: "TOOL_ALLOWED", message: "Tool is enabled for this run." };
  }

  async execute(
    validated: Extract<ToolValidationResult, { readonly accepted: true }>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const implementation = this.resolve(validated.call.name);
    if (!implementation) {
      return failure("TOOL_EXECUTION_FAILED", "Tool was removed before execution.", 0);
    }

    const startedAt = Date.now();
    const timeoutController = new AbortController();
    const signal = combineSignals(context.signal, timeoutController.signal);
    const timer = setTimeout(() => timeoutController.abort(), implementation.definition.limits.timeoutMs);

    try {
      if (context.signal.aborted) {
        return failure("TOOL_CANCELLED", "Tool execution was cancelled before it started.", 0, "cancelled");
      }
      // AcceptedToolCall carries the raw provider value for auditability. The
      // registry revalidates at the execution boundary so callers cannot
      // forge an accepted value by constructing the union themselves.
      const normalizedArguments = implementation.validateArguments(validated.call.arguments);
      const content = await implementation.execute(normalizedArguments, { ...context, signal });
      const resultBytes = utf8ByteLength(content);
      if (resultBytes > implementation.definition.limits.maxResultBytes) {
        return failure(
          "TOOL_RESULT_TOO_LARGE",
          `Tool result exceeds the ${validated.call.name} output limit.`,
          elapsed(startedAt),
          "failed",
          implementation.definition.limits.maxResultBytes,
        );
      }
      return {
        status: "completed",
        content,
        error: null,
        durationMs: elapsed(startedAt),
        attemptCount: 1,
      };
    } catch (error) {
      const durationMs = elapsed(startedAt);
      if (context.signal.aborted || timeoutController.signal.aborted) {
        return failure(
          timeoutController.signal.aborted && !context.signal.aborted ? "TOOL_TIMEOUT" : "TOOL_CANCELLED",
          timeoutController.signal.aborted && !context.signal.aborted ? "Tool execution exceeded its deadline." : "Tool execution was cancelled.",
          durationMs,
          timeoutController.signal.aborted && !context.signal.aborted ? "timed_out" : "cancelled",
          implementation.definition.limits.maxResultBytes,
        );
      }
      return failure(
        "TOOL_EXECUTION_FAILED",
        safeErrorMessage(error, `Tool execution failed: ${validated.call.name}.`),
        durationMs,
        "failed",
        implementation.definition.limits.maxResultBytes,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function rejected(code: Extract<ToolValidationResult, { readonly accepted: false }>["code"], message: string, call: ToolCall): ToolValidationResult {
  return { accepted: false, code, message, toolCallId: call.toolCallId || null, name: call.name || null };
}

function validateLimits(limits: ToolImplementation["definition"]["limits"], name: string): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new ToolRegistrationError(`Tool ${name} has an invalid ${key} limit.`);
  }
}

function byteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : utf8ByteLength(serialized);
  } catch {
    return null;
  }
}

function combineSignals(left: AbortSignal, right: AbortSignal): AbortSignal {
  return AbortSignal.any([left, right]);
}

function failure(
  code: ToolExecutionError["code"],
  message: string,
  durationMs: number,
  status: ToolExecutionResult["status"] = "failed",
  maxResultBytes = 512,
): ToolExecutionResult {
  const safeMessage = boundedText(message, MAX_ERROR_MESSAGE_BYTES);
  return {
    status,
    content: boundedErrorContent(code, safeMessage, maxResultBytes),
    error: { code, message: safeMessage },
    durationMs,
    attemptCount: 1,
  };
}

function boundedErrorContent(code: string, message: string, maxBytes: number): string {
  let safeMessage = message;
  let content = JSON.stringify({ error: safeMessage, code });
  while (utf8ByteLength(content) > maxBytes && safeMessage.length > 0) {
    safeMessage = safeMessage.slice(0, -1);
    content = JSON.stringify({ error: safeMessage, code });
  }
  return content;
}

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function safeErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  return boundedText(message, MAX_ERROR_MESSAGE_BYTES);
}

function boundedText(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let result = value.slice(0, maxBytes);
  while (utf8ByteLength(result) > maxBytes) result = result.slice(0, -1);
  return result;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
