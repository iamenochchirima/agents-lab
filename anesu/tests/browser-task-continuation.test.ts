import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BrowserSessionManager } from "../src/browser/session.js";
import { BrowserUrlPolicy } from "../src/browser/policy.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId, type BrowserAdapter, type BrowserTabInfo } from "../src/browser/contracts.js";
import { loadConfig } from "../src/config/config.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import type { ModelRequest, ModelStreamEvent } from "../src/runtime/contracts.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";

test("the normal browser loop resumes an uncertain click, fills supplied fields, and asks for a missing value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-browser-continuation-"));
  const stateDir = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  const sessionId = asBrowserSessionId("browser_form_continuation");
  const tabId = asBrowserTabId("tab_form_continuation");
  let tab: BrowserTabInfo | undefined;
  let onForm = false;
  let firstName = "";
  let email = "";
  const openedUrls: string[] = [];
  const dispatched: Array<{ readonly kind: string; readonly ref?: string; readonly text?: string }> = [];
  const adapter: BrowserAdapter = {
    async startSession(request) { assert.equal(request.sessionId, sessionId); },
    async closeSession() {},
    async listTabs() { return tab ? [tab] : []; },
    async open(activeSessionId, url) {
      openedUrls.push(url);
      tab = {
        sessionId: activeSessionId,
        tabId,
        documentId: asBrowserDocumentId("document_early_access_landing"),
        url,
        title: "Early Access",
      };
      return tab;
    },
    async snapshot(activeSessionId, activeTabId) {
      assert.equal(activeSessionId, sessionId);
      assert.equal(activeTabId, tabId);
      assert.ok(tab);
      if (!onForm) {
        return {
          ...tab,
          content: "[@early] link Early access",
          references: [{ value: "@early", documentId: tab.documentId, role: "link", name: "Early access", actions: ["click"] }],
        };
      }
      return {
        ...tab,
        content: `[@first] input First name value=${firstName || "empty"}\n[@last] input Last name required value=empty\n[@email] input Email value=${email || "empty"}\n[@submit] button Submit`,
        references: [
          { value: "@first", documentId: tab.documentId, role: "input", name: "First name", actions: ["type"], currentValue: firstName },
          { value: "@last", documentId: tab.documentId, role: "input", name: "Last name", actions: ["type"] },
          { value: "@email", documentId: tab.documentId, role: "input", name: "Email", actions: ["type"], currentValue: email },
          { value: "@submit", documentId: tab.documentId, role: "button", name: "Submit", actions: ["click"] },
        ],
      };
    },
    async act(activeSessionId, activeTabId, request) {
      assert.equal(activeSessionId, sessionId);
      assert.equal(activeTabId, tabId);
      assert.ok(tab);
      dispatched.push({ kind: request.kind, ...(request.reference ? { ref: request.reference.value } : {}), ...(request.text === undefined ? {} : { text: request.text }) });
      if (request.kind === "click" && request.reference?.value === "@early") {
        onForm = true;
        tab = {
          ...tab,
          documentId: asBrowserDocumentId("document_early_access_form"),
          url: "https://example.com/early-access",
          title: "Early Access Form",
        };
        return { sessionId: activeSessionId, tab, summary: "Click dispatched.", effect: "unverifiable", route: "dom_event", delivery: { mode: "background" } };
      }
      if (request.kind === "type" && request.reference?.value === "@first") firstName = request.text ?? "";
      else if (request.kind === "type" && request.reference?.value === "@email") email = request.text ?? "";
      else throw new Error(`Unexpected browser action: ${request.kind} ${request.reference?.value ?? ""}`);
      return { sessionId: activeSessionId, tab, summary: `Filled ${request.reference?.name ?? "field"}.` };
    },
    async wait(activeSessionId, activeTabId, request) {
      assert.equal(activeSessionId, sessionId);
      assert.equal(activeTabId, tabId);
      assert.ok(tab);
      return { sessionId: activeSessionId, tab, waitedMs: request.milliseconds };
    },
    async screenshot() { throw new Error("Screenshots are not used in this test."); },
    async upload() { throw new Error("Uploads are not used in this test."); },
    async download() { throw new Error("Downloads are not used in this test."); },
  };

  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => sessionId,
    urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }),
  });
  const browserOptions = { manager, maxOutputBytes: 32_000, inputRoute: "trusted" as const, maxWaitMs: 1 };
  const config = loadConfig({
    stateDir,
    workspaceRoot,
    computerEnabled: true,
    computerEnvironment: "browser",
    computerSurface: "browser",
    computerStrategy: "typesafe",
    computerTypesafeModel: "jev-latest",
    typeSafeApiKey: "typesafe-test-key",
  }, {});
  const workspace = await Workspace.open(workspaceRoot, {
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
    browserAllowedOrigins: [],
    browserInputRoute: "trusted",
    maxActions: config.computerMaxActions,
    taskDeadlineMs: config.computerTaskDurationMs,
    browser: browserOptions,
  });

  const prompt = "Open https://example.com, follow the Early access link, and fill First name with Ada and Email with ada@example.test. Do not submit the form.";
  const requests: ModelRequest[] = [];
  const toolSequence: string[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/browser-form-continuation",
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      requests.push(request);
      assert.equal(request.toolChoice, undefined, "the harness must leave browser decisions to the conversation model");
      assert.ok(request.messages.some((message) => message.role === "user" && message.content === prompt), "the original user goal must remain in every model round");
      const prior = request.messages.at(-1);
      const round = requests.length;
      if (round === 1) {
        assert.equal(prior?.role, "user");
        toolSequence.push("browser_open");
        yield { type: "tool_call", call: { callId: "form_open", name: "browser_open", argumentsJson: JSON.stringify({ url: "https://example.com" }) } };
      } else if (round === 2) {
        assert.equal(prior?.role, "tool");
        assert.match(prior.content ?? "", /Early access/u);
        toolSequence.push("browser_click");
        yield { type: "tool_call", call: { callId: "form_click", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@early" }) } };
      } else if (round === 3) {
        assert.equal(prior?.role, "tool");
        assert.match(prior.content ?? "", /effect 'unverifiable'/u);
        assert.match(prior.content ?? "", /continue the user's original task/u);
        assert.match(prior.content ?? "", /do not submit unless asked/u);
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_after_click", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 4) {
        assert.match(prior?.content ?? "", /First name/u);
        assert.match(prior?.content ?? "", /Last name required/u);
        assert.match(prior?.content ?? "", /Email/u);
        toolSequence.push("browser_type");
        yield { type: "tool_call", call: { callId: "form_type_first", name: "browser_type", argumentsJson: JSON.stringify({ ref: "@first", text: "Ada" }) } };
      } else if (round === 5) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_first", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 6) {
        assert.match(prior?.content ?? "", /First name value=Ada/u);
        toolSequence.push("browser_type");
        yield { type: "tool_call", call: { callId: "form_type_email", name: "browser_type", argumentsJson: JSON.stringify({ ref: "@email", text: "ada@example.test" }) } };
      } else if (round === 7) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_final", name: "browser_snapshot", argumentsJson: "{}" } };
      } else {
        assert.equal(round, 8);
        assert.match(prior?.content ?? "", /First name value=Ada/u);
        assert.match(prior?.content ?? "", /Email value=ada@example\.test/u);
        assert.match(prior?.content ?? "", /Last name required value=empty/u);
        yield { type: "text", text: "I filled in the first name and email. The form also requires a last name; what should I enter? I have not submitted it." };
      }
      yield { type: "completed" };
    },
  };

  try {
    const result = await runTurn({
      session: await SessionStore.open(stateDir),
      tools,
      provider,
      config,
      userPrompt: prompt,
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
      approveBrowser: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.status, "completed");
    assert.match(result.assistantText ?? "", /what should I enter\?/u);
    assert.deepEqual(toolSequence, ["browser_open", "browser_click", "browser_snapshot", "browser_type", "browser_snapshot", "browser_type", "browser_snapshot"]);
    assert.deepEqual(openedUrls, ["https://example.com/"], "the loop must not reopen a reached page or launch search");
    assert.deepEqual(dispatched, [
      { kind: "click", ref: "@early" },
      { kind: "type", ref: "@first", text: "Ada" },
      { kind: "type", ref: "@email", text: "ada@example.test" },
    ]);
    assert.equal(firstName, "Ada");
    assert.equal(email, "ada@example.test");
    assert.equal(requests.length, 8, "the tool loop leaves a final user-facing response round");
  } finally {
    await manager.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
