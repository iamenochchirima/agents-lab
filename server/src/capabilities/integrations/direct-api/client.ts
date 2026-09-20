import {
  assertConnectionLimits,
  isSafeIdempotencyKey,
  isSafeRequestId,
  type ConnectionAttempt,
  type ConnectionLimits,
  type ConnectionRequest,
  type ConnectionResult,
} from "../contracts.js";

export interface DirectApiResponse {
  readonly providerRequestId: string;
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly retryAfterMs?: number;
}

export interface DirectApiAdapter {
  send(request: ConnectionRequest, signal: AbortSignal): Promise<DirectApiResponse>;
}

export interface DirectApiClientOptions {
  readonly adapter: DirectApiAdapter;
  readonly limits: ConnectionLimits;
  readonly retryableStatusCodes?: readonly number[];
}

/**
 * Small provider-neutral API boundary. It retries only bounded, safe failures;
 * a timeout after a write has been dispatched is deliberately reported unknown.
 */
export class DirectApiClient {
  private readonly retryableStatusCodes: ReadonlySet<number>;

  constructor(private readonly options: DirectApiClientOptions) {
    assertConnectionLimits(options.limits);
    this.retryableStatusCodes = new Set(options.retryableStatusCodes ?? [408, 425, 429, 500, 502, 503, 504]);
  }

  async request(request: ConnectionRequest, options: { readonly readOnly: boolean; readonly signal: AbortSignal }): Promise<ConnectionResult> {
    validateRequest(request);
    const attempts: ConnectionAttempt[] = [];
    for (let attempt = 1; attempt <= request.limits.maxAttempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      try {
        const response = await withDeadline(
          (attemptSignal) => this.options.adapter.send(request, attemptSignal),
          request.limits.timeoutMs,
          options.signal,
        );
        const retryable = options.readOnly && this.retryableStatusCodes.has(response.statusCode);
        const successful = response.statusCode >= 200 && response.statusCode < 300;
        attempts.push(attemptRecord(request.requestId, attempt, startedAt, successful ? "completed" : "failed", retryable, response.providerRequestId, successful ? null : `HTTP_${response.statusCode}`));
        if (successful) {
          const serialized = JSON.stringify(response.body);
          if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > request.limits.maxResponseBytes) {
            return result(request.requestId, "failed", attempts, null, "API_RESULT_TOO_LARGE", "API response exceeds the configured response limit.");
          }
          return result(request.requestId, "completed", attempts, response.body, null, null);
        }
        if (!retryable || attempt === request.limits.maxAttempts) {
          return result(request.requestId, "failed", attempts, null, `HTTP_${response.statusCode}`, `Direct API request failed with HTTP ${response.statusCode}.`);
        }
        await delay(response.retryAfterMs ?? Math.min(250 * 2 ** (attempt - 1), 2_000), options.signal);
      } catch (error) {
        const timedOut = error instanceof DeadlineError;
        const cancelled = options.signal.aborted && !timedOut;
        const unknown = !options.readOnly && (timedOut || error instanceof DispatchUnknownError);
        const status = cancelled ? "cancelled" : unknown ? "unknown" : timedOut ? "timed_out" : "failed";
        attempts.push(attemptRecord(request.requestId, attempt, startedAt, status, !unknown && !cancelled, null, timedOut ? "API_TIMEOUT" : cancelled ? "API_CANCELLED" : "API_CALL_FAILED"));
        if (unknown || cancelled || attempt === request.limits.maxAttempts) {
          return result(request.requestId, status, attempts, null, status === "unknown" ? "API_OUTCOME_UNKNOWN" : timedOut ? "API_TIMEOUT" : cancelled ? "API_CANCELLED" : "API_CALL_FAILED", unknown ? "The API call may have been dispatched; outcome is unknown." : safeMessage(error));
        }
      }
    }
    return result(request.requestId, "failed", attempts, null, "API_CALL_FAILED", "Direct API request failed.");
  }
}

export class DispatchUnknownError extends Error {}
class DeadlineError extends Error {}

function validateRequest(request: ConnectionRequest): void {
  if (!isSafeRequestId(request.requestId)) throw new Error("API request ID is unsafe.");
  if (request.idempotencyKey !== null && !isSafeIdempotencyKey(request.idempotencyKey)) throw new Error("API idempotency key is unsafe.");
  assertConnectionLimits(request.limits);
}

function attemptRecord(requestId: string, attempt: number, startedAt: string, status: ConnectionAttempt["status"], retryable: boolean, providerRequestId: string | null, errorCode: string | null): ConnectionAttempt {
  return { requestId, attempt, startedAt, finishedAt: new Date().toISOString(), status, retryable, providerRequestId, errorCode, errorMessage: errorCode ? bounded(errorCode) : null };
}

function result(requestId: string, status: ConnectionResult["status"], attempts: readonly ConnectionAttempt[], output: Readonly<Record<string, unknown>> | null, code: string | null, message: string | null): ConnectionResult {
  return { requestId, status, output, attempts, error: code && message ? { code, message: bounded(message) } : null };
}

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

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  await withDeadline(() => new Promise<void>((resolve) => setTimeout(resolve, ms)), Math.max(ms + 1, 1), signal);
}

function safeMessage(error: unknown): string { return bounded(error instanceof Error && error.message ? error.message : "Direct API request failed."); }
function bounded(value: string): string { return value.length <= 512 ? value : value.slice(0, 512); }
