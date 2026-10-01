import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SessionStore } from "../src/persistence/session-store.js";

async function temporaryState(t: { after(callback: () => void | Promise<void>): void }): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lina-sessions-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeMessage(stateDir: string, sessionId: string, content: string): Promise<string> {
  const transcriptPath = path.join(stateDir, "sessions", sessionId, "transcript.jsonl");
  await writeFile(transcriptPath, `${JSON.stringify({
    schemaVersion: 1,
    messageId: "message_1",
    sessionId,
    turnId: "turn_1",
    role: "user",
    content,
    createdAt: "2026-09-24T10:00:00.000Z",
  })}\n`, "utf8");
  return transcriptPath;
}

test("recent session listing is sorted, limited, and gives a bounded last-message preview", async (t) => {
  const stateDir = await temporaryState(t);
  const older = await SessionStore.open(stateDir);
  const recent = await SessionStore.open(stateDir);
  const olderTranscript = await writeMessage(stateDir, older.metadata.sessionId, "Older conversation");
  const recentTranscript = await writeMessage(stateDir, recent.metadata.sessionId, "A recent request that is safe to preview");
  const base = Date.now();
  await utimes(olderTranscript, new Date(base - 2_000), new Date(base - 2_000));
  await utimes(recentTranscript, new Date(base - 1_000), new Date(base - 1_000));

  const sessions = await SessionStore.listRecentSessions(stateDir, 1);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.sessionId, recent.metadata.sessionId);
  assert.equal(sessions[0]?.state, "available");
  assert.equal(sessions[0]?.lastMessage?.role, "user");
  assert.equal(sessions[0]?.lastMessage?.preview, "A recent request that is safe to preview");
});

test("recent session listing exposes corrupt entries as unavailable and ignores symlinked directories", async (t) => {
  const stateDir = await temporaryState(t);
  const sessionsDirectory = path.join(stateDir, "sessions");
  await mkdir(sessionsDirectory, { recursive: true });
  const corruptId = "session_corrupt";
  const corruptDirectory = path.join(sessionsDirectory, corruptId);
  await mkdir(corruptDirectory);
  await writeFile(path.join(corruptDirectory, "session.json"), "not json", "utf8");

  const outsideDirectory = path.join(stateDir, "outside-session");
  await mkdir(outsideDirectory);
  await symlink(outsideDirectory, path.join(sessionsDirectory, "session_link"));

  const sessions = await SessionStore.listRecentSessions(stateDir);

  assert.deepEqual(sessions.map(({ sessionId, state }) => ({ sessionId, state })), [
    { sessionId: corruptId, state: "unavailable" },
  ]);
});

test("recent session listing reports an empty state directory and validates its result limit", async (t) => {
  const stateDir = await temporaryState(t);

  assert.deepEqual(await SessionStore.listRecentSessions(stateDir), []);
  await assert.rejects(() => SessionStore.listRecentSessions(stateDir, 0), /between 1 and 100/u);
  await assert.rejects(() => SessionStore.listRecentSessions(stateDir, 101), /between 1 and 100/u);
});
