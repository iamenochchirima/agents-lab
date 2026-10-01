import type { JsonValue, ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import type { ModelCallResult, ModelInterfaceModule, ModelRequest, ModelUsage } from "./contract.js";

export const CALCULATOR_SCENARIO_ID = "calculator-round-trip" as const;
export const CALCULATOR_SCENARIO_TASK = "Calculate 19 + 23 with the calculator tool.";
const CALL_ID = "calculator-add-1";
const IDENTITY: ModuleIdentity = Object.freeze({ id: "calculator-round-trip-fixture", version: "0.1.0" });
const UNKNOWN_USAGE: ModelUsage = Object.freeze({ inputTokens: null, outputTokens: null, totalTokens: null, basis: "unknown" });

/**
 * Scripted Model Interface used only by the named Studio scenario. It emits one
 * known calculator call, then verifies the correlated call/result in the next
 * request before returning the fixed final response. It has no external effects.
 */
export function createCalculatorScenarioModel(): ModelInterfaceModule {
  return Object.freeze({
    identity: IDENTITY,
    async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
      if (signal.aborted) return failed(request, "cancelled", "The calculator fixture request was cancelled.");
      if (request.model.provider !== "fixture" || request.model.name !== "calculator-round-trip-fixture") {
        return failed(request, "invalid-request", "The calculator fixture received a different model selection.");
      }

      const currentTask = findCurrentTask(request);
      if (!currentTask || currentTask !== CALCULATOR_SCENARIO_TASK) {
        return failed(request, "invalid-request", "The calculator fixture requires its fixed named-scenario task.");
      }

      const priorCall = request.messages.flatMap((message) => message.toolCalls ?? [])
        .find((call) => call.callId === CALL_ID && call.name === "calculator.add");
      const priorResult = request.messages.find((message) => message.role === "tool" && message.toolCallId === CALL_ID);
      if (!priorCall && !priorResult) {
        if (!request.tools?.some((tool) => tool.name === "calculator.add")) {
          return failed(request, "invalid-request", "The calculator tool definition was missing from the first fixture request.");
        }
        return completed(request, {
          text: null,
          toolCalls: [{ callId: CALL_ID, name: "calculator.add", arguments: { left: 19, right: 23 } }],
          finishReason: "tool_calls",
          providerDetail: { scenarioId: CALCULATOR_SCENARIO_ID, phase: "tool-call", externalProviderCalled: false },
        });
      }

      if (!priorCall || !priorResult || priorResult.name !== "calculator.add") {
        return failed(request, "invalid-request", "The second fixture request did not contain a complete correlated calculator exchange.");
      }
      if (!isRecord(priorCall.arguments) || priorCall.arguments.left !== 19 || priorCall.arguments.right !== 23) {
        return failed(request, "invalid-request", "The calculator call arguments do not match this fixture.");
      }
      let output: unknown;
      try {
        output = JSON.parse(priorResult.content ?? "null");
      } catch {
        return failed(request, "invalid-request", "The calculator result was not valid JSON text.");
      }
      if (!isRecord(output) || output.sum !== 42) {
        return failed(request, "invalid-request", "The calculator result did not equal the fixture's expected sum.");
      }
      if (signal.aborted) return failed(request, "cancelled", "The calculator fixture request was cancelled.");
      return completed(request, {
        text: "19 + 23 = 42.",
        toolCalls: [],
        finishReason: "stop",
        providerDetail: { scenarioId: CALCULATOR_SCENARIO_ID, phase: "final", externalProviderCalled: false },
      });
    },
  });
}

function findCurrentTask(request: ModelRequest): string | undefined {
  for (const message of [...request.messages].reverse()) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    try {
      const envelope: unknown = JSON.parse(message.content);
      if (isRecord(envelope) && envelope.kind === "task" && typeof envelope.content === "string") return envelope.content;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function completed(request: ModelRequest, response: Omit<Extract<ModelCallResult, { readonly outcome: "completed" }>["response"], "provider" | "usage">): ModelCallResult {
  return Object.freeze({
    outcome: "completed",
    response: Object.freeze({
      provider: Object.freeze({ provider: request.model.provider, model: request.model.name, adapter: IDENTITY,
        requestId: `calculator-fixture:${request.scope.runId}:${response.finishReason}` }),
      ...response,
      usage: UNKNOWN_USAGE,
    }),
  });
}

function failed(request: ModelRequest, category: "invalid-request" | "cancelled", message: string): ModelCallResult {
  return Object.freeze({
    outcome: "failed",
    failure: Object.freeze({ category, message, retryable: false, dispatchOutcome: "not-sent", provider: request.model.provider }),
  });
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
