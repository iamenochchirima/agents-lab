import os from "node:os";
import path from "node:path";
import { ComputerNativeError } from "../runtime/errors.js";
import type { DeterministicBehavior, ProviderName } from "../runtime/contracts.js";

export const DEFAULT_INITIAL_INSTRUCTION =
  "You are Computer Native, a concise and helpful terminal assistant. Respond with text only.";

export interface ConfigOverrides {
  readonly stateDir?: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly deterministicBehavior?: DeterministicBehavior;
  readonly deterministicDelayMs?: number;
  readonly openRouterApiKey?: string;
  readonly initialInstruction?: string;
}

export interface AppConfig {
  readonly stateDir: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly timeoutMs: number;
  readonly deterministicBehavior: DeterministicBehavior;
  readonly deterministicDelayMs: number;
  readonly openRouterApiKey?: string;
  readonly initialInstruction: string;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ComputerNativeError("configuration", `${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ComputerNativeError("configuration", `${label} must be a non-negative integer.`);
  }
  return parsed;
}

function provider(value: string | undefined): ProviderName {
  const selected = value ?? "deterministic";
  if (selected !== "deterministic" && selected !== "openrouter") {
    throw new ComputerNativeError("configuration", `Unsupported provider '${selected}'. Use deterministic or openrouter.`);
  }
  return selected;
}

function deterministicBehavior(value: string | undefined): DeterministicBehavior {
  const selected = value ?? "success";
  if (selected !== "success" && selected !== "failure" && selected !== "timeout") {
    throw new ComputerNativeError("configuration", `Unsupported deterministic behavior '${selected}'.`);
  }
  return selected;
}

export function loadConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const selectedProvider = provider(overrides.provider ?? env.COMPUTER_NATIVE_PROVIDER);
  const selectedModel = overrides.model ?? env.COMPUTER_NATIVE_MODEL ??
    (selectedProvider === "deterministic" ? "deterministic/echo" : env.OPENROUTER_MODEL ?? "");
  if (selectedModel.trim().length === 0) {
    throw new ComputerNativeError("configuration", "An OpenRouter model is required. Set --model or OPENROUTER_MODEL.");
  }

  const apiKey = overrides.openRouterApiKey ?? env.OPENROUTER_API_KEY;
  if (selectedProvider === "openrouter" && (!apiKey || apiKey === "replace-me")) {
    throw new ComputerNativeError("configuration", "OpenRouter is selected but OPENROUTER_API_KEY is not configured.");
  }

  const timeoutMs = overrides.timeoutMs ?? positiveInteger(env.COMPUTER_NATIVE_TIMEOUT_MS, 30_000, "timeout");
  const deterministicDelayMs = overrides.deterministicDelayMs ?? nonNegativeInteger(env.COMPUTER_NATIVE_DETERMINISTIC_DELAY_MS, 0, "deterministic delay");
  const stateDir = expandHome(overrides.stateDir ?? env.COMPUTER_NATIVE_STATE_DIR ??
    path.join(os.homedir(), ".agent-harness-lab", "computer-native"));
  if (stateDir.trim().length === 0) {
    throw new ComputerNativeError("configuration", "The state directory cannot be empty.");
  }

  return {
    stateDir: path.resolve(stateDir),
    provider: selectedProvider,
    model: selectedModel,
    timeoutMs,
    deterministicBehavior: overrides.deterministicBehavior ?? deterministicBehavior(env.COMPUTER_NATIVE_DETERMINISTIC_BEHAVIOR),
    deterministicDelayMs,
    openRouterApiKey: selectedProvider === "openrouter" ? apiKey : undefined,
    initialInstruction: overrides.initialInstruction ?? DEFAULT_INITIAL_INSTRUCTION,
  };
}

export function safeConfigSummary(config: AppConfig): Readonly<Record<string, unknown>> {
  return {
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
    deterministicBehavior: config.provider === "deterministic" ? config.deterministicBehavior : undefined,
  };
}
