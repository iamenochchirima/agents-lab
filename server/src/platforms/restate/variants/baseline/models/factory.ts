import type { ModelProvider } from "../../../../../control-plane/domain/types.js";
import type { ModelAdapter } from "../contracts.js";
import { FakeRestateModel } from "./fake.js";
import { OpenRouterRestateModel } from "./openrouter.js";

export function createRestateModel(
  provider: ModelProvider,
  model: string,
  options: { readonly openRouterApiKey: string | null; readonly openRouterBaseUrl: string },
): ModelAdapter {
  if (provider === "fake") return new FakeRestateModel();
  if (!options.openRouterApiKey) {
    return {
      complete: async () => ({
        kind: "failure",
        code: "OPENROUTER_API_KEY_MISSING",
        message: "OPENROUTER_API_KEY is required for the OpenRouter adapter.",
        failureKind: "configuration",
        retryable: false,
        requestSent: false,
      }),
    };
  }
  void model;
  return new OpenRouterRestateModel({ apiKey: options.openRouterApiKey, baseUrl: options.openRouterBaseUrl });
}
