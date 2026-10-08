import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextSessionStore } from "../../src/capabilities/context/session-store.js";
import { ContextService } from "../../src/capabilities/context/context-service.js";
import { CharacterTokenEstimator } from "../../src/capabilities/context/token-counter.js";
import { skillContributions } from "../../src/capabilities/extensions/skills.js";

test("model-loaded skill and reference persist once into follow-up context and survive compaction without grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-active-skills-"));
  try {
    const skillRoot = join(root, "packages"); await mkdir(join(skillRoot, "report", "references"), { recursive: true });
    await writeFile(join(skillRoot, "report", "SKILL.md"), "---\nname: report\ndescription: Prepare evidence reports.\n---\nRead references/format.md and cite sources.\n");
    await writeFile(join(skillRoot, "report", "references", "format.md"), "Separate facts from assumptions.");
    const contributions = await skillContributions({ id: "procedures", version: "1.0.0" }, skillRoot);
    const store = new ContextSessionStore(join(root, "sessions"));
    const configuration = { sessionId: "session-active-skills", platform: "mastra", variant: "baseline", model: "fake/fake-success", systemInstruction: "Use available tools.", contextWindowTokens: 1500, reservedOutputTokens: 100, safetyMarginTokens: 50, compactionThresholdPercent: 20 };
    const session = await store.create(configuration);
    const first = await store.admitTurn(session.sessionId, "run-first", "Prepare a report.");
    const context = { runId: "run-first", turnId: first.turn.turnId, sessionId: session.sessionId, signal: new AbortController().signal, onSkillActivated: async (skill: Parameters<ContextSessionStore["activateSkill"]>[2]) => { await store.activateSkill(session.sessionId, first.turn.turnId, skill); } };
    const loader = contributions.tools.find(value => value.descriptor.definition.name === "procedures_load_skill")!.implementation;
    const reader = contributions.tools.find(value => value.descriptor.definition.name === "procedures_read_skill_resource")!.implementation;
    await loader.execute({ name: "report" }, context); await loader.execute({ name: "report" }, context);
    const explicit = await contributions.resolveSkillContexts(["report"]);
    assert.deepEqual(explicit[0], (await store.read(session.sessionId)).activeSkillContexts![0]);
    await store.activateSkill(session.sessionId, first.turn.turnId, explicit[0]);
    await assert.rejects(contributions.resolveSkillContexts(["missing"]), /catalog/);
    await reader.execute({ name: "report", path: "references/format.md" }, context);
    assert.equal((await store.read(session.sessionId)).activeSkillContexts!.length, 2);
    await store.settleTurn(session.sessionId, first.turn.turnId, { status: "completed", output: "Earlier analysis. ".repeat(1000) });
    // Reopening preserves dynamic activations without changing admission configuration.
    const restarted = new ContextSessionStore(join(root, "sessions")); await restarted.create(configuration);
    const next = await restarted.admitTurn(session.sessionId, "run-second", "Revise the report.");
    const service = new ContextService(restarted, new CharacterTokenEstimator());
    const prepared = await service.prepareTurn(session.sessionId, next.turn.turnId, { summarize: async ({ messages }) => { assert.equal(messages.some(message => message.source === "skills"), false); return "Previous report discussion."; } }, { forceCompaction: true });
    const projection = await service.projection(session.sessionId);
    assert.equal(projection?.activeSkills?.length, 2);
    assert.equal(projection?.activeSkills?.[0]?.id, "procedures.report");
    assert.equal(JSON.stringify(projection?.activeSkills).includes("Read references/format.md"), false);
    const active = prepared.snapshot.messages.filter(message => message.source === "skills");
    assert.equal(active.length, 2); assert.equal(active.every(message => message.role === "user" && message.metadata?.authority === "none"), true);
    assert.match(active.map(message => message.content).join("\n"), /Separate facts from assumptions/);
    assert.equal(prepared.snapshot.compaction!.retainedMessageIds.includes(active[0].messageId), true);
    assert.equal((await restarted.read(session.sessionId)).activeSkillContexts!.every(skill => skill.grants.length === 0), true);
    const changed = { ...(await restarted.read(session.sessionId)).activeSkillContexts![0], digest: "f".repeat(64) };
    await assert.rejects(restarted.activateSkill(session.sessionId, next.turn.turnId, changed), /changed/);
    await assert.rejects(restarted.activateSkill(session.sessionId, first.turn.turnId, changed), /active admitted turn/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
