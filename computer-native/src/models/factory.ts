import type { AppConfig } from "../config/config.js";
import { ComputerNativeError } from "../runtime/errors.js";
import { DeterministicModelProvider } from "./deterministic.js";
import { OpenRouterModelProvider } from "./openrouter.js";
import type { ModelProvider } from "./provider.js";

function validateModelSelection(provider: AppConfig["provider"], model: string): void {
  const parts = model.trim().split("/");
  if (parts.length < 2 || parts.some((part) => part.trim().length === 0) || /\s/u.test(model)) {
    if (provider === "openrouter") {
      throw new ComputerNativeError("configuration", `OpenRouter model '${model}' must be a namespaced OpenRouter model such as nvidia/model:free or openrouter/free.`);
    }
    throw new ComputerNativeError("configuration", `The deterministic model must start with deterministic/; received '${model}'.`);
  }
  if (provider === "deterministic" && !model.startsWith("deterministic/")) {
    throw new ComputerNativeError("configuration", `The deterministic model must start with deterministic/; received '${model}'.`);
  }
}

export function createModelProvider(config: AppConfig): ModelProvider {
  validateModelSelection(config.provider, config.model);
  if (config.provider === "deterministic") {
    return new DeterministicModelProvider(config.model, {
      behavior: config.deterministicBehavior,
      delayMs: config.deterministicDelayMs,
    });
  }
  if (!config.openRouterApiKey) {
    throw new ComputerNativeError("configuration", "OpenRouter credentials are unavailable.");
  }
  return new OpenRouterModelProvider(config.model, config.openRouterApiKey, fetch, config.maxModelOutputBytes);
}
