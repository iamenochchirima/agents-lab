import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { TerminalUi } from "../src/cli/tui.js";
import { loadConfig } from "../src/config/config.js";
import { CuaBrowserAdapter } from "../src/browser/cua-adapter.js";
import { BrowserSessionManager } from "../src/browser/session.js";
import { BrowserUrlPolicy } from "../src/browser/policy.js";
import type { ChatApplication } from "../src/runtime/application.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId, type BrowserAdapter, type BrowserApprovalDecision, type BrowserApprovalRequest, type BrowserSnapshot, type BrowserTabInfo, type BrowserToolEvent } from "../src/browser/index.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import type { ModelRequest, ModelStreamEvent, TurnEvent, TurnResult } from "../src/runtime/contracts.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";
import { asSessionId, asTurnId } from "../src/runtime/contracts.js";

test("interactive TUI lets the conversation model follow a current Cua ref and continue from fresh results", { timeout: 5_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-browser-tui-model-loop-"));
  const chunks: string[] = [];
  const input = new PassThrough();
  let taskApprovalAnswered = false;
  let followUpPromptSent = false;
  let cancellationPromptSent = false;
  let postCancelPromptSent = false;
  let restartPromptSent = false;
  let quitSent = false;
  let waitingForCancellation = false;
  let cancelledWaits = 0;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
      const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
      if (!taskApprovalAnswered && rendered.includes("Approve bounded computer task")) {
        taskApprovalAnswered = true;
        queueMicrotask(() => input.write("t\n"));
      }
      if (!followUpPromptSent && rendered.includes('The details page heading is "More details".')) {
        followUpPromptSent = true;
        queueMicrotask(() => input.write("In the current browser, read the page again and tell me its heading.\n"));
      }
      if (!postCancelPromptSent && rendered.includes("■ cancelled")) {
        postCancelPromptSent = true;
        queueMicrotask(() => input.write("After cancelling, read the current page heading.\n"));
      }
      if (!cancellationPromptSent && rendered.includes('The current page heading is "More details".')) {
        cancellationPromptSent = true;
        queueMicrotask(() => input.write("Wait on the current page, then report its heading.\n"));
      }
      if (!quitSent && (rendered.includes('The page is still open and its heading is "More details".') || /\bfailed\b/u.test(rendered))) {
        quitSent = true;
        queueMicrotask(() => input.write("/quit\n"));
      }
    },
  });
  const tabId = asBrowserTabId("tab_model_loop");
  let documentId = asBrowserDocumentId("document_model_loop");
  let clicked = false;
  let browserSessionsStarted = 0;
  let browserSessionsClosed = 0;
  let tab: BrowserTabInfo | undefined;
  let activeSessionId: string | undefined;
  let sessionAllowedOrigins: readonly string[] | undefined;
  const adapter: BrowserAdapter = {
    async startSession(request) { browserSessionsStarted += 1; sessionAllowedOrigins = request.allowedOrigins; activeSessionId = request.sessionId; },
    async closeSession() { browserSessionsClosed += 1; tab = undefined; activeSessionId = undefined; },
    async listTabs() { return tab ? [tab] : []; },
    async open(activeSessionId, url) {
      tab = { sessionId: activeSessionId, tabId, documentId, url, title: "Example Domain" };
      return tab;
    },
    async snapshot(activeSessionId, activeTabId): Promise<BrowserSnapshot> {
      assert.equal(activeSessionId, thisSessionId());
      assert.equal(activeTabId, tabId);
      assert.ok(tab);
      return clicked
        ? { ...tab, content: "heading More details", headings: ["More details"], references: [] }
        : {
            ...tab,
            content: "heading Example Domain\n[@e1] link Details",
            headings: ["Example Domain"],
            references: [{ value: "@e1", documentId, role: "link", name: "Details", actions: ["click"] }],
          };
    },
    async act(activeSessionId, activeTabId, request) {
      assert.equal(activeSessionId, thisSessionId());
      assert.equal(activeTabId, tabId);
      assert.equal(request.kind, "click");
      assert.equal(request.reference?.value, "@e1");
      assert.ok(tab);
      clicked = true;
      documentId = asBrowserDocumentId("document_details");
      tab = { ...tab, documentId, url: "https://example.com/details", title: "More details" };
      return { sessionId: activeSessionId as ReturnType<typeof asBrowserSessionId>, tab, summary: "Clicked Details." };
    },
    async wait(activeSessionId, activeTabId, request, signal) {
      assert.equal(activeSessionId, thisSessionId());
      assert.equal(activeTabId, tabId);
      assert.ok(tab);
      if (request.milliseconds === 5_000) {
        waitingForCancellation = true;
        return await new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            cancelledWaits += 1;
            reject(new Error("Browser wait cancelled by the active turn."));
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
          queueMicrotask(() => input.write("\u0003"));
        });
      }
      return { sessionId: activeSessionId as ReturnType<typeof asBrowserSessionId>, tab, waitedMs: request.milliseconds };
    },
    async screenshot() { throw new Error("Screenshots are not used in this semantic browser test."); },
    async upload() { throw new Error("Uploads are not used in this semantic browser test."); },
    async download() { throw new Error("Downloads are not used in this semantic browser test."); },
  };
  function thisSessionId(): string | undefined { return activeSessionId; }
  const urlPolicy = new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] });
  const manager = new BrowserSessionManager(adapter, { urlPolicy });
  const browserOptions = { manager, maxOutputBytes: 32_000, inputRoute: "trusted" as const };
  const requests: ModelRequest[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/browser-model-loop",
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push(request);
      assert.equal(request.toolChoice, undefined, "the runtime must not force a browser/computer route");
      const names = request.tools?.map((tool) => tool.name) ?? [];
      assert.ok(names.includes("browser_start"), "the actual typed Cua browser tools should be model-visible");
      assert.ok(names.includes("browser_open"));
      assert.ok(names.includes("browser_snapshot"));
      const priorToolResult = request.messages.at(-1);
      if (requests.length === 1) {
        yield { type: "tool_call", call: { callId: "start_browser", name: "browser_start", argumentsJson: "{}" } };
      } else if (requests.length === 2) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "start_browser");
        assert.match(priorToolResult?.content ?? "", /"status":"active"/u);
        yield { type: "tool_call", call: { callId: "open_page", name: "browser_open", argumentsJson: JSON.stringify({ url: "https://example.com" }) } };
      } else if (requests.length === 3) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "open_page");
        assert.match(priorToolResult?.content ?? "", /Example Domain/u);
        yield { type: "tool_call", call: { callId: "read_page", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (requests.length === 4) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "read_page");
        assert.match(priorToolResult?.content ?? "", /heading Example Domain/u);
        assert.match(priorToolResult?.content ?? "", /@e1/u);
        yield { type: "tool_call", call: { callId: "follow_details", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@e1" }) } };
      } else if (requests.length === 5) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "follow_details");
        assert.match(priorToolResult?.content ?? "", /Clicked Details/u);
        yield { type: "tool_call", call: { callId: "read_details", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (requests.length === 6) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "read_details");
        assert.match(priorToolResult?.content ?? "", /heading More details/u);
        yield { type: "text", text: 'The details page heading is "More details".' };
      } else if (requests.length === 7) {
        assert.equal(priorToolResult?.role, "user");
        assert.match(priorToolResult?.content ?? "", /In the current browser/u);
        yield { type: "tool_call", call: { callId: "read_followup_page", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (requests.length === 8) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "read_followup_page");
        assert.match(priorToolResult?.content ?? "", /heading More details/u);
        yield { type: "text", text: 'The current page heading is "More details".' };
      } else if (requests.length === 9) {
        assert.equal(priorToolResult?.role, "user");
        assert.match(priorToolResult?.content ?? "", /Wait on the current page/u);
        yield { type: "tool_call", call: { callId: "wait_for_page", name: "browser_wait", argumentsJson: JSON.stringify({ milliseconds: 5_000 }) } };
      } else if (requests.length === 10) {
        assert.equal(priorToolResult?.role, "user");
        assert.match(priorToolResult?.content ?? "", /After cancelling/u);
        yield { type: "tool_call", call: { callId: "read_after_cancel", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (requests.length === 11) {
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "read_after_cancel");
        assert.match(priorToolResult?.content ?? "", /heading More details/u);
        yield { type: "text", text: 'The page is still open and its heading is "More details".' };
      } else if (requests.length === 12) {
        assert.equal(priorToolResult?.role, "user");
        assert.match(priorToolResult?.content ?? "", /After restarting, read the previous page/u);
        assert.ok(request.messages.some((message) => message.role === "assistant" && message.content?.includes("The page is still open")), "the durable conversation transcript should be restored");
        yield { type: "tool_call", call: { callId: "read_after_restart", name: "browser_snapshot", argumentsJson: "{}" } };
      } else {
        assert.equal(requests.length, 13);
        assert.equal(priorToolResult?.role, "tool");
        assert.equal(priorToolResult?.toolCallId, "read_after_restart");
        assert.match(priorToolResult?.content ?? "", /No browser session is active; call browser_start first/u);
        yield { type: "text", text: "The old browser is not attached after restart. The transcript is restored; start the browser again to continue." };
      }
    },
  };

  try {
    const config = loadConfig({ stateDir: path.join(root, "state"), workspaceRoot: root, browserEnabled: true, computerEnabled: true, computerEnvironment: "browser", computerSurface: "browser", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-key", computerTypesafeModel: "jev-latest" }, {});
    const session = await SessionStore.open(config.stateDir);
    const workspace = await Workspace.open(root, {
      maxFileBytes: config.maxFileBytes,
      maxDirectoryEntries: config.maxDirectoryEntries,
      maxTreeEntries: config.maxTreeEntries,
      maxTreeBytes: config.maxTreeBytes,
      maxTreeDepth: config.maxTreeDepth,
    });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, browserOptions, undefined, undefined, {
      environment: "browser",
      surface: "browser",
      strategy: "typesafe",
      typeSafeApiKey: "typesafe-test-key",
      typeSafeModel: "jev-latest",
      maxActions: config.computerMaxActions,
      taskDeadlineMs: config.computerTaskDurationMs,
      browserInputRoute: "trusted",
      browserAllowedOrigins: [],
      browser: browserOptions,
    });
    const application = {
      sessionId: session.metadata.sessionId,
      modelLabel: provider.model,
      providerLabel: provider.model,
      providerName: "deterministic" as const,
      workspaceRoot: root,
      evidenceDirectory: session.sessionDirectory,
      toolNames: tools.definitions.map((definition) => definition.name),
      computer: { enabled: true, environment: "browser", surface: "browser", strategy: "typesafe", model: "jev-latest", isolated: true },
      readContextSnapshot: async () => undefined,
      recoverInterruptedTurns: async () => [],
      readTranscript: async () => [
        { schemaVersion: 1 as const, messageId: "prior_user_message", sessionId: session.metadata.sessionId, turnId: asTurnId("prior_turn"), role: "user" as const, content: "Earlier request from this conversation.", createdAt: "2026-09-23T10:00:00.000Z" },
        { schemaVersion: 1 as const, messageId: "prior_assistant_message", sessionId: session.metadata.sessionId, turnId: asTurnId("prior_turn"), role: "assistant" as const, content: "Older assistant reply remains readable.", createdAt: "2026-09-23T10:00:01.000Z" },
      ],
      runTurn: async (
        userPrompt: string,
        signal: AbortSignal | undefined,
        onText?: (text: string) => void,
        onEvent?: (event: TurnEvent) => void,
        approveMutation?: Parameters<ChatApplication["runTurn"]>[4],
        onMutation?: Parameters<ChatApplication["runTurn"]>[5],
        approveProcess?: Parameters<ChatApplication["runTurn"]>[6],
        onProcess?: Parameters<ChatApplication["runTurn"]>[7],
        approveBrowser?: Parameters<ChatApplication["runTurn"]>[8],
        onBrowser?: Parameters<ChatApplication["runTurn"]>[9],
        approveMemory?: Parameters<ChatApplication["runTurn"]>[10],
        onMemory?: Parameters<ChatApplication["runTurn"]>[11],
        onMemorySearch?: Parameters<ChatApplication["runTurn"]>[12],
        onComputer?: Parameters<ChatApplication["runTurn"]>[13],
        approveComputer?: Parameters<ChatApplication["runTurn"]>[14],
        onComputerApproval?: Parameters<ChatApplication["runTurn"]>[15],
        approveComputerTask?: Parameters<ChatApplication["runTurn"]>[16],
      ) => runTurn({ session, provider, tools, config, userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch, onComputer, approveComputer, onComputerApproval, approveComputerTask }),
      close: async () => manager.closeAll(),
    } as unknown as ChatApplication;

    const ui = new TerminalUi(application, output, true);
    const running = ui.runInteractive(input);
    setTimeout(() => input.write("Open https://example.com, follow the Details link, and tell me the new page heading.\n"), 10);
    await running;
    await ui.close();

    const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
    assert.equal(requests.length, 11, "browser state remains available after a cancelled turn");
    assert.ok(requests.every((request) => !request.tools?.some((tool) => tool.name === "computer")), "browser-only configuration must not expose the nested computer planner");
    assert.deepEqual(sessionAllowedOrigins, ["https://example.com"]);
    assert.equal(clicked, true, "the conversation model's selected current Cua reference should be acted on");
    assert.equal(browserSessionsStarted, 1, "a follow-up browser task must reuse the conversation browser session");
    assert.equal(cancellationPromptSent, true, "the cancelled turn must be followed by the continuity prompt");
    assert.equal(postCancelPromptSent, true, "the TUI must accept a new prompt after cancellation");
    assert.equal(waitingForCancellation, true, "Ctrl+C must arrive while the browser adapter is waiting");
    assert.equal(cancelledWaits, 1, "the active browser wait must receive cancellation");
    assert.equal(browserSessionsClosed, 1, "exiting the conversation closes its owned browser session");
    assert.match(rendered, /browser · task-grant · click/u, "the approved task grant should cover in-task navigation");
    assert.match(rendered, /grant scope\s+this bounded task only/u);
    assert.match(rendered, /Choice \[t\] approve this task · \[d\] deny · \[v\] details/u);
    assert.match(rendered, /The details page heading is "More details"\./u);
    assert.match(rendered, /The current page heading is "More details"\./u);
    assert.match(rendered, /The page is still open and its heading is "More details"\./u);
    assert.match(rendered, /■ cancelled/u, "the cancelled turn should be reported before continuing");
    assert.ok(rendered.indexOf("Earlier request from this conversation.") < rendered.indexOf("Older assistant reply remains readable."), "restored conversation messages remain chronological and role-labelled");
    assert.ok(rendered.indexOf("Older assistant reply remains readable.") < rendered.indexOf("turn starting model run"), "the transcript is visible before browser activity streams");
    assert.ok(rendered.indexOf("Open https://example.com, follow the Details link, and tell me the new page heading.") < rendered.indexOf("browser_click · started"), "the active user request remains in terminal scrollback while browser activity is emitted");
    assert.ok(rendered.indexOf("turn starting model run") < rendered.indexOf("browser_click · started"), "tool activity follows the conversation rather than replacing it");

    // A fresh application and browser manager model a process restart: restore the
    // durable conversation, but do not carry the previous runtime's browser handles.
    const restartedSession = await SessionStore.open(config.stateDir, session.metadata.sessionId);
    const restartedManager = new BrowserSessionManager(adapter, { urlPolicy });
    const restartedBrowserOptions = { ...browserOptions, manager: restartedManager };
    const restartedTools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, restartedBrowserOptions, undefined, undefined, {
      environment: "browser",
      surface: "browser",
      strategy: "typesafe",
      typeSafeApiKey: "typesafe-test-key",
      typeSafeModel: "jev-latest",
      maxActions: config.computerMaxActions,
      taskDeadlineMs: config.computerTaskDurationMs,
      browserInputRoute: "trusted",
      browserAllowedOrigins: [],
      browser: restartedBrowserOptions,
    });
    const restartedApplication = {
      ...application,
      sessionId: restartedSession.metadata.sessionId,
      evidenceDirectory: restartedSession.sessionDirectory,
      toolNames: restartedTools.definitions.map((definition) => definition.name),
      runTurn: async (
        userPrompt: string,
        signal: AbortSignal | undefined,
        onText?: (text: string) => void,
        onEvent?: (event: TurnEvent) => void,
        approveMutation?: Parameters<ChatApplication["runTurn"]>[4],
        onMutation?: Parameters<ChatApplication["runTurn"]>[5],
        approveProcess?: Parameters<ChatApplication["runTurn"]>[6],
        onProcess?: Parameters<ChatApplication["runTurn"]>[7],
        approveBrowser?: Parameters<ChatApplication["runTurn"]>[8],
        onBrowser?: Parameters<ChatApplication["runTurn"]>[9],
        approveMemory?: Parameters<ChatApplication["runTurn"]>[10],
        onMemory?: Parameters<ChatApplication["runTurn"]>[11],
        onMemorySearch?: Parameters<ChatApplication["runTurn"]>[12],
        onComputer?: Parameters<ChatApplication["runTurn"]>[13],
        approveComputer?: Parameters<ChatApplication["runTurn"]>[14],
        onComputerApproval?: Parameters<ChatApplication["runTurn"]>[15],
        approveComputerTask?: Parameters<ChatApplication["runTurn"]>[16],
      ) => runTurn({ session: restartedSession, provider, tools: restartedTools, config, userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch, onComputer, approveComputer, onComputerApproval, approveComputerTask }),
      close: async () => restartedManager.closeAll(),
    } as unknown as ChatApplication;
    const restartedInput = new PassThrough();
    const restartedChunks: string[] = [];
    const restartedOutput = new Writable({
      write(chunk, _encoding, callback) {
        restartedChunks.push(String(chunk));
        callback();
        const rendered = restartedChunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
        if (!restartPromptSent && (rendered.includes("The old browser is not attached after restart.") || /\bfailed\b/u.test(rendered))) {
          restartPromptSent = true;
          queueMicrotask(() => restartedInput.write("/quit\n"));
        }
      },
    });
    const restartedUi = new TerminalUi(restartedApplication, restartedOutput, true);
    const restartedRun = restartedUi.runInteractive(restartedInput);
    setTimeout(() => restartedInput.write("After restarting, read the previous page heading.\n"), 10);
    await restartedRun;
    await restartedUi.close();
    restartedInput.destroy();

    const restartedRendered = restartedChunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
    assert.equal(requests.length, 13, "the restarted model request should fail closed without the old browser page");
    assert.equal(browserSessionsStarted, 1, "reopening conversation history must not silently launch or attach a browser");
    assert.equal(browserSessionsClosed, 1, "the old browser was closed with its original application");
    assert.match(restartedRendered, /The old browser is not attached after restart\./u);
  } finally {
    input.destroy();
    await manager.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("interactive TUI reports denied Cua window discovery safely and sends no browser action", { timeout: 5_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-browser-tui-denied-window-"));
  const chunks: string[] = [];
  const input = new PassThrough();
  const calls: string[] = [];
  const windowInputs: unknown[] = [];
  let taskApproved = false;
  let approvalAnswered = false;
  let quitSent = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
      const rendered = chunks.join("");
      if (!approvalAnswered && rendered.includes("Choice [t] approve this task")) {
        approvalAnswered = true;
        queueMicrotask(() => input.write("t\n"));
      }
      if (approvalAnswered && rendered.includes("approved for this task")) taskApproved = true;
      if (taskApproved && !quitSent && rendered.includes("I couldn't start the isolated browser")) {
        quitSent = true;
        queueMicrotask(() => input.write("/quit\n"));
      }
    },
  });
  const schemas: Readonly<Record<string, readonly string[]>> = {
    browser_prepare: ["allow_launch", "profile", "session"],
    get_browser_state: ["continuation", "query", "scope_ref", "session", "snapshot_format"],
    browser_navigate: ["session", "tab_id", "target_id", "url"],
    browser_click: ["input_route", "ref", "session", "tab_id", "target_id"],
    browser_type: ["mode", "ref", "replace", "session", "tab_id", "target_id", "text"],
    browser_pointer: ["action", "destination_ref", "input_route", "ref", "session", "tab_id", "target_id"],
    browser_dialog: ["action", "dialog_id", "prompt_text", "session", "tab_id", "target_id"],
    browser_set_input_files: ["files", "ref", "session", "tab_id", "target_id"],
  };
  const browserToolNames = Object.keys(schemas);
  const driver = {
    listToolsJson: () => JSON.stringify({
      schema_version: "1",
      capability_version: "test",
      tools: browserToolNames.map((name) => ({
        name,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(schemas[name]!.map((field) => [field, { type: "string" }])),
          ...(name === "browser_navigate" ? { required: ["target_id", "tab_id", "url"] } : {}),
          ...(name === "browser_click" ? { required: ["target_id", "tab_id"] } : {}),
          ...(name === "browser_type" ? { required: ["target_id", "tab_id", "ref", "text"] } : {}),
          ...(name === "browser_pointer" ? { required: ["target_id", "tab_id", "action"] } : {}),
          ...(name === "browser_dialog" ? { required: ["target_id", "tab_id", "action"] } : {}),
          ...(name === "browser_set_input_files" ? { required: ["target_id", "tab_id", "ref", "files"] } : {}),
        },
      })),
    }),
    async startSession() { calls.push("startSession"); },
    async listWindows(value: unknown) {
      calls.push("listWindows");
      windowInputs.push(value);
      throw new Error("private host detail: window enumeration denied");
    },
    async callTool(name: string, _argumentsJson: string) {
      calls.push(name);
      const structuredJson = name === "health_report"
        ? JSON.stringify({
            schema_version: "1",
            platform: "linux",
            overall: "ok",
            checks: ["binary_version", "platform_supported", "session_active", "ax_capability", "screen_capture_capability"]
              .map((check) => ({ name: check, status: "pass" })),
          })
        : name === "browser_prepare"
          ? JSON.stringify({ status: "ok", prepared: true, action: "launched", prepared_pid: 7123, attachment: "driver_owned" })
          : JSON.stringify({ status: "refused", code: "unexpected_tool" });
      return { text: "fixture", structuredJson, isError: false, images: [], rawJson: structuredJson, degraded: false };
    },
    async endSession() { calls.push("endSession"); return { session: "browser-denied-test", active: false }; },
    async shutdown() { calls.push("shutdown"); },
  };

  try {
    const config = loadConfig({
      stateDir: path.join(root, "state"),
      workspaceRoot: root,
      browserEnabled: true,
      computerEnabled: true,
      computerEnvironment: "browser",
      computerSurface: "browser",
      computerStrategy: "typesafe",
      typeSafeApiKey: "typesafe-test-key",
      computerTypesafeModel: "jev-latest",
    }, {});
    const session = await SessionStore.open(config.stateDir);
    const workspace = await Workspace.open(root, {
      maxFileBytes: config.maxFileBytes,
      maxDirectoryEntries: config.maxDirectoryEntries,
      maxTreeEntries: config.maxTreeEntries,
      maxTreeBytes: config.maxTreeBytes,
      maxTreeDepth: config.maxTreeDepth,
    });
    const urlPolicy = new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] });
    const adapter = new CuaBrowserAdapter({ driver: driver as never, allowedOrigins: ["https://example.com"], urlPolicy });
    const manager = new BrowserSessionManager(adapter, { urlPolicy });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes, undefined, undefined, undefined, undefined, {
      environment: "browser",
      surface: "browser",
      strategy: "typesafe",
      typeSafeApiKey: "typesafe-test-key",
      typeSafeModel: "jev-latest",
      maxActions: config.computerMaxActions,
      taskDeadlineMs: config.computerTaskDurationMs,
      browserInputRoute: "trusted",
      browserAllowedOrigins: ["https://example.com"],
      typeSafePreflight: async () => ({ requestedModel: "jev-latest", resolvedModel: "jev-latest" }),
      browserPreflight: () => adapter.preflight(),
      browser: {
        manager,
        maxOutputBytes: config.maxToolOutputBytes,
        inputRoute: "trusted",
        runtimeEvidence: () => adapter.runtimeEvidence(),
      },
    });
    const provider = {
      provider: "deterministic" as const,
      model: "deterministic/tui-cua-denial",
      rounds: 0,
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
        assert.equal(request.toolChoice, undefined);
        this.rounds += 1;
        if (this.rounds === 1) {
          assert.ok(request.tools?.some((tool) => tool.name === "browser_start"));
          yield { type: "tool_call", call: { callId: "start_browser", name: "browser_start", argumentsJson: "{}" } };
          return;
        }
        assert.equal(this.rounds, 2);
        const toolResult = request.messages.at(-1);
        assert.equal(toolResult?.role, "tool");
        assert.equal(toolResult?.toolCallId, "start_browser");
        assert.match(toolResult?.content ?? "", /Cua could not prepare and bind the isolated browser/u);
        assert.doesNotMatch(toolResult?.content ?? "", /private host detail|window enumeration denied/u);
        yield { type: "text", text: "I couldn't start the isolated browser because Cua could not bind its window." };
      },
    };
    const application = {
      sessionId: session.metadata.sessionId,
      modelLabel: provider.model,
      providerLabel: provider.model,
      providerName: "deterministic" as const,
      workspaceRoot: root,
      evidenceDirectory: session.sessionDirectory,
      toolNames: tools.definitions.map((definition) => definition.name),
      computer: { enabled: true, environment: "browser", surface: "browser", strategy: "typesafe", model: "jev-latest", isolated: true },
      readContextSnapshot: async () => undefined,
      recoverInterruptedTurns: async () => [],
      readTranscript: async () => [],
      runTurn: async (
        userPrompt: string,
        signal: AbortSignal | undefined,
        onText?: (text: string) => void,
        onEvent?: (event: TurnEvent) => void,
        approveMutation?: Parameters<ChatApplication["runTurn"]>[4],
        onMutation?: Parameters<ChatApplication["runTurn"]>[5],
        approveProcess?: Parameters<ChatApplication["runTurn"]>[6],
        onProcess?: Parameters<ChatApplication["runTurn"]>[7],
        approveBrowser?: Parameters<ChatApplication["runTurn"]>[8],
        onBrowser?: Parameters<ChatApplication["runTurn"]>[9],
        approveMemory?: Parameters<ChatApplication["runTurn"]>[10],
        onMemory?: Parameters<ChatApplication["runTurn"]>[11],
        onMemorySearch?: Parameters<ChatApplication["runTurn"]>[12],
        onComputer?: Parameters<ChatApplication["runTurn"]>[13],
        approveComputer?: Parameters<ChatApplication["runTurn"]>[14],
        onComputerApproval?: Parameters<ChatApplication["runTurn"]>[15],
        approveComputerTask?: Parameters<ChatApplication["runTurn"]>[16],
      ) => runTurn({
        session,
        provider,
        tools,
        config,
        userPrompt,
        signal,
        onText,
        onEvent,
        approveMutation,
        onMutation,
        approveProcess,
        onProcess,
        approveBrowser,
        onBrowser,
        approveMemory,
        onMemory,
        onMemorySearch,
        onComputer,
        approveComputer,
        onComputerApproval,
        approveComputerTask,
      }),
      close: async () => undefined,
    } as unknown as ChatApplication;
    const running = new TerminalUi(application, output, true).runInteractive(input);
    setTimeout(() => input.write("Open https://example.com\n"), 10);
    await running;

    const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
    assert.equal(provider.rounds, 2, "the safe refusal should return to the model for a user-facing answer");
    assert.equal(approvalAnswered, true, "the TUI should present the bounded task approval");
    assert.equal(taskApproved, true, "the task grant should be approved through the TUI");
    assert.match(rendered, /Cua could not prepare and bind the isolated browser/u);
    assert.doesNotMatch(rendered, /private host detail|window enumeration denied/u);
    assert.equal(windowInputs.length, 1);
    assert.deepEqual(windowInputs[0], { pid: 7123, onScreenOnly: true });
    assert.ok(calls.includes("browser_prepare"));
    assert.ok(calls.includes("endSession"));
    assert.match(rendered, /I couldn't start the isolated browser/u);
    assert.equal(calls.includes("browser_navigate"), false);
    assert.equal(calls.includes("browser_click"), false);
    assert.equal(calls.includes("browser_type"), false);
  } finally {
    input.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

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
    targetRole: "searchbox",
    targetName: "Account search",
    origin: "https://example.org",
    approvalScope: "action",
    actionHash: "b".repeat(64),
    approvalTimeoutMs: 3_000,
    warning: "This browser interaction may submit data or change remote state.",
    taskId: "computer_task_ui",
    grantHash: "f".repeat(64),
    allowedTaskActions: ["click", "type"],
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
  assert.doesNotMatch(rendered, /@e1|document_ui/u);
  assert.match(rendered, /approval\s+3000ms from prompt/u);
  assert.match(rendered, /approval scope\s+this exact action/u);
  assert.match(rendered, /site\s+https:\/\/example\.org/u);
  assert.match(rendered, /Account search \(searchbox\)/u);
  assert.match(rendered, /Choice \[a\] approve once · \[d\] deny · \[v\] details/u);
  assert.doesNotMatch(rendered, /approve task/u);
  assert.match(rendered, /text\s+\[REDACTED\]/u);
  assert.doesNotMatch(rendered, /secret-value/u);
  assert.match(rendered, /browser · approval requested · type/u);
  assert.match(rendered, /browser · approved · type/u);
  assert.doesNotMatch(rendered, /browser · task grant covers · type/u);
  assert.doesNotMatch(rendered, /browser · task-grant · type/u);
  assert.match(rendered, /browser · type running · Account search \(searchbox\)/u);
  assert.match(rendered, /browser · type · type completed/u);
  assert.match(rendered, /dialog\s+confirm:\s+fixture page dialog/u);
  assert.match(rendered, /Resolve page dialog/u);
  assert.match(rendered, /dialog dismissed/u);
  assert.match(rendered, /Resolve page prompt/u);
  assert.match(rendered, /dialog accepted/u);
  assert.match(rendered, /dialog alert: fixture dialog message/u);
});

test("interactive TUI labels browser actions covered by the task grant", { timeout: 2_000 }, async () => {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const request: BrowserApprovalRequest = {
    actionId: "browser_action_task_grant_ui",
    callId: "browser_call_task_grant_ui",
    sessionId: asBrowserSessionId("browser_task_grant_ui"),
    tabId: asBrowserTabId("tab_task_grant_ui"),
    action: "click",
    reference: "@e1",
    documentId: asBrowserDocumentId("document_task_grant_ui"),
    targetRole: "link",
    targetName: "Details",
    origin: "https://example.org",
    approvalScope: "task",
    actionHash: "d".repeat(64),
    warning: "This browser interaction may submit data or change remote state.",
    taskId: "computer_task_ui",
    grantHash: "e".repeat(64),
    allowedTaskActions: ["click"],
  };
  const application = {
    sessionId: "session_task_grant_ui",
    modelLabel: "openrouter/test",
    providerLabel: "openrouter/test",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["browser_click"],
    recoverInterruptedTurns: async () => [],
    readTranscript: async () => [],
    runTurn: async (
      _message: string,
      _signal: AbortSignal | undefined,
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
      onBrowser?.({ type: "approval_decided", request, decision: { decision: "allow-once" } });
      onBrowser?.({ type: "started", request });
      onBrowser?.({ type: "completed", request, ok: true, summary: "click completed" });
      onEvent?.({ type: "status", status: "completed", round: 0 });
      return {
        schemaVersion: 1,
        sessionId: asSessionId("session_task_grant_ui"),
        turnId: asTurnId("turn_task_grant_ui"),
        status: "completed",
        provider: "openrouter",
        model: "openrouter/test",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        assistantText: "done",
      };
    },
    close: async () => undefined,
  } as unknown as ChatApplication;

  await new TerminalUi(application, output, true).runTurn("click the approved browser control");

  const rendered = chunks.join("").replace(/\u001b\[[0-9;]*m/gu, "");
  assert.match(rendered, /browser · task grant covers · click Details \(link\)/u);
  assert.match(rendered, /browser · task-grant · click/u);
  assert.doesNotMatch(rendered, /browser · approval requested · click/u);
  assert.doesNotMatch(rendered, /@e1/u);
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
    targetRole: "button",
    targetName: "Continue",
    origin: "https://example.org",
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
  assert.match(rendered, /browser · click running · Continue \(button\)/u);
  assert.doesNotMatch(rendered, /@e1/u);
  assert.match(rendered, /cancellation confirmed/u);
  assert.match(rendered, /cancelled/u);
});
