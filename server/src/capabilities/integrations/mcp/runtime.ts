import type { ConnectionBinding, ConnectionRequest, ConnectionResult, McpConnectionEvidence } from "../contracts.js";
import type { ConnectionRuntime } from "../runtime.js";
import { HttpMcpServer } from "./http-server.js";
import { McpTransport } from "./local-transport.js";

export const LOCAL_MCP_CONNECTION_REF = "conn_local_mcp_fixture";
export const LOCAL_MCP_ENDPOINT_REF = "local-fixture-mcp";

export interface HttpMcpConnectionRuntimeOptions {
  readonly endpoint: string;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Executes one server-owned MCP selection through Streamable HTTP.
 *
 * The endpoint is supplied by process configuration, never by a model call or
 * browser request. The request's `mcp` descriptor is an immutable selection
 * check, not an endpoint authority grant.
 */
export class HttpMcpConnectionRuntime {
  private readonly endpoint: string;
  private readonly fetchImplementation?: typeof fetch;

  constructor(options: HttpMcpConnectionRuntimeOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.fetchImplementation = options.fetchImplementation;
  }

  async request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult> {
    void options.readOnly;
    if (connectionRef !== LOCAL_MCP_CONNECTION_REF) {
      return unavailable(request.requestId, "CONNECTION_NOT_CONFIGURED", "The requested MCP connection is not configured.");
    }
    const binding = request.mcp;
    if (!binding || binding.endpointRef !== LOCAL_MCP_ENDPOINT_REF) {
      return unavailable(request.requestId, "MCP_SELECTION_NOT_CONFIGURED", "The selected MCP tool binding is not configured.");
    }

    const server = new HttpMcpServer({
      endpoint: this.endpoint,
      serverName: binding.serverName,
      protocolVersion: binding.protocolVersion,
      ...(this.fetchImplementation ? { fetchImplementation: this.fetchImplementation } : {}),
    });
    const transport = new McpTransport({
      server,
      endpoint: this.endpoint,
      allowedEndpoints: [this.endpoint],
      limits: request.limits,
      selectedTool: {
        endpointRef: binding.endpointRef,
        serverName: binding.serverName,
        protocolVersion: binding.protocolVersion,
        toolName: binding.toolName,
        toolVersion: binding.toolVersion,
      },
    });

    try {
      const tools = await transport.discover(options.signal);
      const selected = tools.find((tool) => tool.name === binding.toolName && tool.version === binding.toolVersion);
      if (!selected) {
        return unavailable(request.requestId, "MCP_TOOL_NOT_SELECTED", "The selected MCP tool was not returned by discovery.", mcpEvidence(binding, "discovery"));
      }
      return transport.invoke(selected, request.requestId, request.input, options.signal);
    } catch (error) {
      if (options.signal.aborted) {
        return unavailable(request.requestId, "MCP_CANCELLED", "MCP connection was cancelled.", mcpEvidence(binding, "discovery"), "cancelled");
      }
      return unavailable(request.requestId, "MCP_DISCOVERY_FAILED", safeMessage(error), mcpEvidence(binding, "discovery"));
    }
  }
}

class ConfiguredMcpConnectionRuntime implements ConnectionRuntime {
  request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult> {
    try {
      return new HttpMcpConnectionRuntime({ endpoint: configuredEndpoint() }).request(connectionRef, request, options);
    } catch (error) {
      return Promise.resolve(unavailable(request.requestId, "MCP_CONNECTION_NOT_CONFIGURED", safeMessage(error)));
    }
  }
}

let defaultRuntime: ConnectionRuntime | undefined;

/** Returns the server-process MCP runtime for the configured local fixture. */
export function getDefaultMcpConnectionRuntime(): ConnectionRuntime {
  defaultRuntime ??= new ConfiguredMcpConnectionRuntime();
  return defaultRuntime;
}

export function mcpBindingFor(
  bindings: readonly ConnectionBinding[] | undefined,
  toolName: string,
): { readonly connectionRef: string; readonly mcp: NonNullable<ConnectionBinding["mcp"]> } | undefined {
  const binding = bindings?.find((candidate) => candidate.toolName === toolName);
  if (!binding?.mcp) return undefined;
  return { connectionRef: binding.connectionRef, mcp: binding.mcp };
}

function configuredEndpoint(): string {
  const base = process.env.AGENTLAB_LOCAL_FIXTURE_URL?.trim();
  if (!base) throw new Error("AGENTLAB_LOCAL_FIXTURE_URL is required for the local MCP connection.");
  return `${base.replace(/\/$/, "")}/mcp`;
}

function normalizeEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP endpoint must use HTTP(S).");
  return parsed.toString().replace(/\/$/, "");
}

function unavailable(
  requestId: string,
  code: string,
  message: string,
  mcp?: McpConnectionEvidence,
  status: ConnectionResult["status"] = "failed",
): ConnectionResult {
  const now = new Date().toISOString();
  return {
    requestId,
    status: "failed",
    output: null,
    attempts: [{
      requestId,
      attempt: 1,
      startedAt: now,
      finishedAt: now,
      status,
      retryable: false,
      providerRequestId: null,
      errorCode: code,
      errorMessage: bounded(message),
    }],
    error: { code, message: bounded(message) },
    ...(mcp ? { mcp } : {}),
  };
}

function mcpEvidence(binding: NonNullable<ConnectionRequest["mcp"]>, phase: McpConnectionEvidence["phase"]): McpConnectionEvidence {
  return {
    endpointRef: binding.endpointRef,
    serverName: binding.serverName,
    protocolVersion: binding.protocolVersion,
    toolName: binding.toolName,
    toolVersion: binding.toolVersion,
    phase,
  };
}

function safeMessage(error: unknown): string {
  return bounded(error instanceof Error && error.message.trim() ? error.message : "MCP connection failed.");
}

function bounded(value: string): string {
  return value.length <= 512 ? value : value.slice(0, 512);
}
