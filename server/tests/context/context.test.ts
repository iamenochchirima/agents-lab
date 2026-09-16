import assert from "node:assert/strict";
import test from "node:test";

import { calculateContextBudget } from "../../src/capabilities/context/budget.js";
import { compactContext, ContextCompactionError } from "../../src/capabilities/context/compaction.js";
import type { ContextMessage } from "../../src/capabilities/context/contracts.js";
import { FixedTokenCounter } from "../../src/capabilities/context/token-counter.js";

const policy = { reservedOutputTokens: 10, safetyMarginTokens: 5, compactionThresholdPercent: 20 };

test("budget reports the real remaining budget and clamps display percentage", () => {
  const budget = calculateContextBudget(100, { tokens: 60, quality: "exact", basis: "test" }, policy);
  assert.deepEqual(budget, {
    contextWindowTokens: 100,
    inputTokens: 60,
    reservedOutputTokens: 10,
    safetyMarginTokens: 5,
    remainingTokens: 25,
    remainingPercent: 25,
    quality: "exact",
    tokenizerBasis: "test",
    pressure: "normal",
  });

  const exhausted = calculateContextBudget(100, { tokens: 90, quality: "estimated", basis: "test" }, policy);
  assert.equal(exhausted.remainingPercent, 0);
  assert.equal(exhausted.pressure, "exhausted");
});

test("unknown model window never appears as full context", () => {
  const budget = calculateContextBudget(null, { tokens: 60, quality: "estimated", basis: "test" }, policy);
  assert.equal(budget.remainingTokens, null);
  assert.equal(budget.remainingPercent, null);
  assert.equal(budget.pressure, "unknown");
});

test("compaction preserves instructions, active turn, and complete groups", async () => {
  const messages = [
    message("system", "identity", 1, "system"),
    message("user", "old question", 2, "transcript", "turn-1"),
    message("assistant", "old answer", 3, "transcript", "turn-1"),
    message("assistant", "tool call", 4, "tools", "tool-1"),
    message("tool", "tool result", 5, "tools", "tool-1"),
    message("user", "recent question", 6, "transcript", "turn-2"),
  ];
  const result = await compactContext(
    messages,
    new FixedTokenCounter({ identity: 10, "old question": 20, "old answer": 20, "tool call": 10, "tool result": 10, "recent question": 20, "ctx-summary": 5 }),
    100,
    policy,
    { sessionId: "session-1", sessionRevision: 6, sourceRevision: 6, currentMessageId: "recent question", trigger: "preflight", now: () => "2026-09-15T20:00:00.000Z" },
    { summarize: async () => "The earlier user asked a question and the agent answered it." },
  );

  assert.equal(result.record.sourceMessageIds.includes("old question"), true);
  assert.equal(result.record.sourceMessageIds.includes("tool call"), true);
  assert.equal(result.messages.some((item) => item.source === "system" && item.messageId === "identity"), true);
  assert.equal(result.messages.some((item) => item.messageId === "recent question"), true);
  assert.equal(result.messages.filter((item) => item.groupId === "tool-1").length, 0);
  assert.equal(result.messages.some((item) => item.source === "compaction-summary"), true);
});

test("compaction rejects an empty summary and an unsafe result", async () => {
  const messages = [message("user", "old", 1), message("user", "current", 2)];
  const counter = {
    count(items: readonly ContextMessage[]) {
      return items.some((item) => item.source === "compaction-summary")
        ? { tokens: 90, quality: "exact" as const, basis: "test" }
        : { tokens: 60, quality: "exact" as const, basis: "test" };
    },
  };
  await assert.rejects(
    () => compactContext(messages, counter, 100, policy, {
      sessionId: "session-1", sessionRevision: 2, sourceRevision: 2, currentMessageId: "current", trigger: "preflight",
    }, { summarize: async () => "" }),
    ContextCompactionError,
  );
  await assert.rejects(
    () => compactContext(messages, counter, 100, policy, {
      sessionId: "session-1", sessionRevision: 2, sourceRevision: 2, currentMessageId: "current", trigger: "preflight",
    }, { summarize: async () => "large" }),
    /still exceeds its safe budget/,
  );
});

test("compaction retains a recent complete group outside the summary", async () => {
  const messages = [
    message("user", "old question", 1, "transcript", "old-turn"),
    message("assistant", "old answer", 2, "transcript", "old-turn"),
    message("assistant", "recent tool call", 3, "tools", "recent-tool"),
    message("tool", "recent tool result", 4, "tools", "recent-tool"),
    message("user", "current", 5),
  ];
  const result = await compactContext(
    messages,
    new FixedTokenCounter({ "old question": 20, "old answer": 20, "recent tool call": 10, "recent tool result": 10, current: 10, "ctx-summary": 5 }),
    100,
    { ...policy, recentMessageGroups: 1 },
    { sessionId: "session-1", sessionRevision: 5, sourceRevision: 5, currentMessageId: "current", trigger: "preflight" },
    { summarize: async () => "The old exchange is summarized." },
  );

  assert.equal(result.messages.some((item) => item.messageId === "recent tool call"), true);
  assert.equal(result.messages.some((item) => item.messageId === "recent tool result"), true);
  assert.equal(result.record.sourceMessageIds.includes("old question"), true);
  assert.equal(result.record.sourceMessageIds.includes("recent tool call"), false);
});

function message(role: ContextMessage["role"], content: string, sequence: number, source: ContextMessage["source"] = "transcript", groupId?: string): ContextMessage {
  return {
    schemaVersion: 1,
    messageId: content,
    sessionId: "session-1",
    sequence,
    role,
    content,
    source,
    createdAt: "2026-09-15T20:00:00.000Z",
    ...(groupId ? { groupId } : {}),
  };
}
