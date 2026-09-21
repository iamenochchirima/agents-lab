import type { McpServer, McpToolManifest } from "./local-transport.js";

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const JSON_RPC_VERSION = "2.0";

export interface HttpMcpServerOptions {
  readonly endpoint: string;
  readonly serverName?: string;
  readonly protocolVersion?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly maxResponseBytes?: number;
}

/** The MCP request may have reached a server but no response was confirmed. */
export class McpDispatchUnknownError extends Error {
  constructor(message = "The MCP tool call may have been dispatched; its outcome is unknown.") {
    super(message);
    this.name = "MCP_OUTCOME_UNKNOWN";
  }
}

/**
 * MCP Streamable HTTP client used by the local acceptance boundary.
 *
 * The capability layer still owns allowlisting and timeouts through
 * `McpTransport`; this class only translates the MCP JSON-RPC protocol into
 * the provider-neutral `McpServer` contract. It deliberately does not accept
 * an endpoint from a model or tool argument.
 */
export class HttpMcpServer implements McpServer {
  readonly serverName: string;
  readonly protocolVersion: string;
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxResponseBytes: number;
  private initialized = false;
  private requestSequence = 0;

  constructor(options: HttpMcpServerOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.serverName = options.serverName ?? "http-mcp-server";
    this.protocolVersion = options.protocolVersion ?? "2025-06-18";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 4 * 1024 * 1024) {
      throw new Error("MCP response limit is invalid.");
    }
  }

  async listTools(signal: AbortSignal): Promise<readonly McpToolManifest[]> {
    await this.initialize(signal);
    const result = await this.request("tools/list", {}, signal);
    if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("MCP tools/list returned an invalid result.");
    return result.tools.map((tool) => parseTool(tool));
  }

  async callTool(
    toolName: string,
    argumentsValue: Readonly<Record<string, unknown>>,
    requestId: string,
    signal: AbortSignal,
  ): Promise<{ readonly providerRequestId: string; readonly output: Readonly<Record<string, unknown>> }> {
    await this.initialize(signal);
    const result = await this.request("tools/call", { name: toolName, arguments: argumentsValue }, signal, requestId);
    if (!isRecord(result)) throw new Error("MCP tools/call returned an invalid result.");
    if (result.isError === true) throw new Error("MCP tool returned an error.");
    const structured = result.structuredContent;
    if (isRecord(structured)) {
      return { providerRequestId: `mcp-http:${requestId}`, output: structured };
    }
    if (!Array.isArray(result.content)) throw new Error("MCP tools/call returned no content.");
    const text = result.content
      .filter(isRecord)
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");
    if (!text) throw new Error("MCP tools/call returned no text content.");
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) return { providerRequestId: `mcp-http:${requestId}`, output: parsed };
    } catch {
      // A text result is still useful, but keep the provider-neutral output JSON-safe.
    }
    return { providerRequestId: `mcp-http:${requestId}`, output: { text } };
  }

  private async initialize(signal: AbortSignal): Promise<void> {
    if (this.initialized) return;
    // 2026-07-28 removed the initialize/session handshake. The protocol
    // version is sent as request metadata instead. Keep the legacy handshake
    // for the local 2025-06-18 fixture and older servers.
    if (!requiresLegacyHandshake(this.protocolVersion)) {
      this.initialized = true;
      return;
    }
    await this.request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "agent-harness-lab", version: "1.0.0" },
    }, signal);
    this.initialized = true;
    await this.notification("notifications/initialized", signal);
  }

  private async notification(method: string, signal: AbortSignal): Promise<void> {
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: this.headers(method),
      body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, method }),
      signal,
    });
    if (!response.ok && response.status !== 202) throw new Error(`MCP notification failed with HTTP ${response.status}.`);
    // A notification has no response body. Do consume it so the connection can
    // be reused by Node's fetch implementation.
    await response.arrayBuffer();
  }

  private async request(method: string, params: Readonly<Record<string, unknown>>, signal: AbortSignal, requestId?: string): Promise<unknown> {
    const id = requestId ?? `agentlab-${++this.requestSequence}`;
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: this.headers(method, params),
        body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, method, params }),
        signal,
      });
    } catch (error) {
      if (method === "tools/call" && !signal.aborted) {
        throw new McpDispatchUnknownError();
      }
      throw error;
    }
    const text = await boundedResponseText(response, this.maxResponseBytes);
    if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}.`);
    const envelope = parseResponse(text, response.headers.get("content-type"));
    if (!isRecord(envelope) || envelope.jsonrpc !== JSON_RPC_VERSION) throw new Error("MCP returned an invalid JSON-RPC envelope.");
    if (isRecord(envelope.error)) {
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "MCP request failed.";
      throw new Error(bounded(message));
    }
    return envelope.result;
  }

  private headers(method: string, params?: Readonly<Record<string, unknown>>): Record<string, string> {
    const name = params && typeof params.name === "string" ? params.name : undefined;
    return {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "MCP-Protocol-Version": this.protocolVersion,
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    };
  }
}

function parseTool(value: unknown): McpToolManifest {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.description !== "string" || !isRecord(value.inputSchema)) {
    throw new Error("MCP tools/list returned an invalid tool manifest.");
  }
  const version = isRecord(value._meta) && typeof value._meta.agentlabVersion === "string"
    ? value._meta.agentlabVersion
    : "1.0.0";
  return { name: value.name, version, description: value.description, inputSchema: value.inputSchema };
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("MCP response exceeds the configured limit.");
  return text;
}

function parseResponse(text: string, contentType: string | null): unknown {
  if (contentType?.toLowerCase().includes("text/event-stream")) {
    const data = text
      .split(/\r?\n\r?\n/)
      .map((event) => event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim())
      .find(Boolean);
    if (!data) throw new Error("MCP returned an empty event stream.");
    return parseJson(data);
  }
  return parseJson(text);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("MCP returned malformed JSON.");
  }
}

function normalizeEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP endpoint must use HTTP(S).");
  return parsed.toString().replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: string): string {
  return value.length <= 512 ? value : value.slice(0, 512);
}

function requiresLegacyHandshake(protocolVersion: string): boolean {
  return protocolVersion === "2025-06-18";
}
