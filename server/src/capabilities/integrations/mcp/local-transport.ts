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

export interface McpToolSelection {
  readonly serverName: string;
  readonly protocolVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
}

export interface McpTransportOptions {
  readonly server: McpServer;
  readonly endpoint: string;
  readonly allowedEndpoints: readonly string[];
  readonly limits: ConnectionLimits;
  /** Optional server-owned selection that discovery and invocation must match. */
  readonly selectedTool?: McpToolSelection;
}

export class McpTransport {
  constructor(private readonly options: McpTransportOptions) {
    if (!options.allowedEndpoints.includes(options.endpoint)) {
      throw new Error("MCP endpoint is not allowlisted.");
    }
  }

  async discover(signal: AbortSignal): Promise<readonly McpToolManifest[]> {
    if (this.options.selectedTool && this.options.server.serverName !== this.options.selectedTool.serverName) {
      throw new Error("MCP server identity does not match the selected capability.");
    }
    if (this.options.selectedTool && this.options.server.protocolVersion !== this.options.selectedTool.protocolVersion) {
      throw new Error("MCP protocol version does not match the selected capability.");
    }
    const tools = await withDeadline(
      (attemptSignal) => this.options.server.listTools(attemptSignal),
      this.options.limits.timeoutMs,
      signal,
    );
    if (tools.length > 64) throw new Error("MCP discovery returned too many tools.");
    for (const tool of tools) validateToolManifest(tool);
    if (this.options.selectedTool) {
      const selected = tools.find((tool) => tool.name === this.options.selectedTool?.toolName && tool.version === this.options.selectedTool?.toolVersion);
      if (!selected) throw new Error("The selected MCP tool was not returned by discovery.");
    }
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
    if (this.options.selectedTool && (tool.name !== this.options.selectedTool.toolName || tool.version !== this.options.selectedTool.toolVersion)) {
      throw new Error("The MCP tool is not the server-owned selected tool.");
    }
    const requestBytes = new TextEncoder().encode(JSON.stringify(argumentsValue)).byteLength;
    if (requestBytes > this.options.limits.maxRequestBytes) {
      return failure(requestId, new Date().toISOString(), "MCP_REQUEST_TOO_LARGE", "MCP request exceeds the configured request limit.", "failed");
    }
    const startedAt = new Date().toISOString();
    try {
      const result = await withDeadline(
        (attemptSignal) => this.options.server.callTool(tool.name, argumentsValue, requestId, attemptSignal),
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

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<T> {
  if (parentSignal.aborted) throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  let timedOut = false;
  let parentAborted = false;
  let rejectParent: ((reason: unknown) => void) | undefined;
  const parentAbort = new Promise<never>((_, reject) => {
    rejectParent = reject;
  });
  const onParentAbort = () => {
    parentAborted = true;
    const reason = parentSignal.reason ?? new DOMException("Aborted", "AbortError");
    controller.abort(reason);
    rejectParent?.(reason);
  };
  parentSignal.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new DeadlineError("deadline exceeded");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    const operationPromise = operation(controller.signal);
    return await Promise.race([operationPromise, deadline, parentAbort]);
  } catch (error) {
    if (timedOut) throw new DeadlineError("deadline exceeded");
    if (parentAborted) throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
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
