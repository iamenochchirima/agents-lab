import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Writable } from "node:stream";
import { buildBrowserActionSpace, requestedBrowserKey, requestedBrowserScroll, requestedBrowserWait, type ComputerBrowserOperation } from "../src/computer/browser-strategy.js";
import { COMPUTER_TOOL_DEFINITION, ComputerRunner, composeBrowserSelection, composeBrowserText, parseComputerSnapshot, requestedBrowserUrl, type ComputerBrowser, type ComputerContext } from "../src/computer/runner.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId } from "../src/browser/index.js";
import { DEFAULT_INITIAL_INSTRUCTION, defaultComputerBrowserInputRoute, loadConfig, safeConfigSummary } from "../src/config/config.js";
import { formatComputerApprovalTarget, formatComputerNativeFallback, formatComputerTaskCompletion, parseTuiCommand, TerminalUi } from "../src/cli/tui.js";
import type { ComputerApprovalRequest } from "../src/computer/contracts.js";
import { compileComputerTask } from "../src/computer/task.js";
import { deriveNativeVerificationSpec, deriveVerificationSpec, extractCalculatorExpression, isBrowserOpenOnlyGoal, verifyBrowserObservation, verifyNativeObservation } from "../src/computer/verification.js";

const documentId = "document_fixture";
const candidateId = `@e1:${documentId}`;
const actionId = `click:${candidateId}`;

test("agent instructions keep native computer and browser tools distinct", () => {
  assert.match(DEFAULT_INITIAL_INSTRUCTION, /typed browser tools for websites/u);
  assert.match(DEFAULT_INITIAL_INSTRUCTION, /computer tool only for supported native desktop work/u);
  assert.match(DEFAULT_INITIAL_INSTRUCTION, /A dispatched click alone does not prove navigation, so inspect tabs and take a fresh snapshot/u);
  assert.match(DEFAULT_INITIAL_INSTRUCTION, /If a tool reports an action outcome as unknown, do not say that action succeeded; describe later observed state separately/u);
  assert.match(COMPUTER_TOOL_DEFINITION.description, /native desktop apps/u);
  assert.match(COMPUTER_TOOL_DEFINITION.description, /For websites, use the browser tools instead/u);
  assert.doesNotMatch(COMPUTER_TOOL_DEFINITION.description, /example\.com|browser or isolated desktop/u);
});

function snapshot(success = false, includeInput = false, includeSelect = false, primaryLabel = "Reveal safe result", inputValue?: string, metadata: Record<string, unknown> = {}, inputName = "Search terms", snapshotDocumentId = documentId, primaryRole = "button"): string {
  return JSON.stringify({
    tabId: "tab_fixture",
    documentId: snapshotDocumentId,
    title: "Anesu computer-use fixture",
    content: `${success ? "Computer success: safe result revealed." : primaryLabel === "Reveal safe result" && success === false ? "The safe result is hidden." : "The details are open."}\n\n[@e1] ${primaryRole} ${primaryLabel}${includeInput ? `\n[@e2] input text ${inputName}` : ""}${includeSelect ? `\n[@e${includeInput ? "3" : "2"}] select Country` : ""}`,
    references: [{ value: "@e1", documentId: snapshotDocumentId, role: primaryRole, name: primaryLabel }, ...(includeInput ? [{ value: "@e2", documentId: snapshotDocumentId, role: "input", name: inputName, actions: ["type"], ...(inputValue === undefined ? {} : { currentValue: inputValue }) }] : []), ...(includeSelect ? [{ value: `@e${includeInput ? "3" : "2"}`, documentId: snapshotDocumentId, role: "select", name: "Country" }] : [])],
    ...metadata,
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
  snapshotHeadings: readonly string[] | undefined;
  snapshotHeadingsAfterClick: readonly string[] | undefined;
  snapshotDocumentIdAfterClick: string | undefined;
  snapshotPrimaryRole = "button";
  snapshotComplete: boolean | undefined;
  snapshotOmissions: Readonly<Record<string, number>> | undefined;
  typedValue = "";
  omitTypedValueAfterType = false;
  refreshDocumentAfterType = false;
  inputNameAfterType: string | undefined;
  successAfterClicks = 1;
  twoStep = false;
  blockSnapshotAfterClick = false;
  closeFailure = false;
  actionEffect: "suspected_noop" | "partial" | "unverifiable" | "confirmed" | undefined;
  actionRoute: "dom" | "dom_event" | "trusted_input" | undefined;
  actionEscalation: { readonly target: string; readonly reason: string } | undefined;
  private successful = false;

  private actionResultContent(): string {
    const evidence = {
      ...(this.actionEffect ? { effect: this.actionEffect } : {}),
      ...(this.actionRoute ? { route: this.actionRoute } : {}),
      ...(this.actionEscalation ? { escalation: this.actionEscalation } : {}),
    };
    return Object.keys(evidence).length === 0 ? "{}" : JSON.stringify(evidence);
  }

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
        return { ok: true, content: snapshot(
          this.successful,
          this.includeInput,
          this.includeSelect,
          this.twoStep && this.clicked === 0 ? "Open details" : "Reveal safe result",
          this.omitTypedValueAfterType && this.typedValue.length > 0 ? undefined : this.typedValue,
          {
            ...(this.clicked > 0 && this.snapshotHeadingsAfterClick
              ? { headings: this.snapshotHeadingsAfterClick }
              : this.snapshotHeadings ? { headings: this.snapshotHeadings } : {}),
            ...(this.snapshotComplete !== undefined ? { complete: this.snapshotComplete } : {}),
            ...(this.snapshotOmissions ? { omissions: this.snapshotOmissions } : {}),
          },
          this.typedValue.length > 0 && this.inputNameAfterType ? this.inputNameAfterType : "Search terms",
          this.clicked > 0 && this.snapshotDocumentIdAfterClick
            ? this.snapshotDocumentIdAfterClick
            : this.refreshDocumentAfterType && this.typedValue.length > 0 ? `${documentId}_after_type` : documentId,
          this.snapshotPrimaryRole,
        ), summary: "snapshot" };
      }
      case "browser_screenshot": return { ok: true, content: JSON.stringify({ path: this.screenshotPath }), summary: "screenshot" };
      case "browser_click": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture", callId: "fixture:click", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "click", reference: "@e1", documentId: asBrowserDocumentId(documentId), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.clicked += 1;
        this.successful = this.clicked >= (this.twoStep ? 2 : this.successAfterClicks);
        return { ok: true, content: this.actionResultContent(), summary: "clicked" };
      }
      case "browser_press": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture_press", callId: "fixture:press", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "press", reference: String(_args.ref ?? ""), documentId: asBrowserDocumentId(documentId), key: String(_args.key ?? ""), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.pressedKeys.push(String(_args.key ?? ""));
        return { ok: true, content: "{}", summary: "pressed" };
      }
      case "browser_type": {
        const decision = context.approveBrowser
          ? await context.approveBrowser({ actionId: "browser_action_fixture_type", callId: "fixture:type", sessionId: asBrowserSessionId("browser_fixture"), tabId: asBrowserTabId("tab_fixture"), action: "type", reference: String(_args.ref ?? ""), documentId: asBrowserDocumentId(documentId), text: String(_args.text ?? ""), actionHash: "hash", warning: "fixture" }, context.signal)
          : { decision: "unavailable" as const, reason: "missing" };
        if (decision.decision !== "allow-once") return { ok: false, content: "Browser action not started.", summary: "denied", errorCode: "browser-approval-denied" };
        this.typedValue = String(_args.text ?? "");
        return { ok: true, content: this.actionResultContent(), summary: "typed" };
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
      case "browser_close": return this.closeFailure
        ? { ok: false, content: "cleanup failed", summary: "fixture close failed", errorCode: "browser-close-failed" }
        : { ok: true, content: "{}", summary: "closed" };
      default: return { ok: false, content: "unsupported", summary: "unsupported" };
    }
  }

  screenshotPath = "";
}

function allowBrowser() {
  return async () => ({ decision: "allow-once" as const });
}

test("computer goal verification derives only bounded browser and native conditions", () => {
  assert.deepEqual(deriveVerificationSpec("Open https://example.com", "browser"), { kind: "url-reached", expected: "https://example.com" });
  assert.deepEqual(deriveVerificationSpec("Open http://127.0.0.1:4173/", "browser"), { kind: "url-reached", expected: "http://127.0.0.1:4173/" });
  assert.deepEqual(deriveVerificationSpec('Show the text "Welcome home".', "browser"), { kind: "text-present", expected: "Welcome home" });
  assert.deepEqual(deriveVerificationSpec('Confirm that "Signed out" is not visible.', "browser"), { kind: "text-absent", expected: "Signed out" });
  assert.deepEqual(deriveVerificationSpec('Confirm that "Remember me" is checked.', "browser"), { kind: "element-state-changed", expected: "Remember me", state: "checked" });
  assert.deepEqual(deriveVerificationSpec('Enter "Anesu acceptance" and submit the form.', "browser"), {
    kind: "browser-form-submitted",
    expected: "Anesu acceptance",
    expectedSubmissionId: createHash("sha256").update("Anesu acceptance", "utf8").digest("hex").slice(0, 16),
  });
  const fieldGoal = 'Open https://www.wikipedia.org, enter "Anesu browser check" in the search box, tell me the current field value. Do not submit.';
  assert.deepEqual(deriveVerificationSpec(fieldGoal, "browser"), { kind: "browser-input-value", expected: "Anesu browser check" });
  assert.deepEqual(deriveVerificationSpec("Open https://example.com and tell me the page heading.", "browser"), { kind: "browser-heading", reason: "The fresh semantic snapshot must expose a visible page heading." });
  assert.deepEqual(deriveVerificationSpec("Open http://127.0.0.1:4173 and reveal the safe result.", "browser"), { kind: "text-present", expected: "Computer success: safe result revealed." });
  assert.deepEqual(deriveVerificationSpec("Click the visible Reveal safe result button.", "native"), { kind: "text-present", expected: "Computer success: safe result revealed." });
  assert.equal(deriveVerificationSpec("Click the settings button.", "browser").kind, "none");
  assert.equal(isBrowserOpenOnlyGoal("Open https://example.com and tell me the page heading.", deriveVerificationSpec("Open https://example.com and tell me the page heading.", "browser")), true);
  assert.equal(isBrowserOpenOnlyGoal("Open http://127.0.0.1:4173 and reveal the safe result.", deriveVerificationSpec("Open http://127.0.0.1:4173 and reveal the safe result.", "browser")), false);
});

test("browser verification uses fresh URL, text, and element facts", () => {
  const base = { tabId: "tab", documentId: "doc", url: "https://example.com/docs", title: "Docs", content: "[@e1] link Settings\nWelcome home" };
  assert.equal(verifyBrowserObservation({ kind: "url-reached", expected: "https://example.com" }, base).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "text-present", expected: "Welcome home" }, base).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "text-absent", expected: "Error" }, base).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "element-visible", expected: "Settings" }, base).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "text-present", expected: "Missing" }, base).status, "pending");
  assert.equal(verifyBrowserObservation({ kind: "text-absent", expected: "Error" }, { ...base, complete: false, omissions: { budget: 1 } }).status, "pending");
  assert.equal(verifyBrowserObservation({ kind: "browser-form-submitted", expected: "Welcome home", expectedSubmissionId: "3f5c" }, base).status, "pending");
  assert.equal(verifyBrowserObservation({ kind: "browser-form-submitted", expected: "Welcome home", expectedSubmissionId: "3f5c" }, { ...base, url: "http://anesu.test/contact/result?submission_id=3f5c", content: "Submission accepted: Welcome home" }).status, "pending");
  const submissionId = createHash("sha256").update("Welcome home", "utf8").digest("hex").slice(0, 16);
  assert.equal(verifyBrowserObservation({ kind: "browser-form-submitted", expected: "Welcome home", expectedSubmissionId: submissionId }, { ...base, url: `http://anesu.test/contact/result?submission_id=${submissionId}`, content: "Submission accepted: Welcome home" }).status, "verified");
  const fieldValue = verifyBrowserObservation({ kind: "browser-input-value", expected: "private user text" }, { ...base, typedInputValue: "private user text" });
  assert.equal(fieldValue.status, "verified");
  assert.equal(fieldValue.evidence.observed, "value-match");
  assert.equal(JSON.stringify(fieldValue.evidence).includes("private user text"), false);
  assert.equal(verifyBrowserObservation({ kind: "browser-input-value", expected: "private user text" }, {
    ...base,
    complete: false,
    omissions: { unknown: 1 },
    typedInputValue: "private user text",
  }).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "browser-input-value", expected: "private user text" }, base).status, "pending");
  const uploadId = createHash("sha256").update("fixture-bytes", "utf8").digest("hex");
  assert.equal(verifyBrowserObservation({ kind: "browser-file-assigned", expected: "workspace/fixture.txt" }, { ...base, url: "http://anesu.test/files/result?filename=fixture.txt&bytes=13&sha256=spoofed", content: "Upload accepted: fixture.txt (13 bytes)" }).status, "pending");
  assert.equal(verifyBrowserObservation({ kind: "browser-file-assigned", expected: "workspace/fixture.txt" }, { ...base, url: `http://anesu.test/files/result?filename=fixture.txt&bytes=13&sha256=${uploadId}`, content: "Upload accepted: fixture.txt (13 bytes)", uploadEvidence: { fileName: "fixture.txt", byteSize: 13, contentHash: uploadId } }).status, "verified");
  const heading = verifyBrowserObservation({ kind: "browser-heading" }, { ...base, headings: ["Example Domain"] });
  assert.equal(heading.status, "verified");
  assert.equal(heading.evidence.observed, "Example Domain");
  assert.equal(verifyBrowserObservation({ kind: "browser-heading" }, {
    ...base,
    headings: ["Example Domain"],
    complete: true,
    scope: "viewport",
    omissions: { css_hidden: 1, unknown: 1 },
  }).status, "verified");
  assert.equal(verifyBrowserObservation({ kind: "browser-heading" }, { ...base, headings: ["Example Domain"], complete: false }).status, "pending");
});

test("browser and native state verification requires the requested label and state", () => {
  const spec = deriveVerificationSpec('Confirm that "Remember me" is checked.', "browser");
  const pending = verifyBrowserObservation(spec, { tabId: "tab", documentId: "doc", url: "https://example.com", title: "Settings", content: "checkbox Remember me [unchecked]" });
  assert.equal(pending.status, "pending");
  const verified = verifyBrowserObservation(spec, { tabId: "tab", documentId: "doc-2", url: "https://example.com", title: "Settings", content: "checkbox Remember me [checked]" });
  assert.equal(verified.status, "verified");
  const native = verifyNativeObservation(spec, { text: "Remember me checked", windowId: "window-1", windowSnapshotId: "snapshot-3" });
  assert.equal(native.status, "verified");
  assert.equal(native.evidence.windowId, "window-1");
});

test("native verification requires an observed state and preserves window identity", () => {
  const result = verifyNativeObservation(
    { kind: "text-present", expected: "Computer success: safe result revealed." },
    { text: "Computer success: safe result revealed.", windowId: "window-1", windowSnapshotId: "snapshot-2" },
  );
  assert.equal(result.status, "verified");
  assert.equal(result.evidence.windowId, "window-1");
  assert.equal(result.evidence.windowSnapshotId, "snapshot-2");
  assert.equal(verifyNativeObservation({ kind: "none", reason: "ambiguous" }, { text: "" }).status, "clarification-required");
});

test("native verifier registry proves a committed Text Editor value from an editable control", () => {
  const spec = deriveNativeVerificationSpec('Open Text Editor and type "Anesu acceptance".', "Notes");
  assert.equal(spec.kind, "native-text-editor-value");
  const observation = {
    text: "Text Editor",
    structuredJson: JSON.stringify({
      accessibility: {
        appName: "gnome-text-editor",
        elements: [{ role: "editable text", actions: ["set_value"], value: "Anesu acceptance", label: "Document" }],
      },
      window: { appName: "gnome-text-editor", windowTitle: "Document" },
    }),
    windowId: "window-notes",
    windowSnapshotId: "snapshot-notes-2",
  };
  assert.equal(verifyNativeObservation(spec, observation).status, "verified");
  assert.equal(verifyNativeObservation(spec, { ...observation, structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Text Editor", elements: [{ role: "editable text", actions: ["set_value"], value: "Other text" }] } }) }).status, "pending");
});

test("native verifier accepts CUA's GNOME text box projection without action metadata", () => {
  const spec = deriveNativeVerificationSpec('Open Notes and type "Anesu acceptance" into a new document.', "Notes");
  assert.equal(verifyNativeObservation(spec, {
    text: "New Document",
    structuredJson: JSON.stringify({
      accessibility: {
        appName: "GNOME Text Editor",
        elements: [{ role: "text box", label: "Anesu acceptance", actions: [] }],
      },
      window: { appName: "GNOME Text Editor", windowTitle: "New Document" },
    }),
  }).status, "verified");
});

test("native verifier registry does not mistake an unsaved Calendar editor for a committed event", () => {
  const spec = deriveNativeVerificationSpec('Create calendar event "Team sync" on 2026-09-21 at 09:30.', "Calendar");
  assert.equal(spec.kind, "native-calendar-event");
  const base = {
    text: "Calendar",
    structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Calendar", elements: [{ role: "editable text", label: "Team sync 2026-09-21 09:30" }] } }),
    windowId: "window-calendar",
  };
  assert.equal(verifyNativeObservation(spec, base).status, "pending");
  assert.equal(verifyNativeObservation(spec, { ...base, structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Calendar", elements: [{ role: "list item", label: "Team sync 2026-09-21 09:30" }] } }) }).status, "verified");
});

test("native Calendar verification normalizes named dates and 12-hour times", () => {
  const spec = deriveNativeVerificationSpec('Create calendar event "Team sync" on 22 September 2026 at 7:30 pm.', "Calendar", Date.parse("2026-09-21T10:00:00.000Z"), "Africa/Johannesburg");
  assert.deepEqual(spec.nativeFacts, {
    application: "Calendar",
    text: "Team sync",
    date: "2026-09-22",
    time: "19:30",
    timeZone: "Africa/Johannesburg",
  });
  assert.equal(verifyNativeObservation(spec, {
    text: "Calendar",
    structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Calendar", elements: [{ role: "list item", label: "Team sync 22 September 2026 7:30 PM" }] } }),
  }).status, "verified");
});

test("native verifier registry requires an enabled alarm in the Clocks list", () => {
  const spec = deriveNativeVerificationSpec("Set an alarm for 07:30.", "Clocks");
  assert.equal(spec.kind, "native-clock-alarm");
  const base = { text: "Clocks", structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Clocks", elements: [{ role: "list item", label: "07:30", enabled: true }] } }) };
  assert.equal(verifyNativeObservation(spec, base).status, "pending");
  assert.equal(verifyNativeObservation(spec, { ...base, structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Clocks", elements: [{ role: "list item", label: "07:30 enabled", enabled: true, checked: true }] } }) }).status, "verified");
});

test("native verification admits opening Calculator and proves a bounded displayed calculation result", () => {
  const open = deriveNativeVerificationSpec("Open Calculator.", "Calculator");
  assert.equal(open.kind, "native-app-open");
  assert.deepEqual(open.nativeFacts, { application: "Calculator" });

  const calculation = deriveNativeVerificationSpec("Calculate 2 + 2 in Calculator.", "Calculator");
  assert.equal(calculation.kind, "native-calculator-result");
  assert.equal(calculation.expected, "4");
  assert.deepEqual(calculation.nativeFacts, { application: "Calculator", expression: "2 + 2", result: "4" });
  assert.deepEqual(extractCalculatorExpression("Compute (2 + 3) × 4 in the calculator."), { expression: "(2 + 3) * 4", result: "20" });
  assert.deepEqual(extractCalculatorExpression("Solve 12 x 3 using Calculator."), { expression: "12 * 3", result: "36" });
  assert.equal(extractCalculatorExpression("Calculate 2 + 2 and then send it."), undefined);
  assert.equal(extractCalculatorExpression("Calculate 1 / 0 in Calculator."), undefined);
  const observation = {
    text: "Calculator",
    structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Calculator", elements: [{ role: "label", label: "4" }] } }),
    windowId: "window-calculator",
    windowSnapshotId: "snapshot-calculator-2",
  };
  assert.equal(verifyNativeObservation(calculation, observation).status, "verified");
  assert.equal(verifyNativeObservation(calculation, { ...observation, structuredJson: JSON.stringify({ accessibility: { appName: "GNOME Calculator", elements: [{ role: "push button", label: "4" }] } }) }).status, "pending");
});

test("native open verification cannot swallow a requested follow-on action", () => {
  const notes = deriveNativeVerificationSpec("Open Notes and click the New Document button.", "Notes");
  assert.equal(notes.kind, "none");
  assert.match(notes.reason ?? "", /completion verifier/u);

  const calculator = deriveNativeVerificationSpec("Open Calculator and calculate 2 + 2.", "Calculator");
  assert.equal(calculator.kind, "native-calculator-result");
  assert.equal(calculator.expected, "4");
});

test("native open verification covers the expanded safe application catalog without admitting mutations", () => {
  for (const [name, identity] of [["Settings", "gnome-control-center"]] as const) {
    const spec = deriveNativeVerificationSpec(`Open ${name}.`, name);
    assert.equal(spec.kind, "native-app-open");
    assert.deepEqual(spec.nativeFacts, { application: name });
    assert.equal(verifyNativeObservation(spec, {
      text: identity,
      structuredJson: JSON.stringify({ accessibility: { appName: identity, elements: [] } }),
      windowId: `window-${name.toLocaleLowerCase()}`,
    }).status, "verified");
  }
  assert.equal(deriveNativeVerificationSpec("Change the system settings.", "Settings").kind, "none");
});

test("computer configuration is opt-in and validates its selected provider key", () => {
  const defaults = loadConfig({}, {});
  assert.equal(defaults.computerEnabled, false);
  assert.equal(defaults.computerSurface, "auto");
  assert.equal(defaults.computerStrategy, "auto");
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerStrategy: "typesafe" }, {}),
    /TYPESAFE_API_KEY/u,
  );
  const configured = loadConfig({ computerEnabled: true, computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, {});
  assert.equal(configured.computerEnabled, true);
  assert.equal(configured.timeoutMs, 120_000);
  assert.equal(loadConfig({ computerEnabled: true, computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, { ANESU_TIMEOUT_MS: "30000" }).timeoutMs, 30_000);
  assert.equal(configured.computerStrategy, "typesafe");
  assert.equal(configured.computerMaxActions, 8);
  assert.throws(() => loadConfig({ computerMaxActions: 0 }, {}), /computer max actions must be a positive integer/u);
});

test("automatic computer configuration requires Jev for browser use and keeps native fallback explicit", () => {
  const typesafeOnly = loadConfig({ computerEnabled: true, computerStrategy: "auto", typeSafeApiKey: "typesafe-test-secret" }, {});
  assert.equal(typesafeOnly.computerSurface, "auto");
  assert.equal(typesafeOnly.computerStrategy, "auto");
  assert.equal(typesafeOnly.computerOpenRouterApiKey, undefined);
  assert.equal("typeSafeApiKey" in safeConfigSummary(typesafeOnly), false);

  assert.throws(
    () => loadConfig({
      computerEnabled: true,
      computerEnvironment: "ubuntu-x11-cua",
      computerSurface: "desktop",
      computerStrategy: "auto",
      computerTraditionalVision: true,
      openRouterApiKey: "openrouter-test-secret",
    }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" }),
    /TYPESAFE_API_KEY/u,
  );

  assert.throws(
    () => loadConfig({ computerEnabled: true, computerSurface: "desktop", computerStrategy: "auto" }, {}),
    /TYPESAFE_API_KEY|DISPLAY/u,
  );
  assert.throws(
    () => loadConfig({ computerSurface: "sideways" as never }, {}),
    /Unsupported computer surface/u,
  );
});

test("native computer configuration is explicit, isolated, and selects the requested perception path", () => {
  assert.equal(defaultComputerBrowserInputRoute("linux"), "dom_event");
  assert.equal(defaultComputerBrowserInputRoute("darwin"), "dom_event");
  assert.equal(defaultComputerBrowserInputRoute("win32"), "trusted");
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "traditional", computerTraditionalVision: true, openRouterApiKey: "openrouter-test-secret", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" }),
    /traditional vision and compare strategies are retired/u,
  );
  const typesafe = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" });
  assert.equal(typesafe.computerStrategy, "typesafe");
  assert.equal(typesafe.computerBrowserInputRoute, defaultComputerBrowserInputRoute(process.platform));
  const trustedOverride = loadConfig({ computerEnabled: true, computerEnvironment: "browser", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret", computerBrowserInputRoute: "trusted" }, {});
  assert.equal(trustedOverride.computerBrowserInputRoute, "trusted");
  const synthetic = loadConfig({ computerEnabled: true, computerEnvironment: "browser", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret", computerBrowserInputRoute: "dom_event" }, {});
  assert.equal(synthetic.computerBrowserInputRoute, "dom_event");
  assert.throws(
    () => loadConfig({ computerBrowserInputRoute: "unsupported" as never }, {}),
    /Unsupported computer browser input route/u,
  );
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "compare", computerTraditionalVision: true, openRouterApiKey: "openrouter-test-secret", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" }),
    /traditional vision and compare strategies are retired/u,
  );
  assert.throws(
    () => loadConfig({ computerEnabled: true, computerEnvironment: "browser", computerStrategy: "traditional", openRouterApiKey: "openrouter-test-secret" }, {}),
    /traditional vision and compare strategies are retired/u,
  );
  const configured = loadConfig({ computerEnabled: true, computerEnvironment: "ubuntu-x11-cua", computerStrategy: "typesafe", typeSafeApiKey: "typesafe-test-secret" }, { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" });
  assert.equal(configured.computerEnvironment, "ubuntu-x11-cua");
  assert.equal(configured.computerCuaIsolatedDisplay, true);
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
    scope: "document",
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
  assert.equal(observation.scope, "document");

  const actions = buildBrowserActionSpace(observation);
  assert.deepEqual(actions.map((action) => action.operation), ["click", "type", "blocked", "blocked"] satisfies readonly ComputerBrowserOperation[]);
  assert.deepEqual(actions.map((action) => action.actionId), [
    "click:@e1:document_actions",
    "type:@e2:document_actions",
    "blocked:@e3:document_actions",
    "blocked:@e4:document_actions",
  ]);
  assert.equal(actions[1]?.ref, "@e2");
  assert.equal(actions[2]?.reason, "native select controls are not exposed by the typed Cua browser surface");
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
  assert.equal(composeBrowserText("Use the search field and type 'hello world'."), "hello world");
  assert.equal(composeBrowserText("Use the search field and type hello world."), undefined);
  assert.throws(
    () => composeBrowserText('Type "my password" into the field.'),
    /credential-like or secret-looking text/u,
  );
});

test("browser selection composition requires one explicit quoted non-sensitive option", () => {
  assert.equal(composeBrowserSelection('Select "South Africa" in Country.'), "South Africa");
  assert.equal(composeBrowserSelection("Select 'South Africa' in Country."), "South Africa");
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
  assert.match(result.content, /"status":"completed"/u);
  assert.deepEqual(browser.openedUrls, ["https://kasitek.co.za"]);
  assert.deepEqual(events, ["started", "observed", "verified"]);
  assert.doesNotMatch(result.content, /safe result revealed/u);
});

test("read-only browser heading requests accept visible heading evidence despite unrelated omissions", async () => {
  const browser = new FixtureBrowser();
  browser.snapshotHeadings = ["Example Domain"];
  browser.snapshotComplete = true;
  browser.snapshotOmissions = { css_hidden: 1, unknown: 1 };
  let modelCalls = 0;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => {
      modelCalls += 1;
      throw new Error("A read-only heading request must not invoke the candidate chooser.");
    },
  });

  const result = await runner.run("computer_open_heading", "Open https://example.com and tell me the page heading.", {
    approveBrowser: allowBrowser(),
  });

  assert.equal(result.ok, true, result.content);
  assert.equal(result.status, "completed");
  assert.match(result.content, /"heading":"Example Domain"/u);
  assert.deepEqual(browser.openedUrls, ["https://example.com"]);
  assert.equal(browser.clicked, 0);
  assert.equal(modelCalls, 0);
});

test("browser computer use reports an external action without claiming page-specific verification", async () => {
  const browser = new FixtureBrowser();
  browser.successAfterClicks = 99;
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.9, probabilities: { candidate_1: 0.9 } } },
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
  assert.equal(result.ok, false, result.content);
  assert.equal(result.errorCode, "computer-action-limit");
  assert.match(result.content, /"status":"action_limit"/u);
  assert.match(result.content, /"verification":"text-present"/u);
  assert.equal(browser.clicked, 3);
  assert.deepEqual(browser.openedUrls, ["https://example.com"]);
});

test("browser computer use routes an explicit Enter key through browser approval", async () => {
  const browser = new FixtureBrowser();
  browser.includeInput = true;
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: "candidate_3", confidence: 0.9, probabilities: { candidate_3: 0.9 } } },
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

test("browser computer use blocks native select controls before approval", async () => {
  const browser = new FixtureBrowser();
  browser.includeSelect = true;
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.9, probabilities: { candidate_2: 0.9 } } },
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
  assert.equal(result.ok, false, result.content);
  assert.equal(result.errorCode, "computer-blocked");
  assert.match(result.summary, /native select controls are not exposed/u);
  assert.deepEqual(browser.selectedValues, []);
});

test("browser computer use executes an explicit wait without input approval", async () => {
  const browser = new FixtureBrowser();
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.9, probabilities: { candidate_2: 0.9 } } },
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
  const response = {
    model: "jev-latest",
    answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.9, probabilities: { candidate_2: 0.9 } } },
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
  for (const [choice, confidence] of [["abstain", 0.99], ["candidate_1", 0.49]] as const) {
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
    assert.equal(result.errorCode, choice === "abstain" ? "computer-blocked" : "computer-confidence-abstention");
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
    answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
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
  assert.deepEqual(proposedEvidence?.probabilities, { candidate_1: 0.97 });
  assert.equal(proposedEvidence?.targetSource, "browser");
  assert.equal(proposedEvidence?.targetRole, "button");
  assert.equal(proposedEvidence?.targetLabel, "Reveal safe result");
});

test("browser cleanup failure replaces an otherwise successful result with outcome unknown", async () => {
  const browser = new FixtureBrowser();
  browser.closeFailure = true;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await runner.run("computer_cleanup_failure", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
  assert.equal(result.ok, false);
  assert.equal(result.status, "outcome-unknown");
  assert.match(result.summary, /cleanup failed/u);
});

test("browser Jev requests contain bounded opaque candidates, task context, and history only", async () => {
  const browser = new FixtureBrowser();
  let requestBody: Record<string, unknown> | undefined;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await runner.run("computer_jev_shape", "Open https://example.com and click Reveal safe result.", { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  const state = requestBody?.state as Record<string, unknown>;
  assert.equal(state.surface, "browser");
  assert.deepEqual((state.taskSummary as Record<string, unknown>).profileMode, "isolated_new");
  assert.deepEqual(state.actionHistory, []);
  assert.deepEqual((state.structuredElementSummaries as Array<Record<string, unknown>>)[0]?.choiceId, "candidate_1");
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes("@e1"), false);
  assert.equal(serialized.includes("document_fixture"), false);
  assert.equal(serialized.includes("example.com"), false);
  assert.equal(serialized.includes("typesafe-test-secret"), false);
});

test("browser Jev can request a bounded fresh observation before choosing an action", async () => {
  const browser = new FixtureBrowser();
  let decisions = 0;
  const observationIds: string[] = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => {
      decisions += 1;
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { target: decisions === 1
          ? { type: "choice", choice: "reobserve", confidence: 0.97, probabilities: { reobserve: 0.97 } }
          : { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await runner.run("computer_reobserve", "Use computer to reveal the safe result in the local fixture.", {
    approveBrowser: allowBrowser(),
    onComputer: (event) => {
      if (event.type === "observed") observationIds.push(event.observationId);
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.equal(decisions, 2);
  assert.equal(browser.clicked, 1);
  assert.equal(observationIds.length, 2);
  assert.notEqual(observationIds[0], observationIds[1]);
});

test("browser typing stops with an unknown outcome when fresh semantic state omits the edited value", async () => {
  const browser = new FixtureBrowser();
  browser.includeInput = true;
  browser.omitTypedValueAfterType = true;
  let observedVerification: Record<string, unknown> | undefined;
  let decisions = 0;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => {
      decisions += 1;
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.97, probabilities: { candidate_2: 0.97 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await runner.run("computer_typed_value_unknown", 'Open https://example.com and type "Anesu typed value" in Search terms.', {
    approveBrowser: allowBrowser(),
    onComputer: (event) => {
      if (event.type === "verified" && event.verifier === "browser-input-value") {
        observedVerification = event.verificationEvidence as Record<string, unknown>;
      }
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "outcome-unknown");
  assert.equal(result.errorCode, "computer-verification");
  assert.match(result.summary, /did not expose the edited value/u);
  assert.deepEqual(observedVerification, { observed: "value-unavailable" });
  assert.equal(browser.typedValue, "Anesu typed value");
  assert.equal(decisions, 1);
});

test("browser typing verifies the requested value in a fresh field without submitting it", async () => {
  const browser = new FixtureBrowser();
  browser.includeInput = true;
  let decisions = 0;
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => {
      decisions += 1;
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.97, probabilities: { candidate_2: 0.97 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const goal = 'Open https://example.com and enter "Anesu typed value" in the Search terms field. Tell me what is in that field. Do not submit.';
  const result = await runner.run("computer_typed_value_no_submit", goal, { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.equal(result.status, "completed");
  assert.equal(browser.typedValue, "Anesu typed value");
  assert.equal(browser.clicked, 0);
  assert.equal(decisions, 1);
  assert.match(result.content, /browser-input-value/u);
});

test("browser typing verifies the exact fresh field value despite unrelated snapshot omissions", async () => {
  const browser = new FixtureBrowser();
  browser.includeInput = true;
  browser.refreshDocumentAfterType = true;
  browser.inputNameAfterType = "Anesu typed value";
  browser.snapshotComplete = false;
  browser.actionEffect = "unverifiable";
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 2,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "candidate_2", confidence: 0.97, probabilities: { candidate_2: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await runner.run("computer_typed_value_verified", 'Open https://example.com and type "Anesu typed value" in Search terms.', { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.equal(result.status, "completed");
  assert.equal(browser.typedValue, "Anesu typed value");
});

test("computer runner stops on a Cua suspected-noop effect without replaying input", async () => {
  const browser = new FixtureBrowser();
  browser.actionEffect = "suspected_noop";
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const events: string[] = [];
  const result = await runner.run("computer_suspected_noop", "Use computer to reveal the safe result in the local fixture.", {
    approveBrowser: allowBrowser(),
    onComputer: (event) => { events.push(event.type); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "computer-verification");
  assert.match(result.content, /outcome-unknown/u);
  assert.equal(browser.clicked, 1);
  assert.equal(events.at(-1), "verified");
});

test("computer runner verifies a synthetic DOM dispatch from fresh browser state", async () => {
  const browser = new FixtureBrowser();
  browser.actionEffect = "unverifiable";
  browser.actionRoute = "dom";
  browser.actionEscalation = { target: "page", reason: "effect_unconfirmed" };
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await runner.run("computer_synthetic_dom_verified", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
  assert.equal(result.ok, true, result.content);
  assert.equal(result.status, "completed");
  assert.equal(browser.clicked, 1);
  assert.match(result.content, /"route":"dom"/u);
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
        answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
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
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const limited = await limitedRunner.run("computer_loop_limit_test", "Use computer to reveal the safe result in the local fixture.", { approveBrowser: allowBrowser() });
  assert.equal(limited.ok, false);
  assert.equal(limited.errorCode, "computer-action-limit");
  assert.equal(limitedBrowser.clicked, 2);
});

test("browser goal loop completes a bounded two-step local fixture without replay", async () => {
  const browser = new FixtureBrowser();
  browser.twoStep = true;
  const observed: string[] = [];
  const terminalOutcomes: string[] = [];
  const approvalExpectations: Array<{ readonly kind?: string; readonly step?: number; readonly maxActions?: number }> = [];
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-latest",
    maxActions: 3,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const result = await runner.run("computer_two_step", "Use computer to open details and reveal the safe result in the local fixture.", {
    approveBrowser: async (request) => {
      approvalExpectations.push({ kind: request.expectedVerification?.kind, step: request.step, maxActions: request.maxActions });
      return { decision: "allow-once" };
    },
    onComputer: (event) => {
      if (event.type === "observed") observed.push(event.observationId);
      if (event.type === "verified" && event.terminal) terminalOutcomes.push(event.outcome ?? "missing");
    },
  });
  assert.equal(result.ok, true, result.content);
  assert.equal(browser.clicked, 2);
  assert.equal(observed.length, 2);
  assert.deepEqual(terminalOutcomes, ["completed"]);
  assert.deepEqual(approvalExpectations, [
    { kind: "text-present", step: 1, maxActions: 3 },
    { kind: "text-present", step: 2, maxActions: 3 },
  ]);
  assert.match(result.content, /"status":"completed"/u);
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
      answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.97, probabilities: { candidate_1: 0.97 } } },
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
          answers: { target: { type: "choice", choice: "candidate_1", confidence: 0.99, probabilities: { candidate_1: 0.99 } } },
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
      const onComputer = args[13] as ((event: { readonly type: string; readonly strategy: string; readonly surface?: string; readonly actionId?: string; readonly candidateId?: string; readonly operation?: string; readonly confidence?: number; readonly candidateCount?: number; readonly success?: boolean; readonly goal?: string; readonly reason?: string; readonly errorCode?: string }) => void) | undefined;
      onComputer?.({ type: "routed", strategy: "auto", surface: "browser", reason: "The request names a URL or browser page interaction." });
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
  assert.match(rendered, /computer · route · browser/u);
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

test("computer task approval labels an admitted task without terminal assurance", () => {
  assert.equal(formatComputerTaskCompletion({ kind: "none", reason: "Calculator result verification is not admitted." }), "none · terminal assurance unavailable");
  assert.equal(formatComputerTaskCompletion({ kind: "none" }, "browser"), "model-directed · answer from fresh page evidence");
  assert.equal(formatComputerTaskCompletion({ kind: "text-present", expected: "Meeting notes" }), "text-present · Meeting notes");
  assert.equal(formatComputerNativeFallback(["structured", "focused-key-text"]), "structured accessibility → focused key/text");
  assert.equal(formatComputerNativeFallback(undefined), undefined);
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
      nativeCatalog: ["Notes", "Calendar", "Clocks", "Calculator", "Settings"],
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
  assert.match(rendered, /Notes · Calendar · Clocks · Calculator · Settings/u);
  assert.match(rendered, /computer_run_inspect/u);
  assert.match(rendered, /4 events/u);
  assert.match(rendered, /computer_artifact_1\.png/u);
});
