import assert from "node:assert/strict";
import test from "node:test";

import type { ContextMessage, ContextTokenCounter } from "../../src/capabilities/context/contracts.js";
import { FixedTokenCounter } from "../../src/capabilities/context/token-counter.js";
import {
  DeterministicCompactionStrategy,
  FullHistoryStrategy,
  GroupAwareSlidingWindowStrategy,
  RelevanceRankedGroupsStrategy,
  TokenBudgetAllocationStrategy,
} from "../../src/studio/strategies/context-strategy.js";

const fixtureSequence: Readonly<Record<string, number>> = {
  instruction: 0,
  "transcript-old": 1,
  "tool-call": 2,
  "tool-result": 3,
  memory: 4,
  "transcript-recent": 5,
  active: 6,
};

const fixtureMessages: readonly ContextMessage[] = [
  fixtureMessage("instruction", "system", "Follow the account support policy.", "instruction", { sourceClass: "instruction", trust: "trusted" }),
  fixtureMessage("transcript-old", "user", "The account support language is English.", "transcript-old", { sourceClass: "transcript", trust: "trusted" }),
  fixtureMessage("tool-call", "assistant", "account_lookup({ account: AC-4821 })", "tool-round", { sourceClass: "tool-result", trust: "untrusted" }),
  fixtureMessage("tool-result", "tool", "Account AC-4821 has an English support preference.", "tool-round", { sourceClass: "tool-result", trust: "untrusted" }),
  fixtureMessage("memory", "system", "The preferred support language is English.", "memory-1", { sourceClass: "memory", trust: "untrusted", memoryRecordId: "memory-language" }),
  fixtureMessage("transcript-recent", "user", "The invoice contains a service fee.", "transcript-recent", { sourceClass: "transcript", trust: "trusted" }),
  fixtureMessage("active", "user", "What language should the support agent use?", "active-turn", { sourceClass: "active-turn", trust: "trusted" }),
];

class FixtureTokenCounter implements ContextTokenCounter {
  count(messages: readonly ContextMessage[]) {
    return {
      tokens: messages.reduce((total, message) => total + Number(message.metadata?.tokenContribution ?? 5), 0),
      quality: "exact" as const,
      basis: "context-research-fixture-v1",
    };
  }
}

test("research evidence is additive and all baseline strategies retain complete groups", () => {
  const strategies = [
    new FullHistoryStrategy(),
    new GroupAwareSlidingWindowStrategy(),
    new RelevanceRankedGroupsStrategy(),
  ];

  for (const implementation of strategies) {
    const result = implementation.assemble({
      ...baseInput(),
      strategy: implementation.id === "full-history"
        ? { id: implementation.id, version: "1", parameters: {} }
        : implementation.id === "group-aware-sliding-window"
          ? { id: implementation.id, version: "1", parameters: { recentGroups: "2" } }
          : { id: implementation.id, version: "1", parameters: { maxGroups: "2" } },
    });

    assert.ok(result.research);
    assert.equal(result.research?.strategyId, implementation.id);
    assert.equal(result.research?.schemaVersion, 1);
    assert.deepEqual(result.research?.modelBoundMessageIds, result.retainedMessageIds);
    assertGroupAtomic(result.retainedMessageIds, result.summarizedMessageIds);
    assert.deepEqual(result.messages.map((message) => message.messageId), result.retainedMessageIds);
  }
});

test("group-aware sliding-window never splits a tool call and result group", () => {
  const result = new GroupAwareSlidingWindowStrategy().assemble({
    ...baseInput(),
    strategy: { id: "group-aware-sliding-window", version: "1", parameters: { recentGroups: "3" } },
  });

  assert.deepEqual(result.retainedMessageIds, ["instruction", "tool-call", "tool-result", "memory", "transcript-recent", "active"]);
  assert.deepEqual(result.research?.groupDecisions.find((decision) => decision.groupId === "tool-round"), {
    groupId: "tool-round",
    sourceClass: "tool-result",
    decision: "retained",
    score: null,
    reason: "selected as a complete recent source group",
  });
});

test("group relevance ranking scores complete groups and restores original source order", () => {
  const result = new RelevanceRankedGroupsStrategy().assemble({
    ...baseInput(),
    strategy: { id: "relevance-ranked-groups", version: "1", parameters: { maxGroups: "2" } },
  });

  assert.deepEqual(result.retainedMessageIds, ["instruction", "transcript-old", "memory", "active"]);
  assert.equal(result.research?.groupDecisions.find((decision) => decision.groupId === "transcript-old")?.score, 2);
  assert.equal(result.research?.groupDecisions.find((decision) => decision.groupId === "tool-round")?.decision, "omitted");
  assertGroupAtomic(result.retainedMessageIds, result.summarizedMessageIds);
});

test("deterministic compaction emits a bounded rolling summary and stable evidence", () => {
  const strategy = { id: "deterministic-compaction", version: "1", parameters: { recentGroups: "1", maxSummaryCharacters: "64" } } as const;
  const implementation = new DeterministicCompactionStrategy();
  const first = implementation.assemble({ ...baseInput({ contextWindowTokens: 60 }), strategy });
  const second = implementation.assemble({ ...baseInput({ contextWindowTokens: 60 }), strategy });

  assert.equal(first.decision, "within-budget");
  assert.equal(first.research?.compaction.trigger, "pressure");
  assert.equal(first.research?.compaction.policyId, "deterministic-rolling-summary");
  assert.equal(first.research?.compaction.summaryMessageId, first.messages.find((message) => message.source === "compaction-summary")?.messageId);
  assert.ok(first.messages.some((message) => message.source === "compaction-summary"));
  assert.match(first.messages.find((message) => message.source === "compaction-summary")?.content ?? "", /^Deterministic rolling summary/);
  assert.deepEqual(first.research, second.research);
  assert.deepEqual(first.messages, second.messages);
  assert.ok(first.summarizedMessageIds.length > 0);
  assert.deepEqual(first.omittedMessageIds, []);
  assert.equal(first.research?.pressure.before, "compaction_due");
  assert.equal(first.research?.pressure.after, "normal");
});

test("token-budget allocation records class caps and omits only complete overflowing groups", () => {
  const implementation = new TokenBudgetAllocationStrategy();
  const result = implementation.assemble({
    ...baseInput({ contextWindowTokens: 100 }),
    strategy: {
      id: "token-budget-allocation",
      version: "1",
      parameters: {
        instructionPercent: "25",
        activeTurnPercent: "25",
        transcriptPercent: "25",
        memoryPercent: "15",
        toolResultPercent: "10",
        summaryPercent: "0",
      },
    },
  });

  assert.equal(result.decision, "within-budget");
  assert.equal(result.research?.allocation?.availableInputTokens, 80);
  assert.equal(result.research?.allocation?.overflowDecision, "class-limit");
  assert.equal(result.research?.allocation?.reserveConsumedBy, null);
  assert.deepEqual(result.retainedMessageIds, ["instruction", "transcript-old", "memory", "transcript-recent", "active"]);
  assert.deepEqual(result.omittedMessageIds, ["tool-call", "tool-result"]);
  assert.equal(result.research?.groupDecisions.find((decision) => decision.groupId === "tool-round")?.decision, "omitted");
  assert.equal(result.research?.allocation?.allocations.find((allocation) => allocation.sourceClass === "tool-result")?.allocatedTokens, 8);
  assertGroupAtomic(result.retainedMessageIds, result.summarizedMessageIds);
});

test("over-budget and unknown token outcomes remain explicit in the research evidence", () => {
  const overBudget = new FullHistoryStrategy().assemble({
    ...baseInput({ contextWindowTokens: 40 }),
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  assert.equal(overBudget.decision, "over-budget");
  assert.equal(overBudget.research?.pressure.after, "exhausted");
  assert.equal(overBudget.research?.pressure.trigger, "none");

  const unknown = new FullHistoryStrategy().assemble({
    ...baseInput({ tokenCounter: { count: () => ({ tokens: null, quality: "unknown", basis: "fixture-unknown" }) } }),
    strategy: { id: "full-history", version: "1", parameters: {} },
  });
  assert.equal(unknown.decision, "unknown-budget");
  assert.equal(unknown.research?.pressure.before, "unknown");
  assert.equal(unknown.research?.pressure.after, "unknown");
  assert.equal(unknown.research?.pressure.trigger, "unknown");
});

function baseInput(overrides: Partial<{
  readonly contextWindowTokens: number;
  readonly tokenCounter: ContextTokenCounter;
}> = {}) {
  return {
    trialId: "research-trial",
    task: "What language should the support agent use?",
    messages: fixtureMessages,
    contextWindowTokens: overrides.contextWindowTokens ?? 200,
    budgetPolicy: {
      reservedOutputTokens: 10,
      safetyMarginTokens: 10,
      compactionThresholdPercent: 20,
    },
    tokenCounter: overrides.tokenCounter ?? new FixtureTokenCounter(),
  };
}

function fixtureMessage(
  messageId: string,
  role: ContextMessage["role"],
  content: string,
  groupId: string,
  metadata: Readonly<Record<string, string>>,
): ContextMessage {
  return {
    schemaVersion: 1,
    messageId,
    sessionId: "context-research-fixture",
    sequence: fixtureSequence[messageId] ?? 0,
    role,
    content,
    source: role === "tool" ? "tools" : role === "system" ? "system" : role === "assistant" && groupId === "tool-round" ? "tools" : "transcript",
    createdAt: "2026-09-20T00:00:00.000Z",
    groupId,
    metadata,
  };
}

function assertGroupAtomic(retainedIds: readonly string[], summarizedIds: readonly string[]): void {
  const retained = new Set(retainedIds);
  const summarized = new Set(summarizedIds);
  for (const groupId of new Set(fixtureMessages.map((message) => message.groupId))) {
    const group = fixtureMessages.filter((message) => message.groupId === groupId);
    const retainedCount = group.filter((message) => retained.has(message.messageId)).length;
    const summarizedCount = group.filter((message) => summarized.has(message.messageId)).length;
    assert.ok(retainedCount === 0 || retainedCount === group.length, `retained group ${groupId} was split`);
    assert.ok(summarizedCount === 0 || summarizedCount === group.length, `summarized group ${groupId} was split`);
  }
}
