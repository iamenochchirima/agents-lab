/**
 * The model-facing part of the fast browser strategy.
 *
 * The browser adapter owns the live locator and freshness checks. This module
 * only turns one bounded, current snapshot into an allow-listed action space.
 * A model can select an action id from this space, but it cannot invent a
 * selector, coordinate, script, or target outside the observation.
 */

export type ComputerBrowserOperation = "click" | "type" | "press" | "select" | "scroll" | "wait" | "blocked";

export type ComputerBrowserScrollDirection = "up" | "down" | "left" | "right";

export interface BrowserStrategyReference {
  readonly value: string;
  readonly documentId: string;
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
  readonly reason?: string;
}

const MAX_DESCRIPTION_CHARS = 512;
const MAX_ACTIONS = 256;
const MAX_BROWSER_WAIT_MS = 10_000;
const MAX_BROWSER_SCROLL_PIXELS = 2_000;
const DEFAULT_BROWSER_SCROLL_PIXELS = 600;
const INPUT_TYPES = new Set(["button", "checkbox", "color", "date", "datetime-local", "email", "file", "hidden", "month", "number", "password", "radio", "range", "search", "submit", "tel", "text", "time", "url", "week"]);

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

function operationFor(role: string, type?: string): { readonly operation: ComputerBrowserOperation; readonly reason?: string } | undefined {
  if (role === "button" || role === "a" || role === "link" || role === "checkbox" || role === "radio") {
    return { operation: "click" };
  }
  if (role === "select") return { operation: "select" };
  if (role === "combobox") return { operation: "blocked", reason: "combobox selection is not available until its option semantics are observed" };
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
  const referenceIds = new Set(snapshot.references
    .filter((reference) => reference.documentId === snapshot.documentId)
    .map((reference) => reference.value));
  const actions: ComputerBrowserAction[] = [];
  for (const line of snapshot.content.split(/\r?\n/u)) {
    const match = line.match(/^\[(?<ref>@e[1-9][0-9]*)\]\s+(?<description>[^\n]{1,512})$/u);
    if (!match?.groups) continue;
    const ref = match.groups.ref;
    const description = match.groups.description.trim();
    if (!referenceIds.has(ref)) continue;
    const parsed = parseDescription(description);
    if (!parsed) continue;
    const operation = operationFor(parsed.role, parsed.type);
    if (!operation) continue;
    const candidateId = `${ref}:${snapshot.documentId}`;
    const operations: readonly ComputerBrowserOperation[] = operation.operation === "type"
      && snapshot.goal !== undefined
      && requestedBrowserKey(snapshot.goal) !== undefined
      ? [operation.operation, "press"]
      : [operation.operation];
    for (const selectedOperation of operations) {
      actions.push({
        actionId: actionId(selectedOperation, candidateId),
        candidateId,
        operation: selectedOperation,
        ref,
        role: parsed.role,
        label: parsed.label,
        documentId: snapshot.documentId,
        ...(operation.reason ? { reason: operation.reason } : {}),
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
