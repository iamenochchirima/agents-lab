import type { AwsStepFunctionsConfig } from "../../../config.js";
import type { AwsStepFunctionsActivityInput, AwsStepFunctionsModelResult } from "../contracts.js";
import { runFakeModel } from "./fake.js";
import { runOpenRouterModel } from "./openrouter.js";

export interface AwsStepFunctionsModelRunner {
  run(input: AwsStepFunctionsActivityInput): Promise<AwsStepFunctionsModelResult>;
}

export function createModelRunner(
  config: Pick<AwsStepFunctionsConfig, "modelTimeoutMs" | "openRouterApiKey" | "openRouterBaseUrl">,
  fetchImplementation: typeof fetch = fetch,
): AwsStepFunctionsModelRunner {
  return {
    run(input) {
      if (input.provider === "fake") return runFakeModel(input, config.modelTimeoutMs);
      return runOpenRouterModel(input, {
        apiKey: config.openRouterApiKey,
        baseUrl: config.openRouterBaseUrl,
        timeoutMs: config.modelTimeoutMs,
        fetchImplementation,
      });
    },
  };
}
