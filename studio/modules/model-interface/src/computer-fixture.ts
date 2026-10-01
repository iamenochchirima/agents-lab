import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import type { ModelCallResult, ModelInterfaceModule, ModelRequest, ModelUsage } from "./contract.js";

export const COMPUTER_SCENARIO_ID = "computer-click-round-trip" as const;
export const COMPUTER_SCENARIO_TASK = "Use the controlled computer page to click the Say hello button and report what changed.";
const CALL_ID = "computer-click-1";
const IDENTITY: ModuleIdentity = Object.freeze({ id: "computer-use-round-trip-fixture", version: "0.1.0" });
const UNKNOWN_USAGE: ModelUsage = Object.freeze({ inputTokens: null, outputTokens: null, totalTokens: null, basis: "unknown" });

/** A scripted Model Interface for the local controlled computer-action scenario. */
export function createComputerScenarioModel(): ModelInterfaceModule {
  return Object.freeze({
    identity: IDENTITY,
    async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
      if (signal.aborted) return failed(request, "cancelled", "The computer fixture request was cancelled.");
      if (request.model.provider !== "fixture" || request.model.name !== IDENTITY.id) {
        return failed(request, "invalid-request", "The computer fixture received a different model selection.");
      }
      if (findCurrentTask(request) !== COMPUTER_SCENARIO_TASK) {
        return failed(request, "invalid-request", "The computer fixture requires its fixed named-scenario task.");
      }

      const priorCall = request.messages.flatMap((message) => message.toolCalls ?? [])
        .find((call) => call.callId === CALL_ID && call.name === "computer.click");
      const priorResult = request.messages.find((message) => message.role === "tool" && message.toolCallId === CALL_ID);
      if (!priorCall && !priorResult) {
        if (!request.tools?.some((tool) => tool.name === "computer.click")) {
          return failed(request, "invalid-request", "The computer.click definition was missing from the first fixture request.");
        }
        return completed(request, {
          text: null,
          toolCalls: [{ callId: CALL_ID, name: "computer.click", arguments: { target: "say-hello" } }],
          finishReason: "tool_calls",
          providerDetail: { scenarioId: COMPUTER_SCENARIO_ID, phase: "computer-action", externalProviderCalled: false },
        });
      }

      if (!priorCall || !priorResult || priorResult.name !== "computer.click") {
        return failed(request, "invalid-request", "The continuation request did not contain a complete correlated computer action.");
      }
      if (!isRecord(priorCall.arguments) || priorCall.arguments.target !== "say-hello") {
        return failed(request, "invalid-request", "The computer action did not target the fixture button.");
      }
      let output: unknown;
      try {
        output = JSON.parse(priorResult.content ?? "null");
      } catch {
        return failed(request, "invalid-request", "The computer action result was not valid JSON text.");
      }
      if (!isRecord(output) || !isRecord(output.receipt) || output.receipt.status !== "completed"
        || !isRecord(output.verification) || output.verification.status !== "verified"
        || !isRecord(output.after) || !isRecord(output.after.content)
        || !Array.isArray(output.after.content.elements)
        || !isRecord(output.after.content.elements[0])
        || output.after.content.elements[0].text !== "Hello from the controlled page.") {
        return failed(request, "invalid-request", "Computer evidence did not show a completed and verified fixture change.");
      }
      if (signal.aborted) return failed(request, "cancelled", "The computer fixture request was cancelled.");
      return completed(request, {
        text: "I clicked the Say hello button; the page now says hello.",
        toolCalls: [],
        finishReason: "stop",
        providerDetail: { scenarioId: COMPUTER_SCENARIO_ID, phase: "final", externalProviderCalled: false },
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

function completed(request: ModelRequest, response: Omit<Extract<ModelCallResult, { readonly outcome: "completed" }> ["response"], "provider" | "usage">): ModelCallResult {
  return Object.freeze({
    outcome: "completed",
    response: Object.freeze({
      provider: Object.freeze({ provider: request.model.provider, model: request.model.name, adapter: IDENTITY,
        requestId: `computer-fixture:${request.scope.runId}:${response.finishReason}` }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
