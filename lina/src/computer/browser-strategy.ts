/**
 * The model-facing part of the fast browser strategy.
 *
 * The browser adapter owns the live locator and freshness checks. This module
 * only turns one bounded, current snapshot into an allow-listed action space.
 * A model can select an action id from this space, but it cannot invent a
 * selector, coordinate, script, or target outside the observation.
 */

export type ComputerBrowserPointerOperation = "hover" | "right_click" | "double_click" | "drag";
export type ComputerBrowserOperation = "click" | "type" | "press" | "select" | "scroll" | "wait" | "upload" | ComputerBrowserPointerOperation | "blocked";

export type ComputerBrowserScrollDirection = "up" | "down" | "left" | "right";

export interface BrowserStrategyReference {
  readonly value: string;
  readonly documentId: string;
  /** Cua semantic_v2's closed action declaration for this ref. */
  readonly actions?: readonly string[];
  /** Current editable value exposed by semantic_v2, when available. */
  readonly currentValue?: string;
  /** Optional semantic identity retained by the snapshot boundary. */
  readonly role?: string;
  readonly name?: string;
  readonly label?: string;
  readonly type?: string;
  /** Code-owned drag destination retained from the same snapshot. */
  readonly destinationRef?: string;
}

export interface BrowserStrategySnapshot {
  readonly documentId: string;
  readonly content: string;
  readonly references: readonly BrowserStrategyReference[];
  readonly goal?: string;
}

export interface ComputerBrowserAction {
  readonly actionId: string;
  readonly candidateId: string;
  readonly operation: ComputerBrowserOperation;
  readonly ref: string;
  readonly role: string;
  readonly label: string;
  readonly documentId: string;
  /** Only present on the synthetic, user-requested wait action. */
  readonly milliseconds?: number;
  /** Only present on the synthetic, user-requested scroll action. */
  readonly direction?: ComputerBrowserScrollDirection;
  readonly amount?: number;
  /** Only present for a declared drag action with a current destination ref. */
  readonly destinationRef?: string;
  readonly reason?: string;
}

const MAX_DESCRIPTION_CHARS = 512;
const MAX_ACTIONS = 256;
const MAX_BROWSER_WAIT_MS = 10_000;
const MAX_BROWSER_SCROLL_PIXELS = 2_000;
const DEFAULT_BROWSER_SCROLL_PIXELS = 600;
const MAX_BROWSER_QUERY_CHARS = 96;
const INPUT_TYPES = new Set(["button", "checkbox", "color", "date", "datetime-local", "email", "file", "hidden", "month", "number", "password", "radio", "range", "search", "submit", "tel", "text", "time", "url", "week"]);
const POINTER_OPERATIONS: readonly ComputerBrowserPointerOperation[] = ["hover", "right_click", "double_click", "drag"];
const INTERACTIVE_ROLES = new Set(["button", "a", "link", "checkbox", "radio", "input", "textarea"]);

const BROWSER_KEYS: Readonly<Record<string, string>> = {
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

function browserQueryText(value: string): string | undefined {
  const normalized = value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\s+(?:field|box|input|button|link|menu|tab|control|form)$/iu, "")
    .trim();
  return normalized ? normalized.slice(0, MAX_BROWSER_QUERY_CHARS) : undefined;
}

/**
 * Derive a bounded Cua semantic query from a control the user explicitly
 * named. The query only narrows a read. It never supplies an action argument,
 * and quoted values intended for typing are removed before extraction.
 */
export function requestedBrowserQuery(goal: string): string | undefined {
  const withoutUrls = goal.replace(/https?:\/\/[^\s)\]}>,;]+/giu, " ");
  const quotedControl = withoutUrls.match(/\b(?:button|link|tab|menu|field|box|input|control|form)\s+(?:labelled|labeled|named|called)\s+["“](?<label>[^"”\r\n]{1,64})[”"]?/iu);
  const quotedActionTarget = withoutUrls.match(/\b(?:click|open|follow|choose|select|hover)\s+(?:on\s+)?(?:the\s+)?["“](?<label>[^"”\r\n]{1,64})[”"]\s+(?<kind>button|link|tab|menu|field|box|input|control|form)\b/iu);
  const control = quotedActionTarget?.groups?.label && quotedActionTarget.groups.kind
    ? `${quotedActionTarget.groups.label} ${quotedActionTarget.groups.kind}`
    : quotedControl?.groups?.label
      ? quotedControl.groups.label
      : undefined;
  if (control) return browserQueryText(control);

  const withoutQuotedValues = withoutUrls.replace(/["“][^"”\r\n]{0,512}[”"]/gu, " ").replace(/'[^'\r\n]{0,512}'/gu, " ");
  const describedControl = withoutQuotedValues.match(/\b(?:in|into|on|at|from)\s+(?:the\s+)?(?<target>[a-z][a-z0-9' -]{0,64}?\b(?:field|box|input|button|link|menu|tab|control|form))\b/iu);
  if (describedControl?.groups?.target) {
    return browserQueryText(describedControl.groups.target);
  }

  if (/\b(?:search|look\s+up|find)\b/iu.test(withoutQuotedValues)) return "search";
  return undefined;
}

/** Extract only a small, user-requested browser key set; models cannot invent keys. */
export function requestedBrowserKey(goal: string): string | undefined {
  const match = goal.match(/\b(?:press|hit|send)\s+(?:the\s+)?(?<key>enter|tab|escape|esc|space|backspace|delete|arrow\s*up|arrow\s*down|arrow\s*left|arrow\s*right)(?:\s+key)?\b/iu);
  const key = match?.groups?.key?.replace(/\s+/gu, "").toLowerCase();
  return key ? BROWSER_KEYS[key] : undefined;
}

/**
 * Extract a bounded wait requested by the user. The model never chooses the
 * duration: it can only select the synthetic action carrying this value.
 */
export function requestedBrowserWait(goal: string): number | undefined {
  const match = goal.match(/\bwait(?:\s+for)?\s+(?<amount>[0-9]{1,6})\s*(?<unit>milliseconds?|ms|seconds?|sec|s)\b/iu);
  if (!match?.groups) return undefined;
  const amount = Number(match.groups.amount);
  if (!Number.isSafeInteger(amount)) return undefined;
  const unit = match.groups.unit.toLowerCase();
  const milliseconds = /^(?:seconds?|sec|s)$/u.test(unit) ? amount * 1_000 : amount;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= MAX_BROWSER_WAIT_MS
    ? milliseconds
    : undefined;
}

/** Extract one bounded, user-requested viewport scroll; models cannot invent it. */
export function requestedBrowserScroll(goal: string): { readonly direction: ComputerBrowserScrollDirection; readonly amount: number } | undefined {
  const match = goal.match(/\bscroll\s+(?<direction>up|down|left|right)(?<tail>[^\r\n.!?]*)/iu);
  if (!match?.groups) return undefined;
  const direction = match.groups.direction.toLowerCase() as ComputerBrowserScrollDirection;
  const tail = match.groups.tail.trim();
  if (tail.length === 0 || /^the\s+page$/iu.test(tail)) return { direction, amount: DEFAULT_BROWSER_SCROLL_PIXELS };
  const amountMatch = tail.match(/^(?:by\s+)?(?<amount>[0-9]{1,5})\s*(?:pixels?|px)$/iu);
  if (!amountMatch?.groups) return undefined;
  const amount = Number(amountMatch.groups.amount);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_BROWSER_SCROLL_PIXELS ? { direction, amount } : undefined;
}

/**
 * Extract one exact upload source named by the user. The page and the chooser
 * never supply this value. The browser upload policy still resolves and
 * authorizes the resulting workspace path before it reaches Cua.
 */
export function requestedBrowserUploadPath(goal: string): string | undefined {
  const match = goal.match(/\b(?:upload|attach)\b[^\r\n.!?]{0,160}["“](?<path>[^"”\r\n]{1,512})[”"]/iu);
  const value = match?.groups?.path?.trim();
  if (!value || value.includes("\u0000")) return undefined;
  return value;
}

function actionId(operation: ComputerBrowserOperation, candidateId: string): string {
  return `${operation}:${candidateId}`;
}

function parseDescription(description: string): { readonly role: string; readonly type?: string; readonly label: string } | undefined {
  const tokens = description.trim().split(/\s+/u).filter(Boolean);
  const role = tokens.shift()?.toLowerCase();
  if (!role) return undefined;
  const possibleType = tokens[0]?.toLowerCase();
  const type = role === "input" && possibleType && INPUT_TYPES.has(possibleType) ? tokens.shift()?.toLowerCase() : undefined;
  const label = tokens.join(" ").trim();
  if (label.length === 0 || label.length > MAX_DESCRIPTION_CHARS) return undefined;
  return { role, ...(type ? { type } : {}), label };
}

function normalizeRole(value: string): string {
  const role = value.trim().toLowerCase();
  return role === "textbox" || role === "searchbox" ? "input" : role;
}

function normalizeDeclaredAction(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function declared(reference: BrowserStrategyReference, operation: ComputerBrowserOperation): boolean | undefined {
  if (reference.actions === undefined) return undefined;
  return reference.actions.some((value) => normalizeDeclaredAction(value) === operation);
}

function declaredPointer(reference: BrowserStrategyReference): boolean {
  return reference.actions?.some((value) => normalizeDeclaredAction(value) === "pointer") === true;
}

function metadataDescription(reference: BrowserStrategyReference): string | undefined {
  const label = reference.name ?? reference.label;
  const uploadDeclared = declared(reference, "upload") === true;
  const role = reference.role ? normalizeRole(reference.role) : uploadDeclared ? "input" : undefined;
  if (!role || !label) return undefined;
  return `${role}${reference.type ? ` ${reference.type}` : ""} ${label}`;
}

function pointerTarget(parsed: { readonly role: string; readonly type?: string }): boolean {
  return INTERACTIVE_ROLES.has(parsed.role) && parsed.type !== "password" && parsed.type !== "hidden";
}

function operationFor(role: string, type?: string): { readonly operation: ComputerBrowserOperation; readonly reason?: string } | undefined {
  if (role === "button" || role === "a" || role === "link" || role === "checkbox" || role === "radio") {
    return { operation: "click" };
  }
  if (role === "select" || role === "combobox") return { operation: "blocked", reason: "select controls require a current typed Cua selection action" };
  if (role === "textarea") return { operation: "type" };
  if (role !== "input") return undefined;
  if (type === "button" || type === "submit" || type === "reset") return { operation: "click" };
  if (type === "password" || type === "file" || type === "hidden") {
    return { operation: "blocked", reason: "sensitive input or file control is not available to the computer strategy" };
  }
  return { operation: "type" };
}

/**
 * Build the bounded, operation-compatible choices for one browser document.
 *
 * References are accepted only when the browser included them in the same
 * snapshot. Sensitive input kinds remain visible as explicit blocked choices;
 * hiding them would make an abstention look like a missing observation.
 */
export function buildBrowserActionSpace(snapshot: BrowserStrategySnapshot): readonly ComputerBrowserAction[] {
  const currentReferences = snapshot.references.filter((reference) => reference.documentId === snapshot.documentId);
  const referenceById = new Map(currentReferences.map((reference) => [reference.value, reference]));
  const actions: ComputerBrowserAction[] = [];
  const descriptions = new Map<string, { readonly role: string; readonly type?: string; readonly label: string }>();
  for (const line of snapshot.content.split(/\r?\n/u)) {
    const match = line.match(/^\[(?<ref>(?:@e[1-9][0-9]*|p[0-9]+:[0-9]+))\]\s+(?<description>[^\n]{1,512})$/u);
    if (!match?.groups) continue;
    const ref = match.groups.ref;
    const description = match.groups.description.trim();
    if (!referenceById.has(ref)) continue;
    const parsed = parseDescription(description);
    if (!parsed) continue;
    descriptions.set(ref, parsed);
  }
  for (const reference of currentReferences) {
    if (descriptions.has(reference.value)) continue;
    const description = metadataDescription(reference);
    const parsed = description ? parseDescription(description) : undefined;
    if (parsed) descriptions.set(reference.value, parsed);
  }
  for (const [ref, parsed] of descriptions) {
    const reference = referenceById.get(ref);
    if (!reference) continue;
    const role = normalizeRole(parsed.role);
    const operation = (role === "select" || role === "combobox") && declared(reference, "select") === true
      ? { operation: "select" as const }
      : operationFor(role, parsed.type);
    const uploadDeclared = declared(reference, "upload") === true;
    // semantic_v2's action declaration is authoritative. Some Chromium
    // accessibility projections expose a file input as a generic `input`
    // without preserving the HTML input type in the outline; a declared
    // `upload` action still gives us a safe, typed candidate in that case.
    if (!operation && !uploadDeclared) continue;
    const candidateId = `${ref}:${snapshot.documentId}`;
    const operations: ComputerBrowserOperation[] = [];
    const baseDeclared = operation ? declared(reference, operation.operation) : false;
    if (operation && baseDeclared !== false) operations.push(operation.operation);
    if (operation?.operation === "type"
      && snapshot.goal !== undefined
      && requestedBrowserKey(snapshot.goal) !== undefined
      && baseDeclared !== false) {
      operations.push("press");
    }
    // The typed Cua action declaration is the binding authority. Accessibility
    // role projections for file inputs vary across Chromium/AT-SPI versions;
    // requiring one particular role here would discard a valid exact file ref.
    if (uploadDeclared) {
      operations.push("upload");
    }
    if (pointerTarget({ ...parsed, role })) {
      for (const pointerOperation of POINTER_OPERATIONS) {
        // Cua semantic_v2 declares the whole pointer capability as `pointer`;
        // the concrete gesture is selected by Lina and still requires a
        // current same-snapshot ref (and a destination for drag).
        if (!declaredPointer(reference)) continue;
        if (pointerOperation === "drag") {
          const destinationRef = reference.destinationRef;
          if (!destinationRef || !referenceById.has(destinationRef) || destinationRef === ref) continue;
          operations.push(pointerOperation);
          continue;
        }
        operations.push(pointerOperation);
      }
    }
    const uniqueOperations = [...new Set(operations)];
    for (const selectedOperation of uniqueOperations) {
      actions.push({
        actionId: actionId(selectedOperation, candidateId),
        candidateId,
        operation: selectedOperation,
        ref,
        role,
        label: parsed.label,
        documentId: snapshot.documentId,
        ...(selectedOperation === "drag" && reference.destinationRef ? { destinationRef: reference.destinationRef } : {}),
        ...(operation?.reason ? { reason: operation.reason } : {}),
      });
    }
    if (actions.length >= MAX_ACTIONS) break;
  }
  const waitMilliseconds = snapshot.goal === undefined ? undefined : requestedBrowserWait(snapshot.goal);
  if (waitMilliseconds !== undefined && actions.length < MAX_ACTIONS) {
    const candidateId = `document:${snapshot.documentId}`;
    actions.push({
      actionId: actionId("wait", candidateId),
      candidateId,
      operation: "wait",
      ref: "document",
      role: "document",
      label: `Wait ${waitMilliseconds}ms for the current page to settle`,
      documentId: snapshot.documentId,
      milliseconds: waitMilliseconds,
    });
  }
  const scroll = snapshot.goal === undefined ? undefined : requestedBrowserScroll(snapshot.goal);
  if (scroll !== undefined && actions.length < MAX_ACTIONS) {
    const candidateId = `document:${snapshot.documentId}`;
    actions.push({
      actionId: actionId("scroll", candidateId),
      candidateId,
      operation: "scroll",
      ref: "document",
      role: "document",
      label: `Scroll ${scroll.direction} ${scroll.amount}px in the current page`,
      documentId: snapshot.documentId,
      direction: scroll.direction,
      amount: scroll.amount,
    });
  }
  return actions;
}

export function actionById(actions: readonly ComputerBrowserAction[], selectedActionId: string): ComputerBrowserAction {
  const action = actions.find((candidate) => candidate.actionId === selectedActionId);
  if (!action) throw new Error("The selected browser action was not present in the current observation.");
  return action;
}
