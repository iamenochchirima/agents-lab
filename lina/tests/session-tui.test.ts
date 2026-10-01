import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { loadConfig } from "../src/config/config.js";
import type { ModelProvider } from "../src/models/provider.js";
import { SessionStore } from "../src/persistence/session-store.js";
import type { ModelRequest, ModelStreamEvent } from "../src/runtime/contracts.js";
import { runTurn } from "../src/runtime/turn.js";
import { parseTuiCommand, TerminalUi } from "../src/cli/tui.js";
import type { ChatApplication } from "../src/runtime/application.js";
import { asSessionId } from "../src/runtime/contracts.js";
import type { SessionSummary } from "../src/persistence/session-store.js";

function app(sessionId: string, calls: string[], closed: string[]): ChatApplication {
  return {
    sessionId,
    modelLabel: "test/model",
    providerLabel: "test/model",
    providerName: "deterministic",
    workspaceRoot: "/workspace",
    evidenceDirectory: `/state/sessions/${sessionId}`,
    toolNames: [],
    computer: { enabled: false },
    readContextSnapshot: async () => undefined,
    readTranscript: async () => [],
    recoverInterruptedTurns: async () => [],
    runTurn: async (prompt, _signal, onText) => {
      calls.push(`${sessionId}:${prompt}`);
      onText?.("ok");
      return {
        schemaVersion: 1,
        sessionId: asSessionId(sessionId),
        turnId: "turn_test" as never,
        status: "completed",
        provider: "deterministic",
        model: "test/model",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        assistantText: "ok",
      };
    },
    close: async () => { closed.push(sessionId); },
  } as ChatApplication;
}

function session(sessionId: string, preview: string): SessionSummary {
  return {
    sessionId: asSessionId(sessionId),
    state: "available",
    createdAt: "2026-09-24T10:00:00.000Z",
    lastActivityAt: "2026-09-24T10:00:00.000Z",
    lastMessage: { role: "user", preview },
  };
}

function tuiOutput(): { readonly output: Writable; readonly chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    output: new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } }),
  };
}

class RecordingSessionProvider implements ModelProvider {
  readonly provider = "deterministic" as const;
  readonly model = "recording/session-context";
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const prompt = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    yield { type: "text", text: `recorded:${prompt}` };
    yield { type: "completed", usage: { outputTokens: 1, totalTokens: 1 } };
  }
}

async function openRecordedSession(
  config: ReturnType<typeof loadConfig>,
  provider: ModelProvider,
  sessionId?: string,
): Promise<ChatApplication> {
  const store = await SessionStore.open(config.stateDir, sessionId);
  const lock = await store.acquireLock();
  return {
    sessionId: store.metadata.sessionId,
    modelLabel: provider.model,
    providerLabel: provider.model,
    providerName: provider.provider,
    workspaceRoot: config.workspaceRoot,
    evidenceDirectory: store.sessionDirectory,
    toolNames: [],
    computer: { enabled: false },
    readContextSnapshot: () => store.readLatestContextSnapshot(),
    recoverInterruptedTurns: () => store.recoverInterruptedTurns(),
    readTranscript: () => store.readTranscript(),
    runTurn: (userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess) => runTurn({
      session: store,
      provider,
      config,
      userPrompt,
      signal,
      onText,
      onEvent,
      approveMutation,
      onMutation,
      approveProcess,
      onProcess,
    }),
    close: () => lock.release(),
  };
}

async function waitUntil(predicate: () => boolean, description: string, diagnostic?: () => string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${description}.${diagnostic ? `\n${diagnostic().slice(-3_000)}` : ""}`);
}

test("session commands parse exact resume IDs and reject extra arguments", () => {
  assert.deepEqual(parseTuiCommand("/new"), { kind: "new-session" });
  assert.deepEqual(parseTuiCommand("/resume"), { kind: "resume-session" });
  assert.deepEqual(parseTuiCommand("/resume session_exact"), { kind: "resume-session", sessionId: "session_exact" });
  assert.deepEqual(parseTuiCommand("/resume one two"), { kind: "unknown", name: "/resume accepts at most one session ID" });
});

test("interactive /new changes the active application before routing the next prompt", async () => {
  const calls: string[] = [];
  const closed: string[] = [];
  const first = app("session_first", calls, closed);
  const next = app("session_new", calls, closed);
  const input = new PassThrough();
  const { output, chunks } = tuiOutput();
  const ui = new TerminalUi(first, output, false, [], {
    listRecent: async () => [],
    open: async () => next,
  });

  const running = ui.runInteractive(input);
  input.end("/new\nhello new conversation\n/quit\n");
  await running;
  await ui.close();

  assert.deepEqual(calls, ["session_new:hello new conversation"]);
  assert.deepEqual(closed.sort(), ["session_first", "session_new"]);
  assert.match(chunks.join(""), /Started new conversation session_new/u);
});

test("resume picker selects a displayed recent session and failed opening preserves the current session", async () => {
  const calls: string[] = [];
  const closed: string[] = [];
  const first = app("session_first", calls, closed);
  const resumed = app("session_resumed", calls, closed);
  const input = new PassThrough();
  const { output, chunks } = tuiOutput();
  let failNextOpen = true;
  const ui = new TerminalUi(first, output, false, [], {
    listRecent: async () => [session("session_first", "current"), session("session_resumed", "older request")],
    open: async (sessionId) => {
      if (failNextOpen) {
        failNextOpen = false;
        throw new Error("session lock is held");
      }
      assert.equal(sessionId, "session_resumed");
      return resumed;
    },
  });

  const running = ui.runInteractive(input);
  input.end("/resume session_resumed\nuse current\n/resume\n/cancel\n/resume\n2\nuse resumed\n/quit\n");
  await running;
  await ui.close();

  assert.deepEqual(calls, ["session_first:use current", "session_resumed:use resumed"]);
  assert.deepEqual(closed.sort(), ["session_first", "session_resumed"]);
  assert.match(chunks.join(""), /session lock is held/u);
  assert.match(chunks.join(""), /older request/u);
  assert.match(chunks.join(""), /Keeping the current conversation/u);
  assert.match(chunks.join(""), /Resumed conversation session_resumed/u);
});

test("session switching is refused while a turn is active", async () => {
  const calls: string[] = [];
  const closed: string[] = [];
  const current = app("session_busy", calls, closed);
  let finishTurn!: () => void;
  current.runTurn = async () => await new Promise((resolve) => {
    finishTurn = () => resolve({
      schemaVersion: 1,
      sessionId: asSessionId("session_busy"),
      turnId: "turn_busy" as never,
      status: "completed",
      provider: "deterministic",
      model: "test/model",
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      assistantText: "done",
    });
  });
  const { output, chunks } = tuiOutput();
  let openCount = 0;
  const ui = new TerminalUi(current, output, false, [], {
    listRecent: async () => [],
    open: async () => { openCount += 1; throw new Error("must not open while busy"); },
  });
  const turn = ui.runTurn("wait for work");

  assert.equal(await ui.runCommand({ kind: "new-session" }), true);
  assert.equal(openCount, 0);
  assert.match(chunks.join(""), /Finish or cancel the active turn/u);
  finishTurn();
  await turn;
  await ui.close();
});

test("real TUI sessions keep transcripts and model context separate across create, picker resume, and exact resume", { timeout: 45_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-session-tui-integration-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const config = loadConfig({
    stateDir: path.join(root, "state"),
    workspaceRoot: root,
    browserEnabled: false,
    computerEnabled: false,
    memoryEnabled: false,
    processMode: "deny",
  }, {});
  const provider = new RecordingSessionProvider();
  const opened: ChatApplication[] = [];
  const open = async (sessionId?: string): Promise<ChatApplication> => {
    const application = await openRecordedSession(config, provider, sessionId);
    opened.push(application);
    return application;
  };
  const first = await open();
  const firstId = first.sessionId;
  const input = new PassThrough();
  const { output, chunks } = tuiOutput();
  const ui = new TerminalUi(first, output, false, [], {
    listRecent: () => SessionStore.listRecentSessions(config.stateDir),
    open,
  });
  const running = ui.runInteractive(input);

  input.write("first conversation fact\n");
  await waitUntil(() => provider.requests.length === 1 && chunks.join("").includes("recorded:first conversation fact"), "first conversation turn", () => chunks.join(""));

  input.write(`/resume ${firstId.slice(0, 8)}\n`);
  await waitUntil(() => chunks.join("").includes("No conversation has that exact ID"), "exact-ID miss without prefix matching", () => chunks.join(""));

  input.write("/new\n");
  await waitUntil(() => opened.length === 2 && chunks.join("").includes("Started new conversation"), "new conversation", () => chunks.join(""));
  const secondId = opened[1]!.sessionId;
  input.write("second conversation fact\n");
  await waitUntil(() => provider.requests.length === 2 && chunks.join("").includes("recorded:second conversation fact"), "second conversation turn", () => chunks.join(""));

  input.write(`/resume ${firstId}\n`);
  await waitUntil(() => opened.length === 3 && chunks.join("").includes(`Resumed conversation ${firstId}`), "exact-ID resume", () => chunks.join(""));
  input.write("first follow-up\n");
  await waitUntil(() => provider.requests.length === 3 && chunks.join("").includes("recorded:first follow-up"), "first conversation follow-up", () => chunks.join(""));

  input.write("/resume\n");
  await waitUntil(() => chunks.join("").includes("Recent conversations"), "resume picker", () => chunks.join(""));
  input.write(`${secondId}\n`);
  await waitUntil(() => opened.length === 4 && chunks.join("").includes(`Resumed conversation ${secondId}`), "picker resume", () => chunks.join(""));
  input.write("second follow-up\n");
  await waitUntil(() => provider.requests.length === 4 && chunks.join("").includes("recorded:second follow-up"), "second conversation follow-up", () => chunks.join(""));

  input.end("/quit\n");
  await running;
  await ui.close();

  const firstTranscript = await (await SessionStore.open(config.stateDir, firstId)).readTranscript();
  const secondTranscript = await (await SessionStore.open(config.stateDir, secondId)).readTranscript();
  assert.deepEqual(firstTranscript.filter((message) => message.role === "user").map((message) => message.content), [
    "first conversation fact",
    "first follow-up",
  ]);
  assert.deepEqual(secondTranscript.filter((message) => message.role === "user").map((message) => message.content), [
    "second conversation fact",
    "second follow-up",
  ]);

  const requestContext = (request: ModelRequest): string => request.messages.map((message) => message.content ?? "").join("\n");
  const firstFollowUpRequest = provider.requests.find((request) => request.sessionId === firstId && request.messages.some((message) => message.role === "user" && message.content === "first follow-up"));
  const secondFollowUpRequest = provider.requests.find((request) => request.sessionId === secondId && request.messages.some((message) => message.role === "user" && message.content === "second follow-up"));
  assert.ok(firstFollowUpRequest);
  assert.ok(secondFollowUpRequest);
  assert.match(requestContext(firstFollowUpRequest), /first conversation fact/u);
  assert.doesNotMatch(requestContext(firstFollowUpRequest), /second conversation fact/u);
  assert.match(requestContext(secondFollowUpRequest), /second conversation fact/u);
  assert.doesNotMatch(requestContext(secondFollowUpRequest), /first conversation fact/u);
});

test("failed exact-ID, corrupt, and locked resumes leave the active real conversation usable", { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-session-resume-failures-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const config = loadConfig({
    stateDir: path.join(root, "state"),
    workspaceRoot: root,
    browserEnabled: false,
    computerEnabled: false,
    memoryEnabled: false,
    processMode: "deny",
  }, {});
  const provider = new RecordingSessionProvider();
  const current = await openRecordedSession(config, provider);
  const lockedStore = await SessionStore.open(config.stateDir);
  const lockedSessionId = lockedStore.metadata.sessionId;
  const heldLock = await lockedStore.acquireLock();
  const corruptSessionId = "session_corrupt_metadata";
  const corruptDirectory = path.join(config.stateDir, "sessions", corruptSessionId);
  await mkdir(corruptDirectory, { recursive: true });
  const corruptMetadata = path.join(corruptDirectory, "session.json");
  await writeFile(corruptMetadata, "not-json", "utf8");
  const recoveryStore = await SessionStore.open(config.stateDir);
  const recoverySessionId = recoveryStore.metadata.sessionId;
  const recoveryTurnRecord = path.join(recoveryStore.sessionDirectory, "turns", "turn_recovery_invalid", "turn.json");
  await mkdir(path.dirname(recoveryTurnRecord), { recursive: true });
  await writeFile(recoveryTurnRecord, "not-json", "utf8");
  t.after(async () => await heldLock.release());

  const openedSessionIds: string[] = [];
  const { output, chunks } = tuiOutput();
  const input = new PassThrough();
  const ui = new TerminalUi(current, output, false, [], {
    listRecent: () => SessionStore.listRecentSessions(config.stateDir),
    open: async (sessionId) => {
      const application = await openRecordedSession(config, provider, sessionId);
      try {
        await application.recoverInterruptedTurns();
      } catch (error) {
        await application.close();
        throw error;
      }
      openedSessionIds.push(application.sessionId);
      return application;
    },
  });
  const running = ui.runInteractive(input);

  input.write("/resume missing_session_exact\n");
  await waitUntil(() => chunks.join("").includes("No conversation has that exact ID"), "exact-ID miss message", () => chunks.join(""));
  input.write(`/resume ${corruptSessionId}\n`);
  await waitUntil(() => chunks.join("").includes("conversation not switched · Could not read durable record 'session.json'"), "corrupt-session message", () => chunks.join(""));
  input.write(`/resume ${lockedSessionId}\n`);
  await waitUntil(() => chunks.join("").includes("conversation not switched · Session is already in use by process"), "lock-held message", () => chunks.join(""));
  input.write(`/resume ${recoverySessionId}\n`);
  await waitUntil(() => chunks.join("").includes("conversation not switched · Turn 'turn_recovery_invalid' has no valid turn record"), "recovery-required message", () => chunks.join(""));
  input.write("current conversation still works\n");
  await waitUntil(() => provider.requests.some((request) => request.sessionId === current.sessionId && request.messages.some((message) => message.role === "user" && message.content === "current conversation still works")), "turn on the original session", () => chunks.join(""));
  await waitUntil(() => chunks.join("").includes("recorded:current conversation still works"), "original session response", () => chunks.join(""));

  input.end("/quit\n");
  await running;
  await ui.close();
  assert.deepEqual(openedSessionIds, []);
  assert.equal(await readFile(corruptMetadata, "utf8"), "not-json");
  assert.equal(await readFile(recoveryTurnRecord, "utf8"), "not-json");
  const recoveryLockStore = await SessionStore.open(config.stateDir, recoverySessionId);
  const recoveryLock = await recoveryLockStore.acquireLock();
  await recoveryLock.release();
  const transcript = await (await SessionStore.open(config.stateDir, current.sessionId)).readTranscript();
  assert.deepEqual(transcript.filter((message) => message.role === "user").map((message) => message.content), [
    "current conversation still works",
  ]);
});
