import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BrowserSessionManager } from "../src/browser/session.js";
import { BrowserUrlPolicy } from "../src/browser/policy.js";
import { BrowserError } from "../src/browser/errors.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId, type BrowserAdapter, type BrowserTabInfo } from "../src/browser/contracts.js";
import { loadConfig } from "../src/config/config.js";
import { SessionStore } from "../src/persistence/session-store.js";
import { runTurn } from "../src/runtime/turn.js";
import type { ModelRequest, ModelStreamEvent } from "../src/runtime/contracts.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { Workspace } from "../src/workspace/workspace.js";

test("the normal browser loop resumes an uncertain click, fills supplied fields, and asks for a missing value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-browser-continuation-"));
  const stateDir = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  const sessionId = asBrowserSessionId("browser_form_continuation");
  const tabId = asBrowserTabId("tab_form_continuation");
  let tab: BrowserTabInfo | undefined;
  let onForm = false;
  let firstName = "";
  let email = "";
  let acceptedTerms = false;
  let companyType = "";
  let companyMenuOpen = false;
  let preferredDate = "";
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
        content: `[@first] input First name value=${firstName || "empty"}\n[@last] input Last name required value=empty\n[@email] input Email value=${email || "empty"}\n[@terms] checkbox Agree to terms checked=${acceptedTerms}\n[@company] button Company type value=${companyType || "empty"} expanded=${companyMenuOpen}${companyMenuOpen ? "\n[@product] option Product\n[@services] option Services" : ""}\n[@date] input Preferred date value=${preferredDate || "empty"}\n[@submit] button Submit`,
        references: [
          { value: "@first", documentId: tab.documentId, role: "input", name: "First name", actions: ["type"], currentValue: firstName },
          { value: "@last", documentId: tab.documentId, role: "input", name: "Last name", actions: ["type"] },
          { value: "@email", documentId: tab.documentId, role: "input", name: "Email", actions: ["type"], currentValue: email },
          { value: "@terms", documentId: tab.documentId, role: "checkbox", name: "Agree to terms", actions: ["click"], states: { checked: acceptedTerms } },
          { value: "@company", documentId: tab.documentId, role: "button", name: "Company type", actions: ["click"], currentValue: companyType, states: { expanded: companyMenuOpen } },
          ...(companyMenuOpen ? [
            { value: "@product", documentId: tab.documentId, role: "option", name: "Product", actions: ["click"], states: { selected: false } },
            { value: "@services", documentId: tab.documentId, role: "option", name: "Services", actions: ["click"], states: { selected: false } },
          ] : []),
          { value: "@date", documentId: tab.documentId, role: "input", type: "date", name: "Preferred date", actions: ["type"], currentValue: preferredDate },
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
      else if (request.kind === "click" && request.reference?.value === "@terms") acceptedTerms = !acceptedTerms;
      else if (request.kind === "click" && request.reference?.value === "@company") companyMenuOpen = !companyMenuOpen;
      else if (request.kind === "click" && request.reference?.value === "@product") {
        companyType = "Product";
        companyMenuOpen = false;
      }
      else if (request.kind === "type" && request.reference?.value === "@date") preferredDate = request.text ?? "";
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

  const prompt = "Open https://example.com, follow the Early access link, and fill First name with Ada, Email with ada@example.test, agree to the terms, choose Product for Company type, and set Preferred date to 2026-10-12. Do not submit the form.";
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
        assert.match(request.messages[0]?.content ?? "", /When the user only asks to open or navigate to a page, confirm the destination briefly; do not summarize the page unless they ask/u);
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
        assert.match(prior?.content ?? "", /checkbox Agree to terms checked=false/u);
        assert.match(prior?.content ?? "", /button Company type/u);
        assert.match(prior?.content ?? "", /Preferred date/u);
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
        yield { type: "tool_call", call: { callId: "form_snapshot_email", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 8) {
        assert.match(prior?.content ?? "", /First name value=Ada/u);
        toolSequence.push("browser_click");
        yield { type: "tool_call", call: { callId: "form_accept_terms", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@terms" }) } };
      } else if (round === 9) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_terms", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 10) {
        assert.match(prior?.content ?? "", /checkbox Agree to terms checked=true/u);
        toolSequence.push("browser_click");
        yield { type: "tool_call", call: { callId: "form_open_company", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@company" }) } };
      } else if (round === 11) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_company", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 12) {
        assert.match(prior?.content ?? "", /button Company type value=empty expanded=true/u);
        assert.match(prior?.content ?? "", /\[@product\] option Product/u);
        toolSequence.push("browser_click");
        yield { type: "tool_call", call: { callId: "form_choose_product", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@product" }) } };
      } else if (round === 13) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_company_selected", name: "browser_snapshot", argumentsJson: "{}" } };
      } else if (round === 14) {
        assert.match(prior?.content ?? "", /Company type value=Product expanded=false/u);
        toolSequence.push("browser_type");
        yield { type: "tool_call", call: { callId: "form_type_date", name: "browser_type", argumentsJson: JSON.stringify({ ref: "@date", text: "2026-10-12" }) } };
      } else if (round === 15) {
        toolSequence.push("browser_snapshot");
        yield { type: "tool_call", call: { callId: "form_snapshot_final", name: "browser_snapshot", argumentsJson: "{}" } };
      } else {
        assert.equal(round, 16);
        assert.match(prior?.content ?? "", /First name value=Ada/u);
        assert.match(prior?.content ?? "", /Email value=ada@example\.test/u);
        assert.match(prior?.content ?? "", /Last name required value=empty/u);
        assert.match(prior?.content ?? "", /checkbox Agree to terms checked=true/u);
        assert.match(prior?.content ?? "", /Company type value=Product/u);
        assert.match(prior?.content ?? "", /Preferred date value=2026-10-12/u);
        yield { type: "text", text: "I filled in the first name and email, accepted the terms, chose Product, and set the date. The form also requires a last name; what should I enter? I have not submitted it." };
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

    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.match(result.assistantText ?? "", /what should I enter\?/u);
    assert.deepEqual(toolSequence, ["browser_open", "browser_click", "browser_snapshot", "browser_type", "browser_snapshot", "browser_type", "browser_snapshot", "browser_click", "browser_snapshot", "browser_click", "browser_snapshot", "browser_click", "browser_snapshot", "browser_type", "browser_snapshot"]);
    assert.deepEqual(openedUrls, ["https://example.com/"], "the loop must not reopen a reached page or launch search");
    assert.deepEqual(dispatched, [
      { kind: "click", ref: "@early" },
      { kind: "type", ref: "@first", text: "Ada" },
      { kind: "type", ref: "@email", text: "ada@example.test" },
      { kind: "click", ref: "@terms" },
      { kind: "click", ref: "@company" },
      { kind: "click", ref: "@product" },
      { kind: "type", ref: "@date", text: "2026-10-12" },
    ]);
    assert.equal(firstName, "Ada");
    assert.equal(email, "ada@example.test");
    assert.equal(acceptedTerms, true);
    assert.equal(companyType, "Product");
    assert.equal(preferredDate, "2026-10-12");
    assert.equal(requests.length, 16, "the form requires more than eight rounds and leaves a final user-facing response round");
  } finally {
    await manager.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("a cross-origin link can complete from fresh evidence while its click stays durably ambiguous", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lina-browser-origin-handoff-"));
  const stateDir = path.join(root, "state");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  const tabs = new Map<string, BrowserTabInfo>();
  const scopes = new Map<string, readonly string[]>();
  const startedScopes: Array<{ readonly sessionId: string; readonly origins: readonly string[] }> = [];
  const closedSessions: string[] = [];
  const clickSessions: string[] = [];
  const opened: Array<{ readonly sessionId: string; readonly url: string }> = [];
  const reboundTabIds: string[] = [];
  let nextSession = 0;
  let nextTab = 0;
  const adapter: BrowserAdapter = {
    async startSession(request) {
      const origins = request.allowedOrigins ?? [];
      scopes.set(request.sessionId, origins);
      startedScopes.push({ sessionId: request.sessionId, origins });
    },
    async closeSession(sessionId) { closedSessions.push(sessionId); },
    async listTabs(sessionId) {
      const tab = tabs.get(sessionId);
      if (!tab) return [];
      if (!scopes.get(sessionId)?.includes(new URL(tab.url).origin)) {
        const rebound = { ...tab, tabId: asBrowserTabId("tab_origin_rebound"), active: true };
        tabs.set(sessionId, rebound);
        reboundTabIds.push(rebound.tabId);
        return [rebound];
      }
      return [{ ...tab, active: true }];
    },
    async open(sessionId, url) {
      const isDestination = new URL(url).origin === "https://www.iana.org";
      const tab: BrowserTabInfo = {
        sessionId,
        tabId: asBrowserTabId(`tab_origin_${++nextTab}`),
        documentId: asBrowserDocumentId(isDestination ? "document_iana" : "document_example"),
        url,
        title: isDestination ? "Example Domains" : "Example Domain",
        active: true,
      };
      tabs.set(sessionId, tab);
      opened.push({ sessionId, url });
      return tab;
    },
    async snapshot(sessionId, tabId) {
      const tab = tabs.get(sessionId);
      assert.ok(tab);
      assert.equal(tab.tabId, tabId);
      if (!scopes.get(sessionId)?.includes(new URL(tab.url).origin)) {
        throw new BrowserError(
          "adapter-failure",
          "The live browser origin is outside the capability manifest (authorization_host_failed).",
          { cuaCode: "authorization_host_failed" },
        );
      }
      const isDestination = new URL(tab.url).origin === "https://www.iana.org";
      return {
        ...tab,
        content: isDestination ? "heading Example Domains" : "[@learn] link Learn more",
        headings: isDestination ? ["Example Domains"] : [],
        references: isDestination ? [] : [{
          value: "@learn",
          documentId: tab.documentId,
          role: "link",
          name: "Learn more",
          actions: ["click"],
        }],
      };
    },
    async act(sessionId, tabId, request) {
      const tab = tabs.get(sessionId);
      assert.ok(tab);
      assert.equal(tab.tabId, tabId);
      assert.equal(request.kind, "click");
      assert.equal(request.reference?.value, "@learn");
      clickSessions.push(sessionId);
      const redirected = {
        ...tab,
        url: "https://www.iana.org/help/example-domains",
        title: "Example Domains",
        documentId: asBrowserDocumentId("document_after_redirect"),
      };
      tabs.set(sessionId, redirected);
      throw new BrowserError(
        "adapter-failure",
        "confirmation provider failed: the live browser origin is outside the capability manifest (authorization_host_failed).",
        { cuaCode: "authorization_host_failed" },
      );
    },
    async wait(sessionId, tabId, request) {
      const tab = tabs.get(sessionId);
      assert.ok(tab);
      assert.equal(tab.tabId, tabId);
      return { sessionId, tab, waitedMs: request.milliseconds };
    },
    async screenshot() { throw new Error("Screenshots are not used in this test."); },
    async upload() { throw new Error("Uploads are not used in this test."); },
    async download() { throw new Error("Downloads are not used in this test."); },
  };

  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId(`browser_origin_handoff_${++nextSession}`),
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

  const prompt = "Open https://example.org, follow the visible Learn more link, and tell me the destination page title.";
  const decisions: string[] = [];
  const provider = {
    provider: "deterministic" as const,
    model: "deterministic/browser-origin-handoff",
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      assert.equal(request.toolChoice, undefined, "the conversation model must choose browser operations");
      assert.ok(request.messages.some((message) => message.role === "user" && message.content === prompt));
      const prior = request.messages.at(-1);
      switch (decisions.length) {
        case 0:
          decisions.push("open-source");
          yield { type: "tool_call", call: { callId: "open-source", name: "browser_open", argumentsJson: JSON.stringify({ url: "https://example.org" }) } };
          break;
        case 1:
          assert.match(prior?.content ?? "", /Learn more/u);
          decisions.push("click-link");
          yield { type: "tool_call", call: { callId: "click-link", name: "browser_click", argumentsJson: JSON.stringify({ ref: "@learn" }) } };
          break;
        case 2:
          assert.match(prior?.content ?? "", /authorization_host_failed/u);
          assert.match(prior?.content ?? "", /Do not repeat it/u);
          decisions.push("observe-current-page");
          yield { type: "tool_call", call: { callId: "observe-current-page", name: "browser_snapshot", argumentsJson: "{}" } };
          break;
        case 3:
          assert.match(prior?.content ?? "", /origin_handoff_required/u);
          assert.match(prior?.content ?? "", /https:\/\/www\.iana\.org\/help\/example-domains/u);
          decisions.push("open-observed-destination");
          yield { type: "tool_call", call: { callId: "open-observed-destination", name: "browser_open", argumentsJson: JSON.stringify({ url: "https://www.iana.org/help/example-domains" }) } };
          break;
        default:
          assert.match(prior?.content ?? "", /heading Example Domains/u);
          decisions.push("answer-from-destination");
          yield { type: "text", text: "The destination page title is Example Domains." };
      }
      yield { type: "completed" };
    },
  };

  try {
    const session = await SessionStore.open(stateDir);
    const result = await runTurn({
      session,
      tools,
      provider,
      config,
      userPrompt: prompt,
      approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
      approveBrowser: async () => ({ decision: "allow-once" }),
    });

    assert.equal(result.status, "completed");
    assert.match(result.assistantText ?? "", /Example Domains/u);
    assert.deepEqual(decisions, ["open-source", "click-link", "observe-current-page", "open-observed-destination", "answer-from-destination"]);
    assert.equal(clickSessions.length, 1, "the uncertain link click must never be replayed");
    assert.deepEqual(reboundTabIds, ["tab_origin_rebound"], "origin recovery must use the exact tab identity returned by a fresh bind");
    assert.equal(opened.length, 2, "only the initial URL and model-selected, freshly observed destination are opened");
    assert.notEqual(opened[0]?.sessionId, opened[1]?.sessionId, "cross-origin continuation must use a fresh Cua session");
    assert.ok(closedSessions.includes(opened[0]!.sessionId), "the old origin-scoped Cua session is closed before handoff");
    assert.ok(startedScopes[0]?.origins.includes("https://example.org"));
    assert.ok(startedScopes[1]?.origins.includes("https://example.org"));
    assert.ok(startedScopes[1]?.origins.includes("https://www.iana.org"));

    const turnDirectory = path.join(stateDir, "sessions", result.sessionId, "turns", result.turnId);
    const actionDirectory = path.join(turnDirectory, "browser-actions");
    const [actionFile] = await readdir(actionDirectory);
    assert.ok(actionFile);
    const action = JSON.parse(await readFile(path.join(actionDirectory, actionFile), "utf8")) as { action: string; status: string; errorCode?: string; cuaCode?: string; underlyingErrorCode?: string };
    assert.equal(action.action, "click");
    assert.equal(action.status, "ambiguous");
    assert.equal(action.errorCode, "browser-ambiguous");
    assert.equal(action.cuaCode, "authorization_host_failed");
    assert.equal(action.underlyingErrorCode, "adapter-failure");
    const events = (await readFile(path.join(turnDirectory, "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });
    assert.ok(events.some((event) => event.type === "BrowserCompleted" && event.payload.status === "ambiguous"));
    assert.ok(events.some((event) => event.type === "TurnCompleted"));
  } finally {
    await manager.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
