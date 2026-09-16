import type { BrowserDownloadCapture, BrowserDownloadTarget, BrowserScreenshotTarget } from "./artifacts.js";

export type BrowserSessionId = string & { readonly __brand: "BrowserSessionId" };
export type BrowserTabId = string & { readonly __brand: "BrowserTabId" };
export type BrowserDocumentId = string & { readonly __brand: "BrowserDocumentId" };

export const DEFAULT_BROWSER_SESSION_TIMEOUT_MS = 30 * 60 * 1_000;
export const DEFAULT_BROWSER_READ_RETRY_COUNT = 1;
export const DEFAULT_BROWSER_READ_ONLY_TIMEOUT_MS = 10_000;

export type BrowserSessionStatus = "active" | "closed" | "expired" | "failed";
export type BrowserActionKind = "click" | "type" | "press" | "upload" | "download";
export type BrowserApprovalAction = BrowserActionKind | "dialog";
export type BrowserDialogType = "alert" | "beforeunload" | "confirm" | "prompt";
export type BrowserDialogDecision = "accept" | "dismiss";

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
}

export interface BrowserTabInfo {
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly documentId: BrowserDocumentId;
  readonly url: string;
  readonly title: string;
}

export interface BrowserSnapshot {
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly documentId: BrowserDocumentId;
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly references: readonly BrowserElementReference[];
}

export interface BrowserActionRequest {
  readonly kind: BrowserActionKind;
  readonly reference?: BrowserElementReference;
  readonly text?: string;
  readonly key?: string;
  readonly sourcePath?: string;
  readonly maxBytes?: number;
}

export interface BrowserActionResult {
  readonly sessionId: BrowserSessionId;
  readonly tab: BrowserTabInfo;
  readonly summary: string;
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
}

export interface BrowserSessionInfo {
  readonly sessionId: BrowserSessionId;
  readonly profileDirectory: string;
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
  readonly profileDirectory: string;
  readonly signal?: AbortSignal;
}

/**
 * The browser adapter seam. BrowserSessionManager owns authorization and identity;
 * adapters own browser handles, pages, and process cleanup. No model-facing code should
 * depend on this interface's concrete browser library.
 */
export interface BrowserAdapter {
  startSession(request: BrowserAdapterStartRequest): Promise<void>;
  closeSession(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<void>;
  closeTab?(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<void>;
  listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]>;
  open(sessionId: BrowserSessionId, url: string, signal?: AbortSignal): Promise<BrowserTabInfo>;
  snapshot(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<BrowserSnapshot>;
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
