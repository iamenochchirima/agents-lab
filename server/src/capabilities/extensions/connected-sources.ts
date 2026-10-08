import { createHash } from "node:crypto";
import { HttpMcpServer, McpDispatchUnknownError } from "../integrations/mcp/http-server.js";
import { McpTransport } from "../integrations/mcp/local-transport.js";
import { DirectApiClient, DispatchUnknownError } from "../integrations/direct-api/client.js";
import { summarizeConnectionResult } from "../integrations/runtime.js";
import type { ConnectionResult } from "../integrations/contracts.js";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult, ToolImplementation, ToolLimits, ToolRiskClass } from "../tools/contracts.js";
import type { HostedToolContribution } from "./contracts.js";
import { compileToolSchema, validateToolArguments } from "./schema.js";

const defaults: ToolLimits = { maxArgumentBytes: 32_768, maxResultBytes: 256 * 1024, timeoutMs: 30_000 };
type RichResult = ToolExecutionResult & { readonly structuredContent?: unknown; readonly contentBlocks?: readonly unknown[] };
interface Source { readonly id: string; readonly version: string; readonly headers?: Readonly<Record<string, string>> }
export interface McpSourceOptions extends Source {
  readonly endpoint: string;
  readonly protocolVersion?: string;
  readonly tools?: readonly { readonly remoteName: string; readonly name: string; readonly riskClass: ToolRiskClass; readonly limits?: Partial<ToolLimits> }[];
}
export interface HttpSourceOptions extends Source {
  readonly baseUrl: string;
  readonly operations: readonly {
    readonly name: string; readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; readonly path: string;
    readonly inputSchema: Readonly<Record<string, unknown>>; readonly outputSchema?: Readonly<Record<string, unknown>>;
    readonly description: string; readonly riskClass: ToolRiskClass; readonly limits?: Partial<ToolLimits>;
  }[];
}

/** Discover configured MCP tools without granting authority from remote annotations.
 * Endpoints and resolved credential headers stay in closures, never descriptors.
 */
export async function loadMcpSource(options: McpSourceOptions): Promise<HostedToolContribution[]> {
  validateSource(options);
  const server = new HttpMcpServer({ endpoint: options.endpoint, serverName: options.id, protocolVersion: options.protocolVersion ?? "2026-07-28", headers: options.headers, maxResponseBytes: 4 * 1024 * 1024 });
  let manifests;
  try { manifests = await server.listTools(AbortSignal.timeout(defaults.timeoutMs)); }
  catch (error) { await server.close(); throw error; }
  const close = () => server.close();
  try {
  if (new Set(manifests.map(tool => tool.name)).size !== manifests.length) throw new Error("MCP discovery returned duplicate remote tool identities.");
  const selections: NonNullable<McpSourceOptions["tools"]> = options.tools ?? manifests.map(tool => ({ remoteName: tool.name, name: modelName(tool.name), riskClass: "external" as const }));
  if (selections.length === 0) { await close(); return []; }
  assertDistinct(selections.map(item => item.name));
  return selections.map(selection => {
    const remote = manifests.find(tool => tool.name === selection.remoteName);
    if (!remote) throw new Error(`Configured MCP tool was not discovered: ${selection.name}.`);
    const limits = limitsFor(selection.limits);
    const definition: ToolDefinition = { schemaVersion: 1, name: selection.name, description: remote.description, inputSchema: remote.inputSchema,
      ...(remote.outputSchema ? { outputSchema: remote.outputSchema } : {}), riskClass: selection.riskClass, executionKind: "connection", limits };
    compileToolSchema(definition.inputSchema);
    const outputValidator = remote.outputSchema ? compileToolSchema(remote.outputSchema) : undefined;
    const frozenRemoteDigest = digest(remote);
    const tool = contribution(options, definition, { kind: "mcp", endpoint: new URL(options.endpoint).toString(), protocolVersion: server.protocolVersion, authorizationContextDigest: digest(options.headers ?? {}), remoteName: remote.name, remoteDigest: frozenRemoteDigest }, async (input, context, state) => {
      const current = (await server.listTools(AbortSignal.any([state.signal, AbortSignal.timeout(definition.limits.timeoutMs)]))).find(tool => tool.name === selection.remoteName);
      if (!current || digest(current) !== frozenRemoteDigest) throw new CatalogDriftError("The admitted MCP tool definition changed or disappeared. Reload the catalog for a new run.");
      validateToolArguments(definition.inputSchema, input);
      state.dispatched = true;
      const transport = new McpTransport({
        server: {
          serverName: server.serverName,
          protocolVersion: server.protocolVersion,
          listTools: signal => server.listTools(signal),
          callTool: async (name, args, requestId, signal) => {
            const output = await server.callToolResult(name, args, requestId, signal);
            return { providerRequestId: requestId, output, isError: output.isError === true };
          },
        },
        endpoint: options.endpoint,
        allowedEndpoints: [options.endpoint],
        limits: connectionLimits(definition.limits),
        readOnly: isReadOnly(definition),
      });
      const connection = await transport.invoke(remote, requestIdentity(context), input, state.signal);
      const evidence = recordConnection(connection, context, options.headers);
      if (!connection.output) return connectionFailure(connection, evidence);
      const raw = connection.output;
      const result = sanitizeOutput(raw, options.headers) as Record<string, unknown>;
      const content = JSON.stringify(result);
      const knownFailure = result.isError === true;
      const invalidOutput = !knownFailure && outputValidator !== undefined && !outputValidator(raw.structuredContent);
      return { status: knownFailure || invalidOutput ? "failed" : "completed", content,
        error: knownFailure ? { code: "TOOL_EXECUTION_FAILED", message: errorText(result) } : invalidOutput ? { code: "TOOL_EXECUTION_FAILED", message: "The MCP result does not match its declared output schema." } : null,
        durationMs: 0, attemptCount: connection.attempts.length, connection: evidence, ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        ...(Array.isArray(result.content) ? { contentBlocks: result.content } : {}) };
    });
    return { ...tool, close };
  });
  } catch (error) { await close(); throw error; }
}

/** Bind trusted HTTP operations. GET arguments become query values, other methods
 * use a JSON body. A confirmed HTTP failure is feedback; lost write replies are unknown.
 */
export function loadHttpSource(options: HttpSourceOptions): HostedToolContribution[] {
  validateSource(options);
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("HTTP source must use HTTP(S) without URL credentials.");
  assertDistinct(options.operations.map(item => item.name));
  return options.operations.map(operation => {
    if (!operation.path.startsWith("/") || operation.path.startsWith("//")) throw new Error("HTTP operation requires a same-origin absolute path.");
    const endpoint = new URL(operation.path, base);
    if (endpoint.origin !== base.origin) throw new Error("HTTP operation escaped its configured source.");
    const definition: ToolDefinition = { schemaVersion: 1, name: operation.name, description: operation.description, inputSchema: operation.inputSchema,
      ...(operation.outputSchema ? { outputSchema: operation.outputSchema } : {}), riskClass: operation.riskClass, executionKind: "connection", limits: limitsFor(operation.limits) };
    compileToolSchema(operation.inputSchema);
    const outputValidator = operation.outputSchema ? compileToolSchema(operation.outputSchema) : undefined;
    return contribution(options, definition, { kind: "http", baseUrl: base.toString(), authorizationContextDigest: digest(options.headers ?? {}), method: operation.method, path: operation.path }, async (input, context, state) => {
      validateToolArguments(operation.inputSchema, input);
      const url = new URL(endpoint);
      if (operation.method === "GET") for (const [key, value] of Object.entries(input)) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
      state.dispatched = true;
      let response: { ok: boolean; status: number; text: string } | undefined;
      const limits = connectionLimits(definition.limits);
      const client = new DirectApiClient({ limits, adapter: {
        send: async (_request, signal) => {
          try {
            const rawResponse = await fetch(url, { method: operation.method,
              headers: { ...options.headers, ...(operation.method === "GET" ? {} : { "content-type": "application/json" }) },
              ...(operation.method === "GET" ? {} : { body: JSON.stringify(input) }), signal, redirect: "error" });
            const text = await boundedText(rawResponse, definition.limits.maxResultBytes);
            response = { ok: rawResponse.ok, status: rawResponse.status, text };
            let parsed: unknown;
            try { parsed = JSON.parse(text); } catch { parsed = { text }; }
            return { providerRequestId: rawResponse.headers.get("x-request-id") ?? requestIdentity(context),
              statusCode: rawResponse.status, body: record(parsed) ? parsed : { value: parsed } };
          } catch (error) {
            if (!isReadOnly(definition)) throw new DispatchUnknownError("The HTTP request may have been dispatched; its effects are unknown.");
            throw error;
          }
        },
      } });
      const rawConnection = await client.request({ requestId: requestIdentity(context), operation: operation.name,
        input, idempotencyKey: null, limits }, { readOnly: isReadOnly(definition), signal: state.signal });
      const connection: ConnectionResult = rawConnection.status === "cancelled" && !isReadOnly(definition)
        ? { ...rawConnection, status: "unknown", error: { code: "API_OUTCOME_UNKNOWN", message: "The HTTP call may have been dispatched; its effects are unknown." },
          attempts: rawConnection.attempts.map(attempt => ({ ...attempt, status: "unknown", retryable: false })) }
        : rawConnection;
      const evidence = recordConnection(connection, context, options.headers);
      if (!response) return connectionFailure(connection, evidence);
      const text = response.text;
      let structuredContent: unknown;
      try { structuredContent = JSON.parse(text); } catch { /* Text responses stay text. */ }
      const invalidOutput = response.ok && outputValidator !== undefined && !outputValidator(structuredContent);
      structuredContent = structuredContent === undefined ? undefined : sanitizeOutput(structuredContent, options.headers);
      const content = structuredContent === undefined ? String(sanitizeOutput(text, options.headers)) : JSON.stringify(structuredContent);
      return { status: response.ok && !invalidOutput ? "completed" : "failed", content,
        error: invalidOutput ? { code: "TOOL_EXECUTION_FAILED", message: "The HTTP result does not match its declared output schema." } : response.ok ? null : { code: "TOOL_EXECUTION_FAILED", message: `HTTP ${response.status}. ${errorText(structuredContent ?? { message: text })}`.slice(0, 512) },
        durationMs: 0, attemptCount: connection.attempts.length, connection: evidence, ...(structuredContent !== undefined ? { structuredContent } : {}) };
    });
  });
}

interface DispatchState { signal: AbortSignal; dispatched: boolean }
function contribution(source: Source, definition: ToolDefinition, binding: unknown, operation: (input: Readonly<Record<string, unknown>>, context: ToolExecutionContext, state: DispatchState) => Promise<RichResult>): HostedToolContribution {
  const descriptor = { definition, source: { id: source.id, version: source.version, digest: digest({ definition, binding }) }, execution: { kind: "hosted" as const, key: `${source.id}:${definition.name}` },
    // A confirmed rejection is useful feedback even for a write. Native loops
    // always stop status=unknown independently of this known-failure policy.
    failurePolicy: "feedback" as const };
  const executeResult = async (input: Readonly<Record<string, unknown>>, context: ToolExecutionContext): Promise<RichResult> => {
    const started = Date.now(), controller = new AbortController();
    const state: DispatchState = { signal: controller.signal, dispatched: false };
    const abort = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    try {
      if (context.signal.aborted) throw new Error("Tool call cancelled before dispatch.");
      if (Buffer.byteLength(JSON.stringify(input)) > definition.limits.maxArgumentBytes) throw new Error("Tool arguments exceed the configured limit.");
      const result = await operation(input, context, state);
      if (Buffer.byteLength(result.content) > definition.limits.maxResultBytes) return failure("failed", "TOOL_RESULT_TOO_LARGE", "Tool result exceeds the configured limit.", started);
      return { ...result, durationMs: Date.now() - started };
    } catch (error) {
      const sideEffecting = definition.riskClass !== "read" && definition.riskClass !== "pure";
      const unknown = state.dispatched && (error instanceof McpDispatchUnknownError || sideEffecting);
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      const status = unknown ? "unknown" : timedOut ? "timed_out" : context.signal.aborted ? "cancelled" : "failed";
      const code = unknown ? "TOOL_UNKNOWN" : timedOut ? "TOOL_TIMEOUT" : context.signal.aborted ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED";
      const message = unknown ? "The tool request may have been dispatched; its effects are unknown. No automatic retry was attempted." : error instanceof CatalogDriftError ? error.message : timedOut ? "Tool call exceeded its deadline." : context.signal.aborted ? "Tool call was cancelled." : safeMessage(error, source.headers);
      return failure(status, code, message, started);
    } finally {
      context.signal.removeEventListener("abort", abort);
    }
  };
  const implementation: ToolImplementation & { executeResult: typeof executeResult } = { definition, validateArguments: value => validateToolArguments(definition.inputSchema, value), executeResult,
    execute: async (input, context) => { const result = await executeResult(input, context); if (result.status !== "completed") throw new Error(result.error?.message ?? "Tool failed."); return result.content; } };
  return { descriptor, implementation };
}

class CatalogDriftError extends Error {}
function failure(status: ToolExecutionResult["status"], code: NonNullable<ToolExecutionResult["error"]>["code"], message: string, started: number): RichResult { return { status, content: JSON.stringify({ error: message, code }), error: { code, message }, durationMs: Date.now() - started, attemptCount: 1 }; }
function errorText(value: unknown): string {
  if (!record(value)) return "The remote operation reported a failure.";
  if (typeof value.error === "string") return value.error.slice(0, 512);
  if (record(value.error) && typeof value.error.message === "string") return value.error.message.slice(0, 512);
  if (typeof value.message === "string") return value.message.slice(0, 512);
  if (Array.isArray(value.content)) { const texts = value.content.filter(record).filter(item => item.type === "text" && typeof item.text === "string").map(item => item.text).join("\n"); if (texts) return texts.slice(0, 512); }
  return "The remote operation reported a failure.";
}
function safeMessage(error: unknown, headers?: Readonly<Record<string, string>>): string { let message = error instanceof Error ? error.message : "Connected tool failed."; for (const value of Object.values(headers ?? {})) if (value) message = message.split(value).join("[REDACTED]"); return message.replace(/\bBearer\s+\S+|\bsk-(?:or-)?[A-Za-z0-9_-]+/gi, "[REDACTED]").slice(0, 512); }
function validateSource(source: Source) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(source.id) || !source.version.trim()) throw new Error("Connected source requires a safe identity and explicit version."); }
function limitsFor(value?: Partial<ToolLimits>): ToolLimits { const limits = { ...defaults, ...value }; if (Object.values(limits).some(item => !Number.isSafeInteger(item) || item < 1) || limits.timeoutMs > 120_000 || limits.maxArgumentBytes > 1_048_576 || limits.maxResultBytes > 4_194_304) throw new Error("Connected tool limits are invalid."); return limits; }
function assertDistinct(names: readonly string[]) { if (!names.length || names.length > 64 || new Set(names).size !== names.length || names.some(name => !/^[a-z][a-z0-9_-]{0,63}$/.test(name))) throw new Error("Connected tools require distinct provider-compatible aliases, at most 64 per source."); }
function modelName(name: string) { const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 59); return /^[a-z]/.test(normalized) ? normalized : `tool_${normalized}`; }
function digest(value: unknown): string { const canonical = (item: unknown): string => Array.isArray(item) ? `[${item.map(canonical).join(",")}]` : record(item) ? `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}` : JSON.stringify(item); return createHash("sha256").update(canonical(value)).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function boundedText(response: Response, maximum: number): Promise<string> { if (!response.body) return ""; const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0; try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > maximum) { await reader.cancel(); throw new Error("Connected tool response exceeds its configured limit."); } chunks.push(part.value); } } finally { reader.releaseLock(); } return Buffer.concat(chunks).toString("utf8"); }

function requestIdentity(context: ToolExecutionContext): string {
  return `hosted-${createHash("sha256").update(`${context.runId}:${context.turnId}:${context.toolCallId ?? "call"}`).digest("hex").slice(0, 48)}`;
}
function sanitizeOutput(value: unknown, headers?: Readonly<Record<string, string>>, depth = 0): unknown {
  if (depth > 32) return "[Depth limit]";
  if (typeof value === "string") { let result = value; for (const secret of Object.values(headers ?? {})) if (secret) result = result.split(secret).join("[REDACTED]"); return result.replace(/\bBearer\s+\S+|\bsk-(?:or-)?[A-Za-z0-9_-]+/gi, "[REDACTED]"); }
  if (Array.isArray(value)) return value.map(item => sanitizeOutput(item, headers, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /api.?key|authorization|password|secret|access.?token|credential/i.test(key) ? "[REDACTED]" : sanitizeOutput(item, headers, depth + 1)]));
  return value;
}

function connectionLimits(limits: ToolLimits) {
  return { timeoutMs: limits.timeoutMs, maxRequestBytes: limits.maxArgumentBytes,
    maxResponseBytes: limits.maxResultBytes, maxAttempts: 1 };
}
function isReadOnly(definition: ToolDefinition): boolean {
  return definition.riskClass === "pure" || definition.riskClass === "read";
}
function recordConnection(result: ConnectionResult, context: ToolExecutionContext, headers?: Readonly<Record<string, string>>) {
  const sanitized = sanitizeOutput(result, headers) as unknown as ConnectionResult;
  context.onConnectionResult?.(sanitized);
  return summarizeConnectionResult(sanitized);
}
function connectionFailure(result: ConnectionResult, connection: ReturnType<typeof summarizeConnectionResult>): RichResult {
  const code = result.status === "unknown" ? "TOOL_UNKNOWN" : result.status === "timed_out" ? "TOOL_TIMEOUT"
    : result.status === "cancelled" ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED";
  const message = result.error?.message ?? "The connected operation failed.";
  return { status: result.status, content: JSON.stringify({ error: message, code }), error: { code, message },
    durationMs: 0, attemptCount: result.attempts.length, connection };
}
