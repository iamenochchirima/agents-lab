import type { McpProgressDiagnostics } from "../contracts.js";
import type { McpServer, McpToolManifest } from "./local-transport.js";

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const JSON_RPC_VERSION = "2.0";

export interface HttpMcpServerOptions {
  readonly endpoint: string;
  readonly serverName?: string;
  readonly protocolVersion?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly maxResponseBytes?: number;
  /** Trusted process configuration; never included in model tool descriptors. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Recheck live authority immediately before each HTTP request, not only client construction. */
  readonly resolveHeaders?: (signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
  readonly onDispatch?: (method: string) => void;
}

/** The MCP request may have reached a server but no response was confirmed. */
export class McpDispatchUnknownError extends Error {
  constructor(message = "The MCP tool call may have been dispatched; its outcome is unknown.") {
    super(message);
    this.name = "MCP_OUTCOME_UNKNOWN";
  }
}

/** The caller knows the MCP request was not dispatched and may retry safely. */
export class McpPreDispatchError extends Error {
  constructor(message = "The MCP request failed before dispatch.") {
    super(message);
    this.name = "MCP_PRE_DISPATCH";
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
  private negotiatedProtocolVersion: string;
  get protocolVersion(): string { return this.negotiatedProtocolVersion; }
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly configuredHeaders: Readonly<Record<string, string>>;
  private readonly resolveHeaders?: HttpMcpServerOptions["resolveHeaders"];
  private readonly onDispatch?: HttpMcpServerOptions["onDispatch"];
  private initialized = false;
  private requestSequence = 0;
  private sessionId: string | null = null;
  private progress: { notifications: { progress?: number; total?: number; message?: string }[]; omitted: number } = { notifications: [], omitted: 0 };
  /** Diagnostics of the most recent tool call; copied before the per-invocation client is closed. */
  get progressDiagnostics(): McpProgressDiagnostics { return { notifications: [...this.progress.notifications], omitted: this.progress.omitted }; }
  private retainProgress(envelope: unknown): void {
    if (!isRecord(envelope) || envelope.method !== "notifications/progress") return;
    if (this.progress.notifications.length >= 32) { this.progress.omitted++; return; }
    const params = isRecord(envelope.params) ? envelope.params : {};
    this.progress.notifications.push({
      ...(typeof params.progress === "number" && Number.isFinite(params.progress) ? { progress: params.progress } : {}),
      ...(typeof params.total === "number" && Number.isFinite(params.total) ? { total: params.total } : {}),
      ...(typeof params.message === "string" ? { message: params.message.slice(0, 512) } : {}),
    });
  }

  constructor(options: HttpMcpServerOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.serverName = options.serverName ?? "http-mcp-server";
    this.negotiatedProtocolVersion = options.protocolVersion ?? "2025-06-18";
    if (!["2025-06-18", "2025-11-25", "2026-07-28"].includes(this.protocolVersion)) throw new Error("Unsupported MCP protocol version.");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.configuredHeaders = options.headers ?? {}; this.resolveHeaders = options.resolveHeaders; this.onDispatch = options.onDispatch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 4 * 1024 * 1024) {
      throw new Error("MCP response limit is invalid.");
    }
  }

  async listTools(signal: AbortSignal): Promise<readonly McpToolManifest[]> {
    await this.initialize(signal);
    const tools: McpToolManifest[] = [], seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, signal);
      if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("MCP tools/list returned an invalid result.");
      tools.push(...result.tools.map(parseTool).filter(tool => {
        if (requiresLegacyHandshake(this.protocolVersion)) return true;
        try { toolParameterHeaders(tool.inputSchema, undefined); return true; }
        catch { return false; } // Invalid header annotations exclude only that declaration.
      }));
      // Match managed package selection capacity; hosted providers can exceed 64.
      if (tools.length > 128) throw new Error("MCP discovery returned too many tools.");
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor) {
        if (seenCursors.has(cursor) || seenCursors.size >= 64) throw new Error("MCP discovery returned a repeated or excessive cursor.");
        seenCursors.add(cursor);
      }
    } while (cursor);
    return tools;
  }

  /** Preserve the complete protocol result for generic hosted tool adapters. */
  async callToolResult(toolName: string, argumentsValue: Readonly<Record<string, unknown>>, requestId: string, signal: AbortSignal, inputSchema?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    await this.initialize(signal);
    const result = await this.request("tools/call", { name: toolName, arguments: argumentsValue }, signal, requestId, inputSchema);
    if (!isRecord(result) || !Array.isArray(result.content) && result.structuredContent === undefined) throw new McpDispatchUnknownError("MCP tools/call returned no valid result acknowledgement.");
    return result;
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

  /** Release a legacy server session. Sessionless sources have nothing to release.
   * Shutdown is best effort: a server may reject DELETE or already have expired it.
   */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      const signal = AbortSignal.timeout(2_000);
      const credentials = await this.credentials(signal);
      const response = await this.fetchImplementation(this.endpoint, {
        method: "DELETE",
        headers: { ...credentials, "MCP-Protocol-Version": this.protocolVersion, "Mcp-Session-Id": sessionId },
        signal,
      });
      await response.body?.cancel();
    } catch { /* Cleanup cannot establish remote session expiry after a lost reply. */ }
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
    const initialized = await this.request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: "agent-harness-lab", version: "1.0.0" },
    }, signal);
    if (!isRecord(initialized) || typeof initialized.protocolVersion !== "string" || !["2025-06-18", "2025-11-25", "2026-07-28"].includes(initialized.protocolVersion)) throw new Error("MCP server negotiated an unsupported protocol version.");
    this.negotiatedProtocolVersion = initialized.protocolVersion;
    if (requiresLegacyHandshake(this.protocolVersion)) await this.notification("notifications/initialized", signal);
    this.initialized = true;
  }

  private async notification(method: string, signal: AbortSignal): Promise<void> {
    const credentials = await this.credentials(signal);
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: this.headers(method, undefined, credentials),
      body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, method }),
      signal,
    });
    if (!response.ok && response.status !== 202) throw new Error(`MCP notification failed with HTTP ${response.status}.`);
    // A notification has no response body. Do consume it so the connection can
    // be reused by Node's fetch implementation.
    await response.arrayBuffer();
  }

  private async request(method: string, params: Readonly<Record<string, unknown>>, signal: AbortSignal, requestId?: string, inputSchema?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (method === "tools/call") this.progress = { notifications: [], omitted: 0 };
    const id = requestId ?? `agentlab-${++this.requestSequence}`;
    // Authority failures occur before the dispatch try block and must not become ambiguous writes.
    const credentials = await this.credentials(signal);
    const headers = { ...this.headers(method, params, credentials), ...(!requiresLegacyHandshake(this.protocolVersion) && inputSchema ? toolParameterHeaders(inputSchema, params.arguments) : {}) };
    let response: Response;
    try {
      this.onDispatch?.(method);
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, method, params: {
          ...params,
          ...(!requiresLegacyHandshake(this.protocolVersion) ? { _meta: {
            "io.modelcontextprotocol/protocolVersion": this.protocolVersion,
            "io.modelcontextprotocol/clientInfo": { name: "agent-harness-lab", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          } } : {}),
        } }),
        signal,
      });
    } catch (error) {
      if (error instanceof McpPreDispatchError) throw error;
      if (method === "tools/call" && !signal.aborted) {
        throw new McpDispatchUnknownError();
      }
      throw error;
    }
    if (method === "initialize") {
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId && sessionId.length <= 1024) this.sessionId = sessionId;
    }
    let envelope: unknown;
    try {
      if (!response.ok) {
        await response.body?.cancel();
        if (method === "tools/call" && response.status >= 500) throw new McpDispatchUnknownError();
        throw new Error(`MCP request failed with HTTP ${response.status}.`);
      }
      envelope = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")
        ? await correlatedSseResponse(response, this.maxResponseBytes, id, envelope => { if (method === "tools/call") this.retainProgress(envelope); })
        : parseResponse(await boundedResponseText(response, this.maxResponseBytes), response.headers.get("content-type"), id);
      if (!isRecord(envelope) || envelope.jsonrpc !== JSON_RPC_VERSION || envelope.id !== id) throw new Error("MCP returned an invalid JSON-RPC envelope.");
    } catch (error) {
      // A rejected request is distinct from losing or corrupting a success reply
      // after dispatch. Only the latter leaves effects unconfirmed.
      if (method === "tools/call" && (response.ok || response.status >= 500)) throw new McpDispatchUnknownError();
      throw error;
    }
    if (!isRecord(envelope)) throw new Error("MCP returned an invalid JSON-RPC envelope.");
    if (isRecord(envelope.error)) {
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "MCP request failed.";
      throw new Error(bounded(message));
    }
    if (isRecord(envelope.result) && envelope.result.resultType !== undefined && envelope.result.resultType !== "complete") {
      throw new Error("MCP result requires an unsupported client interaction or extension.");
    }
    return envelope.result;
  }

  private async credentials(signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
    if (signal.aborted) throw signal.reason ?? new Error("MCP request cancelled before dispatch.");
    const headers = { ...this.configuredHeaders, ...(this.resolveHeaders ? await this.resolveHeaders(signal) : {}) };
    if (signal.aborted) throw signal.reason ?? new Error("MCP request cancelled before dispatch.");
    return headers;
  }

  private headers(method: string, params?: Readonly<Record<string, unknown>>, credentials = this.configuredHeaders): Record<string, string> {
    const name = params && typeof params.name === "string" ? params.name : undefined;
    return {
      ...credentials,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "MCP-Protocol-Version": this.protocolVersion,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": encodeHeaderValue(name) } : {}),
    };
  }
}

function parseTool(value: unknown): McpToolManifest {
  if (!isRecord(value) || typeof value.name !== "string" || (value.description !== undefined && typeof value.description !== "string") || !isRecord(value.inputSchema)) {
    throw new Error("MCP tools/list returned an invalid tool manifest.");
  }
  const version = isRecord(value._meta) && typeof value._meta.agentlabVersion === "string"
    ? value._meta.agentlabVersion
    : "1.0.0";
  return { name: value.name, version, description: typeof value.description === "string" ? value.description : `Call ${value.name}.`, inputSchema: value.inputSchema, ...(isRecord(value.outputSchema) ? { outputSchema: value.outputSchema } : {}) };
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("MCP response exceeds the configured limit.");
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

function parseResponse(text: string, contentType: string | null, requestId: string): unknown {
  if (contentType?.toLowerCase().includes("text/event-stream")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n").trim();
      if (!data) continue;
      const envelope = parseJson(data);
      // Legacy streams may interleave log/progress notifications before the
      // correlated final response. They are not the tool's acknowledgement.
      if (isRecord(envelope) && envelope.id === requestId) return envelope;
    }
    throw new Error("MCP event stream has no correlated response.");
  }
  return parseJson(text);
}

/** A correlated final envelope completes a request even when the server keeps
 * its response stream open. Byte limits include progress and ignored events.
 */
async function correlatedSseResponse(response: Response, maxBytes: number, requestId: string, onEnvelope: (envelope: unknown) => void): Promise<unknown> {
  if (!response.body) throw new Error("MCP event stream has no response body.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", bytes = 0;
  const consume = (): unknown | undefined => {
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data.trim()) continue;
      const envelope = parseJson(data);
      onEnvelope(envelope);
      if (isRecord(envelope) && envelope.id === requestId && ("result" in envelope || "error" in envelope)) return envelope;
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); const envelope = consume(); if (envelope !== undefined) return envelope; throw new Error("MCP event stream has no correlated final response."); }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error("MCP response exceeds the configured response limit.");
      buffer += decoder.decode(chunk.value, { stream: true });
      const envelope = consume(); if (envelope !== undefined) return envelope;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) && value === value.trim() && !(value.startsWith("=?base64?") && value.endsWith("?="))
    ? value : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
function toolParameterHeaders(schema: Readonly<Record<string, unknown>>, argumentsValue: unknown): Record<string, string> {
  const result: Record<string, string> = {}, names = new Set<string>();
  const walk = (node: unknown, value: unknown, reachable: boolean) => {
    if (!isRecord(node)) return;
    if (node["x-mcp-header"] !== undefined) {
      const name = node["x-mcp-header"];
      if (!reachable || typeof name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || names.has(name.toLowerCase()) || !["string", "integer", "boolean"].includes(String(node.type))) throw new Error("MCP tool has an invalid x-mcp-header annotation.");
      names.add(name.toLowerCase());
      if (value !== undefined && value !== null) {
        if (node.type === "integer" && !Number.isSafeInteger(value)) throw new Error("MCP header integer is not safely representable.");
        result[`Mcp-Param-${name}`] = encodeHeaderValue(String(value));
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "properties" && isRecord(child)) for (const [property, propertySchema] of Object.entries(child)) walk(propertySchema, isRecord(value) ? value[property] : undefined, reachable);
      else if (key !== "properties" && child && typeof child === "object") {
        if (Array.isArray(child)) child.forEach(item => walk(item, undefined, false));
        else walk(child, undefined, false);
      }
    }
  };
  walk(schema, argumentsValue, true);
  return result;
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
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("MCP endpoint must use HTTP(S) without URL credentials.");
  return parsed.toString().replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bounded(value: string): string {
  return value.length <= 512 ? value : value.slice(0, 512);
}

function requiresLegacyHandshake(protocolVersion: string): boolean {
  return protocolVersion === "2025-06-18" || protocolVersion === "2025-11-25";
}
