import type { BrowserDownloadCapture, BrowserDownloadTarget, BrowserScreenshotTarget } from "./artifacts.js";
import type {
  BrowserActionEffect as CuaBrowserActionEffect,
  BrowserActionRoute as CuaBrowserActionRoute,
  BrowserDeliveryMode as CuaBrowserDeliveryMode,
  BrowserEscalationReason as CuaBrowserEscalationReason,
  BrowserEscalationTarget as CuaBrowserEscalationTarget,
} from "./cua-browser-gateway.js";
import type { ComputerRuntimeEvidence } from "../computer/contracts.js";
import type { CuaAuthorizationCallback } from "./cua-authorization.js";

export type BrowserSessionId = string & { readonly __brand: "BrowserSessionId" };
export type BrowserTabId = string & { readonly __brand: "BrowserTabId" };
export type BrowserDocumentId = string & { readonly __brand: "BrowserDocumentId" };

export const DEFAULT_BROWSER_SESSION_TIMEOUT_MS = 30 * 60 * 1_000;
export const DEFAULT_BROWSER_READ_RETRY_COUNT = 1;
export const DEFAULT_BROWSER_READ_ONLY_TIMEOUT_MS = 10_000;

export type BrowserSessionStatus = "active" | "closed" | "expired" | "failed";
export type BrowserProfileMode = "isolated_new" | "existing_profile";
export type BrowserSearchProvider = "bing" | "duckduckgo" | "google";
export type BrowserScrollDirection = "up" | "down" | "left" | "right";
export type BrowserInputRoute = "trusted" | "dom_event";
export const SUPPORTED_BROWSER_PRESS_KEYS = ["Enter"] as const;
export type BrowserTypingMode = "insert_text" | "keystrokes";
export type BrowserPointerAction = "hover" | "right_click" | "double_click" | "drag";
export type BrowserActionKind = "click" | "type" | "press" | "select" | "scroll" | "upload" | "download" | "pointer";
export type BrowserApprovalAction = BrowserActionKind | "dialog";
export type BrowserDialogType = "alert" | "beforeunload" | "confirm" | "prompt";
export type BrowserDialogDecision = "accept" | "dismiss";
export type BrowserActionEffect = CuaBrowserActionEffect;
export type BrowserActionRoute = CuaBrowserActionRoute;
export type BrowserDeliveryMode = CuaBrowserDeliveryMode;
export type BrowserEscalationTarget = CuaBrowserEscalationTarget;
export type BrowserEscalationReason = CuaBrowserEscalationReason;

export interface BrowserDialogObservation {
  readonly type: BrowserDialogType;
  readonly message: string;
}

export interface BrowserDialogResolution {
  readonly decision: BrowserDialogDecision;
  readonly promptText?: string;
}

export type BrowserDialogApproval = (dialog: BrowserDialogObservation, signal?: AbortSignal) => Promise<BrowserDialogResolution>;

export interface BrowserElementReference {
  readonly value: string;
  readonly documentId: BrowserDocumentId;
  /** Bounded semantic_v2 action declarations from the same snapshot. */
  readonly actions?: readonly string[];
  readonly states?: Readonly<Partial<Record<"checked" | "selected" | "expanded" | "disabled" | "required", boolean>>>;
  /** Current editable value when semantic_v2 exposes one; never treated as an opaque ref. */
  readonly currentValue?: string;
  readonly role?: string;
  readonly name?: string;
  readonly type?: string;
  readonly destinationRef?: string;
}

export interface BrowserTabInfo {
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly documentId: BrowserDocumentId;
  readonly url: string;
  readonly title: string;
  /** Present when the adapter can prove the active tab from its exact binding. */
  readonly active?: boolean;
}

export interface BrowserSnapshot {
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly documentId: BrowserDocumentId;
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly references: readonly BrowserElementReference[];
  /** Read-only heading facts from semantic_v2 content refs. */
  readonly headings?: readonly string[];
  /** Cua semantic_v2 completeness and bounded-read metadata. */
  readonly complete?: boolean;
  readonly scope?: string;
  readonly continuation?: string;
  readonly omissions?: Readonly<Record<string, number>>;
  readonly oopif?: {
    readonly status: string;
    readonly frames: number;
  };
}

/** Bounded semantic_v2 read parameters. A continuation is single-use. */
export interface BrowserSnapshotRequest {
  readonly scopeRef?: string;
  readonly query?: string;
  readonly continuation?: string;
}

export interface BrowserActionRequest {
  readonly kind: BrowserActionKind;
  /** The route is part of the approved action; Linux X11 may require dom_event. */
  readonly inputRoute?: BrowserInputRoute;
  readonly reference?: BrowserElementReference;
  readonly destinationReference?: BrowserElementReference;
  readonly pointerAction?: BrowserPointerAction;
  /** Optional Cua delivery mode for typed text; omitted uses Cua's default. */
  readonly typingMode?: BrowserTypingMode;
  readonly text?: string;
  readonly key?: string;
  /** Exact visible option label for a native select control. */
  readonly value?: string;
  readonly direction?: BrowserScrollDirection;
  readonly amount?: number;
  readonly sourcePath?: string;
  readonly maxBytes?: number;
}

export interface BrowserActionResult {
  readonly sessionId: BrowserSessionId;
  readonly tab: BrowserTabInfo;
  readonly summary: string;
  /** Bounded Cua result metadata for the dispatched browser action. */
  readonly effect?: BrowserActionEffect;
  readonly route?: BrowserActionRoute;
  readonly delivery?: {
    readonly mode: BrowserDeliveryMode;
    readonly deliveredCount?: number;
  };
  readonly escalation?: {
    readonly target: BrowserEscalationTarget;
    readonly reason: BrowserEscalationReason;
  };
}

export interface BrowserWaitRequest {
  readonly milliseconds: number;
}

export interface BrowserWaitResult {
  readonly sessionId: BrowserSessionId;
  readonly tab: BrowserTabInfo;
  readonly waitedMs: number;
}

export interface BrowserTabCloseResult {
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly status: "closed";
}

export interface BrowserScreenshotCapture {
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserUploadSource {
  readonly requestedPath: string;
  readonly absolutePath: string;
  readonly byteSize: number;
  /** Content and filesystem identity captured before approval and rechecked before upload. */
  readonly identity: BrowserFileIdentity;
}

export interface BrowserFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly contentHash: string;
}

export interface BrowserSessionInfo {
  readonly sessionId: BrowserSessionId;
  /** Present only for adapters whose profile lifecycle Anesu owns. */
  readonly profileDirectory?: string;
  readonly status: BrowserSessionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly closedAt?: string;
  readonly expiredAt?: string;
  readonly failedAt?: string;
  readonly failure?: string;
  readonly cleanupError?: string;
}

export interface BrowserAdapterStartRequest {
  readonly sessionId: BrowserSessionId;
  /** Exact public origins admitted by the current computer task. */
  readonly allowedOrigins?: readonly string[];
  /** Compatibility input for adapters with an Anesu-managed profile. Cua owns its profile. */
  readonly profileDirectory?: string;
  /** Isolated Cua launch is the default; existing-profile attachment is explicit. */
  readonly profileMode?: BrowserProfileMode;
  /** One task-scoped, digest-bound host decision for an existing-profile attach. */
  readonly authorizeExistingProfile?: CuaAuthorizationCallback;
  readonly signal?: AbortSignal;
}

/**
 * The browser adapter seam. BrowserSessionManager owns authorization and identity;
 * adapters own browser handles, pages, and process cleanup. No model-facing code should
 * depend on this interface's concrete browser library.
 */
export interface BrowserAdapter {
  /** Cua-owned adapters prepare and clean profiles through their own runtime. */
  readonly ownsProfileLifecycle?: boolean;
  /** Content-free capability proof captured during Cua preflight. */
  runtimeEvidence?(): ComputerRuntimeEvidence | undefined;
  startSession(request: BrowserAdapterStartRequest): Promise<void>;
  closeSession(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<void>;
  closeTab?(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<void>;
  listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]>;
  open(sessionId: BrowserSessionId, url: string, signal?: AbortSignal): Promise<BrowserTabInfo>;
  snapshot(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal, request?: BrowserSnapshotRequest): Promise<BrowserSnapshot>;
  act(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult>;
  wait(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserWaitRequest, signal?: AbortSignal): Promise<BrowserWaitResult>;
  screenshot(sessionId: BrowserSessionId, tabId: BrowserTabId, target: BrowserScreenshotTarget, signal?: AbortSignal): Promise<BrowserScreenshotCapture>;
  upload(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult>;
  download(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, target: BrowserDownloadTarget, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserDownloadCapture>;
}

export function asBrowserSessionId(value: string): BrowserSessionId {
  return value as BrowserSessionId;
}

export function asBrowserTabId(value: string): BrowserTabId {
  return value as BrowserTabId;
}

export function asBrowserDocumentId(value: string): BrowserDocumentId {
  return value as BrowserDocumentId;
}
