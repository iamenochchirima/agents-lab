import assert from "node:assert/strict";
import test from "node:test";
import { compactContext, CharacterTokenEstimator, calculateContextBudget, type ContextMessage, type ContextSnapshot } from "../../src/capabilities/context/index.js";
import { COMPACTION_PROMPTS, gradeCompaction } from "../../src/evals/compaction-contracts.js";
import { startCompactionProvider } from "../../src/evals/compaction-provider.js";

test("X05 controlled summary has actual budget/provenance/request and separate answer checks", async () => {
  const provider = await startCompactionProvider();
  try {
    const model = "fixture/compaction-test", counter = new CharacterTokenEstimator();
    const policy = { reservedOutputTokens: 4096, safetyMarginTokens: 1024, compactionThresholdPercent: 20, recentMessageGroups: 2 };
    const message = (sequence: number, role: ContextMessage["role"], content: string): ContextMessage => ({ schemaVersion: 1, messageId: `m-${sequence}`, sessionId: "fresh", sequence, role, content, source: role === "system" ? "system" : "transcript", createdAt: "2026-10-08T00:00:00Z" });
    const messages = [message(0, "system", "Be concise."), message(1, "user", COMPACTION_PROMPTS[0]), message(2, "assistant", "Stored."), message(3, "user", COMPACTION_PROMPTS[1])];
    assert.equal(calculateContextBudget(12000, counter.count(messages.slice(0, 2)), policy).pressure, "normal", "first turn must not need nonexistent history");
    const send = async (mapped: { role: string; content: string }[]) => {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages: mapped }) });
      assert.equal(response.status, 200); const data = await response.json() as any; return data.choices[0].message.content as string;
    };
    const compacted = await compactContext(messages, counter, 12000, policy, { sessionId: "fresh", sessionRevision: 2, sourceRevision: 2, currentMessageId: "m-3", trigger: "preflight" }, {
      summarize: request => send([{ role: "system", content: "Summarize the earlier conversation for another model." }, { role: "user", content: request.messages.map(message => message.content).join("\n") }]),
    });
    const output = await send(compacted.messages.map(message => ({ role: message.role, content: message.content })));
    const snapshot: ContextSnapshot = { schemaVersion: 1, snapshotId: "snapshot", sessionId: "fresh", sessionRevision: 2, compactionRevision: 1, model, messages: compacted.messages, sources: ["system", "compaction-summary", "transcript"], budget: compacted.record.after, compaction: compacted.record, createdAt: "2026-10-08T00:00:00Z" };
    const input = { platform: "mastra" as const, deployment: "controlled-test", snapshot, transcript: messages, receipts: provider.receipts, output, sources: ["controlled-evidence.json"] };
    assert.equal(gradeCompaction(input).verdict, "pass");
    const wrongAnswer = gradeCompaction({ ...input, output: '{"colour":"red","batch":27,"mode":"read-only"}' });
    assert.equal(wrongAnswer.verdict, "fail");
    assert.deepEqual(wrongAnswer.observations.filter(item => !item.observed).map(item => item.check), ["constraintsInAnswer"]);
    assert.equal(gradeCompaction({ ...input, receipts: provider.receipts.filter(receipt => receipt.kind === "summary") }).verdict, "fail");
    const lostSource = { ...structuredClone(snapshot), compaction: { ...compacted.record, sourceMessageIds: ["missing-source"] } };
    assert.equal(gradeCompaction({ ...input, snapshot: lostSource }).observations.find(item => item.check === "summarySourceProvenance")?.observed, false);
  } finally { await provider.close(); }
});
