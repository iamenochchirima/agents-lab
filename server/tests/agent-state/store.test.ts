import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentStateStore, AgentStateConflictError, createAgentMemoryTools } from "../../src/capabilities/agent-state/index.js";

async function fixture(t: { after: (action: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "agent-state-")); t.after(() => rm(root, { recursive: true, force: true })); return { root, store: new AgentStateStore(root) };
}
const memory = { kind: "fact" as const, title: "Project decision", content: "Use the fictional Cedar namespace.", tags: ["project"], provenance: { source: "fixture" as const } };
test("identity revisions and bounded Markdown import survive reopening without replacing old identity", async t => {
  const { root, store } = await fixture(t); const old = await store.getIdentity();
  const next = await store.updateIdentity({ name: "Lab assistant", purpose: old.purpose, style: "Use concise answers.", initiative: old.initiative, behavior: old.behavior }, { operationId: "edit-identity", expectedRevision: old.revision });
  assert.equal((await new AgentStateStore(root).getIdentity()).revision, 2);
  assert.equal((await store.getIdentity(1)).name, old.name);
  await assert.rejects(store.updateIdentity({ name: "Conflict", purpose: next.purpose, style: next.style, initiative: next.initiative, behavior: next.behavior }, { operationId: "conflict", expectedRevision: 1 }), AgentStateConflictError);
  const markdown = await store.exportIdentityMarkdown();
  const imported = await store.importIdentityMarkdown(markdown, { operationId: "import", expectedRevision: 2 }); assert.equal(imported.name, next.name);
  await assert.rejects(store.importIdentityMarkdown("../../etc/passwd", { operationId: "bad", expectedRevision: 3 }));
});
test("memory mutation receipts are atomic, idempotent, revision checked, isolated and forgotten without resurrection", async t => {
  const { root, store } = await fixture(t);
  const input = { ...memory, operationId: "save", expectedRevision: 0, id: "cedar" };
  const first = await store.saveMemory("workspace-local", input);
  assert.deepEqual(await new AgentStateStore(root).saveMemory("workspace-local", input), first);
  await assert.rejects(store.saveMemory("workspace-local", { ...input, content: "Different" }), AgentStateConflictError);
  assert.equal((await store.listMemory("experiment-1")).length, 0);
  await store.saveMemory("experiment-1", input);
  const updated = await store.updateMemory("workspace-local", "cedar", { ...memory, content: "Use Maple instead.", operationId: "update", expectedRevision: 1 });
  assert.equal(updated.revision, 2);
  await assert.rejects(store.updateMemory("workspace-local", "cedar", { ...memory, operationId: "stale", expectedRevision: 1 }), AgentStateConflictError);
  await store.forgetMemory("workspace-local", "cedar", { operationId: "forget", expectedRevision: 2 });
  assert.equal((await new AgentStateStore(root).listMemory()).length, 0);
  assert.equal((await store.listMemory("experiment-1")).length, 1);
  await assert.rejects(store.saveMemory("workspace-local", { ...input, operationId: "resurrect" }), AgentStateConflictError);
});
test("concurrent store instances serialize writes and deterministic recall stays inside byte and namespace budgets", async t => {
  const { root, store } = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, (_, index) => new AgentStateStore(root).saveMemory("workspace-local", { ...memory, id: `memory-${index}`, operationId: `save-${index}`, expectedRevision: 0, content: "Cedar project " + "x".repeat(250) })));
  assert.equal((await store.listMemory()).length, 8);
  const first = await store.projectContext("workspace-local", "Cedar", { maxBytes: 1024 });
  assert.ok(first.bytes <= 1024); assert.ok(first.omitted > 0);
  assert.deepEqual(await store.projectContext("workspace-local", "Cedar", { maxBytes: 1024 }), first);
  assert.equal((await store.projectContext("different", "Cedar")).records.length, 0);
  assert.equal((await store.projectContext("workspace-local", "Cedar", { enabled: false })).text, "");
  assert.equal((await store.searchMemory()).length, 8);
});
test("tool namespace comes from recorded run authority and repeated write call keeps the same mutation", async t => {
  const { store } = await fixture(t);
  const tools = createAgentMemoryTools(store, async context => ({ namespace: context.runId === "trial" ? "experiment-trial" : "workspace-local", enabled: context.runId !== "disabled" }));
  const save = tools.find(tool => tool.descriptor.definition.name === "memory_save")!.implementation;
  const args = save.validateArguments({ kind: "preference", title: "Timezone", content: "Use UTC." });
  const context = { runId: "trial", turnId: "turn", toolCallId: "call", signal: new AbortController().signal };
  const result = await save.execute(args, context); assert.equal(await save.execute(args, context), result);
  assert.equal((await store.listMemory("workspace-local")).length, 0); assert.equal((await store.listMemory("experiment-trial")).length, 1);
  await assert.rejects(save.execute(args, { ...context, runId: "disabled" }), /disabled/);
  assert.throws(() => save.validateArguments({ ...args, namespace: "workspace-local" }));
});
