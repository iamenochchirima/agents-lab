import { loadDbosSdk } from "../../../sdk.js";
import type { DbosModelRequest, DbosModelResult } from "../contracts.js";

const { DBOS } = loadDbosSdk();

export class PreDispatchRetryError extends Error {
  constructor() {
    super("The deterministic fake model failed before dispatch and is safe to retry.");
    this.name = "PreDispatchRetryError";
  }
}

export async function completeFakeModel(input: DbosModelRequest): Promise<DbosModelResult> {
  const signal = DBOS.stepStatus?.timeoutSignal;
  if (signal?.aborted) throw new DOMException("The DBOS model step timed out.", "AbortError");

  if (input.model === "fake-pre-dispatch-retry" && input.attempt === 1) {
    throw new PreDispatchRetryError();
  }

  if (input.model === "fake-delay") {
    await waitWithAbort(250, signal);
  }

  if (input.model === "fake-timeout") {
    await waitWithAbort(1_000, signal);
  }

  if (input.model === "fake-failure") {
    return {
      kind: "failure",
      code: "FAKE_MODEL_FAILURE",
      message: "The deterministic fake model was instructed to fail.",
      failureKind: "provider",
      retryable: false,
      requestSent: false,
      attemptCount: input.attempt,
    };
  }

  if (input.model === "fake-unknown") {
    return {
      kind: "failure",
      code: "FAKE_MODEL_OUTCOME_UNKNOWN",
      message: "The fake model simulates a response whose outcome cannot be confirmed.",
      failureKind: "outcome_unknown",
      retryable: false,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }

  if (input.model !== "fake-success" && input.model !== "fake-delay" && input.model !== "fake-timeout" && input.model !== "fake-pre-dispatch-retry") {
    return {
      kind: "failure",
      code: "UNKNOWN_FAKE_MODEL",
      message: `Unknown fake model: ${input.model}`,
      failureKind: "configuration",
      retryable: false,
      requestSent: false,
      attemptCount: input.attempt,
    };
  }

  return {
    kind: "success",
    output: `Fake response: ${input.prompt}`,
    providerRequestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    attemptCount: input.attempt,
  };
}

function waitWithAbort(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The DBOS model step was cancelled.", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
