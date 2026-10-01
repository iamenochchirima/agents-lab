import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { stableStringify } from "../persistence/json.js";
import { ToolExecutionError } from "../runtime/errors.js";
import { MIN_COMPUTER_CONFIDENCE, type ComputerEnvironmentObservation } from "./contracts.js";
import { ComputerFailureError } from "./failures.js";
import { quotedGoalValue } from "./verification.js";

const MAX_NATIVE_CANDIDATES = 128;
const MAX_NATIVE_LABEL_CHARS = 512;
const MAX_NATIVE_TEXT_CHARS = 1_024;
const MAX_NATIVE_KEY_CHARS = 64;
const MAX_NATIVE_MODIFIERS = 8;
const MAX_NATIVE_SCROLL_AMOUNT = 100;
// CUA's native scroll contract uses bounded line amounts and defaults to three.
const DEFAULT_NATIVE_SCROLL_AMOUNT = 3;
const SENSITIVE_NATIVE_TEXT = /\b(?:password|passcode|one[- ]?time[- ]?code|otp|api[- ]?key|access[- ]?token|secret|private[- ]?key|credential)\b/iu;
const RESTRICTED_NATIVE_TARGET = /\b(?:password|passcode|credential|secret|token|file(?:\s+chooser|\s+picker)?|terminal|console|shell)\b/iu;
const EDITABLE_ROLES = new Set([
  "combo box",
  "combobox",
  "editable text",
  "entry",
  "search box",
  "spin button",
  "text",
  "text area",
  "text box",
  "text field",
  "textarea",
]);
const CLICKABLE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "combobox", "listitem"]);
const NATIVE_KEY_NAMES: Readonly<Record<string, string>> = {
  enter: "return",
  return: "return",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
};
const NATIVE_MODIFIER_NAMES: Readonly<Record<string, string>> = {
  alt: "alt",
  option: "alt",
  cmd: "cmd",
  command: "cmd",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "meta",
  shift: "shift",
  super: "super",
  win: "super",
  windows: "super",
};
const MENU_ITEM_ROLES = new Set(["menu item", "menuitem", "radio menu item", "check menu item"]);
const MENU_CONTAINER_ROLES = new Set(["menu", "menu bar", "menubar", "application", "window"]);

type NativeSemanticCandidateBase = {
  readonly candidateId: string;
  readonly actionId: string;
  readonly elementToken: string;
  readonly role: string;
  readonly label: string;
  readonly source: "accessibility";
  readonly snapshotId?: string;
  /** A Cua application-menu path derived from an observed native action. */
  readonly menuPath?: readonly string[];
  /** Screen-space bounds used only to prove visual/semantic agreement. */
  readonly frame?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/** Source-compiled values that may be bound to a semantically matching live field. */
export type NativeTaskValues = Readonly<Partial<Record<"text" | "date" | "time", string>>>;

export type NativeSemanticCandidate =
  | (NativeSemanticCandidateBase & { readonly operation: "click" })
  | (NativeSemanticCandidateBase & {
    readonly operation: "type";
    /** CUA's preferred semantic route, or its element-bound text fallback. */
    readonly inputMethod: "set_value" | "type_text";
    /** Code-owned task text; it is intentionally excluded from Jev state/evidence. */
    readonly text: string;
    /** Present for values admitted by a compiled task grant. */
    readonly valueKind?: "text" | "date" | "time";
  })
  | (NativeSemanticCandidateBase & {
    readonly operation: "press";
    readonly key: string;
    readonly modifiers?: readonly string[];
  })
  | (NativeSemanticCandidateBase & {
    readonly operation: "scroll";
    readonly direction: "up" | "down" | "left" | "right";
    readonly amount: number;
  });

/**
 * A focused keyboard/text route is narrower than an accessibility candidate.
 * It is available only for an explicit user-supplied value or key and remains
 * bound to the exact observed window. Jev chooses this candidate, but never
 * supplies its text, key, target, or modifiers.
 */
export type NativeFocusedCandidate = {
  readonly candidateId: string;
  readonly actionId: string;
  readonly operation: "type" | "press";
  readonly source: "focused";
  readonly role: "focused-window";
  readonly label: "current focused target";
  readonly snapshotId?: string;
} & ({
  readonly operation: "type";
  readonly text: string;
} | {
  readonly operation: "press";
  readonly key: string;
  readonly modifiers?: readonly string[];
});

export type NativeCandidate = NativeSemanticCandidate | NativeFocusedCandidate;

export interface NativeTypesafeDecision {
  readonly strategy: "typesafe";
  readonly model: string;
  readonly latencyMs: number;
  readonly candidate: NativeCandidate;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface NativeReobserveDecision {
  readonly strategy: "typesafe";
  readonly model: string;
  readonly latencyMs: number;
  readonly reobserve: true;
}

function parseStructured(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value.trim() : undefined;
}

function returnedTypeSafeModel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new ToolExecutionError("TypeSafe returned an invalid model identity.");
  }
  return value.trim();
}

function boundedFrame(value: unknown): NativeSemanticCandidate["frame"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frame = value as Record<string, unknown>;
  const values = ["x", "y", "width", "height"].map((key) => frame[key]);
  if (values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  const [x, y, width, height] = values as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function isClickableRole(role: string): boolean {
  return CLICKABLE_ROLES.has(role.toLowerCase());
}

function normalizedAction(action: string): string {
  return action.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

function elementActions(element: Record<string, unknown>): ReadonlySet<string> {
  const actions = Array.isArray(element.actions)
    ? element.actions.filter((action): action is string => typeof action === "string" && action.length <= 64).map(normalizedAction)
    : [];
  return new Set(actions);
}

function normalizedRole(role: string): string {
  return role.trim().toLowerCase().replace(/[\s_-]+/gu, " ");
}

function observedElementIndex(element: Record<string, unknown>, fallback: number): number {
  const value = element.elementIndex ?? element.element_index;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function observedParentIndex(element: Record<string, unknown>): number | undefined {
  const value = element.parentIndex ?? element.parent_index;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Recover an exact menu path only from the current Cua accessibility tree.
 * The driver resolves every segment again at dispatch time, so this route is
 * safer than translating an application action name into a guessed shortcut.
 */
function observedMenuPath(rawElements: readonly unknown[], targetIndex: number, targetRole: string): readonly string[] | undefined {
  if (!MENU_ITEM_ROLES.has(normalizedRole(targetRole))) return undefined;
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const [index, raw] of rawElements.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const element = raw as Record<string, unknown>;
    const elementIndex = observedElementIndex(element, index);
    if (byIndex.has(elementIndex)) return undefined;
    byIndex.set(elementIndex, element);
  }
  const target = byIndex.get(targetIndex);
  if (!target) return undefined;
  const path: string[] = [];
  const visited = new Set<number>();
  let currentIndex: number | undefined = targetIndex;
  for (let depth = 0; currentIndex !== undefined && depth < 16; depth += 1) {
    if (visited.has(currentIndex)) return undefined;
    visited.add(currentIndex);
    const current = byIndex.get(currentIndex);
    if (!current) return undefined;
    const role = normalizedRole(boundedString(current.role, 64) ?? "");
    const label = boundedString(current.label, MAX_NATIVE_LABEL_CHARS)
      ?? boundedString(current.value, MAX_NATIVE_LABEL_CHARS);
    if (MENU_ITEM_ROLES.has(role)) {
      if (!label) return undefined;
      path.push(label);
    } else if (label && !MENU_CONTAINER_ROLES.has(role)) {
      // A labelled non-menu ancestor would make the inferred path ambiguous.
      return undefined;
    }
    currentIndex = observedParentIndex(current);
  }
  if (currentIndex !== undefined || path.length === 0) return undefined;
  path.reverse();
  return path.length <= 16 ? path : undefined;
}

function isRestrictedElement(element: Record<string, unknown>, role: string, label: string): boolean {
  if (element.hidden === true || element.visible === false || element.occluded === true) return true;
  if (element.password === true || element.credential === true || element.sensitive === true) return true;
  return RESTRICTED_NATIVE_TARGET.test(`${role} ${label}`);
}

function editableMethod(element: Record<string, unknown>, role: string, actions: ReadonlySet<string>): "set_value" | "type_text" | undefined {
  if (element.editable === false) return undefined;
  if (element.editable === true) return actions.has("set_value") ? "set_value" : "type_text";
  if (!EDITABLE_ROLES.has(role) && !actions.has("set_value") && !actions.has("text") && !actions.has("type_text")) return undefined;
  if (actions.has("set_value")) return "set_value";
  return "type_text";
}

function isKeyTarget(actions: ReadonlySet<string>, editable: boolean): boolean {
  // A key is only grounded to an element when CUA exposes an editable or
  // explicitly focusable target. A clickable role alone does not prove which
  // control currently owns keyboard focus.
  return editable || actions.has("focus");
}

function isScrollableTarget(role: string, actions: ReadonlySet<string>): boolean {
  return [...actions].some((action) => /^(?:scroll|scroll(?:up|down|left|right)|scroll(?:forward|backward))$/u.test(action))
    || /\b(?:scroll|list|tree|table|document|pane|viewport)\b/iu.test(role);
}

function requestedNativeText(goal: string | undefined): string | undefined {
  if (!goal) return undefined;
  const text = quotedGoalValue(goal)?.value;
  if (!text || SENSITIVE_NATIVE_TEXT.test(text) || SENSITIVE_NATIVE_TEXT.test(goal)) return undefined;
  return text.length <= MAX_NATIVE_TEXT_CHARS ? text : undefined;
}

function valueForEditableLabel(
  label: string,
  goal: string | undefined,
  taskValues: NativeTaskValues | undefined,
): { readonly kind: "text" | "date" | "time"; readonly value: string } | undefined {
  if (taskValues === undefined) {
    const value = requestedNativeText(goal);
    return value === undefined ? undefined : { kind: "text", value };
  }

  const fieldLabel = label.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  const matches: Array<{ readonly kind: "text" | "date" | "time"; readonly value: string }> = [];
  const add = (kind: "text" | "date" | "time", pattern: RegExp): void => {
    const value = taskValues[kind];
    if (value !== undefined && value.length <= MAX_NATIVE_TEXT_CHARS && pattern.test(fieldLabel)) {
      if (kind !== "text" || (!SENSITIVE_NATIVE_TEXT.test(value) && !SENSITIVE_NATIVE_TEXT.test(goal ?? ""))) {
        matches.push({ kind, value });
      }
    }
  };
  add("text", /\b(?:text|editor|document|note|title|summary|subject|description|message|name|label)\b/iu);
  add("date", /^(?:(?:start|end|event|appointment|reminder) )?(?:date|day)$/u);
  // Match complete date/time field labels so a Time zone field cannot receive
  // an alarm time merely because its label contains the word time.
  add("time", /^(?:(?:alarm|start|end|event|appointment|reminder) )?time$/u);
  return matches.length === 1 ? matches[0] : undefined;
}

function requestedNativeKey(goal: string | undefined): { readonly key: string; readonly modifiers?: readonly string[] } | undefined {
  if (!goal) return undefined;
  const match = goal.match(/\b(?:press|hit|send)\s+(?<combo>(?:(?:ctrl|control|shift|alt|option|cmd|command|meta|super|win|windows)\s*\+\s*)?(?:enter|return|tab|escape|esc|space|backspace|delete|arrow\s*up|arrow\s*down|arrow\s*left|arrow\s*right|up|down|left|right)(?:\s+key)?)\b/iu);
  const raw = match?.groups?.combo?.replace(/\s+key$/iu, "").trim();
  if (!raw) return undefined;
  const parts = raw.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = NATIVE_KEY_NAMES[parts.at(-1)!.replace(/\s+/gu, "")] ;
  if (!key || key.length > MAX_NATIVE_KEY_CHARS) return undefined;
  const modifiers = parts.slice(0, -1).map((part) => NATIVE_MODIFIER_NAMES[part]).filter((modifier): modifier is string => modifier !== undefined);
  if (modifiers.length !== parts.length - 1 || modifiers.length > MAX_NATIVE_MODIFIERS) return undefined;
  return modifiers.length > 0 ? { key, modifiers } : { key };
}

function requestedNativeScroll(goal: string | undefined): { readonly direction: "up" | "down" | "left" | "right"; readonly amount: number } | undefined {
  if (!goal) return undefined;
  const match = goal.match(/\bscroll\s+(?<direction>up|down|left|right)(?<tail>[^\r\n.!?]*)/iu);
  if (!match?.groups) return undefined;
  const direction = match.groups.direction.toLowerCase() as "up" | "down" | "left" | "right";
  const tail = match.groups.tail.trim();
  if (tail.length === 0 || /^(?:the\s+)?(?:page|window)$/iu.test(tail)) return { direction, amount: DEFAULT_NATIVE_SCROLL_AMOUNT };
  const amountMatch = tail.match(/^(?:by\s+)?(?<amount>[0-9]{1,3})\s*(?:lines?|ticks?)$/iu);
  if (!amountMatch?.groups) return undefined;
  const amount = Number(amountMatch.groups.amount);
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_NATIVE_SCROLL_AMOUNT ? { direction, amount } : undefined;
}

function candidateId(operation: NativeSemanticCandidate["operation"], index: number): string {
  return `native_accessibility_${operation}_${index}`;
}

function isDocumentPreparationLabel(label: string): boolean {
  return /^(?:new\s+(?:tab|document|note|file)|create\s+(?:document|note))$/iu.test(label.trim());
}

function nativeCandidateDescription(candidate: NativeCandidate): string {
  if (candidate.source === "focused") {
    return candidate.operation === "type"
      ? `Type the task-approved text into the current focused target (${candidate.label}).`
      : `Press ${candidate.modifiers?.join("+") ?? ""}${candidate.modifiers ? "+" : ""}${candidate.key} on the current focused target.`;
  }
  const target = `${candidate.role} labelled \"${candidate.label}\"`;
  switch (candidate.operation) {
    case "click":
      if (candidate.menuPath) return `Open the observed native application command "${candidate.label}" through Cua's exact menu path.`;
      // This is a bounded interpretation of a conventional editor control;
      // it gives Jev useful semantics without exposing a token or inventing a
      // target. The action is still accepted only if Cua exposed this exact
      // live element.
      return /^new\s+tab$/iu.test(candidate.label)
        ? `Click the ${target} to open a new editable document tab.`
        : `Click the ${target}.`;
    case "type":
      return candidate.valueKind === "date" || candidate.valueKind === "time"
        ? `${candidate.inputMethod === "set_value" ? "Replace the value of" : "Type into"} the ${target} using the task-approved ${candidate.valueKind} value.`
        : `${candidate.inputMethod === "set_value" ? "Replace the value of" : "Type into"} the ${target} using the task-approved text.`;
    case "press":
      return `Press ${candidate.modifiers?.join("+") ?? ""}${candidate.modifiers ? "+" : ""}${candidate.key} on the ${target}.`;
    case "scroll":
      return `Scroll the ${target} ${candidate.direction} by ${candidate.amount} bounded lines.`;
  }
}

/**
 * Build a closed candidate set from CUA's accessibility snapshot. The model
 * can select an existing token only; it cannot manufacture a selector or
 * coordinate. If the host did not provide a semantic snapshot, this returns
 * an empty set. The runner may consider a separately configured, Cua-bound
 * visual route only after its own capability and grant checks; this builder
 * never smuggles in OCR or a guessed desktop position.
 */
export function nativeAccessibilityCandidates(
  observation: ComputerEnvironmentObservation,
  goal?: string,
  excludedActionIds: ReadonlySet<string> = new Set(),
  taskValues?: NativeTaskValues,
): readonly NativeSemanticCandidate[] {
  const root = parseStructured(observation.structuredJson);
  const accessibility = root?.accessibility;
  if (!accessibility || typeof accessibility !== "object" || Array.isArray(accessibility)) return [];
  const rawElements = (accessibility as Record<string, unknown>).elements;
  if (!Array.isArray(rawElements)) return [];
  const snapshotId = boundedString((accessibility as Record<string, unknown>).snapshotId, 256) ?? observation.windowSnapshotId;
  const text = taskValues === undefined ? requestedNativeText(goal) : taskValues.text;
  const key = requestedNativeKey(goal);
  const scroll = requestedNativeScroll(goal);
  const candidates: NativeSemanticCandidate[] = [];
  const add = (candidate: NativeSemanticCandidate): void => {
    if (candidates.length < MAX_NATIVE_CANDIDATES) candidates.push(candidate);
  };
  for (const [index, raw] of rawElements.slice(0, MAX_NATIVE_CANDIDATES).entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const element = raw as Record<string, unknown>;
    const token = boundedString(element.elementToken, 256);
    const role = boundedString(element.role, 64);
    if (!token || !role || element.enabled === false) continue;
    const label = boundedString(element.label, MAX_NATIVE_LABEL_CHARS) ?? boundedString(element.value, MAX_NATIVE_LABEL_CHARS) ?? role;
    if (isRestrictedElement(element, normalizedRole(role), label)) continue;
    const actions = elementActions(element);
    const frame = boundedFrame(element.frame);
    const elementIndex = observedElementIndex(element, index);
    const menuPath = observedMenuPath(rawElements, elementIndex, normalizedRole(role));
    const base = {
      elementToken: token,
      role,
      label,
      source: "accessibility" as const,
      ...(snapshotId ? { snapshotId } : {}),
      ...(frame ? { frame } : {}),
    };
    const editable = editableMethod(element, normalizedRole(role), actions);
    const result: NativeSemanticCandidate[] = [];
    if ((actions.has("click") || actions.has("invoke") || actions.has("press") || actions.has("activate") || isClickableRole(normalizedRole(role)))) {
      const actionId = candidateId("click", index);
      result.push({ candidateId: actionId, actionId, operation: "click", ...base, ...(menuPath ? { menuPath } : {}) });
    }
    const editableValue = editable ? valueForEditableLabel(label, goal, taskValues) : undefined;
    if (editable && editableValue !== undefined) {
      const actionId = candidateId("type", index);
      result.push({
        candidateId: actionId,
        actionId,
        operation: "type",
        inputMethod: editable,
        text: editableValue.value,
        ...(taskValues !== undefined ? { valueKind: editableValue.kind } : {}),
        ...base,
      });
    }
    if (key && isKeyTarget(actions, editable !== undefined)) {
      const actionId = candidateId("press", index);
      result.push({ candidateId: actionId, actionId, operation: "press", key: key.key, ...(key.modifiers ? { modifiers: key.modifiers } : {}), ...base });
    }
    if (scroll && isScrollableTarget(normalizedRole(role), actions)) {
      const actionId = candidateId("scroll", index);
      result.push({ candidateId: actionId, actionId, operation: "scroll", direction: scroll.direction, amount: scroll.amount, ...base });
    }
    for (const candidate of result) add(candidate);
  }
  const available = candidates.filter((candidate) => !excludedActionIds.has(candidate.actionId));
  // A newly launched text editor can expose its welcome controls before it
  // exposes any editable element. Offer only an exact document-creation
  // control in that state; sending unrelated window chrome to Jev lowers
  // decision quality without adding a valid path to the approved text task.
  if (text !== undefined && !available.some((candidate) => candidate.operation === "type")) {
    const preparation = available.filter((candidate) => candidate.operation === "click" && isDocumentPreparationLabel(candidate.label));
    if (preparation.length > 0) return preparation;
  }
  return available;
}

/**
 * Build the bounded focused-input rung used after structured accessibility
 * candidates are unavailable. The route is intentionally not a general
 * keyboard controller: only a quoted, non-sensitive value or an explicit
 * bounded key combination from the goal can become a candidate.
 */
export function nativeFocusedCandidates(
  observation: ComputerEnvironmentObservation,
  goal?: string,
  excludedActionIds: ReadonlySet<string> = new Set(),
): readonly NativeFocusedCandidate[] {
  if (observation.windowPid === undefined || !observation.windowId) return [];
  const candidates: NativeFocusedCandidate[] = [];
  const text = requestedNativeText(goal);
  const key = requestedNativeKey(goal);
  if (text !== undefined && !excludedActionIds.has("native_focused_type")) {
    candidates.push({
      candidateId: "native_focused_type",
      actionId: "native_focused_type",
      operation: "type",
      source: "focused",
      role: "focused-window",
      label: "current focused target",
      ...(observation.windowSnapshotId ? { snapshotId: observation.windowSnapshotId } : {}),
      text,
    });
  }
  if (key && !excludedActionIds.has("native_focused_press")) {
    candidates.push({
      candidateId: "native_focused_press",
      actionId: "native_focused_press",
      operation: "press",
      source: "focused",
      role: "focused-window",
      label: "current focused target",
      ...(observation.windowSnapshotId ? { snapshotId: observation.windowSnapshotId } : {}),
      key: key.key,
      ...(key.modifiers ? { modifiers: key.modifiers } : {}),
    });
  }
  return candidates;
}

function safeProbabilities(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, probability]) =>
    key.length <= 256 && typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1,
  ).slice(0, MAX_NATIVE_CANDIDATES + 1));
}

export async function nativeTypesafeDecision(input: {
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly goal: string;
  readonly observation: ComputerEnvironmentObservation;
  readonly excludedActionIds?: ReadonlySet<string>;
  /** Source-compiled values; when present, editable targets must match their semantic field. */
  readonly taskValues?: NativeTaskValues;
  /** Select the focused rung only after a fresh observation proves the prior route unavailable. */
  readonly preferFocused?: boolean;
  /** Task-grant admission for the focused keyboard/text fallback. */
  readonly allowFocusedFallback?: boolean;
  readonly signal?: AbortSignal;
}): Promise<NativeTypesafeDecision | NativeReobserveDecision | undefined> {
  if (!input.apiKey) throw new ToolExecutionError("The native TypeSafe computer strategy requires TYPESAFE_API_KEY.");
  const structuredCandidates = nativeAccessibilityCandidates(input.observation, input.goal, input.excludedActionIds, input.taskValues);
  const allowFocusedFallback = input.allowFocusedFallback !== false;
  const candidates: readonly NativeCandidate[] = input.preferFocused && allowFocusedFallback
    ? nativeFocusedCandidates(input.observation, input.goal, input.excludedActionIds)
    : structuredCandidates.length > 0
      ? structuredCandidates
      : allowFocusedFallback
        ? nativeFocusedCandidates(input.observation, input.goal, input.excludedActionIds)
        : [];
  if (candidates.length === 0) return undefined;
  if (input.observation.windowPid === undefined || !input.observation.windowId) {
    throw new ToolExecutionError("Native TypeSafe computer use requires an exact accessible foreground window; CUA did not provide one.");
  }
  const labels: Record<string, string> = Object.fromEntries([
    ...candidates.map((candidate) => [candidate.actionId, nativeCandidateDescription(candidate)]),
    ["reobserve", "Discard this decision set and obtain a fresh Cua accessibility observation."],
    ["abstain", "Stop without acting because no proposed action is safe, relevant, or sufficiently grounded."],
  ]);
  const root = parseStructured(input.observation.structuredJson);
  const accessibility = root?.accessibility as Record<string, unknown> | undefined;
  const focusedCandidateExposed = candidates.some((candidate) => candidate.source === "focused");
  const editableCandidateExposed = candidates.some((candidate) => candidate.operation === "type");
  const documentPreparationExposed = candidates.some((candidate) => candidate.operation === "click" && isDocumentPreparationLabel(candidate.label));
  const menuCandidateExposed = candidates.some((candidate) => candidate.source === "accessibility" && candidate.menuPath !== undefined);
  const actionPhase = focusedCandidateExposed
    ? "Structured accessibility did not expose a usable candidate; choose only the explicit bounded focused keyboard/text action or abstain."
    : editableCandidateExposed
    ? "An editable native target is exposed; choose the bounded type action that advances the approved text task."
    : documentPreparationExposed
      ? "The editor welcome screen is exposed; the exact document-preparation control is the bounded next action before typing."
      : menuCandidateExposed
        ? "An exact Cua application-menu path is exposed; choose the menu candidate whose complete path directly advances the approved goal. Do not abstain merely because the final form is not open yet."
      : "No editable native target is exposed; choose only a clearly relevant bounded action or abstain.";
  const model = input.model ?? "jev-latest";
  const decisionStartedAt = Date.now();
  const client = new TypeSafeClient({
    apiKey: input.apiKey,
    defaultModel: model,
    retry: { maxRetries: 0 },
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
  });
  const response = await client.systemOne({
    model,
    state: {
      goal: input.goal,
      environment: "ubuntu-x11-cua",
      windowTitle: boundedString(accessibility?.windowTitle, 512) ?? "",
      appName: boundedString(accessibility?.appName, 128) ?? "",
      actionPhase,
      accessibilityCandidates: labels,
      observationText: input.observation.text.slice(0, 4_000),
    },
    questions: {
      target: choice("Which complete executable action should Cua run next toward the approved goal? Prefer an exact observed menu path when it directly opens the needed native form; a visible preparatory control may be selected when it safely advances the goal and the final target is not exposed yet. Choose abstain only when no proposed action is safe, relevant, or sufficiently grounded.", labels),
    },
  }, { signal: input.signal, timeout: 20_000 });
  const resolvedModel = returnedTypeSafeModel(response.model);
  const selected = response.answers.target.choice;
  if (selected === "abstain") return undefined;
  if (selected === "reobserve") {
    const confidence = response.answers.target.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < MIN_COMPUTER_CONFIDENCE || confidence > 1) {
      throw new ComputerFailureError("computer-confidence-abstention", `Native Jev requested re-observation below the ${MIN_COMPUTER_CONFIDENCE} safety threshold.`);
    }
    return { strategy: "typesafe", model: resolvedModel, latencyMs: Math.max(0, Date.now() - decisionStartedAt), reobserve: true };
  }
  if (typeof selected !== "string") throw new ToolExecutionError("TypeSafe returned an invalid native candidate selection.");
  const candidate = candidates.find((value) => value.actionId === selected);
  if (!candidate) throw new ToolExecutionError("TypeSafe selected a native candidate that was not present in the current accessibility snapshot.");
  const confidence = response.answers.target.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < MIN_COMPUTER_CONFIDENCE || confidence > 1) {
    throw new ComputerFailureError("computer-confidence-abstention", `Native Jev abstained because its confidence was below the ${MIN_COMPUTER_CONFIDENCE} safety threshold.`);
  }
  return {
    strategy: "typesafe",
    model: resolvedModel,
    latencyMs: Math.max(0, Date.now() - decisionStartedAt),
    candidate,
    confidence,
    probabilities: safeProbabilities(response.answers.target.probabilities),
  };
}

/**
 * A visual coordinate and an accessibility target agree only when CUA supplied
 * a bounded screen-space frame containing that coordinate. Matching operation
 * names alone is insufficient: executing a visual click when Jev selected a
 * different control would make compare mode unsafe.
 */
export function nativeSelectionsAgree(
  selection: { readonly operation: string; readonly x?: number; readonly y?: number },
  candidate: NativeSemanticCandidate,
): boolean {
  if (selection.operation !== "click" || candidate.operation !== "click" || !candidate.frame) return false;
  if (selection.x === undefined || selection.y === undefined) return false;
  return selection.x >= candidate.frame.x
    && selection.y >= candidate.frame.y
    && selection.x <= candidate.frame.x + candidate.frame.width
    && selection.y <= candidate.frame.y + candidate.frame.height;
}

export function nativeTypesafeEvidence(decision: NativeTypesafeDecision): string {
  return stableStringify({
    candidateId: decision.candidate.candidateId,
    source: decision.candidate.source,
    role: decision.candidate.role,
    label: decision.candidate.label,
    operation: decision.candidate.operation,
    ...(decision.candidate.source === "accessibility" && decision.candidate.operation === "type" ? { inputMethod: decision.candidate.inputMethod } : {}),
    ...(decision.candidate.operation === "press" ? { key: decision.candidate.key, ...(decision.candidate.modifiers ? { modifiers: decision.candidate.modifiers } : {}) } : {}),
    ...(decision.candidate.operation === "scroll" ? { direction: decision.candidate.direction, amount: decision.candidate.amount } : {}),
    ...(decision.candidate.source === "accessibility" && decision.candidate.menuPath ? { menuPath: decision.candidate.menuPath } : {}),
    confidence: decision.confidence,
    probabilities: decision.probabilities,
    ...(decision.candidate.source === "accessibility" && decision.candidate.frame ? { frame: decision.candidate.frame } : {}),
  });
}
