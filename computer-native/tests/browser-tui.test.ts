import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { TerminalUi } from "../src/cli/tui.js";
import type { ChatApplication } from "../src/runtime/application.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId, type BrowserApprovalDecision, type BrowserApprovalRequest, type BrowserToolEvent } from "../src/browser/index.js";
import { asSessionId, asTurnId, type TurnEvent, type TurnResult } from "../src/runtime/contracts.js";

test("interactive TUI renders and approves the exact browser action", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const input = new PassThrough();
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "secret-value";
  const request: BrowserApprovalRequest = {
    actionId: "browser_action_ui",
    callId: "browser_call_ui",
    sessionId: asBrowserSessionId("browser_ui"),
    tabId: asBrowserTabId("tab_ui"),
    action: "type",
    reference: "@e1",
    documentId: asBrowserDocumentId("document_ui"),
    text: "secret-value",
    actionHash: "b".repeat(64),
    warning: "This browser interaction may submit data or change remote state.",
  };
  const application = {
    sessionId: "session_ui",
    modelLabel: "openrouter/test",
    providerLabel: "openrouter/test",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["browser_type"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
      onText?: (text: string) => void,
      onEvent?: (event: TurnEvent) => void,
      _approveMutation?: unknown,
      _onMutation?: unknown,
      _approveProcess?: unknown,
      _onProcess?: unknown,
      approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>,
      onBrowser?: (event: BrowserToolEvent) => void,
    ) => {
      onEvent?.({ type: "waiting", round: 1 });
      onBrowser?.({ type: "prepared", request });
      const decision = await approveBrowser?.(request);
      assert.equal(decision?.decision, "allow-once");
      onBrowser?.({ type: "approval_decided", request, decision: decision ?? { decision: "unavailable", reason: "missing" } });
      onBrowser?.({ type: "started", request });
      onBrowser?.({ type: "completed", request, ok: true, summary: "type completed" });
      const dialogRequest: BrowserApprovalRequest = {
        ...request,
        actionId: "browser_dialog_ui",
        callId: "browser_call_ui:dialog",
        action: "dialog",
        reference: "dialog",
        dialog: { type: "confirm", message: "fixture page dialog" },
      };
      onBrowser?.({ type: "prepared", request: dialogRequest });
      const dialogDecision = await approveBrowser?.(dialogRequest);
      assert.equal(dialogDecision?.decision, "allow-once");
      assert.equal(dialogDecision?.dialogDecision, "dismiss");
      onBrowser?.({ type: "approval_decided", request: dialogRequest, decision: dialogDecision ?? { decision: "unavailable", reason: "missing" } });
      onBrowser?.({ type: "started", request: dialogRequest });
      onBrowser?.({ type: "completed", request: dialogRequest, ok: true, summary: "Page dialog dismissed.", dialog: dialogRequest.dialog, dialogDecision: "dismiss" });
      const promptRequest: BrowserApprovalRequest = {
        ...dialogRequest,
        actionId: "browser_dialog_prompt_ui",
        callId: "browser_call_ui:prompt",
        dialog: { type: "prompt", message: "secret-value in fixture page prompt" },
      };
      onBrowser?.({ type: "prepared", request: promptRequest });
      const promptDecision = await approveBrowser?.(promptRequest);
      assert.equal(promptDecision?.decision, "allow-once");
      assert.equal(promptDecision?.dialogDecision, "accept");
      assert.equal(promptDecision?.promptText, "typed value");
      onBrowser?.({ type: "approval_decided", request: promptRequest, decision: promptDecision ?? { decision: "unavailable", reason: "missing" } });
      onBrowser?.({ type: "started", request: promptRequest });
      onBrowser?.({ type: "completed", request: promptRequest, ok: true, summary: "Page prompt accepted.", dialog: promptRequest.dialog, dialogDecision: "accept" });
      onBrowser?.({ type: "completed", request, ok: false, errorCode: "browser-ambiguous", summary: "A page dialog interrupted the browser action.", dialog: { type: "alert", message: "fixture dialog message" } });
      onText?.("done");
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return {
        schemaVersion: 1 as const,
        sessionId: asSessionId("session_ui"),
        turnId: asTurnId("turn_ui"),
        status: "completed" as const,
        provider: "openrouter" as const,
        model: "openrouter/test",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  try {
    const running = new TerminalUi(application, output, true).runInteractive(input);
    setTimeout(() => input.write("fill the field\n"), 10);
    setTimeout(() => input.write("y\n"), 30);
    setTimeout(() => input.write("d\n"), 50);
    setTimeout(() => input.write("a:typed value\n"), 70);
    setTimeout(() => input.end(), 130);
    await running;
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Proposed browser interaction/u);
  assert.match(rendered, /document\s+document_ui/u);
  assert.match(rendered, /text\s+\[REDACTED\]/u);
  assert.doesNotMatch(rendered, /secret-value/u);
  assert.match(rendered, /browser · approved · type/u);
  assert.match(rendered, /browser · type running · @e1/u);
  assert.match(rendered, /browser · type · type completed/u);
  assert.match(rendered, /dialog\s+confirm:\s+fixture page dialog/u);
  assert.match(rendered, /Resolve page dialog/u);
  assert.match(rendered, /dialog dismissed/u);
  assert.match(rendered, /Resolve page prompt/u);
  assert.match(rendered, /dialog accepted/u);
  assert.match(rendered, /dialog alert: fixture dialog message/u);
});

test("interactive TUI renders cancellation confirmed for an active browser action", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const request: BrowserApprovalRequest = {
    actionId: "browser_action_cancel_ui",
    callId: "browser_call_cancel_ui",
    sessionId: asBrowserSessionId("browser_cancel_ui"),
    tabId: asBrowserTabId("tab_cancel_ui"),
    action: "click",
    reference: "@e1",
    documentId: asBrowserDocumentId("document_cancel_ui"),
    actionHash: "c".repeat(64),
    warning: "This browser interaction may submit data or change remote state.",
  };
  const application = {
    sessionId: "session_cancel_ui",
    modelLabel: "openrouter/test",
    providerLabel: "openrouter/test",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["browser_click"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      signal: AbortSignal | undefined,
      _onText: ((text: string) => void) | undefined,
      onEvent: ((event: TurnEvent) => void) | undefined,
      _approveMutation: unknown,
      _onMutation: unknown,
      _approveProcess: unknown,
      _onProcess: unknown,
      _approveBrowser: unknown,
      onBrowser: ((event: BrowserToolEvent) => void) | undefined,
    ): Promise<TurnResult> => {
      onEvent?.({ type: "waiting", round: 1 });
      onBrowser?.({ type: "prepared", request });
      onBrowser?.({ type: "started", request });
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      onBrowser?.({
        type: "completed",
        request,
        ok: false,
        errorCode: "browser-ambiguous",
        summary: "The browser action was cancelled after it started.",
        cancellationConfirmed: true,
      });
      onEvent?.({ type: "status", status: "cancelled", round: 0 });
      return {
        schemaVersion: 1,
        sessionId: asSessionId("session_cancel_ui"),
        turnId: asTurnId("turn_cancel_ui"),
        status: "cancelled",
        provider: "openrouter",
        model: "openrouter/test",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        error: { code: "cancelled", message: "The active turn was cancelled." },
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  const ui = new TerminalUi(application, output, true);
  const running = ui.runTurn("cancel the active browser action");
  setTimeout(() => assert.equal(ui.cancelActiveTurn(), true), 20);
  await running;

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /Cancelling current turn/u);
  assert.match(rendered, /browser · click running · @e1/u);
  assert.match(rendered, /cancellation confirmed/u);
  assert.match(rendered, /cancelled/u);
});
