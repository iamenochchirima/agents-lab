import { appendFile } from "node:fs/promises";
import { OpenRouterRestateModel } from "./openrouter.js";
import type { ModelAdapter, ModelCallResult, ModelRequest } from "../contracts.js";

/**
 * Deterministic fixtures for automated tests and local failure exercises.
 * The product UI exposes OpenRouter only; this adapter is selected only by an
 * explicit fixture request and is never a fallback for a provider failure.
 */
export class FakeRestateModel implements ModelAdapter {
  async complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
    // Opt-in synthetic provider dispatch ledger survives worker replacement.
    // Never records prompts, tool arguments or credentials.
    if (process.env.AGENTLAB_X01_MODEL_ATTEMPTS_FILE) await appendFile(process.env.AGENTLAB_X01_MODEL_ATTEMPTS_FILE, JSON.stringify({ runId: input.runId, model: input.model, observedAt: new Date().toISOString() }) + "\n");
    if (signal.aborted) return cancelledResult();

    if (input.model === "fake-summary") return { kind: "success", output: "Completed synthetic tool observations. Source records retain the full call identities and results.", toolCalls: [], providerRequestId: null,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } };

    if (input.model === "fake-eval-behaviour") {
      const match = input.prompt.match(/\[eval-behaviour:([A-Za-z0-9_-]+)\]/);
      if (!match) throw new Error("A behaviour eval requires a bounded directive.");
      const directive = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as {
        action: "complete" | "tool" | "provider-error" | "malformed" | "slow" | "context";
        toolName?: string; input?: unknown; text?: string; delayMs?: number; timeoutMs?: number; marker?: string;
      };
      const messages = input.messages ?? [];
      const observation = { messages: JSON.parse(JSON.stringify(messages)), systemInstruction: input.systemInstruction, toolCalls: [] as { toolCallId: string; name: string; arguments: unknown }[] };
      if (directive.action === "provider-error" || directive.action === "malformed") {
        // Inject at the provider transport seam, then use the real native decoder.
        // No network is contacted and the fake credential is never retained.
        const malformed = directive.action === "malformed";
        const decoder = new OpenRouterRestateModel({ apiKey: "synthetic-parser-fixture", baseUrl: "http://synthetic-provider.invalid", fetchImpl: async () =>
          new Response(malformed ? "{malformed" : '{"error":{"message":"Controlled provider rejection."}}',
            { status: malformed ? 200 : 403, headers: { "content-type": "application/json" } }) });
        const result = await decoder.complete({ ...input, liveEval: false }, signal);
        return { ...result, evalObservation: { ...observation, faultKind: malformed ? "malformed" : "provider",
          ...(result.kind === "failure" ? { errorCode: result.code } : {}) } };
      }
      if (directive.action === "slow") {
        const timeout = directive.timeoutMs === undefined ? null : AbortSignal.timeout(Math.min(60_000, Math.max(1, directive.timeoutMs)));
        const operationSignal = timeout ? AbortSignal.any([signal, timeout]) : signal;
        try {
          await waitWithAbort(Math.min(60_000, Math.max(1, directive.delayMs ?? 10_000)), operationSignal);
        } catch (error) {
          if (!operationSignal.aborted) throw error;
          const code = timeout?.aborted ? "FAKE_MODEL_DEADLINE_EXCEEDED" : "MODEL_CANCELLED";
          return { kind: "failure", code, message: "The slow model operation observed its deadline or cancellation.",
            failureKind: timeout?.aborted ? "timeout" : "cancelled", retryable: false, requestSent: true,
            evalObservation: { ...observation, errorCode: code } };
        }
      }
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

    const hasToolResult = input.messages.some((message) => message.role === "tool");
    if (input.model === "fake-delay" || (input.model === "fake-tool-call-delay" && hasToolResult)) {
      // Keep this fixture long enough for the native cancellation exercise and
      // browser playground to observe an active run. It remains abortable.
      try {
        await waitWithAbort(input.model === "fake-tool-call-delay" ? 15_000 : 5_000, signal);
      } catch (error) {
        if (signal.aborted) return cancelledResult();
        throw error;
      }
    }

    if (input.model === "fake-failure") {
      return {
        kind: "failure",
        code: "FAKE_MODEL_FAILURE",
        message: "The deterministic fake model was instructed to fail.",
        failureKind: "provider",
        retryable: false,
        requestSent: false,
      };
    }

    if (input.model === "fake-unknown") {
      return {
        kind: "failure",
        code: "FAKE_MODEL_OUTCOME_UNKNOWN",
        message: "The fake model simulates a response whose outcome cannot be confirmed.",
        failureKind: "outcome_unknown",
        retryable: false,
        requestSent: true,
      };
    }

    if (input.model === "fake-timeout-after-dispatch") {
      return {
        kind: "failure",
        code: "FAKE_PROVIDER_TIMEOUT_AFTER_DISPATCH",
        message: "The deterministic adapter simulates a provider timeout after dispatch.",
        failureKind: "outcome_unknown",
        retryable: false,
        requestSent: true,
      };
    }

    if (input.model === "fake-context-overflow") {
      // Context summarization is a model operation too. Keep it deterministic
      // while making the first actual request fail with a provider-style,
      // safely retryable context rejection.
      if (input.runId.includes(":context:")) {
        return {
          kind: "success",
          output: "Earlier context summary.",
          toolCalls: [],
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        };
      }
      if (input.prompt === "seed context") {
        return {
          kind: "success",
          output: "Seed context response.",
          toolCalls: [],
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
        };
      }
      if (input.attempt === 1) {
        return {
          kind: "failure",
          code: "FAKE_CONTEXT_OVERFLOW",
          message: "The deterministic adapter simulates a context overflow.",
          failureKind: "provider",
          retryable: false,
          requestSent: true,
          contextOverflow: true,
        };
      }
      return {
        kind: "success",
        output: `Fake response after context recovery: ${input.prompt}`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 },
      };
    }

    if (input.model === "fake-pre-dispatch-retry" || (input.model === "fake-pre-dispatch-retry-once" && input.attempt === 1)) {
      return {
        kind: "failure",
        code: "FAKE_PRE_DISPATCH_RETRY",
        message: "The deterministic fake model failed before dispatch and may be retried safely.",
        failureKind: "pre_dispatch",
        retryable: true,
        requestSent: false,
      };
    }

    if (input.model === "fake-tool-call" || input.model === "fake-tool-call-delay") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return {
          kind: "success",
          output: null,
          toolCalls: [{
            toolCallId: "call-calculator-1",
            name: "calculator",
            arguments: { operation: "add", left: 17, right: 25 },
          }],
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        };
      }
      return {
        kind: "success",
        output: `The calculator returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-mcp-tool-call-delay") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return toolFixtureCall("call-mcp-fixture-lookup-1", "mcp_fixture_lookup", { key: "alpha" });
      }
      try {
        await waitWithAbort(15_000, signal);
      } catch (error) {
        if (signal.aborted) return cancelledResult();
        throw error;
      }
      return {
        kind: "success",
        output: `The local MCP fixture returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-connected-tool") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return toolFixtureCall("call-fixture-lookup-1", "fixture_lookup", { key: "alpha" });
      }
      return {
        kind: "success",
        output: `The local fixture returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-mcp-connected-tool") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return toolFixtureCall("call-mcp-fixture-lookup-1", "mcp_fixture_lookup", { key: "alpha" });
      }
      return {
        kind: "success",
        output: `The local MCP fixture returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-connected-write") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return toolFixtureCall("call-fixture-write-1", "fixture_write", { key: "alpha", value: "updated" });
      }
      return {
        kind: "success",
        output: `The local fixture write returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-tool-malformed") {
      return toolFixtureCall("call-malformed-1", "calculator", { operation: "add", left: 20 });
    }

    if (input.model === "fake-tool-unknown") {
      return toolFixtureCall("call-unknown-1", "unknown_tool", { value: 1 });
    }

    if (input.model === "fake-tool-duplicate") {
      return {
        kind: "success",
        output: null,
        toolCalls: [
          { toolCallId: "call-duplicate-1", name: "calculator", arguments: { operation: "add", left: 1, right: 1 } },
          { toolCallId: "call-duplicate-1", name: "calculator", arguments: { operation: "add", left: 2, right: 2 } },
        ],
        providerRequestId: null,
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      };
    }

    if (input.model === "fake-tool-loop") {
      return toolFixtureCall(`call-loop-${input.round}`, "calculator", { operation: "add", left: input.round, right: 1 });
    }

    if (input.model === "fake-context") {
      const remembered = input.messages.some((message) => typeof message.content === "string" && message.content.includes("conformance-4318"));
      return {
        kind: "success",
        output: /^Remember\b/.test(input.prompt) ? "Stored the test value." : remembered ? "conformance-4318" : "The test value was not present in the context.",
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 16, outputTokens: 5, totalTokens: 21 },
      };
    }

    if (
      input.model !== "fake-success" &&
      input.model !== "fake-delay" &&
      input.model !== "fake-tool-call-delay" &&
      input.model !== "fake-timeout-after-dispatch" &&
      input.model !== "fake-pre-dispatch-retry-once" &&
      input.model !== "fake-context" &&
      input.model !== "fake-context-overflow"
    ) {
      return {
        kind: "failure",
        code: "UNKNOWN_FAKE_MODEL",
        message: `Unknown fake model: ${input.model}`,
        failureKind: "configuration",
        retryable: false,
        requestSent: false,
      };
    }

    return {
      kind: "success",
      output: `Fake response: ${input.prompt}`,
      toolCalls: [],
      providerRequestId: null,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  }
}

function waitWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The fake model was cancelled.", "AbortError"));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cancelledResult(): ModelCallResult {
  return {
    kind: "failure",
    code: "MODEL_CANCELLED",
    message: "The model request was cancelled before it started.",
    failureKind: "cancelled",
    retryable: false,
    requestSent: false,
  };
}

function toolFixtureCall(toolCallId: string, name: string, argumentsValue: unknown): ModelCallResult {
  return {
    kind: "success",
    output: null,
    toolCalls: [{ toolCallId, name, arguments: argumentsValue }],
    providerRequestId: null,
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  };
}
