import type { ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseControlConfig } from "./config.js";
import {
  ControlPortError,
  type ControlDeliveryResult,
  type ControlModelResponse,
  type ControlModule,
  type ControlPorts,
  type ControlResult,
  type ControlTask,
  type ControlToolCall,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "bounded-single-turn-control", version: "0.2.0" });

/**
 * Create a stateless Control implementation for one user task. Model/tool work
 * is bounded by config; tools run serially, and uncertain tool outcomes stop
 * the run so Control cannot trigger a duplicate action on a later model call.
 */
export function createSingleTurnControl(config: unknown = {}): ControlModule {
  const parsedConfig = parseControlConfig(config);

  return Object.freeze({
    identity: IDENTITY,
    async run(
      input: { readonly scope: RunScope; readonly task: ControlTask },
      ports: ControlPorts,
      signal: AbortSignal,
    ): Promise<ControlResult> {
      validateRun(input, ports, signal);
      assertNotAborted(signal, "Control was cancelled before the run began.");

      let modelCalls = 0;
      let toolCalls = 0;
      let observations = 0;

      while (modelCalls < parsedConfig.maxModelCalls) {
        const turn = await invokePort(signal, "Control was cancelled before model-turn preparation.", () =>
          ports.prepareModelTurn({ scope: input.scope, task: input.task }, signal));
        validatePreparedTurn(turn);

        const response = await invokePort(signal, "Control was cancelled before model generation.", () =>
          ports.generate({ scope: input.scope, turn }, signal));
        validateModelResponse(response);
        modelCalls += 1;

        await invokePort(signal, "Control was cancelled before recording the model response.", () =>
          ports.recordObservation({ scope: input.scope, observation: { kind: "model-response", response } }, signal));
        observations += 1;

        if (response.toolCalls.length === 0) {
          if (typeof response.text !== "string" || response.text.trim().length === 0) {
            throw new ControlPortError("invalid-transition", "The model finished without text or a tool call.");
          }

          const delivery = await invokePort(signal, "Control was cancelled before final delivery.", () =>
            ports.deliverFinal({ scope: input.scope, text: response.text as string }, signal));
          validateDeliveryResult(delivery);
          await invokePort(signal, "Control was cancelled before recording the delivery result.", () =>
            ports.recordObservation({ scope: input.scope, observation: { kind: "delivery-result", result: delivery } }, signal));
          observations += 1;

          return {
            termination: delivery.outcome === "committed"
              ? "model-finished"
              : delivery.outcome === "rejected"
                ? "delivery-rejected"
                : "delivery-uncertain",
            finalText: response.text,
            modelCalls,
            toolCalls,
            observations,
          };
        }

        if (modelCalls >= parsedConfig.maxModelCalls) {
          throw new ControlPortError(
            "budget-exhausted",
            `The model requested tool work after the ${parsedConfig.maxModelCalls}-call limit left no call to continue the turn.`,
          );
        }
        if (toolCalls + response.toolCalls.length > parsedConfig.maxToolCalls) {
          throw new ControlPortError(
            "budget-exhausted",
            `The model requested ${response.toolCalls.length} tool calls with only ${parsedConfig.maxToolCalls - toolCalls} remaining.`,
          );
        }

        for (const call of response.toolCalls) {
          assertNotAborted(signal, "Control was cancelled before tool execution.");
          toolCalls += 1;
          const result = await invokePort(signal, "Control was cancelled before tool execution.", () =>
            ports.executeTool({ scope: input.scope, call }, signal));
          await invokePort(signal, "Control was cancelled before recording the tool result.", () =>
            ports.recordObservation({ scope: input.scope, observation: { kind: "tool-result", result } }, signal));
          observations += 1;

          if (result.outcome === "uncertain") {
            throw new ControlPortError(
              "invalid-transition",
              `Tool call ${JSON.stringify(call.callId)} has an uncertain outcome; Control stopped before another model call.`,
            );
          }
          if (result.outcome === "rejected") {
            throw new ControlPortError(
              "invalid-transition",
              `Tool call ${JSON.stringify(call.callId)} was rejected; Control stopped before another model call.`,
            );
          }
        }
      }

      throw new ControlPortError("budget-exhausted", `Control reached the ${parsedConfig.maxModelCalls}-call model limit.`);
    },
  });
}

function validateRun(
  input: { readonly scope: RunScope; readonly task: ControlTask },
  ports: ControlPorts,
  signal: AbortSignal,
): void {
  if (!input || typeof input !== "object" || !input.scope || typeof input.scope.runId !== "string" || input.scope.runId.length === 0) {
    throw new TypeError("Control input requires a non-empty runId.");
  }
  if (!input.task || typeof input.task.prompt !== "string" || input.task.prompt.trim().length === 0) {
    throw new TypeError("Control task requires non-empty prompt text.");
  }
  if (!ports || typeof ports.prepareModelTurn !== "function" || typeof ports.generate !== "function"
    || typeof ports.executeTool !== "function" || typeof ports.recordObservation !== "function"
    || typeof ports.deliverFinal !== "function") {
    throw new TypeError("Control requires all five ports, including executeTool for explicit handling of model tool calls.");
  }
  if (!signal || typeof signal.aborted !== "boolean") throw new TypeError("Control requires an AbortSignal.");
}

function validatePreparedTurn(value: unknown): asserts value is Awaited<ReturnType<ControlPorts["prepareModelTurn"]>> {
  if (!value || typeof value !== "object") {
    throw new ControlPortError("module-failed", "Model-turn preparation returned no turn.");
  }
  const turn = value as { model?: unknown; messages?: unknown; parameters?: unknown };
  if (!turn.model || typeof turn.model !== "object" || !Array.isArray(turn.messages)
    || !turn.parameters || typeof turn.parameters !== "object" || Array.isArray(turn.parameters)) {
    throw new ControlPortError("module-failed", "Model-turn preparation returned an invalid model, messages, or parameters value.");
  }
}

function validateModelResponse(value: unknown): asserts value is ControlModelResponse {
  if (!value || typeof value !== "object") throw new ControlPortError("module-failed", "Model generation returned no response.");
  const response = value as { text?: unknown; toolCalls?: unknown; finishReason?: unknown };
  if ((response.text !== null && typeof response.text !== "string") || !Array.isArray(response.toolCalls)
    || typeof response.finishReason !== "string") {
    throw new ControlPortError("module-failed", "Model generation returned an invalid response shape.");
  }
  const callIds = new Set<string>();
  for (const entry of response.toolCalls) {
    const call = entry as Partial<ControlToolCall> | null;
    if (!call || typeof call.callId !== "string" || call.callId.trim().length === 0
      || typeof call.name !== "string" || call.name.trim().length === 0 || !isJsonValue(call.arguments)) {
      throw new ControlPortError("module-failed", "Model generation returned a malformed tool call.");
    }
    if (callIds.has(call.callId)) throw new ControlPortError("module-failed", `Model generation returned duplicate tool call ID ${JSON.stringify(call.callId)}.`);
    callIds.add(call.callId);
  }
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function validateDeliveryResult(value: unknown): asserts value is ControlDeliveryResult {
  if (!value || typeof value !== "object" || !["committed", "rejected", "uncertain"].includes((value as ControlDeliveryResult).outcome)) {
    throw new ControlPortError("module-failed", "Final delivery returned an invalid receipt.");
  }
}

async function invokePort<T>(signal: AbortSignal, cancellationMessage: string, call: () => Promise<T>): Promise<T> {
  assertNotAborted(signal, cancellationMessage);
  const result = await call();
  assertNotAborted(signal, cancellationMessage);
  return result;
}

function assertNotAborted(signal: AbortSignal, message: string): void {
  if (!signal.aborted) return;
  const error = new Error(message);
  error.name = "AbortError";
  throw error;
}
