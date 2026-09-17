import assert from "node:assert/strict";
import test from "node:test";

import { FixedTokenCounter } from "../../src/capabilities/context/token-counter.js";
import {
  FullHistoryStrategy,
  InvalidContextStrategyParametersError,
  RelevanceRankedStrategy,
  SlidingWindowStrategy,
} from "../../src/studio/strategies/context-strategy.js";
import type { ContextMessage } from "../../src/capabilities/context/contracts.js";
import { ReplayModelAdapter } from "../../src/studio/adapters/replay-model.js";

const messages: readonly ContextMessage[] = [
  message("system-1", "system", "Follow the task instructions."),
  message("user-1", "user", "The account's support language is English."),
  message("assistant-1", "assistant", "Noted."),
  message("user-2", "user", "Please explain the invoice."),
  message("assistant-2", "assistant", "I will explain the line items."),
];

const input = {
  trialId: "trial-1",
  task: "What language should be used?",
  messages,
  contextWindowTokens: 100,
  budgetPolicy: {
    reservedOutputTokens: 10,
    safetyMarginTokens: 10,
    compactionThresholdPercent: 20,
  },
  tokenCounter: new FixedTokenCounter({
    "system-1": 10,
    "user-1": 10,
    "assistant-1": 10,
    "user-2": 10,
    "assistant-2": 10,
  }),
};

test("Full History retains the complete ordered context", () => {
  const result = new FullHistoryStrategy().assemble({
    ...input,
    strategy: { id: "full-history", version: "1", parameters: {} },
  });

  assert.deepEqual(result.retainedMessageIds, messages.map((message) => message.messageId));
  assert.deepEqual(result.omittedMessageIds, []);
  assert.equal(result.budget.inputTokens, 50);
  assert.equal(result.decision, "within-budget");
});

test("Sliding Window retains system messages and the newest non-system messages", () => {
  const result = new SlidingWindowStrategy().assemble({
    ...input,
    strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "2" } },
  });

  assert.deepEqual(result.retainedMessageIds, ["system-1", "user-2", "assistant-2"]);
  assert.deepEqual(result.omittedMessageIds, ["user-1", "assistant-1"]);
  assert.equal(result.budget.inputTokens, 30);
  assert.equal(result.decision, "within-budget");
});

test("Sliding Window rejects invalid parameters explicitly", () => {
  assert.throws(
    () => new SlidingWindowStrategy().assemble({
      ...input,
      strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "0" } },
    }),
    (error: unknown) => error instanceof InvalidContextStrategyParametersError,
  );
});

test("Relevance Ranked retains task-overlapping messages and restores source order", () => {
  const result = new RelevanceRankedStrategy().assemble({
    ...input,
    strategy: { id: "relevance-ranked", version: "1", parameters: { maxMessages: "2" } },
  });

  assert.deepEqual(result.retainedMessageIds, ["system-1", "user-1", "assistant-2"]);
  assert.deepEqual(result.omittedMessageIds, ["assistant-1", "user-2"]);
  assert.equal(result.budget.inputTokens, 30);
  assert.equal(result.decision, "within-budget");
});

test("both strategies reach the same replay result when the fixture fits the window", async () => {
  const shortMessages = messages.slice(0, 3);
  const common = {
    ...input,
    messages: shortMessages,
    contextWindowTokens: 100,
  };
  const full = new FullHistoryStrategy().assemble({
    ...common,
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  const sliding = new SlidingWindowStrategy().assemble({
    ...common,
    strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "2" } },
  });
  const model = new ReplayModelAdapter();
  const [fullResponse, slidingResponse] = await Promise.all([
    model.complete({
      task: common.task,
      messages: full.messages,
      requiredMessageId: "user-1",
      expectedAnswer: "English",
      seed: "seed-1",
    }),
    model.complete({
      task: common.task,
      messages: sliding.messages,
      requiredMessageId: "user-1",
      expectedAnswer: "English",
      seed: "seed-1",
    }),
  ]);

  assert.equal(full.decision, "within-budget");
  assert.equal(sliding.decision, "within-budget");
  assert.equal(fullResponse.output, "English");
  assert.equal(slidingResponse.output, fullResponse.output);
});

test("context strategies expose over-budget and unknown-token states explicitly", () => {
  const overBudget = new FullHistoryStrategy().assemble({
    ...input,
    contextWindowTokens: 60,
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  assert.equal(overBudget.budget.pressure, "exhausted");
  assert.equal(overBudget.decision, "over-budget");

  const unknownBudget = new FullHistoryStrategy().assemble({
    ...input,
    tokenCounter: { count: () => ({ tokens: null, quality: "unknown" as const, basis: "unknown-test" }) },
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  assert.equal(unknownBudget.budget.inputTokens, null);
  assert.equal(unknownBudget.decision, "unknown-budget");
});

function message(messageId: string, role: ContextMessage["role"], content: string): ContextMessage {
  return {
    schemaVersion: 1,
    messageId,
    sessionId: "session-1",
    sequence: Number(messageId.match(/\d+$/)?.[0] ?? 1),
    role,
    content,
    source: role === "system" ? "system" : "transcript",
    createdAt: "2026-09-16T00:00:00.000Z",
  };
}
