import { isSafeRequestId, type ConnectionLimits, type ConnectionResult } from "../contracts.js";

export interface McpToolManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpServer {
  readonly serverName: string;
  readonly protocolVersion: string;
  listTools(signal: AbortSignal): Promise<readonly McpToolManifest[]>;
  callTool(
    toolName: string,
    argumentsValue: Readonly<Record<string, unknown>>,
    requestId: string,
    signal: AbortSignal,
  ): Promise<{ readonly providerRequestId: string; readonly output: Readonly<Record<string, unknown>> }>;
}

export interface McpTransportOptions {
  readonly server: McpServer;
  readonly endpoint: string;
  readonly allowedEndpoints: readonly string[];
  readonly limits: ConnectionLimits;
}

export class McpTransport {
  constructor(private readonly options: McpTransportOptions) {
    if (!options.allowedEndpoints.includes(options.endpoint)) {
      throw new Error("MCP endpoint is not allowlisted.");
    }
  }

  async discover(signal: AbortSignal): Promise<readonly McpToolManifest[]> {
    const tools = await withDeadline(() => this.options.server.listTools(signal), this.options.limits.timeoutMs, signal);
    if (tools.length > 64) throw new Error("MCP discovery returned too many tools.");
    for (const tool of tools) validateToolManifest(tool);
    return tools;
  }

  async invoke(
    tool: McpToolManifest,
    requestId: string,
    argumentsValue: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<ConnectionResult> {
    if (!isSafeRequestId(requestId)) throw new Error("MCP request ID is unsafe.");
    if (!this.options.server) throw new Error("MCP server is unavailable.");
    validateToolManifest(tool);
    const requestBytes = new TextEncoder().encode(JSON.stringify(argumentsValue)).byteLength;
    if (requestBytes > this.options.limits.maxRequestBytes) {
      return failure(requestId, new Date().toISOString(), "MCP_REQUEST_TOO_LARGE", "MCP request exceeds the configured request limit.", "failed");
    }
    const startedAt = new Date().toISOString();
    try {
      const result = await withDeadline(
        () => this.options.server.callTool(tool.name, argumentsValue, requestId, signal),
        this.options.limits.timeoutMs,
        signal,
      );
      const output = JSON.stringify(result.output);
      if (output === undefined || new TextEncoder().encode(output).byteLength > this.options.limits.maxResponseBytes) {
        return failure(requestId, startedAt, "MCP_RESULT_TOO_LARGE", "MCP result exceeds the configured response limit.", "failed");
      }
      return {
        requestId,
        status: "completed",
        output: result.output,
        attempts: [{
          requestId,
          attempt: 1,
          startedAt,
          finishedAt: new Date().toISOString(),
          status: "completed",
          retryable: false,
          providerRequestId: result.providerRequestId,
          errorCode: null,
          errorMessage: null,
        }],
        error: null,
      };
    } catch (error) {
      const timedOut = error instanceof DeadlineError;
      const cancelled = signal.aborted && !timedOut;
      return failure(
        requestId,
        startedAt,
        cancelled ? "MCP_CANCELLED" : timedOut ? "MCP_TIMEOUT" : "MCP_CALL_FAILED",
        cancelled ? "MCP call was cancelled." : timedOut ? "MCP call exceeded its deadline." : safeMessage(error),
        cancelled ? "cancelled" : timedOut ? "timed_out" : "failed",
      );
    }
  }
}

class DeadlineError extends Error {}

async function withDeadline<T>(operation: () => Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError("deadline exceeded")), timeoutMs);
  });
  const abort = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
  });
  try {
    return await Promise.race([operation(), deadline, abort]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failure(
  requestId: string,
  startedAt: string,
  code: string,
  message: string,
  status: "failed" | "cancelled" | "timed_out",
): ConnectionResult {
  return {
    requestId,
    status,
    output: null,
    attempts: [{
      requestId,
      attempt: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      retryable: status === "failed",
      providerRequestId: null,
      errorCode: code,
      errorMessage: bounded(message),
    }],
    error: { code, message: bounded(message) },
  };
}

function safeMessage(error: unknown): string {
  return bounded(error instanceof Error && error.message ? error.message : "MCP call failed.");
}

function bounded(value: string): string {
  return value.length <= 512 ? value : value.slice(0, 512);
}

function validateToolManifest(tool: McpToolManifest): void {
  if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(tool.name) || !/^\d+\.\d+\.\d+$/.test(tool.version) || tool.description.length > 8_192) {
    throw new Error("MCP tool manifest is invalid or unbounded.");
  }
  const schemaBytes = new TextEncoder().encode(JSON.stringify(tool.inputSchema)).byteLength;
  if (schemaBytes > 32_768) throw new Error("MCP tool schema exceeds the configured limit.");
}
