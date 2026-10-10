import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextSessionStore } from "../../../src/capabilities/context/index.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import { MastraBaselineRunner } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { prepareMastraRoundContext } from "../../../src/platforms/mastra/runner-adapter/round-context.js";

test("native round compaction summarizes complete tool groups and preserves an unresolved pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-round-context-"));
  try {
    const runner = new MastraBaselineRunner({ contextRoot: root });
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Keep researching" }, model: { provider: "fake", model: "fake-success" } }, { runId: "context-native", platformConfig: runner.manifestConfiguration() });
    const sessions = new ContextSessionStore(root);
    await sessions.create({ sessionId: "context-session", platform: "mastra", variant: "baseline", model: "fake-success", systemInstruction: "Follow the task", contextWindowTokens: 3_000, reservedOutputTokens: 100, safetyMarginTokens: 100, compactionThresholdPercent: 50, recentMessageGroups: 0 });
    const manifest = { ...base, context: { ...base.context, sessionId: "context-session" } };
    const prompt = [{ role: "system", content: "Follow the task" }, { role: "user", content: "Keep researching" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "completed", toolName: "lookup", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "completed", toolName: "lookup", output: { type: "text", value: "evidence ".repeat(1_100) } }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "pending", toolName: "write", input: { value: 1 } }] }];
    let summarized = "";
    const prepared = await prepareMastraRoundContext(manifest, root, join(root, "rounds"), 2, { prompt, tools: [{ name: "lookup", parameters: {} }] }, { summarize: async request => { summarized = JSON.stringify(request.messages); return "Confirmed observation from completed lookup"; } });
    assert.ok(prepared.compaction); assert.ok(prepared.budget); assert.match(summarized, /completed/); assert.doesNotMatch(summarized, /pending/);
    assert.ok((prepared.prompt as unknown[]).includes(prompt[4]));
    assert.ok((prepared.prompt as unknown[]).includes(prompt[1]));
    const retained = JSON.parse(await readFile(join(root, "rounds", "context-round-2.json"), "utf8"));
    assert.equal(retained.sourceMessages.length, 6); assert.ok(retained.messages.length < retained.sourceMessages.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});
