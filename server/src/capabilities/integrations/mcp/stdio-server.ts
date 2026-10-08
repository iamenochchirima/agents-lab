import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { McpProgressDiagnostics } from "../contracts.js";
import { McpDispatchUnknownError, McpPreDispatchError } from "./http-server.js";
import type { McpServer, McpToolManifest } from "./local-transport.js";

export interface StdioMcpServerOptions {
  /** Administrator-approved executable and arguments. No shell expansion or package installation. */
  readonly executable: string;
  readonly args?: readonly string[];
  /** Explicit host working directory; this does not give agents native filesystem tools. */
  readonly cwd: string;
  /** Only these variables and PATH reach the provider. Resolve credentials on the host. */
  readonly env?: Readonly<Record<string, string>>;
  readonly serverName?: string;
  readonly protocolVersion?: string;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly onDispatch?: (method: string) => void;
}
export interface StdioMcpStatus {
  readonly state: "stopped" | "starting" | "running" | "failed";
  readonly pid: number | null;
  readonly generation: number;
  readonly stderr: readonly string[];
}
interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
  bytes: number;
  dispatched: boolean;
}

/** Host-owned MCP subprocess. This is process lifecycle management, not a sandbox.
 * A dispatched call with a lost acknowledgement is never replayed automatically.
 * Explicit restart begins a new MCP session; stopped clients remain stopped until start.
 */
export class StdioMcpServer implements McpServer {
  readonly serverName: string;
  readonly protocolVersion: string;
  private readonly timeout: number;
  private readonly maxBytes: number;
  private child: ChildProcessWithoutNullStreams | null = null;
  private state: StdioMcpStatus["state"] = "stopped";
  private generation = 0;
  private sequence = 0;
  private startPromise: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private stderr: string[] = [];
  private progress: McpProgressDiagnostics = { notifications: [], omitted: 0 };
  private initialized = false;
  private explicitlyStopped = false;

  constructor(private readonly options: StdioMcpServerOptions) {
    this.serverName = options.serverName ?? "stdio-mcp-server";
    this.protocolVersion = options.protocolVersion ?? "2025-11-25";
    if (!["2025-06-18", "2025-11-25"].includes(this.protocolVersion)) throw new Error("Unsupported stdio MCP protocol version.");
    if (!options.executable || options.executable.includes("\0") || !isAbsolute(options.cwd)) throw new Error("MCP executable and absolute working directory are required.");
    if (options.args?.some(value => typeof value !== "string" || value.includes("\0"))) throw new Error("MCP process arguments are invalid.");
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")) throw new Error("MCP process environment is invalid.");
    }
    this.timeout = options.requestTimeoutMs ?? 30_000;
    this.maxBytes = options.maxResponseBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 600_000) throw new Error("MCP request timeout is invalid.");
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 4 * 1024 * 1024) throw new Error("MCP response limit is invalid.");
  }

  status(): StdioMcpStatus { return { state: this.state, pid: this.child?.pid ?? null, generation: this.generation, stderr: [...this.stderr] }; }
  get progressDiagnostics(): McpProgressDiagnostics { return { notifications: [...this.progress.notifications], omitted: this.progress.omitted }; }

  async start(signal: AbortSignal = new AbortController().signal): Promise<void> {
    if (this.initialized && this.child) return;
    if (this.startPromise) return this.startPromise;
    if (signal.aborted) throw new McpPreDispatchError("MCP process start was cancelled.");
    // A crash requires an explicit restart, avoiding silent execution in a new provider session.
    if (this.state === "failed") throw new McpPreDispatchError("MCP process failed; restart it before invoking tools.");
    this.explicitlyStopped = false;
    this.startPromise = this.startProcess(signal).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startProcess(signal: AbortSignal): Promise<void> {
    this.state = "starting"; this.generation++; this.stderr = []; this.initialized = false;
    const child = spawn(this.options.executable, [...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", ...this.options.env },
      shell: false, stdio: "pipe", detached: process.platform !== "win32",
    });
    this.child = child;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      const bytes = chunk.byteLength;
      for (const pending of this.pending.values()) {
        pending.bytes += bytes;
        if (pending.bytes > this.maxBytes) { this.fail("MCP response exceeded the configured limit."); return; }
      }
      buffer += decoder.write(chunk);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > this.maxBytes) { this.fail("MCP response exceeded the configured limit."); return; }
        if (line.trim()) this.receive(line);
      }
      if (Buffer.byteLength(buffer) > this.maxBytes) this.fail("MCP response exceeded the configured limit.");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      // Raw stderr is deliberately not retained: arbitrary provider logs can include
      // secrets split across chunks or credentials unrelated to configured env values.
      this.stderr = [`Provider wrote stderr (${Math.min(chunk.byteLength, this.maxBytes)} bytes); content withheld.`];
    });
    child.stdin.on("error", () => { if (this.child === child) this.fail("MCP process input became unavailable."); });
    child.on("error", () => { if (this.child === child) this.fail("MCP process could not be started."); });
    child.on("exit", () => { if (this.child === child) { this.fail("MCP process exited before acknowledgement."); this.child = null; } });
    try {
      const result = await this.request("initialize", { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: "agent-harness-lab", version: "1.0.0" } }, signal);
      if (!record(result) || result.protocolVersion !== this.protocolVersion || !record(result.capabilities) || !record(result.serverInfo)) throw new Error("MCP initialization response is invalid or uses a different protocol version.");
      this.notify("notifications/initialized");
      this.initialized = true; this.state = "running";
    } catch (error) {
      this.fail("MCP initialization failed."); await this.terminate(child);
      throw error instanceof McpPreDispatchError ? error : new McpPreDispatchError("MCP initialization failed; no tool call was dispatched.");
    }
  }

  async stop(): Promise<void> {
    this.explicitlyStopped = true; this.initialized = false; this.state = "stopped";
    this.rejectPending("MCP process was stopped before acknowledgement.");
    const child = this.child; this.child = null;
    if (child) await this.terminate(child);
    // Wait for an in-flight handshake to settle before a subsequent explicit restart.
    await this.startPromise?.catch(() => undefined);
    this.state = "stopped";
  }
  async close(): Promise<void> { await this.stop(); }
  async restart(signal: AbortSignal = new AbortController().signal): Promise<void> { await this.stop(); await this.start(signal); }

  private async ready(signal: AbortSignal): Promise<void> {
    if (this.explicitlyStopped) throw new McpPreDispatchError("MCP process is stopped; start it before invoking tools.");
    await this.start(signal);
  }
  async listTools(signal: AbortSignal): Promise<readonly McpToolManifest[]> {
    await this.ready(signal);
    const tools: McpToolManifest[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, signal);
      if (!record(result) || !Array.isArray(result.tools)) throw new Error("MCP discovery response is invalid.");
      for (const value of result.tools) {
        if (!record(value) || typeof value.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.name) || !record(value.inputSchema) || (value.description !== undefined && typeof value.description !== "string")) throw new Error("MCP tool manifest is invalid.");
        const version = record(value._meta) && typeof value._meta.agentlabVersion === "string" ? value._meta.agentlabVersion : "1.0.0";
        tools.push({ name: value.name, version, description: typeof value.description === "string" ? value.description : `Call ${value.name}.`, inputSchema: value.inputSchema, ...(record(value.outputSchema) ? { outputSchema: value.outputSchema } : {}) });
      }
      if (tools.length > 64) throw new Error("MCP discovery returned too many tools.");
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor) { if (cursors.has(cursor) || cursors.size >= 64) throw new Error("MCP discovery cursor is repeated or excessive."); cursors.add(cursor); }
    } while (cursor);
    return tools;
  }
  async callToolResult(name: string, args: Readonly<Record<string, unknown>>, requestId: string, signal: AbortSignal, _inputSchema?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    await this.ready(signal);
    this.progress = { notifications: [], omitted: 0 };
    const result = await this.request("tools/call", { name, arguments: args }, signal, requestId);
    if (!record(result) || (!Array.isArray(result.content) && result.structuredContent === undefined)) throw new McpDispatchUnknownError("MCP tool returned an invalid acknowledgement.");
    return result;
  }
  async callTool(name: string, args: Readonly<Record<string, unknown>>, requestId: string, signal: AbortSignal): Promise<{ providerRequestId: string; output: Readonly<Record<string, unknown>>; isError?: boolean }> {
    const result = await this.callToolResult(name, args, requestId, signal);
    const text = Array.isArray(result.content) ? result.content.filter(record).filter(item => item.type === "text" && typeof item.text === "string").map(item => item.text).join("\n") : "";
    let output: Readonly<Record<string, unknown>> = record(result.structuredContent) ? result.structuredContent : { text };
    if (!record(result.structuredContent) && text) { try { const parsed: unknown = JSON.parse(text); if (record(parsed)) output = parsed; } catch { /* Preserve plain text results. */ } }
    return { providerRequestId: `mcp-stdio:${requestId}`, output, ...(result.isError === true ? { isError: true } : {}) };
  }

  private request(method: string, params: Readonly<Record<string, unknown>>, signal: AbortSignal, requestId?: string): Promise<unknown> {
    if (signal.aborted || !this.child || this.child.stdin.destroyed) return Promise.reject(new McpPreDispatchError("MCP request was cancelled or its process is unavailable before dispatch."));
    const id = requestId ?? `agentlab-stdio-${++this.sequence}`;
    if (this.pending.has(id)) return Promise.reject(new McpPreDispatchError("MCP request ID is already in flight."));
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    if (Buffer.byteLength(payload) > this.maxBytes) return Promise.reject(new McpPreDispatchError("MCP request exceeded the configured limit."));
    return new Promise((resolve, reject) => {
      const fail = (message: string) => {
        const pending = this.pending.get(id); if (!pending) return;
        if (pending.dispatched) { try { this.notify("notifications/cancelled", { requestId: id, reason: "Request cancelled or timed out." }); } catch { /* Outcome remains unknown. */ } }
        this.pending.delete(id); pending.cleanup();
        reject(method === "tools/call" && pending.dispatched ? new McpDispatchUnknownError(message) : new McpPreDispatchError(message));
      };
      const onAbort = () => fail("MCP request was cancelled before acknowledgement.");
      const timer = setTimeout(() => fail("MCP request timed out before acknowledgement."), this.timeout);
      const pending: Pending = { method, resolve, reject, dispatched: false, bytes: 0, cleanup: () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); } };
      this.pending.set(id, pending); signal.addEventListener("abort", onAbort, { once: true });
      try {
        this.options.onDispatch?.(method);
        // Once bytes are submitted to the pipe, even a write callback failure cannot
        // prove that the provider did not execute a side effect.
        pending.dispatched = true;
        this.child!.stdin.write(payload, error => { if (error) fail("MCP request acknowledgement was lost."); });
      } catch { fail("MCP request could not be dispatched."); }
    });
  }
  private notify(method: string, params?: Readonly<Record<string, unknown>>): void {
    if (!this.child || this.child.stdin.destroyed) throw new McpPreDispatchError("MCP process is unavailable.");
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
  }
  private receive(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { this.fail("MCP stdout contained malformed JSON."); return; }
    if (!record(value) || value.jsonrpc !== "2.0") { this.fail("MCP stdout contained an invalid envelope."); return; }
    if (typeof value.method === "string") {
      // Sampling, roots and elicitation are not implicitly authorized by the host.
      if (value.id !== undefined) this.child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: value.id, error: { code: -32601, message: "Client method is not supported." } }) + "\n");
      else if (value.method === "notifications/progress" && record(value.params)) {
        const params = value.params;
        if (this.progress.notifications.length >= 32) this.progress = { ...this.progress, omitted: this.progress.omitted + 1 };
        else this.progress = { ...this.progress, notifications: [...this.progress.notifications, { ...(typeof params.progress === "number" && Number.isFinite(params.progress) ? { progress: params.progress } : {}), ...(typeof params.total === "number" && Number.isFinite(params.total) ? { total: params.total } : {}) }] };
      }
      return;
    }
    const pending = typeof value.id === "string" ? this.pending.get(value.id) : undefined;
    if (!pending) return; // Late cancelled acknowledgements are not a later call's result.
    this.pending.delete(value.id as string); pending.cleanup();
    if (record(value.error)) pending.reject(new Error("MCP server rejected the request."));
    else if (!("result" in value)) pending.reject(pending.method === "tools/call" ? new McpDispatchUnknownError("MCP acknowledgement was invalid.") : new Error("MCP acknowledgement was invalid."));
    else pending.resolve(value.result);
  }
  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(pending.method === "tools/call" && pending.dispatched ? new McpDispatchUnknownError(message) : new McpPreDispatchError(message)); }
    this.pending.clear();
  }
  private fail(message: string): void {
    this.initialized = false; this.state = "failed"; this.rejectPending(message);
    const child = this.child;
    if (child) { this.child = null; void this.terminate(child); }
  }
  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    child.stdin.destroy();
    if (child.exitCode !== null || child.signalCode !== null) { kill("SIGKILL"); return; }
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); })]);
    if (timer) clearTimeout(timer);
    // Terminate any surviving descendants in the dedicated process group too.
    kill("SIGKILL");
  }
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
