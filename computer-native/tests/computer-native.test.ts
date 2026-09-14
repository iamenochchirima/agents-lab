import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/config.js";
import { buildInitialContext } from "../src/context/context.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { OpenRouterModelProvider } from "../src/models/openrouter.js";
import { atomicWriteJson } from "../src/persistence/json.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { ComputerNativeError } from "../src/runtime/errors.js";
import { asSessionId, asTurnId, type ModelRequest, type TurnRecord } from "../src/runtime/contracts.js";
import { allowedTransitions, assertTransition } from "../src/runtime/state.js";
import { runTurn } from "../src/runtime/turn.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

beforeEach(async () => {
  temporaryDirectories.push(await mkdtemp(path.join(os.tmpdir(), "computer-native-test-")));
});

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

function tempDirectory(): string {
  const directory = temporaryDirectories.at(-1);
  assert.ok(directory);
  return directory;
}

function config(stateDir: string, overrides: Partial<Parameters<typeof loadConfig>[0]> = {}) {
  return loadConfig({ stateDir, ...overrides }, {});
}

async function openSession(stateDir: string): Promise<SessionStore> {
  return SessionStore.open(stateDir);
}

test("configuration has safe deterministic defaults and rejects missing OpenRouter credentials", () => {
  const deterministic = config(tempDirectory());
  assert.equal(deterministic.provider, "deterministic");
  assert.equal(deterministic.model, "deterministic/echo");
  assert.equal(deterministic.timeoutMs, 30_000);
  assert.equal(deterministic.openRouterApiKey, undefined);
  assert.throws(
    () => config(tempDirectory(), { provider: "openrouter", model: "openai/example" }),
    (error: unknown) => error instanceof ComputerNativeError && error.code === "configuration",
  );
});

test("initial context is bounded to the declared instruction and prompt", () => {
  const request = buildInitialContext({
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Answer briefly.",
    userPrompt: "Hello",
  });
  assert.deepEqual(request.messages, [
    { role: "system", content: "Answer briefly." },
    { role: "user", content: "Hello" },
  ]);
  assert.throws(() => buildInitialContext({
    sessionId: request.sessionId,
    turnId: request.turnId,
    provider: request.provider,
    model: request.model,
    initialInstruction: "Answer briefly.",
    userPrompt: " ",
  }), /message is required/);
});

test("turn state transitions accept the first lifecycle and reject terminal rewrites", () => {
  assert.deepEqual(allowedTransitions("idle"), ["submitting"]);
  assert.doesNotThrow(() => assertTransition("submitting", "streaming"));
  assert.doesNotThrow(() => assertTransition("streaming", "interrupted"));
  assert.throws(() => assertTransition("completed", "streaming"), /Invalid turn transition/);
});

test("deterministic local provider produces repeatable chunks without network access", async () => {
  const request = buildInitialContext({
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Answer briefly.",
    userPrompt: "Hello",
  });
  const collect = async () => {
    const result: string[] = [];
    for await (const event of new DeterministicModelProvider("deterministic/echo", { response: "deterministic" }).stream(request, new AbortController().signal)) {
      if (event.type === "text") result.push(event.text);
    }
    return result.join("");
  };
  assert.equal(await collect(), "deterministic");
  assert.equal(await collect(), "deterministic");
});

test("successful turn persists ordered transcript, events, and result", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/echo", { response: "hello from deterministic provider" }),
    config: config(stateDir),
    userPrompt: "Say hello.",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "hello from deterministic provider");
  assert.match(result.sessionId, /^session_[a-f0-9]{32}$/u);
  assert.match(result.turnId, /^turn_[a-f0-9]{32}$/u);
  const transcript = await session.readTranscript();
  assert.deepEqual(transcript.map((message) => message.role), ["user", "assistant"]);
  assert.equal(transcript[0]?.turnId, result.turnId);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { sequence: number; sessionId: string; turnId: string; type: string });
  assert.deepEqual(events.map((event) => event.type), ["TurnStarted", "ModelRequested", "ModelCompleted", "TurnCompleted"]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4]);
  assert.ok(events.every((event) => event.sessionId === result.sessionId && event.turnId === result.turnId));
});

test("resuming a session appends a second ordered turn", async () => {
  const stateDir = tempDirectory();
  const firstSession = await openSession(stateDir);
  await runTurn({ session: firstSession, provider: new DeterministicModelProvider("deterministic/echo", { response: "one" }), config: config(stateDir), userPrompt: "first" });
  const resumed = await SessionStore.open(stateDir, firstSession.metadata.sessionId);
  await runTurn({ session: resumed, provider: new DeterministicModelProvider("deterministic/echo", { response: "two" }), config: config(stateDir), userPrompt: "second" });
  const transcript = await resumed.readTranscript();
  assert.deepEqual(transcript.map((message) => message.content), ["first", "one", "second", "two"]);
});

test("provider failure records the user message without an assistant", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const result = await runTurn({ session, provider: new DeterministicModelProvider("deterministic/echo", { behavior: "failure" }), config: config(stateDir), userPrompt: "fail" });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "provider");
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
});

test("timeout and cancellation produce distinct terminal results", async () => {
  const timeoutDir = tempDirectory();
  const timeoutSession = await openSession(timeoutDir);
  const timedOut = await runTurn({
    session: timeoutSession,
    provider: new DeterministicModelProvider("deterministic/echo", { behavior: "timeout" }),
    config: config(timeoutDir, { timeoutMs: 15 }),
    userPrompt: "timeout",
  });
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.error?.code, "timeout");

  const cancelDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-cancel-"));
  temporaryDirectories.push(cancelDir);
  const cancelSession = await openSession(cancelDir);
  const controller = new AbortController();
  setTimeout(() => controller.abort("cancelled"), 10);
  const cancelled = await runTurn({
    session: cancelSession,
    provider: new DeterministicModelProvider("deterministic/echo", { delayMs: 50, response: "a long response" }),
    config: config(cancelDir, { timeoutMs: 1000 }),
    userPrompt: "cancel",
    signal: controller.signal,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error?.code, "cancelled");
});

test("restart finalizes a non-terminal turn as interrupted without a model call", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("crash after admission", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await turn.appendEvent("ModelRequested", { provider: "deterministic", model: "deterministic/echo" });
  await turn.updateState("streaming");
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  assert.equal((await restarted.readTranscript()).filter((message) => message.role === "assistant").length, 0);
  const eventsPath = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turn.turnId, "events.jsonl");
  assert.match(await readFile(eventsPath, "utf8"), /TurnInterrupted/);
});

test("restart after user admission but before model invocation records interruption", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  await session.admitTurn("crash before invocation", "deterministic", "deterministic/echo");
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.error?.code, "interrupted");
  assert.equal((await restarted.readTranscript()).filter((message) => message.role === "assistant").length, 0);
});

test("missing user message is reported as a repairable incomplete record", async () => {
  const stateDir = tempDirectory();
  const sessionId = "session_manual";
  const turnId = "turn_manual";
  const turnDirectory = path.join(stateDir, "sessions", sessionId, "turns", turnId);
  await mkdir(turnDirectory, { recursive: true });
  await atomicWriteJson(path.join(stateDir, "sessions", sessionId, "session.json"), {
    schemaVersion: 1,
    sessionId,
    createdAt: new Date().toISOString(),
    source: "cli",
    profileId: "default",
  });
  const record: TurnRecord = {
    schemaVersion: 1,
    sessionId: asSessionId(sessionId),
    turnId: asTurnId(turnId),
    provider: "deterministic",
    model: "deterministic/echo",
    state: "submitting",
    userMessagePersisted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(turnDirectory, "turn.json"), record);
  const opened = await SessionStore.open(stateDir, sessionId);
  await assert.rejects(() => opened.recoverInterruptedTurns(), /user message is missing/);
});

test("malformed turn records are rejected without overwriting the evidence", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("malformed record", "deterministic", "deterministic/echo");
  const turnPath = path.join(turn.directory, "turn.json");
  await writeFile(turnPath, "{not-json\n", "utf8");
  const opened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => opened.recoverInterruptedTurns(), /no valid turn record/);
  assert.equal(await readFile(turnPath, "utf8"), "{not-json\n");
});

test("provider errors redact authorization material", async () => {
  const provider = new OpenRouterModelProvider("openai/example", "secret-key", async () => new Response("Bearer secret-key", { status: 401 }));
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  await assert.rejects(
    async () => {
      for await (const _event of provider.stream(request, new AbortController().signal)) {
        void _event;
      }
    },
    (error: unknown) => error instanceof Error && !error.message.includes("secret-key") && error.message.includes("HTTP 401"),
  );
});

test("OpenRouter adapter parses streamed text and usage without exposing credentials", async () => {
  let requestHeaders: Headers | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "stream-secret", async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(stream, { status: 200 });
  });
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  const events = [];
  for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [
    { type: "text", text: "hello" },
    { type: "completed", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
  ]);
  assert.equal(requestHeaders?.get("authorization"), "Bearer stream-secret");
});

test("non-interactive CLI runs against the deterministic local provider", async () => {
  const stateDir = tempDirectory();
  const cli = path.resolve("dist/src/cli/main.js");
  const result = await execFileAsync(process.execPath, [cli, "chat", "--state-dir", stateDir, "--message", "cli test"]);
  assert.match(result.stdout, /Deterministic response to: cli test/);
  assert.match(result.stdout, /Ready for your next message/);
});
