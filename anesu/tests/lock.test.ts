import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionLock } from "../src/persistence/lock.js";
import { AnesuError } from "../src/runtime/errors.js";

test("session lock records an owner identity and rejects a live owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-lock-"));
  try {
    const lockPath = path.join(root, "session", ".lock");
    const lock = await SessionLock.acquire(lockPath);
    const record = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number; processIdentity?: unknown };
    assert.equal(record.pid, process.pid);
    if (process.platform === "linux") assert.ok(record.processIdentity);
    await assert.rejects(
      () => SessionLock.acquire(lockPath),
      (error: unknown) => error instanceof AnesuError && error.code === "lock" && /already in use/u.test(error.message),
    );
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session lock removes a live-pid lock when its Linux start identity is stale", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-lock-stale-"));
  try {
    const lockPath = path.join(root, "session", ".lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      createdAt: new Date(0).toISOString(),
      processIdentity: {
        platform: "linux",
        executablePath: "/definitely/not-the-current-node-executable",
        startTime: "not-the-current-start-token",
      },
    }));

    const lock = await SessionLock.acquire(lockPath);
    const record = JSON.parse(await readFile(lockPath, "utf8")) as { createdAt?: string };
    assert.notEqual(record.createdAt, new Date(0).toISOString());
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session lock keeps backwards-compatible PID-only ownership conservative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-lock-legacy-"));
  try {
    const lockPath = path.join(root, "session", ".lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date(0).toISOString() }));

    await assert.rejects(
      () => SessionLock.acquire(lockPath),
      (error: unknown) => error instanceof AnesuError && error.code === "lock" && /already in use/u.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session lock does not treat a non-positive PID as the current process group", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-lock-invalid-pid-"));
  try {
    const lockPath = path.join(root, "session", ".lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 0, createdAt: new Date(0).toISOString() }));

    const lock = await SessionLock.acquire(lockPath);
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session lock does not delete partially published metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-lock-partial-"));
  try {
    const lockPath = path.join(root, "session", ".lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "");

    await assert.rejects(
      () => SessionLock.acquire(lockPath, { waitMs: 1 }),
      (error: unknown) => error instanceof AnesuError && error.code === "lock" && /metadata is invalid/u.test(error.message),
    );
    assert.equal(await readFile(lockPath, "utf8"), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
