import { appendFile } from "node:fs/promises";
import { OpenRouterModelAdapter } from "./openrouter.js";
import type { ModelAdapter, ModelCallResult, ModelRequestInput } from "../contracts.js";

const FIXTURE_DELAY_MS = 60_000;

/**
 * Deterministic fixtures make lifecycle and failure semantics testable without
 * turning a provider outage into a flaky test or spending model tokens.
 */
export class FakeModelAdapter implements ModelAdapter {
  async complete(input: ModelRequestInput, signal: AbortSignal): Promise<ModelCallResult> {
    // Opt-in synthetic provider dispatch ledger survives worker replacement.
    // Never records prompts, tool arguments or credentials.
    if (process.env.AGENTLAB_X01_MODEL_ATTEMPTS_FILE) await appendFile(process.env.AGENTLAB_X01_MODEL_ATTEMPTS_FILE, JSON.stringify({ runId: input.runId, model: input.model, observedAt: new Date().toISOString() }) + "\n");
    if (input.model === "fake-summary") return { kind: "success", output: "Completed synthetic tool observations. Source records retain the full call identities and results.", toolCalls: [], providerRequestId: null,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };

    if (input.model === "fake-eval-behaviour") {
      const match = input.prompt.match(/\[eval-behaviour:([A-Za-z0-9_-]+)\]/);
      if (!match) throw new Error("A behaviour eval requires a bounded directive.");
      const directive = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as {
        action: "complete" | "tool" | "provider-error" | "malformed" | "slow" | "context";
        toolName?: string; input?: unknown; text?: string; delayMs?: number; marker?: string;
      };
      const messages = input.messages ?? [];
      const observation = { messages: JSON.parse(JSON.stringify(messages)), systemInstruction: input.systemInstruction, toolCalls: [] as { toolCallId: string; name: string; arguments: unknown }[] };
      if (directive.action === "provider-error" || directive.action === "malformed") {
        // Inject at the provider transport seam, then use the real native decoder.
        // No network is contacted and the fake credential is never retained.
        const malformed = directive.action === "malformed";
        const decoder = new OpenRouterModelAdapter({ apiKey: "synthetic-parser-fixture", fetchImplementation: async () =>
          new Response(malformed ? "{malformed" : '{"error":{"message":"Controlled provider rejection."}}',
            { status: malformed ? 200 : 403, headers: { "content-type": "application/json" } }) });
        const result = await decoder.complete({ ...input, liveEval: false }, signal);
        return { ...result, evalObservation: { ...observation, faultKind: malformed ? "malformed" : "provider",
          ...(result.kind === "failure" ? { errorCode: result.code } : {}) } };
      }
      if (directive.action === "slow") await cancellableDelay(Math.min(60_000, Math.max(1, directive.delayMs ?? 10_000)), signal);
      const feedback = [...messages].reverse().find(message => message.role === "tool" && message.toolCallId === "eval-behaviour-call-1");
      if (directive.action === "tool" && !feedback) {
        const toolCalls = [{ toolCallId: "eval-behaviour-call-1", name: directive.toolName ?? "calculator", arguments: directive.input ?? {} }];
        return { kind: "success", output: null, toolCalls, providerRequestId: null,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null }, evalObservation: { ...observation, toolCalls } };
      }
      // Context fixtures inspect retained messages, never the hidden directive marker.
      const retained = messages.filter(message => message.role === "user").map(message => (message.content ?? "").replace(/\[eval-behaviour:[A-Za-z0-9_-]+\]/g, "")).join("\n");
      const output = directive.action === "context" ? (directive.marker && retained.includes(directive.marker) ? directive.marker : "No retained marker.")
        : directive.action === "tool" ? `Tool feedback: ${feedback?.content}` : directive.text ?? "Behaviour eval completed.";
      return { kind: "success", output, toolCalls: [], providerRequestId: null,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null }, evalObservation: { ...observation, output } };
    }

    if (["fake-eval-completion", "fake-eval-tool", "fake-eval-context", "fake-eval-loop"].includes(input.model)) {
      const messages = input.messages ?? [];
      const toolResult = [...messages].reverse().find((message) => message.role === "tool");
      const toolCalls = input.model === "fake-eval-loop" || (input.model === "fake-eval-tool" && !toolResult)
        ? [{ toolCallId: `eval-calculator-${messages.filter((message) => message.role === "tool").length + 1}`,
            name: "calculator", arguments: { operation: "add", left: 17, right: 25 } }]
        : [];
      const output = toolCalls.length > 0 ? null
        : input.model === "fake-eval-tool" ? String(JSON.parse(toolResult?.content ?? "null")?.value ?? "Missing tool result.")
        : input.model === "fake-eval-context" ? input.prompt.startsWith("Remember") ? "Stored the test value."
          : messages.some((message) => message.role === "user" && message.content.includes("conformance-4318"))
            ? "conformance-4318" : "The test value was not present in the context."
        : "Baseline eval completed.";
      return {
        kind: "success", output, toolCalls, providerRequestId: null,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        evalObservation: { messages: JSON.parse(JSON.stringify(messages)), systemInstruction: input.systemInstruction, toolCalls },
      };
    }

    switch (input.model) {
      case "fake-success":
        return success(input, `Fake response: ${input.prompt}`);
      case "fake-pre-dispatch-retry":
        return input.attemptNumber === 1
          ? preDispatchFailure("FAKE_PRE_DISPATCH", "The deterministic adapter failed before dispatch.")
          : success(input, `Fake response after retry: ${input.prompt}`);
      case "fake-pre-dispatch-failure":
        return preDispatchFailure("FAKE_PRE_DISPATCH", "The deterministic adapter failed before dispatch.");
      case "fake-ambiguous":
        return {
          kind: "failure",
          failureKind: "outcome_unknown",
          code: "FAKE_AMBIGUOUS_OUTCOME",
          message: "The deterministic adapter simulates a lost acknowledgement after dispatch.",
          requestSent: true,
        };
      case "fake-provider-failure":
        return {
          kind: "failure",
          failureKind: "provider",
          code: "FAKE_PROVIDER_FAILURE",
          message: "The deterministic adapter simulates a provider-declared failure.",
          requestSent: true,
        };
      case "fake-context-overflow":
        // Context preparation uses the same adapter. Keep its summary call
        // deterministic while making the first actual model request report a
        // provider-style overflow so the workflow recovery path is testable.
        if (input.runId.includes(":context:")) return success(input, "Earlier context summary.");
        if (input.prompt === "seed context") return success(input, "Seed context response.");
        return input.attemptNumber === 1
          ? {
              kind: "failure",
              failureKind: "provider",
              code: "FAKE_CONTEXT_OVERFLOW",
              message: "The deterministic adapter simulates a context overflow.",
              requestSent: true,
            }
          : success(input, `Fake response after context recovery: ${input.prompt}`);
      case "fake-context": {
        const remembered = input.messages?.some((message) => typeof message.content === "string" && message.content.includes("conformance-4318")) ?? false;
        return success(input, input.prompt.startsWith("Remember")
          ? "Stored the test value."
          : remembered
            ? "conformance-4318"
            : "The test value was not present in the context.");
      }
      case "fake-tool-call": {
        const toolResult = input.messages?.find((message) => message.role === "tool");
        if (!toolResult || toolResult.role !== "tool") {
          return {
            kind: "success",
            output: null,
            toolCalls: [{ toolCallId: "call-calculator-1", name: "calculator", arguments: { operation: "add", left: 17, right: 25 } }],
            providerRequestId: `fake-${input.attemptId}`,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        }
        return success(input, `The calculator returned ${toolResult.content}.`);
      }
      case "fake-connected-tool": {
        const toolResult = input.messages?.find((message) => message.role === "tool");
        if (!toolResult || toolResult.role !== "tool") {
          return {
            kind: "success",
            output: null,
            toolCalls: [{ toolCallId: "call-fixture-lookup-1", name: "fixture_lookup", arguments: { key: "alpha" } }],
            providerRequestId: `fake-${input.attemptId}`,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        }
        return success(input, `The local fixture returned ${toolResult.content}.`);
      }
      case "fake-mcp-connected-tool": {
        const toolResult = input.messages?.find((message) => message.role === "tool");
        if (!toolResult || toolResult.role !== "tool") {
          return {
            kind: "success",
            output: null,
            toolCalls: [{ toolCallId: "call-mcp-fixture-lookup-1", name: "mcp_fixture_lookup", arguments: { key: "alpha" } }],
            providerRequestId: `fake-${input.attemptId}`,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        }
        return success(input, `The local MCP fixture returned ${toolResult.content}.`);
      }
      case "fake-mcp-tool-call-delay": {
        const toolResult = input.messages?.find((message) => message.role === "tool");
        if (!toolResult || toolResult.role !== "tool") {
          return {
            kind: "success",
            output: null,
            toolCalls: [{ toolCallId: "call-mcp-fixture-lookup-1", name: "mcp_fixture_lookup", arguments: { key: "alpha" } }],
            providerRequestId: `fake-${input.attemptId}`,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        }
        await cancellableDelay(15_000, signal);
        return success(input, `The local MCP fixture returned ${toolResult.content}.`);
      }
      case "fake-connected-write": {
        const toolResult = input.messages?.find((message) => message.role === "tool");
        if (!toolResult || toolResult.role !== "tool") {
          return {
            kind: "success",
            output: null,
            toolCalls: [{ toolCallId: "call-fixture-write-1", name: "fixture_write", arguments: { key: "alpha", value: "updated" } }],
            providerRequestId: `fake-${input.attemptId}`,
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          };
        }
        return success(input, `The local fixture write returned ${toolResult.content}.`);
      }
      case "fake-timeout":
      case "fake-cancel":
        await cancellableDelay(FIXTURE_DELAY_MS, signal);
        return success(input, `Fake delayed response: ${input.prompt}`);
      default:
        return {
          kind: "failure",
          failureKind: "configuration",
          code: "UNKNOWN_FAKE_MODEL",
          message: `Unknown fake model: ${input.model}`,
          requestSent: false,
        };
    }
  }
}

function success(input: ModelRequestInput, output: string): ModelCallResult {
  return {
    kind: "success",
    output,
    providerRequestId: `fake-${input.attemptId}`,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function preDispatchFailure(code: string, message: string): ModelCallResult {
  return { kind: "failure", failureKind: "pre_dispatch", code, message, requestSent: false };
}

function cancellableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Operation cancelled."));
      return;
    }

    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation cancelled."));
      },
      { once: true },
    );
  });
}
