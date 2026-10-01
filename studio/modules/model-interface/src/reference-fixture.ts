import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import type { ModelCallResult, ModelInterfaceModule, ModelRequest } from "./contract.js";
import { createReplayModelInterface } from "./replay.js";
import {
  CALCULATOR_SCENARIO_ID,
  CALCULATOR_SCENARIO_TASK,
  createCalculatorScenarioModel,
} from "./calculator-fixture.js";
import {
  COMPUTER_SCENARIO_ID,
  COMPUTER_SCENARIO_TASK,
  createComputerScenarioModel,
} from "./computer-fixture.js";

export const REFERENCE_MODEL_IDENTITY: ModuleIdentity = Object.freeze({ id: "deterministic-reference-model", version: "0.1.0" });

/**
 * One selected Model Interface baseline routes only the two exact controlled
 * scenario tasks to their scripted round trips. Other input uses diagnostic
 * replay. The fixtures never call an external model or network service.
 */
export function createReferenceModelInterface(config: unknown): ModelInterfaceModule {
  const replay = createReplayModelInterface(config);
  const calculator = createCalculatorScenarioModel();
  const computer = createComputerScenarioModel();
  return Object.freeze({
    identity: REFERENCE_MODEL_IDENTITY,
    async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
      const task = currentTask(request);
      if (task === CALCULATOR_SCENARIO_TASK) {
        return normalizeFixtureResult(await calculator.generate(withModel(request, "fixture", "calculator-round-trip-fixture"), signal), request);
      }
      if (task === COMPUTER_SCENARIO_TASK) {
        return normalizeFixtureResult(await computer.generate(withModel(request, "fixture", "computer-use-round-trip-fixture"), signal), request);
      }
      return normalizeFixtureResult(await replay.generate(withModel(request, "replay", "deterministic-replay-model"), signal), request);
    },
  });
}

function withModel(request: ModelRequest, provider: string, name: string): ModelRequest {
  return { ...request, model: { provider, name } };
}

function normalizeFixtureResult(result: ModelCallResult, request: ModelRequest): ModelCallResult {
  if (result.outcome === "failed") return result;
  return Object.freeze({
    outcome: "completed",
    response: Object.freeze({
      ...result.response,
      provider: Object.freeze({
        ...result.response.provider,
        provider: request.model.provider,
        model: request.model.name,
        adapter: REFERENCE_MODEL_IDENTITY,
      }),
    }),
  });
}

function currentTask(request: ModelRequest): string | undefined {
  for (const message of [...request.messages].reverse()) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(message.content);
      if (isRecord(parsed) && parsed.kind === "task" && typeof parsed.content === "string") return parsed.content;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const REFERENCE_MODEL_SCENARIOS = Object.freeze([
  { id: CALCULATOR_SCENARIO_ID, task: CALCULATOR_SCENARIO_TASK },
  { id: COMPUTER_SCENARIO_ID, task: COMPUTER_SCENARIO_TASK },
] as const);
