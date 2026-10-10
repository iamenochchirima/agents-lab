import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentStateStore } from "../../src/capabilities/agent-state/store.js";
import { registerAgentState } from "../../src/control-plane/http/agent-state.js";
import type { RunService } from "../../src/control-plane/application/run-service.js";

async function fixture(t: { after: (action: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "agent-state-http-"));
  const store = new AgentStateStore(root), app = Fastify();
  registerAgentState(app, store, {} as RunService, ["http://127.0.0.1:5173"]);
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store, app };
}
test("identity settings survive reopening, exact retries return the saved revision, and stale browser edits cannot overwrite", async t => {
  const { root, app } = await fixture(t);
  const initial = (await app.inject({ method: "GET", url: "/api/agent-state" })).json();
  assert.equal(initial.identity.revision, 1); assert.deepEqual(initial.memory, []);
  const payload = { name: "Research assistant", purpose: "Help with authorized general tasks.", style: "Use concise language.", initiative: "Ask when a detail is missing.", behavior: "Verify connected actions.", operationId: "identity-edit", expectedRevision: 1 };
  const changed = await app.inject({ method: "POST", url: "/api/agent-state/identity", payload, headers: { origin: "http://127.0.0.1:5173" } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().identity.revision, 2);
  const retry = await app.inject({ method: "POST", url: "/api/agent-state/identity", payload });
  assert.deepEqual(retry.json(), changed.json());
  const conflict = await app.inject({ method: "POST", url: "/api/agent-state/identity", payload: { ...payload, name: "Stale edit", operationId: "another-edit" } });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error.code, "REVISION_CONFLICT");
  assert.equal((await new AgentStateStore(root).getIdentity()).name, payload.name);
  const markdown = (await app.inject({ method: "GET", url: "/api/agent-state/identity/markdown" })).json().markdown;
  const imported = await app.inject({ method: "POST", url: "/api/agent-state/identity", payload: { markdown, operationId: "identity-import", expectedRevision: 2 } });
  assert.equal(imported.statusCode, 200); assert.equal(imported.json().identity.name, payload.name); assert.equal(imported.json().identity.revision, 3);
});
test("local memory routes correct and forget persisted records while retaining workspace scope and trusted provenance", async t => {
  const { root, app, store } = await fixture(t);
  await store.saveMemory("experiment-unrelated", { id: "other-fact", operationId: "other-save", expectedRevision: 0, kind: "fact", title: "Separate trial", content: "A fictional isolated fact.", provenance: { source: "fixture" } });
  const payload = { operationId: "memory-save", id: "preference", kind: "preference", title: "Reporting format", content: "Use concise checklists.", namespace: "experiment-unrelated", provenance: { source: "fixture", runId: "forged" } };
  const saved = await app.inject({ method: "POST", url: "/api/agent-state/memory", payload });
  assert.equal(saved.statusCode, 200); const original = saved.json().memory;
  assert.equal(original.namespace, "workspace-local"); assert.deepEqual(original.provenance, { source: "user" });
  const duplicate = await app.inject({ method: "POST", url: "/api/agent-state/memory", payload }); assert.deepEqual(duplicate.json(), saved.json());
  const updated = await app.inject({ method: "POST", url: `/api/agent-state/memory/${original.id}`, payload: { operation: "update", operationId: "memory-update", expectedRevision: 1, kind: "preference", title: original.title, content: "Use detailed paragraphs." } });
  assert.equal(updated.statusCode, 200); assert.equal(updated.json().memory.revision, 2);
  const stale = await app.inject({ method: "POST", url: `/api/agent-state/memory/${original.id}`, payload: { operation: "forget", operationId: "stale-forget", expectedRevision: 1 } });
  assert.equal(stale.statusCode, 409);
  const current = (await app.inject({ method: "GET", url: "/api/agent-state" })).json().memory;
  assert.equal(current.length, 1); assert.equal(current[0].content, "Use detailed paragraphs.");
  const forgotten = await app.inject({ method: "POST", url: `/api/agent-state/memory/${original.id}`, payload: { operation: "forget", operationId: "memory-forget", expectedRevision: 2 } });
  assert.equal(forgotten.statusCode, 200);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/agent-state" })).json().memory, []);
  const reopened = new AgentStateStore(root); assert.deepEqual(await reopened.listMemory(), []); assert.equal((await reopened.listMemory("experiment-unrelated")).length, 1);
  const resurrect = await app.inject({ method: "POST", url: "/api/agent-state/memory", payload: { ...payload, operationId: "resurrect" } }); assert.equal(resurrect.statusCode, 409);
});
test("foreign origins and invalid content cannot mutate local agent settings", async t => {
  const { app, store } = await fixture(t);
  const payload = { operationId: "memory-save", kind: "fact", title: "Fixture", content: "A fictional fact." };
  const foreign = await app.inject({ method: "POST", url: "/api/agent-state/memory", headers: { origin: "https://another.example" }, payload });
  assert.equal(foreign.statusCode, 403); assert.equal(foreign.json().error.code, "ORIGIN_REJECTED");
  const invalid = await app.inject({ method: "POST", url: "/api/agent-state/memory", payload: { ...payload, content: "" } }); assert.equal(invalid.statusCode, 400);
  const oversized = await app.inject({ method: "POST", url: "/api/agent-state/memory", payload: { ...payload, content: "x".repeat(20000) } }); assert.equal(oversized.statusCode, 413);
  assert.deepEqual(await store.listMemory(), []);
});
