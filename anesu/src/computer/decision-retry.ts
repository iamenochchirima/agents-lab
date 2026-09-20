import { isAbortError } from "../runtime/errors.js";
import { classifyComputerFailure } from "./failures.js";

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

export interface DecisionFailure {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retrying: boolean;
  readonly latencyMs: number;
  readonly error: unknown;
}

export interface DecisionRetryOptions {
  readonly signal?: AbortSignal;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly onFailure?: (failure: DecisionFailure) => void | Promise<void>;
}

function transientProviderFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  const code = classifyComputerFailure(error);
  if (code === "computer-provider-timeout") return true;
  return /\bHTTP\s+(?:408|425|429|500|502|503|504)\b/iu.test(message)
    || /\b(?:rate[- ]?limit|temporarily unavailable|overloaded|stream (?:ended|closed|disconnected))\b/iu.test(message);
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException("The computer decision was cancelled.", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The computer decision was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retry only a provider decision that has not reached approval or execution.
 * Native/browser inputs are deliberately outside this helper: once a host
 * effect starts, its uncertain outcome must never be replayed here.
 */
export async function runDecisionWithRetry<T>(
  decide: (attempt: number) => Promise<T>,
  options: DecisionRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Computer decision maxAttempts must be an integer between 1 and 3.");
  }
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
    throw new Error("Computer decision retryDelayMs must be an integer between 0 and 5000.");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("The computer decision was cancelled.", "AbortError");
    const startedAt = Date.now();
    try {
      return await decide(attempt);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      const retrying = attempt < maxAttempts && transientProviderFailure(error);
      await options.onFailure?.({ attempt, maxAttempts, retrying, latencyMs: Math.max(0, Date.now() - startedAt), error });
      if (!retrying) throw error;
      await waitForRetry(retryDelayMs * attempt, options.signal);
    }
  }
  throw new Error("Computer decision ended without a result.");
}
