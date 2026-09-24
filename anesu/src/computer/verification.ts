import { createHash } from "node:crypto";

export const COMPUTER_FIXTURE_SUCCESS_MARKER = "Computer success: safe result revealed.";

export type ComputerVerificationKind =
  | "url-reached"
  | "text-present"
  | "text-absent"
  | "element-visible"
  | "element-state-changed"
  | "native-app-open"
  | "native-text-editor-value"
  | "native-calendar-event"
  | "native-clock-alarm"
  | "native-calculator-result"
  | "browser-file-assigned"
  | "browser-input-value"
  | "browser-form-submitted"
  | "browser-heading"
  | "none";

export interface NativeVerificationFacts {
  readonly application: "Notes" | "Calendar" | "Clocks" | "Calculator" | "Settings";
  readonly text?: string;
  readonly expression?: string;
  readonly result?: string;
  readonly date?: string;
  readonly time?: string;
  readonly timeZone?: string;
  readonly requireEnabled?: boolean;
}

export interface ComputerVerificationSpec {
  readonly kind: ComputerVerificationKind;
  readonly expected?: string;
  readonly state?: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked" | "selected" | "unselected" | "expanded" | "collapsed";
  readonly nativeFacts?: NativeVerificationFacts;
  /** Deterministic local acceptance identity for a submitted message. */
  readonly expectedSubmissionId?: string;
  readonly reason?: string;
}

export interface BrowserVerificationObservation {
  readonly tabId: string;
  readonly documentId: string;
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly headings?: readonly string[];
  readonly uploadEvidence?: {
    readonly fileName: string;
    readonly byteSize: number;
    readonly contentHash: string;
  };
  readonly complete?: boolean;
  readonly scope?: string;
  readonly omissions?: Readonly<Record<string, number>>;
  readonly continuation?: string;
  /** Current value from the exact freshly re-identified field after typing. */
  readonly typedInputValue?: string;
  readonly oopif?: { readonly status: string; readonly frames: number };
}

export interface NativeVerificationObservation {
  readonly text: string;
  readonly structuredJson?: string;
  readonly windowId?: string;
  readonly windowSnapshotId?: string;
}

/**
 * The native verifier registry is deliberately small. Each entry states what
 * the installed application can prove through its accessibility state and
 * what it cannot prove. A generic text match never substitutes for one of
 * these registrations in a production native task.
 */
export const NATIVE_VERIFIER_REGISTRY = [
  {
    application: "Notes" as const,
    facts: ["bound application", "editable control value"],
    limitations: "The editor must expose the committed value through AT-SPI; a screenshot or an unsaved model claim is insufficient.",
  },
  {
    application: "Calendar" as const,
    facts: ["bound application", "event title", "event date", "event time", "post-submit list or event view"],
    limitations: "An editor containing an unsaved title is not proof of a created event.",
  },
  {
    application: "Clocks" as const,
    facts: ["bound application", "alarm time", "enabled alarm control", "post-submit alarm list"],
    limitations: "An alarm editor or a disabled control is not proof of an enabled alarm.",
  },
  {
    application: "Calculator" as const,
    facts: ["bound application", "normalized arithmetic expression", "displayed result"],
    limitations: "Only bounded arithmetic expressions that the code-owned parser can normalize are admitted; an unrecognized expression remains unavailable.",
  },
  {
    application: "Settings" as const,
    facts: ["bound application"],
    limitations: "This initial entry proves only that the approved Settings application opened; changing system settings is outside this task contract.",
  },
] as const;

export type ComputerVerificationResult =
  | {
      readonly status: "verified";
      readonly verifier: Exclude<ComputerVerificationKind, "none">;
      readonly reason: string;
      readonly evidence: Readonly<Record<string, string>>;
    }
  | {
      readonly status: "pending";
      readonly verifier: Exclude<ComputerVerificationKind, "none">;
      readonly reason: string;
      readonly evidence: Readonly<Record<string, string>>;
    }
  | {
      readonly status: "clarification-required";
      readonly verifier: "none";
      readonly reason: string;
      readonly evidence: Readonly<Record<string, string>>;
    };

type ActionVerificationSpec = {
  readonly kind: "url-reached" | "text-present" | "text-absent" | "element-visible" | "element-state-changed";
  readonly expected: string;
};

function isActionVerificationKind(value: ComputerVerificationKind): value is ActionVerificationSpec["kind"] {
  return value === "url-reached"
    || value === "text-present"
    || value === "text-absent"
    || value === "element-visible"
    || value === "element-state-changed";
}

const URL_PATTERN = /(?<url>(?:https?:\/\/)?(?:(?:localhost|127(?:\.\d{1,3}){3})|(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d{1,5})?(?:\/[^\s<>"']*)?)/iu;
const QUOTED_TEXT_PATTERN = /(?:"(?<double>[^"\r\n]{1,1024})"|“(?<curly>[^”\r\n]{1,1024})”|(?<![\p{L}\p{N}])'(?<single>[^'\r\n]{1,1024})'(?![\p{L}\p{N}]))/u;
const TARGET_TEXT_PATTERN = /\b(?:find|locate|show|display|reveal)\s+(?:the\s+)?(?:visible\s+)?(?:text\s+|element\s+|button\s+|link\s+|result\s+)?([a-z0-9][a-z0-9 _-]{1,120}?)(?:[.!?,]|$)/iu;
const ABSENCE_PATTERN = /\b(?:not visible|not present|absent|disappear|disappeared|hide|hidden)\b/iu;
const ACTION_PATTERN = /\b(?:click|type|fill|press|scroll|select|submit|download|upload|drag|interact|wait|reveal)\b/iu;
const NATIVE_FOLLOW_ON_INTENT_PATTERN = /\b(?:then|click|tap|type|fill|press|scroll|select|submit|download|upload|drag|interact|wait|reveal|create|add|make|write|enter|calculate|compute|set|change|delete|rename|save|find|locate|read|check|inspect|tell|explain)\b/iu;
const STATE_PATTERN = /\b(?<state>(?:un)?checked|(?:un)?selected|(?:en)?abled|disabled|expanded|collapsed|visible|hidden)\b/iu;
const DATE_PATTERN = /\b(?<date>(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}))\b/iu;
const RELATIVE_DATE_PATTERN = /\b(?<date>day\s+after\s+tomorrow|tomorrow|today)\b/iu;
const TIME_PATTERN = /\b(?<time>(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[ap]m)?)\b/iu;
const SUBMISSION_RESULT_PATTERN = /\b(?:accepted|confirmation|confirmed|complete|completed|received|sent|success|successful|submission|submitted|thank[ -]?you)\b/iu;
const SUBMISSION_INTENT_PATTERN = /\b(?:submit(?:s|ted|ting)?|send(?:s|ing)?|sent)\b/iu;
const ACTION_NEGATION_PREFIX_PATTERN = /\b(?:do\s+not|don['’]t|never|avoid|without|not)\b(?:\s+[\w'’-]+){0,5}\s*$/iu;
const HEADING_REQUEST_PATTERN = /\b(?:tell|report|read|show|what(?:'s| is))\b[^.?!\n]{0,120}\b(?:page\s+)?heading\b/iu;
const CALCULATOR_EXPRESSION_PATTERN = /\b(?:calculate|compute|solve|evaluate)\s+(?<expression>[0-9\s.+\-*%/^()×÷xX]+?)(?=\s+(?:in|using|with)\s+(?:the\s+)?calculator\b|[.!?]|$)/iu;
const MAX_CALCULATOR_EXPRESSION_CHARS = 128;
const MAX_CALCULATOR_TOKENS = 64;
export const DEFAULT_COMPUTER_TIME_ZONE = "Africa/Johannesburg";

/** Detect an action the user requests, excluding nearby explicit prohibitions. */
export function hasPositiveActionIntent(goal: string, action: RegExp): boolean {
  const clauses = goal.split(/[.!?;\n]+|\b(?:but|then|however|instead)\b/iu);
  return clauses.some((clause) => {
    const match = action.exec(clause);
    return match !== null && !ACTION_NEGATION_PREFIX_PATTERN.test(clause.slice(0, match.index));
  });
}

export function hasPositiveSubmissionIntent(goal: string): boolean {
  return hasPositiveActionIntent(goal, SUBMISSION_INTENT_PATTERN);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function normalizeNativeIdentity(value: string): string {
  return value.trim().replace(/[\s_-]+/gu, " ").toLocaleLowerCase();
}

export interface CalculatorExpression {
  readonly expression: string;
  readonly result: string;
}

type CalculatorToken =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "operator"; readonly value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { readonly kind: "left" }
  | { readonly kind: "right" };

function calculatorTokens(expression: string): readonly CalculatorToken[] | undefined {
  const tokens: CalculatorToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/u.test(character)) {
      const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu);
      if (!match) return undefined;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) return undefined;
      tokens.push({ kind: "number", value });
      index += match[0].length;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left" });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right" });
      index += 1;
      continue;
    }
    if (/[+\-*\/%^]/u.test(character)) {
      tokens.push({ kind: "operator", value: character as "+" | "-" | "*" | "/" | "%" | "^" });
      index += 1;
      continue;
    }
    return undefined;
  }
  return tokens.length > 0 && tokens.length <= MAX_CALCULATOR_TOKENS ? tokens : undefined;
}

function calculateExpression(expression: string): number | undefined {
  const tokens = calculatorTokens(expression);
  if (!tokens) return undefined;
  let index = 0;
  const peek = (): CalculatorToken | undefined => tokens[index];
  const consume = (): CalculatorToken | undefined => tokens[index++];
  const primary = (): number | undefined => {
    const token = consume();
    if (!token) return undefined;
    if (token.kind === "number") return token.value;
    if (token.kind === "left") {
      const value = additive();
      return consume()?.kind === "right" ? value : undefined;
    }
    return undefined;
  };
  const unary = (): number | undefined => {
    const token = peek();
    if (token?.kind === "operator" && (token.value === "+" || token.value === "-")) {
      consume();
      const value = unary();
      return value === undefined ? undefined : token.value === "-" ? -value : value;
    }
    return primary();
  };
  const power = (): number | undefined => {
    const left = unary();
    if (left === undefined) return undefined;
    const token = peek();
    if (token?.kind !== "operator" || token.value !== "^") return left;
    consume();
    const right = power();
    if (right === undefined) return undefined;
    const value = left ** right;
    return Number.isFinite(value) ? value : undefined;
  };
  const multiplicative = (): number | undefined => {
    let value = power();
    while (value !== undefined) {
      const token = peek();
      if (token?.kind !== "operator" || !["*", "/", "%"].includes(token.value)) return value;
      consume();
      const right = power();
      if (right === undefined || ((token.value === "/" || token.value === "%") && right === 0)) return undefined;
      value = token.value === "*" ? value * right : token.value === "/" ? value / right : value % right;
      if (!Number.isFinite(value)) return undefined;
    }
    return undefined;
  };
  function additive(): number | undefined {
    let value = multiplicative();
    while (value !== undefined) {
      const token = peek();
      if (token?.kind !== "operator" || (token.value !== "+" && token.value !== "-")) return value;
      consume();
      const right = multiplicative();
      if (right === undefined) return undefined;
      value = token.value === "+" ? value + right : value - right;
      if (!Number.isFinite(value)) return undefined;
    }
    return undefined;
  }
  const result = additive();
  return result !== undefined && index === tokens.length && Math.abs(result) <= 1e15 ? result : undefined;
}

function formatCalculatorResult(value: number): string {
  if (Math.abs(value) < 1e-12) return "0";
  return Number(value.toPrecision(12)).toString();
}

/** Extract and safely evaluate the small arithmetic vocabulary supported by the Calculator launch route. */
export function extractCalculatorExpression(goal: string): CalculatorExpression | undefined {
  const raw = goal.match(CALCULATOR_EXPRESSION_PATTERN)?.groups?.expression?.trim();
  if (!raw || raw.length > MAX_CALCULATOR_EXPRESSION_CHARS) return undefined;
  const expression = raw
    .replace(/[×]/gu, "*")
    .replace(/[÷]/gu, "/")
    .replace(/\bx\b/giu, "*")
    .replace(/\s+/gu, " ")
    .trim();
  const result = calculateExpression(expression);
  return result === undefined ? undefined : { expression, result: formatCalculatorResult(result) };
}

function containsRequestedState(content: string, state: NonNullable<ComputerVerificationSpec["state"]>): boolean {
  const normalizedContent = normalize(content);
  const observedStates = normalizedContent.match(/\b(?:un)?checked\b|\b(?:un)?selected\b|\b(?:en)?abled\b|\bdisabled\b|\bexpanded\b|\bcollapsed\b|\bvisible\b|\bhidden\b/gu) ?? [];
  return observedStates.some((observed) => observed === state);
}

function normalizedUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/u, "").toLocaleLowerCase();
  } catch {
    return undefined;
  }
}

function requestedUrl(goal: string): string | undefined {
  const match = goal.match(URL_PATTERN);
  const raw = match?.groups?.url?.replace(/[),.!?]+$/u, "");
  if (!raw) return undefined;
  return /^https?:\/\//iu.test(raw) ? raw : `https://${raw}`;
}

export interface QuotedGoalValue {
  readonly value: string;
  readonly source: { readonly start: number; readonly end: number; readonly text: string };
}

/**
 * Read one explicitly delimited value from a model-preserved computer goal.
 * Single quotes are accepted because chat models commonly normalize the
 * user's double quotes while restating a tool goal. Apostrophes inside words
 * are excluded so prose such as `user's` cannot become an input value.
 */
export function quotedGoalValue(goal: string, maxLength = 1_024): QuotedGoalValue | undefined {
  const match = QUOTED_TEXT_PATTERN.exec(goal);
  const raw = match?.groups?.double ?? match?.groups?.curly ?? match?.groups?.single;
  const value = raw?.trim();
  if (!match || !value || value.length > maxLength) return undefined;
  return { value, source: { start: match.index, end: match.index + match[0].length, text: match[0] } };
}

function quotedText(goal: string): string | undefined {
  return quotedGoalValue(goal, 256)?.value;
}

export interface NormalizedGoalValue {
  readonly value: string;
  readonly source: { readonly start: number; readonly end: number; readonly text: string };
}

function localDateParts(nowMs: number, timeZone: string): { readonly year: number; readonly month: number; readonly day: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(nowMs));
    const values = Object.fromEntries(parts.filter((part) => ["year", "month", "day"].includes(part.type)).map((part) => [part.type, part.value]));
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
      ? { year, month, day }
      : undefined;
  } catch {
    return undefined;
  }
}

function validIsoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function explicitDateValue(raw: string): string | undefined {
  const normalized = raw.trim().replaceAll("/", "-");
  let year: number;
  let month: number;
  let day: number;
  const iso = normalized.match(/^(?<year>20\d{2})-(?<month>\d{1,2})-(?<day>\d{1,2})$/u);
  if (iso?.groups) {
    year = Number(iso.groups.year);
    month = Number(iso.groups.month);
    day = Number(iso.groups.day);
  } else {
    const dayFirst = normalized.match(/^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>20\d{2})$/u);
    if (dayFirst?.groups) {
      year = Number(dayFirst.groups.year);
      month = Number(dayFirst.groups.month);
      day = Number(dayFirst.groups.day);
    } else {
      const named = raw.trim().match(/^(?<day>\d{1,2})\s+(?<month>[a-z]+)\s+(?<year>20\d{2})$/iu);
      if (!named?.groups) return undefined;
      const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      month = monthNames.indexOf(named.groups.month.toLocaleLowerCase()) + 1;
      year = Number(named.groups.year);
      day = Number(named.groups.day);
    }
  }
  return validIsoDate(year, month, day);
}

function relativeDateValue(raw: string, nowMs: number, timeZone: string): string | undefined {
  const current = localDateParts(nowMs, timeZone);
  if (!current) return undefined;
  const normalized = raw.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
  const offset = normalized === "today" ? 0 : normalized === "tomorrow" ? 1 : normalized === "day after tomorrow" ? 2 : undefined;
  if (offset === undefined) return undefined;
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));
  return validIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dateAliases(value: string): readonly string[] {
  const match = value.match(/^(?<year>20\d{2})-(?<month>\d{2})-(?<day>\d{2})$/u);
  if (!match?.groups) return [value];
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1];
  return [value, `${day}/${match.groups.month}/${year}`, `${day}-${match.groups.month}-${year}`, `${day} ${monthName} ${year}`, `${monthName} ${day}, ${year}`];
}

function timeAliases(value: string): readonly string[] {
  const match = value.match(/^(?<hour>\d{2}):(?<minute>[0-5]\d)$/u);
  if (!match?.groups) return [value];
  const hour = Number(match.groups.hour);
  const minute = match.groups.minute;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return [value, `${twelveHour}:${minute} ${meridiem}`, `${twelveHour}:${minute}${meridiem}`];
}

/** Normalize a user date without allowing Jev or the host locale to choose it. */
export function normalizedRequestedDate(goal: string, nowMs: number, timeZone = DEFAULT_COMPUTER_TIME_ZONE): NormalizedGoalValue | undefined {
  const match = RELATIVE_DATE_PATTERN.exec(goal) ?? DATE_PATTERN.exec(goal);
  const raw = match?.groups?.date;
  if (!match || !raw) return undefined;
  const value = RELATIVE_DATE_PATTERN.test(match[0])
    ? relativeDateValue(raw, nowMs, timeZone)
    : explicitDateValue(raw);
  return value ? { value, source: { start: match.index, end: match.index + match[0].length, text: match[0] } } : undefined;
}

/** Normalize an explicit clock value to 24-hour `HH:MM` form. */
export function normalizedRequestedTime(goal: string): NormalizedGoalValue | undefined {
  const match = TIME_PATTERN.exec(goal);
  const raw = match?.groups?.time;
  if (!match || !raw) return undefined;
  const parsed = raw.trim().match(/^(?<hour>\d{1,2}):(?<minute>[0-5]\d)(?:\s*(?<meridiem>[ap]m))?$/iu);
  if (!parsed?.groups) return undefined;
  let hour = Number(parsed.groups.hour);
  const minute = Number(parsed.groups.minute);
  const meridiem = parsed.groups.meridiem?.toLocaleLowerCase();
  if (meridiem && (hour < 1 || hour > 12)) return undefined;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (hour > 23) return undefined;
  return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, source: { start: match.index, end: match.index + match[0].length, text: match[0] } };
}

function targetText(goal: string): string | undefined {
  const value = goal.match(TARGET_TEXT_PATTERN)?.[1]?.trim();
  if (!value || value.length < 2) return undefined;
  return value.replace(/\s+(?:button|link|element)$/iu, "").trim();
}

function nativeApplication(application: string | undefined): NativeVerificationFacts["application"] | undefined {
  const normalized = normalize(application ?? "");
  if (/\b(?:notes?|text editor|gnome text editor)\b/iu.test(normalized)) return "Notes";
  if (/\b(?:calendar|gnome calendar)\b/iu.test(normalized)) return "Calendar";
  if (/\b(?:clocks?|alarm|gnome clocks)\b/iu.test(normalized)) return "Clocks";
  if (/\b(?:calculator|gnome calculator)\b/iu.test(normalized)) return "Calculator";
  if (/\b(?:settings?|system settings?|gnome control center)\b/iu.test(normalized)) return "Settings";
  return undefined;
}

function isNativeOpenOnlyGoal(goal: string): boolean {
  const openIntent = /\b(?:open|launch|start|show|focus|switch\s+to|bring\s+up)\b/iu.exec(goal);
  if (!openIntent || openIntent.index === undefined) return false;
  const remainder = goal.slice(openIntent.index + openIntent[0].length);
  return !NATIVE_FOLLOW_ON_INTENT_PATTERN.test(remainder);
}

/** Compile an application-specific native completion condition. */
export function deriveNativeVerificationSpec(goal: string, applicationName: string, nowMs = Date.now(), timeZone = DEFAULT_COMPUTER_TIME_ZONE): ComputerVerificationSpec {
  // The disposable acceptance fixture has its own deterministic marker. Keep
  // that explicit test contract ahead of the application registry so fixture
  // tests do not pretend to verify a real editor value.
  if (/\bsafe\s+result\b/iu.test(goal)) return deriveVerificationSpec(goal, "native");
  const application = nativeApplication(applicationName);
  if (!application) return { kind: "none", reason: `No native verifier is registered for '${applicationName}'.` };
  const text = quotedText(goal);
  if (application === "Notes" && text && (
    /\b(?:type|fill|write|enter|put|text)\b/iu.test(goal)
    || /\b(?:create|add)\b[^.\n]{0,120}\b(?:document|note)\b/iu.test(goal)
  )) {
    return { kind: "native-text-editor-value", expected: text, nativeFacts: { application, text } };
  }
  if (application === "Calendar" && text && /\b(?:event|appointment|calendar)\b/iu.test(goal)) {
    const date = normalizedRequestedDate(goal, nowMs, timeZone)?.value;
    const time = normalizedRequestedTime(goal)?.value;
    if (!date || !time) return { kind: "none", reason: "Calendar verification requires an explicit event date and time." };
    return { kind: "native-calendar-event", expected: text, nativeFacts: { application, text, date, time, timeZone } };
  }
  if (application === "Clocks" && /\b(?:alarm|timer|clock)\b/iu.test(goal)) {
    const time = normalizedRequestedTime(goal)?.value;
    if (!time) return { kind: "none", reason: "Clock verification requires an explicit alarm time." };
    return { kind: "native-clock-alarm", expected: time, nativeFacts: { application, time, timeZone, requireEnabled: true } };
  }
  if (application === "Calculator") {
    const calculation = extractCalculatorExpression(goal);
    if (calculation) {
      return {
        kind: "native-calculator-result",
        expected: calculation.result,
        nativeFacts: { application, expression: calculation.expression, result: calculation.result },
      };
    }
    if (isNativeOpenOnlyGoal(goal)) {
      return { kind: "native-app-open", expected: application, nativeFacts: { application } };
    }
    return { kind: "none", reason: "Calculator result verification requires one bounded arithmetic expression." };
  }
  if (isNativeOpenOnlyGoal(goal)) {
    return { kind: "native-app-open", expected: application, nativeFacts: { application } };
  }
  return { kind: "none", reason: `${application} mutation or interaction requires a dedicated completion verifier.` };
}

/** Derive only a small, code-owned verification vocabulary from user intent. */
export function deriveVerificationSpec(goal: string, surface: "browser" | "native"): ComputerVerificationSpec {
  const normalizedGoal = normalize(goal);
  const url = requestedUrl(goal);
  const quoted = quotedText(goal);

  if (surface === "browser" && quoted && hasPositiveSubmissionIntent(goal)
    && hasPositiveActionIntent(goal, /\b(?:enter|type|fill|write|input|message|text)\b/iu)) {
    return {
      kind: "browser-form-submitted",
      expected: quoted,
      expectedSubmissionId: createHash("sha256").update(quoted, "utf8").digest("hex").slice(0, 16),
    };
  }

  if (surface === "browser" && HEADING_REQUEST_PATTERN.test(goal)) {
    return { kind: "browser-heading", reason: "The fresh semantic snapshot must expose a visible page heading." };
  }

  const uploadedFile = surface === "browser" && quoted && /\bupload\b/iu.test(goal) ? quoted : undefined;
  if (uploadedFile) return { kind: "browser-file-assigned", expected: uploadedFile };

  if (normalizedGoal.includes("reveal safe result") || normalizedGoal.includes("safe result")) {
    return { kind: "text-present", expected: COMPUTER_FIXTURE_SUCCESS_MARKER };
  }

  if (ABSENCE_PATTERN.test(goal) && quoted) {
    return { kind: "text-absent", expected: quoted };
  }

  if (surface === "browser" && quoted
    && hasPositiveActionIntent(goal, /\b(?:type|enter|fill|write|input)\b/iu)
    && /\b(?:field|box|input|search)\b/iu.test(goal)) {
    return { kind: "browser-input-value", expected: quoted };
  }

  if (quoted && /\b(?:show|display|reveal|contain|contains|visible|read|report)\b/iu.test(goal)) {
    return { kind: "text-present", expected: quoted };
  }

  const state = goal.match(STATE_PATTERN)?.groups?.state?.toLowerCase() as ComputerVerificationSpec["state"] | undefined;
  if (quoted && state) {
    return { kind: "element-state-changed", expected: quoted, state };
  }

  const target = targetText(goal);
  if (target && !ACTION_PATTERN.test(goal.replace(target, "")) && /\b(?:find|locate|show|display)\b/iu.test(goal)) {
    return { kind: "element-visible", expected: target };
  }

  // Navigation is an open-only task only when no later completion or
  // interaction intent was expressed. Keep this branch after result/content
  // and state branches so "open / and reveal..." cannot complete at navigation.
  if (url && !ACTION_PATTERN.test(goal.replace(url, ""))) {
    return { kind: "url-reached", expected: url };
  }

  return {
    kind: "none",
    reason: `No safe ${surface} completion condition was identified from the goal.`,
  };
}

/**
 * A URL plus a read-only observation request needs no model-selected browser
 * action. Open the URL, take a fresh semantic snapshot, and verify it. Keep
 * interaction verbs out of this fast path so a request such as "reveal the
 * result" still enters the bounded action loop.
 */
export function isBrowserOpenOnlyGoal(goal: string, spec: ComputerVerificationSpec): boolean {
  const readOnlyVerification = spec.kind === "url-reached"
    || spec.kind === "browser-heading"
    || spec.kind === "text-present"
    || spec.kind === "text-absent"
    || spec.kind === "element-visible";
  if (!readOnlyVerification || !requestedUrl(goal)) return false;
  const rawUrl = goal.match(URL_PATTERN)?.groups?.url;
  return !ACTION_PATTERN.test(rawUrl ? goal.replace(rawUrl, "") : goal);
}

function parseNativeState(observation: NativeVerificationObservation): {
  readonly application?: string;
  readonly title?: string;
  readonly elements: readonly Record<string, unknown>[];
} {
  if (!observation.structuredJson) return { elements: [] };
  try {
    const parsed: unknown = JSON.parse(observation.structuredJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { elements: [] };
    const root = parsed as Record<string, unknown>;
    const window = root.window && typeof root.window === "object" && !Array.isArray(root.window) ? root.window as Record<string, unknown> : {};
    const accessibility = root.accessibility && typeof root.accessibility === "object" && !Array.isArray(root.accessibility) ? root.accessibility as Record<string, unknown> : {};
    const elements = Array.isArray(accessibility.elements)
      ? accessibility.elements.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
      : [];
    return {
      application: typeof accessibility.appName === "string" ? accessibility.appName : typeof window.appName === "string" ? window.appName : undefined,
      title: typeof accessibility.windowTitle === "string" ? accessibility.windowTitle : typeof window.windowTitle === "string" ? window.windowTitle : undefined,
      elements,
    };
  } catch {
    return { elements: [] };
  }
}

function nativeElementText(element: Record<string, unknown>): string {
  return [element.label, element.value, element.text, element.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function nativeApplicationMatches(expected: NativeVerificationFacts["application"], observed: string | undefined): boolean {
  const normalized = normalizeNativeIdentity(observed ?? "");
  const aliases: Record<NativeVerificationFacts["application"], RegExp> = {
    Notes: /\b(?:notes?|text editor|gnome text editor)\b/iu,
    Calendar: /\b(?:calendar|gnome calendar)\b/iu,
    Clocks: /\b(?:clocks?|gnome clocks)\b/iu,
    Calculator: /\b(?:calculator|gnome calculator)\b/iu,
    Settings: /\b(?:settings?|system settings?|gnome control center)\b/iu,
  };
  return aliases[expected].test(normalized);
}

function nativeEvidence(spec: ComputerVerificationSpec, observation: NativeVerificationObservation, observed: string): Record<string, string> {
  return {
    expected: spec.expected ?? "",
    observed,
    ...(observation.windowId ? { windowId: observation.windowId } : {}),
    ...(observation.windowSnapshotId ? { windowSnapshotId: observation.windowSnapshotId } : {}),
  };
}

function verifyRegisteredNativeObservation(spec: ComputerVerificationSpec, observation: NativeVerificationObservation): ComputerVerificationResult | undefined {
  const facts = spec.nativeFacts;
  if (!facts || (spec.kind !== "native-app-open" && spec.kind !== "native-text-editor-value" && spec.kind !== "native-calendar-event" && spec.kind !== "native-clock-alarm" && spec.kind !== "native-calculator-result")) return undefined;
  const state = parseNativeState(observation);
  const appMatches = nativeApplicationMatches(facts.application, state.application ?? state.title ?? observation.text);
  if (!appMatches) {
    return { status: "pending", verifier: spec.kind, reason: `The fresh native observation is not from the bound ${facts.application} application.`, evidence: nativeEvidence(spec, observation, state.application ?? state.title ?? "unknown application") };
  }
  const text = normalize(`${observation.text} ${state.title ?? ""}`);
  if (spec.kind === "native-app-open") {
    return { status: "verified", verifier: spec.kind, reason: `The bound ${facts.application} application has a fresh usable window.`, evidence: nativeEvidence(spec, observation, state.application ?? facts.application) };
  }
  if (spec.kind === "native-calculator-result") {
    const expected = normalize(facts.result ?? spec.expected ?? "");
    const resultControl = state.elements.some((element) => {
      const role = typeof element.role === "string" ? element.role : "";
      const elementText = normalize(nativeElementText(element));
      return /\b(?:label|display|entry|editable|text|status)\b/iu.test(role)
        && elementText.includes(expected);
    });
    const verified = expected.length > 0 && resultControl;
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified ? "The fresh Calculator accessibility state exposes the requested result." : "The fresh Calculator state did not expose the requested result in a result control.",
      evidence: nativeEvidence(spec, observation, verified ? "result-control" : text.includes(expected) ? "unscoped-text" : "absent"),
    };
  }
  if (spec.kind === "native-text-editor-value") {
    const expected = normalize(facts.text ?? spec.expected ?? "");
    const editable = state.elements.some((element) => {
      const role = typeof element.role === "string" ? element.role : "";
      const actions = Array.isArray(element.actions) ? element.actions.filter((value): value is string => typeof value === "string").join(" ") : "";
      const editableRole = /\b(?:combo\s+box|editable|entry|input|search\s+box|spin\s+button|text(?:\s+(?:area|box|field))?)\b/iu.test(role);
      const editableMetadata = element.editable === true || /set_value|type_text|text|value/iu.test(actions);
      return (editableRole || editableMetadata) && normalize(nativeElementText(element)).includes(expected);
    });
    const verified = expected.length > 0 && editable;
    return { status: verified ? "verified" : "pending", verifier: spec.kind, reason: verified ? "The fresh Text Editor accessibility state exposes the requested value in an editable control." : "The fresh Text Editor state did not expose the requested value in an editable control.", evidence: nativeEvidence(spec, observation, verified ? "editable-value" : text.includes(expected) ? "unsaved-or-untyped-text" : "absent") };
  }
  if (spec.kind === "native-calendar-event") {
    const expectedText = facts.text ? [normalize(facts.text)] : [];
    const expectedDates = facts.date ? dateAliases(facts.date).map(normalize) : [];
    const expectedTimes = facts.time ? timeAliases(facts.time).map(normalize) : [];
    const committedEvent = state.elements.some((element) => {
      const role = typeof element.role === "string" ? element.role : "";
      const elementText = normalize(nativeElementText(element));
      return /\b(?:list item|row|event|calendar item)\b/iu.test(role)
        && expectedText.every((part) => elementText.includes(part))
        && expectedDates.some((part) => elementText.includes(part))
        && expectedTimes.some((part) => elementText.includes(part));
    });
    const verified = expectedText.length === 1 && expectedDates.length > 0 && expectedTimes.length > 0 && committedEvent;
    return { status: verified ? "verified" : "pending", verifier: spec.kind, reason: verified ? "The fresh Calendar list state exposes the requested event title, date, and time." : "The fresh Calendar state did not prove a committed event with the requested title, date, and time.", evidence: nativeEvidence(spec, observation, verified ? "committed-event" : "not-proven") };
  }
  const expectedTimes = timeAliases(facts.time ?? spec.expected ?? "").map(normalize);
  const enabledAlarm = state.elements.some((element) => {
    const role = typeof element.role === "string" ? element.role : "";
    const elementText = normalize(nativeElementText(element));
    return /\b(?:list item|row|alarm|switch|checkbox)\b/iu.test(role)
      && expectedTimes.some((time) => elementText.includes(time))
      && element.enabled !== false
      && (element.checked === true || /\b(?:enabled|on|active)\b/iu.test(elementText));
  });
  const verified = expectedTimes.length > 0 && enabledAlarm;
  return { status: verified ? "verified" : "pending", verifier: spec.kind, reason: verified ? "The fresh Clocks alarm list exposes the requested enabled alarm." : "The fresh Clocks state did not prove the requested enabled alarm.", evidence: nativeEvidence(spec, observation, verified ? "enabled-alarm" : "not-proven") };
}

function textResult(spec: ActionVerificationSpec, content: string, scope: string): ComputerVerificationResult {
  const expected = spec.expected;
  const present = normalize(content).includes(normalize(expected));
  const verified = spec.kind === "text-absent" ? !present : present;
  return {
    status: verified ? "verified" : "pending",
    verifier: spec.kind,
    reason: verified
      ? `The fresh ${scope} observation satisfied the ${spec.kind} condition.`
      : `The fresh ${scope} observation did not satisfy the ${spec.kind} condition.`,
    evidence: { expected, observed: present ? "present" : "absent" },
  };
}

function hasIncompleteBrowserEvidence(observation: BrowserVerificationObservation): boolean {
  if (observation.complete === false || observation.continuation !== undefined) return true;
  return Object.values(observation.omissions ?? {}).some((count) => count > 0)
    || (observation.oopif !== undefined && observation.oopif.status !== "complete" && observation.oopif.frames > 0);
}

export function verifyBrowserObservation(spec: ComputerVerificationSpec, observation: BrowserVerificationObservation): ComputerVerificationResult {
  if (spec.kind === "none" || (spec.kind !== "browser-heading" && !spec.expected)) {
    return { status: "clarification-required", verifier: "none", reason: spec.reason ?? "A browser verifier is required but was not configured.", evidence: {} };
  }
  if (spec.kind === "browser-heading") {
    const rawHeadings = (observation.headings ?? []).map((heading) => heading.trim()).filter(Boolean);
    const headings = rawHeadings.map(normalize).filter(Boolean);
    // Cua derives these headings from visible in-viewport semantic refs. Other
    // omitted nodes do not invalidate the positive fact that one such heading
    // is present; incomplete snapshots still cannot prove absence or a full
    // page-wide condition.
    const verified = headings.length > 0
      && observation.complete !== false
      && observation.continuation === undefined;
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified ? "The fresh semantic snapshot exposes a visible page heading." : "The fresh semantic snapshot did not prove a visible page heading.",
      evidence: { observed: verified ? rawHeadings[0] as string : "absent", documentId: observation.documentId },
    };
  }
  const expectedValue = spec.expected;
  if (!expectedValue) {
    return { status: "clarification-required", verifier: "none", reason: spec.reason ?? "A browser verifier is required but was not configured.", evidence: {} };
  }
  if (spec.kind === "url-reached") {
    const expected = normalizedUrl(expectedValue);
    const actual = normalizedUrl(observation.url);
    const verified = expected !== undefined && actual !== undefined && (actual === expected || actual.startsWith(`${expected}/`));
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified ? "The managed browser reached the requested URL." : "The managed browser has not reached the requested URL.",
      evidence: { expected: expectedValue, observed: observation.url, tabId: observation.tabId, documentId: observation.documentId },
    };
  }
  if (spec.kind === "element-visible") {
    const present = normalize(observation.content).includes(normalize(expectedValue));
    return {
      status: present ? "verified" : "pending",
      verifier: spec.kind,
      reason: present ? "The requested element is visible in the fresh browser snapshot." : "The requested element is not visible in the fresh browser snapshot.",
      evidence: { expected: expectedValue, observed: present ? "present" : "absent", documentId: observation.documentId },
    };
  }
  if (spec.kind === "browser-file-assigned") {
    const expectedName = expectedValue.split(/[\\/]/u).at(-1) ?? expectedValue;
    const evidence = observation.uploadEvidence;
    const parsedUrl = (() => {
      try { return new URL(observation.url); } catch { return undefined; }
    })();
    const observedFileName = parsedUrl?.searchParams.get("filename") ?? "";
    const observedBytes = parsedUrl?.searchParams.get("bytes") ?? "";
    const observedHash = parsedUrl?.searchParams.get("sha256") ?? "";
    const present = evidence !== undefined
      && normalize(evidence.fileName) === normalize(expectedName)
      && normalize(observedFileName) === normalize(expectedName)
      && Number.isSafeInteger(evidence.byteSize)
      && observedBytes === String(evidence.byteSize)
      && /^[a-f0-9]{64}$/u.test(evidence.contentHash)
      && observedHash === evidence.contentHash
      && parsedUrl?.pathname === "/files/result"
      && normalize(`${observation.title}\n${observation.content}`).includes(normalize(expectedName))
      && !hasIncompleteBrowserEvidence(observation);
    return {
      status: present ? "verified" : "pending",
      verifier: spec.kind,
      reason: present ? "The fresh browser result exposes the approved file name, byte count, and content identity." : "The fresh browser state did not prove that the approved file reached the expected result.",
      evidence: {
        expected: expectedName,
        observed: present ? "uploaded-result" : evidence ? "identity-not-proven" : "upload-evidence-missing",
        documentId: observation.documentId,
        observedUrl: observation.url,
        ...(evidence ? { byteSize: String(evidence.byteSize), contentHash: evidence.contentHash } : {}),
      },
    };
  }
  if (spec.kind === "browser-form-submitted") {
    const content = normalize(`${observation.title}\n${observation.content}`);
    const expected = normalize(expectedValue);
    const hasSubmittedResult = SUBMISSION_RESULT_PATTERN.test(content);
    let observedSubmissionId = "";
    let resultPath = false;
    try {
      const url = new URL(observation.url);
      observedSubmissionId = url.searchParams.get("submission_id") ?? "";
      resultPath = url.pathname === "/contact/result";
    } catch {
      resultPath = false;
    }
    const verified = expected.length > 0
      && content.includes(expected)
      && hasSubmittedResult
      && resultPath
      && spec.expectedSubmissionId !== undefined
      && /^[a-f0-9]{16}$/u.test(spec.expectedSubmissionId)
      && observedSubmissionId === spec.expectedSubmissionId
      && !hasIncompleteBrowserEvidence(observation);
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified
        ? "The fresh browser page exposes the requested text in a bounded post-submission result."
        : "The fresh browser page did not prove that the requested text reached a post-submission result.",
      evidence: {
        expected: expectedValue,
        observed: verified ? "submitted-result" : hasSubmittedResult ? "result-without-requested-identity" : "not-submitted",
        ...(observedSubmissionId ? { submissionId: observedSubmissionId } : {}),
        documentId: observation.documentId,
      },
    };
  }
  if (spec.kind === "browser-input-value") {
    const verified = expectedValue.length > 0
      && observation.typedInputValue === expectedValue;
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified
        ? "The exact current browser field value matches the requested text."
        : "Fresh semantic state did not prove the requested value in the exact current browser field.",
      evidence: {
        observed: observation.typedInputValue === undefined ? "value-unavailable" : verified ? "value-match" : "different",
        documentId: observation.documentId,
      },
    };
  }
  if (spec.kind === "element-state-changed") {
    const content = normalize(`${observation.title}\n${observation.content}`);
    const expected = normalize(expectedValue);
    const verified = expected.length > 0 && spec.state !== undefined && content.includes(expected) && containsRequestedState(content, spec.state);
    const absenceSensitive = spec.state === "hidden" || spec.state === "disabled" || spec.state === "unchecked" || spec.state === "unselected" || spec.state === "collapsed";
    if (hasIncompleteBrowserEvidence(observation) && absenceSensitive && !verified) {
      return {
        status: "pending",
        verifier: spec.kind,
        reason: "The browser snapshot is incomplete, so it cannot prove the requested negative or absence-sensitive state.",
        evidence: { expected: expectedValue, requestedState: spec.state ?? "", observed: "incomplete", documentId: observation.documentId },
      };
    }
    return {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified ? `The requested element is ${spec.state} in the fresh browser snapshot.` : `The fresh browser snapshot did not prove that the requested element is ${spec.state}.`,
      evidence: { expected: expectedValue, requestedState: spec.state ?? "", observed: verified ? "present" : "not-proven", documentId: observation.documentId },
    };
  }
  if (spec.kind === "text-absent" && hasIncompleteBrowserEvidence(observation)) {
    return {
      status: "pending",
      verifier: spec.kind,
      reason: "The browser snapshot is incomplete, so it cannot prove that the requested text is absent.",
      evidence: { expected: expectedValue, observed: "incomplete", documentId: observation.documentId },
    };
  }
  if (!isActionVerificationKind(spec.kind)) {
    return { status: "clarification-required", verifier: "none", reason: "This verifier is not valid for a browser observation.", evidence: {} };
  }
  const actionSpec: ActionVerificationSpec = { kind: spec.kind, expected: expectedValue };
  return textResult(actionSpec, `${observation.title}\n${observation.content}`, "browser");
}

export function verifyNativeObservation(spec: ComputerVerificationSpec, observation: NativeVerificationObservation): ComputerVerificationResult {
  const registered = verifyRegisteredNativeObservation(spec, observation);
  if (registered) return registered;
  if (spec.kind === "none" || !spec.expected) {
    return { status: "clarification-required", verifier: "none", reason: spec.reason ?? "A native verifier is required but was not configured.", evidence: {} };
  }
  if (spec.kind === "url-reached") {
    return { status: "clarification-required", verifier: "none", reason: "A URL verifier cannot be used for an isolated native desktop surface.", evidence: {} };
  }
  if (!isActionVerificationKind(spec.kind)) {
    return { status: "clarification-required", verifier: "none", reason: "This verifier is not valid for a native observation.", evidence: {} };
  }
  const actionSpec: ActionVerificationSpec = { kind: spec.kind, expected: spec.expected };
  const content = `${observation.text}\n${observation.structuredJson ?? ""}`;
  if (spec.kind === "element-state-changed") {
    const normalizedContent = normalize(content);
    const expected = normalize(spec.expected);
    const verified = expected.length > 0 && spec.state !== undefined && normalizedContent.includes(expected) && containsRequestedState(normalizedContent, spec.state);
    const result: ComputerVerificationResult = {
      status: verified ? "verified" : "pending",
      verifier: spec.kind,
      reason: verified ? `The requested native element is ${spec.state} in the fresh observation.` : `The fresh native observation did not prove that the requested element is ${spec.state}.`,
      evidence: { expected: spec.expected, requestedState: spec.state ?? "", observed: verified ? "present" : "not-proven" },
    };
    return {
      ...result,
      evidence: {
        ...result.evidence,
        ...(observation.windowId ? { windowId: observation.windowId } : {}),
        ...(observation.windowSnapshotId ? { windowSnapshotId: observation.windowSnapshotId } : {}),
      },
    };
  }
  const result = spec.kind === "element-visible"
    ? textResult({ kind: "text-present", expected: actionSpec.expected }, content, "native")
    : textResult(actionSpec, content, "native");
  return {
    ...result,
    evidence: {
      ...result.evidence,
      ...(observation.windowId ? { windowId: observation.windowId } : {}),
      ...(observation.windowSnapshotId ? { windowSnapshotId: observation.windowSnapshotId } : {}),
    },
  };
}
