import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { redactSecrets, ToolExecutionError } from "../runtime/errors.js";
import type { TypeSafeModelEvidence } from "./contracts.js";

const DEFAULT_TYPESAFE_MODEL = "jev-latest";
const MAX_MODEL_NAME_LENGTH = 128;

export interface TypeSafeModelPreflightOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
}

function requestedModel(value: string | undefined): string {
  const model = value?.trim() || DEFAULT_TYPESAFE_MODEL;
  if (model.length === 0 || model.length > MAX_MODEL_NAME_LENGTH) {
    throw new ToolExecutionError("The configured TypeSafe model name is invalid or exceeds 128 characters.");
  }
  return model;
}

function safeFailure(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : "The TypeSafe readiness request failed.";
  return redactSecrets(message, [apiKey]).slice(0, 512);
}

async function proveTypeSafeModel(options: TypeSafeModelPreflightOptions, signal?: AbortSignal): Promise<TypeSafeModelEvidence> {
  if (!options.apiKey) throw new ToolExecutionError("The TypeSafe computer strategy requires TYPESAFE_API_KEY before task approval.");
  const requested = requestedModel(options.model);
  try {
    const client = new TypeSafeClient({
      apiKey: options.apiKey,
      defaultModel: requested,
      retry: { maxRetries: 0 },
      timeout: 20_000,
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    });
    // This proves the configured endpoint and model alias without sending the
    // user's goal, page content, accessibility state, or any task value.
    const response = await client.systemOne({
      model: requested,
      state: { purpose: "Lina Jev readiness check" },
      questions: {
        ready: choice("Is this bounded readiness check available?", {
          ready: "The TypeSafe model is available.",
          unavailable: "The TypeSafe model is unavailable.",
        }),
      },
    }, { signal, timeout: 20_000 });
    if (typeof response.model !== "string" || response.model.trim().length === 0 || response.model.length > MAX_MODEL_NAME_LENGTH) {
      throw new ToolExecutionError("The TypeSafe readiness response did not identify a bounded model.");
    }
    return { requestedModel: requested, resolvedModel: response.model.trim() };
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    throw new ToolExecutionError(`TypeSafe Jev readiness failed: ${safeFailure(error, options.apiKey)}`, { cause: error });
  }
}

/**
 * Create an application-lifetime readiness probe. Successful evidence is
 * reused for later tasks; an in-flight probe is shared, while failures are not
 * cached so a transient provider outage can be retried on the next task.
 */
export function createTypeSafeModelPreflight(options: TypeSafeModelPreflightOptions): (signal?: AbortSignal) => Promise<TypeSafeModelEvidence> {
  let cached: TypeSafeModelEvidence | undefined;
  let pending: Promise<TypeSafeModelEvidence> | undefined;
  return async (signal?: AbortSignal): Promise<TypeSafeModelEvidence> => {
    if (cached) return cached;
    if (!pending) {
      pending = proveTypeSafeModel(options, signal);
    }
    try {
      cached = await pending;
      return cached;
    } finally {
      pending = undefined;
    }
  };
}
