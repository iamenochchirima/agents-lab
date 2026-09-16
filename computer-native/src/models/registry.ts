import type { AppConfig } from "../config/config.js";
import { ComputerNativeError } from "../runtime/errors.js";
import type { ProviderName } from "../runtime/contracts.js";
import { DeterministicModelProvider } from "./deterministic.js";
import { OpenRouterModelProvider } from "./openrouter.js";
import { DETERMINISTIC_CAPABILITIES, OPENROUTER_CAPABILITIES, type ModelProvider, type ModelProviderCapabilities } from "./provider.js";

export interface ModelProviderSummary {
  readonly provider: ProviderName;
  readonly label: string;
  readonly modelHint: string;
  readonly capabilities: ModelProviderCapabilities;
}

interface ModelProviderDescriptor extends ModelProviderSummary {
  readonly validateModel: (model: string) => void;
  readonly create: (config: AppConfig) => ModelProvider;
}

function validateModelSelection(provider: ProviderName, model: string): void {
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

const descriptors: readonly ModelProviderDescriptor[] = [
  {
    provider: "deterministic",
    label: "Deterministic local provider",
    modelHint: "deterministic/<name>",
    capabilities: DETERMINISTIC_CAPABILITIES,
    validateModel: (model) => validateModelSelection("deterministic", model),
    create: (config) => new DeterministicModelProvider(config.model, {
      behavior: config.deterministicBehavior,
      delayMs: config.deterministicDelayMs,
    }),
  },
  {
    provider: "openrouter",
    label: "OpenRouter hosted provider",
    modelHint: "<namespace>/<model>[:free]",
    capabilities: OPENROUTER_CAPABILITIES,
    validateModel: (model) => validateModelSelection("openrouter", model),
    create: (config) => {
      if (!config.openRouterApiKey) throw new ComputerNativeError("configuration", "OpenRouter credentials are unavailable.");
      return new OpenRouterModelProvider(config.model, config.openRouterApiKey, fetch, config.maxModelOutputBytes);
    },
  },
];

const summaries: readonly ModelProviderSummary[] = descriptors.map(({ provider, label, modelHint, capabilities }) => ({
  provider,
  label,
  modelHint,
  capabilities,
}));

export function listModelProviderSummaries(): readonly ModelProviderSummary[] {
  return summaries;
}

export function getModelProviderSummary(provider: ProviderName): ModelProviderSummary {
  const summary = summaries.find((entry) => entry.provider === provider);
  if (!summary) throw new ComputerNativeError("configuration", `Unsupported provider '${provider}'.`);
  return summary;
}

export function createModelProvider(config: AppConfig): ModelProvider {
  const descriptor = descriptors.find((entry) => entry.provider === config.provider);
  if (!descriptor) throw new ComputerNativeError("configuration", `Unsupported provider '${config.provider}'.`);
  descriptor.validateModel(config.model);
  return descriptor.create(config);
}
