import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "../src/memory/store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function openTools() {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-tools-"));
  temporaryDirectories.push(root);
  const stateDir = path.join(root, "state");
  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 100, maxTreeEntries: 500, maxTreeBytes: 1024 * 1024, maxTreeDepth: 16 });
  const store = await MemoryStore.open({ stateDir, profileId: "default", workspaceId: "workspace-test" });
  const registry = new ToolRegistry(workspace, 16 * 1024, undefined, undefined, { store, maxResults: 10 });
  return { store, registry };
}

function call(callId: string, name: string, args: Record<string, unknown>) {
  return { callId, name, argumentsJson: JSON.stringify(args) } as const;
}

test("memory tools expose bounded reads and approval-gated writes", async () => {
  const { store, registry } = await openTools();
  const events: string[] = [];
  const approved = await registry.execute(
    call("call_add", "memory", { operation: "add", scope: "user", content: "The user prefers concise answers." }),
    {
      approveMemory: async () => ({ decision: "allow-once" }),
      onMemory: async (event) => { events.push(event.type); },
    },
  );
  assert.equal(approved.ok, true);
  assert.deepEqual(events, ["prepared", "approval_decided", "committed"]);

  const search = await registry.execute(call("call_search", "memory_search", { query: "concise answers" }));
  assert.equal(search.ok, true);
  assert.match(search.content, /concise answers/u);

  const blocked = await registry.execute(
    call("call_blocked", "memory", { operation: "add", scope: "user", content: "This should not be persisted." }),
    { approveMemory: async () => ({ decision: "deny", reason: "not now" }) },
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.content, /not written/u);
  assert.deepEqual(await store.search({ query: "not be persisted" }), []);
  await store.close();
});

test("memory forget requires an exact current hash and approval", async () => {
  const { store, registry } = await openTools();
  const added = await store.add({ scope: "workspace", content: "Workspace memory", provenance: { source: "user", sourceId: "turn", trust: "user" } });
  const forgotten = await registry.execute(
    call("call_forget", "memory_forget", { recordId: added.id, expectedContentHash: added.contentHash }),
    { approveMemory: async () => ({ decision: "allow-once" }) },
  );
  assert.equal(forgotten.ok, true);
  assert.deepEqual(await store.search({ query: "Workspace memory" }), []);
  await store.close();
});

test("the memory tool also accepts an explicit remove action with the same approval contract", async () => {
  const { store, registry } = await openTools();
  const added = await store.add({ scope: "user", content: "Remove through the memory action", provenance: { source: "user", sourceId: "turn", trust: "user" } });
  const removed = await registry.execute(
    call("call_remove", "memory", { operation: "remove", recordId: added.id, expectedContentHash: added.contentHash }),
    { approveMemory: async () => ({ decision: "allow-once" }) },
  );
  assert.equal(removed.ok, true);
  assert.equal(await store.get(added.id), undefined);
  await store.close();
});

test("memory_get supports a bounded exact line range", async () => {
  const { store, registry } = await openTools();
  const added = await store.add({ scope: "daily", date: "2026-09-16", content: "first\nsecond\nthird", provenance: { source: "user", sourceId: "turn", trust: "user" } });
  const result = await registry.execute(call("call_get", "memory_get", { recordId: added.id, startLine: 2, endLine: 2 }));
  assert.equal(result.ok, true);
  assert.match(result.content, /second/u);
  assert.doesNotMatch(result.content, /first/u);
  await store.close();
});

test("memory consolidation batches are bounded, exact, and approval-gated", async () => {
  const { store, registry } = await openTools();
  const events: string[] = [];
  const result = await registry.execute(
    call("call_batch", "memory", {
      operation: "batch",
      items: [
        { operation: "add", scope: "workspace", content: "The project uses pnpm." },
        { operation: "add", scope: "workspace", content: "The project keeps evidence inspectable." },
      ],
    }),
    {
      approveMemory: async (request) => {
        assert.equal(request.operation, "batch");
        assert.equal(request.batch?.length, 2);
        assert.equal(request.approvalTimeoutMs, 120_000);
        return { decision: "allow-once" };
      },
      onMemory: async (event) => { events.push(event.type); },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["prepared", "approval_decided", "committed", "committed"]);
  assert.equal((await store.search({ query: "project", scopes: ["workspace"] })).length, 2);
  await store.close();
});
