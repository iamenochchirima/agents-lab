import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skillContributions } from "../../../src/capabilities/extensions/skills.js";
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


test("dynamically loaded skill survives removal of its completed native loader group", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-active-skill-"));
  try {
    const skillRoot = join(root, "skills", "review-procedure"); await mkdir(skillRoot, { recursive: true });
    const instructions = "SKILL-PROCEDURE-MARKER: verify retained evidence before proposing a write.";
    await writeFile(join(skillRoot, "SKILL.md"), `---
name: review-procedure
description: Review the retained evidence.
---
${instructions}`);
    const contributions = await skillContributions({ id: "dynamic-procedures", version: "1.0.0" }, join(root, "skills"));
    const loader = contributions.tools.find(tool => tool.descriptor.definition.name.endsWith("load_skill"))!;
    const store = new ContextSessionStore(root);
    await store.create({ sessionId: "active-skill-session", platform: "mastra", variant: "baseline", model: "fake-success",
      systemInstruction: "Follow the task", contextWindowTokens: 3_000, reservedOutputTokens: 100, safetyMarginTokens: 100,
      compactionThresholdPercent: 50, recentMessageGroups: 0 });
    const admitted = await store.admitTurn("active-skill-session", "active-skill-run", "Keep researching");
    const loaded = await loader.implementation.execute({ name: "review-procedure" }, { runId: "active-skill-run", turnId: admitted.turn.turnId,
      sessionId: "active-skill-session", signal: new AbortController().signal,
      onSkillActivated: async skill => { await store.activateSkill("active-skill-session", admitted.turn.turnId, skill); } });
    const session = await store.read("active-skill-session"); const activated = session.activeSkillContexts![0]!;
    assert.ok(activated.content.includes(instructions)); assert.ok(!loaded.includes(activated.content));
    const runner = new MastraBaselineRunner({ contextRoot: root });
    const base = buildRunManifest({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "Keep researching" },
      model: { provider: "fake", model: "fake-success" } }, { runId: "active-skill-run", platformConfig: runner.manifestConfiguration() });
    const manifest = { ...base, context: { ...base.context, sessionId: session.sessionId, turnId: admitted.turn.turnId } };
    const prompt = [{ role: "system", content: "Follow the task" }, { role: "user", content: "Keep researching" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "load-call", toolName: loader.descriptor.definition.name, input: { name: "review-procedure" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "load-call", toolName: loader.descriptor.definition.name, output: { type: "text", value: loaded } }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "lookup-call", toolName: "lookup", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "lookup-call", toolName: "lookup", output: { type: "text", value: "Old lookup evidence ".repeat(600) } }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "pending-write", toolName: "write", input: {} }] }];
    const prepared = await prepareMastraRoundContext(manifest, root, join(root, "rounds"), 3, { prompt },
      { summarize: async () => "Earlier completed tool observations." });
    assert.ok(prepared.compaction);
    const next = prepared.prompt as { role: string; content: unknown }[];
    const procedure = next.find(message => message.content === activated.content);
    assert.equal(procedure?.role, "user");
    assert.ok(next.includes(prompt[6]!));
    assert.ok(!next.some(message => JSON.stringify(message.content).includes('"toolCallId":"load-call"')));
    const record = JSON.parse(await readFile(join(root, "rounds", "context-round-3.json"), "utf8"));
    const retained = record.messages.find((message: { source: string; content: string }) => message.source === "skills" && message.content === activated.content);
    assert.equal(retained.metadata.skillId, activated.skillId); assert.equal(retained.metadata.skillDigest, activated.digest);
    assert.equal(retained.metadata.trust, "untrusted"); assert.equal(retained.metadata.authority, "none");
    assert.ok(record.skillDigests.includes(activated.digest));
    const repeated = await prepareMastraRoundContext(manifest, root, join(root, "rounds"), 4, { prompt: next },
      { summarize: async () => "Earlier completed tool observations." });
    assert.equal((repeated.prompt as { content: unknown }[]).filter(message => message.content === activated.content).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
