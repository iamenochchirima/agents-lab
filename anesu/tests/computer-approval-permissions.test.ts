import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ComputerApprovalPermissions } from "../src/persistence/computer-approval-permissions.js";
import { AnesuError } from "../src/runtime/errors.js";

async function setup(t: { after(callback: () => void | Promise<void>): void }): Promise<{
  readonly root: string;
  readonly directory: string;
  readonly permissions: ComputerApprovalPermissions;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-permissions-"));
  const directory = path.join(root, "sessions", "session_current");
  await mkdir(directory, { recursive: true });
  t.after(async () => await rm(root, { recursive: true, force: true }));
  return { root, directory, permissions: new ComputerApprovalPermissions(directory, "session_current") };
}

function storedGrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `computer_${"1".repeat(32)}`,
    scope: "conversation",
    sessionId: "session_current",
    matcherHash: "a".repeat(64),
    label: "Open the task workspace",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("computer permissions persist only within the bound conversation and revoke by exact ID", async (t) => {
  const { root, directory, permissions } = await setup(t);
  const hash = "a".repeat(64);
  const grant = await permissions.save(hash, "  Open the task workspace  ");
  assert.match(grant.id, /^computer_[a-f0-9]{32}$/u);
  assert.equal(grant.scope, "conversation");
  assert.equal(grant.label, "Open the task workspace");
  assert.equal((await permissions.save(hash, "Different display label")).id, grant.id);
  assert.equal((await permissions.find(hash))?.id, grant.id);
  assert.ok((await permissions.find(hash))?.lastUsedAt);

  const resumed = new ComputerApprovalPermissions(directory, "session_current");
  assert.deepEqual((await resumed.list()).map(({ id }) => id), [grant.id]);
  assert.equal((await resumed.find(hash))?.id, grant.id);
  const other = new ComputerApprovalPermissions(path.join(root, "sessions", "session_other"), "session_other");
  assert.equal(await other.find(hash), undefined);
  assert.deepEqual(await other.list(), []);
  assert.equal(await other.revoke(grant.id), false);
  assert.equal(await permissions.revoke("local_" + grant.id.slice(13)), false);
  assert.equal(await permissions.revoke(grant.id), true);
  assert.equal(await permissions.revoke(grant.id), false);
  assert.equal(await permissions.find(hash), undefined);
});

test("concurrent saves serialize and store only a matcher hash and safe display label", async (t) => {
  const { directory, permissions } = await setup(t);
  const secret = "credential-value-that-must-not-be-stored";
  const rawGoal = "Use my private account to finish the request";
  const hash = createHash("sha256").update(JSON.stringify({ rawGoal, secret })).digest("hex");
  const [first, duplicate] = await Promise.all([
    permissions.save(hash, "Desktop task"),
    permissions.save(hash, "Desktop task"),
  ]);
  await Promise.all([
    permissions.save("b".repeat(64), "Browser task"),
    permissions.save("c".repeat(64), "File task"),
  ]);
  const content = await readFile(path.join(directory, "computer-permissions.json"), "utf8");
  assert.equal(first.id, duplicate.id);
  assert.equal((await permissions.list()).length, 3);
  assert.match(content, /matcherHash/u);
  assert.doesNotMatch(content, /credential-value|private account/u);
  assert.doesNotMatch(JSON.stringify(await permissions.list()), /matcherHash|sessionId/u);
});

test("invalid matcher hashes, labels, and session IDs cannot be saved", async (t) => {
  const { directory, permissions } = await setup(t);
  assert.equal(await permissions.find("not-a-hash"), undefined);
  assert.equal(await permissions.revoke("computer_other"), false);
  for (const hash of ["a".repeat(63), "A".repeat(64)]) {
    await assert.rejects(() => permissions.save(hash, "Task"), (error: unknown) => error instanceof AnesuError && error.code === "invalid-input");
  }
  for (const label of [" ", "a".repeat(513), "Task\nsecret"]) {
    await assert.rejects(() => permissions.save("a".repeat(64), label), (error: unknown) => error instanceof AnesuError && error.code === "invalid-input");
  }
  assert.throws(() => new ComputerApprovalPermissions(directory, "../other"), (error: unknown) => error instanceof AnesuError && error.code === "invalid-input");
});

test("malformed, cross-session, duplicated, oversized, and symlinked files fail closed", async (t) => {
  const { root, directory, permissions } = await setup(t);
  const file = path.join(directory, "computer-permissions.json");
  const hash = "a".repeat(64);
  const rejectRead = async () => assert.rejects(() => permissions.find(hash), (error: unknown) => error instanceof AnesuError && error.code === "persistence");
  await writeFile(file, "not-json", "utf8");
  await rejectRead();
  await assert.rejects(() => permissions.save(hash, "Task"), (error: unknown) => error instanceof AnesuError && error.code === "persistence");
  for (const grants of [
    [storedGrant({ sessionId: "session_other" })],
    [storedGrant(), storedGrant()],
    [storedGrant({ matcherHash: "not-a-hash" })],
    [storedGrant({ label: "Task\nsecret" })],
    Array.from({ length: 129 }, (_, index) => storedGrant({ id: `computer_${index.toString(16).padStart(32, "0")}` })),
  ]) {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, grants }), "utf8");
    await rejectRead();
  }
  await writeFile(file, " ".repeat(512 * 1024 + 1), "utf8");
  await rejectRead();
  await rm(file);
  const external = path.join(root, "outside.json");
  await writeFile(external, JSON.stringify({ schemaVersion: 1, grants: [] }), "utf8");
  await symlink(external, file);
  await rejectRead();
});

test("a symlinked session directory is rejected before writing grants", async (t) => {
  const { root, directory } = await setup(t);
  const link = path.join(root, "linked-session");
  await symlink(directory, link);
  const permissions = new ComputerApprovalPermissions(link, "session_current");
  await assert.rejects(() => permissions.save("a".repeat(64), "Task"), (error: unknown) => error instanceof AnesuError && error.code === "persistence");
});
