import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Writable } from "node:stream";
import { buildBrowserActionSpace, requestedBrowserKey, requestedBrowserScroll, requestedBrowserWait, type ComputerBrowserOperation } from "../src/computer/browser-strategy.js";
import { ComputerRunner, composeBrowserSelection, composeBrowserText, parseComputerSnapshot, requestedBrowserUrl, type ComputerBrowser, type ComputerContext } from "../src/computer/runner.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId } from "../src/browser/index.js";
import { loadConfig } from "../src/config/config.js";
import { formatComputerApprovalTarget, parseTuiCommand, TerminalUi } from "../src/cli/tui.js";
import type { ComputerApprovalRequest } from "../src/computer/contracts.js";

const documentId = "document_fixture";
const candidateId = `@e1:${documentId}`;
const actionId = `click:${candidateId}`;

function snapshot(success = false, includeInput = false, includeSelect = false): string {
  return JSON.stringify({
    tabId: "tab_fixture",
    documentId,
    title: "Anesu computer-use fixture",
    content: `${success ? "Computer success: safe result revealed." : "The safe result is hidden."}\n\n[@e1] button Reveal safe result${includeInput ? "\n[@e2] input text Search terms" : ""}${includeSelect ? `\n[@e${includeInput ? "3" : "2"}] select Country` : ""}`,
    references: [{ value: "@e1", documentId }, ...(includeInput ? [{ value: "@e2", documentId }] : []), ...(includeSelect ? [{ value: `@e${includeInput ? "3" : "2"}`, documentId }] : [])],
  });
}

class FixtureBrowser implements ComputerBrowser {
  clicked = 0;
  openedUrls: string[] = [];
  pressedKeys: string[] = [];
  selectedValues: string[] = [];
  waitedMs: number[] = [];
  scrolled: Array<{ readonly direction: string; readonly amount: number }> = [];
  includeInput = false;
  includeSelect = false;
  successAfterClicks = 1;
  blockSnapshotAfterClick = false;
  private successful = false;

  async execute(name: string, _callId: string, _args: Readonly<Record<string, unknown>>, context: ComputerContext) {
    switch (name) {
      case "browser_start": return { ok: true, content: "{}", summary: "started" };
      case "browser_open":
        this.openedUrls.push(String(_args.url ?? ""));
        return { ok: true, content: JSON.stringify({ tabId: "tab_fixture", documentId, title: "Anesu computer-use fixture", url: String(_args.url ?? "") }), summary: "opened" };
      case "browser_snapshot": {
        if (this.blockSnapshotAfterClick && this.clicked > 0) {
          return await new Promise<{ readonly ok: boolean; readonly content: string; readonly summary: string }>((_resolve, reject) => {
            const abort = () => reject(new DOMException("cancelled", "AbortError"));
            if (context.signal?.aborted) abort();
            else context.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        return { ok: true, content: snapshot(this.successful, this.includeInput, this.includeSelect), summary: "snapshot" };
      }
      case "browser_screenshot": return { ok: true, content: JSON.stringify({ path: this.screenshotPath }), summary: "screenshot" };
      case "browser_click": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture", callId: "fixture:click", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "click", reference: "@e1", documentId: asBrowserDocumentId(documentId), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.clicked += 1;
        this.successful = this.clicked >= this.successAfterClicks;
        return { ok: true, content: "{}", summary: "clicked" };
      }
      case "browser_press": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture_press", callId: "fixture:press", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "press", reference: String(_args.ref ?? ""), documentId: asBrowserDocumentId(documentId), key: String(_args.key ?? ""), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.pressedKeys.push(String(_args.key ?? ""));
        return { ok: true, content: "{}", summary: "pressed" };
      }
      case "browser_select": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture_select", callId: "fixture:select", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "select", reference: String(_args.ref ?? ""), documentId: asBrowserDocumentId(documentId), value: String(_args.value ?? ""), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.selectedValues.push(String(_args.value ?? ""));
        return { ok: true, content: "{}", summary: "selected" };
      }
      case "browser_wait":
        this.waitedMs.push(Number(_args.milliseconds ?? -1));
        return { ok: true, content: "{}", summary: "waited" };
      case "browser_scroll":
        {
          const decision = context.approveBrowser
            ? await context.approveBrowser({ actionId: "browser_action_fixture_scroll", callId: "fixture:scroll", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "scroll", reference: "document", documentId: asBrowserDocumentId(documentId), direction: String(_args.direction ?? "") as "up" | "down" | "left" | "right", amount: Number(_args.amount ?? -1), actionHash: "hash", warning: "fixture" }, context.signal)
            : { decision: "unavailable" as const, reason: "missing" };
          if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.scrolled.push({ direction: String(_args.direction ?? ""), amount: Number(_args.amount ?? -1) });
        return { ok: true, content: "{}", summary: "scrolled" };
        }
      case "browser_close": return { ok: true, content: "{}", summary: "closed" };
      default: return { ok: false, content: "unsupported", summary: "unsupported" };
    }
  }

  screenshotPath = "";
}

function allowBrowser() {
  return async () => ({ decision: "allow-once" as const });
}

test("computer configuration is opt-in and validates its selected provider key", () => {
  const defaults = loadConfig({}, {});
  assert.equal(defaults.computerEnabled, false);
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerStrategy: "typesafe" }, {}),
    /TYPESAFE_API_KEY/u,
  );
  const configured = loadConfig({ computerEnabled: true, computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, {});
  assert.equal(configured.computerEnabled, true);
  assert.equal(configured.computerStrategy, "typesafe");
  assert.equal(configured.computerMaxActions, 3);
  assert.throws(() => loadConfig({ computerMaxActions: 0 }, {}), /computer max actions must be a positive integer/u);
});

test("native computer configuration is explicit, isolated, and selects the requested perception path", () => {
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "traditional", computerTraditionalVision: true, openRouterApiKey: "openrouter-test-secret" }, { DISPLAY: ":99" }),
    /ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true/u,
  );
  const typesafe = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" });
  assert.equal(typesafe.computerStrategy, "typesafe");
  const compare = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "compare", computerTraditionalVision: true, openRouterApiKey: "openrouter-test-secret", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" });
  assert.equal(compare.computerStrategy, "compare");
  const configured = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "traditional", computerTraditionalVision: true, openRouterApiKey: "openrouter-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" });
  assert.equal(configured.computerEnvironment, "ubuntu-x11-cua");
  assert.equal(configured.computerCuaIsolatedDisplay, true);
  assert.equal(configured.computerTraditionalVision, true);
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerEnvironment: "browser", computerStrategy: "traditional", openRouterApiKey: "openrouter-test-secret" }, {}),
    /ANESU_COMPUTER_TRADITIONAL_VISION=true/u,
  );
  const sharedKey = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "traditional", computerTraditionalVision: true }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true", OPENROUTER_API_KEY: "shared-openrouter-key", ANESU_COMPUTER_OPENROUTER_API_KEY: "replace-me" });
  assert.equal(sharedKey.computerOpenRouterApiKey, "shared-openrouter-key");
});

test("computer snapshot parsing keeps document identity with candidates", () => {
  const observation = parseComputerSnapshot(snapshot());
  assert.equal(observation.candidates.length, 1);
  assert.deepEqual(observation.candidates[0], {
    candidateId,
    actionId,
    ref: "@e1",
    role: "button",
    label: "Reveal safe result",
    documentId,
    operation: "click",
  });
});

test("the structured browser action space keeps operations compatible with observed targets", () => {
  const observation = parseComputerSnapshot(JSON.stringify({
    tabId: "tab_actions",
    documentId: "document_actions",
    title: "Action fixture",
    content: [
      "Search the catalogue.",
      "",
      "[@e1] button Submit search",
      "[@e2] input text Search terms",
      "[@e3] select Country",
      "[@e4] input password Password",
    ].join("\n"),
    references: [
      { value: "@e1", documentId: "document_actions" },
      { value: "@e2", documentId: "document_actions" },
      { value: "@e3", documentId: "document_actions" },
      { value: "@e4", documentId: "document_actions" },
    ],
  }));

  const actions = buildBrowserActionSpace(observation);
  assert.deepEqual(actions.map((action) => action.operation), ["click", "type", "select", "blocked"] satisfies readonly ComputerBrowserOperation[]);
  assert.deepEqual(actions.map((action) => action.actionId), [
    "click:@e1:document_actions",
    "type:@e2:document_actions",
    "select:@e3:document_actions",
    "blocked:@e4:document_actions",
  ]);
  assert.equal(actions[1]?.ref, "@e2");
  assert.equal(actions[3]?.reason, "sensitive input or file control is not available to the computer strategy");
  for (const action of actions) {
    assert.equal("selector" in action, false);
    assert.equal("coordinates" in action, false);
  }
});

test("browser action space exposes a user-requested keypress beside text entry", () => {
  assert.equal(requestedBrowserKey("Type a query and press Enter."), "Enter");
  const observation = parseComputerSnapshot(JSON.stringify({
    tabId: "tab_key",
    documentId: "document_key",
    title: "Key fixture",
    content: "[@e2] input text Search terms",
    references: [{ value: "@e2", documentId: "document_key" }],
  }), "Open https://example.com and press Enter.");
  assert.deepEqual(observation.candidates.map((candidate) => candidate.operation), ["type", "press"]);
  assert.deepEqual(observation.candidates.map((candidate) => candidate.actionId), ["type:@e2:document_key", "press:@e2:document_key"]);
});

test("browser action space exposes only a bounded, user-requested wait", () => {
  assert.equal(requestedBrowserWait("Wait for 250 milliseconds."), 250);
  assert.equal(requestedBrowserWait("Wait 2 seconds for the page."), 2_000);
  assert.equal(requestedBrowserWait("Wait for 11 seconds."), undefined);
  const observation = parseComputerSnapshot(snapshot(), "Open https://example.com and wait 250 ms.");
  assert.deepEqual(observation.candidates.at(-1), {
    candidateId: "document:document_fixture",
    actionId: "wait:document:document_fixture",
    ref: "document",
    role: "document",
    label: "Wait 250ms for the current page to settle",
    documentId,
    operation: "wait",
    milliseconds: 250,
  });
});

test("browser action space exposes only a bounded, user-requested scroll", () => {
  assert.deepEqual(requestedBrowserScroll("Scroll down by 800 pixels."), { direction: "down", amount: 800 });
  assert.deepEqual(requestedBrowserScroll("Scroll left."), { direction: "left", amount: 600 });
  assert.equal(requestedBrowserScroll("Scroll down by 2,500 pixels."), undefined);
  const observation = parseComputerSnapshot(snapshot(), "Open https://example.com and scroll down 800 pixels.");
  assert.deepEqual(observation.candidates.at(-1), {
    candidateId: "document:document_fixture",
    actionId: "scroll:document:document_fixture",
    ref: "document",
    role: "document",
    label: "Scroll down 800px in the current page",
    documentId,
    operation: "scroll",
    direction: "down",
    amount: 800,
  });
});

test("browser text composition requires explicit quoted non-sensitive text", () => {
  assert.equal(composeBrowserText('Use the search field and type "hello world".'), "hello world");
  assert.equal(composeBrowserText("Use the search field and type hello world."), undefined);
  assert.throws(
    () => composeBrowserText('Type "my password" into the field.'),
    /credential-like or secret-looking text/u,
  );
});

test("browser selection composition requires one explicit quoted non-sensitive option", () => {
  assert.equal(composeBrowserSelection('Select "South Africa" in Country.'), "South Africa");
  assert.equal(composeBrowserSelection("Select South Africa in Country."), undefined);
  assert.throws(
    () => composeBrowserSelection('Select "my password" in Country.'),
    /credential-like or secret-looking option/u,
  );
});

test("browser computer use opens a requested public URL without forcing the local fixture action", async () => {
  assert.equal(requestedBrowserUrl("Can you open kasitek.co.za?"), "https://kasitek.co.za");
  const browser = new FixtureBrowser();
  const events: string[] = [];
  const runner = new ComputerRunner({ browser, strategy: "typesafe", maxOutputBytes: 32_000 });
  const result = await runner.run("computer_open_url", "Can you open kasitek.co.za?", {
    onComputer: (event) => { events.push(event.type); },
  });
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /"status":"opened"/u);
  assert.deepEqual(browser.openedUrls, ["https://kasitek.co.za"]);
  assert.deepEqual(events, ["started", "observed", "verified"]);
  assert.doesNotMatch(result.content, /safe result revealed/u);
});

test("browser computer use reports an external action without claiming page-specific verification", async () => {
  const browser = new FixtureBrowser();
  browser.successAfterClicks = 99;
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: actionId, confidence: 0.9, probabilities: { [actionId]: 0.9 } } },
  };
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 3,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_external_click", "Open https://example.com and click Reveal safe result.", { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /"status":"action_dispatched"/u);
  assert.match(result.content, /"verification":"not-configured"/u);
  assert.equal(browser.clicked, 1);
  assert.deepEqual(browser.openedUrls, ["https://example.com"]);
});

test("browser computer use routes an explicit Enter key through browser approval", async () => {
  const browser = new FixtureBrowser();
  browser.includeInput = true;
  const pressActionId = "press:@e2:document_fixture";
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: pressActionId, confidence: 0.9, probabilities: { [pressActionId]: 0.9 } } },
  };
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_press_test", "Open https://example.com and press Enter in Search terms.", { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.deepEqual(browser.pressedKeys, ["Enter"]);
  assert.match(result.content, /"key":"Enter"/u);
});

test("browser computer use routes an explicit select option through browser approval", async () => {
  const browser = new FixtureBrowser();
  browser.includeSelect = true;
  const selectActionId = "select:@e2:document_fixture";
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: selectActionId, confidence: 0.9, probabilities: { [selectActionId]: 0.9 } } },
  };
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_select_test", 'Open https://example.com and select "South Africa" in Country.', { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.deepEqual(browser.selectedValues, ["South Africa"]);
  assert.match(result.content, /"value":"South Africa"/u);
});

test("browser computer use executes an explicit wait without input approval", async () => {
  const browser = new FixtureBrowser();
  const waitActionId = "wait:document:document_fixture";
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: waitActionId, confidence: 0.9, probabilities: { [waitActionId]: 0.9 } } },
  };
  let approvals = 0;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_wait_test", "Open https://example.com and wait 250 milliseconds.", {
    approveBrowser: async () => {
      approvals += 1;
      return { decision: "allow-once" as const };
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /"status":"waited"/u);
  assert.match(result.content, /"waitMilliseconds":250/u);
  assert.deepEqual(browser.waitedMs, [250]);
  assert.equal(approvals, 0);
});

test("browser computer use executes an explicit scroll through approval", async () => {
  const browser = new FixtureBrowser();
  const scrollActionId = "scroll:document:document_fixture";
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: scrollActionId, confidence: 0.9, probabilities: { [scrollActionId]: 0.9 } } },
  };
  let approved: { readonly direction?: string; readonly amount?: number } | undefined;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_scroll_test", "Open https://example.com and scroll down 800 pixels.", {
    approveBrowser: async (request) => {
      approved = { direction: request.direction, amount: request.amount };
      return { decision: "allow-once" as const };
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /"status":"scrolled"/u);
  assert.match(result.content, /"scrollAmount":800/u);
  assert.deepEqual(browser.scrolled, [{ direction: "down", amount: 800 }]);
  assert.deepEqual(approved, { direction: "down", amount: 800 });
});

test("browser TypeSafe abstains on none or low confidence before approval", async () => {
  for (const [choice, confidence] of [["none", 0.99], [actionId, 0.49]] as const) {
    const browser = new FixtureBrowser();
    let approvals = 0;
    const response = {
      model: "jev-latest",
      answers: { target: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } },
    };
    const runner = new ComputerRunner({
      browser,
      strategy: "typesafe",
      typeSafeApiKey: "typesafe-test-secret",
      typeSafeModel: "jev-latest",
      maxOutputBytes: 32_000,
      fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const result = await runner.run(`computer_abstain_${choice}`, "Use computer to reveal the safe result in the local fixture.", {
      approveBrowser: async () => {
        approvals += 1;
        return { decision: "allow-once" as const };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.content, /"status":"abstained"/u);
    assert.equal(result.errorCode, choice === "none" ? "computer-blocked" : "computer-confidence-abstention");
    assert.equal(browser.clicked, 0);
    assert.equal(approvals, 0);
  }
});

test("browser TypeSafe provider timeouts reach the TUI boundary with a distinct code", async () => {
  const browser = new FixtureBrowser();
  const events: Array<{ readonly type: string; readonly errorCode?: string }> = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => { throw new Error("provider request timed out"); },
  });

  const result = await runner.run("computer_provider_timeout", "Use computer to reveal the safe result in the local fixture.", {
    approveBrowser: allowBrowser(),
    onComputer: (event) => { if (event.type === "failed") events.push({ type: event.type, errorCode: event.errorCode }); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "computer-provider-timeout");
  assert.deepEqual(events, [{ type: "failed", errorCode: "computer-provider-timeout" }]);
  assert.equal(browser.clicked, 0);
});

test("TypeSafe/Jev path chooses a candidate and shares the approved executor", async () => {
  const browser = new FixtureBrowser();
  const events: string[] = [];
  const observationIds: string[] = [];
  const actionObservationIds: string[] = [];
  let proposedEvidence: { readonly model?: string; readonly latencyMs?: number; readonly probabilities?: Readonly<Record<string, number>>; readonly targetSource?: string; readonly targetRole?: string; readonly targetLabel?: string } | undefined;
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: actionId, confidence: 0.97, probabilities: { [actionId]: 0.97 } } },
    usage: { input_tokens: 10, output_tokens: 3 },
  };
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_test", "Use computer to reveal the safe result in the local fixture.", {
    approveBrowser: allowBrowser(),
    onComputer: (event) => {
      events.push(event.type);
      const value = event as unknown as { readonly type: string; readonly observationId?: string };
      if (value.type === "observed") observationIds.push(value.observationId ?? "");
      if (value.type === "proposed" || value.type === "act_requested" || value.type === "verified") actionObservationIds.push(value.observationId ?? "");
      if (value.type === "proposed") proposedEvidence = value as typeof proposedEvidence;
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.match(result.content, /"confidence":0\.97/u);
  assert.equal(browser.clicked, 1);
  assert.deepEqual(events, ["started", "observed", "proposed", "act_requested", "verified"]);
  assert.equal(observationIds.length, 1);
  assert.match(observationIds[0] ?? "", /^browser_observation_/u);
  assert.deepEqual(actionObservationIds, [observationIds[0], observationIds[0], observationIds[0]]);
  assert.equal(proposedEvidence?.model, "jev-latest");
  assert.equal(typeof proposedEvidence?.latencyMs, "number");
  assert.deepEqual(proposedEvidence?.probabilities, { [actionId]: 0.97 });
  assert.equal(proposedEvidence?.targetSource, "browser");
  assert.equal(proposedEvidence?.targetRole, "button");
  assert.equal(proposedEvidence?.targetLabel, "Reveal safe result");
});

test("computer loop reobserves between bounded actions and stops at its configured limit", async () => {
  const browser = new FixtureBrowser();
  browser.successAfterClicks = 2;
  let decisionCalls = 0;
  const observationIds: string[] = [];
  const previousObservationIds: Array<string | undefined> = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => {
      decisionCalls += 1;
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { target: { type: "choice", choice: actionId, confidence: 0.97, probabilities: { [actionId]: 0.97 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const events: string[] = [];
  const result = await runner.run("computer_loop_test", "Use computer to reveal the safe result in the local fixture.", {
    approveBrowser: allowBrowser(),
    onComputer: (event) => {
      events.push(event.type);
      if (event.type === "observed") {
        observationIds.push(event.observationId);
        previousObservationIds.push((event as typeof event & { readonly previousObservationId?: string }).previousObservationId);
      }
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.equal(browser.clicked, 2);
  assert.equal(decisionCalls, 2);
  assert.deepEqual(events, [
    "started", "observed", "proposed", "act_requested", "verified",
    "observed", "proposed", "act_requested", "verified",
  ]);
  assert.equal(new Set(observationIds).size, 2);
  assert.deepEqual(previousObservationIds, [undefined, observationIds[0]]);

  const limitedBrowser = new FixtureBrowser();
  limitedBrowser.successAfterClicks = 3;
  const limitedRunner = new ComputerRunner({
    browser: limitedBrowser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: actionId, confidence: 0.97, probabilities: { [actionId]: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const limited = await limitedRunner.run("computer_loop_limit_test", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
  assert.equal(limited.ok, false);
  assert.equal(limited.errorCode, "computer-action-limit");
  assert.equal(limitedBrowser.clicked, 2);
});

test("computer cancellation before input emits a terminal failed event", async () => {
  const browser = new FixtureBrowser();
  const controller = new AbortController();
  const events: Array<{ readonly type: string; readonly runStatus?: string; readonly reason?: string }> = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("cancelled", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    }),
  });
  const promise = runner.run("computer_cancel_before_input", "Use computer to reveal the safe result in the local fixture.", {
    signal: controller.signal,
    approveBrowser: allowBrowser(),
    onComputer: (event) => { events.push(event); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort("test cancellation");
  await assert.rejects(promise);
  assert.equal(browser.clicked, 0);
  assert.deepEqual(events.map((event) => event.type), ["started", "observed", "failed"]);
  assert.equal(events.at(-1)?.runStatus, "failed");
  assert.match(events.at(-1)?.reason ?? "", /cancelled before any input/u);
});

test("computer cancellation after input emits outcome-unknown and does not replay", async () => {
  const browser = new FixtureBrowser();
  browser.blockSnapshotAfterClick = true;
  const controller = new AbortController();
  const events: Array<{ readonly type: string; readonly runStatus?: string; readonly reason?: string }> = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: actionId, confidence: 0.97, probabilities: { [actionId]: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const promise = runner.run("computer_cancel_after_input", "Use computer to reveal the safe result in the local fixture.", {
    signal: controller.signal,
    approveBrowser: allowBrowser(),
    onComputer: (event) => { events.push(event); },
  });
  while (browser.clicked === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort("test cancellation");
  await assert.rejects(promise);
  assert.equal(browser.clicked, 1);
  assert.deepEqual(events.map((event) => event.type), ["started", "observed", "proposed", "act_requested", "failed"]);
  assert.equal(events.at(-1)?.runStatus, "outcome-unknown");
  assert.match(events.at(-1)?.reason ?? "", /after 1 input/u);
});

test("traditional path sends a screenshot to the selected OpenRouter vision model", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-fixture-"));
  try {
    const screenshotPath = path.join(root, "fixture.png");
    await writeFile(screenshotPath, Buffer.from("bounded-image-fixture"));
    const browser = new FixtureBrowser();
    browser.screenshotPath = screenshotPath;
    let requestBody: any;
    let proposedEvidence: { readonly model?: string; readonly latencyMs?: number } | undefined;
    const runner = new ComputerRunner({
      browser,
      strategy: "traditional",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "openai/vision-test",
      maxOutputBytes: 32_000,
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ actionId }) } }] } }] }), { status: 200 });
      },
    });
    const result = await runner.run("computer_test", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser(), onComputer: (event) => { if (event.type === "proposed") proposedEvidence = event as unknown as typeof proposedEvidence; } });
    assert.equal(result.ok, true);
    assert.equal(requestBody.model, "openai/vision-test");
    assert.equal(requestBody.messages.length, 2);
    const userContent = requestBody.messages[1].content;
    assert.equal(userContent[1].type, "image_url");
    assert.match(userContent[1].image_url.url, /^data:image\/png;base64,/u);
    assert.equal(browser.clicked, 1);
    assert.equal(proposedEvidence?.model, "openai/vision-test");
    assert.equal(typeof proposedEvidence?.latencyMs, "number");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("traditional path refuses an undeclared vision model before sending the screenshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-capability-"));
  try {
    const browser = new FixtureBrowser();
    browser.screenshotPath = path.join(root, "fixture.png");
    await writeFile(browser.screenshotPath, Buffer.from("bounded-image-fixture"));
    let providerCalled = false;
    const runner = new ComputerRunner({
      browser,
      strategy: "traditional",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "text-only/model",
      traditionalVision: false,
      maxOutputBytes: 32_000,
      fetchImpl: async () => {
        providerCalled = true;
        return new Response("unexpected", { status: 500 });
      },
    });
    const result = await runner.run("computer_capability_test", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
    assert.equal(result.ok, false);
    assert.match(result.summary, /not declared vision-capable/u);
    assert.equal(providerCalled, false);
    assert.equal(browser.clicked, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("traditional path accepts only strict candidate JSON when a provider omits tool calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-fixture-content-"));
  try {
    const browser = new FixtureBrowser();
    browser.screenshotPath = path.join(root, "fixture.png");
    await writeFile(browser.screenshotPath, Buffer.from("bounded-image-fixture"));
    const runner = new ComputerRunner({
      browser,
      strategy: "traditional",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "vision/content-test",
      maxOutputBytes: 32_000,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actionId }) } }] }), { status: 200 }),
    });
    const result = await runner.run("computer_content_test", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
    assert.equal(result.ok, true);
    assert.equal(browser.clicked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser traditional decisions surface OpenRouter error envelopes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-provider-envelope-"));
  try {
    const browser = new FixtureBrowser();
    browser.screenshotPath = path.join(root, "fixture.png");
    await writeFile(browser.screenshotPath, Buffer.from("bounded-image-fixture"));
    const runner = new ComputerRunner({
      browser,
      strategy: "traditional",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "vision/provider-envelope-test",
      maxOutputBytes: 32_000,
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 502, message: "ResourceExhausted: worker capacity reached" } }), { status: 200 }),
    });
    const result = await runner.run("computer_provider_envelope", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "computer-decision");
    assert.match(result.content, /upstream error: HTTP 502: ResourceExhausted: worker capacity reached/u);
    assert.equal(browser.clicked, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser traditional decision retries a transient provider failure before approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-fixture-retry-"));
  try {
    const browser = new FixtureBrowser();
    browser.screenshotPath = path.join(root, "fixture.png");
    await writeFile(browser.screenshotPath, Buffer.from("bounded-image-fixture"));
    let calls = 0;
    const attemptEvents: Array<{ readonly attempt: number; readonly retrying: boolean }> = [];
    const runner = new ComputerRunner({
      browser,
      strategy: "traditional",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "vision/retry-test",
      maxOutputBytes: 32_000,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("provider returned HTTP 429", { status: 429 });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actionId }) } }] }), { status: 200 });
      },
    });
    const result = await runner.run("computer_retry_test", "Use computer to reveal the safe result in the local fixture.", {
      approveBrowser: allowBrowser(),
      onComputer: (event) => {
        if (event.type === "decision_attempt") attemptEvents.push({ attempt: event.attempt, retrying: event.retrying });
      },
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(calls, 2);
    assert.deepEqual(attemptEvents, [{ attempt: 1, retrying: true }]);
    assert.equal(browser.clicked, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compare mode records both proposals and executes the shared click once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-fixture-compare-"));
  try {
    const browser = new FixtureBrowser();
    browser.screenshotPath = path.join(root, "fixture.png");
    await writeFile(browser.screenshotPath, Buffer.from("bounded-image-fixture"));
    const events: string[] = [];
    const runner = new ComputerRunner({
      browser,
      strategy: "compare",
      openRouterApiKey: "openrouter-test-secret",
      traditionalModel: "vision/compare-test",
      typeSafeApiKey: "typesafe-test-secret",
      typeSafeModel: "jev-latest",
      maxOutputBytes: 32_000,
      fetchImpl: async (input) => {
        if (String(input).includes("openrouter.ai")) {
          return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ actionId }) } }] } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: { target: { type: "choice", choice: actionId, confidence: 0.99, probabilities: { [actionId]: 0.99 } } },
          usage: { input_tokens: 10, output_tokens: 3 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const result = await runner.run("computer_compare_test", "Use computer to reveal the safe result in the local fixture.", {
      approveBrowser: allowBrowser(),
      onComputer: (event) => { events.push(event.type); },
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(browser.clicked, 1);
    assert.deepEqual(events, ["started", "observed", "proposed", "proposed", "act_requested", "verified"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI renders the computer strategy and verification stages", async () => {
  const chunks: string[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  const application = {
    sessionId: "session_computer_tui",
    modelLabel: "deterministic/echo",
    providerLabel: "deterministic/deterministic/echo",
    providerName: "deterministic",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["computer"],
    runTurn: async (...args: unknown[]) => {
      const onComputer = args[13] as ((event: { readonly type: string; readonly strategy: string; readonly actionId?: string; readonly candidateId?: string; readonly operation?: string; readonly confidence?: number; readonly candidateCount?: number; readonly success?: boolean; readonly goal?: string; readonly reason?: string; readonly errorCode?: string }) => void) | undefined;
      onComputer?.({ type: "started", strategy: "typesafe", goal: "reveal" });
      onComputer?.({ type: "observed", strategy: "typesafe", candidateCount: 1 });
      onComputer?.({ type: "proposed", strategy: "typesafe", actionId, candidateId, operation: "click", confidence: 0.97 });
      onComputer?.({ type: "act_requested", strategy: "typesafe", actionId, candidateId, operation: "click" });
      onComputer?.({ type: "verified", strategy: "typesafe", success: true });
      onComputer?.({ type: "failed", strategy: "typesafe", reason: "provider request timed out", errorCode: "computer-provider-timeout" });
      return { schemaVersion: 1 as const, sessionId: "session_computer_tui", turnId: "turn_computer_tui", status: "completed" as const, provider: "deterministic" as const, model: "deterministic/echo", startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), assistantText: "done" };
    },
  };
  await new TerminalUi(application as never, output, false).runSingle("reveal");
  const rendered = chunks.join("");
  assert.match(rendered, /computer · typesafe · observe/u);
  assert.match(rendered, /computer · observed · 1 candidate/u);
  assert.match(rendered, /computer · typesafe · proposed .*confidence 97%/u);
  assert.match(rendered, /computer · verify · success/u);
  assert.match(rendered, /computer · typesafe · failed · computer-provider-timeout/u);
});

test("computer approval target renders semantic CUA labels instead of missing coordinates", () => {
  const request = {
    callId: "computer_ui_call",
    actionId: "native_accessibility_click_0",
    sessionId: "anesu-cua-test",
    environment: "ubuntu-x11-cua",
    operation: "click",
    observationId: "observation_test",
    generation: 1,
    displayId: "primary",
    targetLabel: "Reveal safe result",
    targetRole: "button",
    targetSource: "accessibility",
    warning: "This activates the observed target.",
  } satisfies ComputerApprovalRequest;

  assert.equal(formatComputerApprovalTarget(request), "primary · Reveal safe result (button)");
  assert.doesNotMatch(formatComputerApprovalTarget(request), /undefined/u);
});

test("TUI header identifies the configured computer environment and strategy", () => {
  const chunks: string[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  const application = {
    sessionId: "session_computer_status",
    modelLabel: "openrouter/model",
    providerLabel: "openrouter/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["computer"],
    computer: {
      enabled: true,
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      model: "jev-latest",
      isolated: true,
    },
  };

  new TerminalUi(application as never, output, false).printHeader();
  const rendered = chunks.join("");
  assert.match(rendered, /computer.*typesafe.*ubuntu-x11-cua.*isolated.*jev-latest/u);
});

test("TUI exposes a read-only computer inspection command", async () => {
  assert.deepEqual(parseTuiCommand("/computer"), { kind: "computer" });
  const chunks: string[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
  const application = {
    sessionId: "session_computer_inspect",
    modelLabel: "openrouter/model",
    providerLabel: "openrouter/model",
    workspaceRoot: "/tmp/workspace",
    evidenceDirectory: "/tmp/evidence",
    toolNames: ["computer"],
    computer: {
      enabled: true,
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      model: "jev-latest",
      isolated: true,
      readiness: { kind: "ubuntu-x11-cua", available: true, display: ":99", isolated: true },
    },
    readComputerRuns: async () => [{
      run: { runId: "computer_run_inspect", status: "completed", strategy: "typesafe", environment: "ubuntu-x11-cua" },
      eventCount: 4,
      lastEvent: { kind: "observed", artifactPath: "computer_run_inspect/computer_artifact_1.png" },
    }],
  };

  await new TerminalUi(application as never, output, false).runCommand({ kind: "computer" });
  const rendered = chunks.join("");
  assert.match(rendered, /Computer use/u);
  assert.match(rendered, /ready/u);
  assert.match(rendered, /ubuntu-x11-cua/u);
  assert.match(rendered, /display.*:99/u);
  assert.match(rendered, /jev-latest/u);
  assert.match(rendered, /computer_run_inspect/u);
  assert.match(rendered, /4 events/u);
  assert.match(rendered, /computer_artifact_1\.png/u);
});
