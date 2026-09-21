/** Provider-neutral contracts for connection-backed capabilities. */

export const CONNECTION_SCHEMA_VERSION = 1 as const;

export type ConnectionKind = "mcp" | "direct_api" | "oauth";
export type ConnectionStatus = "available" | "unavailable" | "denied" | "expired" | "revoked";

export interface ConnectionBinding {
  readonly toolName: string;
  readonly connectionRef: string;
  readonly operations: readonly string[];
  /**
   * Server-owned MCP selection metadata. The endpoint itself is resolved from
   * process configuration by the native runtime; this record carries only its
   * safe identity into the immutable run manifest.
   */
  readonly mcp?: McpConnectionBinding;
}

export interface McpConnectionBinding {
  readonly endpointRef: string;
  readonly serverName: string;
  readonly protocolVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
}

export interface ConnectionReference {
  readonly schemaVersion: typeof CONNECTION_SCHEMA_VERSION;
  readonly ref: string;
  readonly kind: ConnectionKind;
  readonly provider: string;
  readonly displayName: string;
  readonly scopes: readonly string[];
}

export interface ConnectionSummary {
  readonly ref: string;
  readonly kind: ConnectionKind;
  readonly provider: string;
  readonly status: ConnectionStatus;
  readonly scopes: readonly string[];
  readonly safeFingerprint: string | null;
  readonly expiresAt: string | null;
}

export interface ConnectionLimits {
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxAttempts: number;
}

export interface ConnectionRequest {
  readonly requestId: string;
  readonly operation: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
  readonly limits: ConnectionLimits;
  readonly mcp?: McpConnectionBinding;
}

export interface ConnectionAttempt {
  readonly requestId: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "completed" | "failed" | "cancelled" | "timed_out" | "unknown";
  readonly retryable: boolean;
  readonly providerRequestId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface ConnectionResult {
  readonly requestId: string;
  readonly status: "completed" | "failed" | "cancelled" | "timed_out" | "unknown";
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly attempts: readonly ConnectionAttempt[];
  readonly error: { readonly code: string; readonly message: string } | null;
  /** Bounded identity and lifecycle phase for an MCP connection, if used. */
  readonly mcp?: McpConnectionEvidence;
}

export interface McpConnectionEvidence {
  readonly endpointRef: string | null;
  readonly serverName: string;
  readonly protocolVersion: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly phase: "discovery" | "invocation";
}

export function isSafeConnectionRef(ref: string): boolean {
  return /^conn_[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/.test(ref);
}

export function isSafeRequestId(requestId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId);
}

export function isSafeIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(key);
}

export function assertConnectionLimits(limits: ConnectionLimits): void {
  if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 120_000) {
    throw new Error("Connection timeout must be an integer between 1 and 120000 milliseconds.");
  }
  if (!Number.isInteger(limits.maxRequestBytes) || limits.maxRequestBytes < 1 || limits.maxRequestBytes > 1_048_576) {
    throw new Error("Connection request limit must be between 1 and 1048576 bytes.");
  }
  if (!Number.isInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1 || limits.maxResponseBytes > 4_194_304) {
    throw new Error("Connection response limit must be between 1 and 4194304 bytes.");
  }
  if (!Number.isInteger(limits.maxAttempts) || limits.maxAttempts < 1 || limits.maxAttempts > 5) {
    throw new Error("Connection attempt limit must be between 1 and 5.");
  }
}

export function validateConnectionRequest(request: ConnectionRequest): void {
  if (!isSafeRequestId(request.requestId)) throw new Error("Connection request ID is unsafe.");
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(request.operation)) throw new Error("Connection operation is unsafe.");
  if (request.idempotencyKey !== null && !isSafeIdempotencyKey(request.idempotencyKey)) {
    throw new Error("Connection idempotency key is unsafe.");
  }
  assertConnectionLimits(request.limits);
  const encoded = JSON.stringify(request.input);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > request.limits.maxRequestBytes) {
    throw new Error("Connection request exceeds its configured input limit.");
  }
}
