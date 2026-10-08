import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ManagedRepository, ManagedRevisionConflict, ManagedWriterConflict } from "../../src/capabilities/management/repository.js";
import { emptyManagedState, validateManagedState, type ManagedConnectionRecord } from "../../src/capabilities/management/records.js";

const connection: ManagedConnectionRecord = { ref: "conn_notes", displayName: "Notes", provider: "memos", owner: "local-workspace", resource: "http://localhost:5230/mcp", scopes: [], enabled: true, auth: { kind: "stored", credentialRef: "notes-secret" } };
test("generations persist, stale edits fail and explicit seeds preserve managed records", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-management-"));
  let repository = await ManagedRepository.open(root);
  try {
    const first = await repository.mutate(0, draft => { draft.connections.push(connection); });
    assert.equal(first.revision, 1);
    first.connections[0].displayName = "Mutated returned copy";
    assert.equal(repository.read().connections[0].displayName, "Notes");
    await assert.rejects(repository.mutate(0, () => {}), ManagedRevisionConflict);
    await repository.importSeed({ connections: [{ ...connection, displayName: "Seed replacement" }], packages: [], profiles: [] }, 1);
    assert.equal(repository.read().connections[0].displayName, "Notes");
    await repository.close(); repository = await ManagedRepository.open(root);
    assert.equal(repository.read().revision, 2);
    assert.deepEqual(repository.read().connections[0], connection);
    assert.equal((await readFile(join(root, "generation-1.json"), "utf8")).includes("notes-secret"), true);
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});
test("invalid or interrupted mutation leaves the published generation usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-management-")); let repository = await ManagedRepository.open(root);
  try {
    await repository.mutate(0, draft => { draft.connections.push(connection); });
    await assert.rejects(repository.mutate(1, draft => { draft.connections[0].resource = "https://token:secret@example.com/mcp"; }));
    await assert.rejects(repository.mutate(1, () => { throw new Error("discovery interrupted"); }));
    const staged = repository.read(); staged.revision = 2; staged.connections[0].displayName = "Not published";
    await writeFile(join(root, "generation-2.json"), JSON.stringify(staged));
    await repository.close(); repository = await ManagedRepository.open(root);
    assert.equal(repository.read().revision, 1); assert.equal(repository.read().connections[0].displayName, "Notes");
    const next = await repository.mutate(1, draft => { draft.connections[0].displayName = "New publication"; });
    assert.equal(next.revision, 3);
    assert.equal(JSON.parse(await readFile(join(root, "generation-2.json"), "utf8")).connections[0].displayName, "Not published");
    assert.deepEqual((await repository.readGenerations()).map(state => state.revision), [1, 3]);
    await repository.close(); repository = await ManagedRepository.open(root);
    assert.deepEqual((await repository.generations()).map(state => state.revision), [1, 3]);
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});
test("one writer owns storage and dead PID owners are reclaimed", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-management-")); const repository = await ManagedRepository.open(root);
  try { await assert.rejects(ManagedRepository.open(root), ManagedWriterConflict); }
  finally { await repository.close(); }
  // Node's PID exceeds the Linux PID limit, making this safely nonexistent.
  await writeFile(join(root, "writer.lock"), JSON.stringify({ pid: 2147483647, token: "dead-owner" }));
  const replacement = await ManagedRepository.open(root);
  try { assert.equal(replacement.read().revision, 0); } finally { await replacement.close(); await rm(root, { recursive: true, force: true }); }
});
test("staged intents survive restart and reconcile explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-management-")); let repository = await ManagedRepository.open(root);
  try {
    await repository.mutate(0, draft => { draft.operations.push({ id: "install-one", kind: "install", status: "staged", resourceRef: "notes", startedAt: new Date().toISOString() }); });
    await repository.close(); repository = await ManagedRepository.open(root);
    assert.equal(repository.pendingOperations().length, 1);
    await repository.reconcileOperations(async operation => { assert.equal(operation.resourceRef, "notes"); return "abandoned"; });
    assert.equal(repository.pendingOperations().length, 0);
    assert.equal(repository.read().operations[0].status, "abandoned");
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});
test("record validation rejects plaintext secrets and cross-record mistakes", () => {
  const state = emptyManagedState(); state.connections.push(connection);
  assert.doesNotThrow(() => validateManagedState(state));
  assert.throws(() => validateManagedState({ ...state, secret: "do-not-persist" }));
  assert.throws(() => validateManagedState({ ...state, connections: [{ ...connection, auth: { kind: "stored", credentialRef: "notes-secret", token: "do-not-persist" } }] }));
  assert.throws(() => validateManagedState({ ...state, profiles: [{ id: "agent", version: "1.0.0", displayName: "Agent", packages: ["unknown"] }] }));
});
