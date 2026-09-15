import type { RunManifest } from "../../../../../control-plane/domain/types.js";

export const MASTRA_CORE_VERSION = "1.66.0" as const;
export const MASTRA_AGENT_ID = "mastra-baseline-agent" as const;
export const MASTRA_OPERATION = "agent.generate" as const;
export const MASTRA_STORAGE_MODE = "none" as const;
export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;

export type MastraProvider = "fake" | "openrouter";

export interface MastraBaselineConfiguration {
  readonly agentId: string;
  readonly executionTimeoutMs: number;
  readonly provider: MastraProvider;
  readonly model: string;
}

export interface MastraEnvironment {
  readonly OPENROUTER_API_KEY?: string;
}

export function configurationFromManifest(manifest: RunManifest): MastraBaselineConfiguration {
  const configuration = manifest.platformConfig;
  const executionTimeoutMs = readPositiveInteger(configuration, "executionTimeoutMs");

  return {
    agentId: readString(configuration, "agentId", MASTRA_AGENT_ID),
    executionTimeoutMs,
    provider: manifest.model.provider,
    model: manifest.model.model,
  };
}

export function validateConfiguration(
  manifest: RunManifest,
  environment: MastraEnvironment,
): string | null {
  if (manifest.platform !== "mastra" || manifest.variant !== "baseline") {
    return "The Mastra baseline runner only accepts mastra/baseline manifests.";
  }

  const configuration = configurationFromManifest(manifest);
  if (configuration.provider === "fake" && !configuration.model.startsWith("fake-")) {
    return "The Mastra fake provider requires a model name beginning with fake-.";
  }

  if (configuration.provider === "openrouter") {
    if (environment.OPENROUTER_API_KEY?.trim().length === 0 || !environment.OPENROUTER_API_KEY) {
      return "OPENROUTER_API_KEY is required for the Mastra OpenRouter profile.";
    }
    if (configuration.model.includes(" ")) {
      return "The Mastra OpenRouter model name must not contain whitespace.";
    }
  }

  return null;
}

export function modelIdForManifest(manifest: RunManifest): string {
  if (manifest.model.provider === "fake") {
    return manifest.model.model;
  }

  return manifest.model.model.startsWith("openrouter/")
    ? manifest.model.model
    : `openrouter/${manifest.model.model}`;
}

export function safeEnvironment(environment: NodeJS.ProcessEnv = process.env): MastraEnvironment {
  return { OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY };
}

function readString(
  configuration: Readonly<Record<string, unknown>>,
  key: string,
  fallback?: string,
): string {
  const value = configuration[key] ?? fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Mastra platform configuration is missing ${key}.`);
  }
  return value.trim();
}

function readPositiveInteger(configuration: Readonly<Record<string, unknown>>, key: string): number {
  const value = configuration[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Mastra platform configuration has an invalid ${key}.`);
  }
  return value;
}
