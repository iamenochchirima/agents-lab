import { createHash } from "node:crypto";
import { HttpMcpServer, McpDispatchUnknownError } from "../integrations/mcp/http-server.js";
import { McpTransport } from "../integrations/mcp/local-transport.js";
import { DirectApiClient, DispatchUnknownError } from "../integrations/direct-api/client.js";
import { summarizeConnectionResult } from "../integrations/runtime.js";
import type { ConnectionResult } from "../integrations/contracts.js";
import type { ToolApprovalMode, ToolDefinition, ToolExecutionContext, ToolExecutionResult, ToolImplementation, ToolLimits, ToolRiskClass } from "../tools/contracts.js";
import type { HostedToolContribution } from "./contracts.js";
import { compileToolSchema, validateToolArguments } from "./schema.js";

const defaults: ToolLimits = { maxArgumentBytes: 32_768, maxResultBytes: 256 * 1024, timeoutMs: 30_000 };
type RichResult = ToolExecutionResult & { readonly structuredContent?: unknown; readonly contentBlocks?: readonly unknown[] };
interface Source {
  readonly id: string; readonly version: string; readonly headers?: Readonly<Record<string, string>>;
  readonly resolveHeaders?: (signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
  readonly connection?: NonNullable<HostedToolContribution["descriptor"]["connection"]>;
}
export interface McpSourceOptions extends Source {
  readonly endpoint: string;
  readonly protocolVersion?: string;
  readonly trustedContext?: "session";
  readonly tools?: readonly { readonly remoteName: string; readonly name: string; readonly riskClass: ToolRiskClass; readonly limits?: Partial<ToolLimits>; readonly approvalMode?: ToolApprovalMode; readonly effectContract?: { readonly rejectionErrorCodes: readonly string[] } }[];
}
export interface HttpSourceOptions extends Source {
  readonly baseUrl: string;
  readonly operations: readonly {
    readonly name: string; readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; readonly path: string;
    readonly inputSchema: Readonly<Record<string, unknown>>; readonly outputSchema?: Readonly<Record<string, unknown>>;
    readonly description: string; readonly riskClass: ToolRiskClass; readonly limits?: Partial<ToolLimits>;
    readonly approvalMode?: ToolApprovalMode;
    /** Destination names map to top-level argument names; omitted mappings retain legacy behavior. */
    readonly bindings?: { readonly path?: Readonly<Record<string, string>>; readonly query?: Readonly<Record<string, string>>; readonly headers?: Readonly<Record<string, string>>; readonly body?: Readonly<Record<string, string>> };
    readonly requestEncoding?: "json" | "form";
    readonly idempotency?: { readonly header: string };
    /** A single page per call. The model decides whether to request the bounded next cursor. */
    readonly pagination?: { readonly cursorArgument: string; readonly cursorQuery: string; readonly nextCursorPath: readonly string[] };
    /** Select JSON fields without an expression engine; the output schema validates the mapped result. */
    readonly responseMapping?: { readonly valuePath?: readonly string[]; readonly requestIdHeader?: string };
    /** Only provider-documented rejections establish no effects after dispatch. */
    readonly effectContract?: { readonly rejectionStatusCodes?: readonly number[]; readonly successConfirmsEffect?: boolean };
  }[];
}

/** Discover configured MCP tools without granting authority from remote annotations.
 * Endpoints and resolved credential headers stay in closures, never descriptors.
 */
export async function loadMcpSource(options: McpSourceOptions): Promise<HostedToolContribution[]> {
  validateSource(options);
  const discoveredHeaders = await sourceHeaders(options, AbortSignal.timeout(defaults.timeoutMs));
  const createServer = (headers: Readonly<Record<string, string>>) => new HttpMcpServer({ endpoint: options.endpoint, serverName: options.id, protocolVersion: options.protocolVersion ?? "2026-07-28", headers, maxResponseBytes: 4 * 1024 * 1024 });
  const discovery = createServer(discoveredHeaders);
  let manifests;
  try { manifests = await discovery.listTools(AbortSignal.timeout(defaults.timeoutMs)); }
  finally { await discovery.close(); }
  if (new Set(manifests.map(tool => tool.name)).size !== manifests.length) throw new Error("MCP discovery returned duplicate remote tool identities.");
  const selections: NonNullable<McpSourceOptions["tools"]> = options.tools ?? manifests.map(tool => ({ remoteName: tool.name, name: modelName(tool.name), riskClass: "external" as const }));
  if (!selections.length) return [];
  assertDistinct(selections.map(item => item.name));
  return selections.map(selection => {
    const rejectionCodes = selection.effectContract?.rejectionErrorCodes;
    if (selection.effectContract !== undefined && (!record(selection.effectContract) || Object.keys(selection.effectContract).some(key => key !== "rejectionErrorCodes") || !Array.isArray(rejectionCodes) || rejectionCodes.length > 32 || rejectionCodes.some(code => typeof code !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(code)) || new Set(rejectionCodes).size !== rejectionCodes.length)) throw new Error("MCP rejection contract requires at most 32 distinct documented error codes.");
    const remote = manifests.find(tool => tool.name === selection.remoteName);
    if (!remote) throw new Error(`Configured MCP tool was not discovered: ${selection.name}.`);
    const definition: ToolDefinition = { schemaVersion: 1, name: selection.name, description: remote.description, inputSchema: remote.inputSchema,
      ...(remote.outputSchema ? { outputSchema: remote.outputSchema } : {}), ...(selection.approvalMode ? { approvalMode: selection.approvalMode } : {}),
      riskClass: selection.riskClass, executionKind: "connection", limits: limitsFor(selection.limits), supportedContent: ["text", "json", "resource"] };
    compileToolSchema(definition.inputSchema);
    const outputValidator = remote.outputSchema ? compileToolSchema(remote.outputSchema) : undefined;
    const frozenRemoteDigest = digest(remote);
    return contribution(options, definition, { kind: "mcp", endpoint: new URL(options.endpoint).toString(), protocolVersion: discovery.protocolVersion,
      authorizationContextDigest: authorityDigest(options), trustedContext: options.trustedContext ?? null, remoteName: remote.name, remoteDigest: frozenRemoteDigest, effectContract: selection.effectContract ?? null }, async (input, context, state) => {
      const headers = await sourceHeaders(options, state.signal);
      if (options.trustedContext === "session") {
        if (!context.sessionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context.sessionId)) throw new Error("The connected provider requires a trusted session identity.");
        for (const name of Object.keys(headers)) if (name.toLowerCase() === "x-agentlab-session-id") delete headers[name];
        headers["X-AgentLab-Session-Id"] = context.sessionId;
      }
      state.headers = headers;
      const server = createServer(headers);
      try {
        const current = (await server.listTools(AbortSignal.any([state.signal, AbortSignal.timeout(definition.limits.timeoutMs)]))).find(tool => tool.name === selection.remoteName);
        if (!current || digest(current) !== frozenRemoteDigest) throw new CatalogDriftError("The admitted MCP tool definition changed or disappeared. Reload the catalog for a new run.");
        validateToolArguments(definition.inputSchema, input);
        const transport = new McpTransport({ server: { serverName: server.serverName, protocolVersion: server.protocolVersion,
          listTools: signal => server.listTools(signal),
          callTool: async (name, args, requestId, signal) => {
            state.dispatched = true;
            const output = await server.callToolResult(name, args, requestId, signal, remote.inputSchema);
            return { providerRequestId: requestId, output, isError: output.isError === true };
          } }, endpoint: options.endpoint, allowedEndpoints: [options.endpoint], limits: connectionLimits(definition.limits), readOnly: isReadOnly(definition) });
        const invoked = await transport.invoke(remote, requestIdentity(context), input, state.signal);
        const progress = server.progressDiagnostics;
        const connection: ConnectionResult = progress.notifications.length || progress.omitted
          ? { ...invoked, attempts: invoked.attempts.map(attempt => ({ ...attempt, progress })) } : invoked;
        const evidence = recordConnection(connection, context, headers);
        if (!connection.output) return { ...connectionFailure(connection, evidence), effect: { state: isReadOnly(definition) ? "none" : "unknown", evidence: "No valid MCP acknowledgement." } };
        const raw = connection.output, result = sanitizeOutput(raw, headers) as Record<string, unknown>;
        const knownFailure = result.isError === true;
        const invalidOutput = !knownFailure && outputValidator !== undefined && !outputValidator(raw.structuredContent);
        const structuredError = record(raw.structuredContent) && record(raw.structuredContent.error) ? raw.structuredContent.error : null;
        const rejected = knownFailure && typeof structuredError?.code === "string" && rejectionCodes?.includes(structuredError.code) === true;
        const unresolved = !isReadOnly(definition) && ((knownFailure && !rejected) || invalidOutput);
        return { status: unresolved ? "unknown" : knownFailure || invalidOutput ? "failed" : "completed", content: JSON.stringify(result),
          effect: { state: isReadOnly(definition) ? "none" : rejected ? "rejected" : knownFailure ? "unknown" : "acknowledged", evidence: rejected ? `Provider-documented pre-effect rejection: ${structuredError!.code}.` : knownFailure ? "MCP tool error does not establish absence of effects." : "Correlated MCP result received." },
          presentation: invalidOutput ? "invalid" : outputValidator ? "valid" : "not_declared",
          error: unresolved ? { code: "TOOL_UNKNOWN", message: "The MCP write requires reconciliation; do not repeat it." } : knownFailure ? { code: "TOOL_EXECUTION_FAILED", message: errorText(result) } : invalidOutput ? { code: "TOOL_EXECUTION_FAILED", message: "The MCP result does not match its declared output schema." } : null,
          durationMs: 0, attemptCount: connection.attempts.length, connection: evidence,
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}), ...(Array.isArray(result.content) ? { contentBlocks: result.content } : {}) };
      } finally { await server.close(); }
    });
  });
}

/** Bind trusted HTTP operations. Effect certainty follows provider contracts,
 * independently of HTTP response presentation and schema validation.
 */
export function loadHttpSource(options: HttpSourceOptions): HostedToolContribution[] {
  validateSource(options);
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("HTTP source must use HTTP(S) without URL credentials.");
  assertDistinct(options.operations.map(item => item.name));
  return options.operations.map(operation => {
    validateHttpOperation(operation);
    if (!operation.path.startsWith("/") || operation.path.startsWith("//")) throw new Error("HTTP operation requires a same-origin absolute path.");
    const endpoint = new URL(operation.path, base);
    if (endpoint.origin !== base.origin) throw new Error("HTTP operation escaped its configured source.");
    const definition: ToolDefinition = { schemaVersion: 1, name: operation.name, description: operation.description, inputSchema: operation.inputSchema,
      ...(operation.outputSchema ? { outputSchema: operation.outputSchema } : {}), ...(operation.approvalMode ? { approvalMode: operation.approvalMode } : {}),
      riskClass: operation.riskClass, executionKind: "connection", limits: limitsFor(operation.limits), supportedContent: ["text", "json"] };
    compileToolSchema(operation.inputSchema);
    const outputValidator = operation.outputSchema ? compileToolSchema(operation.outputSchema) : undefined;
    return contribution(options, definition, { kind: "http", baseUrl: base.toString(), authorizationContextDigest: authorityDigest(options), operation }, async (input, context, state) => {
      validateToolArguments(operation.inputSchema, input);
      const headers = await sourceHeaders(options, state.signal);
      state.headers = headers;
      const bound = bindHttpRequest(operation, base, input, headers);
      if (Buffer.byteLength(bound.url.toString()) + Buffer.byteLength(bound.body ?? "") + Buffer.byteLength(JSON.stringify(bound.headers)) > definition.limits.maxArgumentBytes) throw new Error("Bound HTTP request exceeds its configured input limit.");
      const idempotencyKey = operation.idempotency ? requestIdentity(context) : undefined;
      if (operation.idempotency) bound.headers[operation.idempotency.header] = idempotencyKey!;
      let response: { ok: boolean; status: number; text: string } | undefined;
      const limits = connectionLimits(definition.limits);
      const client = new DirectApiClient({ limits, adapter: {
        send: async (_request, signal) => {
          try {
            state.dispatched = true;
            const rawResponse = await fetch(bound.url, { method: operation.method,
              headers: bound.headers, ...(bound.body !== undefined ? { body: bound.body } : {}), signal, redirect: "error" });
            const text = await boundedText(rawResponse, definition.limits.maxResultBytes);
            response = { ok: rawResponse.ok, status: rawResponse.status, text };
            let parsed: unknown;
            try { parsed = JSON.parse(text); } catch { parsed = { text }; }
            return { providerRequestId: rawResponse.headers.get(operation.responseMapping?.requestIdHeader ?? "x-request-id")?.slice(0, 256) ?? requestIdentity(context),
              statusCode: rawResponse.status, body: record(parsed) ? parsed : { value: parsed } };
          } catch (error) {
            if (!isReadOnly(definition)) throw new DispatchUnknownError("The HTTP request may have been dispatched; its effects are unknown.");
            throw error;
          }
        },
      } });
      const rawConnection = await client.request({ requestId: requestIdentity(context), operation: operation.name,
        input, idempotencyKey: idempotencyKey ?? null, limits }, { readOnly: isReadOnly(definition), signal: state.signal });
      const connection: ConnectionResult = rawConnection.status === "cancelled" && !isReadOnly(definition)
        ? { ...rawConnection, status: "unknown", error: { code: "API_OUTCOME_UNKNOWN", message: "The HTTP call may have been dispatched; its effects are unknown." },
          attempts: rawConnection.attempts.map(attempt => ({ ...attempt, status: "unknown", retryable: false })) }
        : rawConnection;
      const evidence = recordConnection(connection, context, headers);
      if (!response) return { ...connectionFailure(connection, evidence), effect: { state: isReadOnly(definition) ? "none" : state.dispatched ? "unknown" : "not_dispatched", evidence: "No complete HTTP acknowledgement.", ...(idempotencyKey ? { idempotencyKey } : {}) } };
      const text = response.text;
      let structuredContent: unknown;
      try { structuredContent = JSON.parse(text); } catch { /* Text responses stay text. */ }
      const mapped = response.ok ? mapHttpResponse(operation, structuredContent) : { valid: true, value: structuredContent };
      structuredContent = mapped.value;
      const invalidOutput = response.ok && (!mapped.valid || outputValidator !== undefined && !outputValidator(structuredContent));
      structuredContent = structuredContent === undefined ? undefined : sanitizeOutput(structuredContent, headers);
      const content = structuredContent === undefined ? String(sanitizeOutput(text, headers)) : JSON.stringify(structuredContent);
      const rejected = !response.ok && operation.effectContract?.rejectionStatusCodes?.includes(response.status) === true;
      const unresolved = !isReadOnly(definition) && ((!response.ok && !rejected) || invalidOutput);
      return { status: unresolved ? "unknown" : response.ok && !invalidOutput ? "completed" : "failed", content,
        effect: { state: isReadOnly(definition) ? "none" : rejected ? "rejected" : !response.ok ? "unknown" : operation.effectContract?.successConfirmsEffect ? "confirmed" : "acknowledged",
          evidence: rejected ? `Provider contract establishes HTTP ${response.status} as no-effect rejection.` : response.ok ? `HTTP ${response.status} acknowledgement received${invalidOutput ? "; output schema invalid" : ""}.` : `HTTP ${response.status} does not establish absence of effects.`, ...(idempotencyKey ? { idempotencyKey } : {}) },
        presentation: invalidOutput ? "invalid" : outputValidator && response.ok ? "valid" : "not_declared",
        error: unresolved ? { code: "TOOL_UNKNOWN", message: invalidOutput ? "The write was acknowledged but its result is invalid. Reconcile before continuing; do not repeat it." : `HTTP ${response.status} write outcome requires reconciliation; do not repeat it.` } : invalidOutput ? { code: "TOOL_EXECUTION_FAILED", message: "The HTTP result does not match its declared output schema." } : response.ok ? null : { code: "TOOL_EXECUTION_FAILED", message: `HTTP ${response.status}. ${errorText(structuredContent ?? { message: text })}`.slice(0, 512) },
        durationMs: 0, attemptCount: connection.attempts.length, connection: evidence, ...(structuredContent !== undefined ? { structuredContent } : {}) };
    });
  });
}

interface DispatchState { signal: AbortSignal; dispatched: boolean; headers?: Readonly<Record<string, string>> }
function contribution(source: Source, definition: ToolDefinition, binding: unknown, operation: (input: Readonly<Record<string, unknown>>, context: ToolExecutionContext, state: DispatchState) => Promise<RichResult>): HostedToolContribution {
  const descriptor = { definition, source: { id: source.id, version: source.version, digest: digest({ definition, binding }) }, execution: { kind: "hosted" as const, key: `${source.id}:${definition.name}` },
    // A confirmed rejection is useful feedback even for a write. Native loops
    // always stop status=unknown independently of this known-failure policy.
    failurePolicy: "feedback" as const, ...(source.connection ? { connection: source.connection } : {}) };
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
      if (Buffer.byteLength(result.content) > definition.limits.maxResultBytes) {
        const uncertainWrite = !isReadOnly(definition) && state.dispatched;
        return { ...failure(uncertainWrite ? "unknown" : "failed", uncertainWrite ? "TOOL_UNKNOWN" : "TOOL_RESULT_TOO_LARGE", "Tool result exceeds the configured limit; inspect the retained source receipt before continuing.", started), effect: result.effect, presentation: "invalid" };
      }
      return { ...result, durationMs: Date.now() - started };
    } catch (error) {
      const sideEffecting = definition.riskClass !== "read" && definition.riskClass !== "pure";
      const unknown = state.dispatched && (error instanceof McpDispatchUnknownError || sideEffecting);
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      const status = unknown ? "unknown" : timedOut ? "timed_out" : context.signal.aborted ? "cancelled" : "failed";
      const code = unknown ? "TOOL_UNKNOWN" : timedOut ? "TOOL_TIMEOUT" : context.signal.aborted ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED";
      const message = unknown ? "The tool request may have been dispatched; its effects are unknown. No automatic retry was attempted." : error instanceof CatalogDriftError ? error.message : timedOut ? "Tool call exceeded its deadline." : context.signal.aborted ? "Tool call was cancelled." : safeMessage(error, state.headers ?? source.headers);
      return { ...failure(status, code, message, started), effect: { state: unknown ? "unknown" : state.dispatched ? "none" : "not_dispatched", evidence: message } };
    } finally {
      context.signal.removeEventListener("abort", abort);
    }
  };
  const implementation: ToolImplementation & { executeResult: typeof executeResult } = { definition, validateArguments: value => validateToolArguments(definition.inputSchema, value), executeResult,
    execute: async (input, context) => { const result = await executeResult(input, context); if (result.status !== "completed") throw new Error(result.error?.message ?? "Tool failed."); return result.content; } };
  return { descriptor, implementation, ...(source.resolveHeaders ? { checkAuthority: async (signal: AbortSignal) => { await sourceHeaders(source, signal); } } : {}) };
}

class CatalogDriftError extends Error {}
async function sourceHeaders(source: Source, signal: AbortSignal): Promise<Record<string, string>> {
  if (signal.aborted) throw signal.reason ?? new Error("Source resolution cancelled.");
  return { ...source.headers, ...(source.resolveHeaders ? await source.resolveHeaders(signal) : {}) };
}
function authorityDigest(source: Source): string { return digest(source.connection ?? source.headers ?? {}); }
type HttpOperation = HttpSourceOptions["operations"][number];
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const reservedHeader = /^(authorization|cookie|host|content-length|connection|transfer-encoding|proxy-authorization|x-agentlab-session-id)$/i;
function validateHttpOperation(operation: HttpOperation): void {
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method)) throw new Error("Unsupported HTTP operation method.");
  if (operation.requestEncoding !== undefined && operation.requestEncoding !== "json" && operation.requestEncoding !== "form") throw new Error("Unsupported HTTP request encoding.");
  if (operation.approvalMode !== undefined && !["automatic", "tool_grant", "invocation"].includes(operation.approvalMode)) throw new Error("Invalid tool approval mode.");
  const pathValid = (path: readonly string[]) => Array.isArray(path) && path.length <= 16 && path.every(part => typeof part === "string" && part.length > 0 && part.length <= 128 && !["__proto__", "constructor", "prototype"].includes(part));
  if (operation.responseMapping?.valuePath && !pathValid(operation.responseMapping.valuePath)) throw new Error("Invalid HTTP response selector.");
  if (operation.responseMapping?.requestIdHeader && !headerName.test(operation.responseMapping.requestIdHeader)) throw new Error("Invalid provider request-ID header.");
  if (operation.pagination && (operation.method !== "GET" || !operation.pagination.cursorArgument || !operation.pagination.cursorQuery || operation.pagination.cursorQuery.length > 128 || !pathValid(operation.pagination.nextCursorPath))) throw new Error("Pagination requires a GET cursor binding and bounded response selector.");
  for (const mapping of Object.values(operation.bindings ?? {})) {
    if (!record(mapping) || Object.keys(mapping).length > 64 || Object.entries(mapping).some(([destination, argument]) => !destination || typeof argument !== "string" || !argument)) throw new Error("HTTP bindings require bounded destination-to-argument mappings.");
  }
  for (const name of Object.keys(operation.bindings?.headers ?? {})) if (!headerName.test(name) || reservedHeader.test(name) || name.toLowerCase() === "content-type") throw new Error("HTTP model bindings cannot override transport or credential headers.");
  if (operation.idempotency && (!headerName.test(operation.idempotency.header) || reservedHeader.test(operation.idempotency.header))) throw new Error("Invalid provider idempotency header.");
  if (operation.effectContract?.rejectionStatusCodes?.some(status => !Number.isInteger(status) || status < 400 || status > 599)) throw new Error("Provider rejection statuses must be HTTP error codes.");
  if (operation.effectContract?.successConfirmsEffect !== undefined && typeof operation.effectContract.successConfirmsEffect !== "boolean") throw new Error("Effect confirmation must be explicit.");
}
function bindHttpRequest(operation: HttpOperation, base: URL, input: Readonly<Record<string, unknown>>, credentials: Readonly<Record<string, string>>) {
  let path = operation.path;
  for (const [name, argument] of Object.entries(operation.bindings?.path ?? {})) {
    const value = input[argument];
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`HTTP path binding requires a scalar argument: ${argument}.`);
    const encoded = encodeURIComponent(String(value));
    if (encoded === "." || encoded === "..") throw new Error("HTTP path binding cannot traverse directories.");
    path = path.split(`{${name}}`).join(encoded);
  }
  if (/\{[^}]+\}/.test(path)) throw new Error("HTTP path contains an unbound parameter.");
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("HTTP operation escaped its configured source.");
  const headers = { ...credentials };
  const scalar = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
  const query = operation.bindings ? operation.bindings.query ?? {} : operation.method === "GET" ? Object.fromEntries(Object.keys(input).filter(key => key !== operation.pagination?.cursorArgument).map(key => [key, key])) : {};
  for (const [name, argument] of Object.entries(query)) if (input[argument] !== undefined) url.searchParams.set(name, scalar(input[argument]));
  if (operation.pagination && input[operation.pagination.cursorArgument] !== undefined) {
    const cursor = input[operation.pagination.cursorArgument];
    if (typeof cursor !== "string" || cursor.length > 2048) throw new Error("HTTP pagination cursor must be a bounded string.");
    url.searchParams.set(operation.pagination.cursorQuery, cursor);
  }
  for (const [name, argument] of Object.entries(operation.bindings?.headers ?? {})) if (input[argument] !== undefined) {
    const value = scalar(input[argument]);
    if (/[\r\n\u0000]/.test(value)) throw new Error("HTTP header binding contains an invalid value.");
    if (Object.keys(credentials).some(key => key.toLowerCase() === name.toLowerCase())) throw new Error("HTTP binding cannot replace a source credential header.");
    headers[name] = value;
  }
  const payload = operation.bindings?.body ? Object.fromEntries(Object.entries(operation.bindings.body).filter(([, argument]) => input[argument] !== undefined).map(([name, argument]) => [name, input[argument]])) : operation.bindings ? {} : input;
  let body: string | undefined;
  if (operation.method !== "GET") {
    if (operation.requestEncoding === "form") { body = new URLSearchParams(Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, scalar(value)]))).toString(); headers["content-type"] = "application/x-www-form-urlencoded"; }
    else { body = JSON.stringify(payload); headers["content-type"] = "application/json"; }
  }
  return { url, headers, body };
}
function mapHttpResponse(operation: HttpOperation, raw: unknown): { valid: boolean; value: unknown } {
  const select = (path: readonly string[] | undefined): unknown => {
    let value = raw;
    for (const part of path ?? []) {
      if (!record(value) || !Object.hasOwn(value, part)) return undefined;
      value = value[part];
    }
    return value;
  };
  const value = select(operation.responseMapping?.valuePath);
  if (operation.responseMapping?.valuePath && value === undefined) return { valid: false, value: raw };
  if (!operation.pagination) return { valid: true, value };
  const cursor = select(operation.pagination.nextCursorPath);
  if (cursor !== undefined && cursor !== null && (typeof cursor !== "string" || cursor.length > 2048)) return { valid: false, value: raw };
  return { valid: true, value: { value, nextCursor: cursor ?? null } };
}
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
function limitsFor(value?: Partial<ToolLimits>): ToolLimits { const limits = { ...defaults, ...value }; if (Object.values(limits).some(item => !Number.isSafeInteger(item) || item < 1) || limits.timeoutMs > 120_000 || limits.maxArgumentBytes > 1_048_576 || limits.maxResultBytes > 1_048_576) throw new Error("Connected tool limits are invalid."); return limits; }
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
