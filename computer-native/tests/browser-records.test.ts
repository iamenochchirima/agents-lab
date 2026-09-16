import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertBrowserActionTransition,
  type BrowserActionRecord,
} from "../src/browser/records.js";
import {
  BrowserError,
  BrowserArtifactStore,
  BrowserSessionManager,
  BrowserUrlPolicy,
  asBrowserDocumentId,
  asBrowserSessionId,
  asBrowserTabId,
  type BrowserActionRequest,
  type BrowserActionResult,
  type BrowserAdapter,
  type BrowserSnapshot,
  type BrowserTabInfo,
} from "../src/browser/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { pngFixture } from "./browser-fixtures.js";
import { loadConfig } from "../src/config/config.js";
import type { ModelProvider } from "../src/models/provider.js";
import type { ModelRequest, ModelStreamEvent } from "../src/runtime/contracts.js";
import { runTurn } from "../src/runtime/turn.js";
import { RuntimeInterruptionError } from "../src/runtime/errors.js";
import { atomicWriteJson } from "../src/persistence/json.js";
import { SessionStore } from "../src/persistence/session-store.js";

function record(status: BrowserActionRecord["status"], turnId = "turn_test"): BrowserActionRecord {
  return {
    schemaVersion: 1,
    actionId: "browser_action_test",
    callId: "call_browser_test",
    sessionId: asBrowserSessionId("browser_test"),
    turnId,
    tabId: asBrowserTabId("tab_test"),
    action: "click",
    reference: "@e1",
    documentId: asBrowserDocumentId("document_test"),
    actionHash: "a".repeat(64),
    status,
    ...(status === "running" ? { startedAt: "2026-09-15T00:00:00.000Z" } : {}),
    recordedAt: "2026-09-15T00:00:00.000Z",
  };
}

test("browser action records preserve identity and only allow forward transitions", () => {
  const prepared = record("prepared");
  assert.doesNotThrow(() => assertBrowserActionTransition(prepared, { ...prepared, status: "approved" }));
  assert.throws(
    () => assertBrowserActionTransition(prepared, { ...prepared, actionId: "browser_action_other", status: "approved" }),
    /identity cannot change/u,
  );
  assert.throws(
    () => assertBrowserActionTransition({ ...prepared, status: "completed" }, { ...prepared, status: "running" }),
    /cannot transition/u,
  );
});

test("restart marks a running browser action ambiguous without replaying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-records-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("inspect the page", "deterministic", "test-model");
    await turn.writeBrowserAction(record("running", turn.turnId));

    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "interrupted");

    const actions = await turn.readBrowserActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "ambiguous");
    assert.equal(actions[0]?.errorCode, "browser-ambiguous");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("recovery rejects a malformed browser action before classifying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-malformed-record-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("malformed browser action", "deterministic", "deterministic/browser");
    const base = record("prepared", turn.turnId);
    await turn.writeBrowserAction(base);
    await atomicWriteJson(path.join(turn.directory, "browser-actions", `${base.actionId}.json`), {
      ...base,
      status: "running",
      decision: "allow-once",
      startedAt: new Date().toISOString(),
      action: "not-a-browser-action",
    });

    await assert.rejects(
      () => session.recoverInterruptedTurns(),
      /invalid durable record/u,
    );
    assert.match(await readFile(path.join(turn.directory, "turn.json"), "utf8"), /"state":"submitting"/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

class TurnBrowserAdapter implements BrowserAdapter {
  actCalls = 0;
  dialogOnAct = false;
  timeoutOnAct = false;
  diagnosticOnAct = false;
  cancellationOnAct = false;
  private readonly tabs = new Map<string, BrowserTabInfo>();

  async startSession(): Promise<void> {}
  async closeSession(sessionId: ReturnType<typeof asBrowserSessionId>): Promise<void> { this.tabs.delete(sessionId); }
  async listTabs(sessionId: ReturnType<typeof asBrowserSessionId>): Promise<readonly BrowserTabInfo[]> {
    const tab = this.tabs.get(sessionId);
    return tab ? [tab] : [];
  }
  async open(sessionId: ReturnType<typeof asBrowserSessionId>, url: string): Promise<BrowserTabInfo> {
    const tab = { sessionId, tabId: asBrowserTabId("tab_turn"), documentId: asBrowserDocumentId("document_turn"), url, title: "Turn fixture" };
    this.tabs.set(sessionId, tab);
    return tab;
  }
  async snapshot(sessionId: ReturnType<typeof asBrowserSessionId>, tabId: ReturnType<typeof asBrowserTabId>): Promise<BrowserSnapshot> {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    return { ...tab, content: "Name input", references: [{ value: "@e1", documentId: tab.documentId }] };
  }
  async act(sessionId: ReturnType<typeof asBrowserSessionId>, tabId: ReturnType<typeof asBrowserTabId>, request: BrowserActionRequest): Promise<BrowserActionResult> {
    this.actCalls += 1;
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    assert.equal(request.kind, "type");
    if (this.dialogOnAct) {
      throw new BrowserError("browser-ambiguous", "A page dialog interrupted the browser action.", {
        dialog: { type: "prompt", message: "secret-value in page dialog" },
        dialogDecision: "dismiss",
      });
    }
    if (this.timeoutOnAct) {
      throw new BrowserError("browser-timeout", "The browser action exceeded its timeout.");
    }
    if (this.diagnosticOnAct) {
      const nativeError = new Error("native adapter detail secret-value");
      nativeError.name = "PlaywrightError";
      throw new BrowserError("adapter-failure", "The browser adapter failed.", { cause: nativeError });
    }
    if (this.cancellationOnAct) {
      throw new BrowserError("browser-cancelled", "The browser action was cancelled after it started.", { cancellationConfirmed: true });
    }
    return { sessionId, tab, summary: "type completed" };
  }

  async wait(sessionId: ReturnType<typeof asBrowserSessionId>, tabId: ReturnType<typeof asBrowserTabId>, request: { readonly milliseconds: number }) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    return { sessionId, tab, waitedMs: request.milliseconds };
  }

  async screenshot(sessionId: ReturnType<typeof asBrowserSessionId>, tabId: ReturnType<typeof asBrowserTabId>, target: { readonly path: string }) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    const bytes = pngFixture();
    await writeFile(target.path, bytes);
    return { byteSize: bytes.length, width: 1, height: 1 };
  }

  async upload(sessionId: ReturnType<typeof asBrowserSessionId>, tabId: ReturnType<typeof asBrowserTabId>, request: BrowserActionRequest) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    assert.ok(request.sourcePath);
    return { sessionId, tab, summary: "upload completed" };
  }

  async download(_sessionId: ReturnType<typeof asBrowserSessionId>, _tabId: ReturnType<typeof asBrowserTabId>, _request: BrowserActionRequest, target: { readonly path: string }) {
    const bytes = Buffer.from("download");
    await writeFile(target.path, bytes);
    return { byteSize: bytes.length, fileName: "fixture.txt" };
  }
}

class BrowserTurnProvider implements ModelProvider {
  readonly provider = "openrouter" as const;
  readonly model = "browser-record-test";
  private callCount = 0;

  constructor(
    private readonly toolName = "browser_type",
    private readonly argumentsJson = JSON.stringify({ ref: "@e1", text: "secret-value" }),
  ) {}

  async *stream(_request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (this.callCount++ === 0) {
      yield { type: "tool_call", call: { callId: `call_${this.toolName}`, name: this.toolName, argumentsJson: this.argumentsJson } };
      yield { type: "completed", usage: { outputTokens: 0, totalTokens: 0 } };
      return;
    }
    yield { type: "text", text: "Browser action recorded." };
    yield { type: "completed", usage: { outputTokens: 3, totalTokens: 3 } };
  }
}

test("browser tool turns persist lifecycle phases and redact configured secrets", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-turn-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-workspace-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-turn-artifacts-"));
  try {
    const session = await SessionStore.open(stateDir);
    const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
    const urlPolicy = new BrowserUrlPolicy({ allowedLocalHosts: ["127.0.0.1"], dnsLookup: async () => ["127.0.0.1"] });
    const adapter = new TurnBrowserAdapter();
    const manager = new BrowserSessionManager(adapter, {
      createSessionId: () => asBrowserSessionId("browser_turn"),
      artifactStore: new BrowserArtifactStore(artifactRoot, { maxScreenshotBytes: 1_024 }),
      urlPolicy,
    });
    const tools = new ToolRegistry(workspace, 32_000, undefined, {
      manager,
      maxOutputBytes: 32_000,
      redactionSecrets: ["secret-value"],
    });
    await tools.execute({ callId: "call_start", name: "browser_start", argumentsJson: "{}" });
    await tools.execute({ callId: "call_open", name: "browser_open", argumentsJson: JSON.stringify({ url: "http://127.0.0.1:4173/fixture" }) });
    await tools.execute({ callId: "call_snapshot", name: "browser_snapshot", argumentsJson: "{}" });

    const config = loadConfig({
      stateDir,
      workspaceRoot,
      provider: "openrouter",
      model: "browser-record-test",
      openRouterApiKey: "secret-value",
      timeoutMs: 10_000,
      firstEventTimeoutMs: 1_000,
      approvalTimeoutMs: 1_000,
      processMode: "deny",
    });
    const result = await runTurn({
      session,
      provider: new BrowserTurnProvider(),
      tools,
      config,
      userPrompt: "Fill the fixture field.",
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(result.status, "completed");

    const turnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", result.turnId);
    const actionDirectory = path.join(turnDirectory, "browser-actions");
    const actionFiles = await readdir(actionDirectory);
    assert.equal(actionFiles.length, 1);
    const actionText = await readFile(path.join(actionDirectory, actionFiles[0] ?? ""), "utf8");
    const action = JSON.parse(actionText) as BrowserActionRecord;
    assert.equal(action.status, "completed");
    assert.equal(action.text, "[REDACTED]");
    assert.equal(action.approvalTimeoutMs, 1_000);
    assert.doesNotMatch(actionText, /secret-value/u);

    const events = await readFile(path.join(turnDirectory, "events.jsonl"), "utf8");
    assert.match(events, /BrowserPrepared/u);
    assert.match(events, /BrowserApprovalDecided/u);
    assert.match(events, /BrowserStarted/u);
    assert.match(events, /BrowserCompleted/u);
    assert.doesNotMatch(events, /secret-value/u);

    const screenshotResult = await runTurn({
      session,
      provider: new BrowserTurnProvider("browser_screenshot", "{}"),
      tools,
      config,
      userPrompt: "Capture the fixture.",
    });
    assert.equal(screenshotResult.status, "completed");
    const screenshotTurnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", screenshotResult.turnId);
    const screenshotEvents = await readFile(path.join(screenshotTurnDirectory, "events.jsonl"), "utf8");
    assert.match(screenshotEvents, /BrowserArtifactCreated/u);
    assert.match(screenshotEvents, /"mimeType":"image\/png"/u);
    assert.match(screenshotEvents, /"byteSize":33/u);
    assert.match(screenshotEvents, /"height":1/u);
    assert.match(screenshotEvents, /"width":1/u);
    assert.doesNotMatch(screenshotEvents, /test-png/u);
    const artifactEvidenceFiles = await readdir(path.join(screenshotTurnDirectory, "browser-artifacts"));
    assert.equal(artifactEvidenceFiles.length, 1);
    const artifactEvidence = JSON.parse(await readFile(path.join(screenshotTurnDirectory, "browser-artifacts", artifactEvidenceFiles[0]!), "utf8")) as { artifactId: string; turnId: string; kind: string };
    const artifactEvent = screenshotEvents.trim().split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload?: { artifactId?: string } })
      .find((event) => event.type === "BrowserArtifactCreated");
    assert.equal(artifactEvidence.artifactId, artifactEvent?.payload?.artifactId);
    assert.equal(artifactEvidence.turnId, screenshotResult.turnId);
    assert.equal(artifactEvidence.kind, "screenshot");

    adapter.dialogOnAct = true;
    await tools.execute({ callId: "call_snapshot_again", name: "browser_snapshot", argumentsJson: "{}" });
    const dialogResult = await runTurn({
      session,
      provider: new BrowserTurnProvider(),
      tools,
      config,
      userPrompt: "Fill the fixture field again.",
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(dialogResult.status, "completed");
    const dialogTurnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", dialogResult.turnId);
    const dialogActionFiles = await readdir(path.join(dialogTurnDirectory, "browser-actions"));
    const dialogActionText = await readFile(path.join(dialogTurnDirectory, "browser-actions", dialogActionFiles[0] ?? ""), "utf8");
    const dialogAction = JSON.parse(dialogActionText) as BrowserActionRecord;
    assert.equal(dialogAction.status, "ambiguous");
    assert.equal(dialogAction.dialog?.type, "prompt");
    assert.equal(dialogAction.dialog?.message, "[REDACTED] in page dialog");
    assert.equal(dialogAction.dialogDecision, "dismiss");
    assert.doesNotMatch(dialogActionText, /secret-value/u);

    adapter.dialogOnAct = false;
    adapter.timeoutOnAct = true;
    await tools.execute({ callId: "call_snapshot_timeout", name: "browser_snapshot", argumentsJson: "{}" });
    const timeoutResult = await runTurn({
      session,
      provider: new BrowserTurnProvider(),
      tools,
      config,
      userPrompt: "Fill the fixture field after a timeout.",
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(timeoutResult.status, "completed");
    const timeoutTurnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", timeoutResult.turnId);
    const timeoutActionFiles = await readdir(path.join(timeoutTurnDirectory, "browser-actions"));
    const timeoutActionText = await readFile(path.join(timeoutTurnDirectory, "browser-actions", timeoutActionFiles[0] ?? ""), "utf8");
    const timeoutAction = JSON.parse(timeoutActionText) as BrowserActionRecord;
    assert.equal(timeoutAction.status, "ambiguous");
    assert.equal(timeoutAction.errorCode, "browser-ambiguous");
    assert.equal(timeoutAction.underlyingErrorCode, "browser-timeout");

    adapter.timeoutOnAct = false;
    adapter.diagnosticOnAct = true;
    await tools.execute({ callId: "call_snapshot_diagnostic", name: "browser_snapshot", argumentsJson: "{}" });
    const diagnosticResult = await runTurn({
      session,
      provider: new BrowserTurnProvider(),
      tools,
      config,
      userPrompt: "Fill the fixture field after an adapter failure.",
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(diagnosticResult.status, "completed");
    const diagnosticTurnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", diagnosticResult.turnId);
    const diagnosticActionFiles = await readdir(path.join(diagnosticTurnDirectory, "browser-actions"));
    const diagnosticActionText = await readFile(path.join(diagnosticTurnDirectory, "browser-actions", diagnosticActionFiles[0] ?? ""), "utf8");
    const diagnosticAction = JSON.parse(diagnosticActionText) as BrowserActionRecord;
    assert.equal(diagnosticAction.diagnostic?.name, "PlaywrightError");
    assert.equal(diagnosticAction.diagnostic?.message, "native adapter detail [REDACTED]");
    assert.doesNotMatch(diagnosticActionText, /secret-value/u);

    adapter.diagnosticOnAct = false;
    adapter.cancellationOnAct = true;
    await tools.execute({ callId: "call_snapshot_cancellation", name: "browser_snapshot", argumentsJson: "{}" });
    const cancellationResult = await runTurn({
      session,
      provider: new BrowserTurnProvider(),
      tools,
      config,
      userPrompt: "Fill the fixture field after cancellation.",
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(cancellationResult.status, "completed");
    const cancellationTurnDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", cancellationResult.turnId);
    const cancellationActionFiles = await readdir(path.join(cancellationTurnDirectory, "browser-actions"));
    const cancellationActionText = await readFile(path.join(cancellationTurnDirectory, "browser-actions", cancellationActionFiles[0] ?? ""), "utf8");
    const cancellationAction = JSON.parse(cancellationActionText) as BrowserActionRecord;
    assert.equal(cancellationAction.status, "ambiguous");
    assert.equal(cancellationAction.errorCode, "browser-ambiguous");
    assert.equal(cancellationAction.underlyingErrorCode, "browser-cancelled");
    assert.equal(cancellationAction.cancellationConfirmed, true);
    assert.match(await readFile(path.join(cancellationTurnDirectory, "events.jsonl"), "utf8"), /"cancellationConfirmed":true/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("diagnostic interruption after a browser action does not repeat it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-interruption-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-interruption-workspace-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-interruption-artifacts-"));
  try {
    const session = await SessionStore.open(stateDir);
    const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
    const urlPolicy = new BrowserUrlPolicy({ allowedLocalHosts: ["127.0.0.1"], dnsLookup: async () => ["127.0.0.1"] });
    const adapter = new TurnBrowserAdapter();
    const manager = new BrowserSessionManager(adapter, {
      createSessionId: () => asBrowserSessionId("browser_interruption"),
      artifactStore: new BrowserArtifactStore(artifactRoot, { maxScreenshotBytes: 1_024 }),
      urlPolicy,
    });
    const tools = new ToolRegistry(workspace, 32_000, undefined, {
      manager,
      maxOutputBytes: 32_000,
      redactionSecrets: ["secret-value"],
    });
    await tools.execute({ callId: "call_start", name: "browser_start", argumentsJson: "{}" });
    await tools.execute({ callId: "call_open", name: "browser_open", argumentsJson: JSON.stringify({ url: "http://127.0.0.1:4173/fixture" }) });
    await tools.execute({ callId: "call_snapshot", name: "browser_snapshot", argumentsJson: "{}" });

    const config = loadConfig({
      stateDir,
      workspaceRoot,
      provider: "openrouter",
      model: "browser-interruption-test",
      openRouterApiKey: "secret-value",
      timeoutMs: 10_000,
      firstEventTimeoutMs: 1_000,
      approvalTimeoutMs: 1_000,
      processMode: "deny",
    });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new BrowserTurnProvider(),
        tools,
        config,
        userPrompt: "Fill the fixture field once.",
        approveBrowser: async () => ({ decision: "allow-once" }),
        diagnostics: {
          onCheckpoint: (checkpoint) => {
            if (checkpoint.type === "after-tool-execution" && checkpoint.toolName === "browser_type") {
              throw new RuntimeInterruptionError("stopped after browser action");
            }
          },
        },
      }),
      /stopped after browser action/u,
    );
    assert.equal(adapter.actCalls, 1);

    const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "browser-actions");
    const actionFiles = await readdir(actionDirectory);
    assert.equal(actionFiles.length, 1);
    const action = JSON.parse(await readFile(path.join(actionDirectory, actionFiles[0]!), "utf8")) as { status: string };
    assert.equal(action.status, "completed");
    const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    assert.equal(events.filter((event) => event.type === "BrowserCompleted").length, 1);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("browser completion acknowledgement loss preserves an uncertain outcome without replay", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-ack-boundary-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-ack-boundary-workspace-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-ack-boundary-artifacts-"));
  try {
    let actionWrites = 0;
    const session = await SessionStore.open(stateDir, undefined, {
      writeHooks: {
        afterWrite: (operation, filePath) => {
          if (operation === "replace-json" && filePath.includes(`${path.sep}browser-actions${path.sep}`) && actionWrites++ === 3) {
            throw new RuntimeInterruptionError("stopped after browser completion evidence became durable");
          }
        },
      },
    });
    const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
    const urlPolicy = new BrowserUrlPolicy({ allowedLocalHosts: ["127.0.0.1"], dnsLookup: async () => ["127.0.0.1"] });
    const adapter = new TurnBrowserAdapter();
    const manager = new BrowserSessionManager(adapter, {
      createSessionId: () => asBrowserSessionId("browser_ack_boundary"),
      artifactStore: new BrowserArtifactStore(artifactRoot, { maxScreenshotBytes: 1_024 }),
      urlPolicy,
    });
    const tools = new ToolRegistry(workspace, 32_000, undefined, {
      manager,
      maxOutputBytes: 32_000,
      redactionSecrets: ["secret-value"],
    });
    await tools.execute({ callId: "call_start", name: "browser_start", argumentsJson: "{}" });
    await tools.execute({ callId: "call_open", name: "browser_open", argumentsJson: JSON.stringify({ url: "http://127.0.0.1:4173/fixture" }) });
    await tools.execute({ callId: "call_snapshot", name: "browser_snapshot", argumentsJson: "{}" });

    const config = loadConfig({
      stateDir,
      workspaceRoot,
      provider: "openrouter",
      model: "browser-ack-boundary-test",
      openRouterApiKey: "secret-value",
      timeoutMs: 10_000,
      firstEventTimeoutMs: 1_000,
      approvalTimeoutMs: 1_000,
      processMode: "deny",
    });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new BrowserTurnProvider(),
        tools,
        config,
        userPrompt: "Perform the browser action once.",
        approveBrowser: async () => ({ decision: "allow-once" }),
      }),
      /stopped after browser completion evidence became durable/u,
    );
    assert.equal(adapter.actCalls, 1);

    const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "browser-actions");
    const actionFiles = await readdir(actionDirectory);
    assert.equal(actionFiles.length, 1);
    const action = JSON.parse(await readFile(path.join(actionDirectory, actionFiles[0]!), "utf8")) as { status: string };
    assert.equal(action.status, "completed");
    const events = (await readFile(path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload?: { recovered?: boolean } });
    assert.equal(events.filter((event) => event.type === "BrowserCompleted").length, 1);
    assert.equal(events.find((event) => event.type === "BrowserCompleted")?.payload?.recovered, true);
    assert.equal(events.at(-1)?.type, "TurnInterrupted");
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
    assert.equal(adapter.actCalls, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("browser interruption before the durable start record does not launch the action", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-pre-start-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-pre-start-workspace-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-pre-start-artifacts-"));
  try {
    let actionWrites = 0;
    const session = await SessionStore.open(stateDir, undefined, {
      writeHooks: {
        beforeWrite: (operation, filePath) => {
          if (operation === "replace-json" && filePath.includes(`${path.sep}browser-actions${path.sep}`) && actionWrites++ === 2) {
            throw new RuntimeInterruptionError("stopped before browser start evidence");
          }
        },
      },
    });
    const workspace = await Workspace.open(workspaceRoot, { maxFileBytes: 4_096, maxDirectoryEntries: 20 });
    const urlPolicy = new BrowserUrlPolicy({ allowedLocalHosts: ["127.0.0.1"], dnsLookup: async () => ["127.0.0.1"] });
    const adapter = new TurnBrowserAdapter();
    const manager = new BrowserSessionManager(adapter, {
      createSessionId: () => asBrowserSessionId("browser_pre_start"),
      artifactStore: new BrowserArtifactStore(artifactRoot, { maxScreenshotBytes: 1_024 }),
      urlPolicy,
    });
    const tools = new ToolRegistry(workspace, 32_000, undefined, {
      manager,
      maxOutputBytes: 32_000,
      redactionSecrets: ["secret-value"],
    });
    await tools.execute({ callId: "call_start", name: "browser_start", argumentsJson: "{}" });
    await tools.execute({ callId: "call_open", name: "browser_open", argumentsJson: JSON.stringify({ url: "http://127.0.0.1:4173/fixture" }) });
    await tools.execute({ callId: "call_snapshot", name: "browser_snapshot", argumentsJson: "{}" });

    const config = loadConfig({
      stateDir,
      workspaceRoot,
      provider: "openrouter",
      model: "browser-pre-start-test",
      openRouterApiKey: "secret-value",
      timeoutMs: 10_000,
      firstEventTimeoutMs: 1_000,
      approvalTimeoutMs: 1_000,
      processMode: "deny",
    });
    await assert.rejects(
      () => runTurn({
        session,
        provider: new BrowserTurnProvider(),
        tools,
        config,
        userPrompt: "Perform the browser action only after it is durably prepared.",
        approveBrowser: async () => ({ decision: "allow-once" }),
      }),
      /stopped before browser start evidence/u,
    );
    assert.equal(adapter.actCalls, 0);

    const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const turnId = (await session.readTranscript())[0]!.turnId;
    const actionDirectory = path.join(stateDir, "sessions", session.metadata.sessionId, "turns", turnId, "browser-actions");
    const actionFiles = await readdir(actionDirectory);
    assert.equal(actionFiles.length, 1);
    const action = JSON.parse(await readFile(path.join(actionDirectory, actionFiles[0]!), "utf8")) as { status: string; errorCode?: string };
    assert.equal(action.status, "failed");
    assert.equal(action.errorCode, "browser-approval-unavailable");
    assert.equal(adapter.actCalls, 0);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
