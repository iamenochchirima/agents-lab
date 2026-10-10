import assert from "node:assert/strict";
import test from "node:test";
import { compactContext, CharacterTokenEstimator, type ContextMessage } from "../../src/capabilities/context/index.js";

const message = (sequence: number, role: ContextMessage["role"], content: string, rest: Partial<ContextMessage> = {}): ContextMessage => ({ schemaVersion: 1, sessionId: "within", messageId: `m${sequence}`, sequence, role, content, source: "transcript", createdAt: "2026-10-10T00:00:00Z", ...rest });
const messages = [message(0, "system", "Immutable instruction"), message(1, "user", "Current task"),
  message(2, "assistant", "two calls", { groupId: "round1", metadata: { toolCallIds: '["a","b"]' } }),
  message(3, "tool", "result A ".repeat(100), { groupId: "round1", metadata: { toolCallId: "a" } }),
  message(4, "tool", "result B ".repeat(100), { groupId: "round1", metadata: { toolCallId: "b" } }),
  message(5, "user", "Loaded untrusted skill", { source: "skills" })];
const policy = { reservedOutputTokens: 100, safetyMarginTokens: 50, compactionThresholdPercent: 20, recentMessageGroups: 0 };
const options = { sessionId: "within", sessionRevision: 1, sourceRevision: 1, currentMessageId: "m1", completedGroupIds: ["round1"], trigger: "preflight" as const };
test("within-run compaction summarizes complete post-task groups and preserves task and skills", async () => {
  const result = await compactContext(messages, new CharacterTokenEstimator(), 1000, policy, options, { async summarize(request) {
    assert.deepEqual(request.messages.map(message => message.messageId), ["m2", "m3", "m4"]);
    return "Two results were observed.";
  } });
  assert.deepEqual(result.record.sourceMessageIds, ["m2", "m3", "m4"]);
  assert.ok(result.messages.some(message => message.messageId === "m1" && message.content === "Current task"));
  assert.ok(result.messages.some(message => message.messageId === "m5"));
  assert.ok(result.record.after.inputTokens! < result.record.before.inputTokens!);
});
test("within-run compaction rejects incomplete groups before summarization", async () => {
  let calls = 0;
  await assert.rejects(compactContext(messages.filter(message => message.messageId !== "m4"), new CharacterTokenEstimator(), 1000, policy, options,
    { async summarize() { calls++; return "unsafe"; } }), /cannot separate/);
  assert.equal(calls, 0);
});
