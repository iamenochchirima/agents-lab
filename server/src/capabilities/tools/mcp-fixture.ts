import { getDefaultMcpConnectionRuntime, LOCAL_MCP_CONNECTION_REF, mcpBindingFor } from "../integrations/mcp/runtime.js";
import type { ConnectionRuntime } from "../integrations/runtime.js";
import type { ToolImplementation } from "./contracts.js";

/** Creates the explicit MCP-backed read control used by native platform runs. */
export function createMcpFixtureTools(runtime: ConnectionRuntime = getDefaultMcpConnectionRuntime()): {
  readonly mcpFixtureLookupTool: ToolImplementation;
} {
  return { mcpFixtureLookupTool: createMcpFixtureLookupTool(runtime) };
}

const defaultTools = createMcpFixtureTools();
export const mcpFixtureLookupTool = defaultTools.mcpFixtureLookupTool;

function createMcpFixtureLookupTool(runtime: ConnectionRuntime): ToolImplementation {
  return {
    definition: {
      schemaVersion: 1,
      name: "mcp_fixture_lookup",
      description: "Read one value through the selected local MCP server.",
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
        throw new Error("MCP fixture lookup arguments must contain only a key of 1 to 64 characters.");
      }
      return { key: value.key };
    },
    async execute(argumentsValue, context) {
      const selected = mcpBindingFor(context.connectionBindings, "mcp_fixture_lookup");
      if (!selected || selected.connectionRef !== LOCAL_MCP_CONNECTION_REF) {
        const error = new Error("The server-owned MCP binding is not available for mcp_fixture_lookup.");
        error.name = "CONNECTION_NOT_CONFIGURED";
        throw error;
      }
      const result = await runtime.request(LOCAL_MCP_CONNECTION_REF, {
        requestId: connectionRequestId(context),
        operation: "lookup",
        input: { key: String(argumentsValue.key) },
        idempotencyKey: null,
        limits: { timeoutMs: 2_000, maxRequestBytes: 1_024, maxResponseBytes: 4_096, maxAttempts: 1 },
        mcp: selected.mcp,
      }, { readOnly: true, signal: context.signal });
      context.onConnectionResult?.(result);
      if (result.status !== "completed" || result.output === null) throw connectionError(result);
      return JSON.stringify(result.output);
    },
  };
}

function connectionRequestId(context: { readonly runId: string; readonly turnId: string; readonly toolCallId?: string }): string {
  return [context.runId, context.turnId, context.toolCallId ?? "tool"].map((value) => value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 64) || "unknown").join(":");
}

function connectionError(result: { readonly error: { readonly code: string; readonly message: string } | null }): Error {
  const error = new Error(result.error?.message ?? "The MCP connection did not return a completed result.");
  error.name = result.error?.code ?? "MCP_CONNECTION_FAILED";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
