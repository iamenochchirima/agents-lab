import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextSessionStore } from "../../src/capabilities/context/session-store.js";
import { prepareRoundContext, type RoundMessage } from "../../src/capabilities/context/round-context.js";

test("native round projection compacts completed observations, retains pending calls and exact task, and keeps private source evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-native-round-"));
  try {
    const store = new ContextSessionStore(root);
    await store.create({ sessionId: "native-round", platform: "temporal", variant: "baseline", model: "fake/fake-summary",
      systemInstruction: "Keep the original constraint.", contextWindowTokens: 1000, reservedOutputTokens: 100,
      safetyMarginTokens: 50, compactionThresholdPercent: 20, recentMessageGroups: 0 });
    const messages: RoundMessage[] = [{ role: "system", content: "Keep the original constraint." }, { role: "user", content: "The exact task." },
      { role: "assistant", content: null, toolCalls: [{ toolCallId: "read-1", name: "unfamiliar_read", arguments: {} }] },
      { role: "tool", toolCallId: "read-1", name: "unfamiliar_read", content: "Complete observation ".repeat(170) },
      { role: "assistant", content: null, toolCalls: [{ toolCallId: "pending-2", name: "unfamiliar_write", arguments: { value: "pending" } }] }];
    const prepared = await prepareRoundContext({ rootDirectory: root, sessionId: "native-round", runId: "run-1", round: 2,
      task: "The exact task.", messages, toolSchemas: [{ name: "unfamiliar_read" }] }, { async summarize(request) {
        assert.deepEqual(request.messages.map(message => message.role), ["assistant", "tool"]);
        return "The first read completed.";
      } });
    assert.equal(prepared.budget.pressure, "normal");
    assert.ok(prepared.compaction);
    assert.ok(prepared.messages.some(message => message.role === "user" && message.content === "The exact task."));
    assert.ok(prepared.messages.some(message => message.role === "assistant" && message.toolCalls?.[0]?.toolCallId === "pending-2"));
    const directory = join(root, "native-round", "native-rounds");
    const names = await readdir(directory);
    const evidence = JSON.parse(await readFile(join(directory, names[0]!), "utf8"));
    assert.equal(evidence.sourceMessages.find((message: {role: string}) => message.role === "tool").content, "Complete observation ".repeat(170));
    assert.equal((await store.readTranscript("native-round")).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
