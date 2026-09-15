import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import { buildInitialContext } from "../src/context/context.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { OpenRouterModelProvider } from "../src/models/openrouter.js";
import { atomicWriteJson } from "../src/persistence/json.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { ComputerNativeError } from "../src/runtime/errors.js";
import { asSessionId, asTurnId, type ModelRequest, type TurnRecord } from "../src/runtime/contracts.js";
import { allowedTransitions, assertTransition } from "../src/runtime/state.js";
import { runTurn } from "../src/runtime/turn.js";
import { parseArgs } from "../src/cli/args.js";
import { parseTuiCommand } from "../src/cli/tui.js";

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

test("local environment loading preserves explicit variables and reads development settings", async () => {
  const envPath = path.join(tempDirectory(), ".env");
  await writeFile(envPath, "COMPUTER_NATIVE_PROVIDER=openrouter\nOPENROUTER_MODEL='openrouter/free'\nLOCAL_ONLY=from-file\n", "utf8");
  const environment = await loadLocalEnvironment(envPath, {
    COMPUTER_NATIVE_PROVIDER: "deterministic",
    EXISTING: "preserved",
  });
  assert.equal(environment.COMPUTER_NATIVE_PROVIDER, "deterministic");
  assert.equal(environment.OPENROUTER_MODEL, "openrouter/free");
  assert.equal(environment.LOCAL_ONLY, "from-file");
  assert.equal(environment.EXISTING, "preserved");
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

test("initial context carries only bounded prior transcript history", () => {
  const request = buildInitialContext({
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Answer briefly.",
    userPrompt: "Current question",
    history: Array.from({ length: 14 }, (_, index) => ({
      schemaVersion: 1 as const,
      messageId: `message_${index}`,
      sessionId: asSessionId("session_test"),
      turnId: asTurnId(`turn_${index}`),
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `history ${index}`,
      createdAt: new Date(0).toISOString(),
    })),
  });
  assert.deepEqual(request.messages.map((message) => message.content), [
    "Answer briefly.",
    ...Array.from({ length: 12 }, (_, index) => `history ${index + 2}`),
    "Current question",
  ]);
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

test("deterministic provider preserves multiline response chunks", async () => {
  const request = buildInitialContext({
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "deterministic",
    model: "deterministic/echo",
    initialInstruction: "Answer briefly.",
    userPrompt: "Hello",
  });
  const chunks: string[] = [];
  for await (const event of new DeterministicModelProvider("deterministic/echo", { response: "line one\nline two" }).stream(request, new AbortController().signal)) {
    if (event.type === "text") chunks.push(event.text);
  }
  assert.equal(chunks.join(""), "line one\nline two");
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
  assert.deepEqual({
    modelRequestCount: result.metrics?.modelRequestCount,
    toolCallCount: result.metrics?.toolCallCount,
    roundCount: result.metrics?.roundCount,
    cost: result.metrics?.cost,
  }, { modelRequestCount: 1, toolCallCount: 0, roundCount: 1, cost: null });
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

test("resuming a session sends bounded transcript history to the next model request", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const requests: ModelRequest[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/capture",
    async *stream(request: ModelRequest): AsyncIterable<{ readonly type: "text"; readonly text: string } | { readonly type: "completed" }> {
      requests.push({ ...request, messages: [...request.messages] });
      yield { type: "text", text: "answer" };
      yield { type: "completed" };
    },
  };
  await runTurn({ session, provider, config: config(stateDir), userPrompt: "first" });
  await runTurn({ session, provider, config: config(stateDir), userPrompt: "second" });
  assert.deepEqual(requests[1]?.messages.map((message) => message.content), [
    config(stateDir).initialInstruction,
    "first",
    "answer",
    "second",
  ]);
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

test("restart during a recorded tool round interrupts without replay", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("crash during tool", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await turn.appendRound({
    schemaVersion: 1,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    round: 1,
    phase: "model_requested",
    recordedAt: new Date().toISOString(),
    payload: { provider: "deterministic", model: "deterministic/echo" },
  });
  await turn.appendRound({
    schemaVersion: 1,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    round: 1,
    phase: "model_completed",
    recordedAt: new Date().toISOString(),
    payload: { toolCallCount: 1 },
  });
  await turn.appendRound({
    schemaVersion: 1,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    round: 1,
    phase: "tool_requested",
    recordedAt: new Date().toISOString(),
    callId: "crash_call",
    toolName: "read_file",
    payload: { argumentsJson: '{"path":"note.txt"}' },
  });
  await turn.updateState("streaming");
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
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

test("OpenRouter adapter normalizes streamed tool calls and serializes the provider wire format", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\"README.txt\\"}"}}]}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "wire-secret", async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(stream, { status: 200 });
  });
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [
      { role: "assistant", content: null, toolCalls: [{ callId: "call_0", name: "list_directory", argumentsJson: "{}" }] },
      { role: "tool", content: "{\"entries\":[]}", toolCallId: "call_0", name: "list_directory" },
    ],
    tools: [{ name: "read_file", description: "Read a file.", inputSchema: { type: "object" } }],
  };
  const events = [];
  for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [
    { type: "tool_call", call: { callId: "call_1", name: "read_file", argumentsJson: '{"path":"README.txt"}' } },
    { type: "completed", usage: undefined },
  ]);
  assert.deepEqual(requestBody?.tools, [{ type: "function", function: { name: "read_file", description: "Read a file.", parameters: { type: "object" } } }]);
  assert.deepEqual(requestBody?.messages, [
    { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "list_directory", arguments: "{}" } }] },
    { role: "tool", content: "{\"entries\":[]}", tool_call_id: "call_0", name: "list_directory" },
  ]);
});

test("OpenRouter adapter classifies incomplete streams and rate limits", async () => {
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  const incomplete = new OpenRouterModelProvider("openai/example", "secret", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  });
  await assert.rejects(
    async () => { for await (const _event of incomplete.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ComputerNativeError && error.code === "provider-incomplete",
  );
  const rateLimited = new OpenRouterModelProvider("openai/example", "secret", async () => new Response("slow down", { status: 429 }));
  await assert.rejects(
    async () => { for await (const _event of rateLimited.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ComputerNativeError && error.code === "rate-limit" && !error.message.includes("secret"),
  );
});

test("non-interactive CLI runs against the deterministic local provider", async () => {
  const stateDir = tempDirectory();
  const cli = path.resolve("dist/src/cli/main.js");
  const result = await execFileAsync(process.execPath, [cli, "chat", "--provider", "deterministic", "--state-dir", stateDir, "--message", "cli test"]);
  assert.match(result.stdout, /Deterministic response to: cli test/);
  assert.match(result.stdout, /✓ completed/);
});

test("provider doctor reports bounded deterministic connectivity without creating a chat session", async () => {
  const stateDir = tempDirectory();
  const cli = path.resolve("dist/src/cli/main.js");
  const result = await execFileAsync(process.execPath, [cli, "doctor", "--provider", "deterministic", "--state-dir", stateDir, "--workspace", tempDirectory()]);
  assert.match(result.stdout, /provider: deterministic/);
  assert.match(result.stdout, /result: reachable/);
  await assert.rejects(() => readFile(path.join(stateDir, "sessions"), "utf8"));
});

test("CLI arguments keep doctor separate from chat prompts", () => {
  assert.equal(parseArgs(["doctor"]).command, "doctor");
  assert.throws(() => parseArgs(["doctor", "--message", "no"]), /does not accept --message/);
  assert.throws(() => parseArgs(["unknown"]), /Unknown command/);
});

test("workspace policy rejects traversal and reads bounded UTF-8 files", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "note.txt"), "hello workspace", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  assert.equal((await workspace.readFile("note.txt")).content, "hello workspace");
  await assert.rejects(() => workspace.readFile("../outside.txt"), /outside the workspace root/);
  await assert.rejects(() => workspace.readFile(path.resolve(root, "note.txt")), /Absolute paths are not allowed/);
});

test("workspace policy rejects symlink escapes, oversized files, and invalid UTF-8", async () => {
  const base = tempDirectory();
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside.txt");
  await mkdir(root, { recursive: true });
  await writeFile(outside, "outside", "utf8");
  await symlink(outside, path.join(root, "outside-link.txt"));
  await writeFile(path.join(root, "large.txt"), "0123456789", "utf8");
  await writeFile(path.join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
  const workspace = await Workspace.open(root, { maxFileBytes: 5, maxDirectoryEntries: 10 });
  await assert.rejects(() => workspace.readFile("outside-link.txt"), /outside the workspace root/);
  await assert.rejects(() => workspace.readFile("large.txt"), /limit is 5 bytes/);
  await assert.rejects(() => workspace.readFile("invalid.txt"), /not valid UTF-8/);
});

test("workspace listing is stable and bounded", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "z.txt"), "z", "utf8");
  await writeFile(path.join(root, "a.txt"), "a", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 2 });
  const listing = await workspace.listDirectory(".");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["a.txt", "nested"]);
  assert.equal(listing.truncated, true);
});

test("deterministic model can inspect a file through the bounded tool loop", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "README.txt"), "Computer Native", "utf8");
  const session = await openSession(stateDir);
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const tools = new ToolRegistry(workspace, 1_000);
  const result = await runTurn({
    session,
    tools,
    provider: new DeterministicModelProvider("deterministic/echo", {
      toolCall: { name: "read_file", argumentsJson: JSON.stringify({ path: "README.txt" }), finalResponse: "I inspected README.txt." },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Inspect the README.",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "I inspected README.txt.");
  assert.deepEqual({
    modelRequestCount: result.metrics?.modelRequestCount,
    toolCallCount: result.metrics?.toolCallCount,
    roundCount: result.metrics?.roundCount,
  }, { modelRequestCount: 2, toolCallCount: 1, roundCount: 2 });
  const rounds = await session.readTranscript();
  assert.deepEqual(rounds.map((message) => message.role), ["user", "assistant"]);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const evidence = (await readFile(path.join(turnDirectory, "rounds.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { phase: string; round: number });
  assert.deepEqual(evidence.map((entry) => entry.phase), [
    "model_requested",
    "model_completed",
    "tool_requested",
    "tool_completed",
    "model_requested",
    "model_completed",
  ]);
  assert.ok(evidence.every((entry) => entry.round >= 1));
});

test("tool errors remain model-visible without escaping the workspace", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const session = await openSession(stateDir);
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const tools = new ToolRegistry(workspace, 1_000);
  const result = await runTurn({
    session,
    tools,
    provider: new DeterministicModelProvider("deterministic/echo", {
      toolCall: { name: "read_file", argumentsJson: JSON.stringify({ path: "../secret.txt" }), finalResponse: "The requested path was rejected." },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Read the secret.",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "The requested path was rejected.");
  const roundsPath = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "rounds.jsonl");
  const rounds = (await readFile(roundsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { phase: string; payload: { ok?: unknown } });
  assert.equal(rounds.find((round) => round.phase === "tool_completed")?.payload.ok, false);
});

test("tool registry validates unknown and malformed calls and bounds output bytes", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "long.txt"), "0123456789", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 16);
  const unknown = await registry.execute({ callId: "unknown", name: "shell", argumentsJson: "{}" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.content, /Unknown tool/);
  const malformed = await registry.execute({ callId: "malformed", name: "read_file", argumentsJson: "[]" });
  assert.equal(malformed.ok, false);
  assert.match(malformed.content, /requires a JSON object/);
  const bounded = await registry.execute({ callId: "bounded", name: "read_file", argumentsJson: JSON.stringify({ path: "long.txt" }) });
  assert.equal(bounded.ok, true);
  assert.ok(Buffer.byteLength(bounded.content, "utf8") <= 16);
});

test("model/tool round limits fail without committing a final assistant message", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/loop",
    async *stream(): AsyncIterable<{ readonly type: "tool_call"; readonly call: { readonly callId: string; readonly name: string; readonly argumentsJson: string } } | { readonly type: "completed" }> {
      yield { type: "tool_call", call: { callId: "loop_call", name: "list_directory", argumentsJson: "{}" } };
      yield { type: "completed" };
    },
  };
  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { maxModelToolRounds: 1 }),
    userPrompt: "loop",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "round-limit");
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
});

test("round evidence rejects missing identity, duplicate calls, and phase reordering", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("evidence", "deterministic", "deterministic/echo");
  const base = { schemaVersion: 1 as const, sessionId: turn.sessionId, turnId: turn.turnId, round: 1, recordedAt: new Date().toISOString(), payload: {} };
  await turn.appendRound({ ...base, phase: "model_requested" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_completed" }), /without call identity/);
  await turn.appendRound({ ...base, phase: "model_completed" });
  await turn.appendRound({ ...base, phase: "tool_requested", callId: "call_1", toolName: "read_file" });
  await turn.appendRound({ ...base, phase: "tool_completed", callId: "call_1", toolName: "read_file" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_requested", callId: "call_1", toolName: "read_file" }), /duplicate tool call/);
});

test("cancellation interrupts a waiting read-only tool without committing an assistant", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const tools = {
    definitions: [],
    execute: async () => await new Promise<never>(() => undefined),
  } as unknown as ToolRegistry;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/slow-tool",
    async *stream(): AsyncIterable<{ readonly type: "tool_call"; readonly call: { readonly callId: string; readonly name: string; readonly argumentsJson: string } } | { readonly type: "completed" }> {
      yield { type: "tool_call", call: { callId: "slow_tool_call", name: "read_file", argumentsJson: '{"path":"note.txt"}' } };
      yield { type: "completed" };
    },
  };
  const controller = new AbortController();
  setTimeout(() => controller.abort("cancelled"), 10);
  const result = await runTurn({ session, tools, provider, config: config(stateDir, { timeoutMs: 1_000 }), userPrompt: "cancel tool" , signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
});

test("empty and first-event provider outcomes are classified distinctly", async () => {
  const emptyDir = tempDirectory();
  const emptySession = await openSession(emptyDir);
  const empty = await runTurn({
    session: emptySession,
    provider: new DeterministicModelProvider("deterministic/echo", { response: "" }),
    config: config(emptyDir, { firstEventTimeoutMs: 100 }),
    userPrompt: "empty",
  });
  assert.equal(empty.status, "failed");
  assert.equal(empty.error?.code, "provider-empty");

  const timeoutDir = tempDirectory();
  const timeoutSession = await openSession(timeoutDir);
  const timeout = await runTurn({
    session: timeoutSession,
    provider: new DeterministicModelProvider("deterministic/echo", { behavior: "timeout" }),
    config: config(timeoutDir, { timeoutMs: 1_000, firstEventTimeoutMs: 15 }),
    userPrompt: "first event timeout",
  });
  assert.equal(timeout.status, "failed");
  assert.equal(timeout.error?.code, "first-event-timeout");
});

test("TUI commands are explicit and unknown commands do not become model prompts", () => {
  assert.deepEqual(parseTuiCommand("/help"), { kind: "help" });
  assert.deepEqual(parseTuiCommand("/exit"), { kind: "quit" });
  assert.deepEqual(parseTuiCommand("/status extra"), { kind: "status" });
  assert.deepEqual(parseTuiCommand("/not-real"), { kind: "unknown", name: "/not-real" });
  assert.equal(parseTuiCommand("tell me about the workspace"), undefined);
});
