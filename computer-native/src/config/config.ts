import os from "node:os";
import path from "node:path";
import { ComputerNativeError } from "../runtime/errors.js";
import type { DeterministicBehavior, ProviderName } from "../runtime/contracts.js";

export const DEFAULT_INITIAL_INSTRUCTION =
  "You are Computer Native, a concise and helpful terminal assistant. Use the available read-only workspace tools when they help answer the user's request. Never claim to have changed files or run tools you did not run.";

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_MAX_DIRECTORY_ENTRIES = 200;
export const DEFAULT_MAX_TOOL_OUTPUT_BYTES = 32 * 1024;
export const DEFAULT_MAX_TOOL_DURATION_MS = 10_000;
export const DEFAULT_MAX_MODEL_TOOL_ROUNDS = 4;
export const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 12_000;

export interface ConfigOverrides {
  readonly stateDir?: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly firstEventTimeoutMs?: number;
  readonly workspaceRoot?: string;
  readonly maxFileBytes?: number;
  readonly maxDirectoryEntries?: number;
  readonly maxToolOutputBytes?: number;
  readonly maxToolDurationMs?: number;
  readonly maxModelToolRounds?: number;
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
  readonly firstEventTimeoutMs: number;
  readonly workspaceRoot: string;
  readonly maxFileBytes: number;
  readonly maxDirectoryEntries: number;
  readonly maxToolOutputBytes: number;
  readonly maxToolDurationMs: number;
  readonly maxModelToolRounds: number;
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
  const firstEventTimeoutMs = overrides.firstEventTimeoutMs ?? positiveInteger(env.COMPUTER_NATIVE_FIRST_EVENT_TIMEOUT_MS, DEFAULT_FIRST_EVENT_TIMEOUT_MS, "first event timeout");
  const deterministicDelayMs = overrides.deterministicDelayMs ?? nonNegativeInteger(env.COMPUTER_NATIVE_DETERMINISTIC_DELAY_MS, 0, "deterministic delay");
  const stateDir = expandHome(overrides.stateDir ?? env.COMPUTER_NATIVE_STATE_DIR ??
    path.join(os.homedir(), ".agent-harness-lab", "computer-native"));
  if (stateDir.trim().length === 0) {
    throw new ComputerNativeError("configuration", "The state directory cannot be empty.");
  }
  const workspaceRoot = expandHome(overrides.workspaceRoot ?? env.COMPUTER_NATIVE_WORKSPACE_ROOT ?? process.cwd());
  if (workspaceRoot.trim().length === 0) {
    throw new ComputerNativeError("configuration", "The workspace root cannot be empty.");
  }

  return {
    stateDir: path.resolve(stateDir),
    provider: selectedProvider,
    model: selectedModel,
    timeoutMs,
    firstEventTimeoutMs,
    workspaceRoot: path.resolve(workspaceRoot),
    maxFileBytes: overrides.maxFileBytes ?? positiveInteger(env.COMPUTER_NATIVE_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, "max file bytes"),
    maxDirectoryEntries: overrides.maxDirectoryEntries ?? positiveInteger(env.COMPUTER_NATIVE_MAX_DIRECTORY_ENTRIES, DEFAULT_MAX_DIRECTORY_ENTRIES, "max directory entries"),
    maxToolOutputBytes: overrides.maxToolOutputBytes ?? positiveInteger(env.COMPUTER_NATIVE_MAX_TOOL_OUTPUT_BYTES, DEFAULT_MAX_TOOL_OUTPUT_BYTES, "max tool output bytes"),
    maxToolDurationMs: overrides.maxToolDurationMs ?? positiveInteger(env.COMPUTER_NATIVE_MAX_TOOL_DURATION_MS, DEFAULT_MAX_TOOL_DURATION_MS, "max tool duration"),
    maxModelToolRounds: overrides.maxModelToolRounds ?? positiveInteger(env.COMPUTER_NATIVE_MAX_MODEL_TOOL_ROUNDS, DEFAULT_MAX_MODEL_TOOL_ROUNDS, "max model tool rounds"),
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
    firstEventTimeoutMs: config.firstEventTimeoutMs,
    workspaceRoot: config.workspaceRoot,
    maxFileBytes: config.maxFileBytes,
    maxDirectoryEntries: config.maxDirectoryEntries,
    maxToolOutputBytes: config.maxToolOutputBytes,
    maxToolDurationMs: config.maxToolDurationMs,
    maxModelToolRounds: config.maxModelToolRounds,
    deterministicBehavior: config.provider === "deterministic" ? config.deterministicBehavior : undefined,
  };
}
