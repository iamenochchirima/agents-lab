import assert from "node:assert/strict";
import test from "node:test";
import type { ComputerEnvironmentObservation } from "../src/computer/contracts.js";
import { nativeAccessibilityCandidates, nativeFocusedCandidates, nativeTypesafeDecision, type NativeSemanticCandidate } from "../src/computer/native-strategy.js";

function observation(elements: readonly Record<string, unknown>[]): ComputerEnvironmentObservation {
  return {
    observationId: "observation-native-strategy",
    environment: "ubuntu-x11-cua",
    sessionId: "native-strategy-test",
    generation: 7,
    text: "A bounded native accessibility observation.",
    structuredJson: JSON.stringify({
      accessibility: {
        snapshotId: "snapshot-native-strategy",
        elements,
      },
    }),
    imageCount: 0,
    imageBytes: 0,
    windowPid: 9001,
    windowId: "42",
    windowSnapshotId: "snapshot-native-strategy",
  };
}

test("native semantic candidates build bounded click, type, key, and scroll choices from CUA state", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "button-1", role: "button", label: "Save", enabled: true, actions: ["invoke"] },
    { elementToken: "entry-1", role: "entry", label: "Title", enabled: true, actions: ["set_value"], frame: { x: 10, y: 20, width: 200, height: 30 } },
    { elementToken: "scroll-1", role: "scroll pane", label: "Results", enabled: true, actions: ["scrolldown", "scrollup"], frame: { x: 0, y: 60, width: 400, height: 300 } },
    { elementToken: "disabled-entry", role: "entry", label: "Disabled", enabled: false, actions: ["set_value"] },
    { elementToken: "password-entry", role: "entry", label: "Password", enabled: true, actions: ["set_value"] },
    { elementToken: "file-entry", role: "file chooser", label: "Upload file", enabled: true, actions: ["set_value"] },
    { elementToken: "terminal-entry", role: "terminal", label: "Terminal", enabled: true, actions: ["set_value"] },
  ]), 'Type "Project update", press Enter, and scroll down by 5 lines.');

  assert.deepEqual(candidates.map((candidate) => candidate.operation), ["click", "type", "press", "scroll"]);
  const typeCandidates = candidates.filter((candidate): candidate is Extract<NativeSemanticCandidate, { readonly operation: "type" }> => candidate.operation === "type");
  const pressCandidates = candidates.filter((candidate): candidate is Extract<NativeSemanticCandidate, { readonly operation: "press" }> => candidate.operation === "press");
  const scrollCandidates = candidates.filter((candidate): candidate is Extract<NativeSemanticCandidate, { readonly operation: "scroll" }> => candidate.operation === "scroll");
  assert.deepEqual(candidates[0], {
    candidateId: "native_accessibility_click_0",
    actionId: "native_accessibility_click_0",
    operation: "click",
    elementToken: "button-1",
    role: "button",
    label: "Save",
    source: "accessibility",
    snapshotId: "snapshot-native-strategy",
  });
  assert.equal(typeCandidates[0]?.inputMethod, "set_value");
  assert.equal(typeCandidates[0]?.text, "Project update");
  assert.deepEqual(pressCandidates[0] && {
    key: pressCandidates[0].key,
    modifiers: pressCandidates[0].modifiers,
    elementToken: pressCandidates[0].elementToken,
  }, { key: "return", modifiers: undefined, elementToken: "entry-1" });
  assert.deepEqual(scrollCandidates[0] && {
    direction: scrollCandidates[0].direction,
    amount: scrollCandidates[0].amount,
    elementToken: scrollCandidates[0].elementToken,
  }, { direction: "down", amount: 5, elementToken: "scroll-1" });
  assert.equal(candidates.some((candidate) => ["disabled-entry", "password-entry", "file-entry", "terminal-entry"].includes(candidate.elementToken)), false);
});

test("native semantic candidates prefer set_value and reject unbounded or unrequested input", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "set-value", role: "text field", label: "Name", enabled: true, actions: ["set_value", "text"] },
    { elementToken: "type-text", role: "editable text", label: "Description", enabled: true, actions: ["text"] },
    { elementToken: "not-editable", role: "label", label: "Description", enabled: true, actions: [] },
    { elementToken: "scrollable", role: "scroll pane", label: "Results", enabled: true, actions: ["scrollforward"] },
  ]), 'Type "hello" and scroll down by 101 lines.');
  const typeCandidates = candidates.filter((candidate): candidate is Extract<NativeSemanticCandidate, { readonly operation: "type" }> => candidate.operation === "type");

  assert.deepEqual(candidates.map((candidate) => candidate.operation), ["type", "type"]);
  assert.equal(typeCandidates[0]?.inputMethod, "set_value");
  assert.equal(typeCandidates[1]?.inputMethod, "type_text");
  assert.equal(candidates.some((candidate) => candidate.elementToken === "scrollable"), false);

  const unrequested = nativeAccessibilityCandidates(observation([
    { elementToken: "entry", role: "entry", label: "Name", enabled: true, actions: ["set_value"] },
    { elementToken: "scrollable", role: "scroll pane", label: "Results", enabled: true, actions: ["scrollforward"] },
  ]));
  assert.deepEqual(unrequested.map((candidate) => candidate.operation), []);
});

test("compiled native values are offered only to matching accessibility fields", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "title", role: "entry", label: "Event title", enabled: true, editable: true, actions: ["set_value"] },
    { elementToken: "date", role: "entry", label: "Start date", enabled: true, editable: true, actions: ["set_value"] },
    { elementToken: "time", role: "spin button", label: "Alarm time", enabled: true, editable: true, actions: ["set_value"] },
    { elementToken: "zone", role: "entry", label: "Time zone", enabled: true, editable: true, actions: ["set_value"] },
    { elementToken: "unlabelled", role: "entry", label: "Value", enabled: true, editable: true, actions: ["set_value"] },
  ]), "Create an event called \"Planning\" tomorrow at 7:30.", new Set(), {
    text: "Planning",
    date: "2026-09-24",
    time: "07:30",
  });

  assert.deepEqual(candidates.filter((candidate) => candidate.operation === "type").map((candidate) => ({
    elementToken: candidate.elementToken,
    valueKind: candidate.valueKind,
    text: candidate.text,
  })), [
    { elementToken: "title", valueKind: "text", text: "Planning" },
    { elementToken: "date", valueKind: "date", text: "2026-09-24" },
    { elementToken: "time", valueKind: "time", text: "07:30" },
  ]);
});

test("native focused fallback offers only explicit bounded text or key input when accessibility has no usable candidate", () => {
  const candidates = nativeFocusedCandidates(
    observation([]),
    'Type "Meeting notes" into the focused editor, then press Ctrl+Enter.',
  );

  assert.deepEqual(candidates.map((candidate) => ({
    actionId: candidate.actionId,
    operation: candidate.operation,
    source: candidate.source,
    ...(candidate.operation === "type" ? { text: candidate.text } : {}),
    ...(candidate.operation === "press" ? { key: candidate.key, modifiers: candidate.modifiers } : {}),
  })), [
    { actionId: "native_focused_type", operation: "type", source: "focused", text: "Meeting notes" },
    { actionId: "native_focused_press", operation: "press", source: "focused", key: "return", modifiers: ["ctrl"] },
  ]);
});

test("native focused fallback does not turn an implicit goal or sensitive text into keyboard input", () => {
  assert.deepEqual(nativeFocusedCandidates(observation([]), "Create a calendar event."), []);
  assert.deepEqual(nativeFocusedCandidates(observation([]), 'Type "my password" into the focused field.'), []);
});

test("native text tasks narrow a welcome screen to its exact document-preparation control", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "open", role: "button", label: "Open", enabled: true, actions: ["click"] },
    { elementToken: "new-tab", role: "button", label: "New tab", enabled: true, actions: ["click"] },
    { elementToken: "menu", role: "button", label: "Main menu", enabled: true, actions: ["click"] },
  ]), 'Create a new document with "Meeting notes".');

  assert.deepEqual(candidates.map((candidate) => ({ operation: candidate.operation, label: candidate.label })), [
    { operation: "click", label: "New tab" },
  ]);
});

test("native native-app creation does not guess an accelerator when CUA exposes only an application GAction", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    {
      elementToken: "calendar-app",
      role: "application",
      label: "Calendar",
      enabled: true,
      actions: ["win.new-event", "window.close"],
    },
  ]), 'Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.');

  assert.deepEqual(candidates, []);
});

test("native app creation keeps a current structured control available before an editable target appears", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "calendar-app", role: "application", label: "Calendar", enabled: true, actions: ["win.new-event"] },
    { elementToken: "new-event", role: "button", label: "New Event", enabled: true, actions: ["invoke"] },
  ]), 'Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.');

  assert.deepEqual(candidates.map((candidate) => ({ operation: candidate.operation, elementToken: candidate.elementToken })), [
    { operation: "click", elementToken: "new-event" },
  ]);
});

test("native app creation does not synthesize an accelerator from an unrelated or unobserved action", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "calendar-app", role: "application", label: "Calendar", enabled: true, actions: ["win.open-online-accounts"] },
    { elementToken: "other-app", role: "application", label: "Other", enabled: true, actions: ["win.new-event"] },
  ]), 'Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.');
  assert.deepEqual(candidates, []);
});

test("native menu candidates preserve an exact current CUA menu path", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "menu-bar", elementIndex: 0, role: "menu bar", label: "Application", enabled: true },
    { elementToken: "file", elementIndex: 1, parentIndex: 0, role: "menu item", label: "File", enabled: true, actions: ["click"] },
    { elementToken: "new-event", elementIndex: 2, parentIndex: 1, role: "menu item", label: "New Event", enabled: true, actions: ["click"] },
  ]), "Create a calendar event.");

  const menuCandidate = candidates.find((candidate) => candidate.label === "New Event");
  assert.deepEqual(menuCandidate && {
    operation: menuCandidate.operation,
    menuPath: menuCandidate.menuPath,
  }, { operation: "click", menuPath: ["File", "New Event"] });
});

test("native menu candidates fail closed when an observed menu lineage is ambiguous", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "file", elementIndex: 1, role: "menu item", label: "File", enabled: true, actions: ["click"] },
    { elementToken: "wrapper", elementIndex: 2, parentIndex: 1, role: "button", label: "Untrusted wrapper", enabled: true, actions: ["click"] },
    { elementToken: "new-event", elementIndex: 3, parentIndex: 2, role: "menu item", label: "New Event", enabled: true, actions: ["click"] },
  ]), "Create a calendar event.");

  assert.equal(candidates.find((candidate) => candidate.label === "New Event")?.menuPath, undefined);
});

test("native candidates retain explicitly editable document targets even when the role is generic", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "document-text", role: "document", label: "New Document", editable: true, enabled: true, actions: [] },
  ]), 'Type "Meeting notes" into the new document.');

  assert.deepEqual(candidates.map((candidate) => ({ operation: candidate.operation, inputMethod: candidate.operation === "type" ? candidate.inputMethod : undefined })), [
    { operation: "type", inputMethod: "type_text" },
  ]);
});

test("native candidates treat CUA's text box role as an editable semantic target", () => {
  const candidates = nativeAccessibilityCandidates(observation([
    { elementToken: "editor-text", role: "text box", label: "", enabled: true, actions: [] },
  ]), 'Type "Meeting notes" into the new document.');

  assert.deepEqual(candidates.map((candidate) => ({ operation: candidate.operation, inputMethod: candidate.operation === "type" ? candidate.inputMethod : undefined })), [
    { operation: "type", inputMethod: "type_text" },
  ]);
});

test("native Jev chooses an existing semantic candidate without receiving the code-owned text", async () => {
  let request: Record<string, unknown> | undefined;
  const decision = await nativeTypesafeDecision({
    apiKey: "typesafe-test-key",
    goal: 'Type "Project update" into the title field.',
    observation: observation([
      { elementToken: "entry-1", role: "entry", label: "Title", enabled: true, actions: ["set_value"] },
    ]),
    fetchImpl: async (_input, init) => {
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "jev-resolved-2026-09-01",
        answers: { target: { type: "choice", choice: "native_accessibility_type_0", confidence: 0.95, probabilities: { native_accessibility_type_0: 0.95 } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const typeDecision = decision && "candidate" in decision && decision.candidate.operation === "type" ? decision.candidate : undefined;
  assert.equal(typeDecision?.operation, "type");
  assert.equal(decision?.model, "jev-resolved-2026-09-01");
  assert.equal(typeDecision?.text, "Project update");
  const state = request?.state as { readonly actionPhase?: string; readonly accessibilityCandidates?: Record<string, string> } | undefined;
  assert.equal(state?.actionPhase, "An editable native target is exposed; choose the bounded type action that advances the approved text task.");
  assert.equal(state?.accessibilityCandidates?.native_accessibility_type_0, "Replace the value of the entry labelled \"Title\" using the task-approved text.");
  assert.equal(state?.accessibilityCandidates?.reobserve, "Discard this decision set and obtain a fresh Cua accessibility observation.");
  assert.equal(state?.accessibilityCandidates?.abstain, "Stop without acting because no proposed action is safe, relevant, or sufficiently grounded.");
});

test("native Jev can request a bounded fresh accessibility observation", async () => {
  const decision = await nativeTypesafeDecision({
    apiKey: "typesafe-test-key",
    goal: "Reveal the safe result.",
    observation: observation([
      { elementToken: "button-1", role: "button", label: "Reveal", enabled: true, actions: ["invoke"] },
    ]),
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "reobserve", confidence: 0.95, probabilities: { reobserve: 0.95 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(decision && "reobserve" in decision ? { reobserve: decision.reobserve, model: decision.model } : undefined, { reobserve: true, model: "jev-latest" });
});
