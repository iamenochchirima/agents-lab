import { getDefaultConnectionRuntime, type ConnectionRuntime } from "../integrations/runtime.js";
import type { ToolImplementation } from "./contracts.js";

const FIXTURE_CONNECTION_REF = "conn_local_fixture";

export interface FixtureTools {
  readonly fixtureLookupTool: ToolImplementation;
  readonly fixtureWriteTool: ToolImplementation;
}

/** Creates connection-backed fixture tools for one native execution boundary. */
export function createFixtureTools(connectionRuntime: ConnectionRuntime = getDefaultConnectionRuntime()): FixtureTools {
  return {
    fixtureLookupTool: createFixtureLookupTool(connectionRuntime),
    fixtureWriteTool: createFixtureWriteTool(connectionRuntime),
  };
}

const defaultTools = createFixtureTools();
export const fixtureLookupTool = defaultTools.fixtureLookupTool;
export const fixtureWriteTool = defaultTools.fixtureWriteTool;

function createFixtureLookupTool(connectionRuntime: ConnectionRuntime): ToolImplementation {
  return {
    definition: {
      schemaVersion: 1,
      name: "fixture_lookup",
      description: "Read one value from the bounded local provider connection.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["key"],
        properties: { key: { type: "string", minLength: 1, maxLength: 64 } },
      },
      riskClass: "read",
      failurePolicy: "feedback",
      executionKind: "connection",
      limits: { maxArgumentBytes: 512, maxResultBytes: 4_096, timeoutMs: 2_000 },
    },
    validateArguments(value) {
      if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.key !== "string" || value.key.length < 1 || value.key.length > 64) {
        throw new Error("Fixture lookup arguments must contain only a key of 1 to 64 characters.");
      }
      return { key: value.key };
    },
    async execute(argumentsValue, context) {
      assertBinding(context.connectionBindings, "fixture_lookup", "lookup");
      const result = await connectionRuntime.request(FIXTURE_CONNECTION_REF, {
        requestId: connectionRequestId(context),
        operation: "fixture.lookup",
        input: { key: String(argumentsValue.key) },
        idempotencyKey: null,
        limits: { timeoutMs: 2_000, maxRequestBytes: 1_024, maxResponseBytes: 4_096, maxAttempts: 3 },
      }, { readOnly: true, signal: context.signal });
      context.onConnectionResult?.(result);
      if (result.status !== "completed" || result.output === null) throw connectionError(result);
      return JSON.stringify(result.output);
    },
  };
}

function createFixtureWriteTool(connectionRuntime: ConnectionRuntime): ToolImplementation {
  return {
    definition: {
      schemaVersion: 1,
      name: "fixture_write",
      description: "Write one value to the bounded local provider connection after approval.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: { key: { type: "string" }, value: { type: "string" } },
      },
      riskClass: "write",
      executionKind: "connection",
      limits: { maxArgumentBytes: 1_024, maxResultBytes: 2_048, timeoutMs: 2_000 },
    },
    validateArguments(value) {
      if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.key !== "string" || typeof value.value !== "string" || value.key.length < 1 || value.key.length > 64 || value.value.length > 512) {
        throw new Error("Fixture write arguments must contain only bounded key and value strings.");
      }
      return { key: value.key, value: value.value };
    },
    async execute(argumentsValue, context) {
      assertBinding(context.connectionBindings, "fixture_write", "write");
      const result = await connectionRuntime.request(FIXTURE_CONNECTION_REF, {
        requestId: connectionRequestId(context),
        operation: "fixture.write",
        input: { key: String(argumentsValue.key), value: String(argumentsValue.value) },
        idempotencyKey: idempotencyKey(context),
        limits: { timeoutMs: 2_000, maxRequestBytes: 1_024, maxResponseBytes: 2_048, maxAttempts: 1 },
      }, { readOnly: false, signal: context.signal });
      context.onConnectionResult?.(result);
      if (result.status !== "completed" || result.output === null) throw connectionError(result);
      return JSON.stringify(result.output);
    },
  };
}

function connectionRequestId(context: { readonly runId: string; readonly turnId: string; readonly toolCallId?: string }): string {
  return [context.runId, context.turnId, context.toolCallId ?? "tool"].map(safeIdPart).join(":");
}

function idempotencyKey(context: { readonly runId: string; readonly turnId: string; readonly toolCallId?: string }): string {
  return connectionRequestId(context);
}

function safeIdPart(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.slice(0, 64) || "unknown";
}

function connectionError(result: { readonly error: { readonly code: string; readonly message: string } | null }): Error {
  const code = result.error?.code ?? "CONNECTION_FAILED";
  const message = result.error?.message ?? "The connection did not return a completed result.";
  const error = new Error(message);
  error.name = code;
  return error;
}

function assertBinding(bindings: readonly { readonly toolName: string; readonly connectionRef: string; readonly operations: readonly string[] }[] | undefined, toolName: string, operation: string): void {
  if (bindings === undefined) return;
  const binding = bindings.find((candidate) => candidate.toolName === toolName);
  if (!binding || binding.connectionRef !== FIXTURE_CONNECTION_REF || !binding.operations.includes(operation)) {
    const error = new Error(`The connection binding is not available for ${toolName}.`);
    error.name = "CONNECTION_NOT_CONFIGURED";
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
