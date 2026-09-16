import { execFile } from "node:child_process";
import { chmod, link as createHardLink, lstat, mkdtemp, readFile, readdir, rename, rm, stat, writeFile, mkdir, symlink, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { promisify } from "node:util";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/config.js";
import { loadLocalEnvironment } from "../src/config/local-env.js";
import type { BrowserActionRecord } from "../src/browser/records.js";
import type { BrowserDocumentId, BrowserSessionId, BrowserTabId } from "../src/browser/contracts.js";
import { buildInitialContext } from "../src/context/context.js";
import { DeterministicModelProvider } from "../src/models/deterministic.js";
import { OpenRouterModelProvider } from "../src/models/openrouter.js";
import { createModelProvider } from "../src/models/factory.js";
import { getModelProviderSummary, listModelProviderSummaries } from "../src/models/registry.js";
import { atomicWriteJson, redactRecord } from "../src/persistence/json.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { prepareFileWrite, preparePatch } from "../src/workspace/patch.js";
import { MAX_PATCH_REQUEST_BYTES, type MutationEvent, type WorkspaceMutationRecord } from "../src/workspace/mutation.js";
import { ComputerNativeError, ModelProviderError, MutationError, RuntimeInterruptionError } from "../src/runtime/errors.js";
import { asCorrelationId, asSessionId, asTurnId, type ModelRequest, type ModelStreamEvent, type TurnEvent, type TurnRecord } from "../src/runtime/contracts.js";
import { allowedTransitions, assertTransition } from "../src/runtime/state.js";
import { openChatApplication } from "../src/runtime/application.js";
import { runTurn } from "../src/runtime/turn.js";
import { parseArgs } from "../src/cli/args.js";
import { parseTuiCommand, TerminalUi } from "../src/cli/tui.js";
import type { ChatApplication } from "../src/runtime/application.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest, ProcessExecutionRecord, ProcessResult, ProcessToolEvent } from "../src/process/process.js";
import { reconcileRunningProcess } from "../src/process/recovery.js";
import type { MemoryActionRecord, MemorySearchEvidence } from "../src/memory/contracts.js";

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
  const disabledBrowser = config(tempDirectory(), { browserEnabled: false });
  assert.equal(deterministic.provider, "deterministic");
  assert.equal(deterministic.model, "deterministic/echo");
  assert.equal(deterministic.timeoutMs, 30_000);
  assert.equal(deterministic.approvalTimeoutMs, 120_000);
  assert.equal(deterministic.modelRetryAttempts, 2);
  assert.equal(deterministic.modelRetryBackoffMs, 250);
  assert.equal(deterministic.maxModelRequestBytes, 512 * 1024);
  assert.equal(deterministic.maxModelOutputBytes, 256 * 1024);
  const configured = loadConfig({ stateDir: tempDirectory() }, {
    COMPUTER_NATIVE_MAX_MODEL_REQUEST_BYTES: "1234",
    COMPUTER_NATIVE_MAX_MODEL_OUTPUT_BYTES: "5678",
    COMPUTER_NATIVE_MAX_PATCH_SET_BYTES: "777",
  });
  assert.equal(configured.maxModelRequestBytes, 1234);
  assert.equal(configured.maxModelOutputBytes, 5678);
  assert.equal(configured.maxPatchSetBytes, 777);
  assert.equal(deterministic.processMode, "approval");
  assert.equal(deterministic.processDurationMs, 60_000);
  assert.equal(deterministic.processCallsPerTurn, 4);
  assert.equal(deterministic.maxModelToolRounds, 8);
  assert.equal(deterministic.browserMaxTabs, 8);
  assert.equal(deterministic.browserEnabled, true);
  assert.equal(deterministic.browserSessionTimeoutMs, 1_800_000);
  assert.equal(deterministic.browserReadRetryCount, 1);
  assert.equal(deterministic.browserProfileRetentionMs, 86_400_000);
  assert.equal(deterministic.browserArtifactRetentionMs, 604_800_000);
  assert.equal(deterministic.browserCleanupMaxEntries, 100);
  assert.equal(deterministic.browserScreenshotMaxWidth, 1_920);
  assert.equal(deterministic.browserScreenshotMaxHeight, 1_080);
  assert.equal(deterministic.memoryEvidenceRetentionDays, 30);
  assert.equal(deterministic.memoryEvidenceMaxEntries, 10_000);
  assert.equal(deterministic.maxPatchSetBytes, 256 * 1024);
  const configuredMemoryEvidence = loadConfig({ stateDir: tempDirectory() }, {
    COMPUTER_NATIVE_MEMORY_EVIDENCE_RETENTION_DAYS: "14",
    COMPUTER_NATIVE_MEMORY_EVIDENCE_MAX_ENTRIES: "250",
  });
  assert.equal(configuredMemoryEvidence.memoryEvidenceRetentionDays, 14);
  assert.equal(configuredMemoryEvidence.memoryEvidenceMaxEntries, 250);
  assert.equal(disabledBrowser.browserEnabled, false);
  assert.throws(
    () => loadConfig({ stateDir: tempDirectory() }, { COMPUTER_NATIVE_BROWSER_ENABLED: "sometimes" }),
    /browser enabled must be true or false/u,
  );
  assert.equal(deterministic.openRouterApiKey, undefined);
  assert.throws(
    () => config(tempDirectory(), { provider: "openrouter", model: "openai/example" }),
    (error: unknown) => error instanceof ComputerNativeError && error.code === "configuration",
  );
  assert.throws(
    () => config(tempDirectory(), { maxFileBytes: 0 }),
    /max file bytes must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { modelRetryAttempts: 0 }),
    /model retry attempts must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { deterministicDelayMs: -1 }),
    /deterministic delay must be a non-negative integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { maxModelRequestBytes: 0 }),
    /max model request bytes must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { maxModelOutputBytes: 0 }),
    /max model output bytes must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { maxPatchSetBytes: 0 }),
    /max patch-set bytes must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { memoryEvidenceRetentionDays: 0 }),
    /memory evidence retention days must be a positive integer/u,
  );
  assert.throws(
    () => config(tempDirectory(), { memoryEvidenceMaxEntries: 0 }),
    /memory evidence max entries must be a positive integer/u,
  );
});

test("model factory validates explicit provider/model selection and exposes capabilities", () => {
  const deterministic = createModelProvider(config(tempDirectory()));
  assert.deepEqual(deterministic.capabilities, {
    streaming: true,
    toolCalls: true,
    structuredOutput: false,
    vision: false,
    reasoningControls: false,
    usageReporting: true,
    contextWindow: "harness-bounded",
  });

  const openrouter = createModelProvider(loadConfig({
    stateDir: tempDirectory(),
    provider: "openrouter",
    model: "nvidia/test-model:free",
    openRouterApiKey: "test-key",
  }, {}));
  assert.equal(openrouter.capabilities?.streaming, true);
  assert.equal(openrouter.capabilities?.toolCalls, true);
  assert.equal(openrouter.capabilities?.contextWindow, "unknown");

  assert.throws(
    () => createModelProvider(loadConfig({ stateDir: tempDirectory(), provider: "openrouter", model: "free", openRouterApiKey: "test-key" }, {})),
    /namespaced OpenRouter model/u,
  );
  assert.throws(
    () => createModelProvider(loadConfig({ stateDir: tempDirectory(), provider: "deterministic", model: "openai/test" }, {})),
    /deterministic model must start with deterministic\//u,
  );
});

test("model registry exposes the built-in provider choices without exposing credentials", () => {
  const providers = listModelProviderSummaries();
  assert.deepEqual(providers.map((entry) => entry.provider), ["deterministic", "openrouter"]);
  assert.deepEqual(providers.map((entry) => entry.modelHint), ["deterministic/<name>", "<namespace>/<model>[:free]"]);
  assert.equal(providers.find((entry) => entry.provider === "openrouter")?.capabilities.contextWindow, "unknown");
  assert.equal(JSON.stringify(providers).includes("apiKey"), false);
  assert.equal(getModelProviderSummary("deterministic").label, "Deterministic local provider");
  assert.equal(getModelProviderSummary("openrouter").label, "OpenRouter hosted provider");
});

test("disabled browser configuration does not advertise browser tools", async () => {
  const application = await openChatApplication(config(tempDirectory(), { browserEnabled: false }));
  try {
    assert.equal(application.toolNames.some((name) => name === "browser_start"), false);
  } finally {
    await application.close();
  }
});

test("application startup removes only expired managed browser state", async () => {
  const stateDir = tempDirectory();
  const staleProfile = path.join(stateDir, "browser-profiles", `browser_${"a".repeat(32)}`);
  const staleArtifact = path.join(stateDir, "browser-artifacts", "browser_cleanup", "screenshots", "artifact_old.png");
  await mkdir(staleProfile, { recursive: true });
  await writeFile(path.join(staleProfile, "profile.data"), "stale");
  await mkdir(path.dirname(staleArtifact), { recursive: true });
  await writeFile(staleArtifact, "stale");
  await writeFile(`${staleArtifact}.json`, JSON.stringify({ createdAt: "2020-01-01T00:00:00.000Z" }), "utf8");
  const oldSeconds = (Date.now() - 120_000) / 1_000;
  await utimes(staleProfile, oldSeconds, oldSeconds);
  await utimes(staleArtifact, oldSeconds, oldSeconds);

  const application = await openChatApplication(config(stateDir, {
    browserProfileRetentionMs: 1_000,
    browserArtifactRetentionMs: 1_000,
    browserCleanupMaxEntries: 20,
  }));
  try {
    await assert.rejects(stat(staleProfile), { code: "ENOENT" });
    await assert.rejects(stat(staleArtifact), { code: "ENOENT" });
    await assert.rejects(stat(`${staleArtifact}.json`), { code: "ENOENT" });
  } finally {
    await application.close();
  }
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

test("turn state only advances in memory after durable acknowledgement", async () => {
  const stateDir = tempDirectory();
  let mode: "none" | "before" | "after" = "none";
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      beforeWrite: (operation, filePath) => {
        if (mode === "before" && operation === "replace-json" && filePath.endsWith(`${path.sep}turn.json`)) {
          throw new RuntimeInterruptionError("stopped before turn state became durable");
        }
      },
      afterWrite: (operation, filePath) => {
        if (mode === "after" && operation === "replace-json" && filePath.endsWith(`${path.sep}turn.json`)) {
          throw new RuntimeInterruptionError("stopped after turn state became durable");
        }
      },
    },
  });
  const turn = await session.admitTurn("durable state acknowledgement", "deterministic", "deterministic/echo");
  mode = "before";
  await assert.rejects(() => turn.updateState("streaming"), /stopped before turn state became durable/u);
  assert.equal(turn.state, "submitting");
  assert.match(await readFile(path.join(turn.directory, "turn.json"), "utf8"), /"state":"submitting"/u);

  mode = "none";
  await turn.updateState("streaming");
  mode = "after";
  await assert.rejects(() => turn.updateState("completed"), /stopped after turn state became durable/u);
  assert.equal(turn.state, "streaming");
  assert.match(await readFile(path.join(turn.directory, "turn.json"), "utf8"), /"state":"completed"/u);

  mode = "none";
  await turn.updateState("completed");
  assert.equal(turn.state, "completed");
});

test("lifecycle events reject out-of-order model attempt evidence", async () => {
  const session = await openSession(tempDirectory());
  const turn = await session.admitTurn("event order", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await assert.rejects(() => turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_test" }), /before its request/);
  await turn.appendEvent("ModelRequested", { attemptId: "attempt_test" });
  await assert.rejects(() => turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_test" }), /before the failed attempt/);
  const completedAttempt = await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_test", status: "failed" });
  const replayedAttempt = await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_test", status: "failed" });
  assert.equal(replayedAttempt.eventId, completedAttempt.eventId);
  await assert.rejects(
    () => turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_test", status: "completed" }),
    /repeated with a different payload/u,
  );
  const retry = await turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_test" });
  assert.equal((await turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_test" })).eventId, retry.eventId);
  await turn.appendEvent("ModelRequested", { attemptId: "attempt_success", round: 1, attempt: 2 });
  await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_success", status: "completed" });
  const modelCompleted = await turn.appendEvent("ModelCompleted");
  assert.equal((await turn.appendEvent("ModelCompleted")).eventId, modelCompleted.eventId);
});

test("model lifecycle evidence requires a started turn and exact attempt identities", async () => {
  const session = await openSession(tempDirectory());
  const turn = await session.admitTurn("model evidence identity", "deterministic", "deterministic/echo");
  await assert.rejects(
    () => turn.appendEvent("ModelRequested", { attemptId: "attempt_before_start" }),
    /before TurnStarted/u,
  );
  await assert.rejects(
    () => turn.appendEvent("TurnStarted", { provider: "openrouter", model: "openrouter/other" }),
    /TurnStarted provider .* does not match admitted provider/u,
  );
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await assert.rejects(
    () => turn.appendEvent("ModelRequested"),
    /requires a non-empty attemptId/u,
  );
  await turn.appendEvent("ModelRequested", { attemptId: "attempt_one", round: 1, attempt: 1 });
  await assert.rejects(
    () => turn.appendEvent("ModelAttemptCompleted", { status: "failed" }),
    /requires a non-empty attemptId/u,
  );
  await assert.rejects(
    () => turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_other", status: "failed" }),
    /before its request/u,
  );
  await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_one", status: "failed" });
  await assert.rejects(
    () => turn.appendEvent("ModelRetryScheduled"),
    /requires a non-empty attemptId/u,
  );
  await assert.rejects(
    () => turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_other" }),
    /before the failed attempt/u,
  );
});

test("model lifecycle evidence rejects a failed latest attempt as model completion", async () => {
  const session = await openSession(tempDirectory());
  const turn = await session.admitTurn("model completion status", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await turn.appendEvent("ModelRequested", { attemptId: "attempt_failed", round: 1, attempt: 1 });
  await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_failed", status: "failed" });
  await assert.rejects(
    () => turn.appendEvent("ModelCompleted"),
    /final model attempt did not complete successfully/u,
  );
  await turn.appendEvent("ModelRequested", { attemptId: "attempt_success", round: 1, attempt: 2 });
  await turn.appendEvent("ModelAttemptCompleted", { attemptId: "attempt_success", status: "completed" });
  await assert.rejects(
    () => turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_failed" }),
    /before the failed attempt/u,
  );
  await assert.rejects(
    () => turn.appendEvent("ModelRetryScheduled", { attemptId: "attempt_success" }),
    /only follow a failed attempt/u,
  );
  await turn.appendEvent("ModelCompleted");
});

test("lifecycle history rejects cross-turn, unknown, and out-of-sequence durable events", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("validate event identity", "deterministic", "deterministic/echo");
  const started = await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  const eventsPath = path.join(turn.directory, "events.jsonl");

  await writeFile(eventsPath, `${JSON.stringify({ ...started, sequence: 2 })}\n`, "utf8");
  await assert.rejects(() => turn.readEvents(), /invalid sequence/u);

  await writeFile(eventsPath, `${JSON.stringify({ ...started, type: "UnknownEvent" })}\n`, "utf8");
  await assert.rejects(() => turn.readEvents(), /unknown event type/u);

  await writeFile(eventsPath, `${JSON.stringify({ ...started, sessionId: asSessionId("session_other") })}\n`, "utf8");
  await assert.rejects(() => turn.readEvents(), /does not belong to session/u);

  await writeFile(eventsPath, `${JSON.stringify({ ...started, payload: { provider: "openrouter", model: "openrouter/other" } })}\n`, "utf8");
  await assert.rejects(() => turn.readEvents(), /TurnStarted provider .* does not match admitted provider/u);
});

test("terminal results reject mismatched durable identity", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("validate terminal identity", "deterministic", "deterministic/echo");
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "done",
  };

  await assert.rejects(
    () => turn.writeResult({ ...result, turnId: asTurnId("turn_other") }),
    /does not belong to turn/u,
  );
  await assert.rejects(
    () => turn.writeResult({ ...result, model: "deterministic/other" }),
    /does not match the admitted model/u,
  );
  await turn.writeResult(result);
});

test("restart refuses to adopt a terminal result from another turn", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("reject foreign terminal result", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await atomicWriteJson(path.join(turn.directory, "result.json"), {
    schemaVersion: 1,
    sessionId: turn.sessionId,
    turnId: asTurnId("turn_foreign"),
    status: "completed",
    provider: "deterministic",
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "foreign",
  });

  const reopened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => reopened.recoverInterruptedTurns(), /does not belong to turn/u);
  const record = JSON.parse(await readFile(path.join(turn.directory, "turn.json"), "utf8")) as { state: string };
  assert.equal(record.state, "streaming");
});

test("restart rejects a process record from another session", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("reject foreign process evidence", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const processRecord: ProcessExecutionRecord = {
    schemaVersion: 1,
    executionId: "execution_foreign",
    callId: "call_foreign",
    sessionId: "session_other",
    turnId: turn.turnId,
    command: "node",
    displayArgs: [],
    cwd: ".",
    executablePath: process.execPath,
    environmentProfile: "sanitized-default",
    environmentKeys: [],
    limits: {
      timeoutMs: 1_000,
      terminationGraceMs: 100,
      maxOutputBytes: 1_000,
      maxArgumentCount: 4,
      maxArgumentBytes: 100,
    },
    argvHash: "hash",
    status: "prepared",
    recordedAt: new Date().toISOString(),
  };
  await atomicWriteJson(path.join(turn.directory, "executions", `${processRecord.executionId}.json`), processRecord);

  const reopened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => reopened.recoverInterruptedTurns(), /does not belong to turn/u);
});

test("lifecycle events enforce process, browser, and memory action ordering", async () => {
  const session = await openSession(tempDirectory());
  const turn = await session.admitTurn("side-effect event order", "deterministic", "deterministic/echo");

  await assert.rejects(
    () => turn.appendEvent("ProcessPrepared", { callId: "process_call" }),
    /requires a non-empty executionId/u,
  );
  await assert.rejects(
    () => turn.appendEvent("ProcessStarted", { executionId: "process_order", callId: "process_call", pid: 123 }),
    /before ProcessApprovalDecided|cannot follow ProcessPrepared/u,
  );
  const prepared = await turn.appendEvent("ProcessPrepared", { executionId: "process_order", callId: "process_call" });
  assert.equal(
    (await turn.appendEvent("ProcessPrepared", { executionId: "process_order", callId: "process_call" })).eventId,
    prepared.eventId,
  );
  await assert.rejects(
    () => turn.appendEvent("ProcessPrepared", { executionId: "process_order", callId: "process_call", command: "different" }),
    /repeated with a different payload/u,
  );
  await assert.rejects(
    () => turn.appendEvent("ProcessStarted", { executionId: "process_order", callId: "process_call", pid: 123 }),
    /before ProcessApprovalDecided|cannot follow ProcessPrepared/u,
  );
  await turn.appendEvent("ProcessApprovalDecided", { executionId: "process_order", callId: "process_call", decision: "allow-once" });
  await turn.appendEvent("ProcessStarted", { executionId: "process_order", callId: "process_call", pid: 123 });
  await turn.appendEvent("ProcessCompleted", { executionId: "process_order", callId: "process_call", status: "completed" });
  await assert.rejects(
    () => turn.appendEvent("ProcessTerminating", { executionId: "process_order", callId: "process_call", reason: "late" }),
    /cannot follow ProcessCompleted/u,
  );

  await assert.rejects(
    () => turn.appendEvent("BrowserStarted", { actionId: "browser_order", callId: "browser_call" }),
    /before BrowserApprovalDecided|before BrowserPrepared/u,
  );
  await turn.appendEvent("BrowserPrepared", { actionId: "browser_order", callId: "browser_call" });
  await assert.rejects(
    () => turn.appendEvent("BrowserStarted", { actionId: "browser_order", callId: "browser_call" }),
    /before BrowserApprovalDecided|cannot follow BrowserPrepared/u,
  );
  await turn.appendEvent("BrowserApprovalDecided", { actionId: "browser_order", callId: "browser_call", decision: "deny" });
  await turn.appendEvent("BrowserCompleted", { actionId: "browser_order", callId: "browser_call", status: "failed" });
  await assert.rejects(
    () => turn.appendEvent("BrowserStarted", { actionId: "browser_order", callId: "browser_call" }),
    /cannot follow BrowserCompleted/u,
  );

  await assert.rejects(
    () => turn.appendEvent("MemoryCommitted", { operationId: "memory_order", callId: "memory_call" }),
    /before MemoryPrepared or MemoryApprovalDecided/u,
  );
  await turn.appendEvent("MemoryPrepared", { operationId: "memory_order", callId: "memory_call" });
  await turn.appendEvent("MemoryCommitted", { operationId: "memory_order", callId: "memory_call", status: "committed" });
  await assert.rejects(
    () => turn.appendEvent("MemoryApprovalDecided", { operationId: "memory_order", callId: "memory_call", decision: "allow-once" }),
    /cannot follow MemoryCommitted/u,
  );
});

test("workspace mutation lifecycle events require approval before side effects", async () => {
  const session = await openSession(tempDirectory());
  const turn = await session.admitTurn("workspace event order", "deterministic", "deterministic/echo");
  const base = { mutationId: "mutation_event_order", operation: "write", path: "note.txt" };
  await assert.rejects(
    () => turn.appendEvent("WorkspaceMutationApplying", { ...base, decision: "allow-once" }),
    /before its proposal/,
  );
  await turn.appendEvent("WorkspaceMutationProposed", base);
  await assert.rejects(
    () => turn.appendEvent("WorkspaceMutationApplying", { ...base, decision: "allow-once" }),
    /before an allow-once approval/,
  );
  await turn.appendEvent("WorkspaceMutationApprovalDecided", { ...base, decision: "allow-once" });
  await turn.appendEvent("WorkspaceMutationApplying", { ...base, decision: "allow-once" });
  await turn.appendEvent("WorkspaceMutationProgress", { ...base, journal: { state: "committing" } });
  await turn.appendEvent("WorkspaceMutationCommitted", { ...base, journal: { state: "committed" } });
  await assert.rejects(
    () => turn.appendEvent("WorkspaceMutationProgress", { ...base, journal: { state: "committed" } }),
    /after its terminal lifecycle event/,
  );
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
  assert.deepEqual(events.map((event) => event.type), ["TurnStarted", "ModelRequested", "ModelAttemptCompleted", "ModelCompleted", "TurnCompleted"]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  assert.ok(events.every((event) => event.sessionId === result.sessionId && event.turnId === result.turnId));
});

test("one correlation ID links the model request, TUI events, rounds, and durable turn records", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const observed: TurnEvent[] = [];
  let requestCorrelationId: string | undefined;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/correlation",
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requestCorrelationId = request.correlationId;
      yield { type: "text", text: "correlated" };
      yield { type: "completed", usage: { outputTokens: 1, totalTokens: 1 } };
    },
  };

  const result = await runTurn({
    session,
    provider,
    config: config(stateDir),
    userPrompt: "record correlation",
    onEvent: (event) => observed.push(event),
  });

  assert.match(String(result.correlationId), /^corr_[a-f0-9]{32}$/u);
  assert.equal(requestCorrelationId, result.correlationId);
  assert.ok(observed.length > 0);
  assert.ok(observed.every((event) => event.correlationId === result.correlationId));
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const turnRecord = JSON.parse(await readFile(path.join(turnDirectory, "turn.json"), "utf8")) as { correlationId?: string };
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { correlationId?: string });
  const rounds = (await readFile(path.join(turnDirectory, "rounds.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { correlationId?: string });
  const storedResult = JSON.parse(await readFile(path.join(turnDirectory, "result.json"), "utf8")) as { correlationId?: string };
  assert.equal(turnRecord.correlationId, result.correlationId);
  assert.equal(storedResult.correlationId, result.correlationId);
  assert.ok(events.every((event) => event.correlationId === result.correlationId));
  assert.ok(rounds.every((round) => round.correlationId === result.correlationId));
});

test("turn persists provider request identity and latency in model evidence", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turnConfig = config(stateDir);
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/evidence",
    async *stream(): AsyncIterable<ModelStreamEvent> {
      yield { type: "text", text: "evidence" };
      yield { type: "completed", usage: { outputTokens: 1, totalTokens: 1 }, providerRequestId: "req_evidence", latencyMs: 17 };
    },
  };
  const result = await runTurn({ session, provider, config: turnConfig, userPrompt: "record evidence" });
  assert.equal(result.status, "completed");
  assert.equal(result.metrics?.outputTokens, 1);
  assert.equal(result.metrics?.totalTokens, 1);
  const events = (await readFile(path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  const attempt = events.find((event) => event.type === "ModelAttemptCompleted");
  const completed = events.find((event) => event.type === "ModelCompleted");
  assert.equal(attempt?.payload.providerRequestId, "req_evidence");
  assert.equal(attempt?.payload.latencyMs, 17);
  assert.equal(typeof attempt?.payload.requestBytes, "number");
  assert.equal(attempt?.payload.maxRequestBytes, turnConfig.maxModelRequestBytes);
  assert.equal(typeof attempt?.payload.responseBytes, "number");
  assert.equal(attempt?.payload.maxOutputBytes, turnConfig.maxModelOutputBytes);
  assert.equal(completed?.payload.providerRequestId, "req_evidence");
  assert.equal(completed?.payload.latencyMs, 17);
  assert.equal(typeof completed?.payload.outputBytes, "number");
  assert.equal(completed?.payload.maxOutputBytes, turnConfig.maxModelOutputBytes);
});

test("persistence rejects a round correlated to another turn", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("reject mismatched correlation", "deterministic", "deterministic/echo");
  await assert.rejects(
    () => turn.appendRound({
      schemaVersion: 1,
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      correlationId: asCorrelationId("corr_other_turn"),
      round: 1,
      phase: "model_requested",
      recordedAt: new Date().toISOString(),
      payload: {},
    }),
    /does not belong to correlation/u,
  );
});

test("committing the same terminal result twice does not duplicate the terminal event", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("commit once", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "done",
  };

  await turn.commitTerminal(result, "TurnCompleted", { assistantText: "done" });
  await turn.commitTerminal(result, "TurnCompleted", { assistantText: "done" });
  await assert.rejects(
    () => turn.commitTerminal(result, "TurnCompleted", { assistantText: "different final evidence" }),
    /TurnCompleted evidence was repeated with a different payload/u,
  );
  await assert.rejects(
    () => turn.appendEvent("TurnCompleted", { assistantText: "different final evidence" }),
    /TurnCompleted evidence was repeated with a different payload/u,
  );
  await assert.rejects(() => turn.appendEvent("TurnFailed"), /already has terminal event/);

  const events = await turn.readEvents();
  assert.deepEqual(events.map((event) => event.type), ["TurnCompleted"]);
  assert.equal(turn.state, "completed");
});

test("terminal commit validates the turn transition before writing a result", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("reject invalid terminal transition", "deterministic", "deterministic/echo");
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "should not commit",
  };

  await assert.rejects(
    () => turn.commitTerminal(result, "TurnCompleted"),
    /Invalid turn transition: submitting → completed/u,
  );
  await assert.rejects(
    () => readFile(path.join(turn.directory, "result.json"), "utf8"),
    /ENOENT/u,
  );
  assert.equal(turn.state, "submitting");
});

test("transcript append is idempotent by message identity and rejects conflicting reuse", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("persist one assistant message", "deterministic", "deterministic/echo");
  const assistantMessageId = await turn.appendAssistantMessage("first response", new Date(2).toISOString());
  const assistant = (await session.readTranscript()).find((message) => message.messageId === assistantMessageId);
  assert.ok(assistant);

  await session.appendMessage(assistant);
  assert.equal((await session.readTranscript()).filter((message) => message.messageId === assistantMessageId).length, 1);
  await assert.rejects(
    () => session.appendMessage({ ...assistant, content: "conflicting response" }),
    /already has different content/u,
  );
  await assert.rejects(
    () => session.appendMessage({ ...assistant, sessionId: asSessionId("session_other") }),
    /does not belong to session/u,
  );
});

test("transcript reads reject duplicated and malformed durable messages", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("detect transcript corruption", "deterministic", "deterministic/echo");
  const user = (await session.readTranscript())[0];
  assert.ok(user);
  const transcriptPath = path.join(session.sessionDirectory, "transcript.jsonl");

  await session.appendJsonLine(transcriptPath, user);
  await assert.rejects(
    () => session.readTranscript(),
    /Transcript message .* is duplicated/u,
  );

  const malformedStateDir = path.join(stateDir, "malformed");
  const malformedSession = await openSession(malformedStateDir);
  await atomicWriteJson(path.join(malformedSession.sessionDirectory, "transcript.jsonl"), {
    ...user,
    sessionId: malformedSession.metadata.sessionId,
    turnId: turn.turnId,
    content: 42,
  });
  await assert.rejects(
    () => malformedSession.readTranscript(),
    /durable transcript message has an invalid record/u,
  );

  const blankStateDir = path.join(stateDir, "blank");
  const blankSession = await openSession(blankStateDir);
  await blankSession.admitTurn("blank transcript line", "deterministic", "deterministic/echo");
  const blankTranscriptPath = path.join(blankSession.sessionDirectory, "transcript.jsonl");
  await writeFile(blankTranscriptPath, `${await readFile(blankTranscriptPath, "utf8")}\n`, "utf8");
  await assert.rejects(
    () => blankSession.readTranscript(),
    /contains an empty line/u,
  );
  await blankSession.replaceJsonLines(blankTranscriptPath, []);
  assert.deepEqual(await blankSession.readTranscript(), []);
});

test("restart recovery repairs terminal evidence after a durable write acknowledgement fails", async () => {
  const stateDir = tempDirectory();
  let resultAcknowledgements = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.endsWith("/result.json") && resultAcknowledgements++ === 0) {
          throw new Error("simulated result acknowledgement failure");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/echo", { response: "durable result" }),
      config: config(stateDir),
      userPrompt: "persist a result",
    }),
    /already has a different terminal result/,
  );
  const userMessage = (await session.readTranscript())[0];
  assert.ok(userMessage);
  const turnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", userMessage.turnId);
  const recovered = await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  assert.deepEqual(recovered, []);
  const result = JSON.parse(await readFile(path.join(turnDirectory, "result.json"), "utf8")) as { status: string; assistantText?: string };
  const turnRecord = JSON.parse(await readFile(path.join(turnDirectory, "turn.json"), "utf8")) as { state: string };
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "durable result");
  assert.equal(turnRecord.state, "completed");
  assert.equal(events.filter((event) => event.type === "TurnCompleted").length, 1);
  await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  const repeatedEvents = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(repeatedEvents.filter((event) => event.type === "TurnCompleted").length, 1);

  const eventStateDir = path.join(stateDir, "event-ack");
  let eventAcknowledgements = 0;
  const eventSession = await SessionStore.open(eventStateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "append-json-line" && filePath.endsWith("/events.jsonl") && eventAcknowledgements++ === 4) {
          throw new Error("simulated terminal event acknowledgement failure");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session: eventSession,
      provider: new DeterministicModelProvider("deterministic/echo", { response: "durable event" }),
      config: config(eventStateDir),
      userPrompt: "persist terminal evidence",
    }),
    /Invalid turn transition: completed → failed/u,
  );
  const eventUserMessage = (await eventSession.readTranscript())[0];
  assert.ok(eventUserMessage);
  const eventTurnDirectory = path.join(eventStateDir, "sessions", eventSession.metadata.sessionId, "turns", eventUserMessage.turnId);
  await (await SessionStore.open(eventStateDir, eventSession.metadata.sessionId)).recoverInterruptedTurns();
  const eventEvidence = (await readFile(path.join(eventTurnDirectory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(eventEvidence.filter((event) => event.type === "TurnCompleted").length, 1);
  await (await SessionStore.open(eventStateDir, eventSession.metadata.sessionId)).recoverInterruptedTurns();
  const repeatedEventEvidence = (await readFile(path.join(eventTurnDirectory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(repeatedEventEvidence.filter((event) => event.type === "TurnCompleted").length, 1);
});

test("restart reconciles a browser action after its running record acknowledgement is lost", async () => {
  const stateDir = tempDirectory();
  let actionWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.endsWith("browser_action_ack.json") && actionWrites++ === 2) {
          throw new Error("simulated running browser action acknowledgement failure");
        }
      },
    },
  });
  const turn = await session.admitTurn("recover the browser action record", "deterministic", "deterministic/echo");
  const base: BrowserActionRecord = {
    schemaVersion: 1,
    actionId: "browser_action_ack",
    callId: "browser_call_ack",
    sessionId: "browser_session_ack" as BrowserSessionId,
    turnId: turn.turnId,
    tabId: "browser_tab_ack" as BrowserTabId,
    action: "click",
    reference: "save-button",
    documentId: "browser_document_ack" as BrowserDocumentId,
    actionHash: "browser-action-ack-hash",
    status: "prepared",
    recordedAt: new Date().toISOString(),
  };
  await turn.writeBrowserAction(base);
  await turn.writeBrowserAction({ ...base, status: "approved", decision: "allow-once", recordedAt: new Date().toISOString() });
  await assert.rejects(
    () => turn.writeBrowserAction({ ...base, status: "running", decision: "allow-once", recordedAt: new Date().toISOString() }),
    /simulated running browser action acknowledgement failure/u,
  );

  const firstRecovery = await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  assert.equal(firstRecovery[0]?.status, "interrupted");
  const record = (await turn.readBrowserActions())[0];
  assert.equal(record?.status, "ambiguous");
  assert.equal(record?.errorCode, "browser-ambiguous");
  assert.match(record?.errorMessage ?? "", /not replayed/u);
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  assert.equal((await turn.readBrowserActions())[0]?.status, "ambiguous");
});

test("restart repairs missing browser completion evidence from a durable terminal record", async () => {
  const stateDir = tempDirectory();
  const session = await SessionStore.open(stateDir);
  const turn = await session.admitTurn("repair browser evidence", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const actionId = "browser_action_event_recovery";
  const callId = "browser_call_event_recovery";
  await turn.appendEvent("TurnStarted");
  await turn.appendEvent("BrowserPrepared", { actionId, callId, sessionId: "browser_session_event", tabId: "browser_tab_event", action: "click" });
  await turn.appendEvent("BrowserApprovalDecided", { actionId, callId, decision: "allow-once" });
  await turn.appendEvent("BrowserStarted", { actionId, callId });
  await turn.writeBrowserAction({
    schemaVersion: 1,
    actionId,
    callId,
    sessionId: "browser_session_event" as BrowserSessionId,
    turnId: turn.turnId,
    tabId: "browser_tab_event" as BrowserTabId,
    action: "click",
    reference: "save-button",
    documentId: "browser_document_event" as BrowserDocumentId,
    actionHash: "browser-event-recovery-hash",
    status: "completed",
    summary: "Clicked save-button.",
    recordedAt: new Date(1).toISOString(),
  });

  await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  const events = await turn.readEvents();
  assert.deepEqual(events.map((event) => event.type), [
    "TurnStarted",
    "BrowserPrepared",
    "BrowserApprovalDecided",
    "BrowserStarted",
    "BrowserCompleted",
    "TurnInterrupted",
  ]);
  assert.equal(events[4]?.payload.actionId, actionId);
  assert.equal(events[4]?.payload.status, "completed");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  assert.equal((await turn.readEvents()).filter((event) => event.type === "BrowserCompleted").length, 1);
});

test("restart closes an approved memory action after its durable acknowledgement is lost", async () => {
  const stateDir = tempDirectory();
  let actionWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "append-json-line" && filePath.endsWith("memory_action_ack.jsonl") && actionWrites++ === 1) {
          throw new Error("simulated approved memory action acknowledgement failure");
        }
      },
    },
  });
  const turn = await session.admitTurn("recover the memory action record", "deterministic", "deterministic/echo");
  const base: MemoryActionRecord = {
    schemaVersion: 1,
    operationId: "memory_action_ack",
    sessionId: session.metadata.sessionId,
    turnId: turn.turnId,
    callId: "memory_call_ack",
    operation: "add",
    scope: "user",
    sourcePath: "memory/user.md",
    afterContentHash: "memory-after-hash",
    inputHash: "memory-input-hash",
    status: "proposed",
    recordedAt: new Date().toISOString(),
  };
  await turn.writeMemoryAction(base);
  await assert.rejects(
    () => turn.writeMemoryAction({ ...base, status: "approved", decision: "allow-once", recordedAt: new Date().toISOString() }),
    /simulated approved memory action acknowledgement failure/u,
  );

  const firstRecovery = await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  assert.equal(firstRecovery[0]?.status, "interrupted");
  const record = (await turn.readMemoryActions())[0];
  assert.equal(record?.status, "denied");
  assert.equal(record?.decision, "unavailable");
  assert.match(record?.reason ?? "", /not replayed/u);
  const historyPath = path.join(turn.directory, "memory-actions", "memory_action_ack.jsonl");
  assert.equal((await readFile(historyPath, "utf8")).trim().split("\n").length, 3);
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  assert.equal((await readFile(historyPath, "utf8")).trim().split("\n").length, 3);
});

test("restart repairs missing memory completion evidence from a durable terminal record", async () => {
  const stateDir = tempDirectory();
  const session = await SessionStore.open(stateDir);
  const turn = await session.admitTurn("repair memory evidence", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const operationId = "memory_action_event_recovery";
  const callId = "memory_call_event_recovery";
  await turn.appendEvent("TurnStarted");
  await turn.appendEvent("MemoryPrepared", { operationId, callId, operation: "add", scope: "user", sourcePath: "memory/user.md" });
  await turn.appendEvent("MemoryApprovalDecided", { operationId, callId, decision: "allow-once" });
  await turn.writeMemoryAction({
    schemaVersion: 1,
    operationId,
    sessionId: session.metadata.sessionId,
    turnId: turn.turnId,
    callId,
    operation: "add",
    recordId: "memory_record_event_recovery",
    scope: "user",
    sourcePath: "memory/user.md",
    afterContentHash: "memory-event-after-hash",
    inputHash: "memory-event-input-hash",
    status: "committed",
    decision: "allow-once",
    recordedAt: new Date(1).toISOString(),
  });

  await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
  const events = await turn.readEvents();
  assert.deepEqual(events.map((event) => event.type), [
    "TurnStarted",
    "MemoryPrepared",
    "MemoryApprovalDecided",
    "MemoryCommitted",
    "TurnInterrupted",
  ]);
  assert.equal(events[3]?.payload.operationId, operationId);
  assert.equal(events[3]?.payload.status, "committed");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  assert.equal((await turn.readEvents()).filter((event) => event.type === "MemoryCommitted").length, 1);
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

test("model request size is rejected before the provider is invoked", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  let providerCalls = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/bounded-request",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string }> {
      providerCalls += 1;
      yield { type: "text", text: "should not run" };
    },
  };

  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { maxModelRequestBytes: 1 }),
    userPrompt: "request that must be rejected",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "resource-limit");
  assert.equal(providerCalls, 0);
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  assert.deepEqual(events.map((event) => event.type), ["TurnStarted", "ModelRequestRejected", "TurnFailed"]);
  const rejection = events.find((event) => event.type === "ModelRequestRejected");
  assert.equal(rejection?.payload.reason, "request-size");
  assert.equal(typeof rejection?.payload.requestBytes, "number");
});

test("model output size failure does not persist a partial assistant message", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/bounded-output", { response: "x".repeat(100) }),
    config: config(stateDir, { maxModelRequestBytes: 512 * 1024, maxModelOutputBytes: 32 }),
    userPrompt: "return bounded output",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "resource-limit");
  assert.equal(result.assistantText, undefined);
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  const attempt = events.find((event) => event.type === "ModelAttemptCompleted");
  assert.equal(attempt?.payload.status, "failed");
  assert.equal(attempt?.payload.errorCode, "resource-limit");
});

test("model output size also bounds assembled tool-call fields", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/bounded-tool-call",
    async *stream(): AsyncIterable<{ readonly type: "tool_call"; readonly call: { readonly callId: string; readonly name: string; readonly argumentsJson: string } }> {
      yield { type: "tool_call", call: { callId: "call_1", name: "read_file", argumentsJson: "x".repeat(100) } };
    },
  };
  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { maxModelRequestBytes: 512 * 1024, maxModelOutputBytes: 32 }),
    userPrompt: "return a bounded tool call",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "resource-limit");
  assert.deepEqual((await session.readTranscript()).map((message) => message.role), ["user"]);
});

test("turn retries a provider failure before the first event and records the retry", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  let calls = 0;
  const lifecycle: TurnEvent[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/flaky",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string } | { readonly type: "completed" }> {
      calls += 1;
      if (calls === 1) throw new ModelProviderError("temporary provider failure", { code: "provider" });
      yield { type: "text", text: "recovered" };
      yield { type: "completed" };
    },
  };

  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { firstEventTimeoutMs: 1_000, modelRetryAttempts: 2, modelRetryBackoffMs: 30 }),
    userPrompt: "retry once",
    onEvent: (event) => lifecycle.push(event),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "recovered");
  assert.equal(calls, 2);
  assert.equal(result.metrics?.modelRequestCount, 2);
  assert.ok(lifecycle.some((event) => event.type === "retry" && event.attempt === 1 && event.delayMs === 30));
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  const retry = events.find((event) => event.type === "ModelRetryScheduled");
  assert.equal(retry?.payload.attempt, 1);
  assert.equal(retry?.payload.nextAttempt, 2);
  const attempts = events.filter((event) => event.type === "ModelAttemptCompleted");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.payload.status, "retryable-failure");
  assert.equal(attempts[1]?.payload.status, "completed");
  assert.match(String(attempts[0]?.payload.attemptId), /^attempt_[a-f0-9]{32}$/u);
  assert.equal(typeof attempts[1]?.payload.attemptId, "string");
  assert.notEqual(attempts[0]?.payload.attemptId, attempts[1]?.payload.attemptId);
});

test("cancellation during model retry backoff does not dispatch another attempt", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const controller = new AbortController();
  let calls = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/cancel-retry",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string }> {
      calls += 1;
      throw new ModelProviderError("temporary provider failure", { code: "provider" });
    },
  };
  const lifecycle: TurnEvent[] = [];
  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { modelRetryAttempts: 2, modelRetryBackoffMs: 100 }),
    userPrompt: "cancel retry",
    signal: controller.signal,
    onEvent: (event) => {
      lifecycle.push(event);
      if (event.type === "retry") controller.abort("cancelled during retry backoff");
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(calls, 1);
  assert.equal(lifecycle.filter((event) => event.type === "retry").length, 1);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), [
    "TurnStarted",
    "ModelRequested",
    "ModelAttemptCompleted",
    "ModelRetryScheduled",
    "TurnCancelled",
  ]);
});

test("turn does not retry a provider failure after partial output", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  let calls = 0;
  const lifecycle: TurnEvent[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/partial-failure",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string }> {
      calls += 1;
      yield { type: "text", text: "partial" };
      throw new ModelProviderError("stream ended unexpectedly", { code: "provider-incomplete" });
    },
  };

  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { modelRetryAttempts: 3, modelRetryBackoffMs: 0 }),
    userPrompt: "do not duplicate partial output",
    onEvent: (event) => lifecycle.push(event),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "provider-incomplete");
  assert.equal(calls, 1);
  assert.equal(lifecycle.some((event) => event.type === "retry"), false);
});

test("timeout and cancellation produce distinct terminal results", async () => {
  const timeoutDir = tempDirectory();
  const timeoutSession = await openSession(timeoutDir);
  const timedOut = await runTurn({
    session: timeoutSession,
    provider: new DeterministicModelProvider("deterministic/echo", { behavior: "timeout" }),
    config: config(timeoutDir, { timeoutMs: 100 }),
    userPrompt: "timeout",
  });
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.error?.code, "timeout");

  const cancelDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-cancel-"));
  temporaryDirectories.push(cancelDir);
  const cancelSession = await openSession(cancelDir);
  const controller = new AbortController();
  setTimeout(() => controller.abort("cancelled"), 50);
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

test("pre-cancelled turns do not dispatch a model request", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const controller = new AbortController();
  controller.abort("cancelled before dispatch");
  let providerCalls = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/pre-cancelled",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string }> {
      providerCalls += 1;
      yield { type: "text", text: "must not be requested" };
    },
  };

  const result = await runTurn({
    session,
    provider,
    config: config(stateDir),
    userPrompt: "cancel before dispatch",
    signal: controller.signal,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(providerCalls, 0);
  const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["TurnStarted", "TurnCancelled"]);
  const turnRecord = JSON.parse(await readFile(path.join(turnDirectory, "turn.json"), "utf8")) as { state: string };
  assert.equal(turnRecord.state, "cancelled");
});

test("restart finalizes a non-terminal turn as interrupted without a model call", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("crash after admission", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  await turn.appendEvent("ModelRequested", { provider: "deterministic", model: "deterministic/echo", attemptId: "attempt_restart" });
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

test("diagnostic interruption before model send recovers without invoking the provider", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  let providerCalls = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/interruption-boundary",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string }> {
      providerCalls += 1;
      yield { type: "text", text: "must not be requested" };
    },
  };

  await assert.rejects(
    () => runTurn({
      session,
      provider,
      config: config(stateDir),
      userPrompt: "stop before model transport",
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "before-model-send") throw new RuntimeInterruptionError("stopped before model transport");
        },
      },
    }),
    /stopped before model transport/u,
  );
  assert.equal(providerCalls, 0);

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  const turnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", (await session.readTranscript())[0]!.turnId);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.deepEqual(events.map((event) => event.type), ["TurnStarted", "ModelRequested", "TurnInterrupted"]);
});

test("pre-write interruption before the terminal event repairs the completed result", async () => {
  const stateDir = tempDirectory();
  let eventWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      beforeWrite: (operation, filePath) => {
        if (operation === "append-json-line" && filePath.endsWith("/events.jsonl") && eventWrites++ === 4) {
          throw new RuntimeInterruptionError("stopped before terminal event durability");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/pre-write-event", { response: "durable response" }),
      config: config(stateDir),
      userPrompt: "persist the terminal event",
    }),
    /stopped before terminal event durability/u,
  );

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  assert.deepEqual(await restarted.recoverInterruptedTurns(), []);
  const turnId = (await session.readTranscript())[0]!.turnId;
  const turnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId);
  const result = JSON.parse(await readFile(path.join(turnDirectory, "result.json"), "utf8")) as { status: string; assistantText?: string };
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "durable response");
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  assert.equal(events.filter((event) => event.type === "TurnCompleted").length, 1);
  assert.equal(events.at(-1)?.type, "TurnCompleted");
  assert.equal(events.at(-1)?.payload.recovered, true);
});

test("diagnostic interruption after model response does not replay the provider", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  let providerCalls = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/response-interruption",
    async *stream(): AsyncIterable<{ readonly type: "text"; readonly text: string } | { readonly type: "completed" }> {
      providerCalls += 1;
      yield { type: "text", text: "response was produced" };
      yield { type: "completed" };
    },
  };

  await assert.rejects(
    () => runTurn({
      session,
      provider,
      config: config(stateDir),
      userPrompt: "stop after the provider responds",
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "after-model-response") throw new RuntimeInterruptionError("stopped after model response");
        },
      },
    }),
    /stopped after model response/u,
  );
  assert.equal(providerCalls, 1);

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  assert.equal((await restarted.readTranscript()).filter((message) => message.role === "assistant").length, 0);
});

test("pre-write interruption before the terminal result leaves the turn recoverable", async () => {
  const stateDir = tempDirectory();
  let interrupted = false;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      beforeWrite: (operation, filePath) => {
        if (!interrupted && operation === "replace-json" && filePath.endsWith("/result.json")) {
          interrupted = true;
          throw new RuntimeInterruptionError("stopped before terminal result durability");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/result-interruption", { response: "result not yet durable" }),
      config: config(stateDir),
      userPrompt: "stop before the result write",
    }),
    /stopped before terminal result durability/u,
  );

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  const turnId = (await session.readTranscript())[0]!.turnId;
  const turnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId);
  assert.equal((await readFile(path.join(turnDirectory, "result.json"), "utf8")).includes('"status":"interrupted"'), true);
  const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(events.at(-1)?.type, "TurnInterrupted");
});

test("diagnostic interruption after approval closes the process as not started", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const marker = path.join(root, "must-not-run.txt");
  const session = await openSession(stateDir);
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/process-interruption", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('must-not-run.txt', 'ran')"] }),
          finalResponse: "The command was not run.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root }),
      userPrompt: "approve only after the process is ready",
      approveProcess: async () => ({ decision: "allow-once" }),
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "after-approval" && checkpoint.actionKind === "process") {
            throw new RuntimeInterruptionError("stopped after process approval");
          }
        },
      },
    }),
    /stopped after process approval/u,
  );
  await assert.rejects(() => readFile(marker, "utf8"), { code: "ENOENT" });

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const turn = await restarted.readTranscript();
  assert.equal(turn.filter((message) => message.role === "assistant").length, 0);
  const executionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "executions");
  const executionEntry = (await readdir(executionDirectory))[0];
  assert.ok(executionEntry);
  const execution = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string; errorCode?: string };
  assert.equal(execution.status, "failed");
  assert.equal(execution.errorCode, "process-approval-unavailable");
  const events = await restarted.readTranscript();
  assert.equal(events.filter((message) => message.role === "assistant").length, 0);
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
});

test("diagnostic interruption after process start recovers the running child without replay", { skip: process.platform !== "linux" }, async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const marker = path.join(root, "must-not-run-after-recovery.txt");
  const session = await openSession(stateDir);
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/running-process-interruption", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "setTimeout(() => require('node:fs').writeFileSync('must-not-run-after-recovery.txt', 'late'), 5000)"] }),
          finalResponse: "The command completed.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, processDurationMs: 5_000, processTerminationGraceMs: 100 }),
      userPrompt: "run the delayed command",
      approveProcess: async () => ({ decision: "allow-once" }),
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "after-process-start") {
            throw new RuntimeInterruptionError("stopped after process start");
          }
        },
      },
    }),
    /stopped after process start/u,
  );

  const turnId = (await session.readTranscript())[0]!.turnId;
  const executionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "executions");
  const executionEntry = (await readdir(executionDirectory))[0];
  assert.ok(executionEntry);
  const running = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string; pid?: number };
  assert.equal(running.status, "running");
  assert.ok(running.pid);

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns(undefined, reconcileRunningProcess);
  assert.equal(recovered[0]?.status, "interrupted");
  const reconciled = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string; errorCode?: string; terminationConfirmed?: boolean };
  assert.equal(reconciled.status, "ambiguous");
  assert.equal(reconciled.errorCode, "process-ambiguous");
  assert.equal(reconciled.terminationConfirmed, true);
  await assert.rejects(() => readFile(marker, "utf8"), { code: "ENOENT" });
  const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(events.filter((event) => event.type === "ProcessStarted").length, 1);
  assert.equal(events.filter((event) => event.type === "ProcessCompleted").length, 1);
  assert.equal(events.at(-1)?.type, "TurnInterrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(undefined, reconcileRunningProcess), []);
});

test("interruption before the durable running process record cleans up the spawned child", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const marker = path.join(root, "must-not-leak.txt");
  let executionWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      beforeWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.includes(`${path.sep}executions${path.sep}`) && executionWrites++ === 2) {
          throw new RuntimeInterruptionError("stopped before running process evidence");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/process-record-interruption", {
        toolCall: {
          name: "run_command",
          argumentsJson: JSON.stringify({ command: process.execPath, args: ["-e", "setTimeout(() => require('node:fs').writeFileSync('must-not-leak.txt', 'leaked'), 300)"] }),
          finalResponse: "The command was not started.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, processDurationMs: 5_000, processTerminationGraceMs: 100 }),
      userPrompt: "run the command",
      approveProcess: async () => ({ decision: "allow-once" }),
    }),
    /stopped before running process evidence/u,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await assert.rejects(() => readFile(marker, "utf8"), { code: "ENOENT" });
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const executionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "executions");
  const executionEntry = (await readdir(executionDirectory))[0];
  assert.ok(executionEntry);
  const execution = JSON.parse(await readFile(path.join(executionDirectory, executionEntry), "utf8")) as { status: string; errorCode?: string };
  assert.equal(execution.status, "failed");
  assert.equal(execution.errorCode, "process-approval-unavailable");
});

test("diagnostic interruption after a filesystem side effect recovers without replay", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const session = await openSession(stateDir);
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/write-interruption", {
        toolCall: {
          name: "write_file",
          argumentsJson: JSON.stringify({ path: "once.txt", content: "written once\n" }),
          finalResponse: "The file was written.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
      userPrompt: "write the file",
      approveMutation: async () => ({ decision: "allow-once" }),
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "after-tool-execution" && checkpoint.toolName === "write_file") {
            throw new RuntimeInterruptionError("stopped after filesystem side effect");
          }
        },
      },
    }),
    /stopped after filesystem side effect/u,
  );
  assert.equal(await readFile(path.join(root, "once.txt"), "utf8"), "written once\n");

  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50, maxTreeEntries: 100, maxTreeBytes: 256 * 1024, maxTreeDepth: 8 });
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  assert.equal(recovered[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const mutationDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "mutations");
  const mutationEntry = (await readdir(mutationDirectory))[0];
  assert.ok(mutationEntry);
  const mutation = JSON.parse(await readFile(path.join(mutationDirectory, mutationEntry), "utf8")) as { status: string; mutationId: string };
  assert.equal(mutation.status, "committed");
  const eventLines = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  assert.equal(eventLines.filter((event) => event.type === "WorkspaceMutationCommitted").length, 1);
  assert.equal(eventLines.at(-1)?.type, "TurnInterrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
});

test("filesystem completion acknowledgement loss repairs evidence without replay", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  let mutationAcknowledgements = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.includes(`${path.sep}mutations${path.sep}`) && filePath.endsWith(".json") && mutationAcknowledgements++ === 3) {
          throw new RuntimeInterruptionError("stopped after filesystem completion evidence became durable");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/write-ack-boundary", {
        toolCall: {
          name: "write_file",
          argumentsJson: JSON.stringify({ path: "once.txt", content: "written once\n" }),
          finalResponse: "The file was written.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
      userPrompt: "Write the file once.",
      approveMutation: async () => ({ decision: "allow-once" }),
    }),
    /stopped after filesystem completion evidence became durable/u,
  );
  assert.equal(await readFile(path.join(root, "once.txt"), "utf8"), "written once\n");

  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50, maxTreeEntries: 100, maxTreeBytes: 256 * 1024, maxTreeDepth: 8 });
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  assert.equal((await restarted.recoverInterruptedTurns((record) => workspace.reconcileMutation(record)))[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const mutationDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "mutations");
  const mutationEntry = (await readdir(mutationDirectory))[0];
  assert.ok(mutationEntry);
  const mutation = JSON.parse(await readFile(path.join(mutationDirectory, mutationEntry), "utf8")) as { status: string };
  assert.equal(mutation.status, "committed");
  const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload?: { recovered?: boolean } });
  assert.equal(events.filter((event) => event.type === "WorkspaceMutationCommitted").length, 1);
  assert.equal(events.find((event) => event.type === "WorkspaceMutationCommitted")?.payload?.recovered, true);
  assert.equal(events.at(-1)?.type, "TurnInterrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
  assert.equal(await readFile(path.join(root, "once.txt"), "utf8"), "written once\n");
});

test("filesystem interruption before the applying record does not commit the mutation", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "once.txt");
  await writeFile(target, "old\n", "utf8");
  let mutationWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      beforeWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.includes(`${path.sep}mutations${path.sep}`) && mutationWrites++ === 2) {
          throw new RuntimeInterruptionError("stopped before filesystem applying evidence");
        }
      },
    },
  });
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/pre-apply-boundary", {
        toolCall: {
          name: "write_file",
          argumentsJson: JSON.stringify({ path: "once.txt", content: "new\n" }),
          finalResponse: "The file was not changed.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
      userPrompt: "Change the file only after the applying record is durable.",
      approveMutation: async () => ({ decision: "allow-once" }),
    }),
    /stopped before filesystem applying evidence/u,
  );
  assert.equal(await readFile(target, "utf8"), "old\n");

  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50, maxTreeEntries: 100, maxTreeBytes: 256 * 1024, maxTreeDepth: 8 });
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  assert.equal((await restarted.recoverInterruptedTurns((record) => workspace.reconcileMutation(record)))[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const mutationDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "mutations");
  const mutationEntry = (await readdir(mutationDirectory))[0];
  assert.ok(mutationEntry);
  const mutation = JSON.parse(await readFile(path.join(mutationDirectory, mutationEntry), "utf8")) as { status: string };
  assert.equal(mutation.status, "reconciled");
  const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload?: { recovered?: boolean } });
  assert.equal(events.filter((event) => event.type === "WorkspaceMutationReconciled").length, 1);
  assert.equal(events.find((event) => event.type === "WorkspaceMutationReconciled")?.payload?.recovered, true);
  assert.equal(events.at(-1)?.type, "TurnInterrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
  assert.equal(await readFile(target, "utf8"), "old\n");
});

test("diagnostic interruption between multi-file members preserves partial progress without replay", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  const session = await openSession(stateDir);
  await assert.rejects(
    () => runTurn({
      session,
      provider: new DeterministicModelProvider("deterministic/patch-set-interruption", {
        toolCall: {
          name: "apply_patch_set",
          argumentsJson: JSON.stringify({ patches: [
            `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
            `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
          ] }),
          finalResponse: "The patch set was applied.",
        },
      }),
      config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 4_000 }),
      userPrompt: "update both notes",
      approveMutation: async () => ({ decision: "allow-once" }),
      diagnostics: {
        onCheckpoint: (checkpoint) => {
          if (checkpoint.type === "after-mutation-member" && checkpoint.path === "one.txt") {
            throw new RuntimeInterruptionError("stopped between patch-set members");
          }
        },
      },
    }),
    /stopped between patch-set members/u,
  );
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");

  const workspace = await Workspace.open(root, { maxFileBytes: 64 * 1024, maxDirectoryEntries: 50, maxTreeEntries: 100, maxTreeBytes: 256 * 1024, maxTreeDepth: 8 });
  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await restarted.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  assert.equal(recovered[0]?.status, "interrupted");
  const turnId = (await session.readTranscript())[0]!.turnId;
  const mutationDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "mutations");
  const mutationEntry = (await readdir(mutationDirectory))[0];
  assert.ok(mutationEntry);
  const mutation = JSON.parse(await readFile(path.join(mutationDirectory, mutationEntry), "utf8")) as {
    status: string;
    errorCode?: string;
    journal?: { state: string; members: Array<{ path: string; state: string }> };
  };
  assert.equal(mutation.status, "reconciliation_required");
  assert.equal(mutation.errorCode, "reconciliation-required");
  assert.equal(mutation.journal?.state, "reconciliation_required");
  assert.deepEqual(mutation.journal?.members.map((member) => ({ path: member.path, state: member.state })), [
    { path: "one.txt", state: "committed" },
    { path: "two.txt", state: "pending" },
  ]);
  const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  const progressEvents = events.filter((event) => event.type === "WorkspaceMutationProgress");
  assert.ok(progressEvents.length >= 4);
  assert.equal(progressEvents.filter((event) => {
    const journal = event.payload.journal as { members?: Array<{ path: string; state: string }> } | undefined;
    return journal?.members?.some((member) => member.path === "one.txt" && member.state === "committed") === true;
  }).length, 1);
  assert.equal(events.filter((event) => event.type === "WorkspaceMutationFailed").length, 1);
  assert.equal(events.at(-1)?.type, "TurnInterrupted");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");
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

test("malformed terminal results are rejected without overwriting or recovery adoption", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("malformed result", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "done",
  };
  const resultPath = path.join(turn.directory, "result.json");
  await writeFile(resultPath, "{not-json\n", "utf8");
  await assert.rejects(() => turn.writeResult(result), /Could not read durable record/u);
  assert.equal(await readFile(resultPath, "utf8"), "{not-json\n");

  const reopened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => reopened.recoverInterruptedTurns(), /Could not read durable record/u);
  assert.equal(await readFile(resultPath, "utf8"), "{not-json\n");
  const turnRecord = JSON.parse(await readFile(path.join(turn.directory, "turn.json"), "utf8")) as { state: string };
  assert.equal(turnRecord.state, "streaming");
});

test("recovery rejects a terminal event that conflicts with the durable result", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("conflicting terminal evidence", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "done",
  };
  await turn.writeResult(result);
  await turn.appendEvent("TurnCompleted", { status: "failed" });

  const reopened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => reopened.recoverInterruptedTurns(), /does not match terminal result status/u);
  const turnRecord = JSON.parse(await readFile(path.join(turn.directory, "turn.json"), "utf8")) as { state: string };
  assert.equal(turnRecord.state, "streaming");
});

test("terminal result status must match an already-terminal durable turn", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("conflicting terminal state", "deterministic", "deterministic/echo");
  await turn.updateState("failed");
  const result = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: "completed" as const,
    provider: "deterministic" as const,
    model: "deterministic/echo",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    assistantText: "done",
  };
  await assert.rejects(() => turn.writeResult(result), /does not match durable turn state/u);
  await atomicWriteJson(path.join(turn.directory, "result.json"), result);

  const reopened = await SessionStore.open(stateDir, session.metadata.sessionId);
  await assert.rejects(() => reopened.recoverInterruptedTurns(), /does not match durable turn state/u);
  const turnRecord = JSON.parse(await readFile(path.join(turn.directory, "turn.json"), "utf8")) as { state: string };
  assert.equal(turnRecord.state, "failed");
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
  assert.deepEqual(events[0], { type: "text", text: "hello" });
  assert.equal(events[1]?.type, "completed");
  assert.deepEqual(events[1]?.usage, { inputTokens: 2, outputTokens: 1, totalTokens: 3 });
  assert.equal(typeof events[1]?.latencyMs, "number");
  assert.ok((events[1]?.latencyMs ?? -1) >= 0);
  assert.equal(requestHeaders?.get("authorization"), "Bearer stream-secret");
});

test("OpenRouter adapter preserves bounded request identity and latency metadata", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "metadata-secret", async () => new Response(stream, {
    status: 200,
    headers: { "x-request-id": "req_model_123" },
  }));
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  const events = [];
  for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
  const completed = events.at(-1);
  assert.equal(completed?.type, "completed");
  assert.equal(completed?.providerRequestId, "req_model_123");
  assert.equal(typeof completed?.latencyMs, "number");
  assert.ok((completed?.latencyMs ?? -1) >= 0);
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
  assert.deepEqual(events[0], { type: "tool_call", call: { callId: "call_1", name: "read_file", argumentsJson: '{"path":"README.txt"}' } });
  assert.equal(events[1]?.type, "completed");
  assert.equal(events[1]?.usage, undefined);
  assert.equal(typeof events[1]?.latencyMs, "number");
  assert.deepEqual(requestBody?.tools, [{ type: "function", function: { name: "read_file", description: "Read a file.", parameters: { type: "object" } } }]);
  assert.deepEqual(requestBody?.messages, [
    { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "list_directory", arguments: "{}" } }] },
    { role: "tool", content: "{\"entries\":[]}", tool_call_id: "call_0", name: "list_directory" },
  ]);
});

test("OpenRouter adapter rejects a response stream above its configured byte limit", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "bounded-secret", async () => new Response(stream, { status: 200 }), 4);
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  await assert.rejects(
    async () => { for await (const _event of provider.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ComputerNativeError && error.code === "resource-limit" && error.message.includes("4-byte limit"),
  );
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
  const unauthorized = new OpenRouterModelProvider("openai/example", "secret", async () => new Response("unauthorized", { status: 401 }));
  await assert.rejects(
    async () => { for await (const _event of unauthorized.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-auth" && error.retryable === false,
  );
  const contextLimited = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(
    JSON.stringify({ error: { message: "maximum context length exceeded" } }),
    { status: 400, headers: { "content-type": "application/json" } },
  ));
  await assert.rejects(
    async () => { for await (const _event of contextLimited.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-context" && error.retryable === false,
  );
  const refusal = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(
    JSON.stringify({ error: { message: "request blocked by content policy" } }),
    { status: 400, headers: { "content-type": "application/json" } },
  ));
  await assert.rejects(
    async () => { for await (const _event of refusal.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-refusal" && error.retryable === false,
  );
});

test("OpenRouter adapter rejects malformed stream shapes as non-retryable provider errors", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":"not-an-array"}}]}\n\n'));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(stream, { status: 200 }));
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  await assert.rejects(
    async () => { for await (const _event of provider.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-incomplete" && error.retryable === false,
  );

  const malformedEntryStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[null]}}]}\n\n'));
      controller.close();
    },
  });
  const malformedEntry = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(malformedEntryStream, { status: 200 }));
  await assert.rejects(
    async () => { for await (const _event of malformedEntry.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-incomplete" && error.retryable === false,
  );
});

test("OpenRouter adapter classifies a streamed refusal without retrying it", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"refusal":"I cannot help with that request."}}]}\n\n'));
      controller.close();
    },
  });
  const provider = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(stream, { status: 200 }));
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  await assert.rejects(
    async () => { for await (const _event of provider.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider-refusal" && error.retryable === false,
  );
});

test("OpenRouter adapter classifies stream disconnects without leaking raw transport errors", async () => {
  const request: ModelRequest = {
    sessionId: asSessionId("session_test"),
    turnId: asTurnId("turn_test"),
    provider: "openrouter",
    model: "openai/example",
    messages: [{ role: "user", content: "hello" }],
  };
  const disconnectedBeforeOutput = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("socket closed before output"));
    },
  }), { status: 200 }));
  await assert.rejects(
    async () => { for await (const _event of disconnectedBeforeOutput.stream(request, new AbortController().signal)) void _event; },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider" && error.retryable === true && !error.message.includes("socket closed before output"),
  );

  let sent = false;
  const disconnectedAfterOutput = new OpenRouterModelProvider("openai/example", "secret", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        return;
      }
      controller.error(new Error("socket closed after output"));
    },
  }), { status: 200 }));
  const events: unknown[] = [];
  await assert.rejects(
    async () => { for await (const event of disconnectedAfterOutput.stream(request, new AbortController().signal)) events.push(event); },
    (error: unknown) => error instanceof ModelProviderError && error.code === "provider" && error.retryable === false,
  );
  assert.deepEqual(events, [{ type: "text", text: "partial" }]);
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
  assert.match(result.stdout, /model\/tool rounds: 8/);
  assert.match(result.stdout, /browser: enabled/);
  assert.match(result.stdout, /browser max tabs: 8/);
  assert.match(result.stdout, /browser session timeout: 1800000ms/);
  assert.match(result.stdout, /browser read-only retries: 1/);
  assert.match(result.stdout, /browser profile retention: 86400000ms/);
  assert.match(result.stdout, /browser artifact retention: 604800000ms/);
  assert.match(result.stdout, /browser cleanup maximum: 100 entries/);
  assert.match(result.stdout, /browser screenshots: 4194304 bytes, 1920x1080 pixels/);
  assert.match(result.stdout, /result: reachable/);
  await assert.rejects(() => readFile(path.join(stateDir, "sessions"), "utf8"));
});

test("CLI arguments keep doctor separate from chat prompts", () => {
  assert.equal(parseArgs(["doctor"]).command, "doctor");
  assert.equal(parseArgs(["chat", "--process-mode", "deny"]).processMode, "deny");
  assert.equal(parseArgs(["chat", "--process-calls-per-turn", "2"]).processCallsPerTurn, 2);
  assert.throws(() => parseArgs(["chat", "--process-mode", "unsafe"]), /must be deny or approval/);
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

test("workspace reads an exact multi-chunk file at the configured byte limit", async () => {
  const root = path.join(tempDirectory(), "workspace");
  const bytes = Buffer.alloc((64 * 1024) + 17, 0x61);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "bounded.txt"), bytes);
  const workspace = await Workspace.open(root, { maxFileBytes: bytes.byteLength, maxDirectoryEntries: 10 });

  const file = await workspace.readFile("bounded.txt");
  assert.equal(file.sizeBytes, bytes.byteLength);
  assert.equal(file.content, bytes.toString("utf8"));
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

test("workspace stat returns metadata without following a symlink target", async () => {
  const base = tempDirectory();
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside.txt");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "note.txt"), "secret content", "utf8");
  await writeFile(outside, "outside content", "utf8");
  await symlink(outside, path.join(root, "outside-link.txt"));
  await createHardLink(path.join(root, "note.txt"), path.join(root, "note-hardlink.txt"));
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });

  const file = await workspace.stat("note.txt");
  assert.equal(file.path, "note.txt");
  assert.equal(file.kind, "file");
  assert.equal(file.sizeBytes, Buffer.byteLength("secret content", "utf8"));
  assert.ok(file.linkCount >= 2);
  assert.match(file.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof file.mode, "number");

  const directory = await workspace.stat("nested");
  assert.equal(directory.kind, "directory");
  assert.equal(directory.path, "nested");

  const link = await workspace.stat("outside-link.txt");
  assert.equal(link.kind, "symlink");
  assert.equal(link.path, "outside-link.txt");
  assert.ok(link.sizeBytes > 0);
  await assert.rejects(() => workspace.stat("../outside.txt"), /outside the workspace root/);
});

test("workspace search finds bounded literal matches while skipping hidden, generated, and sensitive paths", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "src", "one.txt"), "needle first\nother\nneedle second\n", "utf8");
  await writeFile(path.join(root, ".env"), "needle=do-not-return\n", "utf8");
  await writeFile(path.join(root, "node_modules", "generated.txt"), "needle generated\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });

  const result = await workspace.searchFiles(".", "needle", 10);
  assert.equal(result.query, "needle");
  assert.deepEqual(result.matches.map((match) => ({ path: match.path, line: match.line, column: match.column })), [
    { path: "src/one.txt", line: 1, column: 1 },
    { path: "src/one.txt", line: 3, column: 1 },
  ]);
  assert.equal(result.truncated, false);
  assert.equal(result.filesScanned, 1);
  assert.doesNotMatch(JSON.stringify(result), /do-not-return|generated/);

  const bounded = await workspace.searchFiles("src", "needle", 1);
  assert.equal(bounded.matches.length, 1);
  assert.equal(bounded.truncated, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => workspace.searchFiles(".", "needle", 10, controller.signal), /cancelled/);
});

test("workspace search supports bounded path-name matching with explicit pattern diagnostics", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "one.ts"), "export const one = 1;\n", "utf8");
  await writeFile(path.join(root, "src", "two.txt"), "plain text\n", "utf8");
  await writeFile(path.join(root, "README.md"), "readme\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });

  const result = await workspace.searchFiles(".", "", 10, undefined, "src/*.ts");
  assert.equal(result.query, "");
  assert.equal(result.namePattern, "src/*.ts");
  assert.deepEqual(result.nameMatches, ["src/one.ts"]);
  assert.equal(result.matches.length, 0);

  const truncated = await workspace.searchFiles(".", "", 1, undefined, "*");
  assert.equal(truncated.nameMatches.length, 1);
  assert.equal(truncated.truncated, true);
  await assert.rejects(() => workspace.searchFiles(".", "", 10, undefined, "src/[broken"), /name pattern/);
  await assert.rejects(() => workspace.searchFiles(".", "", 10, undefined, "../*"), /name pattern/);
  await assert.rejects(() => workspace.searchFiles(".", "", 10, undefined, ""), /query or a name pattern/);
});

test("workspace prepares whole-file writes for creation and replacement without writing before commit", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  await writeFile(path.join(root, "note.txt"), "old\n", "utf8");
  await chmod(path.join(root, "note.txt"), 0o640);

  const replacement = await workspace.prepareWrite("note.txt", "new content\n");
  assert.equal(replacement.operation, "write");
  assert.equal(replacement.beforeContent, "old\n");
  assert.equal(replacement.afterContent, "new content\n");
  assert.match(replacement.diff, /-old/);
  assert.match(replacement.diff, /\+new content/);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "old\n");
  await workspace.commitPatch(replacement);
  assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "new content\n");
  assert.equal((await stat(path.join(root, "note.txt"))).mode & 0o7777, 0o640);

  const creation = await workspace.prepareWrite("created.txt", "created\n");
  assert.equal(creation.beforeContent, "");
  assert.equal(creation.afterContent, "created\n");
  assert.equal(await readFile(path.join(root, "created.txt")).catch(() => undefined), undefined);
  await workspace.commitPatch(creation);
  assert.equal(await readFile(path.join(root, "created.txt"), "utf8"), "created\n");
  assert.equal((await stat(path.join(root, "created.txt"))).mode & 0o7777, 0o600);
  await mkdir(path.join(root, "directory-target"));
  await assert.rejects(() => workspace.prepareWrite("directory-target", "not a file"), /not a regular file/);
  const smallRoot = path.join(tempDirectory(), "small-workspace");
  await mkdir(smallRoot, { recursive: true });
  const smallWorkspace = await Workspace.open(smallRoot, { maxFileBytes: 5, maxDirectoryEntries: 10 });
  await assert.rejects(() => smallWorkspace.prepareWrite("too-large.txt", "123456"), /exceed the 5-byte limit/);
});

test("workspace prepares one-level directory creation and treats an existing directory as a no-op", async () => {
  const root = path.join(tempDirectory(), "workspace");
  const outside = path.join(tempDirectory(), "outside-directory");
  await mkdir(path.join(root, "parent"), { recursive: true });
  await mkdir(outside, { recursive: true });
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });

  const prepared = await workspace.prepareDirectory("parent/new-dir");
  assert.equal(prepared.operation, "mkdir");
  assert.equal(prepared.path, "parent/new-dir");
  assert.equal(prepared.alreadyExists, false);
  assert.match(prepared.preview, /Create directory/);
  await assert.rejects(() => workspace.stat("parent/new-dir"), /does not exist/);
  const committed = await workspace.commitDirectory(prepared);
  assert.equal(committed.created, true);
  assert.equal((await workspace.stat("parent/new-dir")).kind, "directory");

  const existing = await workspace.prepareDirectory("parent/new-dir");
  assert.equal(existing.alreadyExists, true);
  const repeated = await workspace.commitDirectory(existing);
  assert.equal(repeated.created, false);
  await assert.rejects(() => workspace.prepareDirectory("missing/new-dir"), /parent.*does not exist/);
  await symlink(outside, path.join(root, "linked-parent"));
  await assert.rejects(() => workspace.prepareDirectory("linked-parent/new-dir"), /outside the workspace root/);

  const boundedRoot = path.join(tempDirectory(), "bounded-workspace");
  await mkdir(path.join(boundedRoot, "level-one", "level-two"), { recursive: true });
  await writeFile(path.join(boundedRoot, "existing.txt"), "existing\n", "utf8");
  const boundedWorkspace = await Workspace.open(boundedRoot, { maxFileBytes: 100, maxDirectoryEntries: 1, maxTreeDepth: 2 });
  await assert.rejects(() => boundedWorkspace.prepareDirectory("level-one/level-two/new-dir"), /depth limit/);
  await assert.rejects(() => boundedWorkspace.prepareDirectory("another-dir"), /entry limit/);
});

test("workspace deletes only empty directories and never performs recursive removal", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "empty"), { recursive: true });
  await mkdir(path.join(root, "non-empty"), { recursive: true });
  await writeFile(path.join(root, "non-empty", "keep.txt"), "keep\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });

  const prepared = await workspace.prepareDirectoryDeletion("empty");
  assert.equal(prepared.operation, "delete-directory");
  assert.equal(prepared.path, "empty");
  assert.match(prepared.preview, /Delete empty directory/);
  assert.equal((await workspace.stat("empty")).kind, "directory");

  const committed = await workspace.commitDirectoryDeletion(prepared);
  assert.equal(committed.path, "empty");
  assert.equal(committed.removed, true);
  await assert.rejects(() => workspace.stat("empty"), /does not exist/);

  await assert.rejects(() => workspace.prepareDirectoryDeletion("non-empty"), /empty|recursive/);
  await assert.rejects(() => workspace.prepareDirectoryDeletion("."), /root|cannot/);

  const raceDirectory = await workspace.prepareDirectory("race");
  await workspace.commitDirectory(raceDirectory);
  const raceDeletion = await workspace.prepareDirectoryDeletion("race");
  await writeFile(path.join(root, "race", "appeared.txt"), "changed after approval\n", "utf8");
  await assert.rejects(() => workspace.commitDirectoryDeletion(raceDeletion), /empty|recursive/);
  assert.equal((await workspace.stat("race")).kind, "directory");
  assert.equal(await readFile(path.join(root, "race", "appeared.txt"), "utf8"), "changed after approval\n");
});

test("workspace quarantines a file for deletion and restores it from the recovery token", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "keep me\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });

  const prepared = await workspace.prepareDelete("note.txt", "mutation_delete_test");
  assert.equal(prepared.operation, "delete");
  assert.equal(prepared.path, "note.txt");
  assert.match(prepared.preview, /Delete file/);
  assert.equal(await readFile(target, "utf8"), "keep me\n");

  const deleted = await workspace.commitDelete(prepared);
  assert.equal(deleted.path, "note.txt");
  assert.equal(deleted.quarantinePath, ".computer-native-trash/mutation_delete_test/payload");
  await assert.rejects(() => readFile(target));
  assert.match(await readFile(path.join(root, deleted.quarantinePath), "utf8"), /keep me/);
  const quarantine = await workspace.listQuarantine(10);
  assert.equal(quarantine.truncated, false);
  assert.equal(quarantine.entries.length, 1);
  const quarantineEntry = quarantine.entries[0]!;
  assert.equal(quarantineEntry.mutationId, "mutation_delete_test");
  assert.equal(quarantineEntry.originalPath, "note.txt");
  assert.equal(quarantineEntry.beforeHash, prepared.beforeHash);
  assert.equal(quarantineEntry.bytes, prepared.bytes);
  assert.equal(quarantineEntry.mode, prepared.mode);
  assert.equal(typeof quarantineEntry.createdAt, "string");
  assert.equal(quarantineEntry.payloadAvailable, true);
  assert.equal("content" in quarantineEntry, false);
  const outsideQuarantine = path.join(tempDirectory(), "outside-quarantine");
  await mkdir(outsideQuarantine, { recursive: true });
  const invalidEntry = path.join(root, ".computer-native-trash", "mutation_invalid_entry");
  await symlink(outsideQuarantine, invalidEntry);
  await assert.rejects(() => workspace.listQuarantine(10), /invalid recovery entry/);
  await rm(invalidEntry, { force: true });
  const manifestPath = path.join(root, ".computer-native-trash", "mutation_delete_test", "manifest.json");
  const manifestBackup = `${manifestPath}.real`;
  await rename(manifestPath, manifestBackup);
  await symlink(manifestBackup, manifestPath);
  await assert.rejects(() => workspace.listQuarantine(10), /symbolic link/);
  await rm(manifestPath, { force: true });
  await rename(manifestBackup, manifestPath);
  assert.doesNotMatch((await workspace.listDirectory(".")).entries.map((entry) => entry.name).join("\n"), /computer-native-trash/);
  await assert.rejects(() => workspace.stat(".computer-native-trash"), /reserved for internal recovery data/);
  await assert.rejects(() => workspace.stat(".computer-native-transactions"), /reserved for internal recovery data/);

  await rename(manifestPath, manifestBackup);
  await writeFile(manifestPath, Buffer.alloc((8 * 1024 * 1024) + 1, 0x20));
  await assert.rejects(() => workspace.prepareRestore("mutation_delete_test"), /missing or invalid/);
  await rm(manifestPath);
  await rename(manifestBackup, manifestPath);

  await writeFile(target, "new user content\n", "utf8");
  await assert.rejects(() => workspace.prepareRestore("mutation_delete_test"), /already exists/);
  await rm(target);

  const restore = await workspace.prepareRestore("mutation_delete_test");
  assert.equal(restore.operation, "restore");
  assert.equal(restore.path, "note.txt");
  assert.match(restore.preview, /Restore file/);
  const restored = await workspace.commitRestore(restore);
  assert.equal(restored.path, "note.txt");
  assert.equal(await readFile(target, "utf8"), "keep me\n");
  assert.deepEqual((await workspace.listQuarantine(10)).entries, []);
  await assert.rejects(() => readFile(path.join(root, deleted.quarantinePath)));
});

test("workspace quarantines, restores, and purges a bounded directory tree with a manifest", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "README.md"), "read me\n", "utf8");
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const answer = 42;\n", "utf8");
  const workspace = await Workspace.open(root, {
    maxFileBytes: 100,
    maxDirectoryEntries: 20,
    maxTreeEntries: 10,
    maxTreeBytes: 1_000,
    maxTreeDepth: 4,
  });

  const prepared = await workspace.prepareDirectoryTreeDeletion("project", "mutation_tree_test");
  assert.equal(prepared.operation, "delete-directory-tree");
  assert.equal(prepared.entryCount, 4);
  assert.equal(prepared.totalBytes, Buffer.byteLength("read me\n") + Buffer.byteLength("export const answer = 42;\n"));
  assert.equal(prepared.maxDepth, 2);
  assert.match(prepared.preview, /bounded directory tree/);
  assert.equal((await workspace.stat("project")).kind, "directory");
  await writeFile(path.join(root, "project", "src", "main.ts"), "changed after approval\n", "utf8");
  await assert.rejects(() => workspace.commitDirectoryTreeDeletion(prepared), /changed after the deletion proposal/);
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const answer = 42;\n", "utf8");

  const deleted = await workspace.commitDirectoryTreeDeletion(prepared);
  assert.equal(deleted.path, "project");
  await assert.rejects(() => workspace.stat("project"));
  const listing = await workspace.listQuarantine(10);
  assert.equal(listing.entries[0]?.kind, "directory");
  assert.equal(listing.entries[0]?.entryCount, prepared.entryCount);
  assert.equal(listing.entries[0]?.manifestHash, prepared.manifestHash);

  const restore = await workspace.prepareDirectoryRestore("mutation_tree_test");
  assert.equal(restore.operation, "restore-directory");
  await workspace.commitDirectoryRestore(restore);
  assert.equal(await readFile(path.join(root, "project", "src", "main.ts"), "utf8"), "export const answer = 42;\n");
  assert.deepEqual((await workspace.listQuarantine(10)).entries, []);

  const secondDeletion = await workspace.prepareDirectoryTreeDeletion("project", "mutation_tree_purge");
  await workspace.commitDirectoryTreeDeletion(secondDeletion);
  const purge = await workspace.prepareQuarantinePurge("mutation_tree_purge");
  assert.equal(purge.operation, "purge-quarantine");
  const purged = await workspace.commitQuarantinePurge(purge);
  assert.equal(purged.sourceMutationId, "mutation_tree_purge");
  assert.deepEqual((await workspace.listQuarantine(10)).entries, []);

  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "recreated for purge safety\n", "utf8");
  const partial = await workspace.prepareDirectoryTreeDeletion("project", "mutation_tree_partial_purge");
  await workspace.commitDirectoryTreeDeletion(partial);
  const outside = path.join(tempDirectory(), "purge-outside.txt");
  await writeFile(outside, "must not be followed", "utf8");
  await symlink(outside, path.join(root, partial.quarantinePath, "aaa-link"));
  const partialPurge = await workspace.prepareQuarantinePurge("mutation_tree_partial_purge");
  await assert.rejects(() => workspace.commitQuarantinePurge(partialPurge), (error: unknown) => error instanceof ComputerNativeError && error.code === "reconciliation-required");
  await rm(path.join(root, partial.quarantinePath, "aaa-link"));
  await workspace.commitQuarantinePurge(partialPurge);
});

test("workspace tree deletion rejects unsafe entries and configured bounds before approval", async () => {
  const base = tempDirectory();
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside.txt");
  await mkdir(path.join(root, "tree", "deep"), { recursive: true });
  await writeFile(outside, "outside\n", "utf8");
  await writeFile(path.join(root, "tree", "deep", "large.txt"), "0123456789", "utf8");
  await symlink(outside, path.join(root, "tree", "outside-link"));
  const workspace = await Workspace.open(root, {
    maxFileBytes: 100,
    maxDirectoryEntries: 20,
    maxTreeEntries: 20,
    maxTreeBytes: 5,
    maxTreeDepth: 2,
  });
  await assert.rejects(() => workspace.prepareDirectoryTreeDeletion("tree", "mutation_tree_unsafe"), /symbolic link|byte|depth/i);

  await rm(path.join(root, "tree", "outside-link"));
  await assert.rejects(() => workspace.prepareDirectoryTreeDeletion("tree", "mutation_tree_unsafe"), /byte|depth/i);
  await assert.rejects(() => workspace.prepareDirectoryTreeDeletion(".", "mutation_tree_root"), /root|cannot/);
  await assert.rejects(() => workspace.prepareQuarantinePurge("not-a-token"), /token|invalid/);

  const specialRoot = path.join(root, "special-tree");
  await mkdir(specialRoot, { recursive: true });
  const fifo = path.join(specialRoot, "pipe");
  await execFileAsync("mkfifo", [fifo]);
  await assert.rejects(() => workspace.prepareDirectoryTreeDeletion("special-tree", "mutation_tree_special"), /unsupported filesystem entry/);
});

test("workspace prepares bounded file copies and same-filesystem moves with source hashes", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const source = path.join(root, "source.txt");
  await writeFile(source, "copy me\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });

  const copy = await workspace.prepareCopy("source.txt", "copy.txt");
  assert.equal(copy.operation, "copy");
  assert.equal(copy.sourcePath, "source.txt");
  assert.equal(copy.path, "copy.txt");
  assert.equal(copy.beforeHash, copy.afterHash);
  assert.match(copy.preview, /Copy file/);
  const copied = await workspace.commitCopy(copy);
  assert.equal(copied.path, "copy.txt");
  assert.equal(await readFile(path.join(root, "copy.txt"), "utf8"), "copy me\n");
  assert.equal(await readFile(source, "utf8"), "copy me\n");
  await assert.rejects(() => workspace.prepareCopy("source.txt", "copy.txt"), /destination.*exists/);

  const move = await workspace.prepareMove("copy.txt", "moved.txt");
  assert.equal(move.operation, "move");
  assert.equal(move.sourcePath, "copy.txt");
  assert.match(move.preview, /Move file/);
  const moved = await workspace.commitMove(move);
  assert.equal(moved.path, "moved.txt");
  await assert.rejects(() => readFile(path.join(root, "copy.txt")));
  assert.equal(await readFile(path.join(root, "moved.txt"), "utf8"), "copy me\n");

  const staleMove = await workspace.prepareMove("moved.txt", "final.txt");
  await writeFile(path.join(root, "moved.txt"), "user edit\n", "utf8");
  await assert.rejects(() => workspace.commitMove(staleMove), /changed after the move proposal/);
  await assert.rejects(() => readFile(path.join(root, "final.txt")));
});

test("workspace streams a bounded multi-chunk file copy into its destination", async () => {
  const root = path.join(tempDirectory(), "workspace");
  const bytes = Buffer.alloc((64 * 1024) + 17, 0x62);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "source.bin"), bytes);
  const workspace = await Workspace.open(root, { maxFileBytes: bytes.byteLength, maxDirectoryEntries: 10 });

  const prepared = await workspace.prepareCopy("source.bin", "copy.bin");
  const copied = await workspace.commitCopy(prepared);
  assert.equal(copied.bytes, bytes.byteLength);
  assert.deepEqual(await readFile(path.join(root, "copy.bin")), bytes);
});

test("workspace copies, moves, and renames bounded directory trees without following links", async () => {
  const base = tempDirectory();
  const root = path.join(base, "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "README.md"), "read me\n", "utf8");
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const answer = 42;\n", "utf8");
  const workspace = await Workspace.open(root, {
    maxFileBytes: 100,
    maxDirectoryEntries: 20,
    maxTreeEntries: 20,
    maxTreeBytes: 1_000,
    maxTreeDepth: 4,
  });

  const copy = await workspace.prepareCopy("project", "project-copy");
  assert.equal(copy.operation, "copy");
  assert.equal(copy.kind, "directory");
  assert.equal(copy.sourcePath, "project");
  assert.equal(copy.path, "project-copy");
  assert.match(copy.preview, /Copy directory tree/);
  const copied = await workspace.commitCopy(copy);
  assert.equal(copied.path, "project-copy");
  assert.equal(await readFile(path.join(root, "project-copy", "src", "main.ts"), "utf8"), "export const answer = 42;\n");
  assert.equal(await readFile(path.join(root, "project", "README.md"), "utf8"), "read me\n");

  await mkdir(path.join(root, "archive"), { recursive: true });
  const move = await workspace.prepareMove("project-copy", "archive/project");
  assert.equal(move.kind, "directory");
  assert.match(move.preview, /Move directory tree/);
  await workspace.commitMove(move);
  await assert.rejects(() => lstat(path.join(root, "project-copy")));
  assert.equal(await readFile(path.join(root, "archive", "project", "src", "main.ts"), "utf8"), "export const answer = 42;\n");

  const rename = await workspace.prepareRename("archive/project", "archive/renamed-project");
  assert.equal(rename.operation, "rename");
  assert.equal(rename.kind, "directory");
  assert.match(rename.preview, /Rename directory/);
  await workspace.commitRename(rename);
  await assert.rejects(() => lstat(path.join(root, "archive", "project")));
  assert.equal(await readFile(path.join(root, "archive", "renamed-project", "README.md"), "utf8"), "read me\n");

  const outside = path.join(base, "outside.txt");
  await writeFile(outside, "must not be followed\n", "utf8");
  await mkdir(path.join(root, "unsafe"), { recursive: true });
  await symlink(outside, path.join(root, "unsafe", "outside-link"));
  await assert.rejects(() => workspace.prepareCopy("unsafe", "copy-with-link"), /symbolic link/);
});

test("workspace rejects a cross-device move before approval", async () => {
  const sourceRoot = tempDirectory();
  const sourcePath = path.join(sourceRoot, "source.txt");
  await writeFile(sourcePath, "do not move\n", "utf8");
  const sourceDevice = (await stat(sourceRoot)).dev;
  const procDevice = (await stat("/proc")).dev;
  if (sourceDevice === procDevice) return;

  const workspace = await Workspace.open("/", { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const sourceRelative = path.relative("/", sourcePath).replaceAll(path.sep, "/");
  const destinationRelative = `proc/computer-native-move-${path.basename(sourceRoot)}`;
  await assert.rejects(
    () => workspace.prepareMove(sourceRelative, destinationRelative),
    /different filesystems|cross-device/i,
  );
  assert.equal(await readFile(sourcePath, "utf8"), "do not move\n");
});

test("patch preparation applies an exact single-file update without writing", () => {
  const prepared = preparePatch(`*** Begin Patch
*** Update File: notes/today.md
@@
title
-old line
+new line
tail
*** End Patch
`, "title\nold line\ntail\n");

  assert.equal(prepared.operation, "update");
  assert.equal(prepared.path, "notes/today.md");
  assert.equal(prepared.beforeContent, "title\nold line\ntail\n");
  assert.equal(prepared.afterContent, "title\nnew line\ntail\n");
  assert.equal(prepared.addedLines, 1);
  assert.equal(prepared.removedLines, 1);
  assert.match(prepared.diff, /--- a\/notes\/today\.md/);
  assert.match(prepared.diff, /\+new line/);
  assert.match(prepared.diff, /-old line/);
});

test("patch preparation supports a new file and reports a reviewable diff", () => {
  const prepared = preparePatch(`*** Begin Patch
*** Add File: notes/new.md
+first line
+second line
*** End Patch
`);

  assert.equal(prepared.operation, "add");
  assert.equal(prepared.path, "notes/new.md");
  assert.equal(prepared.beforeContent, "");
  assert.equal(prepared.afterContent, "first line\nsecond line\n");
  assert.equal(prepared.addedLines, 2);
  assert.equal(prepared.removedLines, 0);
  assert.match(prepared.diff, /\+first line/);
  assert.match(prepared.diff, /\+second line/);
});

test("patch preparation preserves CRLF and UTF-8 content deliberately", () => {
  const prepared = preparePatch(`*** Begin Patch
*** Update File: notes/unicode.md
@@
-café 😀
+café ✅
*** End Patch
`, "café 😀\r\n");

  assert.equal(prepared.afterContent, "café ✅\r\n");
  assert.equal(prepared.beforeContent, "café 😀\r\n");
});

test("whole-file diffs make a final-newline-only change visible", () => {
  const prepared = prepareFileWrite("note.txt", "same\n", "same");
  assert.notEqual(prepared.beforeHash, prepared.afterHash);
  assert.match(prepared.diff, /newline at end/);
});

test("patch preparation rejects stale, ambiguous, malformed, and multi-file patches", () => {
  assert.throws(
    () => preparePatch(`*** Begin Patch
*** Update File: notes/today.md
@@
missing
+replacement
*** End Patch
`, "actual\n"),
    /expected file context was not found/,
  );
  assert.throws(
    () => preparePatch(`*** Begin Patch
*** Update File: notes/today.md
@@
-line
+replacement
*** End Patch
`, "line\nline\n"),
    /context is ambiguous/,
  );
  assert.throws(
    () => preparePatch("not a patch", "content"),
    /expected '\*\*\* Begin Patch'/,
  );
  assert.throws(
    () => preparePatch(`*** Begin Patch
*** Update File: notes/one.md
@@
-one
+two
*** Update File: notes/two.md
@@
-three
+four
*** End Patch
`, "one\n"),
    /exactly one file operation/,
  );
  for (const operation of ["Delete File", "Move to"]) {
    assert.throws(
      () => preparePatch(["*** Begin Patch", `*** ${operation}: notes/one.md`, "*** End Patch"].join("\n")),
      /only 'Update File' and 'Add File' operations are supported/,
    );
  }
});

test("patch preparation rejects adding over existing content", () => {
  assert.throws(
    () => preparePatch(`*** Begin Patch
*** Add File: notes/existing.md
+new content
*** End Patch
`, "already here\n"),
    /already has content/,
  );
});

test("patch and whole-file preparation reject binary-looking NUL content", () => {
  const nul = String.fromCharCode(0);
  assert.throws(() => prepareFileWrite("note.txt", "old\n", `new${nul}value`), /binary/);
  const addPatch = [
    "*** Begin Patch",
    "*** Add File: notes/binary.txt",
    `+value${nul}tail`,
    "*** End Patch",
  ].join("\n");
  assert.throws(() => preparePatch(addPatch), /binary/);
  const updatePatch = [
    "*** Begin Patch",
    "*** Update File: notes/binary.txt",
    "@@",
    "-old",
    `+new${nul}value`,
    "*** End Patch",
  ].join("\n");
  assert.throws(() => preparePatch(updatePatch, "old\n"), /binary/);
});

test("workspace prepares a patch without writing and commits it atomically", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "notes"), { recursive: true });
  const target = path.join(root, "notes", "today.md");
  await writeFile(target, "title\nold line\ntail\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: notes/today.md
@@
title
-old line
+new line
tail
*** End Patch
`);

  assert.equal(prepared.path, "notes/today.md");
  assert.equal(prepared.beforeContent, "title\nold line\ntail\n");
  assert.equal(await readFile(target, "utf8"), prepared.beforeContent);
  const committed = await workspace.commitPatch(prepared);
  assert.equal(committed.path, "notes/today.md");
  assert.equal(committed.afterHash, prepared.afterHash);
  assert.equal(await readFile(target, "utf8"), prepared.afterContent);
  await assert.rejects(() => workspace.commitPatch(prepared), /changed after the proposal was prepared/);
});

test("workspace rejects stale patch commits and mutation symlink targets", async () => {
  const root = path.join(tempDirectory(), "workspace");
  const outside = path.join(tempDirectory(), "outside.txt");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "notes.md"), "before\n", "utf8");
  await writeFile(outside, "outside\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: notes.md
@@
-before
+proposed
*** End Patch
`);
  await writeFile(path.join(root, "notes.md"), "user edit\n", "utf8");
  await assert.rejects(() => workspace.commitPatch(prepared), /changed after the proposal was prepared/);

  await symlink(outside, path.join(root, "link.txt"));
  await assert.rejects(() => workspace.preparePatch(`*** Begin Patch
*** Update File: link.txt
@@
-outside
+mutated
*** End Patch
`), /symbolic link/);
});

test("workspace commits an approved add patch only when its parent already exists", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "notes"), { recursive: true });
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Add File: notes/new.md
+created safely
*** End Patch
`);
  assert.equal((await workspace.commitPatch(prepared)).afterHash, prepared.afterHash);
  assert.equal(await readFile(path.join(root, "notes", "new.md"), "utf8"), "created safely\n");
  await assert.rejects(() => workspace.preparePatch(`*** Begin Patch
*** Add File: missing/new.md
+not created
*** End Patch
`), /parent.*does not exist/);
  await assert.rejects(() => workspace.preparePatch(`*** Begin Patch
*** Add File: ../escape.md
+not created
*** End Patch
`), /outside the workspace root/);
  await assert.rejects(() => workspace.preparePatch(`*** Begin Patch
*** Add File: ${path.resolve(root, "absolute.md")}
+not created
*** End Patch
`), /Absolute paths are not allowed/);
});

test("workspace prepares a complete multi-file patch set and rechecks every member before writing", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const prepared = await workspace.preparePatchSet([
    `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
    `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
  ], "mutation_patch_set_test");

  assert.equal(prepared.operation, "patch-set");
  assert.deepEqual(prepared.paths, ["one.txt", "two.txt"]);
  assert.equal(prepared.totalBytes, Buffer.byteLength("one new\n") + Buffer.byteLength("two new\n"));
  assert.equal(prepared.journal.state, "prepared");
  assert.deepEqual(prepared.journal.members.map((member) => ({ path: member.path, state: member.state })), [
    { path: "one.txt", state: "pending" },
    { path: "two.txt", state: "pending" },
  ]);
  assert.match(prepared.preview, /one\.txt/);
  assert.match(prepared.preview, /two\.txt/);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one old\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");

  const journalUpdates: string[] = [];
  const journalSnapshots: Array<{ readonly state: string; readonly temporaryPaths: readonly (string | undefined)[] }> = [];
  const committed = await workspace.commitPatchSet(prepared, async (journal) => {
    journalUpdates.push(journal.state);
    journalSnapshots.push({ state: journal.state, temporaryPaths: journal.members.map((member) => member.temporaryPath) });
  });
  assert.deepEqual(committed.paths, ["one.txt", "two.txt"]);
  assert.deepEqual(journalUpdates, ["staging", "committing", "committing", "committing", "committing", "committing", "committed"]);
  assert.deepEqual(committed.journal.members.map((member) => member.temporaryPath), [
    ".computer-native-transactions/mutation_patch_set_test/member-1.tmp",
    ".computer-native-transactions/mutation_patch_set_test/member-2.tmp",
  ]);
  assert.equal(journalSnapshots.some((snapshot) => snapshot.temporaryPaths.some((temporaryPath) => temporaryPath?.endsWith("member-1.tmp"))), true);
  await assert.rejects(() => lstat(path.join(root, ".computer-native-transactions", "mutation_patch_set_test")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two new\n");
  await assert.rejects(() => workspace.commitPatchSet(prepared), /changed after the proposal was prepared/);

  const exposedRoot = path.join(tempDirectory(), "exposed-workspace");
  await mkdir(exposedRoot, { recursive: true });
  await writeFile(path.join(exposedRoot, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(exposedRoot, "two.txt"), "two old\n", "utf8");
  const exposedTransactionRoot = path.join(exposedRoot, ".computer-native-transactions");
  await mkdir(exposedTransactionRoot, { recursive: true });
  await chmod(exposedTransactionRoot, 0o755);
  const exposedWorkspace = await Workspace.open(exposedRoot, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const exposedPatchSuffix = "*** End " + "Patch";
  const exposedPrepared = await exposedWorkspace.preparePatchSet([
    ["*** Begin Patch", "*** Update File: one.txt", "@@", "-one old", "+one new", exposedPatchSuffix].join("\n"),
    ["*** Begin Patch", "*** Update File: two.txt", "@@", "-two old", "+two new", exposedPatchSuffix].join("\n"),
  ], "mutation_patch_set_exposed");
  await assert.rejects(() => exposedWorkspace.commitPatchSet(exposedPrepared), /accessible to other users/);

  const staleRoot = path.join(tempDirectory(), "stale-workspace");
  await mkdir(staleRoot, { recursive: true });
  await writeFile(path.join(staleRoot, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(staleRoot, "two.txt"), "two old\n", "utf8");
  const staleWorkspace = await Workspace.open(staleRoot, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const stalePrepared = await staleWorkspace.preparePatchSet([
    `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
    `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
  ], "mutation_patch_set_stale");
  await writeFile(path.join(staleRoot, "two.txt"), "user edit\n", "utf8");
  await assert.rejects(() => staleWorkspace.commitPatchSet(stalePrepared), /changed after the proposal was prepared/);
  assert.equal(await readFile(path.join(staleRoot, "one.txt"), "utf8"), "one old\n");
  assert.equal(await readFile(path.join(staleRoot, "two.txt"), "utf8"), "user edit\n");
  await assert.rejects(() => workspace.preparePatchSet([
    `*** Begin Patch
*** Update File: one.txt
@@
-one new
+one duplicate
*** End Patch
`,
    `*** Begin Patch
*** Update File: one.txt
@@
-one new
+one duplicate again
*** End Patch
`,
  ], "mutation_patch_set_duplicate"), /duplicate target paths/);
});

test("workspace rejects a multi-file patch set above its aggregate resulting-byte limit", async () => {
  const root = path.join(tempDirectory(), "workspace-patch-budget");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "old\n", "utf8");
  const workspace = await Workspace.open(root, {
    maxFileBytes: 100,
    maxDirectoryEntries: 20,
    maxPatchSetBytes: Buffer.byteLength("new one\n"),
  });
  const end = "*** End " + "Patch";
  const patches = [
    ["*** Begin Patch", "*** Update File: one.txt", "@@", "-old", "+new one", end].join("\n"),
    ["*** Begin Patch", "*** Update File: two.txt", "@@", "-old", "+new two", end].join("\n"),
  ];
  await assert.rejects(
    () => workspace.preparePatchSet(patches, "mutation_patch_set_budget"),
    /above the 8-byte aggregate limit/u,
  );
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "old\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "old\n");
  await assert.rejects(() => lstat(path.join(root, ".computer-native-transactions")), { code: "ENOENT" });
});

test("multi-file patch interruption records partial progress and requires reconciliation", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  let writes = 0;
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async (absolutePath, content, _existingMode, temporaryPath) => {
      writes += 1;
      if (writes === 2) throw new Error("simulated second-member failure");
      assert.ok(temporaryPath);
      await writeFile(temporaryPath, content, "utf8");
      await rename(temporaryPath, absolutePath);
    },
  });
  const prepared = await workspace.preparePatchSet([
    `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
    `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
  ], "mutation_patch_set_partial");
  let latestJournal = prepared.journal;
  let commitError: unknown;
  await assert.rejects(
    () => workspace.commitPatchSet(prepared, (journal) => { latestJournal = journal; }).catch((error) => {
      commitError = error;
      throw error;
    }),
    /requires reconciliation/,
  );
  assert.ok(commitError instanceof MutationError);
  assert.equal((commitError as MutationError).mutationCode, "reconciliation-required");
  assert.match((commitError as MutationError).safeMessage, /Do not retry automatically/u);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");
  assert.equal(latestJournal.state, "reconciliation_required");
  assert.deepEqual(latestJournal.members.map((member) => ({ path: member.path, state: member.state, temporaryPath: member.temporaryPath })), [
    { path: "one.txt", state: "committed", temporaryPath: ".computer-native-transactions/mutation_patch_set_partial/member-1.tmp" },
    { path: "two.txt", state: "staged", temporaryPath: ".computer-native-transactions/mutation_patch_set_partial/member-2.tmp" },
  ]);
  assert.equal((await lstat(path.join(root, ".computer-native-transactions", "mutation_patch_set_partial"))).isDirectory(), true);

  const record = await workspace.reconcileMutation({
    schemaVersion: 1,
    mutationId: "mutation_patch_set_partial",
    operation: "patch-set",
    risk: "multi-file-patch",
    paths: prepared.paths,
    members: prepared.members,
    journal: latestJournal,
    path: prepared.path,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  assert.equal(record.status, "reconciliation_required");
  assert.equal(record.errorCode, "reconciliation-required");
  assert.deepEqual(record.journal?.members.map((member) => ({ path: member.path, state: member.state })), [
    { path: "one.txt", state: "committed" },
    { path: "two.txt", state: "pending" },
  ]);
  assert.equal((await lstat(path.join(root, ".computer-native-transactions", "mutation_patch_set_partial"))).isDirectory(), true);
  await writeFile(path.join(root, "two.txt"), "external edit\n", "utf8");
  const conflict = await workspace.reconcileMutation({ ...record, status: "applying", journal: latestJournal });
  assert.equal(conflict.status, "reconciliation_required");
  assert.match(conflict.reason ?? "", /partial or conflicting/);
});

test("multi-file patch cancellation stops before the next member and preserves recovery evidence", async () => {
  const root = path.join(tempDirectory(), "workspace-cancel");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  const controller = new AbortController();
  let writes = 0;
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async (absolutePath, content, _existingMode, temporaryPath) => {
      writes += 1;
      assert.ok(temporaryPath);
      await writeFile(temporaryPath, content, "utf8");
      await rename(temporaryPath, absolutePath);
      if (writes === 1) controller.abort("test-cancel");
    },
  });
  const prepared = await workspace.preparePatchSet([
    `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
    `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
  ], "mutation_patch_set_cancelled");
  let latestJournal = prepared.journal;
  await assert.rejects(
    () => workspace.commitPatchSet(prepared, (journal) => { latestJournal = journal; }, controller.signal),
    /requires reconciliation/u,
  );
  assert.equal(writes, 1);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");
  assert.equal(latestJournal.state, "reconciliation_required");
  assert.equal(latestJournal.members[0]?.state, "committed");
  assert.equal(latestJournal.members[1]?.state, "pending");
});

test("multi-file recovery distinguishes no commit from all members committed before journal acknowledgement", async () => {
  const beforeRoot = path.join(tempDirectory(), "before-workspace");
  await mkdir(beforeRoot, { recursive: true });
  await writeFile(path.join(beforeRoot, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(beforeRoot, "two.txt"), "two old\n", "utf8");
  const beforeWorkspace = await Workspace.open(beforeRoot, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async () => { throw new Error("simulated first-member interruption"); },
  });
  const beforePrepared = await beforeWorkspace.preparePatchSet([
    ["*** Begin Patch", "*** Update File: one.txt", "@@", "-one old", "+one new", "*** End " + "Patch"].join("\n"),
    ["*** Begin Patch", "*** Update File: two.txt", "@@", "-two old", "+two new", "*** End " + "Patch"].join("\n"),
  ], "mutation_patch_set_before_first");
  let beforeJournal = beforePrepared.journal;
  await assert.rejects(
    () => beforeWorkspace.commitPatchSet(beforePrepared, (journal) => { beforeJournal = journal; }),
    (error: unknown) => error instanceof MutationError && error.mutationCode === "reconciliation-required",
  );
  assert.deepEqual(beforeJournal.members.map((member) => member.state), ["staged", "pending"]);
  const beforeRecord = await beforeWorkspace.reconcileMutation({
    schemaVersion: 1,
    mutationId: "mutation_patch_set_before_first",
    operation: "patch-set",
    risk: "multi-file-patch",
    paths: beforePrepared.paths,
    members: beforePrepared.members,
    journal: beforeJournal,
    path: beforePrepared.path,
    addedLines: beforePrepared.addedLines,
    removedLines: beforePrepared.removedLines,
    diff: beforePrepared.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  assert.equal(beforeRecord.status, "reconciled");
  assert.equal(await readFile(path.join(beforeRoot, "one.txt"), "utf8"), "one old\n");
  await assert.rejects(() => lstat(path.join(beforeRoot, ".computer-native-transactions", "mutation_patch_set_before_first")), { code: "ENOENT" });

  const afterRoot = path.join(tempDirectory(), "after-workspace");
  await mkdir(afterRoot, { recursive: true });
  await writeFile(path.join(afterRoot, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(afterRoot, "two.txt"), "two old\n", "utf8");
  const afterWorkspace = await Workspace.open(afterRoot, { maxFileBytes: 100, maxDirectoryEntries: 20 });
  const afterPrepared = await afterWorkspace.preparePatchSet([
    ["*** Begin Patch", "*** Update File: one.txt", "@@", "-one old", "+one new", "*** End " + "Patch"].join("\n"),
    ["*** Begin Patch", "*** Update File: two.txt", "@@", "-two old", "+two new", "*** End " + "Patch"].join("\n"),
  ], "mutation_patch_set_after_all");
  let afterJournal = afterPrepared.journal;
  await assert.rejects(
    () => afterWorkspace.commitPatchSet(afterPrepared, (journal) => {
      afterJournal = journal;
      if (journal.state === "committed") throw new Error("simulated final journal acknowledgement failure");
    }),
    (error: unknown) => error instanceof MutationError
      && error.mutationCode === "reconciliation-required"
      && error.cause instanceof Error
      && error.cause.message === "simulated final journal acknowledgement failure",
  );
  assert.equal(afterJournal.state, "reconciliation_required");
  assert.deepEqual(afterJournal.members.map((member) => member.state), ["committed", "committed"]);
  assert.equal(await readFile(path.join(afterRoot, "one.txt"), "utf8"), "one new\n");
  const afterRecord = await afterWorkspace.reconcileMutation({
    schemaVersion: 1,
    mutationId: "mutation_patch_set_after_all",
    operation: "patch-set",
    risk: "multi-file-patch",
    paths: afterPrepared.paths,
    members: afterPrepared.members,
    journal: afterJournal,
    path: afterPrepared.path,
    addedLines: afterPrepared.addedLines,
    removedLines: afterPrepared.removedLines,
    diff: afterPrepared.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  assert.equal(afterRecord.status, "committed");
  assert.equal(afterRecord.journal?.state, "committed");
  await assert.rejects(() => lstat(path.join(afterRoot, ".computer-native-transactions", "mutation_patch_set_after_all")), { code: "ENOENT" });
});

test("workspace reports an injected atomic commit failure without false success", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  let attempts = 0;
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async () => {
      attempts += 1;
      throw new Error("simulated rename failure");
    },
  });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
`);

  await assert.rejects(() => workspace.commitPatch(prepared), /could not be committed atomically/);
  assert.equal(attempts, 1);
  assert.equal(await readFile(target, "utf8"), "old\n");
});

test("multi-file commit rejects an unsupported rename without copy-and-delete fallback", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  let attempts = 0;
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async () => {
      attempts += 1;
      const error = new Error("cross-device rename is unsupported");
      Object.assign(error, { code: "EXDEV" });
      throw error;
    },
  });
  const prepared = await workspace.preparePatchSet([
    ["*** Begin Patch", "*** Update File: one.txt", "@@", "-one old", "+one new", "*** End " + "Patch"].join("\n"),
    ["*** Begin Patch", "*** Update File: two.txt", "@@", "-two old", "+two new", "*** End " + "Patch"].join("\n"),
  ], "mutation_patch_set_exdev");
  await assert.rejects(
    () => workspace.commitPatchSet(prepared),
    (error: unknown) => error instanceof MutationError && error.mutationCode === "reconciliation-required",
  );
  assert.equal(attempts, 1);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one old\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");
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

test("bounded tool loop leaves a reporting round after a multi-step interaction", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const session = await openSession(stateDir);
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const tools = new ToolRegistry(workspace, 1_000);
  let toolRound = 0;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/multi-step",
    async *stream(_request: ModelRequest, _signal: AbortSignal) {
      if (toolRound < 4) {
        toolRound += 1;
        yield {
          type: "tool_call" as const,
          call: { callId: `multi_step_${toolRound}`, name: "list_directory", argumentsJson: "{}" },
        };
        yield { type: "completed" as const };
        return;
      }
      yield { type: "text" as const, text: "The multi-step interaction is complete." };
      yield { type: "completed" as const };
    },
  };
  const result = await runTurn({
    session,
    tools,
    provider,
    config: config(stateDir, { workspaceRoot: root }),
    userPrompt: "Complete the multi-step interaction and report the result.",
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assistantText, "The multi-step interaction is complete.");
  assert.deepEqual({
    modelRequestCount: result.metrics?.modelRequestCount,
    toolCallCount: result.metrics?.toolCallCount,
    roundCount: result.metrics?.roundCount,
  }, { modelRequestCount: 5, toolCallCount: 4, roundCount: 5 });
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
  const oversizedPatch = await registry.execute({ callId: "oversized", name: "apply_patch", argumentsJson: JSON.stringify({ patch: "x".repeat(MAX_PATCH_REQUEST_BYTES + 1) }) });
  assert.equal(oversizedPatch.ok, false);
  assert.match(oversizedPatch.content, /patch request is larger/);
  const applyPatchDefinition = registry.definitions.find((definition) => definition.name === "apply_patch");
  assert.ok(applyPatchDefinition);
  assert.match(applyPatchDefinition.description, /one file operation/);
  assert.match(applyPatchDefinition.description, /\*\*\* Update File/);
  assert.match(applyPatchDefinition.description, /Delete.*multi-file/);
});

test("mutation tool results expose typed failure categories", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "old\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);

  const invalidPatch = await registry.execute({
    callId: "invalid_patch_call",
    name: "apply_patch",
    argumentsJson: JSON.stringify({ patch: "not a patch" }),
  });
  assert.equal(invalidPatch.ok, false);
  assert.equal(invalidPatch.errorCode, "mutation-invalid");

  const denied = await registry.execute({
    callId: "denied_write_call",
    name: "write_file",
    argumentsJson: JSON.stringify({ path: "note.txt", content: "denied\n" }),
  }, { approveMutation: async () => ({ decision: "deny", reason: "review later" }) });
  assert.equal(denied.ok, false);
  assert.equal(denied.errorCode, "approval-denied");

  const unavailable = await registry.execute({
    callId: "unavailable_write_call",
    name: "write_file",
    argumentsJson: JSON.stringify({ path: "note.txt", content: "unavailable\n" }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.errorCode, "approval-unavailable");

  const stale = await registry.execute({
    callId: "stale_write_call",
    name: "write_file",
    argumentsJson: JSON.stringify({ path: "note.txt", content: "new\n" }),
  }, {
    approveMutation: async () => {
      await writeFile(target, "changed by user\n", "utf8");
      return { decision: "allow-once" };
    },
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, "mutation-stale");
  assert.equal(await readFile(target, "utf8"), "changed by user\n");

  const failedWorkspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }, {
    atomicWriter: async () => { throw new Error("simulated commit failure"); },
  });
  const failed = await new ToolRegistry(failedWorkspace, 1_000).execute({
    callId: "failed_write_call",
    name: "write_file",
    argumentsJson: JSON.stringify({ path: "note.txt", content: "failure\n" }),
  }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "mutation-failed");
  assert.equal(await readFile(target, "utf8"), "changed by user\n");
});

test("stat tool returns bounded metadata without exposing file contents", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "note.txt"), "private text", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const result = await registry.execute({ callId: "stat_call", name: "stat", argumentsJson: JSON.stringify({ path: "note.txt" }) });

  assert.equal(result.ok, true);
  const metadata = JSON.parse(result.content) as { kind: string; path: string; sizeBytes: number; modifiedAt: string; mode: number; linkCount: number };
  assert.equal(metadata.kind, "file");
  assert.equal(metadata.path, "note.txt");
  assert.equal(metadata.sizeBytes, 12);
  assert.match(metadata.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof metadata.mode, "number");
  assert.ok(metadata.linkCount >= 1);
  assert.doesNotMatch(result.content, /private text/);
});

test("quarantine inventory is read-only, bounded, and content-free", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "note.txt"), "private text", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const deletion = await workspace.prepareDelete("note.txt", "mutation_inventory_test");
  await workspace.commitDelete(deletion);
  const registry = new ToolRegistry(workspace, 1_000);

  const result = await registry.execute({ callId: "quarantine_call", name: "list_quarantine", argumentsJson: JSON.stringify({ maxEntries: 10 }) });
  assert.equal(result.ok, true);
  const payload = JSON.parse(result.content) as { entries: Array<Record<string, unknown>>; truncated: boolean };
  assert.equal(payload.truncated, false);
  assert.equal(payload.entries[0]?.mutationId, "mutation_inventory_test");
  assert.equal(payload.entries[0]?.originalPath, "note.txt");
  assert.equal(payload.entries[0]?.payloadAvailable, true);
  assert.equal("content" in (payload.entries[0] ?? {}), false);

  const invalidLimit = await registry.execute({ callId: "quarantine_invalid", name: "list_quarantine", argumentsJson: JSON.stringify({ maxEntries: 101 }) });
  assert.equal(invalidLimit.ok, false);
  assert.match(invalidLimit.content, /quarantine entry limit/);
});

test("search_files tool returns bounded matches and rejects invalid limits", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "note.txt"), "needle here\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const result = await registry.execute({
    callId: "search_call",
    name: "search_files",
    argumentsJson: JSON.stringify({ path: ".", query: "needle", maxResults: 10 }),
  });
  assert.equal(result.ok, true);
  assert.match(result.content, /note\.txt/);
  assert.match(result.content, /needle here/);

  const invalid = await registry.execute({
    callId: "search_invalid",
    name: "search_files",
    argumentsJson: JSON.stringify({ query: "needle", maxResults: 0 }),
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.content, /maxResults/);

  const byName = await registry.execute({
    callId: "search_name_call",
    name: "search_files",
    argumentsJson: JSON.stringify({ path: ".", namePattern: "*.txt" }),
  });
  assert.equal(byName.ok, true);
  assert.match(byName.content, /nameMatches/);
});

test("write_file is approval-gated and uses the prepared whole-file change", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "old\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const call = {
    callId: "write_call",
    name: "write_file",
    argumentsJson: JSON.stringify({ path: "note.txt", content: "new\n" }),
  };

  const denied = await registry.execute(call, { approveMutation: async () => ({ decision: "deny", reason: "review later" }) });
  assert.equal(denied.ok, false);
  assert.equal(await readFile(target, "utf8"), "old\n");

  const malformed = await registry.execute(call, {
    approveMutation: async () => ({ decision: "maybe" } as never),
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errorCode, "approval-unavailable");
  assert.equal(await readFile(target, "utf8"), "old\n");

  const applied = await registry.execute(call, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(applied.ok, true);
  assert.match(applied.summary, /Applied write/);
  assert.equal(await readFile(target, "utf8"), "new\n");
});

test("mkdir is approval-gated and reports an existing directory as an idempotent result", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const call = { callId: "mkdir_call", name: "mkdir", argumentsJson: JSON.stringify({ path: "new-dir" }) };

  const denied = await registry.execute(call, { approveMutation: async () => ({ decision: "deny", reason: "review later" }) });
  assert.equal(denied.ok, false);
  await assert.rejects(() => readFile(path.join(root, "new-dir")));

  const applied = await registry.execute(call, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(applied.ok, true);
  assert.match(applied.summary, /Created directory/);
  assert.equal((await (await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 })).stat("new-dir")).kind, "directory");

  let approvalCalls = 0;
  const repeated = await registry.execute(call, { approveMutation: async () => { approvalCalls += 1; return { decision: "deny" }; } });
  assert.equal(repeated.ok, true);
  assert.match(repeated.summary, /already exists/);
  assert.equal(approvalCalls, 0);
});

test("delete_directory is approval-gated and refuses non-empty directories", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "empty"), { recursive: true });
  await mkdir(path.join(root, "non-empty"), { recursive: true });
  await writeFile(path.join(root, "non-empty", "keep.txt"), "keep\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const call = { callId: "delete_directory_call", name: "delete_directory", argumentsJson: JSON.stringify({ path: "empty" }) };
  let proposal: { operation?: string; risk?: string; diff?: string } | undefined;
  const denied = await registry.execute(call, {
    onMutation: async (event) => {
      if (event.type === "proposed") proposal = event.request;
    },
    approveMutation: async () => ({ decision: "deny", reason: "review later" }),
  });
  assert.equal(denied.ok, false);
  assert.equal(proposal?.operation, "delete-directory");
  assert.equal(proposal?.risk, "delete-directory");
  assert.match(proposal?.diff ?? "", /Recursive deletion is not performed/);
  assert.equal((await (await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 })).stat("empty")).kind, "directory");

  const applied = await registry.execute(call, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(applied.ok, true);
  assert.match(applied.summary, /Deleted empty directory/);
  assert.equal(JSON.parse(applied.content).status, "deleted");
  await assert.rejects(() => lstat(path.join(root, "empty")), { code: "ENOENT" });

  const nonEmpty = await registry.execute({
    callId: "delete_non_empty_call",
    name: "delete_directory",
    argumentsJson: JSON.stringify({ path: "non-empty" }),
  }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(nonEmpty.ok, false);
  assert.match(nonEmpty.content, /not empty|recursive/);
  assert.equal((await lstat(path.join(root, "non-empty", "keep.txt"))).isFile(), true);
});

test("directory-tree deletion, restore, and exact-token purge are approval-gated", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const ready = true;\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10, maxTreeEntries: 20, maxTreeBytes: 1_000, maxTreeDepth: 5 });
  const registry = new ToolRegistry(workspace, 2_000);
  const call = { callId: "delete_tree_call", name: "delete_directory_tree", argumentsJson: JSON.stringify({ path: "project" }) };
  let proposal: { operation?: string; risk?: string; manifestHash?: string; entryCount?: number; totalBytes?: number; maxBytes?: number } | undefined;
  const denied = await registry.execute(call, {
    onMutation: async (event) => { if (event.type === "proposed") proposal = event.request; },
    approveMutation: async () => ({ decision: "deny", reason: "review later" }),
  });
  assert.equal(denied.ok, false);
  assert.equal(proposal?.operation, "delete-directory-tree");
  assert.equal(proposal?.risk, "delete-directory-tree");
  assert.equal(typeof proposal?.manifestHash, "string");
  assert.equal(proposal?.entryCount, 3);
  assert.equal(proposal?.totalBytes, Buffer.byteLength("export const ready = true;\n"));
  assert.equal(proposal?.maxBytes, 1_000);
  assert.equal((await workspace.stat("project")).kind, "directory");

  const deleted = await registry.execute(call, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(deleted.ok, true);
  const deletion = JSON.parse(deleted.content) as { status: string; restoreToken: string; entryCount: number };
  assert.equal(deletion.status, "quarantined");
  assert.equal(deletion.entryCount, 3);
  await assert.rejects(() => workspace.stat("project"));

  let restoreProposal: { operation?: string; manifestHash?: string; entryCount?: number; totalBytes?: number; maxBytes?: number } | undefined;
  const restored = await registry.execute({ callId: "restore_tree_call", name: "restore_directory", argumentsJson: JSON.stringify({ mutationId: deletion.restoreToken }) }, {
    onMutation: async (event) => { if (event.type === "proposed") restoreProposal = event.request; },
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(restored.ok, true);
  assert.equal(restoreProposal?.operation, "restore-directory");
  assert.equal(typeof restoreProposal?.manifestHash, "string");
  assert.equal(restoreProposal?.entryCount, 3);
  assert.equal(restoreProposal?.totalBytes, Buffer.byteLength("export const ready = true;\n"));
  assert.equal(restoreProposal?.maxBytes, 1_000);
  assert.equal((await workspace.stat("project")).kind, "directory");

  const second = await registry.execute(call, { approveMutation: async () => ({ decision: "allow-once" }) });
  const secondToken = (JSON.parse(second.content) as { restoreToken: string }).restoreToken;
  const purgeDenied = await registry.execute({ callId: "purge_denied", name: "purge_quarantine", argumentsJson: JSON.stringify({ mutationId: secondToken }) }, { approveMutation: async () => ({ decision: "deny" }) });
  assert.equal(purgeDenied.ok, false);
  const purge = await registry.execute({ callId: "purge_call", name: "purge_quarantine", argumentsJson: JSON.stringify({ mutationId: secondToken }) }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(purge.ok, true);
  assert.equal(JSON.parse(purge.content).status, "purged");
  assert.deepEqual((await workspace.listQuarantine(10)).entries, []);
});

test("delete and restore are approval-gated and expose a recoverable token", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "protected\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const deleteCall = { callId: "delete_call", name: "delete", argumentsJson: JSON.stringify({ path: "note.txt" }) };

  const denied = await registry.execute(deleteCall, { approveMutation: async () => ({ decision: "deny", reason: "review later" }) });
  assert.equal(denied.ok, false);
  assert.equal(await readFile(target, "utf8"), "protected\n");

  const deleted = await registry.execute(deleteCall, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(deleted.ok, true);
  assert.match(deleted.summary, /Quarantined/);
  const deletionResult = JSON.parse(deleted.content) as { status: string; restoreToken: string };
  assert.equal(deletionResult.status, "quarantined");
  assert.match(deletionResult.restoreToken, /^mutation_/);
  await assert.rejects(() => readFile(target));

  const restored = await registry.execute({
    callId: "restore_call",
    name: "restore",
    argumentsJson: JSON.stringify({ mutationId: deletionResult.restoreToken }),
  }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(restored.ok, true);
  assert.match(restored.summary, /Restored/);
  assert.equal(await readFile(target, "utf8"), "protected\n");
});

test("copy and move are approval-gated and preserve destination collision safety", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "source.txt"), "transfer me\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const copyCall = {
    callId: "copy_call",
    name: "copy",
    argumentsJson: JSON.stringify({ source: "source.txt", destination: "copy.txt" }),
  };
  const denied = await registry.execute(copyCall, { approveMutation: async () => ({ decision: "deny", reason: "review later" }) });
  assert.equal(denied.ok, false);
  assert.equal(await readFile(path.join(root, "source.txt"), "utf8"), "transfer me\n");
  await assert.rejects(() => readFile(path.join(root, "copy.txt")));

  const copied = await registry.execute(copyCall, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(copied.ok, true);
  assert.match(copied.summary, /Copied/);
  assert.equal(await readFile(path.join(root, "copy.txt"), "utf8"), "transfer me\n");

  const moved = await registry.execute({
    callId: "move_call",
    name: "move",
    argumentsJson: JSON.stringify({ source: "copy.txt", destination: "moved.txt" }),
  }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(moved.ok, true);
  assert.match(moved.summary, /Moved/);
  await assert.rejects(() => readFile(path.join(root, "copy.txt")));
  assert.equal(await readFile(path.join(root, "moved.txt"), "utf8"), "transfer me\n");

  const collision = await registry.execute({
    callId: "collision_call",
    name: "copy",
    argumentsJson: JSON.stringify({ source: "source.txt", destination: "moved.txt" }),
  }, { approveMutation: async () => ({ decision: "allow-once" }) });
  assert.equal(collision.ok, false);
  assert.match(collision.content, /destination.*already exists/);
});

test("directory copy, move, and rename tools expose bounded approval evidence", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await mkdir(path.join(root, "archive"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const answer = 42;\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, {
    maxFileBytes: 100,
    maxDirectoryEntries: 20,
    maxTreeEntries: 20,
    maxTreeBytes: 1_000,
    maxTreeDepth: 4,
  }), 2_000);
  const requests: Array<{ operation: string; risk: string; manifestHash?: string; entryCount?: number; totalBytes?: number; maxBytes?: number; approvalTimeoutMs?: number }> = [];
  const approve = async (request: { operation: string; risk: string; manifestHash?: string; entryCount?: number; totalBytes?: number; maxBytes?: number; approvalTimeoutMs?: number }) => {
    requests.push(request);
    return { decision: "allow-once" as const };
  };

  const copied = await registry.execute({
    callId: "copy_directory_call",
    name: "copy",
    argumentsJson: JSON.stringify({ source: "project", destination: "project-copy" }),
  }, { approveMutation: approve });
  assert.equal(copied.ok, true);
  assert.match(copied.summary, /Copied directory/);
  assert.equal(requests[0]?.risk, "copy-directory");
  assert.equal(requests[0]?.entryCount, 3);
  assert.equal(requests[0]?.totalBytes, Buffer.byteLength("export const answer = 42;\n"));
  assert.equal(requests[0]?.maxBytes, 1_000);
  assert.equal(typeof requests[0]?.manifestHash, "string");
  assert.equal(requests[0]?.approvalTimeoutMs, 120_000);

  const moved = await registry.execute({
    callId: "move_directory_call",
    name: "move",
    argumentsJson: JSON.stringify({ source: "project-copy", destination: "archive/project" }),
  }, { approveMutation: approve });
  assert.equal(moved.ok, true);
  assert.match(moved.summary, /Moved directory/);
  assert.equal(requests[1]?.maxBytes, 1_000);

  const renamed = await registry.execute({
    callId: "rename_directory_call",
    name: "rename",
    argumentsJson: JSON.stringify({ source: "archive/project", destination: "archive/renamed-project" }),
  }, { approveMutation: approve });
  assert.equal(renamed.ok, true);
  assert.match(renamed.summary, /Renamed directory/);
  assert.equal(requests[2]?.risk, "rename-directory");
  assert.equal(requests[2]?.maxBytes, 1_000);
  assert.equal(await readFile(path.join(root, "archive", "renamed-project", "src", "main.ts"), "utf8"), "export const answer = 42;\n");
});

test("apply_patch is approval-gated and emits proposal and commit evidence", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const events: string[] = [];
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 1_000);
  const call = {
    callId: "patch_call",
    name: "apply_patch",
    argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
` }),
  };
  const denied = await registry.execute(call, {
    approveMutation: async () => ({ decision: "deny", reason: "review later" }),
    onMutation: (event) => { events.push(event.type); },
  });
  assert.equal(denied.ok, false);
  assert.deepEqual(events, ["proposed", "approval_decided"]);
  assert.equal(await readFile(target, "utf8"), "old\n");

  const applied = await registry.execute(call, {
    approveMutation: async () => ({ decision: "allow-once" }),
    onMutation: (event) => { events.push(event.type); },
  });
  assert.equal(applied.ok, true);
  assert.deepEqual(events, ["proposed", "approval_decided", "proposed", "approval_decided", "applying", "committed"]);
  assert.equal(await readFile(target, "utf8"), "new\n");
});

test("apply_patch_set is approval-gated with complete path and journal context", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  const registry = new ToolRegistry(await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }), 4_000);
  const call = {
    callId: "patch_set_call",
    name: "apply_patch_set",
    argumentsJson: JSON.stringify({ patches: [
      `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
      `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
    ] }),
  };
  let requestRisk: string | undefined;
  let requestedPaths: readonly string[] | undefined;
  const denied = await registry.execute(call, {
    approveMutation: async (request) => {
      requestRisk = request.risk;
      requestedPaths = request.paths;
      return { decision: "deny", reason: "review set" };
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.errorCode, "approval-denied");
  assert.equal(requestRisk, "multi-file-patch");
  assert.deepEqual(requestedPaths, ["one.txt", "two.txt"]);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one old\n");

  const events: string[] = [];
  const applied = await registry.execute(call, {
    approveMutation: async (request) => {
      assert.equal(request.risk, "multi-file-patch");
      assert.equal(request.members?.length, 2);
      assert.equal(request.journal?.state, "prepared");
      assert.equal(request.totalBytes, Buffer.byteLength("one new\n") + Buffer.byteLength("two new\n"));
      return { decision: "allow-once" };
    },
    onMutation: (event) => { events.push(event.type); },
  });
  assert.equal(applied.ok, true);
  assert.match(applied.summary, /2 files/);
  assert.deepEqual(events, ["proposed", "approval_decided", "applying", "progress", "progress", "progress", "progress", "progress", "progress", "progress", "committed"]);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two new\n");
});

test("model apply_patch flow persists the exact mutation record and keeps denial safe", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const session = await openSession(stateDir);
  const provider = new DeterministicModelProvider("deterministic/patch", {
    toolCall: {
      name: "apply_patch",
      argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
` }),
      finalResponse: "I proposed the change.",
    },
  });
  const result = await runTurn({
    session,
    provider,
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Update the note.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "new\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  assert.equal(mutationFiles.length, 1);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as { mutationId: string; status: string; path: string; diff: string; beforeHash: string; afterHash: string };
  assert.equal(mutation.status, "committed");
  assert.equal(mutation.path, "note.md");
  assert.match(mutation.diff, /\+new/);
  assert.notEqual(mutation.beforeHash, mutation.afterHash);
  const roundsPath = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "rounds.jsonl");
  const rounds = (await readFile(roundsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { phase: string; payload: Record<string, unknown> });
  const completedRound = rounds.find((round) => round.phase === "tool_completed");
  assert.equal(typeof completedRound?.payload.mutationId, "string");
  const lifecycleEvents = (await readFile(path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  assert.deepEqual(lifecycleEvents.filter((event) => event.type.startsWith("WorkspaceMutation")).map((event) => event.type), [
    "WorkspaceMutationProposed",
    "WorkspaceMutationApprovalDecided",
    "WorkspaceMutationApplying",
    "WorkspaceMutationCommitted",
  ]);
  assert.ok(lifecycleEvents.filter((event) => event.type.startsWith("WorkspaceMutation")).every((event) => event.payload.mutationId === mutation.mutationId));
});

test("model apply_patch_set flow persists the member journal and bounded path set", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/patch-set", {
      toolCall: {
        name: "apply_patch_set",
        argumentsJson: JSON.stringify({ patches: [
          `*** Begin Patch
*** Update File: one.txt
@@
-one old
+one new
*** End Patch
`,
          `*** Begin Patch
*** Update File: two.txt
@@
-two old
+two new
*** End Patch
`,
        ] }),
        finalResponse: "The approved patch set was applied.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 4_000, maxPatchSetBytes: 64 }),
    userPrompt: "Update both notes.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two new\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    mutationId: string;
    operation: string;
    risk: string;
    status: string;
    paths: string[];
    totalBytes: number;
    maxBytes: number;
    members: Array<{ path: string }>;
    journal: { state: string; transactionPath: string; members: Array<{ path: string; state: string; temporaryPath?: string }> };
  };
  assert.equal(mutation.operation, "patch-set");
  assert.equal(mutation.risk, "multi-file-patch");
  assert.equal(mutation.status, "committed");
  assert.deepEqual(mutation.paths, ["one.txt", "two.txt"]);
  assert.equal(mutation.totalBytes, Buffer.byteLength("one new\n") + Buffer.byteLength("two new\n"));
  assert.equal(mutation.maxBytes, 64);
  assert.deepEqual(mutation.members.map((member) => member.path), ["one.txt", "two.txt"]);
  assert.equal(mutation.journal.state, "committed");
  assert.equal(mutation.journal.transactionPath, `.computer-native-transactions/${mutation.mutationId}`);
  assert.ok(mutation.journal.members.every((member) => member.state === "committed"));
  assert.ok(mutation.journal.members.every((member) => member.temporaryPath?.startsWith(`${mutation.journal.transactionPath}/member-`)));
});

test("model apply_patch_set failure persists reconciliation-required evidence", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "one.txt"), "one old\n", "utf8");
  await writeFile(path.join(root, "two.txt"), "two old\n", "utf8");
  let writes = 0;
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20 }, {
    atomicWriter: async (absolutePath, content, _existingMode, temporaryPath) => {
      writes += 1;
      if (writes === 2) throw new Error("simulated second-member failure");
      assert.ok(temporaryPath);
      await writeFile(temporaryPath, content, "utf8");
      await rename(temporaryPath, absolutePath);
    },
  });
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    tools: new ToolRegistry(workspace, 4_000),
    provider: new DeterministicModelProvider("deterministic/patch-set-failure", {
      toolCall: {
        name: "apply_patch_set",
        argumentsJson: JSON.stringify({ patches: [
          ["*** Begin Patch", "*** Update File: one.txt", "@@", "-one old", "+one new", "*** End " + "Patch"].join("\n"),
          ["*** Begin Patch", "*** Update File: two.txt", "@@", "-two old", "+two new", "*** End " + "Patch"].join("\n"),
        ] }),
        finalResponse: "The patch set needs manual reconciliation before it can be retried.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 4_000 }),
    userPrompt: "Update both notes.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(writes, 2);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one new\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two old\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  assert.equal(mutationFiles.length, 1);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    operation: string;
    status: string;
    errorCode?: string;
    reason?: string;
    journal?: { state: string; members: Array<{ path: string; state: string }> };
  };
  assert.equal(mutation.operation, "patch-set");
  assert.equal(mutation.status, "reconciliation_required");
  assert.equal(mutation.errorCode, "reconciliation-required");
  assert.match(mutation.reason ?? "", /Do not retry automatically/u);
  assert.equal(mutation.journal?.state, "reconciliation_required");
  assert.deepEqual(mutation.journal?.members.map((member) => ({ path: member.path, state: member.state })), [
    { path: "one.txt", state: "committed" },
    { path: "two.txt", state: "staged" },
  ]);
});

test("model write_file flow persists a write operation and commits only after approval", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "old\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/write", {
      toolCall: {
        name: "write_file",
        argumentsJson: JSON.stringify({ path: "note.txt", content: "whole file\n" }),
        finalResponse: "The complete file replacement was approved and applied.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Replace the note with the requested content.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "whole file\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as { operation: string; status: string; path: string };
  assert.equal(mutation.operation, "write");
  assert.equal(mutation.status, "committed");
  assert.equal(mutation.path, "note.txt");
});

test("model mkdir flow persists an approved directory mutation and its durable outcome", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/mkdir", {
      toolCall: {
        name: "mkdir",
        argumentsJson: JSON.stringify({ path: "notes" }),
        finalResponse: "The notes directory was created after approval.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Create a notes directory.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  const metadata = await (await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 })).stat("notes");
  assert.equal(metadata.kind, "directory");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    operation: string;
    status: string;
    path: string;
    diff: string;
    beforeHash?: string;
    afterHash?: string;
  };
  assert.equal(mutation.operation, "mkdir");
  assert.equal(mutation.status, "committed");
  assert.equal(mutation.path, "notes");
  assert.match(mutation.diff, /Create directory/);
  assert.equal(mutation.beforeHash, undefined);
  assert.equal(mutation.afterHash, undefined);
});

test("model delete_directory flow persists an approved non-recursive directory deletion", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(path.join(root, "notes"), { recursive: true });
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/delete-directory", {
      toolCall: {
        name: "delete_directory",
        argumentsJson: JSON.stringify({ path: "notes" }),
        finalResponse: "The empty notes directory was deleted after approval.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Delete the empty notes directory.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  await assert.rejects(() => lstat(path.join(root, "notes")), { code: "ENOENT" });
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    operation: string;
    risk?: string;
    status: string;
    path: string;
    diff: string;
    beforeHash?: string;
    afterHash?: string;
  };
  assert.equal(mutation.operation, "delete-directory");
  assert.equal(mutation.risk, "delete-directory");
  assert.equal(mutation.status, "committed");
  assert.equal(mutation.path, "notes");
  assert.match(mutation.diff, /Recursive deletion is not performed/);
  assert.equal(mutation.beforeHash, undefined);
  assert.equal(mutation.afterHash, undefined);
});

test("model delete_directory_tree flow persists bounded manifest metadata and a restore token", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "export const ready = true;\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/delete-directory-tree", {
      toolCall: {
        name: "delete_directory_tree",
        argumentsJson: JSON.stringify({ path: "project" }),
        finalResponse: "The bounded project tree was quarantined and can be restored with the returned token.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 2_000, maxTreeEntries: 20, maxTreeBytes: 1_000, maxTreeDepth: 5 }),
    userPrompt: "Remove the project tree safely.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  await assert.rejects(() => lstat(path.join(root, "project")), { code: "ENOENT" });
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    operation: string;
    risk?: string;
    status: string;
    path: string;
    quarantinePath?: string;
    manifestHash?: string;
    entryCount?: number;
    totalBytes?: number;
    maxDepth?: number;
  };
  assert.equal(mutation.operation, "delete-directory-tree");
  assert.equal(mutation.risk, "delete-directory-tree");
  assert.equal(mutation.status, "committed");
  assert.equal(mutation.path, "project");
  assert.match(mutation.quarantinePath ?? "", /^\.computer-native-trash\/mutation_[A-Za-z0-9]+\/payload$/);
  assert.equal(typeof mutation.manifestHash, "string");
  assert.equal(mutation.entryCount, 3);
  assert.equal(mutation.totalBytes, Buffer.byteLength("export const ready = true;\n"));
  assert.equal(mutation.maxDepth, 2);
});

test("model delete flow persists the quarantine path and restore token", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "remove me\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/delete", {
      toolCall: {
        name: "delete",
        argumentsJson: JSON.stringify({ path: "note.txt" }),
        finalResponse: "The file was quarantined and can be restored with the returned token.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Remove the note safely.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  await assert.rejects(() => readFile(target));
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as {
    operation: string;
    status: string;
    quarantinePath?: string;
    sourceMutationId?: string;
  };
  assert.equal(mutation.operation, "delete");
  assert.equal(mutation.status, "committed");
  assert.match(mutation.quarantinePath ?? "", /\.computer-native-trash/);
  assert.equal(mutation.sourceMutationId, undefined);
});

test("model copy and move flows persist source identity and committed outcomes", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "source.txt"), "model transfer\n", "utf8");
  const session = await openSession(stateDir);
  const copyResult = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/copy", {
      toolCall: {
        name: "copy",
        argumentsJson: JSON.stringify({ source: "source.txt", destination: "copy.txt" }),
        finalResponse: "The file was copied after approval.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Copy the source file.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(copyResult.status, "completed");
  const copyMutationDirectory = path.join(stateDir, "sessions", copyResult.sessionId, "turns", copyResult.turnId, "mutations");
  const copyMutationFile = (await readdir(copyMutationDirectory))[0]!;
  const copyMutation = JSON.parse(await readFile(path.join(copyMutationDirectory, copyMutationFile), "utf8")) as { operation: string; status: string; sourcePath?: string; sourceHash?: string; afterHash?: string };
  assert.equal(copyMutation.operation, "copy");
  assert.equal(copyMutation.status, "committed");
  assert.equal(copyMutation.sourcePath, "source.txt");
  assert.equal(copyMutation.sourceHash, copyMutation.afterHash);

  const moveResult = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/move", {
      toolCall: {
        name: "move",
        argumentsJson: JSON.stringify({ source: "copy.txt", destination: "moved.txt" }),
        finalResponse: "The copied file was moved after approval.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Move the copy.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(moveResult.status, "completed");
  assert.equal(await readFile(path.join(root, "moved.txt"), "utf8"), "model transfer\n");
  const moveMutationDirectory = path.join(stateDir, "sessions", moveResult.sessionId, "turns", moveResult.turnId, "mutations");
  const moveMutationFile = (await readdir(moveMutationDirectory))[0]!;
  const moveMutation = JSON.parse(await readFile(path.join(moveMutationDirectory, moveMutationFile), "utf8")) as { operation: string; status: string; sourcePath?: string };
  assert.equal(moveMutation.operation, "move");
  assert.equal(moveMutation.status, "committed");
  assert.equal(moveMutation.sourcePath, "copy.txt");
});

test("model mutation failure persists a failed state without false success", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 }, {
    atomicWriter: async () => {
      throw new Error("simulated commit failure");
    },
  });
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    tools: new ToolRegistry(workspace, 1_000),
    provider: new DeterministicModelProvider("deterministic/patch-failure", {
      toolCall: {
        name: "apply_patch",
        argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
` }),
        finalResponse: "The write failed and the original file remains unchanged.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Update the note.",
    approveMutation: async () => ({ decision: "allow-once" }),
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "old\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as { status: string; reason?: string };
  assert.equal(mutation.status, "failed");
  assert.match(mutation.reason ?? "", /could not be committed atomically/);
});

test("model apply_patch fails closed without an approval channel", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/patch", {
      toolCall: {
        name: "apply_patch",
        argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
` }),
        finalResponse: "The change needs approval.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, maxToolOutputBytes: 1_000 }),
    userPrompt: "Update the note.",
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "old\n");
  const mutationsDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "mutations");
  const mutationFiles = await readdir(mutationsDirectory);
  const mutation = JSON.parse(await readFile(path.join(mutationsDirectory, mutationFiles[0]!), "utf8")) as { status: string; decision: string; errorCode?: string };
  assert.equal(mutation.status, "denied");
  assert.equal(mutation.decision, "unavailable");
  assert.equal(mutation.errorCode, "approval-unavailable");
  const events = (await readFile(path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId, "events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
  assert.deepEqual(events.filter((event) => event.type.startsWith("WorkspaceMutation")).map((event) => event.type), [
    "WorkspaceMutationProposed",
    "WorkspaceMutationApprovalDecided",
    "WorkspaceMutationFailed",
  ]);
});

test("approval timeout aborts a late approval before it can commit", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/patch", {
      toolCall: {
        name: "apply_patch",
        argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+late
*** End Patch
` }),
        finalResponse: "The patch approval timed out.",
      },
    }),
    config: config(stateDir, {
      workspaceRoot: root,
      maxToolOutputBytes: 1_000,
      maxToolDurationMs: 1_000,
      approvalTimeoutMs: 10,
    }),
    userPrompt: "Update the note.",
    approveMutation: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { decision: "allow-once" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "old\n");
});

test("human approval does not consume the total turn deadline", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const session = await openSession(stateDir);
  const result = await runTurn({
    session,
    provider: new DeterministicModelProvider("deterministic/patch", {
      toolCall: {
        name: "apply_patch",
        argumentsJson: JSON.stringify({ patch: `*** Begin Patch
*** Update File: note.md
@@
-old
+approved
*** End Patch
` }),
        finalResponse: "The approved patch was applied.",
      },
    }),
    config: config(stateDir, { workspaceRoot: root, timeoutMs: 1_000, firstEventTimeoutMs: 1_000, maxToolDurationMs: 2_000, approvalTimeoutMs: 2_000 }),
    userPrompt: "Update the note.",
    approveMutation: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return { decision: "allow-once" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(await readFile(target, "utf8"), "approved\n");
});

test("restart reconciliation classifies an approved mutation by hashes without replaying it", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
`);
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted mutation", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_restart",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    status: "approved",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await recoveredSession.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  assert.equal(recovered[0]?.status, "interrupted");
  assert.equal(await readFile(target, "utf8"), "old\n");
  const mutation = JSON.parse(await readFile(path.join(turn.directory, "mutations", "mutation_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(mutation.status, "reconciled");
  assert.match(mutation.reason, /not replayed/);

  await writeFile(target, prepared.afterContent, "utf8");
  const secondStateDir = path.join(stateDir, "second");
  await mkdir(secondStateDir, { recursive: true });
  const secondSession = await openSession(secondStateDir);
  const secondTurn = await secondSession.admitTurn("committed mutation", "deterministic", "deterministic/echo");
  await secondTurn.updateState("streaming");
  await secondTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_committed_restart",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  const reopenedSecond = await SessionStore.open(secondStateDir, secondSession.metadata.sessionId);
  await reopenedSecond.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedMutation = JSON.parse(await readFile(path.join(secondTurn.directory, "mutations", "mutation_committed_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedMutation.status, "committed");
  assert.match(committedMutation.reason, /after-hash/);
  const repeatedRecovery = await SessionStore.open(secondStateDir, secondSession.metadata.sessionId);
  assert.deepEqual(await repeatedRecovery.recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
  assert.equal(await readFile(target, "utf8"), prepared.afterContent);

  await writeFile(target, "conflicting user edit\n", "utf8");
  const conflict = await workspace.reconcileMutation({
    schemaVersion: 1,
    mutationId: "mutation_conflicting_restart",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  assert.equal(conflict.status, "reconciliation_required");
  assert.equal(conflict.errorCode, "reconciliation-required");
});

test("restart reconciles a mutation after its applying record acknowledgement is lost", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
`);
  let mutationWrites = 0;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (operation === "replace-json" && filePath.endsWith("mutation_ack_recovery.json") && mutationWrites++ === 2) {
          throw new Error("simulated applying mutation acknowledgement failure");
        }
      },
    },
  });
  const turn = await session.admitTurn("recover the mutation record", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  const base = {
    schemaVersion: 1 as const,
    mutationId: "mutation_ack_recovery",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    recordedAt: new Date().toISOString(),
  };
  await turn.writeMutation({ ...base, status: "proposed" });
  await turn.writeMutation({ ...base, status: "approved", decision: "allow-once" });
  await assert.rejects(
    () => turn.writeMutation({ ...base, status: "applying", decision: "allow-once" }),
    /simulated applying mutation acknowledgement failure/u,
  );

  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  const firstRecovery = await recoveredSession.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  assert.equal(firstRecovery[0]?.status, "interrupted");
  assert.equal(await readFile(target, "utf8"), "old\n");
  assert.equal((await turn.readMutations())[0]?.status, "reconciled");
  assert.match((await turn.readMutations())[0]?.reason ?? "", /not replayed/u);

  const secondRecovery = await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  assert.deepEqual(secondRecovery, []);
  assert.equal((await turn.readMutations())[0]?.status, "reconciled");
});

test("restart repairs missing mutation reconciliation evidence from a durable record", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
`);
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("repair mutation evidence", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.appendEvent("TurnStarted");
  await turn.appendEvent("WorkspaceMutationProposed", { mutationId: "mutation_event_recovery", path: prepared.path, operation: prepared.operation });
  await turn.appendEvent("WorkspaceMutationApprovalDecided", { mutationId: "mutation_event_recovery", decision: "allow-once" });
  await turn.appendEvent("WorkspaceMutationApplying", { mutationId: "mutation_event_recovery", decision: "allow-once" });
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_event_recovery",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date(1).toISOString(),
  });

  await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const events = await turn.readEvents();
  assert.deepEqual(events.map((event) => event.type), [
    "TurnStarted",
    "WorkspaceMutationProposed",
    "WorkspaceMutationApprovalDecided",
    "WorkspaceMutationApplying",
    "WorkspaceMutationReconciled",
    "TurnInterrupted",
  ]);
  assert.equal(events[4]?.payload.mutationId, "mutation_event_recovery");
  assert.equal(events[4]?.payload.status, "reconciled");
  assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
  assert.equal((await turn.readEvents()).filter((event) => event.type === "WorkspaceMutationReconciled").length, 1);
});

test("restart recovery closes an undecided approval without replaying the mutation", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.md");
  await writeFile(target, "old\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const prepared = await workspace.preparePatch(`*** Begin Patch
*** Update File: note.md
@@
-old
+new
*** End Patch
`);
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted approval", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_undecided_restart",
    operation: prepared.operation,
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
    status: "proposed",
    recordedAt: new Date().toISOString(),
  });

  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  const recovered = await recoveredSession.recoverInterruptedTurns();
  assert.equal(recovered[0]?.status, "interrupted");
  assert.equal(await readFile(target, "utf8"), "old\n");
  const mutation = JSON.parse(await readFile(path.join(turn.directory, "mutations", "mutation_undecided_restart.json"), "utf8")) as {
    status: string;
    decision?: string;
    errorCode?: string;
    reason?: string;
  };
  assert.equal(mutation.status, "denied");
  assert.equal(mutation.decision, "unavailable");
  assert.equal(mutation.errorCode, "approval-unavailable");
  assert.match(mutation.reason ?? "", /stopped before approval/i);
  const repeated = await SessionStore.open(stateDir, session.metadata.sessionId);
  assert.deepEqual(await repeated.recoverInterruptedTurns((record) => workspace.reconcileMutation(record)), []);
});

test("durable mutation records enforce one-way state transitions and immutable identity", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("record mutation lifecycle", "deterministic", "deterministic/echo");
  const base = {
    schemaVersion: 1 as const,
    mutationId: "mutation_lifecycle",
    operation: "write" as const,
    path: "note.txt",
    beforeHash: "before",
    afterHash: "after",
    addedLines: 1,
    removedLines: 1,
    diff: "--- a/note.txt\n+++ b/note.txt\n@@\n-old\n+new\n",
    recordedAt: new Date().toISOString(),
  };
  await turn.writeMutation({ ...base, status: "proposed" });
  await turn.writeMutation({ ...base, status: "approved", decision: "allow-once" });
  await turn.writeMutation({ ...base, status: "applying", decision: "allow-once" });
  await turn.writeMutation({ ...base, status: "committed", decision: "allow-once", reason: "commit acknowledged" });

  await assert.rejects(
    () => turn.writeMutation({ ...base, status: "applying", decision: "allow-once" }),
    /cannot transition.*committed.*applying/,
  );
  await assert.rejects(
    () => turn.writeMutation({ ...base, path: "other.txt", status: "committed", decision: "allow-once" }),
    /identity cannot be changed/,
  );
  const persisted = (await turn.readMutations())[0];
  assert.equal(persisted?.status, "committed");
  assert.equal(persisted?.path, "note.txt");
  const mutationMetadata = await stat(path.join(turn.directory, "mutations", "mutation_lifecycle.json"));
  assert.equal(mutationMetadata.mode & 0o777, 0o600);
  assert.deepEqual(redactRecord({ authorization: "Bearer secret-value", nested: "secret-value" }, ["secret-value"]), {
    authorization: "[REDACTED]",
    nested: "[REDACTED]",
  });
});

test("restart reconciliation handles interrupted directory creation without replaying it", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted directory creation", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_mkdir_restart",
    operation: "mkdir",
    path: "new-dir",
    addedLines: 0,
    removedLines: 0,
    diff: "Create directory: new-dir",
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });

  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  await recoveredSession.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const mutation = JSON.parse(await readFile(path.join(turn.directory, "mutations", "mutation_mkdir_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(mutation.status, "reconciled");
  assert.match(mutation.reason, /directory was absent/);
  await assert.rejects(() => workspace.stat("new-dir"));

  await workspace.commitDirectory(await workspace.prepareDirectory("new-dir"));
  const secondStateDir = path.join(stateDir, "second");
  await mkdir(secondStateDir, { recursive: true });
  const secondSession = await openSession(secondStateDir);
  const secondTurn = await secondSession.admitTurn("directory created before acknowledgement", "deterministic", "deterministic/echo");
  await secondTurn.updateState("streaming");
  await secondTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_mkdir_committed_restart",
    operation: "mkdir",
    path: "new-dir",
    addedLines: 0,
    removedLines: 0,
    diff: "Create directory: new-dir",
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });

  const reopenedSecond = await SessionStore.open(secondStateDir, secondSession.metadata.sessionId);
  await reopenedSecond.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedMutation = JSON.parse(await readFile(path.join(secondTurn.directory, "mutations", "mutation_mkdir_committed_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedMutation.status, "committed");
  assert.match(committedMutation.reason, /directory was present/);
});

test("restart reconciliation handles interrupted empty-directory deletion without replaying it", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(path.join(root, "empty"), { recursive: true });
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted empty-directory deletion", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_delete_directory_restart",
    operation: "delete-directory",
    risk: "delete-directory",
    path: "empty",
    addedLines: 0,
    removedLines: 0,
    diff: "Delete empty directory: empty/",
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });

  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  await recoveredSession.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const mutation = JSON.parse(await readFile(path.join(turn.directory, "mutations", "mutation_delete_directory_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(mutation.status, "reconciled");
  assert.match(mutation.reason, /empty directory was present/);
  assert.equal((await workspace.stat("empty")).kind, "directory");

  await (await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 })).commitDirectoryDeletion(await workspace.prepareDirectoryDeletion("empty"));
  const secondStateDir = path.join(stateDir, "second");
  await mkdir(secondStateDir, { recursive: true });
  const secondSession = await openSession(secondStateDir);
  const secondTurn = await secondSession.admitTurn("directory deleted before acknowledgement", "deterministic", "deterministic/echo");
  await secondTurn.updateState("streaming");
  await secondTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_delete_directory_committed_restart",
    operation: "delete-directory",
    risk: "delete-directory",
    path: "empty",
    addedLines: 0,
    removedLines: 0,
    diff: "Delete empty directory: empty/",
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });

  const reopenedSecond = await SessionStore.open(secondStateDir, secondSession.metadata.sessionId);
  await reopenedSecond.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedMutation = JSON.parse(await readFile(path.join(secondTurn.directory, "mutations", "mutation_delete_directory_committed_restart.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedMutation.status, "committed");
  assert.match(committedMutation.reason, /directory was absent/);
});

test("restart reconciliation distinguishes directory-tree delete, restore, and purge outcomes", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "recover tree\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10, maxTreeEntries: 20, maxTreeBytes: 1_000, maxTreeDepth: 5 });
  const deletion = await workspace.prepareDirectoryTreeDeletion("project", "mutation_tree_reconcile");

  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted directory-tree deletion", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: deletion.mutationId,
    operation: "delete-directory-tree",
    risk: "delete-directory-tree",
    path: deletion.path,
    quarantinePath: deletion.quarantinePath,
    manifestHash: deletion.manifestHash,
    entryCount: deletion.entryCount,
    totalBytes: deletion.totalBytes,
    maxDepth: deletion.maxDepth,
    addedLines: 0,
    removedLines: 0,
    diff: deletion.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const notDeleted = JSON.parse(await readFile(path.join(turn.directory, "mutations", `${deletion.mutationId}.json`), "utf8")) as { status: string; reason: string };
  assert.equal(notDeleted.status, "reconciled");
  assert.match(notDeleted.reason, /manifest|not replayed/);

  await workspace.commitDirectoryTreeDeletion(deletion);
  const committedStateDir = path.join(stateDir, "committed-tree");
  await mkdir(committedStateDir, { recursive: true });
  const committedSession = await openSession(committedStateDir);
  const committedTurn = await committedSession.admitTurn("tree deleted before acknowledgement", "deterministic", "deterministic/echo");
  await committedTurn.updateState("streaming");
  await committedTurn.writeMutation({
    schemaVersion: 1,
    mutationId: deletion.mutationId,
    operation: "delete-directory-tree",
    risk: "delete-directory-tree",
    path: deletion.path,
    quarantinePath: deletion.quarantinePath,
    manifestHash: deletion.manifestHash,
    entryCount: deletion.entryCount,
    totalBytes: deletion.totalBytes,
    maxDepth: deletion.maxDepth,
    addedLines: 0,
    removedLines: 0,
    diff: deletion.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(committedStateDir, committedSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedDelete = JSON.parse(await readFile(path.join(committedTurn.directory, "mutations", `${deletion.mutationId}.json`), "utf8")) as { status: string; reason: string };
  assert.equal(committedDelete.status, "committed");
  assert.match(committedDelete.reason, /payload/);

  const restore = await workspace.prepareDirectoryRestore(deletion.mutationId);
  const restoreStateDir = path.join(stateDir, "restore-tree");
  await mkdir(restoreStateDir, { recursive: true });
  const restoreSession = await openSession(restoreStateDir);
  const restoreTurn = await restoreSession.admitTurn("interrupted directory-tree restore", "deterministic", "deterministic/echo");
  await restoreTurn.updateState("streaming");
  await restoreTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_restore_tree_reconcile",
    operation: "restore-directory",
    risk: "restore-directory",
    path: restore.path,
    quarantinePath: restore.quarantinePath,
    sourceMutationId: restore.sourceMutationId,
    manifestHash: restore.manifestHash,
    entryCount: restore.entryCount,
    totalBytes: restore.totalBytes,
    maxDepth: restore.maxDepth,
    addedLines: 0,
    removedLines: 0,
    diff: restore.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(restoreStateDir, restoreSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const notRestored = JSON.parse(await readFile(path.join(restoreTurn.directory, "mutations", "mutation_restore_tree_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(notRestored.status, "reconciled");
  await workspace.commitDirectoryRestore(restore);
  assert.equal(await readFile(path.join(root, "project", "src", "main.ts"), "utf8"), "recover tree\n");

  const second = await workspace.prepareDirectoryTreeDeletion("project", "mutation_tree_purge_reconcile");
  await workspace.commitDirectoryTreeDeletion(second);
  const purge = await workspace.prepareQuarantinePurge(second.mutationId);
  const purgeStateDir = path.join(stateDir, "purge-tree");
  await mkdir(purgeStateDir, { recursive: true });
  const purgeSession = await openSession(purgeStateDir);
  const purgeTurn = await purgeSession.admitTurn("interrupted quarantine purge", "deterministic", "deterministic/echo");
  await purgeTurn.updateState("streaming");
  await purgeTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_purge_record",
    operation: "purge-quarantine",
    risk: "purge-quarantine",
    path: purge.path,
    quarantinePath: purge.quarantinePath,
    sourceMutationId: purge.sourceMutationId,
    addedLines: 0,
    removedLines: 0,
    diff: purge.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(purgeStateDir, purgeSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const notPurged = JSON.parse(await readFile(path.join(purgeTurn.directory, "mutations", "mutation_purge_record.json"), "utf8")) as { status: string };
  assert.equal(notPurged.status, "reconciled");
  await workspace.commitQuarantinePurge(purge);
  const completedStateDir = path.join(stateDir, "purge-completed");
  await mkdir(completedStateDir, { recursive: true });
  const completedSession = await openSession(completedStateDir);
  const completedTurn = await completedSession.admitTurn("purge completed before acknowledgement", "deterministic", "deterministic/echo");
  await completedTurn.updateState("streaming");
  await completedTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_purge_completed_record",
    operation: "purge-quarantine",
    risk: "purge-quarantine",
    path: purge.path,
    quarantinePath: purge.quarantinePath,
    sourceMutationId: purge.sourceMutationId,
    addedLines: 0,
    removedLines: 0,
    diff: purge.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(completedStateDir, completedSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const completedPurge = JSON.parse(await readFile(path.join(completedTurn.directory, "mutations", "mutation_purge_completed_record.json"), "utf8")) as { status: string };
  assert.equal(completedPurge.status, "committed");
});

test("restart reconciliation handles quarantined delete and restore without replay", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  const target = path.join(root, "note.txt");
  await writeFile(target, "recover me\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const deletion = await workspace.prepareDelete("note.txt", "mutation_delete_reconcile");

  const session = await openSession(stateDir);
  const turn = await session.admitTurn("interrupted delete", "deterministic", "deterministic/echo");
  await turn.updateState("streaming");
  await turn.writeMutation({
    schemaVersion: 1,
    mutationId: deletion.mutationId,
    operation: "delete",
    path: deletion.path,
    beforeHash: deletion.beforeHash,
    quarantinePath: deletion.quarantinePath,
    addedLines: 0,
    removedLines: 0,
    diff: deletion.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  const recoveredSession = await SessionStore.open(stateDir, session.metadata.sessionId);
  await recoveredSession.recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const notDeleted = JSON.parse(await readFile(path.join(turn.directory, "mutations", `${deletion.mutationId}.json`), "utf8")) as { status: string; reason: string };
  assert.equal(notDeleted.status, "reconciled");
  assert.match(notDeleted.reason, /deletion was not replayed/);

  await workspace.commitDelete(deletion);
  const committedStateDir = path.join(stateDir, "committed");
  await mkdir(committedStateDir, { recursive: true });
  const committedSession = await openSession(committedStateDir);
  const committedTurn = await committedSession.admitTurn("delete committed before acknowledgement", "deterministic", "deterministic/echo");
  await committedTurn.updateState("streaming");
  await committedTurn.writeMutation({
    schemaVersion: 1,
    mutationId: deletion.mutationId,
    operation: "delete",
    path: deletion.path,
    beforeHash: deletion.beforeHash,
    quarantinePath: deletion.quarantinePath,
    addedLines: 0,
    removedLines: 0,
    diff: deletion.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(committedStateDir, committedSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedDelete = JSON.parse(await readFile(path.join(committedTurn.directory, "mutations", `${deletion.mutationId}.json`), "utf8")) as { status: string; reason: string };
  assert.equal(committedDelete.status, "committed");
  assert.match(committedDelete.reason, /quarantined payload/);

  const restore = await workspace.prepareRestore(deletion.mutationId);
  const restoreStateDir = path.join(stateDir, "restore");
  await mkdir(restoreStateDir, { recursive: true });
  const restoreSession = await openSession(restoreStateDir);
  const restoreTurn = await restoreSession.admitTurn("interrupted restore", "deterministic", "deterministic/echo");
  await restoreTurn.updateState("streaming");
  await restoreTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_restore_reconcile",
    operation: "restore",
    path: restore.path,
    beforeHash: restore.beforeHash,
    quarantinePath: restore.quarantinePath,
    sourceMutationId: restore.sourceMutationId,
    addedLines: 0,
    removedLines: 0,
    diff: restore.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(restoreStateDir, restoreSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const notRestored = JSON.parse(await readFile(path.join(restoreTurn.directory, "mutations", "mutation_restore_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(notRestored.status, "reconciled");
  assert.match(notRestored.reason, /restore was not replayed/);

  await workspace.commitRestore(restore);
  const restoredStateDir = path.join(stateDir, "restored");
  await mkdir(restoredStateDir, { recursive: true });
  const restoredSession = await openSession(restoredStateDir);
  const restoredTurn = await restoredSession.admitTurn("restore committed before acknowledgement", "deterministic", "deterministic/echo");
  await restoredTurn.updateState("streaming");
  await restoredTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_restore_committed",
    operation: "restore",
    path: restore.path,
    beforeHash: restore.beforeHash,
    quarantinePath: restore.quarantinePath,
    sourceMutationId: restore.sourceMutationId,
    addedLines: 0,
    removedLines: 0,
    diff: restore.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(restoredStateDir, restoredSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedRestore = JSON.parse(await readFile(path.join(restoredTurn.directory, "mutations", "mutation_restore_committed.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedRestore.status, "committed");
  assert.match(committedRestore.reason, /restored file was present/);
  assert.equal(await readFile(target, "utf8"), "recover me\n");
});

test("restart reconciliation distinguishes uncommitted and committed copy/move operations", async () => {
  const stateDir = tempDirectory();
  const root = path.join(stateDir, "workspace");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "source.txt"), "transfer recovery\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 10 });
  const copy = await workspace.prepareCopy("source.txt", "copy.txt");
  const beforeCopyState = path.join(stateDir, "copy-before");
  await mkdir(beforeCopyState, { recursive: true });
  const beforeCopySession = await openSession(beforeCopyState);
  const beforeCopyTurn = await beforeCopySession.admitTurn("interrupted copy", "deterministic", "deterministic/echo");
  await beforeCopyTurn.updateState("streaming");
  await beforeCopyTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_copy_reconcile",
    operation: "copy",
    path: copy.path,
    sourcePath: copy.sourcePath,
    sourceHash: copy.beforeHash,
    beforeHash: copy.beforeHash,
    afterHash: copy.afterHash,
    addedLines: 0,
    removedLines: 0,
    diff: copy.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(beforeCopyState, beforeCopySession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const uncommittedCopy = JSON.parse(await readFile(path.join(beforeCopyTurn.directory, "mutations", "mutation_copy_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(uncommittedCopy.status, "reconciled");
  assert.match(uncommittedCopy.reason, /transfer was not replayed/);

  await workspace.commitCopy(copy);
  const afterCopyState = path.join(stateDir, "copy-after");
  await mkdir(afterCopyState, { recursive: true });
  const afterCopySession = await openSession(afterCopyState);
  const afterCopyTurn = await afterCopySession.admitTurn("copy committed before acknowledgement", "deterministic", "deterministic/echo");
  await afterCopyTurn.updateState("streaming");
  await afterCopyTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_copy_reconcile",
    operation: "copy",
    path: copy.path,
    sourcePath: copy.sourcePath,
    sourceHash: copy.beforeHash,
    beforeHash: copy.beforeHash,
    afterHash: copy.afterHash,
    addedLines: 0,
    removedLines: 0,
    diff: copy.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(afterCopyState, afterCopySession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedCopy = JSON.parse(await readFile(path.join(afterCopyTurn.directory, "mutations", "mutation_copy_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedCopy.status, "committed");
  assert.match(committedCopy.reason, /copied destination/);

  const move = await workspace.prepareMove("copy.txt", "moved.txt");
  const beforeMoveState = path.join(stateDir, "move-before");
  await mkdir(beforeMoveState, { recursive: true });
  const beforeMoveSession = await openSession(beforeMoveState);
  const beforeMoveTurn = await beforeMoveSession.admitTurn("interrupted move", "deterministic", "deterministic/echo");
  await beforeMoveTurn.updateState("streaming");
  await beforeMoveTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_move_reconcile",
    operation: "move",
    path: move.path,
    sourcePath: move.sourcePath,
    sourceHash: move.beforeHash,
    beforeHash: move.beforeHash,
    afterHash: move.afterHash,
    addedLines: 0,
    removedLines: 0,
    diff: move.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(beforeMoveState, beforeMoveSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const uncommittedMove = JSON.parse(await readFile(path.join(beforeMoveTurn.directory, "mutations", "mutation_move_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(uncommittedMove.status, "reconciled");
  assert.match(uncommittedMove.reason, /transfer was not replayed/);

  await workspace.commitMove(move);
  const afterMoveState = path.join(stateDir, "move-after");
  await mkdir(afterMoveState, { recursive: true });
  const afterMoveSession = await openSession(afterMoveState);
  const afterMoveTurn = await afterMoveSession.admitTurn("move committed before acknowledgement", "deterministic", "deterministic/echo");
  await afterMoveTurn.updateState("streaming");
  await afterMoveTurn.writeMutation({
    schemaVersion: 1,
    mutationId: "mutation_move_reconcile",
    operation: "move",
    path: move.path,
    sourcePath: move.sourcePath,
    sourceHash: move.beforeHash,
    beforeHash: move.beforeHash,
    afterHash: move.afterHash,
    addedLines: 0,
    removedLines: 0,
    diff: move.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  });
  await (await SessionStore.open(afterMoveState, afterMoveSession.metadata.sessionId)).recoverInterruptedTurns((record) => workspace.reconcileMutation(record));
  const committedMove = JSON.parse(await readFile(path.join(afterMoveTurn.directory, "mutations", "mutation_move_reconcile.json"), "utf8")) as { status: string; reason: string };
  assert.equal(committedMove.status, "committed");
  assert.match(committedMove.reason, /moved destination/);
  assert.equal(await readFile(path.join(root, "moved.txt"), "utf8"), "transfer recovery\n");
});

test("restart reconciliation handles directory copy, move, and rename manifests", async () => {
  const root = path.join(tempDirectory(), "workspace");
  await mkdir(path.join(root, "project", "src"), { recursive: true });
  await mkdir(path.join(root, "archive"), { recursive: true });
  await writeFile(path.join(root, "project", "src", "main.ts"), "directory recovery\n", "utf8");
  const workspace = await Workspace.open(root, { maxFileBytes: 100, maxDirectoryEntries: 20, maxTreeEntries: 20, maxTreeBytes: 1_000, maxTreeDepth: 4 });

  const copy = await workspace.prepareCopy("project", "project-copy");
  const copyRecord: WorkspaceMutationRecord = {
    schemaVersion: 1,
    mutationId: "mutation_directory_copy_reconcile",
    operation: "copy",
    risk: "copy-directory",
    path: copy.path,
    sourcePath: copy.sourcePath,
    sourceHash: copy.beforeHash,
    beforeHash: copy.beforeHash,
    afterHash: copy.afterHash,
    manifestHash: copy.manifestHash,
    entryCount: copy.entryCount,
    totalBytes: copy.bytes,
    maxDepth: copy.maxDepth,
    addedLines: 0,
    removedLines: 0,
    diff: copy.preview,
    status: "applying",
    decision: "allow-once",
    recordedAt: new Date().toISOString(),
  };
  const uncommittedCopy = await workspace.reconcileMutation(copyRecord);
  assert.equal(uncommittedCopy.status, "reconciled");
  await workspace.commitCopy(copy);
  const committedCopy = await workspace.reconcileMutation(copyRecord);
  assert.equal(committedCopy.status, "committed");

  const move = await workspace.prepareMove("project-copy", "archive/project");
  const moveRecord: WorkspaceMutationRecord = {
    ...copyRecord,
    mutationId: "mutation_directory_move_reconcile",
    operation: "move",
    risk: "move-directory",
    path: move.path,
    sourcePath: move.sourcePath,
    sourceHash: move.beforeHash,
    beforeHash: move.beforeHash,
    afterHash: move.afterHash,
    manifestHash: move.manifestHash,
    entryCount: move.entryCount,
    totalBytes: move.bytes,
    maxDepth: move.maxDepth,
    diff: move.preview,
  };
  assert.equal((await workspace.reconcileMutation(moveRecord)).status, "reconciled");
  await workspace.commitMove(move);
  assert.equal((await workspace.reconcileMutation(moveRecord)).status, "committed");

  const rename = await workspace.prepareRename("archive/project", "archive/renamed-project");
  const renameRecord: WorkspaceMutationRecord = {
    ...moveRecord,
    mutationId: "mutation_directory_rename_reconcile",
    operation: "rename",
    risk: "rename-directory",
    path: rename.path,
    sourcePath: rename.sourcePath,
    sourceHash: rename.beforeHash,
    beforeHash: rename.beforeHash,
    afterHash: rename.afterHash,
    manifestHash: rename.manifestHash,
    entryCount: rename.entryCount,
    totalBytes: rename.bytes,
    maxDepth: rename.maxDepth,
    diff: rename.preview,
  };
  assert.equal((await workspace.reconcileMutation(renameRecord)).status, "reconciled");
  await workspace.commitRename(rename);
  assert.equal((await workspace.reconcileMutation(renameRecord)).status, "committed");
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
  await assert.rejects(() => turn.appendRound({ ...base, phase: "unknown" as never }), /invalid round record/);
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_requested", callId: "call_before_model", toolName: "read_file" }), /must begin with model request/);
  await turn.appendRound({ ...base, phase: "model_requested" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_completed" }), /without call identity/);
  await turn.appendRound({ ...base, phase: "model_completed" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "model_requested" }), /out-of-order phase evidence/);
  await assert.rejects(() => turn.appendRound({ ...base, round: 3, phase: "model_requested" }), /out-of-order round evidence/);
  await turn.appendRound({ ...base, phase: "tool_requested", callId: "call_1", toolName: "read_file" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_completed", callId: "call_2", toolName: "read_file" }), /does not match its request/);
  await turn.appendRound({ ...base, phase: "tool_completed", callId: "call_1", toolName: "read_file" });
  await assert.rejects(() => turn.appendRound({ ...base, phase: "tool_requested", callId: "call_1", toolName: "read_file" }), /duplicate tool call/);
});

test("round evidence accepts an identical immediate retry but rejects a conflicting retry", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("retry round evidence", "deterministic", "deterministic/echo");
  const first = {
    schemaVersion: 1 as const,
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    round: 1,
    phase: "model_requested" as const,
    recordedAt: new Date().toISOString(),
    payload: { requestBytes: 42 },
  };

  await turn.appendRound(first);
  await turn.appendRound({ ...first, recordedAt: new Date(Date.now() + 1).toISOString() });

  assert.equal((await turn.readRounds()).length, 1);
  await assert.rejects(
    () => turn.appendRound({ ...first, recordedAt: new Date(Date.now() + 2).toISOString(), payload: { requestBytes: 43 } }),
    /evidence was repeated with a different payload/u,
  );
});

test("memory search evidence is idempotent and rejects conflicting identity reuse", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const turn = await session.admitTurn("retry memory search evidence", "deterministic", "deterministic/echo");
  const first: MemorySearchEvidence = {
    schemaVersion: 1,
    searchId: "memory_search_retry",
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    correlationId: turn.correlationId,
    callId: "memory_search_call",
    queryHash: "query-hash",
    maxResults: 5,
    resultIds: ["memory_record_1"],
    resultCount: 1,
    truncated: false,
    recordedAt: new Date().toISOString(),
  };

  await turn.writeMemorySearch(first);
  await turn.writeMemorySearch({ ...first, recordedAt: new Date(Date.now() + 1).toISOString() });

  const evidenceDirectory = path.join(turn.directory, "memory-searches");
  assert.equal((await readdir(evidenceDirectory)).length, 1);
  await assert.rejects(
    () => turn.writeMemorySearch({ ...first, recordedAt: new Date(Date.now() + 2).toISOString(), resultIds: [], resultCount: 0 }),
    /evidence was repeated with a different payload/u,
  );
  const persisted = JSON.parse(await readFile(path.join(evidenceDirectory, "memory_search_retry.json"), "utf8")) as MemorySearchEvidence;
  assert.deepEqual(persisted.resultIds, ["memory_record_1"]);
});

test("restart repairs missing memory search lifecycle evidence without replay", async () => {
  const stateDir = tempDirectory();
  let interrupted = false;
  const session = await SessionStore.open(stateDir, undefined, {
    writeHooks: {
      afterWrite: (operation, filePath) => {
        if (!interrupted && operation === "replace-json" && filePath.includes(`${path.sep}memory-searches${path.sep}`)) {
          interrupted = true;
          throw new RuntimeInterruptionError("stopped after memory search evidence became durable");
        }
      },
    },
  });
  const turn = await session.admitTurn("recover memory search evidence", "deterministic", "deterministic/echo");
  await turn.appendEvent("TurnStarted", { provider: "deterministic", model: "deterministic/echo" });
  const search: MemorySearchEvidence = {
    schemaVersion: 1,
    searchId: "memory_search_recovery",
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    correlationId: turn.correlationId,
    callId: "memory_search_recovery_call",
    queryHash: "query-hash",
    maxResults: 5,
    resultIds: ["memory_record_1"],
    resultCount: 1,
    truncated: false,
    recordedAt: new Date().toISOString(),
  };
  await assert.rejects(
    () => turn.writeMemorySearch(search),
    /stopped after memory search evidence became durable/u,
  );

  const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
  const [recovered] = await restarted.recoverInterruptedTurns();
  assert.equal(recovered?.status, "interrupted");
  const eventsPath = path.join(turn.directory, "events.jsonl");
  const events = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload?: { recovered?: boolean } });
  const searchEvent = events.find((event) => event.type === "MemorySearched");
  assert.equal(searchEvent?.payload?.recovered, true);
  assert.ok(events.findIndex((event) => event.type === "MemorySearched") < events.findIndex((event) => event.type === "TurnInterrupted"));
  assert.deepEqual(await restarted.recoverInterruptedTurns(), []);
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

test("cancellation waits for an in-flight side-effecting tool to settle", async () => {
  const stateDir = tempDirectory();
  const session = await openSession(stateDir);
  const controller = new AbortController();
  let settled = false;
  const tools = {
    definitions: [],
    execute: async (call: { readonly name: string }) => {
      assert.equal(call.name, "apply_patch_set");
      controller.abort("cancelled after side effect start");
      await new Promise((resolve) => setTimeout(resolve, 25));
      settled = true;
      return {
        callId: "patch_set_call",
        name: "apply_patch_set",
        ok: false,
        content: "Tool error: patch set requires reconciliation.",
        summary: "Reconciliation required.",
        errorCode: "reconciliation-required" as const,
      };
    },
  } as unknown as ToolRegistry;
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/side-effecting-tool",
    async *stream(): AsyncIterable<{ readonly type: "tool_call"; readonly call: { readonly callId: string; readonly name: string; readonly argumentsJson: string } }> {
      yield { type: "tool_call", call: { callId: "patch_set_call", name: "apply_patch_set", argumentsJson: "{}" } };
    },
  };
  const result = await runTurn({ session, tools, provider, config: config(stateDir, { timeoutMs: 1_000 }), userPrompt: "cancel patch set", signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(settled, true);
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
  assert.deepEqual(parseTuiCommand("/models"), { kind: "models" });
  assert.deepEqual(parseTuiCommand("/not-real"), { kind: "unknown", name: "/not-real" });
  assert.equal(parseTuiCommand("tell me about the workspace"), undefined);
});

test("TUI model view shows explicit provider choices and the active selection", async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "nvidia/test-model:free",
    providerLabel: "openrouter/nvidia/test-model:free",
    providerName: "openrouter",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["list_directory", "read_file"],
    availableProviders: listModelProviderSummaries(),
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runCommand({ kind: "models" });

  const rendered = chunks.join("");
  assert.match(rendered, /Model providers/u);
  assert.match(rendered, /active.*openrouter\/nvidia\/test-model:free/u);
  assert.match(rendered, /Deterministic local provider/u);
  assert.match(rendered, /OpenRouter hosted provider/u);
  assert.match(rendered, /--provider.*--model/u);
});

test("TUI header presents a structured, factual agent-console surface", () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "openrouter/free",
    providerLabel: "openrouter/openrouter/free",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["list_directory", "read_file"],
  } as unknown as ChatApplication;

  new TerminalUi(application, output, false).printHeader();

  const rendered = chunks.join("");
  assert.match(rendered, /COMPUTER NATIVE/);
  assert.match(rendered, /openrouter\/openrouter\/free/);
  assert.match(rendered, /session_test/);
  assert.match(rendered, /Available tools/);
  assert.match(rendered, /list_directory · read_file/);
  assert.match(rendered, /\/help/);
});

test("TUI help is grouped around the actual terminal interaction", async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/echo",
    providerLabel: "deterministic/deterministic/echo",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["list_directory", "read_file"],
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runCommand({ kind: "help" });

  const rendered = chunks.join("");
  assert.match(rendered, /Session/);
  assert.match(rendered, /Input/);
  assert.match(rendered, /Ctrl\+C/);
  assert.match(rendered, /multiline/);
});

test("TUI renders the public turn lifecycle as styled activity", async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/echo",
    providerLabel: "deterministic/deterministic/echo",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["list_directory", "read_file"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      onText?: (text: string) => void,
      onEvent?: (event: TurnEvent) => void,
      _approveMutation?: unknown,
      onMutation?: (event: MutationEvent) => void,
    ) => {
      onEvent?.({ type: "waiting", round: 1 });
      onEvent?.({ type: "retry", round: 1, attempt: 1, delayMs: 0, reason: "temporary provider failure" });
      onEvent?.({
        type: "tool_started",
        round: 1,
        call: { callId: "call_1", name: "read_file", argumentsJson: '{"path":"note.txt"}' },
      });
      onEvent?.({ type: "tool_completed", round: 1, callId: "call_1", name: "read_file", ok: true, summary: "Read note.txt." });
      const mutationRequest = {
        mutationId: "mutation_test",
        operation: "update" as const,
        risk: "patch-file" as const,
        path: "note.md",
        beforeHash: "before",
        afterHash: "after",
        addedLines: 1,
        removedLines: 1,
        diff: "--- a/note.md\n+++ b/note.md\n@@\n-old\n+new\n",
      };
      onMutation?.({ type: "proposed", request: mutationRequest });
      onMutation?.({ type: "approval_decided", request: mutationRequest, decision: { decision: "allow-once" } });
      onMutation?.({ type: "applying", request: mutationRequest });
      onMutation?.({ type: "committed", request: mutationRequest, afterHash: "after", bytesWritten: 4 });
      onText?.("answer");
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "completed" as const,
        provider: "deterministic" as const,
        model: "deterministic/echo",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "answer",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, false).runSingle("inspect the note");

  const rendered = chunks.join("");
  assert.match(rendered, /waiting for model/);
  assert.match(rendered, /model retry · attempt 1 · temporary provider failure/);
  assert.match(rendered, /read_file · started/);
  assert.match(rendered, /read_file · Read note\.txt\./);
  assert.match(rendered, /workspace change · proposed note\.md/);
  assert.match(rendered, /workspace change · approved note\.md/);
  assert.match(rendered, /workspace change · applying note\.md/);
  assert.match(rendered, /workspace change · committed note\.md/);
  assert.match(rendered, /Agent › answer/);
  assert.match(rendered, /✓ completed/);
});

test("interactive TUI reviews and renders a local process execution", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const request: ProcessApprovalRequest = {
    callId: "process_ui_call",
    executionId: "execution_ui",
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    displayArgs: ["-e", "process.stdout.write('ok')"],
    cwd: ".",
    executablePath: process.execPath,
    environmentProfile: "sanitized-default",
    environmentKeys: ["PATH", "PWD"],
    limits: { timeoutMs: 500, terminationGraceMs: 100, maxOutputBytes: 4_096, maxArgumentCount: 16, maxArgumentBytes: 4_096 },
    argvHash: "ui-hash",
    approvalTimeoutMs: 5_000,
    warning: "This runs a real local host process. The workspace is not an OS sandbox.",
  };
  const result: ProcessResult = {
    executionId: request.executionId,
    state: "completed",
    started: true,
    pid: 123,
    command: request.command,
    displayArgs: request.displayArgs,
    cwd: request.cwd,
    executablePath: request.executablePath,
    stdout: "ok",
    stderr: "",
    stdoutBytes: 2,
    stderrBytes: 0,
    outputTruncated: false,
    durationMs: 4,
    terminationConfirmed: false,
  };
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/process",
    providerLabel: "deterministic/deterministic/process",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["run_command"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      onText?: (text: string) => void,
      onEvent?: (event: TurnEvent) => void,
      _approveMutation?: unknown,
      _onMutation?: unknown,
      approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>,
      onProcess?: (event: ProcessToolEvent) => void,
    ) => {
      const emit = (event: ProcessToolEvent): void => onProcess?.(event);
      onEvent?.({ type: "waiting", round: 1 });
      emit({ type: "prepared", request });
      const decision = await approveProcess?.(request);
      assert.equal(decision?.decision, "allow-once");
      emit({ type: "approval_decided", request, decision: decision ?? { decision: "unavailable", reason: "missing" } });
      emit({ type: "started", request, pid: 123 });
      emit({ type: "completed", request, result });
      onText?.("done");
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "completed" as const,
        provider: "deterministic" as const,
        model: "deterministic/process",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("run a harmless command\n"), 10);
  setTimeout(() => input.write("v\n"), 30);
  setTimeout(() => input.write("a\n"), 50);
  setTimeout(() => input.end(), 80);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Proposed local process/);
  assert.match(rendered, /approval timeout: 5000ms from prompt/u);
  assert.match(rendered, /Choice \[a\] approve once/);
  assert.match(rendered, /command · approved/);
  assert.match(rendered, /command · running · pid 123/);
  assert.match(rendered, /command · completed/);
});

test("interactive TUI cancels local process approval before launch", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const request: ProcessApprovalRequest = {
    callId: "process_ui_cancel",
    executionId: "execution_ui_cancel",
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    displayArgs: ["-e", "process.exit(0)"],
    cwd: ".",
    executablePath: process.execPath,
    environmentProfile: "sanitized-default",
    environmentKeys: ["PATH", "PWD"],
    limits: { timeoutMs: 500, terminationGraceMs: 100, maxOutputBytes: 4_096, maxArgumentCount: 16, maxArgumentBytes: 4_096 },
    argvHash: "ui-cancel-hash",
    warning: "This runs a real local host process. The workspace is not an OS sandbox.",
  };
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/process",
    providerLabel: "deterministic/deterministic/process",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["run_command"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      signal: AbortSignal | undefined,
      _onText?: (text: string) => void,
      _onEvent?: (event: TurnEvent) => void,
      _approveMutation?: unknown,
      _onMutation?: unknown,
      approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>,
    ) => {
      const decision = await approveProcess?.(request, signal);
      assert.equal(decision?.decision, "unavailable");
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "cancelled" as const,
        provider: "deterministic" as const,
        model: "deterministic/process",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        error: { code: "cancelled" as const, message: "The model request was cancelled." },
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("run a command\n"), 10);
  setTimeout(() => input.write("\u0003"), 30);
  setTimeout(() => input.end(), 60);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Approval cancelled; the process was not started/);
  assert.match(rendered, /Cancelling current turn/);
  assert.match(rendered, /cancelled/);
});

test("interactive TUI owns an apply_patch approval question and defaults to explicit yes", async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/patch",
    providerLabel: "deterministic/deterministic/patch",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["apply_patch"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      onText?: (text: string) => void,
      onEvent?: (event: TurnEvent) => void,
      approveMutation?: (request: { readonly mutationId: string; readonly operation: "update"; readonly path: string; readonly beforeHash: string; readonly afterHash: string; readonly addedLines: number; readonly removedLines: number; readonly diff: string }) => Promise<{ readonly decision: "allow-once" | "deny" | "unavailable"; readonly reason?: string }>,
    ) => {
      onEvent?.({ type: "waiting", round: 1 });
      const decision = await approveMutation?.({
        mutationId: "mutation_test",
        operation: "update",
        path: "note.md",
        beforeHash: "before",
        afterHash: "after",
        addedLines: 1,
        removedLines: 1,
        diff: "--- a/note.md\n+++ b/note.md\n@@\n-old\n+new\n",
      });
      assert.equal(decision?.decision, "allow-once");
      onText?.("done");
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return Promise.resolve({
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "completed" as const,
        provider: "deterministic" as const,
        model: "deterministic/patch",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      });
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("change note\n"), 10);
  setTimeout(() => input.write("y\n"), 30);
  setTimeout(() => input.end(), 50);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Proposed workspace change/);
  assert.match(rendered, /Choice \[a\] approve once/);
  assert.match(rendered, /approved once/);
  assert.match(rendered, /--- a\/note\.md/);
});

test("interactive TUI shows the complete path set for an approved patch set", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/patch-set",
    providerLabel: "deterministic/deterministic/patch-set",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["apply_patch_set"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      _onText?: (text: string) => void,
      _onEvent?: (event: TurnEvent) => void,
      approveMutation?: (request: { readonly mutationId: string; readonly operation: "patch-set"; readonly risk: "multi-file-patch"; readonly paths: readonly string[]; readonly path: string; readonly totalBytes: number; readonly maxBytes: number; readonly addedLines: number; readonly removedLines: number; readonly diff: string }) => Promise<{ readonly decision: "allow-once" | "deny" | "unavailable"; readonly reason?: string }>,
    ) => {
      const decision = await approveMutation?.({
        mutationId: "mutation_batch_ui",
        operation: "patch-set",
        risk: "multi-file-patch",
        paths: ["one.txt", "two.txt"],
        path: "one.txt",
        totalBytes: 8,
        maxBytes: 16,
        addedLines: 2,
        removedLines: 2,
        diff: "Apply patch set: 2 files\n- one.txt\n- two.txt\n",
      });
      assert.equal(decision?.decision, "allow-once");
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "completed" as const,
        provider: "deterministic" as const,
        model: "deterministic/patch-set",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("batch update\n"), 10);
  setTimeout(() => input.write("y\n"), 30);
  setTimeout(() => input.end(), 50);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /multi-file-patch/);
  assert.match(rendered, /paths/);
  assert.match(rendered, /one\.txt/);
  assert.match(rendered, /two\.txt/);
  assert.match(rendered, /2 files/);
  assert.match(rendered, /8 bytes/);
  assert.match(rendered, /16 bytes maximum/);
});

test("interactive TUI cancels an approval question when the active turn is interrupted", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const application = {
    sessionId: "session_test",
    modelLabel: "deterministic/patch",
    providerLabel: "deterministic/deterministic/patch",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["apply_patch"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      signal: AbortSignal | undefined,
      _onText?: (text: string) => void,
      _onEvent?: (event: TurnEvent) => void,
      approveMutation?: (request: { readonly mutationId: string; readonly operation: "update"; readonly path: string; readonly beforeHash: string; readonly afterHash: string; readonly addedLines: number; readonly removedLines: number; readonly diff: string }, signal?: AbortSignal) => Promise<{ readonly decision: "allow-once" | "deny" | "unavailable"; readonly reason?: string }>,
    ) => {
      const decision = await approveMutation?.({
        mutationId: "mutation_cancel",
        operation: "update",
        path: "note.md",
        beforeHash: "before",
        afterHash: "after",
        addedLines: 1,
        removedLines: 1,
        diff: "--- a/note.md\n+++ b/note.md\n@@\n-old\n+new\n",
      }, signal);
      assert.equal(decision?.decision, "unavailable");
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_test"),
        turnId: asTurnId("turn_test"),
        status: "cancelled" as const,
        provider: "deterministic" as const,
        model: "deterministic/patch",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        error: { code: "cancelled" as const, message: "The model request was cancelled." },
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const running = new TerminalUi(application, output, true).runInteractive(input);
  setTimeout(() => input.write("change note\n"), 10);
  setTimeout(() => input.write("\u0003"), 30);
  setTimeout(() => input.end(), 60);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Cancelling current turn/);
  assert.match(rendered, /cancelled/);
});
