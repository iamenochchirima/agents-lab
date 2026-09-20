import {
  DirectApiClient,
  DispatchUnknownError,
  type DirectApiAdapter,
  type DirectApiResponse,
} from "./direct-api/client.js";
import type {
  ConnectionAttempt,
  ConnectionLimits,
  ConnectionRequest,
  ConnectionResult,
} from "./contracts.js";

export interface ConnectionRuntime {
  request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult>;
}

export interface HttpConnectionRuntimeOptions {
  readonly endpoint: string;
  readonly fetchImplementation?: typeof fetch;
  readonly limits?: ConnectionLimits;
}

export interface ConnectionEvidence {
  readonly requestId: string;
  readonly status: ConnectionResult["status"];
  readonly attemptCount: number;
  readonly providerRequestIds: readonly string[];
  readonly errorCode: string | null;
}

const DEFAULT_FIXTURE_LIMITS: ConnectionLimits = Object.freeze({
  timeoutMs: 2_000,
  maxRequestBytes: 1_024,
  maxResponseBytes: 4_096,
  maxAttempts: 3,
});

/**
 * A deterministic connection runtime used by local platform executions.
 *
 * The fixture deliberately goes through the same direct-API client used by a
 * provider adapter. This keeps request IDs, retry rules, response limits, and
 * write idempotency observable without making Docker or an external account a
 * prerequisite for a local run.
 */
export class LocalFixtureConnectionRuntime implements ConnectionRuntime {
  private readonly values = new Map<string, string>([
    ["alpha", "local fixture alpha"],
    ["project", "Agent Harness Lab"],
  ]);
  private readonly committedWrites = new Map<string, { readonly fingerprint: string; readonly response: DirectApiResponse }>();
  private readonly client: DirectApiClient;

  constructor(
    private readonly limits: ConnectionLimits = DEFAULT_FIXTURE_LIMITS,
  ) {
    this.client = new DirectApiClient({
      limits,
      adapter: this.adapter(),
    });
  }

  async request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult> {
    if (connectionRef !== "conn_local_fixture") {
      return unavailable(request.requestId, "CONNECTION_NOT_CONFIGURED", "The requested local connection is not configured.");
    }
    return this.client.request(request, options);
  }

  private adapter(): DirectApiAdapter {
    return {
      send: async (request, signal) => {
        if (signal.aborted) {
          throw signal.reason ?? new DOMException("Aborted", "AbortError");
        }

        if (request.operation === "fixture.lookup") {
          const key = readString(request.input.key);
          if (!key || key.length > 64) {
            return response(request, 400, { error: "Invalid fixture lookup key." });
          }
          return response(request, 200, { key, value: this.values.get(key) ?? null });
        }

        if (request.operation === "fixture.write") {
          const key = readString(request.input.key);
          const value = readString(request.input.value);
          if (!key || key.length > 64 || value === null || value.length > 512 || request.idempotencyKey === null) {
            return response(request, 400, { error: "Invalid fixture write request." });
          }

          const fingerprint = JSON.stringify({ key, value });
          const previous = this.committedWrites.get(request.idempotencyKey);
          if (previous) {
            return previous.fingerprint === fingerprint
              ? previous.response
              : response(request, 409, { error: "The idempotency key was already used for another write." });
          }

          this.values.set(key, value);
          const committed = response(request, 200, { key, written: true });
          this.committedWrites.set(request.idempotencyKey, { fingerprint, response: committed });
          return committed;
        }

        return response(request, 404, { error: "The local fixture operation is not available." });
      },
    };
  }
}

/** Calls the local fixture over its real HTTP connection boundary. */
export class HttpConnectionRuntime implements ConnectionRuntime {
  private readonly client: DirectApiClient;
  private readonly fetchImplementation: typeof fetch;
  private readonly endpoint: string;

  constructor(options: HttpConnectionRuntimeOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.client = new DirectApiClient({
      limits: options.limits ?? DEFAULT_FIXTURE_LIMITS,
      adapter: {
        send: (request, signal) => this.send(request, signal),
      },
    });
  }

  async request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult> {
    if (connectionRef !== "conn_local_fixture") {
      return unavailable(request.requestId, "CONNECTION_NOT_CONFIGURED", "The requested local connection is not configured.");
    }
    return this.client.request(request, options);
  }

  private async send(request: ConnectionRequest, signal: AbortSignal): Promise<DirectApiResponse> {
    const body = JSON.stringify({
      requestId: request.requestId,
      operation: request.operation,
      input: request.input,
      idempotencyKey: request.idempotencyKey,
    });
    if (new TextEncoder().encode(body).byteLength > request.limits.maxRequestBytes) {
      throw new Error("The local connection request exceeds its configured input limit.");
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.endpoint}/v1/connection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
      });
    } catch (error) {
      if (request.operation === "fixture.write") {
        throw new DispatchUnknownError("The local connection write acknowledgement was lost.");
      }
      throw error;
    }

    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > request.limits.maxResponseBytes) {
      throw new Error("The local connection response exceeds its configured output limit.");
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("The local connection returned malformed JSON.");
    }
    if (!isRecord(value) || typeof value.providerRequestId !== "string" || typeof value.statusCode !== "number" || !isRecord(value.body)) {
      throw new Error("The local connection returned an invalid response envelope.");
    }
    return {
      providerRequestId: value.providerRequestId,
      statusCode: value.statusCode,
      body: value.body,
    };
  }
}

class ConfiguredConnectionRuntime implements ConnectionRuntime {
  private endpoint: string | null | undefined;
  private runtime: ConnectionRuntime | undefined;

  request(
    connectionRef: string,
    request: ConnectionRequest,
    options: { readonly readOnly: boolean; readonly signal: AbortSignal },
  ): Promise<ConnectionResult> {
    const endpoint = process.env.AGENTLAB_LOCAL_FIXTURE_URL?.trim() || null;
    if (this.runtime === undefined || this.endpoint !== endpoint) {
      this.endpoint = endpoint;
      this.runtime = endpoint ? new HttpConnectionRuntime({ endpoint }) : new LocalFixtureConnectionRuntime();
    }
    return this.runtime.request(connectionRef, request, options);
  }
}

let defaultRuntime: ConnectionRuntime | undefined;

export function getDefaultConnectionRuntime(): ConnectionRuntime {
  defaultRuntime ??= new ConfiguredConnectionRuntime();
  return defaultRuntime;
}

export function summarizeConnectionResult(result: ConnectionResult): ConnectionEvidence {
  return {
    requestId: result.requestId,
    status: result.status,
    attemptCount: result.attempts.length,
    providerRequestIds: result.attempts
      .map((attempt) => attempt.providerRequestId)
      .filter((requestId): requestId is string => requestId !== null),
    errorCode: result.error?.code ?? null,
  };
}

function response(request: ConnectionRequest, statusCode: number, body: Readonly<Record<string, unknown>>): DirectApiResponse {
  return {
    providerRequestId: `local-direct:${request.requestId}`,
    statusCode,
    body,
  };
}

function unavailable(requestId: string, code: string, message: string): ConnectionResult {
  const now = new Date().toISOString();
  const attempt: ConnectionAttempt = {
    requestId,
    attempt: 1,
    startedAt: now,
    finishedAt: now,
    status: "failed",
    retryable: false,
    providerRequestId: null,
    errorCode: code,
    errorMessage: message,
  };
  return {
    requestId,
    status: "failed",
    output: null,
    attempts: [attempt],
    error: { code, message },
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
