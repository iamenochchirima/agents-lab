import type { AppConfig } from "../config/config.js";
import { ComputerNativeError } from "../runtime/errors.js";
import { DeterministicModelProvider } from "./deterministic.js";
import { OpenRouterModelProvider } from "./openrouter.js";
import type { ModelProvider } from "./provider.js";

export function createModelProvider(config: AppConfig): ModelProvider {
  if (config.provider === "deterministic") {
    return new DeterministicModelProvider(config.model, {
      behavior: config.deterministicBehavior,
      delayMs: config.deterministicDelayMs,
    });
  }
  if (!config.openRouterApiKey) {
    throw new ComputerNativeError("configuration", "OpenRouter credentials are unavailable.");
  }
  return new OpenRouterModelProvider(config.model, config.openRouterApiKey);
}
