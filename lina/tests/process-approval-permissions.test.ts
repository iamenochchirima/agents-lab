import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LinaError } from "../src/runtime/errors.js";
import { ProcessApprovalPermissions } from "../src/persistence/process-approval-permissions.js";
import { processPermissionIdentity, type PreparedProcess } from "../src/process/process.js";

async function setup(t: { after(callback: () => void | Promise<void>): void }): Promise<{
  readonly stateDir: string;
  readonly sessionDirectory: string;
  readonly permissions: ProcessApprovalPermissions;
}> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-process-permissions-"));
  const sessionId = "session_current";
  const sessionDirectory = path.join(stateDir, "sessions", sessionId);
  await mkdir(sessionDirectory, { recursive: true });
  t.after(async () => await rm(stateDir, { recursive: true, force: true }));
  return {
    stateDir,
    sessionDirectory,
    permissions: new ProcessApprovalPermissions(stateDir, sessionDirectory, sessionId, "default"),
  };
}

function prepared(overrides: Partial<PreparedProcess> = {}): PreparedProcess {
  return {
    executionId: "execution_test",
    command: "/usr/bin/printf",
    args: ["%s", "hello"],
    displayArgs: ["%s", "hello"],
    cwd: ".",
    cwdAbsolutePath: "/workspace",
    cwdIdentity: { device: 1, inode: 2, mode: 0o755, size: 0, modifiedAtMs: 1 },
    executablePath: "/usr/bin/printf",
    executableIdentity: { device: 1, inode: 3, mode: 0o755, size: 20, modifiedAtMs: 2, contentHash: "a".repeat(64) },
    argvHash: "b".repeat(64),
    environment: { PATH: "/usr/bin", HOME: "/home/test" },
    environmentProfile: "sanitized-default",
    environmentKeys: ["HOME", "PATH"],
    limits: { timeoutMs: 10_000, terminationGraceMs: 500, maxOutputBytes: 4096, maxArgumentCount: 32, maxArgumentBytes: 8192 },
    ...overrides,
  };
}

test("process permission identity is stable but changes with arguments, cwd, environment, limits, or executable", () => {
  const initial = prepared();
  const identity = processPermissionIdentity(initial);
  assert.match(identity, /^[a-f0-9]{64}$/u);
  assert.equal(processPermissionIdentity({ ...initial }), identity);
  assert.notEqual(processPermissionIdentity({ ...initial, argvHash: "c".repeat(64) }), identity);
  assert.notEqual(processPermissionIdentity({ ...initial, cwdAbsolutePath: "/other" }), identity);
  assert.notEqual(processPermissionIdentity({ ...initial, environment: { PATH: "/bin", HOME: "/home/test" } }), identity);
  assert.notEqual(processPermissionIdentity({ ...initial, executableIdentity: { ...initial.executableIdentity, contentHash: "d".repeat(64) } }), identity);
  assert.notEqual(processPermissionIdentity({ ...initial, limits: { ...initial.limits, timeoutMs: 9_000 } }), identity);
});

test("conversation and local process permissions persist independently and revoke by exact ID", async (t) => {
  const { stateDir, sessionDirectory, permissions } = await setup(t);
  const firstHash = "1".repeat(64);
  const localHash = "2".repeat(64);
  const conversationGrant = await permissions.save("conversation", firstHash, "/usr/bin/printf · args 1a2b · cwd .");
  const localGrant = await permissions.save("local", localHash, "/usr/bin/id · args 2b3c · cwd .");

  assert.equal((await permissions.find(firstHash))?.id, conversationGrant.id);
  assert.equal((await permissions.find(localHash))?.id, localGrant.id);
  assert.ok((await permissions.find(firstHash))?.lastUsedAt);
  assert.equal(await permissions.find("3".repeat(64)), undefined);
  assert.deepEqual((await permissions.list()).map(({ id, scope }) => ({ id, scope })).sort((a, b) => a.scope.localeCompare(b.scope)), [
    { id: conversationGrant.id, scope: "conversation" },
    { id: localGrant.id, scope: "local" },
  ]);

  const otherSession = new ProcessApprovalPermissions(stateDir, path.join(stateDir, "sessions", "session_other"), "session_other", "default");
  const resumedSession = new ProcessApprovalPermissions(stateDir, sessionDirectory, "session_current", "default");
  assert.equal((await resumedSession.find(firstHash))?.id, conversationGrant.id);
  assert.equal((await resumedSession.find(localHash))?.id, localGrant.id);
  assert.equal((await otherSession.find(localHash))?.scope, "local");
  assert.equal(await otherSession.find(firstHash), undefined);
  assert.equal(await otherSession.revoke(conversationGrant.id), false);

  assert.equal(await permissions.revoke(conversationGrant.id), true);
  assert.equal(await permissions.revoke(conversationGrant.id), false);
  assert.equal(await permissions.find(firstHash), undefined);
  assert.equal((await permissions.find(localHash))?.id, localGrant.id);
  assert.ok(sessionDirectory.endsWith("session_current"));
});

test("local permission writes serialize concurrent grants and do not persist argument secrets", async (t) => {
  const { stateDir, permissions } = await setup(t);
  const secret = "credential-value-that-must-not-be-stored";
  const identity = createHash("sha256").update(JSON.stringify({ argv: ["/usr/bin/printf", secret] })).digest("hex");
  await Promise.all([
    permissions.save("local", identity, "/usr/bin/printf · arguments withheld · cwd ."),
    permissions.save("local", "4".repeat(64), `/usr/bin/printf · argv ${"4".repeat(12)} · cwd .`),
  ]);
  const content = await readFile(path.join(stateDir, "permissions", "default", "process.json"), "utf8");
  assert.equal((await permissions.list()).filter((grant) => grant.scope === "local").length, 2);
  assert.doesNotMatch(content, new RegExp(secret, "u"));
  assert.match(content, /identityHash/u);
});

test("malformed or symlinked permission files fail closed", async (t) => {
  const { stateDir, permissions } = await setup(t);
  const directory = path.join(stateDir, "permissions", "default");
  await mkdir(directory, { recursive: true });
  const permissionFile = path.join(directory, "process.json");
  await writeFile(permissionFile, "not-json", "utf8");
  await assert.rejects(() => permissions.find("5".repeat(64)), (error: unknown) => error instanceof LinaError && error.code === "persistence");
  await rm(permissionFile);
  const external = path.join(stateDir, "outside.json");
  await writeFile(external, JSON.stringify({ schemaVersion: 1, grants: [] }), "utf8");
  await symlink(external, permissionFile);
  await assert.rejects(() => permissions.find("5".repeat(64)), (error: unknown) => error instanceof LinaError && error.code === "persistence");
});
