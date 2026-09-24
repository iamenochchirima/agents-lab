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

test("Sliding Window can opt into complete source-group retention", () => {
  const groupedMessages = [
    message("system-1", "system", "Follow the task instructions."),
    { ...message("tool-call", "assistant", "call tool"), groupId: "tool-round", source: "tools" as const },
    { ...message("tool-result", "tool", "tool result"), groupId: "tool-round", source: "tools" as const },
    { ...message("active", "user", "answer now"), groupId: "active-turn" },
  ];
  const result = new SlidingWindowStrategy().assemble({
    ...input,
    messages: groupedMessages,
    strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "1", groupAtomic: "true", recentGroups: "1" } },
  });
  assert.equal(result.retainedMessageIds.includes("tool-call"), false);
  assert.equal(result.retainedMessageIds.includes("tool-result"), false);
  assert.equal(result.retainedMessageIds.includes("active"), true);
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

test("the Context boundary fixture preserves source provenance and tool grouping", () => {
  const boundary = contextBoundaryInput();
  const full = new FullHistoryStrategy().assemble({
    ...boundary,
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  const sliding = new SlidingWindowStrategy().assemble({
    ...boundary,
    strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
  });
  const ranked = new RelevanceRankedStrategy().assemble({
    ...boundary,
    strategy: { id: "relevance-ranked", version: "1", parameters: { maxMessages: "4" } },
  });

  assert.deepEqual(full.messages.map((message) => message.messageId), boundary.messages.map((message) => message.messageId));
  const memoryMessage = full.messages.find((message) => message.source === "memory");
  assert.equal(memoryMessage?.metadata?.memoryRecordId, "memory-boundary-language");
  assert.equal(memoryMessage?.metadata?.memoryTrust, "retrieved-untrusted");
  assert.deepEqual(
    full.messages.filter((message) => message.groupId === "tool-round-1").map((message) => message.messageId),
    ["boundary-tool-call", "boundary-tool-result"],
  );

  for (const result of [sliding, ranked]) {
    for (const retained of result.messages) {
      const source = boundary.messages.find((message) => message.messageId === retained.messageId);
      assert.ok(source);
      assert.deepEqual(retained.metadata, source.metadata);
      assert.equal(retained.groupId, source.groupId);
    }
  }
});

test("the Context boundary fixture makes relevance ties and source order reproducible", () => {
  const boundary = contextBoundaryInput();
  const strategy = { id: "relevance-ranked", version: "1", parameters: { maxMessages: "3" } } as const;
  const first = new RelevanceRankedStrategy().assemble({ ...boundary, strategy });
  const second = new RelevanceRankedStrategy().assemble({ ...boundary, strategy });

  assert.deepEqual(first.retainedMessageIds, second.retainedMessageIds);
  assert.deepEqual(first.messages.map((message) => message.sequence), [0, 5, 1, 4, 6]);
  assert.deepEqual(first.omittedMessageIds, ["boundary-transcript-recent", "boundary-tool-call", "boundary-active-assistant"]);
  assert.equal(first.messages.find((message) => message.messageId === "boundary-transcript-old")?.metadata?.sourceClass, "transcript");
});

test("the Context boundary fixture has valid, non-overlapping source groups", () => {
  const boundary = contextBoundaryInput();
  const messageIds = boundary.messages.map((message) => message.messageId);
  assert.equal(new Set(messageIds).size, messageIds.length);

  const groups = new Map<string, string[]>();
  for (const message of boundary.messages) {
    if (!message.groupId) continue;
    const group = groups.get(message.groupId) ?? [];
    group.push(message.messageId);
    groups.set(message.groupId, group);
  }
  assert.deepEqual(groups.get("tool-round-1"), ["boundary-tool-call", "boundary-tool-result"]);
  assert.equal(groups.get("conversation-3")?.length, 2);
  assert.equal(groups.size, 5);
});

test("adding boundary metadata does not change existing strategy decisions", () => {
  const metadataMessages = messages.map((message, index) => ({
    ...message,
    groupId: `compatibility-group-${Math.floor(index / 2)}`,
    metadata: { sourceClass: message.role === "system" ? "instruction" : "transcript", trust: "trusted" },
  }));
  const strategies = [
    { id: "full-history", version: "1", parameters: {} },
    { id: "sliding-window", version: "1", parameters: { recentMessages: "2" } },
    { id: "relevance-ranked", version: "1", parameters: { maxMessages: "2" } },
  ] as const;

  for (const strategy of strategies) {
    const implementation = strategy.id === "full-history"
      ? new FullHistoryStrategy()
      : strategy.id === "sliding-window"
        ? new SlidingWindowStrategy()
        : new RelevanceRankedStrategy();
    const withoutMetadata = implementation.assemble({ ...input, strategy });
    const withMetadata = implementation.assemble({ ...input, messages: metadataMessages, strategy });
    assert.deepEqual(withMetadata.retainedMessageIds, withoutMetadata.retainedMessageIds, strategy.id);
    assert.deepEqual(withMetadata.omittedMessageIds, withoutMetadata.omittedMessageIds, strategy.id);
    assert.deepEqual(withMetadata.budget, withoutMetadata.budget, strategy.id);
    assert.equal(withMetadata.summarizedMessageIds.length, 0, strategy.id);
  }
});

test("all current Context strategies replay the boundary fixture deterministically", () => {
  const boundary = contextBoundaryInput();
  const strategies = [
    { implementation: new FullHistoryStrategy(), strategy: { id: "full-history", version: "1", parameters: {} } },
    { implementation: new SlidingWindowStrategy(), strategy: { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } } },
    { implementation: new RelevanceRankedStrategy(), strategy: { id: "relevance-ranked", version: "1", parameters: { maxMessages: "4" } } },
  ] as const;

  for (const entry of strategies) {
    const first = entry.implementation.assemble({ ...boundary, strategy: entry.strategy });
    const second = entry.implementation.assemble({ ...boundary, strategy: entry.strategy });
    assert.deepEqual(
      {
        retained: first.retainedMessageIds,
        omitted: first.omittedMessageIds,
        summarized: first.summarizedMessageIds,
        budget: first.budget,
        decision: first.decision,
      },
      {
        retained: second.retainedMessageIds,
        omitted: second.omittedMessageIds,
        summarized: second.summarizedMessageIds,
        budget: second.budget,
        decision: second.decision,
      },
      entry.strategy.id,
    );
    assert.deepEqual(first.summarizedMessageIds, [], entry.strategy.id);
  }
});

test("the Context boundary fixture exposes exact pressure and unknown-token states", () => {
  const boundary = contextBoundaryInput();
  const overBudget = new FullHistoryStrategy().assemble({
    ...boundary,
    contextWindowTokens: 48,
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  const unknownBudget = new FullHistoryStrategy().assemble({
    ...boundary,
    tokenCounter: { count: () => ({ tokens: null, quality: "unknown" as const, basis: "boundary-unknown" }) },
    strategy: { id: "full-history", version: "1", parameters: {} },
  });

  assert.equal(overBudget.budget.quality, "exact");
  assert.equal(overBudget.budget.pressure, "exhausted");
  assert.equal(overBudget.decision, "over-budget");
  assert.equal(unknownBudget.budget.inputTokens, null);
  assert.equal(unknownBudget.budget.pressure, "unknown");
  assert.equal(unknownBudget.decision, "unknown-budget");
});

function contextBoundaryInput() {
  const boundaryMessages: readonly ContextMessage[] = [
    boundaryMessage("boundary-system", "system", "Keep account data private.", "system", undefined, { sourceClass: "instruction", trust: "trusted" }),
    boundaryMessage("boundary-transcript-old", "user", "The account support language is English.", "transcript", "conversation-1", { sourceClass: "transcript", trust: "trusted" }),
    boundaryMessage("boundary-transcript-recent", "user", "The invoice has a service fee.", "transcript", "conversation-2", { sourceClass: "transcript", trust: "trusted" }),
    boundaryMessage("boundary-tool-call", "assistant", "account_lookup({ account: AC-4821 })", "tools", "tool-round-1", { sourceClass: "tool-result", trust: "untrusted", toolName: "account_lookup" }),
    boundaryMessage("boundary-tool-result", "tool", "Account AC-4821 has an English support preference.", "tools", "tool-round-1", { sourceClass: "tool-result", trust: "untrusted", toolName: "account_lookup" }),
    boundaryMessage("boundary-memory", "system", "The preferred support language is English.", "memory", "memory-round-1", { sourceClass: "memory", trust: "untrusted", memoryRecordId: "memory-boundary-language", memoryScope: "semantic", memoryRevision: "1", memoryTrust: "retrieved-untrusted" }),
    boundaryMessage("boundary-active-user", "user", "What language should the support agent use?", "transcript", "conversation-3", { sourceClass: "active-turn", trust: "trusted" }),
    boundaryMessage("boundary-active-assistant", "assistant", "Answer using the provided context.", "transcript", "conversation-3", { sourceClass: "active-turn", trust: "trusted" }),
  ];
  return {
    trialId: "boundary-trial",
    task: "What language should the support agent use?",
    messages: boundaryMessages,
    contextWindowTokens: 200,
    budgetPolicy: {
      reservedOutputTokens: 10,
      safetyMarginTokens: 10,
      compactionThresholdPercent: 20,
    },
    tokenCounter: new FixedTokenCounter(Object.fromEntries(boundaryMessages.map((message) => [message.messageId, 8]))),
  };
}

function boundaryMessage(
  messageId: string,
  role: ContextMessage["role"],
  content: string,
  source: ContextMessage["source"],
  groupId: string | undefined,
  metadata: Readonly<Record<string, string>>,
): ContextMessage {
  return {
    schemaVersion: 1,
    messageId,
    sessionId: "context-boundary-fixture",
    sequence: {
      "boundary-system": 0,
      "boundary-transcript-old": 1,
      "boundary-transcript-recent": 2,
      "boundary-tool-call": 3,
      "boundary-tool-result": 4,
      "boundary-memory": 5,
      "boundary-active-user": 6,
      "boundary-active-assistant": 7,
    }[messageId] ?? 0,
    role,
    content,
    source,
    createdAt: "2026-09-20T00:00:00.000Z",
    groupId,
    metadata,
  };
}

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
