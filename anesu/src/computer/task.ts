import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { stableStringify } from "../persistence/json.js";
import { DEFAULT_COMPUTER_TIME_ZONE, deriveNativeVerificationSpec, deriveVerificationSpec, hasPositiveActionIntent, hasPositiveSubmissionIntent, normalizedRequestedDate, normalizedRequestedTime, quotedGoalValue, type ComputerVerificationSpec } from "./verification.js";

export type ComputerTaskSurface = "browser" | "native" | "mixed";
export type ComputerProfileMode = "isolated_new" | "existing_profile";
export type ComputerBrowserOriginPolicy = "exact-origin" | "public-web";
export type ComputerTaskInputRoute = "trusted" | "dom_event";
/** Delivery routes compiled into a native task grant. */
export type ComputerNativeFallbackRoute = "structured" | "focused-key-text" | "background-pixel" | "foreground-pixel";
export type ComputerTaskActionClass = "prepare" | "launch" | "navigate" | "click" | "type" | "press" | "scroll" | "select" | "pointer" | "dialog" | "upload";

export interface ComputerTaskSourceSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ComputerTaskValue {
  readonly value: string;
  readonly source: ComputerTaskSourceSpan;
}

export type ComputerTaskValueKind = "text" | "url" | "file" | "date" | "time";

/**
 * Bounded durable evidence for one compiled source-backed value. The value and
 * source text stay out of run records; the digest lets recovery/audit correlate
 * the admitted value without persisting typed content or a filesystem path.
 */
export interface ComputerTaskValueEvidence {
  readonly kind: ComputerTaskValueKind;
  readonly digest: string;
  readonly length: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface ComputerTaskApplication {
  readonly name: string;
  readonly launchPath: string;
  /** Code-owned, bounded arguments for an application launch route. */
  readonly launchArguments?: readonly string[];
}

export interface ComputerTaskSpec {
  readonly taskId: string;
  readonly originalGoal: string;
  readonly surface: ComputerTaskSurface;
  readonly application?: ComputerTaskApplication;
  readonly profile: { readonly mode: ComputerProfileMode };
  /** Public HTTPS tasks may follow safe public links; local and HTTP tasks stay exact-origin scoped. */
  readonly browserOriginPolicy?: ComputerBrowserOriginPolicy;
  /** Native delivery routes admitted by this grant, in fallback order. */
  readonly nativeFallbackRoutes?: readonly ComputerNativeFallbackRoute[];
  readonly timeZone: string;
  readonly inputRoute: ComputerTaskInputRoute;
  readonly allowedOrigins: readonly string[];
  readonly values: {
    readonly text?: ComputerTaskValue;
    readonly url?: ComputerTaskValue;
    readonly file?: ComputerTaskValue;
    readonly date?: ComputerTaskValue;
    readonly time?: ComputerTaskValue;
  };
  readonly allowedActions: readonly ComputerTaskActionClass[];
  readonly completion: ComputerVerificationSpec;
  readonly maxActions: number;
  readonly deadlineMs: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly grantHash: string;
}

/** Mutable only inside one serialized computer run; never shared between tasks. */
export interface ComputerTaskGrantState {
  approved: boolean;
  actionCount: number;
  /** Exact compiled child task hashes admitted by this one grant. */
  taskHashes?: string[];
}

export interface ComputerTaskApprovalRequest {
  readonly taskId: string;
  readonly surface: ComputerTaskSurface;
  readonly originalGoal: string;
  readonly applicationName?: string;
  readonly applicationArguments?: readonly string[];
  readonly profileMode: ComputerTaskSpec["profile"]["mode"];
  readonly browserOriginPolicy?: ComputerBrowserOriginPolicy;
  readonly nativeFallbackRoutes?: readonly ComputerNativeFallbackRoute[];
  readonly inputRoute: ComputerTaskInputRoute;
  readonly timeZone: string;
  readonly values: Readonly<{
    readonly text?: string;
    readonly url?: string;
    readonly file?: string;
    readonly date?: string;
    readonly time?: string;
  }>;
  readonly allowedOrigins: readonly string[];
  readonly allowedActions: readonly ComputerTaskActionClass[];
  readonly maxActions: number;
  readonly deadlineMs: number;
  readonly expiresAtMs: number;
  readonly completion: ComputerVerificationSpec;
  readonly grantHash: string;
}

export function computerTaskValueEvidence(task: ComputerTaskSpec): readonly ComputerTaskValueEvidence[] {
  return (Object.entries(task.values) as readonly [ComputerTaskValueKind, ComputerTaskValue | undefined][])
    .filter((entry): entry is [ComputerTaskValueKind, ComputerTaskValue] => entry[1] !== undefined)
    .map(([kind, value]) => ({
      kind,
      digest: createHash("sha256").update(value.value, "utf8").digest("hex"),
      length: value.value.length,
      sourceStart: value.source.start,
      sourceEnd: value.source.end,
    }));
}

export type ComputerTaskApprovalDecision =
  | { readonly decision: "allow-task"; readonly grantHash: string; readonly reason?: string }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type ComputerTaskMutation =
  | "prepare"
  | "launch"
  | "navigate"
  | "click"
  | "type"
  | "press"
  | "scroll"
  | "select"
  | "pointer"
  | "dialog"
  | "upload";

export class ComputerTaskAuthorizationError extends Error {
  readonly code: "not-approved" | "expired" | "action-not-allowed" | "action-limit" | "origin-not-allowed";

  constructor(code: ComputerTaskAuthorizationError["code"], message: string) {
    super(message);
    this.name = "ComputerTaskAuthorizationError";
    this.code = code;
  }
}

export interface ComputerTaskMutationInput {
  readonly action: ComputerTaskMutation;
  readonly nowMs: number;
  readonly origin?: string;
  /** True only after BrowserUrlPolicy validated the destination in this task session. */
  readonly validatedPublicOrigin?: boolean;
  /** Input mutations consume the task's bounded action budget exactly once. */
  readonly consumeAction?: boolean;
}

export function computerTaskApprovalRequest(task: ComputerTaskSpec): ComputerTaskApprovalRequest {
  return {
    taskId: task.taskId,
    surface: task.surface,
    originalGoal: task.originalGoal,
    ...(task.application ? { applicationName: task.application.name } : {}),
    ...(task.application?.launchArguments ? { applicationArguments: task.application.launchArguments } : {}),
    profileMode: task.profile.mode,
    ...(task.browserOriginPolicy ? { browserOriginPolicy: task.browserOriginPolicy } : {}),
    ...(task.nativeFallbackRoutes ? { nativeFallbackRoutes: task.nativeFallbackRoutes } : {}),
    inputRoute: task.inputRoute,
    timeZone: task.timeZone,
    values: Object.fromEntries(Object.entries(task.values).map(([key, value]) => [key, value.value])) as ComputerTaskApprovalRequest["values"],
    allowedOrigins: task.allowedOrigins,
    allowedActions: task.allowedActions,
    maxActions: task.maxActions,
    deadlineMs: task.deadlineMs,
    expiresAtMs: task.expiresAtMs,
    completion: task.completion,
    grantHash: task.grantHash,
  };
}

export async function approveComputerTaskGrant(input: {
  readonly task: ComputerTaskSpec;
  readonly grant: ComputerTaskGrantState;
  readonly approve?: (request: ComputerTaskApprovalRequest, signal?: AbortSignal) => Promise<ComputerTaskApprovalDecision>;
  readonly signal?: AbortSignal;
  readonly pause?: () => void;
  readonly resume?: () => void;
}): Promise<{
  readonly approved: boolean;
  readonly reason: string;
  /** Distinguishes an explicit user denial from an unavailable or invalid approval path. */
  readonly decision: "allow-task" | "deny" | "unavailable";
}> {
  try {
    bindComputerTaskGrant(input.task, input.grant);
  } catch (error) {
    return { approved: false, decision: "unavailable", reason: error instanceof Error ? error.message : "The computer grant was not bound to the compiled task." };
  }
  if (input.grant.approved) return { approved: true, decision: "allow-task", reason: "The computer task was already approved." };
  if (!input.approve) return { approved: false, decision: "unavailable", reason: "No task approval channel is available; the computer task was not started." };
  input.pause?.();
  try {
    const decision = await input.approve(computerTaskApprovalRequest(input.task), input.signal);
    if (decision.decision !== "allow-task") return { approved: false, decision: decision.decision, reason: decision.reason ?? "The computer task was not approved." };
    if (decision.grantHash !== input.task.grantHash) return { approved: false, decision: "unavailable", reason: "The task approval did not match the compiled grant." };
    input.grant.approved = true;
    return { approved: true, decision: "allow-task", reason: "The computer task was approved." };
  } finally {
    input.resume?.();
  }
}

/** Bind one compiled child task to the grant before it can dispatch mutations. */
export function bindComputerTaskGrant(task: ComputerTaskSpec, grant: ComputerTaskGrantState): void {
  if (!grant.taskHashes) grant.taskHashes = [];
  if (!grant.taskHashes.includes(task.grantHash)) {
    if (grant.approved) {
      throw new ComputerTaskAuthorizationError("not-approved", "The approved computer grant is not bound to this compiled task.");
    }
    grant.taskHashes.push(task.grantHash);
  }
}

/** Add a second, already-compiled child to an approved mixed-surface grant. */
export function addComputerTaskGrantBinding(task: ComputerTaskSpec, grant: ComputerTaskGrantState): void {
  if (!grant.approved || !grant.taskHashes) {
    throw new ComputerTaskAuthorizationError("not-approved", "A mixed child task can be added only to an approved bound grant.");
  }
  if (!grant.taskHashes.includes(task.grantHash)) grant.taskHashes.push(task.grantHash);
}

function canonicalMutationOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new Error("unsupported origin");
    return parsed.origin.toLocaleLowerCase();
  } catch {
    throw new ComputerTaskAuthorizationError("origin-not-allowed", "The browser mutation did not provide a valid HTTP(S) origin.");
  }
}

/**
 * The final local authorization check immediately before a Cua mutation.
 * Approval is not permission by itself: every mutation must still match the
 * immutable task, its live deadline, origin ceiling, and action budget.
 */
export function authorizeComputerTaskMutation(task: ComputerTaskSpec, grant: ComputerTaskGrantState, input: ComputerTaskMutationInput): void {
  if (!grant.approved) throw new ComputerTaskAuthorizationError("not-approved", "The computer task has not been approved.");
  if (!grant.taskHashes?.includes(task.grantHash)) throw new ComputerTaskAuthorizationError("not-approved", "The approved computer grant is not bound to this compiled task.");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs >= task.expiresAtMs) throw new ComputerTaskAuthorizationError("expired", "The computer task grant has expired.");
  if (!task.allowedActions.includes(input.action)) throw new ComputerTaskAuthorizationError("action-not-allowed", `The '${input.action}' mutation is outside the approved computer task actions.`);
  if (input.origin !== undefined) {
    const origin = canonicalMutationOrigin(input.origin);
    if (!task.allowedOrigins.includes(origin)) {
      const parsed = new URL(origin);
      const localSuffix = /(?:^|\.)(?:localhost|local|internal|test)$/iu.test(parsed.hostname);
      const publicHttps = parsed.protocol === "https:"
        && parsed.hostname.includes(".")
        && !localSuffix
        && isIP(parsed.hostname) === 0;
      if (task.browserOriginPolicy !== "public-web" || input.validatedPublicOrigin !== true || !publicHttps) {
        throw new ComputerTaskAuthorizationError("origin-not-allowed", `The browser origin '${origin}' is outside the approved task origins.`);
      }
    }
  }
  if (input.consumeAction === true) {
    if (!Number.isSafeInteger(grant.actionCount) || grant.actionCount < 0) throw new ComputerTaskAuthorizationError("action-limit", "The computer task action counter is invalid.");
    if (grant.actionCount >= task.maxActions) throw new ComputerTaskAuthorizationError("action-limit", `The computer task reached its ${task.maxActions}-action limit.`);
    grant.actionCount += 1;
  }
}

export interface CompileComputerTaskInput {
  readonly taskId: string;
  readonly goal: string;
  readonly surface: ComputerTaskSurface;
  /** Browser calls in the normal conversation loop leave action choice and read completion to the model. */
  readonly browserAgentMode?: boolean;
  /** This identity must come from Anesu's code-owned native allow-list. */
  readonly application?: ComputerTaskApplication;
  /** Base origins used to preserve scheme normalization for bare hosts. */
  readonly allowedOrigins: readonly string[];
  /** Fresh origin of the current browser tab, used only for a follow-up with no URL. */
  readonly currentBrowserOrigin?: string;
  /** Existing-profile attachment is opt-in at deployment level and still needs a host grant. */
  readonly existingProfileEnabled?: boolean;
  readonly inputRoute?: ComputerTaskInputRoute;
  /** IANA timezone used for deterministic relative date normalization. */
  readonly timeZone?: string;
  readonly maxActions: number;
  readonly nowMs: number;
  readonly deadlineMs: number;
}

export type ComputerTaskCompileErrorCode =
  | "invalid-task"
  | "application-required"
  | "origin-not-allowed"
  | "unsupported-intent"
  | "verifier-required"
  | "sensitive-value";

export class ComputerTaskCompileError extends Error {
  readonly code: ComputerTaskCompileErrorCode;

  constructor(code: ComputerTaskCompileErrorCode, message: string) {
    super(message);
    this.name = "ComputerTaskCompileError";
    this.code = code;
  }
}

const URL_PATTERN = /(?<url>(?:https?:\/\/)?(?:(?:localhost|127(?:\.\d{1,3}){3})|(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d{1,5})?(?:\/[^\s<>"']*)?)/iu;
const SENSITIVE_VALUE_PATTERN = /\b(?:password|passcode|one[- ]?time[- ]?code|otp|api[- ]?key|access[- ]?token|secret|private[- ]?key|credential)\b/iu;
const UNSUPPORTED_INTENT_PATTERN = /\bdownload(?:s|ed|ing)?\b/iu;
const LOCAL_FORM_ORIGINS = new Set(["http://anesu.test", "http://127.0.0.1:4173", "http://localhost:4173"]);
// A reference to the current page usually means Anesu's managed browser. Treat
// profile attachment as a separate, opt-in request only when the user clearly
// asks for their own or an already-open browser.
const EXISTING_PROFILE_INTENT_PATTERN = /\b(?:my|personal)\s+(?:(?:already[- ]open|existing)\s+)?(?:browser|chrome|edge|profile)\b|\b(?:use|attach to)\s+(?:an?\s+)?already[- ]open\s+(?:browser|chrome|edge|profile)\b/iu;

function sourceSpan(goal: string, match: RegExpExecArray): ComputerTaskSourceSpan {
  const start = match.index;
  return { start, end: start + match[0].length, text: match[0] };
}

function canonicalOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) throw new ComputerTaskCompileError("origin-not-allowed", "Browser origins cannot contain embedded credentials.");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new ComputerTaskCompileError("origin-not-allowed", "Only HTTP and HTTPS browser origins are supported.");
  return parsed.origin.toLocaleLowerCase();
}

function parseUrl(goal: string, allowedOrigins: readonly string[]): ComputerTaskValue | undefined {
  const match = URL_PATTERN.exec(goal);
  if (!match?.groups?.url) return undefined;
  // The bare-host branch must not turn "ftp://example.com" into an HTTPS task.
  if (/(?:^|\s)[a-z][a-z0-9+.-]*:\/\/$/iu.test(goal.slice(0, match.index))) {
    throw new ComputerTaskCompileError("origin-not-allowed", "Only HTTP and HTTPS browser URLs are supported.");
  }
  if (goal[match.index + match[0].length] === ":") {
    throw new ComputerTaskCompileError("origin-not-allowed", "The requested browser URL is not valid.");
  }
  const raw = match.groups.url.replace(/[),.!?]+$/u, "");
  const source = sourceSpan(goal, { ...match, 0: match[0].slice(0, match[0].length - (match[0].length - raw.length)) } as RegExpExecArray);
  const explicitScheme = /^https?:\/\//iu.test(raw);
  let candidate = raw;
  if (!explicitScheme) {
    const parsedHost = new URL(`https://${raw}`);
    const matchingOrigins = allowedOrigins.filter((origin) => {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.hostname === parsedHost.hostname && parsedOrigin.port === parsedHost.port;
    });
    if (matchingOrigins.length > 1) {
      throw new ComputerTaskCompileError("origin-not-allowed", `The bare browser host '${parsedHost.hostname}' matches multiple approved schemes; specify http:// or https:// explicitly.`);
    }
    candidate = matchingOrigins[0]
      ? `${matchingOrigins[0]}${parsedHost.pathname}${parsedHost.search}${parsedHost.hash}`
      : `https://${raw}`;
  }
  try {
    return { value: new URL(candidate).toString(), source: { ...source, text: raw, end: source.start + raw.length } };
  } catch {
    throw new ComputerTaskCompileError("origin-not-allowed", "The requested browser URL is not valid.");
  }
}

function parseQuotedValue(goal: string): ComputerTaskValue | undefined {
  const quoted = quotedGoalValue(goal);
  if (!quoted) return undefined;
  const value = quoted.value;
  if (SENSITIVE_VALUE_PATTERN.test(value) || SENSITIVE_VALUE_PATTERN.test(goal)) {
    throw new ComputerTaskCompileError("sensitive-value", "Computer tasks cannot admit secret-looking typed values.");
  }
  return { value, source: quoted.source };
}

function hasBrowserUploadIntent(goal: string): boolean {
  return /(?:^|[\s,;:])upload\b/iu.test(goal);
}

function parseBrowserUploadValue(goal: string): ComputerTaskValue | undefined {
  const intent = /(?:^|[\s,;:])upload\b/iu.exec(goal);
  if (!intent || intent.index === undefined) return undefined;
  const start = intent.index + intent[0].lastIndexOf("upload");
  const clause = goal.slice(start, start + 160);
  const quoted = /["“](?<path>[^"”\r\n]{1,512})[”"]/u.exec(clause);
  const bare = quoted ? undefined : /(?<path>\/[^\s"'<>]+|(?:[\w.~+-]+\/)+[^\s"'<>]+|[\w.~+-]+\.[A-Za-z0-9]{1,16})/u.exec(clause);
  const rawValue = quoted?.groups?.path ?? bare?.groups?.path;
  if (!rawValue || /^https?:\/\//iu.test(rawValue)) return undefined;
  const value = quoted ? rawValue.trim() : rawValue.replace(/[.,;:!?)}\]]+$/u, "");
  if (value.length === 0 || value.length > 512 || value.includes("\u0000")) return undefined;
  if (SENSITIVE_VALUE_PATTERN.test(value) || SENSITIVE_VALUE_PATTERN.test(goal)) {
    throw new ComputerTaskCompileError("sensitive-value", "Computer tasks cannot admit secret-looking file paths.");
  }
  const sourceStart = start + clause.indexOf(rawValue);
  return { value, source: { start: sourceStart, end: sourceStart + value.length, text: value } };
}

function normalizedOrigins(origins: readonly string[]): readonly string[] {
  return [...new Set(origins.map((origin) => canonicalOrigin(origin)))].sort();
}

function actionClasses(
  input: CompileComputerTaskInput,
  url: ComputerTaskValue | undefined,
  text: ComputerTaskValue | undefined,
  file: ComputerTaskValue | undefined,
  completion: ComputerVerificationSpec,
): readonly ComputerTaskActionClass[] {
  if (input.surface === "browser" && input.browserAgentMode === true) {
    // In browser-agent mode, the conversation model owns the next operation.
    // The grant still bounds the exact origin, profile, lifetime, action count,
    // and any explicitly requested file transfer; prompt verbs must not decide
    // which ordinary page controls the model is allowed to consider. Dialog
    // decisions remain separately approved at the exact observed dialog.
    return [
      "prepare",
      "navigate",
      "click",
      "type",
      "press",
      "scroll",
      ...(file ? ["upload" as const] : []),
      "dialog",
    ];
  }
  const goal = input.goal;
  const calculatorInteraction = input.surface === "native"
    && /calculator/iu.test(input.application?.name ?? "")
    && /\b(?:calculate|compute|solve|evaluate)\b/iu.test(goal);
  const actions: ComputerTaskActionClass[] = [input.surface === "browser" ? "prepare" : "launch"];
  const nativeFormMutation = input.surface === "native"
    && (completion.kind === "native-calendar-event" || completion.kind === "native-clock-alarm");
  if (input.surface === "browser") actions.push("navigate");
  if (hasPositiveActionIntent(goal, /\b(?:click|reveal|activate|button|link)\b/iu)
    || hasPositiveSubmissionIntent(goal)
    // Native editors commonly expose a document-creation or focus control
    // before the editable element exists. The click remains bounded to a
    // fresh Cua candidate; admitting the class does not authorize an
    // arbitrary coordinate or target.
    || (input.surface === "native" && text !== undefined)) actions.push("click");
  if (calculatorInteraction) actions.push("click");
  // Native tasks can express typing as creating a document/note with an exact
  // quoted value. The quoted value is already source-backed and admitted, so
  // do not require the user or the model to use one particular verb.
  if (hasPositiveActionIntent(goal, /\b(?:type|enter|fill|write|input)\b/iu)
    || (input.surface === "native" && text !== undefined)) actions.push("type");
  if (calculatorInteraction) actions.push("type");
  if (/\bpress\b/iu.test(goal)) actions.push("press");
  // The code-owned form verifiers admit only click/type as task-level actions.
  // A live candidate still has to bind either action to a current Cua element;
  // this does not authorize a guessed shortcut or any target by itself.
  if (nativeFormMutation) actions.push("click", "type");
  if (/\bscroll\b/iu.test(goal)) actions.push("scroll");
  if (/\b(?:hover|right[- ]click|double[- ]click|drag)\b/iu.test(goal)) actions.push("pointer");
  if (/\bselect\b/iu.test(goal)) actions.push("select");
  if (/\b(?:dialog|alert|confirm|prompt)\b/iu.test(goal)) actions.push("dialog");
  if (file !== undefined || hasBrowserUploadIntent(goal)) actions.push("upload");
  return [...new Set(actions)];
}

function hashGrant(spec: Omit<ComputerTaskSpec, "grantHash">): string {
  return createHash("sha256").update(stableStringify(spec), "utf8").digest("hex");
}

export function compileComputerTask(input: CompileComputerTaskInput): ComputerTaskSpec {
  const goal = input.goal.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(input.taskId)) {
    throw new ComputerTaskCompileError("invalid-task", "Computer task IDs must be short stable identifiers.");
  }
  if (goal.length === 0 || goal.length > 1_000) throw new ComputerTaskCompileError("invalid-task", "The computer task goal must contain between 1 and 1,000 characters.");
  if (!Number.isSafeInteger(input.maxActions) || input.maxActions < 1 || input.maxActions > 32) throw new ComputerTaskCompileError("invalid-task", "Computer task action limits must be between 1 and 32.");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0 || !Number.isSafeInteger(input.deadlineMs) || input.deadlineMs < 1 || input.deadlineMs > 8 * 60 * 60 * 1_000) throw new ComputerTaskCompileError("invalid-task", "Computer task deadlines must be bounded positive integers.");
  if (input.surface === "native") {
    if (!input.application || input.application.name.trim().length === 0 || input.application.launchPath.trim().length === 0) {
      throw new ComputerTaskCompileError(
        "application-required",
        "The requested native application is not in the current Cua catalog. The catalog currently admits Notes, Calendar, Clocks, Calculator, and Settings for capability checks; arbitrary Files, Terminal, and VS Code launches are not admitted.",
      );
    }
    if (input.application.launchArguments !== undefined
      && (input.application.launchArguments.length > 8
        || input.application.launchArguments.some((argument) => typeof argument !== "string" || argument.length === 0 || argument.length > 128 || argument.includes("\u0000")))) {
      throw new ComputerTaskCompileError("invalid-task", "Native application launch arguments must contain at most eight bounded non-empty strings.");
    }
  }
  const manifestOrigins = normalizedOrigins(input.allowedOrigins);
  const url = parseUrl(goal, manifestOrigins);
  const currentBrowserOrigin = input.surface === "browser" && !url && input.currentBrowserOrigin
    ? canonicalOrigin(input.currentBrowserOrigin)
    : undefined;
  if (input.surface === "browser" && !url && !currentBrowserOrigin && input.browserAgentMode !== true) {
    throw new ComputerTaskCompileError("origin-not-allowed", "This bounded Cua browser task needs an HTTP(S) URL or an active browser page in the current conversation.");
  }
  const origins = input.surface === "browser" && url
    ? [canonicalOrigin(url.value)]
    : currentBrowserOrigin
      ? [currentBrowserOrigin]
      : input.surface === "browser" && input.browserAgentMode === true
        ? []
        : manifestOrigins;
  const browserScopeOrigin = url?.value ?? currentBrowserOrigin;
  if (input.surface === "browser" && url) {
    const origin = canonicalOrigin(url.value);
    if (hasPositiveSubmissionIntent(goal) && !LOCAL_FORM_ORIGINS.has(origin)) {
      throw new ComputerTaskCompileError("unsupported-intent", "Browser form submission is limited to the deterministic local acceptance origins in the current Cua task contract.");
    }
  }
  if (UNSUPPORTED_INTENT_PATTERN.test(goal)) throw new ComputerTaskCompileError("unsupported-intent", "Browser downloads are not admitted by the current Cua task contract.");
  const quotedValue = parseQuotedValue(goal);
  const browserUpload = input.surface === "browser" && hasBrowserUploadIntent(goal);
  const text = browserUpload ? undefined : quotedValue;
  const file = browserUpload ? parseBrowserUploadValue(goal) : undefined;
  const timeZone = input.timeZone ?? DEFAULT_COMPUTER_TIME_ZONE;
  const completion = input.surface === "browser" && input.browserAgentMode === true
    ? { kind: "none" as const }
    : input.surface === "native" && input.application
      ? deriveNativeVerificationSpec(goal, input.application.name, input.nowMs, timeZone)
      : deriveVerificationSpec(goal, input.surface === "native" ? "native" : "browser");
  if (completion.kind === "none" && !(input.surface === "browser" && input.browserAgentMode === true)) {
    throw new ComputerTaskCompileError("verifier-required", completion.reason ?? "The computer task has no code-owned completion verifier.");
  }
  const existingProfileRequested = input.surface === "browser" && EXISTING_PROFILE_INTENT_PATTERN.test(goal);
  if (existingProfileRequested && input.existingProfileEnabled !== true) {
    throw new ComputerTaskCompileError("unsupported-intent", "Existing browser-profile attachment is disabled. Enable it explicitly in the deployment before using a personal or already-open browser.");
  }
  const date = input.surface === "native" && completion.nativeFacts?.date
    ? normalizedRequestedDate(goal, input.nowMs, timeZone)
    : undefined;
  const time = input.surface === "native" && completion.nativeFacts?.time
    ? normalizedRequestedTime(goal)
    : undefined;
  const specWithoutHash: Omit<ComputerTaskSpec, "grantHash"> = {
    taskId: input.taskId,
    originalGoal: goal,
    surface: input.surface,
    ...(input.application ? {
      application: {
        name: input.application.name.trim(),
        launchPath: input.application.launchPath.trim(),
        ...(input.application.launchArguments ? { launchArguments: [...input.application.launchArguments] } : {}),
      },
    } : {}),
    profile: { mode: existingProfileRequested ? "existing_profile" : "isolated_new" },
    ...(input.surface === "browser" && (browserScopeOrigin || input.browserAgentMode === true)
      ? { browserOriginPolicy: browserScopeOrigin && new URL(browserScopeOrigin).protocol !== "https:" ? "exact-origin" as const : "public-web" as const }
      : {}),
    ...((input.surface === "native" || input.surface === "mixed")
      ? { nativeFallbackRoutes: ["structured", "focused-key-text"] as const }
      : {}),
    timeZone,
    inputRoute: input.inputRoute ?? "trusted",
    allowedOrigins: origins,
    values: {
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
      ...(file ? { file } : {}),
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
    },
    allowedActions: actionClasses(input, url, text, file, completion),
    completion,
    maxActions: input.maxActions,
    deadlineMs: input.deadlineMs,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.deadlineMs,
  };
  return { ...specWithoutHash, grantHash: hashGrant(specWithoutHash) };
}
