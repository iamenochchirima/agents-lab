import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { stableStringify } from "../persistence/json.js";
import { isRuntimeInterruptionError, redactSecrets, ToolExecutionError } from "../runtime/errors.js";
import type {
  BrowserActionKind,
  BrowserActionResult,
  BrowserActionEffect,
  BrowserActionRoute,
  BrowserDeliveryMode,
  BrowserEscalationTarget,
  BrowserEscalationReason,
  BrowserApprovalAction,
  BrowserActionRequest,
  BrowserUploadSource,
  BrowserDialogObservation,
  BrowserDialogApproval,
  BrowserDialogDecision,
  BrowserDialogResolution,
  BrowserInputRoute,
  BrowserDocumentId,
  BrowserElementReference,
  BrowserSessionId,
  BrowserSessionInfo,
  BrowserTabId,
  BrowserTabInfo,
  BrowserWaitResult,
  BrowserScrollDirection,
  BrowserPointerAction,
  BrowserTypingMode,
  BrowserProfileMode,
  BrowserSearchProvider,
} from "./contracts.js";
import type { BrowserArtifactInfo } from "./artifacts.js";
import { BrowserError, type BrowserDiagnostic, type BrowserErrorCode } from "./errors.js";
import { sameBrowserFileIdentity } from "./files.js";
import { BrowserSessionManager } from "./session.js";
import { asBrowserDocumentId, SUPPORTED_BROWSER_PRESS_KEYS } from "./contracts.js";
import type { ComputerRuntimeEvidence, ComputerTaskContext } from "../computer/contracts.js";
import { approveComputerTaskGrant, authorizeComputerTaskMutation, type ComputerTaskApprovalDecision, type ComputerTaskApprovalRequest, type ComputerTaskMutation } from "../computer/task.js";
import type { CuaAuthorizationCallback } from "./cua-authorization.js";

export type BrowserToolErrorCode = BrowserErrorCode | "browser-approval-denied" | "browser-approval-unavailable";

export interface BrowserApprovalRequest {
  readonly actionId: string;
  readonly callId: string;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly action: BrowserApprovalAction;
  /** Exact semantic target metadata from the snapshot, when the action addresses an element. */
  readonly targetRole?: string;
  readonly targetName?: string;
  readonly origin?: string;
  /** Task grants cover routine navigation/viewport work; consequential input stays one-action approved. */
  readonly approvalScope?: "task" | "action";
  readonly inputRoute?: BrowserInputRoute;
  readonly typingMode?: BrowserTypingMode;
  readonly reference: string;
  readonly documentId: BrowserDocumentId;
  readonly text?: string;
  readonly key?: string;
  readonly value?: string;
  readonly direction?: BrowserScrollDirection;
  readonly amount?: number;
  readonly pointerAction?: BrowserPointerAction;
  readonly destinationReference?: string;
  readonly path?: string;
  readonly maxBytes?: number;
  readonly actionHash: string;
  readonly approvalTimeoutMs?: number;
  readonly warning: string;
  /** High-level computer runs may show the code-owned post-action condition. */
  readonly expectedVerification?: {
    readonly kind: string;
    readonly expected?: string;
    readonly state?: string;
  };
  readonly step?: number;
  readonly maxActions?: number;
  /** Scope shown when this action belongs to a high-level compiled task. */
  readonly taskId?: string;
  readonly grantHash?: string;
  readonly allowedTaskActions?: readonly string[];
  /** Present when a high-level computer run owns this browser action. */
  readonly strategy?: "traditional" | "typesafe" | "compare";
  readonly dialog?: BrowserDialogObservation;
}

export type BrowserApprovalDecision =
  | { readonly decision: "allow-once"; readonly dialogDecision?: BrowserDialogDecision; readonly promptText?: string }
  | { readonly decision: "allow-task"; readonly grantHash: string; readonly reason?: string }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type BrowserToolEvent =
  | { readonly type: "prepared"; readonly request: BrowserApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: BrowserApprovalRequest; readonly decision: BrowserApprovalDecision }
  | { readonly type: "started"; readonly request: BrowserApprovalRequest }
  | { readonly type: "artifact"; readonly artifact: BrowserArtifactInfo }
  | { readonly type: "completed"; readonly request: BrowserApprovalRequest; readonly ok: boolean; readonly summary: string; readonly errorCode?: BrowserToolErrorCode; readonly underlyingErrorCode?: BrowserToolErrorCode; readonly cuaCode?: string; readonly effect?: BrowserActionEffect; readonly route?: BrowserActionRoute; readonly delivery?: { readonly mode: BrowserDeliveryMode; readonly deliveredCount?: number }; readonly escalation?: { readonly target: BrowserEscalationTarget; readonly reason: BrowserEscalationReason }; readonly dialog?: BrowserDialogObservation; readonly dialogDecision?: BrowserDialogDecision; readonly cancellationConfirmed?: boolean; readonly diagnostic?: BrowserDiagnostic };

export interface BrowserToolContext {
  readonly signal?: AbortSignal;
  readonly approvalTimeoutMs?: number;
  readonly pauseDeadline?: () => void;
  readonly resumeDeadline?: () => void;
  readonly pauseTurnDeadline?: () => void;
  readonly resumeTurnDeadline?: () => void;
  readonly approveComputerTask?: (request: ComputerTaskApprovalRequest, signal?: AbortSignal) => Promise<ComputerTaskApprovalDecision>;
  readonly approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>;
  readonly onBrowser?: (event: BrowserToolEvent) => Promise<void> | void;
  readonly taskContext?: ComputerTaskContext;
  /** Separate trusted host decision required before an existing-profile attach. */
  readonly authorizeExistingProfile?: CuaAuthorizationCallback;
}

export interface BrowserToolOptions {
  readonly manager: BrowserSessionManager;
  readonly maxOutputBytes: number;
  readonly redactionSecrets?: readonly string[];
  readonly maxWaitMs?: number;
  readonly resolveUpload?: (requestedPath: string) => Promise<BrowserUploadSource>;
  /** Host-selected route, included in the approval hash and action request. */
  readonly inputRoute?: BrowserInputRoute;
  readonly searchProvider?: BrowserSearchProvider;
  readonly runtimeEvidence?: () => ComputerRuntimeEvidence | undefined;
}

export interface BrowserToolOutcome {
  readonly ok: boolean;
  readonly content: string;
  readonly summary: string;
  readonly errorCode?: BrowserToolErrorCode;
}

function actionEvidence(result: BrowserActionResult): Pick<Extract<BrowserToolEvent, { readonly type: "completed" }>, "effect" | "route" | "delivery" | "escalation"> {
  return {
    ...(result.effect === undefined ? {} : { effect: result.effect }),
    ...(result.route === undefined ? {} : { route: result.route }),
    ...(result.delivery === undefined ? {} : { delivery: result.delivery }),
    ...(result.escalation === undefined ? {} : { escalation: result.escalation }),
  };
}

interface ToolArguments {
  readonly [key: string]: unknown;
}

const BROWSER_TOOL_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  browser_start: [],
  browser_search: ["query"],
  browser_open: ["url"],
  browser_tabs: [],
  browser_snapshot: ["tabId", "scopeRef", "query", "continuation"],
  browser_click: ["ref"],
  browser_type: ["ref", "text", "mode"],
  browser_press: ["ref", "key"],
  browser_scroll: ["ref", "direction", "amount"],
  browser_wait: ["tabId", "milliseconds"],
  browser_upload: ["ref", "path"],
  // Internal only. The high-level computer runner supplies this from the
  // current semantic_v2 action declaration; it is not model-facing.
  browser_pointer: ["ref", "action", "destinationRef"],
  browser_close: [],
};

const REQUIRED_BROWSER_STRING_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  browser_search: ["query"],
  browser_open: ["url"],
  browser_click: ["ref"],
  browser_type: ["ref", "text"],
  browser_press: ["ref", "key"],
  browser_scroll: ["ref"],
  browser_upload: ["ref", "path"],
  browser_pointer: ["ref", "action"],
};

const NAVIGATION_SETTLE_MS = 1_500;
const MAX_NON_REPLAYABLE_ACTIONS = 32;

function isCuaLiveOriginScopeRefusal(error: unknown): error is { readonly message: string; readonly cuaCode: string } {
  if (!error || typeof error !== "object") return false;
  const refusal = error as { readonly message?: unknown; readonly cuaCode?: unknown };
  if (refusal.cuaCode === "protected_resource_scope_invalid" && typeof refusal.message === "string") return true;
  // Cua 0.28.2 routes this exact attestation failure through its protected
  // observation provider and labels the resulting refusal authorization_host_failed.
  // Do not treat unrelated authorization-host failures as origin changes.
  return refusal.cuaCode === "authorization_host_failed"
    && typeof refusal.message === "string"
    && /live browser origin is outside the capability manifest/iu.test(refusal.message);
}

function stringArgument(args: ToolArguments, name: string, required: boolean): string | undefined {
  const value = args[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolExecutionError(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}

function integerArgument(args: ToolArguments, name: string, minimum: number, maximum: number): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ToolExecutionError(`Tool argument '${name}' must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function hashAction(request: Omit<BrowserApprovalRequest, "actionHash">): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

function nonReplayableActionKey(
  request: BrowserApprovalRequest,
  pageUrl: string,
  taskGrantHash: string | undefined,
): string {
  const target = request.targetRole !== undefined || request.targetName !== undefined
    ? {
      ...(request.targetRole === undefined ? {} : { targetRole: request.targetRole }),
      ...(request.targetName === undefined ? {} : { targetName: request.targetName }),
    }
    : { reference: request.reference };
  return createHash("sha256").update(stableStringify({
    ...(taskGrantHash === undefined
      ? { sessionId: request.sessionId }
      : { taskGrantHash }),
    pageUrl,
    action: request.action,
    inputRoute: request.inputRoute ?? "default",
    target,
    ...(request.text === undefined ? {} : { text: request.text }),
    ...(request.typingMode === undefined ? {} : { typingMode: request.typingMode }),
    ...(request.key === undefined ? {} : { key: request.key }),
    ...(request.value === undefined ? {} : { value: request.value }),
    ...(request.direction === undefined ? {} : { direction: request.direction }),
    ...(request.amount === undefined ? {} : { amount: request.amount }),
    ...(request.pointerAction === undefined ? {} : { pointerAction: request.pointerAction }),
    ...(request.destinationReference === undefined ? {} : { destinationReference: request.destinationReference }),
    ...(request.path === undefined ? {} : { path: request.path }),
    ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
  })).digest("hex");
}

function hasUncertainEffect(result: BrowserActionResult): boolean {
  return result.effect === "partial" || result.effect === "unverifiable" || result.effect === "suspected_noop";
}

function nativeDateTypingText(
  requestedText: string,
  references: readonly BrowserElementReference[],
  target: BrowserElementReference,
): string {
  if (target.role?.trim().toLocaleLowerCase() !== "date" || !/^\d{4}-\d{2}-\d{2}$/u.test(requestedText)) {
    return requestedText;
  }

  const [yearText, monthText, dayText] = requestedText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new BrowserError("invalid-action", `Date '${requestedText}' is not a valid calendar date; no browser input was sent.`);
  }

  const dateTargets = references.filter((reference) => reference.role?.trim().toLocaleLowerCase() === "date");
  const dateParts = references
    .filter((reference) => reference.role?.trim().toLocaleLowerCase() === "spinbutton")
    .map((reference): "day" | "month" | "year" | undefined => {
      const tokens = reference.name?.trim().toLocaleLowerCase().match(/[a-z]+/gu) ?? [];
      const matches = new Set(tokens.filter((token) => token === "day" || token === "month" || token === "year"));
      if (matches.size !== 1) return undefined;
      for (const part of ["day", "month", "year"] as const) if (matches.has(part)) return part;
      return undefined;
    });
  const parts = new Set(dateParts);
  if (dateTargets.length !== 1 || dateTargets[0]?.value !== target.value
    || dateParts.length !== 3 || parts.size !== 3
    || !parts.has("day") || !parts.has("month") || !parts.has("year")) {
    throw new BrowserError(
      "invalid-action",
      "Cua's current snapshot does not expose one unambiguous Day/Month/Year component group for this date field; no browser input was sent.",
    );
  }

  const values = { year: yearText!, month: monthText!, day: dayText! };
  return dateParts.map((part) => values[part!]).join("/");
}

function safeText(value: string, secrets: readonly string[]): string {
  return redactSecrets(value, secrets);
}

function safeDialog(dialog: BrowserDialogObservation, secrets: readonly string[]): BrowserDialogObservation {
  return { type: dialog.type, message: bounded(safeText(dialog.message, secrets), 2_000) };
}

function normalizeStartedActionError(action: BrowserApprovalAction, errorCode: BrowserToolErrorCode): { readonly errorCode: BrowserToolErrorCode; readonly underlyingErrorCode?: BrowserToolErrorCode } {
  if ((action === "click" || action === "type" || action === "press" || action === "select" || action === "scroll" || action === "upload")
    && (errorCode === "browser-timeout" || errorCode === "browser-cancelled" || errorCode === "browser-crash" || errorCode === "adapter-failure")) {
    return { errorCode: "browser-ambiguous", underlyingErrorCode: errorCode };
  }
  return { errorCode };
}

function taskGrantCovers(action: BrowserApprovalAction, targetRole?: string): boolean {
  if (action === "scroll") return true;
  return action === "click" && targetRole?.toLocaleLowerCase() === "link";
}

function safeUrl(value: string, secrets: readonly string[]): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:auth|code|key|password|secret|signature|token)/iu.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    if (url.hash) url.hash = "#[REDACTED]";
    return safeText(url.toString(), secrets);
  } catch {
    return safeText(value, secrets);
  }
}

function safeTab(tab: BrowserTabInfo, secrets: readonly string[]): BrowserTabInfo {
  return { ...tab, url: safeUrl(tab.url, secrets), title: safeText(tab.title, secrets) };
}

function bounded(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const marker = `\n[output truncated at ${maxBytes} bytes]`;
  const source = Buffer.from(value, "utf8");
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const content = source.subarray(0, Math.max(0, maxBytes - markerBytes)).toString("utf8");
  return `${content}${marker}`;
}

function boundedSnapshotJson(snapshot: Readonly<Record<string, unknown>>, maxBytes: number): string {
  const content = typeof snapshot.content === "string" ? snapshot.content : "";
  const references = Array.isArray(snapshot.references) ? snapshot.references : [];
  const headings = Array.isArray(snapshot.headings) ? snapshot.headings : undefined;
  let contentBytes = Buffer.byteLength(content, "utf8");
  let referenceCount = references.length;
  let headingCount = headings?.length;

  for (;;) {
    const contentWasTrimmed = contentBytes < Buffer.byteLength(content, "utf8");
    const referencesWereTrimmed = referenceCount < references.length;
    const headingsWereTrimmed = headingCount !== undefined && headingCount < (headings?.length ?? 0);
    const truncated = contentWasTrimmed || referencesWereTrimmed || headingsWereTrimmed;
    const boundedContent = contentWasTrimmed
      ? truncateUtf8(content, contentBytes, "\n[page content truncated]")
      : content;
    const originalOmissions = snapshot.omissions && typeof snapshot.omissions === "object" && !Array.isArray(snapshot.omissions)
      ? snapshot.omissions as Record<string, unknown>
      : {};
    const result = stableStringify({
      ...snapshot,
      content: boundedContent,
      references: references.slice(0, referenceCount),
      ...(headings === undefined ? {} : { headings: headings.slice(0, headingCount) }),
      ...(truncated ? {
        complete: false,
        omissions: {
          ...originalOmissions,
          output_limit: (typeof originalOmissions.output_limit === "number" ? originalOmissions.output_limit : 0) + 1,
        },
      } : {}),
    });
    if (Buffer.byteLength(result, "utf8") <= maxBytes) return result;

    // Keep the identity and current element refs intact for as long as the
    // budget allows. Raw truncation of serialized JSON would make the entire
    // snapshot unusable and can hide a successful action from verification.
    if (contentBytes > 0) {
      contentBytes = Math.floor(contentBytes * 0.75);
      continue;
    }
    if (headingCount !== undefined && headingCount > 0) {
      headingCount = Math.floor(headingCount * 0.75);
      continue;
    }
    if (referenceCount > 0) {
      referenceCount = Math.floor(referenceCount * 0.75);
      continue;
    }
    throw new BrowserError("adapter-failure", "The bounded browser snapshot metadata exceeds the configured output limit.");
  }
}

function truncateUtf8(value: string, maxBytes: number, marker: string): string {
  if (maxBytes <= 0) return "";
  const source = Buffer.from(value, "utf8");
  if (source.byteLength <= maxBytes) return value;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxBytes <= markerBytes) return source.subarray(0, maxBytes).toString("utf8");
  return `${source.subarray(0, maxBytes - markerBytes).toString("utf8")}${marker}`;
}

function sameBrowserOriginScope(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const key = (origins: readonly string[] | undefined): string => JSON.stringify(
    [...new Set((origins ?? []).map((origin) => new URL(origin).origin))].sort(),
  );
  return key(left) === key(right);
}

export const BROWSER_TOOL_DEFINITIONS = [
  {
    name: "browser_search",
    description: "Search the web in Anesu's isolated browser using the configured provider. This starts or reuses the managed browser, opens the real results page, and returns a fresh Cua snapshot. Search terms are sent to the selected provider. Search pages may still be rendering or may block automated requests; inspect the returned page and wait plus snapshot once if needed. If the fresh snapshot still has no results or shows a challenge, report that provider limitation instead of repeating or varying the query or guessing result URLs. Open a result only when it is present in the current snapshot, then inspect the page content returned by browser_open. A concrete URL from the user or current page may still be opened normally.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 512 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "browser_start",
    description: "Optionally start or re-establish the isolated browser before navigating. browser_open and browser_search start it automatically when needed. A public HTTPS task can move to another validated public site in a fresh exact-origin Cua session; local and HTTP tasks stay exact-origin. A new user task gets its own approved scope. It never attaches to the user's personal browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_open",
    description: "Open an allowed HTTP or HTTPS URL, starting the isolated browser session if needed, then wait briefly and return a fresh semantic snapshot of the page. Navigation is only a first step when the user requested further browser work: continue from this observation with the current typed browser tools until the requested outcome is observed or a concrete blocker is reached. The requested URL or a navigation acknowledgement alone is not proof that the page loaded. Public HTTPS tasks may move to a newly validated public origin by replacing the Cua session with a fresh session bound to the exact visited origins; local and HTTP tasks remain exact-origin. If the result has status 'origin_handoff_required', call browser_open once with the exact observedTab.url; do not repeat the URL that led to the refusal or retry the preceding click. Then inspect the fresh snapshot. Unsafe schemes, credentials, private targets, and unsafe redirects are rejected.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "browser_tabs",
    description: "List tabs owned by the active browser session and identify the active tab when Cua can prove it. Tab IDs are opaque identifiers, not tab numbers. Listing tabs refreshes Cua's exact browser binding and invalidates element references from earlier snapshots; take a fresh browser_snapshot for the selected tab before acting. If page access is refused for an out-of-manifest origin, inspect the active tab reported here; do not assume a previous tab ID remains valid after Cua rebinds.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_snapshot",
    description: "Return a bounded semantic_v2 snapshot of the active browser tab. A query, scope reference, or one single-use continuation may narrow the read. If using scopeRef, pass a full reference exactly as returned by the most recent snapshot; omit scopeRef for a full-page snapshot. Refs expire at the end of each user turn and every newer snapshot invalidates older refs. Before the first action in each turn, use a fresh snapshot; use only refs from that snapshot. After a new user turn or a link that may open a tab, use a current opaque tab ID from browser_tabs; omit tabId to inspect the active tab when Cua has already identified it. The result includes Anesu's configured click route so the model can account for its limits. If Cua refuses because the live page origin is outside the manifest, Anesu may return an origin handoff from a fresh exact bind. Use that result if present; do not repeat the URL that led to the refusal or retry the preceding click. If rebinding or URL validation is unavailable, stop and report the limitation.",
    inputSchema: { type: "object", properties: { tabId: { type: "string", description: "Opaque tab ID exactly as returned by browser_tabs, never a numeric position. Omit to inspect the current active tab." }, scopeRef: { type: "string" }, query: { type: "string" }, continuation: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "browser_click",
    description: "Click an element from the latest browser snapshot. A bounded browser-task approval may cover an observed link; buttons and other controls require approval for this exact action and target. After a link click, inspect the current tabs and take a fresh snapshot. If Cua reports partial, unverifiable, or suspected-no-op effect, do not repeat that action; use fresh page evidence to decide what to do next. The configured dom_event route is synthetic and may not activate native controls that require trusted input. Check the fresh checked/selected state before continuing, and report a route limitation if it did not change. For a native date ref that declares type, prefer browser_type directly rather than opening its picker just to enter a known date; on the current Cua/Chromium route, typing with the picker open did not change the field. A dispatched click alone does not prove navigation or selection.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"], additionalProperties: false },
  },
  {
    name: "browser_type",
    description: "Fill an editable element using a current ref from the latest browser snapshot. The exact target and value require one-action approval; an approved browser task does not authorize typing. Use only text the user supplied. Ordinary text uses Cua's insert_text mode. For a native date ref that declares type, type directly into that ref before opening its picker; typing while the picker is open may leave the field unchanged. Native date refs use Cua keystrokes; when the user value is YYYY-MM-DD and this snapshot exposes one unambiguous Day/Month/Year spinbutton group, Anesu converts it to that observed component order before approval. The approval shows the exact text sent. After typing, take a fresh snapshot and verify the date field's canonical value exactly, not the calendar's focused day. If its parts are unavailable or the observed value differs, stop and report that evidence. If another control does not support typing, use a different operation only when a fresh snapshot exposes it. This tool never reads the existing field value.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" }, mode: { type: "string", enum: ["insert_text", "keystrokes"] } }, required: ["ref", "text"], additionalProperties: false },
  },
  {
    name: "browser_press",
    description: "Press Enter on an editable element from the latest browser snapshot. Cua delivers it through a trusted keystroke to a ref that declares 'type'. This can submit a form, so use it only when the user requested submission. The exact target and key require one-action approval; an approved browser task does not authorize key presses. The installed Cua browser route does not support arrow, Tab, Escape, Backspace, or Delete keys here, and this tool cannot operate click-only controls such as native HTML selects.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, key: { type: "string", enum: SUPPORTED_BROWSER_PRESS_KEYS } }, required: ["ref", "key"], additionalProperties: false },
  },
  {
    name: "browser_scroll",
    description: "Scroll from a current browser_snapshot ref whose actions include 'scroll' or 'pointer'. Copy the full ref value exactly (for example, 'p2:14', not the snapshot ID 'p2'). Cua uses that observed element as the origin for scrolling its container or page. A browser-task approval may cover scrolling. The action invalidates the previous element snapshot.",
    inputSchema: { type: "object", properties: { ref: { type: "string", description: "Full current ref from browser_snapshot.references[].value; its actions must include scroll or pointer. Do not pass snapshotId." }, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 2_000 } }, required: ["ref", "direction", "amount"], additionalProperties: false },
  },
  {
    name: "browser_wait",
    description: "Wait for a bounded number of milliseconds while keeping the active browser tab managed by Anesu. This action has no side effect and does not require approval.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" }, milliseconds: { type: "integer", minimum: 0 } }, required: ["milliseconds"], additionalProperties: false },
  },
  {
    name: "browser_upload",
    description: "Assign one bounded workspace file directly to a current file input whose snapshot actions include 'upload'. Call this tool directly; do not click the input to open a chooser. Pass the exact path named by the user. The path and size require explicit approval. This does not submit the surrounding form, though the page may react to the selected file; take a fresh snapshot to inspect the result.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, path: { type: "string" } }, required: ["ref", "path"], additionalProperties: false },
  },
  {
    name: "browser_close",
    description: "Close the active isolated browser session and its tabs only when the user explicitly asks to close the browser. Do not call this at the end of an ordinary task; leave the browser open for the user's next instruction. Application shutdown closes managed sessions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

/** Model-facing browser tool orchestration over the deep browser session module. */
export class BrowserTools {
  readonly definitions = BROWSER_TOOL_DEFINITIONS;
  private activeSessionId: BrowserSessionId | undefined;
  private activeTabId: BrowserTabId | undefined;
  private activeAllowedOrigins: readonly string[] | undefined;
  private activeProfileMode: BrowserProfileMode | undefined;
  private activeTaskGrantHash: string | undefined;
  private outOfScopePage: { readonly sessionId: BrowserSessionId; readonly tabId: BrowserTabId } | undefined;
  private nonReplayableTaskGrantHash: string | undefined;
  private readonly nonReplayableActions = new Map<string, "browser-action-refused" | "browser-ambiguous">();
  private readonly snapshots = new Map<BrowserTabId, {
    readonly sessionId: BrowserSessionId;
    readonly documentId: string;
    readonly origin: string;
    readonly url: string;
    readonly references: readonly BrowserElementReference[];
  }>();

  constructor(private readonly options: BrowserToolOptions) {}

  /** Return the fresh origin of the active conversation tab, if one exists. */
  async currentPageOrigin(signal?: AbortSignal): Promise<string | undefined> {
    const sessionId = this.activeSessionId;
    if (!sessionId || this.options.manager.get(sessionId).status !== "active") return undefined;
    const tabs = await this.options.manager.listTabs(sessionId, signal);
    const tab = tabs.find((candidate) => candidate.tabId === this.activeTabId) ?? tabs[0];
    if (!tab) return undefined;
    this.activeTabId = tab.tabId;
    try {
      const url = new URL(tab.url);
      if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined;
      return url.origin.toLocaleLowerCase();
    } catch {
      return undefined;
    }
  }

  runtimeEvidence(): ComputerRuntimeEvidence | undefined {
    return this.options.runtimeEvidence?.();
  }

  async execute(name: string, callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    this.validateArguments(name, args);
    try {
      switch (name) {
        case "browser_start": return await this.start(context);
        case "browser_search": return await this.search(args, context);
        case "browser_open": return await this.open(args, context);
        case "browser_tabs": return await this.tabs(context.signal);
        case "browser_snapshot": return await this.snapshot(args, context.signal);
        case "browser_click": return await this.approvedAction("click", callId, args, context);
        case "browser_type": return await this.approvedAction("type", callId, args, context);
        case "browser_press": return await this.approvedAction("press", callId, args, context);
        case "browser_scroll": return await this.approvedAction("scroll", callId, args, context);
        case "browser_pointer": return await this.approvedAction("pointer", callId, args, context);
        case "browser_wait": return await this.wait(args, context.signal);
        case "browser_screenshot": return await this.screenshot(args, context.signal, context.onBrowser);
        case "browser_upload": return await this.upload(callId, args, context);
        case "browser_close": return await this.close(context.signal);
        default: throw new ToolExecutionError(`Unknown browser tool '${name}'.`);
      }
    } catch (error) {
      const recovery = await this.describeOutOfScopePage(error, context);
      if (recovery) return recovery;
      throw error;
    }
  }

  private validateArguments(name: string, args: ToolArguments): void {
    const allowed = BROWSER_TOOL_ARGUMENTS[name];
    if (!allowed) throw new ToolExecutionError(`Unknown browser tool '${name}'.`);
    for (const key of Object.keys(args)) {
      if (!allowed.includes(key)) throw new ToolExecutionError(`Browser tool '${name}' does not accept argument '${key}'.`);
    }
    for (const key of REQUIRED_BROWSER_STRING_ARGUMENTS[name] ?? []) {
      const value = args[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new ToolExecutionError(`Tool argument '${key}' must be a non-empty string.`);
      }
    }
    if (name === "browser_snapshot") {
      for (const key of ["tabId", "scopeRef", "query", "continuation"] as const) {
        const value = args[key];
        if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
          throw new ToolExecutionError(`Tool argument '${key}' must be a non-empty string when provided.`);
        }
      }
    }
    if (name === "browser_press" && !SUPPORTED_BROWSER_PRESS_KEYS.includes(args.key as typeof SUPPORTED_BROWSER_PRESS_KEYS[number])) {
      throw new ToolExecutionError("Tool argument 'key' must be one of: " + SUPPORTED_BROWSER_PRESS_KEYS.join(", ") + ". The installed Cua browser route supports Enter only on editable refs.");
    }
    if (name === "browser_wait") {
      const maximum = this.options.maxWaitMs ?? 10_000;
      if (typeof args.milliseconds !== "number" || !Number.isInteger(args.milliseconds) || args.milliseconds < 0 || args.milliseconds > maximum) {
        throw new ToolExecutionError(`Tool argument 'milliseconds' must be an integer between 0 and ${maximum}.`);
      }
    }
    if (name === "browser_scroll") {
      const ref = args.ref;
      if (typeof ref !== "string" || ref.trim().length === 0) {
        throw new ToolExecutionError("Tool argument 'ref' must be the full current ref from browser_snapshot.references[].value, with a scroll or pointer action.");
      }
      if (args.direction !== "up" && args.direction !== "down" && args.direction !== "left" && args.direction !== "right") {
        throw new ToolExecutionError("Tool argument 'direction' must be up, down, left, or right.");
      }
      integerArgument(args, "amount", 1, 2_000);
    }
    if (name === "browser_pointer") {
      const action = args.action;
      if (action !== "hover" && action !== "right_click" && action !== "double_click" && action !== "drag") {
        throw new ToolExecutionError("Tool argument 'action' must be hover, right_click, double_click, or drag.");
      }
      const destinationRef = args.destinationRef;
      if (action === "drag" && (typeof destinationRef !== "string" || destinationRef.trim().length === 0)) {
        throw new ToolExecutionError("A browser drag requires a non-empty destinationRef from the current snapshot.");
      }
      if (action !== "drag" && destinationRef !== undefined) {
        throw new ToolExecutionError("destinationRef is valid only for a browser drag.");
      }
    }
  }

  private authorizeTask(
    context: BrowserToolContext,
    action: ComputerTaskMutation,
    origin?: string,
    options: { readonly consumeAction?: boolean; readonly validatedPublicOrigin?: boolean } = {},
  ): void {
    const taskContext = context.taskContext;
    if (!taskContext) return;
    try {
      authorizeComputerTaskMutation(taskContext.task, taskContext.grant, {
        action,
        nowMs: Date.now(),
        ...(origin ? { origin } : {}),
        ...(options.consumeAction ? { consumeAction: true } : {}),
        ...(options.validatedPublicOrigin ? { validatedPublicOrigin: true } : {}),
      });
    } catch (error) {
      throw new BrowserError("browser-task-unauthorized", error instanceof Error ? error.message : "The browser mutation is outside the approved computer task.", { cause: error });
    }
  }

  private async ensureTaskApproved(context: BrowserToolContext): Promise<void> {
    const taskContext = context.taskContext;
    if (!taskContext || taskContext.grant.approved) return;
    const approval = await approveComputerTaskGrant({
      task: taskContext.task,
      grant: taskContext.grant,
      approve: context.approveComputerTask,
      signal: context.signal,
      pause: context.pauseDeadline,
      resume: context.resumeDeadline,
    });
    if (!approval.approved) {
      throw new BrowserError("browser-task-unauthorized", approval.reason, { cause: new Error(approval.reason) });
    }
  }

  private async start(context: BrowserToolContext): Promise<BrowserToolOutcome> {
    await this.ensureTaskApproved(context);
    this.authorizeTask(context, "prepare");
    const allowedOrigins = context.taskContext?.task.allowedOrigins;
    const profileMode = context.taskContext?.task.profile.mode ?? "isolated_new";
    if (this.activeSessionId) {
      const currentSessionId = this.activeSessionId;
      const current = this.options.manager.get(currentSessionId);
      const sameOrigins = sameBrowserOriginScope(this.activeAllowedOrigins, allowedOrigins);
      const sameTask = context.taskContext?.task.grantHash === this.activeTaskGrantHash;
      if (current.status === "active" && (sameOrigins || sameTask) && this.activeProfileMode === profileMode) {
        this.activeTaskGrantHash = context.taskContext?.task.grantHash;
        return this.success(current, `Browser session ${current.sessionId} is already active for this task's browser scope.`);
      }
      await this.closeActiveSession(context.signal);
    }
    const session = await this.startScopedSession(context, allowedOrigins);
    return this.success(session, `Started isolated browser session ${session.sessionId} for the current task scope.`);
  }

  private async startScopedSession(context: BrowserToolContext, allowedOrigins?: readonly string[]): Promise<BrowserSessionInfo> {
    const profileMode = context.taskContext?.task.profile.mode ?? "isolated_new";
    const authorizeExistingProfile = profileMode === "existing_profile" && context.authorizeExistingProfile && context.taskContext
      ? async (request: Parameters<CuaAuthorizationCallback>[0], signal?: AbortSignal) => context.authorizeExistingProfile!({ ...request, taskGrantHash: context.taskContext!.task.grantHash }, signal)
      : undefined;
    const session = await this.options.manager.start(context.signal, {
      profileMode,
      ...(allowedOrigins ? { allowedOrigins } : {}),
      ...(authorizeExistingProfile
        ? { authorizeExistingProfile }
        : {}),
    });
    this.activeSessionId = session.sessionId;
    this.activeTabId = undefined;
    this.activeAllowedOrigins = allowedOrigins ? [...allowedOrigins] : undefined;
    this.activeProfileMode = profileMode;
    this.activeTaskGrantHash = context.taskContext?.task.grantHash;
    return session;
  }

  private async search(args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const query = stringArgument(args, "query", true)!.trim().replace(/\s+/gu, " ");
    if (Buffer.byteLength(query, "utf8") > 512 || /[\u0000-\u001f\u007f]/u.test(query)) {
      throw new ToolExecutionError("Tool argument 'query' must be at most 512 UTF-8 bytes and contain no control characters.");
    }
    const searchUrl = this.options.searchProvider === "bing"
      ? "https://www.bing.com/search"
      : this.options.searchProvider === "google"
        ? "https://www.google.com/search"
        : "https://duckduckgo.com/";
    const url = new URL(searchUrl);
    url.searchParams.set("q", query);
    await this.ensureTaskApproved(context);
    if (!this.activeSessionId || this.options.manager.get(this.activeSessionId).status !== "active") {
      this.authorizeTask(context, "prepare");
      await this.startScopedSession(context, [url.origin]);
    }
    const opened = await this.open({ url: url.toString() }, context);
    if (!opened.ok) return opened;
    return {
      ...opened,
      summary: `Searched for "${query}" with ${this.options.searchProvider ?? "bing"}. ${opened.summary}`,
    };
  }

  private async describeOutOfScopePage(error: unknown, context: BrowserToolContext): Promise<BrowserToolOutcome | undefined> {
    if (!isCuaLiveOriginScopeRefusal(error)) return undefined;

    const sessionId = this.activeSessionId;
    const previousTabId = this.activeTabId;
    if (!sessionId || !previousTabId) {
      return {
        ok: false,
        content: stableStringify({
          status: "origin_handoff_unavailable",
          explanation: "Cua refused the live page because its origin is outside the session manifest, but Anesu has no exact active tab to re-bind. No page action was retried.",
          nextStep: "Stop browser actions and ask the user for direction.",
        }),
        summary: "Cua refused an out-of-scope page and Anesu could not re-bind an exact active tab.",
        errorCode: "navigation-policy",
      };
    }

    try {
      // Cua refuses page content outside the immutable origin manifest, but an
      // exact window/tab bind remains a read-only way to learn where the page
      // actually landed. Return that observation to the model; never navigate
      // or replay the action here.
      const tabs = await this.options.manager.listTabs(sessionId, context.signal);
      const tab = tabs.find((candidate) => candidate.active === true)
        ?? tabs.find((candidate) => candidate.tabId === previousTabId);
      if (!tab) {
        return {
          ok: false,
          content: stableStringify({
            status: "origin_handoff_unavailable",
            explanation: "Cua refused the live page and the exact active tab was absent from the fresh browser bind. No page action was retried.",
            nextStep: "Stop browser actions and ask the user for direction.",
          }),
          summary: "Cua refused an out-of-scope page and the exact tab could not be re-established.",
          errorCode: "navigation-policy",
        };
      }
      const target = await this.options.manager.validateNavigationTarget(tab.url);
      if (target.local || new URL(target.url).protocol !== "https:") {
        return {
          ok: false,
          content: stableStringify({
            status: "origin_handoff_unavailable",
            explanation: "The exact browser bind found a destination that is not an eligible public HTTPS page. Its address was withheld and no action was retried.",
            nextStep: "Stop browser actions and ask the user for direction.",
          }),
          summary: "Cua refused an out-of-scope page whose destination is not eligible for public-web continuation.",
          errorCode: "navigation-policy",
        };
      }

      const origin = target.origin;
      const currentOrigins = this.activeAllowedOrigins ?? context.taskContext?.task.allowedOrigins ?? [];
      if (currentOrigins.some((allowed) => new URL(allowed).origin === origin)) {
        return {
          ok: false,
          content: stableStringify({
            status: "origin_handoff_unavailable",
            explanation: "Cua refused the page even though the fresh tab origin is already in Anesu's recorded session scope. No action was retried.",
            nextStep: "Do not repeat the previous browser call; report this scope inconsistency.",
          }),
          summary: "Cua's live-origin refusal conflicts with the fresh tab and Anesu scope records.",
          errorCode: "navigation-policy",
        };
      }

      this.activeTabId = tab.tabId;
      this.outOfScopePage = { sessionId, tabId: tab.tabId };
      this.snapshots.clear();
      const secrets = this.options.redactionSecrets ?? [];
      const observedUrl = new URL(target.url).toString();
      const visibleUrl = safeUrl(observedUrl, secrets);
      const urlRedacted = visibleUrl !== observedUrl;
      const canContinue = context.taskContext?.task.browserOriginPolicy === "public-web";
      const content = {
        status: canContinue ? "origin_handoff_required" : "origin_outside_task_scope",
        observedTab: {
          origin,
          ...(urlRedacted ? { urlRedacted: true } : { url: visibleUrl }),
        },
        explanation: "Cua refused page access because the live tab moved outside this session's immutable origin manifest. The exact browser bind observed its current location; no navigation or input was retried.",
        nextStep: !canContinue
          ? "The current task is not approved for public cross-origin continuation. Do not open this destination under the current grant; tell the user it is outside scope and ask for a new task."
          : urlRedacted
            ? "The current address contains redacted query or fragment data. Do not guess or replay it; ask the user for direction."
            : "Do not repeat the URL that led to this refusal or retry the preceding click. If this observed destination is needed for the user's public-web task, call browser_open once with this exact observed URL to start a fresh origin-scoped Cua session, then inspect its snapshot.",
      };
      return {
        ok: true,
        content: bounded(stableStringify(content), this.options.maxOutputBytes),
        summary: urlRedacted
          ? `Cua cannot read the current ${origin} page; its exact address contains redacted data, so it was not offered for navigation.`
          : `Cua cannot read the current ${origin} page. The exact bound URL is ${visibleUrl}; use that URL once with browser_open to continue.`,
      };
    } catch (error) {
      if (context.signal?.aborted || (error instanceof BrowserError && error.browserCode === "browser-cancelled")) throw error;
      return {
        ok: false,
        content: stableStringify({
          status: "origin_handoff_unavailable",
          explanation: "Cua refused page access outside the immutable manifest, and Anesu could not safely validate the exact destination from a fresh browser bind. No navigation or input was retried.",
          nextStep: "Stop browser actions and ask the user for direction.",
        }),
        summary: "Cua refused an out-of-scope page and its destination could not be safely validated.",
        errorCode: "navigation-policy",
      };
    }
  }

  private async closeActiveSession(signal?: AbortSignal): Promise<void> {
    const sessionId = this.activeSessionId;
    if (!sessionId) return;
    try {
      if (this.options.manager.get(sessionId).status === "active") {
        await this.options.manager.close(sessionId, signal);
      }
    } finally {
      this.activeSessionId = undefined;
      this.activeTabId = undefined;
      this.activeAllowedOrigins = undefined;
      this.activeProfileMode = undefined;
      this.activeTaskGrantHash = undefined;
      this.outOfScopePage = undefined;
      this.snapshots.clear();
      // Ambiguous effects belong to the approved task, not to this Cua
      // session. Keep their replay guard through origin/session replacement;
      // refusalScope clears it when a different task grant is observed.
    }
  }

  private async open(args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const opened = await this.navigate(args, context);
    if (!opened.ok) return opened;
    const sessionId = this.activeSessionId;
    const tabId = this.activeTabId;
    if (!sessionId || !tabId) return opened;

    // Cua acknowledges Page.navigate dispatch before a dynamic page has settled.
    // Return current page evidence with the navigation result so the model does
    // not have to infer successful loading from a blank or stale title.
    const settleMs = Math.min(NAVIGATION_SETTLE_MS, this.options.maxWaitMs ?? NAVIGATION_SETTLE_MS);
    if (settleMs > 0) await this.wait({ milliseconds: settleMs }, context.signal);
    const observed = await this.snapshot({}, context.signal);
    return { ...observed, summary: `${opened.summary} ${observed.summary}` };
  }

  private async navigate(args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    await this.ensureTaskApproved(context);
    const rawUrl = stringArgument(args, "url", true) ?? "";
    const target = await this.options.manager.validateNavigationTarget(rawUrl);
    const task = context.taskContext?.task;
    const currentSession = this.activeSessionId
      ? this.options.manager.get(this.activeSessionId)
      : undefined;
    if (currentSession?.status !== "active") {
      if (this.activeSessionId) await this.closeActiveSession(context.signal);
      this.authorizeTask(context, "prepare");
      this.authorizeTask(context, "navigate", target.origin, {
        validatedPublicOrigin: task?.browserOriginPolicy === "public-web",
      });
      const allowedOrigins = [...new Set([...(task?.allowedOrigins ?? []), target.origin])].sort();
      await this.startScopedSession(context, allowedOrigins);
    }
    const taskScopeChanged = task !== undefined
      && this.activeTaskGrantHash !== task.grantHash
      && (!sameBrowserOriginScope(this.activeAllowedOrigins, task.allowedOrigins)
        || this.activeProfileMode !== task.profile.mode);
    const currentPageWasRefused = currentSession !== undefined
      && this.outOfScopePage?.sessionId === currentSession.sessionId
      && this.outOfScopePage.tabId === this.activeTabId;
    const currentOrigins = taskScopeChanged
      ? task?.allowedOrigins
      : this.activeAllowedOrigins ?? task?.allowedOrigins;
    const needsOriginTransition = currentOrigins !== undefined && !currentOrigins.includes(target.origin);
    if (taskScopeChanged || needsOriginTransition || currentPageWasRefused) {
      if (needsOriginTransition
        && (!task || task.browserOriginPolicy !== "public-web" || target.local || new URL(target.url).protocol !== "https:")) {
        throw new BrowserError("browser-task-unauthorized", "Cross-origin navigation requires an approved public HTTPS browser task; local and HTTP tasks remain exact-origin.");
      }
      this.authorizeTask(context, "prepare");
      this.authorizeTask(context, "navigate", target.origin, {
        ...(needsOriginTransition ? { consumeAction: true } : {}),
        ...(task?.browserOriginPolicy === "public-web" ? { validatedPublicOrigin: true } : {}),
      });
      const allowedOrigins = needsOriginTransition || currentPageWasRefused
        ? [...new Set([...(currentOrigins ?? []), target.origin])].sort()
        : [...(currentOrigins ?? [])];
      await this.closeActiveSession(context.signal);
      const nextSession = await this.startScopedSession(context, allowedOrigins);
      try {
        const tab = await this.options.manager.open(nextSession.sessionId, target.url, context.signal);
        this.authorizeTask(context, "navigate", new URL(tab.url).origin, { validatedPublicOrigin: true });
        this.activeTabId = tab.tabId;
        return {
          ok: true,
          content: stableStringify(safeTab(tab, this.options.redactionSecrets ?? [])),
          summary: `Opened ${safeUrl(tab.url, this.options.redactionSecrets ?? [])} in a fresh Cua session scoped to this task's visited public sites.`,
        };
      } catch (error) {
        await this.closeActiveSession(context.signal).catch(() => undefined);
        throw error;
      }
    }
    if (task) this.activeTaskGrantHash = task.grantHash;
    const sessionId = this.requireSession();
    this.authorizeTask(context, "navigate", target.origin, {
      validatedPublicOrigin: task?.browserOriginPolicy === "public-web",
    });
    const tab = await this.options.manager.open(sessionId, target.url, context.signal);
    this.authorizeTask(context, "navigate", new URL(tab.url).origin, {
      validatedPublicOrigin: task?.browserOriginPolicy === "public-web",
    });
    this.activeTabId = tab.tabId;
    const visibleTab = safeTab(tab, this.options.redactionSecrets ?? []);
    return { ok: true, content: stableStringify(visibleTab), summary: `Opened ${visibleTab.url} in browser tab ${tab.tabId}.` };
  }

  private async tabs(signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabs = await this.options.manager.listTabs(sessionId, signal);
    // Cua refreshes its exact window binding here. That replaces the opaque
    // target capability and each tab's document identity, so element refs from
    // any earlier snapshot must not remain usable after a tab listing.
    this.snapshots.clear();
    const activeTab = tabs.find((tab) => tab.active === true);
    if (activeTab) this.activeTabId = activeTab.tabId;
    else if (!this.activeTabId || !tabs.some((tab) => tab.tabId === this.activeTabId)) {
      const onlyTab = tabs.length === 1 && tabs[0]?.active === undefined ? tabs[0] : undefined;
      this.activeTabId = onlyTab?.tabId;
    }
    const secrets = this.options.redactionSecrets ?? [];
    return { ok: true, content: bounded(stableStringify(tabs.map((tab) => safeTab(tab, secrets))), this.options.maxOutputBytes), summary: `Listed ${tabs.length} browser tab${tabs.length === 1 ? "" : "s"}.` };
  }

  private async snapshot(args: ToolArguments, signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = (stringArgument(args, "tabId", false) ?? this.activeTabId);
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const scopeRef = stringArgument(args, "scopeRef", false);
    const query = stringArgument(args, "query", false);
    const continuation = stringArgument(args, "continuation", false);
    const snapshot = await this.options.manager.snapshot(sessionId, tabId as BrowserTabId, signal, {
      ...(scopeRef === undefined ? {} : { scopeRef }),
      ...(query === undefined ? {} : { query }),
      ...(continuation === undefined ? {} : { continuation }),
    });
    this.activeTabId = snapshot.tabId;
    this.snapshots.set(snapshot.tabId, {
      sessionId,
      documentId: snapshot.documentId,
      origin: new URL(snapshot.url).origin,
      url: snapshot.url,
      references: snapshot.references,
    });
    const secrets = this.options.redactionSecrets ?? [];
    const safeSnapshot = {
      ...snapshot,
      ...(this.options.inputRoute === undefined ? {} : { configuredInputRoute: this.options.inputRoute }),
      url: safeUrl(snapshot.url, secrets),
      title: safeText(snapshot.title, secrets),
      content: `[Untrusted page content begins]\n${safeText(snapshot.content, secrets)}\n[Untrusted page content ends]`,
    };
    const origin = new URL(snapshot.url).origin;
    const title = bounded(safeText(snapshot.title, secrets), 128);
    const referenceLabel = `${snapshot.references.length} semantic ${snapshot.references.length === 1 ? "ref" : "refs"}`;
    const headingCount = snapshot.headings?.length ?? 0;
    const headingLabel = `${headingCount} heading${headingCount === 1 ? "" : "s"}`;
    const completeness = snapshot.complete === undefined ? "completeness unknown" : snapshot.complete ? "complete" : "partial";
    const summary = `Captured ${title || origin} from ${origin}: ${Buffer.byteLength(snapshot.content, "utf8")} content bytes, ${referenceLabel}, ${headingLabel}, ${completeness}.`;
    return { ok: true, content: boundedSnapshotJson(safeSnapshot, this.options.maxOutputBytes), summary };
  }

  private async wait(args: ToolArguments, signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = (stringArgument(args, "tabId", false) ?? this.activeTabId);
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const maximum = this.options.maxWaitMs ?? 10_000;
    const milliseconds = integerArgument(args, "milliseconds", 0, maximum);
    const result: BrowserWaitResult = await this.options.manager.wait(sessionId, tabId as BrowserTabId, { milliseconds }, signal);
    this.activeTabId = result.tab.tabId;
    // Waiting can allow navigation or page state changes. Do not reuse refs
    // captured before the wait; the next action must come from a fresh snapshot.
    this.snapshots.delete(result.tab.tabId);
    return { ok: true, content: stableStringify(result), summary: `Waited ${result.waitedMs}ms in browser tab ${result.tab.tabId}.` };
  }

  private async screenshot(
    args: ToolArguments,
    signal: AbortSignal | undefined,
    onBrowser?: BrowserToolContext["onBrowser"],
  ): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = (stringArgument(args, "tabId", false) ?? this.activeTabId);
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const artifact = await this.options.manager.screenshot(sessionId, tabId as BrowserTabId, signal);
    await onBrowser?.({ type: "artifact", artifact });
    return { ok: true, content: stableStringify(artifact), summary: `Captured browser screenshot ${artifact.artifactId}.` };
  }

  private async upload(callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const requestedPath = stringArgument(args, "path", true) ?? "";
    const grantedPath = context.taskContext?.task.values.file?.value;
    if (context.taskContext && grantedPath === undefined) {
      throw new BrowserError("browser-task-unauthorized", "Browser upload requires one exact workspace path in the original request.");
    }
    if (grantedPath !== undefined && requestedPath !== grantedPath) {
      throw new BrowserError("browser-task-unauthorized", "The requested upload path is not the exact file compiled into the computer task grant.");
    }
    await this.ensureTaskApproved(context);
    const sessionId = this.requireSession();
    const tabId = this.activeTabId;
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const ref = stringArgument(args, "ref", true) ?? "";
    const snapshot = this.requireSnapshot(sessionId, tabId);
    if (!this.options.resolveUpload) throw new BrowserError("artifact-violation", "Browser uploads are disabled because no workspace upload policy is configured.");
    const source = await this.options.resolveUpload(requestedPath);
    this.authorizeTask(context, "upload", snapshot.origin, {
      validatedPublicOrigin: context.taskContext?.task.browserOriginPolicy === "public-web",
    });
    const requestWithoutHash = {
      actionId: `browser_action_${randomUUID().replaceAll("-", "")}`,
      callId,
      sessionId,
      tabId,
      action: "upload" as const,
      reference: ref,
      documentId: asBrowserDocumentId(snapshot.documentId),
      origin: snapshot.origin,
      approvalScope: "action" as const,
      path: source.requestedPath,
      maxBytes: source.byteSize,
      approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
      warning: "This browser upload sends a local workspace file to the page. The exact path and byte size must be approved before it runs.",
    } satisfies Omit<BrowserApprovalRequest, "actionHash">;
    const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
    const grantHash = this.refusalScope(context);
    const nonReplayableKey = nonReplayableActionKey(request, snapshot.url, grantHash);
    const previousOutcome = this.nonReplayableActions.get(nonReplayableKey);
    if (previousOutcome) return this.previousActionOutcome(previousOutcome);
    const decision = await this.obtainApproval(request, context);
    if (decision.decision !== "allow-once") return this.deniedAction(request, decision, "upload", context);
    this.authorizeTask(context, "upload", undefined, { consumeAction: true });
    try {
      const currentSource = await this.options.resolveUpload(requestedPath);
      if (currentSource.requestedPath !== source.requestedPath
        || currentSource.absolutePath !== source.absolutePath
        || currentSource.byteSize !== source.byteSize
        || !sameBrowserFileIdentity(currentSource.identity, source.identity)) {
        throw new BrowserError("artifact-violation", "The approved browser upload source changed while approval was pending; the file was not sent.");
      }
      const scopedRequest = this.scopedRequest(request, context);
      // The upload may have changed the page even if its acknowledgement is
      // lost. Consume the snapshot before dispatch so an ambiguous result cannot
      // authorize a replay against stale element references.
      this.snapshots.delete(tabId);
      await context.onBrowser?.({ type: "started", request: scopedRequest });
      const result = await this.options.manager.upload(sessionId, tabId, {
        kind: "upload",
        reference: { value: ref, documentId: asBrowserDocumentId(snapshot.documentId) },
        sourcePath: source.absolutePath,
        maxBytes: source.byteSize,
      }, context.signal, this.dialogApproval(request, context));
      this.snapshots.delete(tabId);
      const uploadEvidence = {
        // This is bounded, content-derived evidence. It deliberately omits
        // both the source path and the staging path so the verifier can prove
        // identity without widening the browser tool's filesystem disclosure.
        uploadEvidence: {
          fileName: path.basename(source.requestedPath),
          byteSize: source.byteSize,
          contentHash: source.identity.contentHash,
        },
        pageVerification: "pending",
      };
      if (hasUncertainEffect(result)) {
        return await this.uncertainActionOutcome(request, nonReplayableKey, result, context, uploadEvidence);
      }
      const visibleResult = {
        ...result,
        tab: safeTab(result.tab, this.options.redactionSecrets ?? []),
        summary: safeText(result.summary, this.options.redactionSecrets ?? []),
        ...uploadEvidence,
        nextStep: "Take a fresh browser snapshot before claiming the file is selected or the page accepted it. This upload did not submit the surrounding form.",
      };
      const outcome = { ok: true, content: stableStringify(visibleResult), summary: visibleResult.summary } as const;
      await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: true, summary: outcome.summary, ...actionEvidence(result) });
      return outcome;
    } catch (error) {
      const outcome = await this.browserActionFailure(request, error, context);
      if (outcome.errorCode === "browser-action-refused" || outcome.errorCode === "browser-ambiguous") {
        this.rememberNonReplayableAction(nonReplayableKey, outcome.errorCode);
      }
      return outcome;
    }
  }

  private requireSnapshot(sessionId: BrowserSessionId, tabId: BrowserTabId): { readonly documentId: string; readonly origin: string; readonly url: string } {
    const snapshot = this.snapshots.get(tabId);
    if (!snapshot || snapshot.sessionId !== sessionId) {
      throw new BrowserError("stale-reference", "Take a browser snapshot before using an element reference.");
    }
    return snapshot;
  }

  /**
   * Browser action records use the task-scoped request identity for every
   * lifecycle event. The action hash remains the hash of the operation itself,
   * while the task fields bind that operation to the immutable computer grant.
   */
  private scopedRequest(request: BrowserApprovalRequest, context: BrowserToolContext): BrowserApprovalRequest {
    const task = context.taskContext?.task;
    if (!task) return request;
    return {
      ...request,
      taskId: task.taskId,
      grantHash: task.grantHash,
      allowedTaskActions: task.allowedActions,
    };
  }

  private async obtainApproval(request: BrowserApprovalRequest, context: BrowserToolContext): Promise<BrowserApprovalDecision> {
    const task = context.taskContext?.task;
    if (task) {
      const taskAction = request.action === "download" ? undefined : request.action as ComputerTaskMutation;
      if (taskAction) this.authorizeTask(context, taskAction);
    }
    const scopedRequest = this.scopedRequest(request, context);
    if (context.taskContext?.grant.approved && request.action !== "dialog" && request.approvalScope !== "action") {
      const decision = { decision: "allow-once" as const };
      await context.onBrowser?.({ type: "prepared", request: scopedRequest });
      await context.onBrowser?.({ type: "approval_decided", request: scopedRequest, decision });
      return decision;
    }
    await context.onBrowser?.({ type: "prepared", request: scopedRequest });
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision: BrowserApprovalDecision;
    try {
      decision = context.approveBrowser
        ? await this.awaitApproval(context.approveBrowser, scopedRequest, context.signal, context.approvalTimeoutMs ?? 120_000)
        : { decision: "unavailable", reason: "No interactive browser approval channel is available; the action was not started." };
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    if (decision.decision === "allow-task") {
      if (!task || request.approvalScope === "action" || decision.grantHash !== task.grantHash) {
        const denied = { decision: "deny" as const, reason: "The approval did not match the compiled computer task grant." };
        await context.onBrowser?.({ type: "approval_decided", request: scopedRequest, decision: denied });
        return denied;
      }
      this.taskContextGrant(context).approved = true;
      const granted = { decision: "allow-once" as const };
      await context.onBrowser?.({ type: "approval_decided", request: scopedRequest, decision: granted });
      return granted;
    }
    await context.onBrowser?.({ type: "approval_decided", request: scopedRequest, decision });
    return decision;
  }

  private taskContextGrant(context: BrowserToolContext): ComputerTaskContext["grant"] {
    if (!context.taskContext) throw new ToolExecutionError("A task grant was required but no computer task is active.");
    return context.taskContext.grant;
  }

  private inputRoute(context: BrowserToolContext): BrowserInputRoute | undefined {
    return context.taskContext?.task.inputRoute ?? this.options.inputRoute;
  }

  /**
   * Cua's browser_type contract has no input_route field: typed browser input
   * is always delivered through its trusted typed operation. Clicks and
   * pointer gestures may use the host-selected Linux DOM route separately.
   */
  private actionInputRoute(context: BrowserToolContext, action: BrowserActionKind): BrowserInputRoute | undefined {
    if (action === "type" || action === "press") return "trusted";
    return this.inputRoute(context);
  }

  private dialogApproval(originalRequest: BrowserApprovalRequest, context: BrowserToolContext): BrowserDialogApproval {
    return async (dialog, signal): Promise<BrowserDialogResolution> => {
      const secrets = this.options.redactionSecrets ?? [];
      const safeObservedDialog = safeDialog(dialog, secrets);
      const requestWithoutHash = {
        actionId: `browser_dialog_${randomUUID().replaceAll("-", "")}`,
        callId: `${originalRequest.callId}:dialog`,
        sessionId: originalRequest.sessionId,
        tabId: originalRequest.tabId,
        action: "dialog" as const,
        reference: "dialog",
        documentId: originalRequest.documentId,
        dialog: safeObservedDialog,
        approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
        warning: "A page dialog is requesting a decision. Accepting it may submit or discard data in the page.",
      } satisfies Omit<BrowserApprovalRequest, "actionHash">;
      const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
      const decision = await this.obtainApproval(request, { ...context, signal: signal ?? context.signal });
      const scopedRequest = this.scopedRequest(request, context);
      if (decision.decision !== "allow-once") {
        const errorCode = decision.decision === "deny" ? "browser-approval-denied" as const : "browser-approval-unavailable" as const;
        const reason = decision.reason ? ` ${decision.reason}` : "";
        await context.onBrowser?.({
          type: "completed",
          request: scopedRequest,
          ok: false,
          summary: `Page dialog was dismissed.${reason}`,
          errorCode,
        });
        return { decision: "dismiss" };
      }
      if (!decision.dialogDecision || (safeObservedDialog.type === "prompt" && decision.dialogDecision === "accept" && decision.promptText === undefined)) {
        const reason = safeObservedDialog.type === "prompt" && decision.dialogDecision === "accept"
          ? "A prompt dialog requires explicit text to accept it."
          : "A page dialog approval must specify accept or dismiss.";
        await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: false, summary: reason, errorCode: "browser-approval-unavailable" });
        return { decision: "dismiss" };
      }
      if (decision.promptText !== undefined && safeObservedDialog.type !== "prompt") {
        await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: false, summary: "Prompt text was supplied for a non-prompt dialog.", errorCode: "browser-approval-unavailable" });
        return { decision: "dismiss" };
      }
      const taskText = context.taskContext?.task.values.text?.value;
      if (safeObservedDialog.type === "prompt" && decision.dialogDecision === "accept"
        && (taskText === undefined || decision.promptText !== taskText)) {
        await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: false, summary: "Prompt acceptance requires the exact non-sensitive text compiled into the task grant.", errorCode: "browser-task-unauthorized" });
        return { decision: "dismiss" };
      }
      if (decision.dialogDecision === "accept") this.authorizeTask(context, "dialog", undefined, { consumeAction: true });
      await context.onBrowser?.({ type: "started", request: scopedRequest });
      const resolution: BrowserDialogResolution = {
        decision: decision.dialogDecision,
        ...(decision.promptText !== undefined ? { promptText: decision.promptText } : {}),
      };
      await context.onBrowser?.({
        type: "completed",
        request: scopedRequest,
        ok: true,
        summary: `Page dialog ${resolution.decision}ed.`,
        dialog: safeObservedDialog,
        dialogDecision: resolution.decision,
      });
      return resolution;
    };
  }

  private async deniedAction(request: BrowserApprovalRequest, decision: BrowserApprovalDecision, action: BrowserActionKind, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const errorCode = decision.decision === "deny" ? "browser-approval-denied" : "browser-approval-unavailable";
    const reason = decision.decision === "allow-once" || !decision.reason ? "" : ` ${decision.reason}`;
    const summary = decision.decision === "deny" ? `Browser ${action} approval denied.` : `Browser ${action} approval unavailable.`;
    const outcome = { ok: false, content: `Browser action not started.${reason}`, summary, errorCode } as const;
    await context.onBrowser?.({ type: "completed", request: this.scopedRequest(request, context), ok: false, summary, errorCode });
    return outcome;
  }

  private async browserActionFailure(request: BrowserApprovalRequest, error: unknown, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    // A persistence acknowledgement fault models the parent process stopping at
    // a durable boundary. It must reach turn recovery instead of being rewritten
    // as an adapter failure, because the browser side effect may already have run.
    if (isRuntimeInterruptionError(error)) throw error;
    const browserError = error instanceof BrowserError ? error : new BrowserError("adapter-failure", error instanceof Error ? error.message : "Browser action failed.");
    const secrets = this.options.redactionSecrets ?? [];
    const safeMessage = safeText(browserError.safeMessage, secrets);
    const dialog = browserError.dialog ? safeDialog(browserError.dialog, secrets) : undefined;
    const cancellation = browserError.cancellationConfirmed === undefined
      ? ""
      : browserError.cancellationConfirmed
        ? " Cancellation termination was confirmed by the browser."
        : " Cancellation termination could not be confirmed by the browser.";
    const diagnostic = browserError.diagnostic ? {
      name: bounded(safeText(browserError.diagnostic.name, secrets), 128),
      message: bounded(safeText(browserError.diagnostic.message, secrets), 2_000),
    } : undefined;
    const scopedRequest = this.scopedRequest(request, context);
    const normalized = normalizeStartedActionError(scopedRequest.action, browserError.browserCode);
    const underlyingSummary = normalized.underlyingErrorCode ? ` Underlying browser outcome: ${normalized.underlyingErrorCode}.` : "";
    const dialogSummary = dialog ? ` Page dialog (${dialog.type}): ${dialog.message}` : "";
    const uncertaintyGuidance = normalized.errorCode === "browser-ambiguous"
      ? " The action outcome is unknown. Do not repeat it. Take a fresh browser snapshot, then continue the user's original task from current evidence. Do not pivot to unrelated searches or reopen pages already reached without evidence. For forms, use only values the user supplied, ask for missing required values, and do not submit unless asked."
      : "";
    const refusalGuidance = normalized.errorCode === "browser-action-refused"
      ? " Cua refused the action before delivery; it was not carried out. Do not repeat it through the same route."
      : "";
    const outcome = { ok: false, content: `Browser error: ${safeMessage}${underlyingSummary}${dialogSummary}${cancellation}${uncertaintyGuidance}${refusalGuidance}`, summary: `${safeMessage}${underlyingSummary}${dialogSummary}${cancellation}${uncertaintyGuidance}${refusalGuidance}`, errorCode: normalized.errorCode } as const;
    await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: false, summary: outcome.summary, errorCode: outcome.errorCode, ...(normalized.underlyingErrorCode ? { underlyingErrorCode: normalized.underlyingErrorCode } : {}), ...(browserError.cuaCode ? { cuaCode: browserError.cuaCode } : {}), ...(dialog ? { dialog } : {}), ...(browserError.dialogDecision ? { dialogDecision: browserError.dialogDecision } : {}), ...(browserError.cancellationConfirmed !== undefined ? { cancellationConfirmed: browserError.cancellationConfirmed } : {}), ...(diagnostic ? { diagnostic } : {}) });
    return outcome;
  }

  private async uncertainActionOutcome(
    request: BrowserApprovalRequest,
    nonReplayableKey: string,
    result: BrowserActionResult,
    context: BrowserToolContext,
    additionalEvidence: Readonly<Record<string, unknown>> = {},
  ): Promise<BrowserToolOutcome> {
    const message = `Cua reported effect '${result.effect}' for browser ${request.action}. The action may have changed the page. Anesu did not verify it; do not repeat it. Take a fresh browser snapshot, then continue the user's original task from current evidence. Do not pivot to unrelated searches or reopen pages already reached without evidence. For forms, use only values the user supplied, ask for missing required values, and do not submit unless asked.`;
    const visibleResult = {
      ...result,
      tab: safeTab(result.tab, this.options.redactionSecrets ?? []),
      summary: safeText(result.summary, this.options.redactionSecrets ?? []),
      ...additionalEvidence,
      outcome: "ambiguous",
      nextStep: message,
    };
    this.rememberNonReplayableAction(nonReplayableKey, "browser-ambiguous");
    const scopedRequest = this.scopedRequest(request, context);
    const outcome = {
      ok: false,
      content: stableStringify(visibleResult),
      summary: message,
      errorCode: "browser-ambiguous" as const,
    };
    await context.onBrowser?.({
      type: "completed",
      request: scopedRequest,
      ok: false,
      summary: message,
      errorCode: "browser-ambiguous",
      ...actionEvidence(result),
    });
    return outcome;
  }

  private refusalScope(context: BrowserToolContext): string | undefined {
    const grantHash = context.taskContext?.task.grantHash ?? this.activeTaskGrantHash;
    if (this.nonReplayableTaskGrantHash !== grantHash) {
      this.nonReplayableActions.clear();
      this.nonReplayableTaskGrantHash = grantHash;
    }
    return grantHash;
  }

  private rememberNonReplayableAction(key: string, errorCode: "browser-action-refused" | "browser-ambiguous"): void {
    if (!this.nonReplayableActions.has(key) && this.nonReplayableActions.size >= MAX_NON_REPLAYABLE_ACTIONS) {
      const oldestKey = this.nonReplayableActions.keys().next().value;
      if (oldestKey !== undefined) this.nonReplayableActions.delete(oldestKey);
    }
    this.nonReplayableActions.set(key, errorCode);
  }

  private previousActionOutcome(errorCode: "browser-action-refused" | "browser-ambiguous"): BrowserToolOutcome {
    if (errorCode === "browser-ambiguous") {
      const message = "A previous attempt at this exact browser action may have taken effect. Anesu did not send it again; use fresh page evidence to decide what is safe next.";
      return { ok: false, content: message, summary: message, errorCode };
    }
    const message = "Cua already refused this action on the current page through the configured route. Anesu did not send it again; choose another supported browser operation or report the limitation.";
    return { ok: false, content: message, summary: message, errorCode };
  }

  private async approvedAction(action: BrowserActionKind, callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    await this.ensureTaskApproved(context);
    const sessionId = this.requireSession();
    const tabId = this.activeTabId;
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const ref = stringArgument(args, "ref", true) ?? "";
    const snapshot = this.snapshots.get(tabId);
    if (!snapshot || snapshot.sessionId !== sessionId) {
      throw new BrowserError("stale-reference", "Take a browser snapshot before using an element reference.");
    }
    const requestedText = action === "type" ? stringArgument(args, "text", true) : undefined;
    const requestedTypingMode = action === "type" ? args.mode as BrowserTypingMode | undefined : undefined;
    const key = action === "press" ? stringArgument(args, "key", true) : undefined;
    const value = action === "select" ? stringArgument(args, "value", true) : undefined;
    const direction = action === "scroll" ? args.direction as BrowserScrollDirection : undefined;
    const amount = action === "scroll" ? integerArgument(args, "amount", 1, 2_000) : undefined;
    const pointerAction = action === "pointer" ? args.action as BrowserPointerAction : undefined;
    const destinationReference = action === "pointer" ? stringArgument(args, "destinationRef", false) : undefined;
    if (value !== undefined && (value.length === 0 || value.length > 256)) {
      throw new ToolExecutionError("Tool argument 'value' must contain between 1 and 256 characters.");
    }
    if (requestedTypingMode !== undefined && requestedTypingMode !== "insert_text" && requestedTypingMode !== "keystrokes") {
      throw new ToolExecutionError("Tool argument 'mode' must be insert_text or keystrokes.");
    }
    const declaredAction = action === "pointer" ? pointerAction : action === "press" ? "type" : action;
    const currentReference = this.currentReference(snapshot, ref, declaredAction ?? action);
    const text = action === "type" && requestedText !== undefined
      ? nativeDateTypingText(requestedText, snapshot.references, currentReference)
      : requestedText;
    // Cua's bulk Input.insertText route does not reliably set segmented native
    // date controls. Translate the observed semantic role to Cua's documented
    // key-event mode here; the model still chooses the target and user value.
    const typingMode = action === "type" && currentReference?.role?.toLocaleLowerCase() === "date"
      ? "keystrokes" as const
      : requestedTypingMode;
    if (action === "pointer" && pointerAction === "drag") {
      if (!destinationReference) throw new BrowserError("invalid-action", "A browser drag requires a current destination reference.");
      if (currentReference?.destinationRef !== destinationReference) {
        throw new BrowserError("stale-reference", "The browser drag destination was not declared by the current source reference.");
      }
      this.currentReference(snapshot, destinationReference, "drag");
    }
    if (action !== "download") this.authorizeTask(context, action, snapshot.origin, {
      validatedPublicOrigin: context.taskContext?.task.browserOriginPolicy === "public-web",
    });
    const requestWithoutHash = {
      actionId: `browser_action_${randomUUID().replaceAll("-", "")}`,
      callId,
      sessionId,
      tabId,
      action,
      origin: snapshot.origin,
      ...(currentReference?.role === undefined ? {} : { targetRole: bounded(currentReference.role, 64) }),
      ...(currentReference?.name === undefined ? {} : { targetName: bounded(safeText(currentReference.name, this.options.redactionSecrets ?? []), 256) }),
      approvalScope: context.taskContext?.grant.approved && taskGrantCovers(action, currentReference?.role) ? "task" as const : "action" as const,
      ...(this.actionInputRoute(context, action) ? { inputRoute: this.actionInputRoute(context, action) } : {}),
      reference: ref,
      documentId: asBrowserDocumentId(snapshot.documentId),
      ...(text !== undefined ? { text } : {}),
      ...(typingMode !== undefined ? { typingMode } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(direction !== undefined ? { direction } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(pointerAction !== undefined ? { pointerAction } : {}),
      ...(destinationReference !== undefined ? { destinationReference } : {}),
      approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
      warning: action === "scroll"
        ? "This browser interaction changes the managed page viewport. The exact direction and amount must be approved before it runs."
        : "This browser interaction may submit data or change remote state. The exact action must be approved before it runs.",
    } satisfies Omit<BrowserApprovalRequest, "actionHash">;
    const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
    const grantHash = this.refusalScope(context);
    const nonReplayableKey = nonReplayableActionKey(request, snapshot.url, grantHash);
    const previousOutcome = this.nonReplayableActions.get(nonReplayableKey);
    if (previousOutcome) return this.previousActionOutcome(previousOutcome);
    const decision = await this.obtainApproval(request, context);
    if (decision.decision !== "allow-once") {
      const errorCode = decision.decision === "deny" ? "browser-approval-denied" : "browser-approval-unavailable";
      const reason = decision.reason ? ` ${decision.reason}` : "";
      const outcome = { ok: false, content: `Browser action not started.${reason}`, summary: decision.decision === "deny" ? `Browser ${action} approval denied.` : `Browser ${action} approval unavailable.`, errorCode } as const;
      await context.onBrowser?.({ type: "completed", request: this.scopedRequest(request, context), ok: false, summary: outcome.summary, errorCode });
      return outcome;
    }
    if (action !== "download") this.authorizeTask(context, action, snapshot.origin, {
      consumeAction: true,
      validatedPublicOrigin: context.taskContext?.task.browserOriginPolicy === "public-web",
    });
    const scopedRequest = this.scopedRequest(request, context);
    await context.onBrowser?.({ type: "started", request: scopedRequest });
    const reference = currentReference;
    const destination: BrowserElementReference | undefined = destinationReference
      ? { value: destinationReference, documentId: asBrowserDocumentId(snapshot.documentId) }
      : undefined;
    const actionRequest: BrowserActionRequest = {
      kind: action,
      ...(this.actionInputRoute(context, action) ? { inputRoute: this.actionInputRoute(context, action) } : {}),
      ...(reference ? { reference } : {}),
      ...(destination ? { destinationReference: destination } : {}),
      ...(pointerAction !== undefined ? { pointerAction } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(typingMode !== undefined ? { typingMode } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(direction !== undefined ? { direction } : {}),
      ...(amount !== undefined ? { amount } : {}),
    };
    // Cua can lose acknowledgement after input reached the page. Invalidate
    // before dispatch, not only on success, so an ambiguous result cannot make
    // the model's next tool call reuse this observation's refs.
    this.snapshots.delete(tabId);
    try {
      const result = await this.options.manager.act(sessionId, tabId, actionRequest, context.signal, this.dialogApproval(request, context));
      if (hasUncertainEffect(result)) {
        return await this.uncertainActionOutcome(request, nonReplayableKey, result, context);
      }
      const visibleResult = { ...result, tab: safeTab(result.tab, this.options.redactionSecrets ?? []), summary: safeText(result.summary, this.options.redactionSecrets ?? []) };
      const outcome = { ok: true, content: stableStringify(visibleResult), summary: visibleResult.summary } as const;
      await context.onBrowser?.({ type: "completed", request: scopedRequest, ok: true, summary: outcome.summary, ...actionEvidence(result) });
      return outcome;
    } catch (error) {
      const outcome = await this.browserActionFailure(request, error, context);
      if (outcome.errorCode === "browser-action-refused" || outcome.errorCode === "browser-ambiguous") {
        this.rememberNonReplayableAction(nonReplayableKey, outcome.errorCode);
      }
      return outcome;
    }
  }

  private currentReference(
    snapshot: { readonly sessionId: BrowserSessionId; readonly documentId: string; readonly origin: string; readonly references: readonly BrowserElementReference[] },
    ref: string,
    action: string,
  ): BrowserElementReference {
    const current = snapshot.references.find((candidate) => candidate.value === ref && candidate.documentId === snapshot.documentId);
    if (!current) {
      throw new BrowserError("stale-reference", `Browser reference '${ref}' is not an element ref in the latest snapshot. Copy the full value from references[].value; do not pass snapshotId.`);
    }
    const supportsAction = action === "scroll"
      ? current.actions?.includes("scroll") === true || current.actions?.includes("pointer") === true
      : current.actions?.includes(action) === true;
    if (!supportsAction) {
      const expected = action === "scroll" ? "'scroll' or 'pointer'" : `'${action}'`;
      throw new BrowserError("invalid-action", `Browser reference '${ref}' does not declare ${expected}.`);
    }
    return current;
  }

  /** Discard turn-local element references without closing the conversation's browser. */
  endTurn(): void {
    this.snapshots.clear();
  }

  private async close(signal?: AbortSignal): Promise<BrowserToolOutcome> {
    if (!this.activeSessionId) return { ok: true, content: stableStringify({ status: "already_closed" }), summary: "No browser session was active." };
    const sessionId = this.activeSessionId;
    await this.closeActiveSession(signal);
    return { ok: true, content: stableStringify({ status: "closed", sessionId }), summary: `Closed browser session ${sessionId}.` };
  }

  private requireSession(): BrowserSessionId {
    if (!this.activeSessionId) throw new BrowserError("session-not-found", "No browser session is active; call browser_start first.");
    return this.activeSessionId;
  }

  private success(session: BrowserSessionInfo, summary: string): BrowserToolOutcome {
    const visibleSession = {
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ...(session.closedAt ? { closedAt: session.closedAt } : {}),
      ...(session.expiredAt ? { expiredAt: session.expiredAt } : {}),
    };
    return { ok: true, content: stableStringify(visibleSession), summary };
  }

  private async awaitApproval(
    approve: NonNullable<BrowserToolContext["approveBrowser"]>,
    request: BrowserApprovalRequest,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<BrowserApprovalDecision> {
    const controller = new AbortController();
    let resolveCancellation: ((decision: BrowserApprovalDecision) => void) | undefined;
    const cancellation = new Promise<BrowserApprovalDecision>((resolve) => { resolveCancellation = resolve; });
    const onAbort = () => {
      controller.abort(parentSignal?.reason);
      resolveCancellation?.({ decision: "unavailable", reason: "The active turn ended before browser approval was completed." });
    };
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<BrowserApprovalDecision>((resolve) => {
      timer = setTimeout(() => {
        controller.abort("approval-timeout");
        resolve({ decision: "unavailable", reason: `Approval was not received within ${timeoutMs}ms; the browser action was not started.` });
      }, timeoutMs);
    });
    try {
      return await Promise.race([approve(request, controller.signal), timeout, cancellation]);
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  }
}
