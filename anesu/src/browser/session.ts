import { randomUUID } from "node:crypto";
import { BrowserError } from "./errors.js";
import { DEFAULT_BROWSER_READ_ONLY_TIMEOUT_MS, DEFAULT_BROWSER_READ_RETRY_COUNT, DEFAULT_BROWSER_SESSION_TIMEOUT_MS } from "./contracts.js";
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserDialogApproval,
  BrowserAdapter,
  BrowserSessionId,
  BrowserSessionInfo,
  BrowserSnapshot,
  BrowserSnapshotRequest,
  BrowserTabCloseResult,
  BrowserTabId,
  BrowserTabInfo,
  BrowserProfileMode,
  BrowserAdapterStartRequest,
} from "./contracts.js";
import type { CuaAuthorizationCallback } from "./cua-authorization.js";
import { asBrowserSessionId } from "./contracts.js";
import { BrowserUrlPolicy } from "./policy.js";
import { BrowserArtifactStore, type BrowserArtifactInfo, type BrowserDownloadTarget } from "./artifacts.js";
import type { BrowserProfileLease } from "./cleanup.js";
import type { BrowserWaitRequest, BrowserWaitResult, BrowserScreenshotCapture } from "./contracts.js";
import type { ComputerRuntimeEvidence } from "../computer/contracts.js";

export interface BrowserSessionManagerOptions {
  readonly maxTabs?: number;
  readonly readOnlyRetryCount?: number;
  readonly readOnlyTimeoutMs?: number;
  readonly sessionTimeoutMs?: number;
  readonly profileDirectory?: (sessionId: BrowserSessionId) => string;
  readonly acquireProfileLease?: (profileDirectory: string) => Promise<BrowserProfileLease>;
  readonly cleanupProfile?: (profileDirectory: string) => Promise<void>;
  readonly artifactStore?: BrowserArtifactStore;
  readonly now?: () => string;
  readonly createSessionId?: () => BrowserSessionId;
  readonly urlPolicy?: BrowserUrlPolicy;
}

export interface BrowserNavigationTarget {
  readonly url: string;
  readonly origin: string;
  readonly local: boolean;
}

interface SessionState {
  info: BrowserSessionInfo;
  tabs: Map<BrowserTabId, BrowserTabInfo>;
  closedTabs: Set<BrowserTabId>;
  expiryTimer?: NodeJS.Timeout;
  adapterClosed: boolean;
  profileCleaned: boolean;
  profileLease?: BrowserProfileLease;
}

function defaultProfileDirectory(sessionId: BrowserSessionId): string {
  return `.anesu-browser/${sessionId}`;
}

function defaultSessionId(): BrowserSessionId {
  return asBrowserSessionId(`browser_${randomUUID().replaceAll("-", "")}`);
}

/**
 * Owns browser session and tab identity while delegating browser mechanics to an
 * adapter. The manager is deliberately the only caller-facing browser module: it
 * validates navigation, prevents cross-session tab use, and invalidates stale refs.
 */
export class BrowserSessionManager {
  private readonly sessions = new Map<BrowserSessionId, SessionState>();
  /** Serializes all browser state and adapter calls for one task session. */
  private readonly sessionQueues = new Map<BrowserSessionId, Promise<void>>();
  private readonly profileDirectory: (sessionId: BrowserSessionId) => string;
  private readonly acquireProfileLease?: (profileDirectory: string) => Promise<BrowserProfileLease>;
  private readonly cleanupProfile?: (profileDirectory: string) => Promise<void>;
  private readonly now: () => string;
  private readonly createSessionId: () => BrowserSessionId;
  private readonly urlPolicy: BrowserUrlPolicy;
  private readonly artifactStore?: BrowserArtifactStore;
  private readonly maxTabs: number;
  private readonly readOnlyRetryCount: number;
  private readonly readOnlyTimeoutMs: number;
  private readonly sessionTimeoutMs: number;

  constructor(
    private readonly adapter: BrowserAdapter,
    options: BrowserSessionManagerOptions = {},
  ) {
    this.maxTabs = options.maxTabs ?? 8;
    if (!Number.isInteger(this.maxTabs) || this.maxTabs <= 0) {
      throw new BrowserError("browser-resource-limit", "The browser maximum tab count must be a positive integer.");
    }
    this.readOnlyRetryCount = options.readOnlyRetryCount ?? DEFAULT_BROWSER_READ_RETRY_COUNT;
    if (!Number.isInteger(this.readOnlyRetryCount) || this.readOnlyRetryCount < 0) {
      throw new BrowserError("browser-resource-limit", "The browser read-only retry count must be a non-negative integer.");
    }
    this.readOnlyTimeoutMs = options.readOnlyTimeoutMs ?? DEFAULT_BROWSER_READ_ONLY_TIMEOUT_MS;
    if (!Number.isInteger(this.readOnlyTimeoutMs) || this.readOnlyTimeoutMs <= 0) {
      throw new BrowserError("browser-resource-limit", "The browser read-only timeout must be a positive integer.");
    }
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_BROWSER_SESSION_TIMEOUT_MS;
    if (!Number.isInteger(this.sessionTimeoutMs) || this.sessionTimeoutMs <= 0) {
      throw new BrowserError("browser-resource-limit", "The browser session timeout must be a positive integer.");
    }
    this.profileDirectory = options.profileDirectory ?? defaultProfileDirectory;
    this.acquireProfileLease = options.acquireProfileLease;
    this.cleanupProfile = options.cleanupProfile;
    this.artifactStore = options.artifactStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createSessionId = options.createSessionId ?? defaultSessionId;
    this.urlPolicy = options.urlPolicy ?? new BrowserUrlPolicy();
  }

  async start(signal?: AbortSignal, options?: { readonly profileMode?: BrowserProfileMode; readonly authorizeExistingProfile?: CuaAuthorizationCallback; readonly allowedOrigins?: readonly string[] }): Promise<BrowserSessionInfo> {
    const sessionId = this.createSessionId();
    if (this.sessions.has(sessionId)) {
      throw new BrowserError("adapter-failure", `Browser session '${sessionId}' already exists.`);
    }
    const createdAt = this.now();
    const expiresAt = new Date(Date.parse(createdAt) + this.sessionTimeoutMs).toISOString();
    const profileDirectory = this.adapter.ownsProfileLifecycle
      ? undefined
      : this.profileDirectory(sessionId);
    const info: BrowserSessionInfo = {
      sessionId,
      status: "active",
      createdAt,
      expiresAt,
      ...(profileDirectory ? { profileDirectory } : {}),
    };
    let profileLease: BrowserProfileLease | undefined;
    try {
      profileLease = this.acquireProfileLease && profileDirectory
        ? await this.acquireProfileLease(profileDirectory)
        : undefined;
      const startRequest: BrowserAdapterStartRequest = {
        sessionId,
        ...(options?.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
        ...(profileDirectory ? { profileDirectory } : {}),
        ...(options?.profileMode ? { profileMode: options.profileMode } : {}),
        ...(options?.authorizeExistingProfile ? { authorizeExistingProfile: options.authorizeExistingProfile } : {}),
        signal,
      };
      await this.adapter.startSession(startRequest);
      const state: SessionState = { info, tabs: new Map(), closedTabs: new Set(), adapterClosed: false, profileCleaned: false, profileLease };
      this.sessions.set(sessionId, state);
      const expiryTimer = setTimeout(() => {
        void this.withSessionLock(sessionId, () => this.expireSession(sessionId));
      }, this.sessionTimeoutMs);
      expiryTimer.unref?.();
      state.expiryTimer = expiryTimer;
      return info;
    } catch (error) {
      await profileLease?.release().catch(() => undefined);
      throw error;
    }
  }

  async close(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<BrowserSessionInfo> {
    return this.withSessionLock(sessionId, () => this.closeUnlocked(sessionId, signal));
  }

  /** Validate a destination without dispatching browser navigation. */
  async validateNavigationTarget(rawUrl: string): Promise<BrowserNavigationTarget> {
    const target = await this.validateUrl(rawUrl);
    return { url: target.url, origin: new URL(target.url).origin, local: target.local };
  }

  private async closeUnlocked(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<BrowserSessionInfo> {
    const session = this.requireSession(sessionId);
    if (session.info.status === "closed") return session.info;
    if (session.expiryTimer) clearTimeout(session.expiryTimer);
    let closeError: unknown;
    if (!session.adapterClosed) {
      try {
        await this.adapter.closeSession(sessionId, signal);
        session.adapterClosed = true;
      } catch (error) {
        closeError = error;
      }
    }
    let cleanupError: unknown;
    if (this.cleanupProfile && session.info.profileDirectory && !session.profileCleaned) {
      try {
        await this.cleanupProfile(session.info.profileDirectory);
        session.profileCleaned = true;
      } catch (error) {
        cleanupError = error;
      }
    }
    let leaseError: unknown;
    if (session.profileLease) {
      try {
        await session.profileLease.release();
        session.profileLease = undefined;
      } catch (error) {
        leaseError = error;
      }
    }
    session.info = {
      ...session.info,
      status: "closed",
      closedAt: this.now(),
      ...(closeError && closeError instanceof Error ? { failure: closeError.message } : {}),
      ...(cleanupError || leaseError ? { cleanupError: cleanupError instanceof Error ? cleanupError.message : leaseError instanceof Error ? leaseError.message : "Browser profile cleanup failed." } : {}),
    };
    if (closeError) {
      throw closeError;
    }
    if (cleanupError) {
      throw new BrowserError("adapter-failure", `Browser profile cleanup failed for session '${sessionId}'.`, { cause: cleanupError });
    }
    if (leaseError) {
      throw new BrowserError("adapter-failure", `Browser profile ownership could not be released for session '${sessionId}'.`, { cause: leaseError });
    }
    return session.info;
  }

  async closeAll(signal?: AbortSignal): Promise<void> {
    let firstError: unknown;
    for (const session of this.sessions.values()) {
      if (session.info.status === "closed") continue;
      try {
        await this.close(session.info.sessionId, signal);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  get(sessionId: BrowserSessionId): BrowserSessionInfo {
    return this.requireSession(sessionId).info;
  }

  runtimeEvidence(): ComputerRuntimeEvidence | undefined {
    return this.adapter.runtimeEvidence?.();
  }

  async listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    return this.withSessionLock(sessionId, () => this.listTabsUnlocked(sessionId, signal));
  }

  private async listTabsUnlocked(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    const session = this.requireActiveSession(sessionId);
    const tabs = await this.withReadOnlyRetry(sessionId, signal, (readSignal) => this.adapter.listTabs(sessionId, readSignal));
    this.assertTabLimit(tabs.length);
    this.replaceTabs(session, tabs);
    return tabs;
  }

  async closeTab(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<BrowserTabCloseResult> {
    return this.withSessionLock(sessionId, () => this.closeTabUnlocked(sessionId, tabId, signal));
  }

  private async closeTabUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<BrowserTabCloseResult> {
    const session = this.requireActiveSession(sessionId);
    this.requireTab(session, tabId);
    if (!this.adapter.closeTab) {
      throw new BrowserError("adapter-failure", "The configured browser adapter does not support closing individual tabs.");
    }
    await this.withFailureTracking(sessionId, () => this.adapter.closeTab?.(sessionId, tabId, signal) ?? Promise.resolve());
    session.tabs.delete(tabId);
    session.closedTabs.add(tabId);
    return { sessionId, tabId, status: "closed" };
  }

  async open(sessionId: BrowserSessionId, rawUrl: string, signal?: AbortSignal): Promise<BrowserTabInfo> {
    return this.withSessionLock(sessionId, () => this.openUnlocked(sessionId, rawUrl, signal));
  }

  private async openUnlocked(sessionId: BrowserSessionId, rawUrl: string, signal?: AbortSignal): Promise<BrowserTabInfo> {
    const session = this.requireActiveSession(sessionId);
    this.assertTabLimit(session.tabs.size + 1);
    const requested = await this.validateUrl(rawUrl);
    const tab = await this.withFailureTracking(sessionId, () => this.adapter.open(sessionId, requested.url, signal));
    this.assertTabBelongsToSession(sessionId, tab);
    await this.validateRedirect(requested.url, tab.url);
    session.tabs.set(tab.tabId, tab);
    session.closedTabs.delete(tab.tabId);
    return tab;
  }

  async snapshot(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal, request?: BrowserSnapshotRequest): Promise<BrowserSnapshot> {
    return this.withSessionLock(sessionId, () => this.snapshotUnlocked(sessionId, tabId, signal, request));
  }

  private async snapshotUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal, request?: BrowserSnapshotRequest): Promise<BrowserSnapshot> {
    const session = this.requireActiveSession(sessionId);
    this.requireTab(session, tabId);
    const read = (readSignal: AbortSignal) => this.adapter.snapshot(sessionId, tabId, readSignal, request);
    // Cua continuations are single-use capabilities. Retrying one after a lost
    // acknowledgement could consume a different page read or replay a stale
    // capability, so only ordinary fresh reads use the read-only retry policy.
    const snapshot = request?.continuation === undefined
      ? await this.withReadOnlyRetry(sessionId, signal, read)
      : await this.withFailureTracking(sessionId, () => read(signal ?? new AbortController().signal));
    this.assertSnapshotBelongsToSession(sessionId, tabId, snapshot);
    await this.validateUrl(snapshot.url);
    session.tabs.set(tabId, {
      sessionId,
      tabId,
      documentId: snapshot.documentId,
      url: snapshot.url,
      title: snapshot.title,
    });
    return snapshot;
  }

  async act(
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    request: BrowserActionRequest,
    signal?: AbortSignal,
    approveDialog?: BrowserDialogApproval,
  ): Promise<BrowserActionResult> {
    return this.withSessionLock(sessionId, () => this.actUnlocked(sessionId, tabId, request, signal, approveDialog));
  }

  private async actUnlocked(
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    request: BrowserActionRequest,
    signal?: AbortSignal,
    approveDialog?: BrowserDialogApproval,
  ): Promise<BrowserActionResult> {
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    if (request.reference && request.reference.documentId !== tab.documentId) {
      throw new BrowserError("stale-reference", "The browser element reference is stale; take a new snapshot before acting.");
    }
    if (request.destinationReference && request.destinationReference.documentId !== tab.documentId) {
      throw new BrowserError("stale-reference", "The browser pointer destination reference is stale; take a new snapshot before acting.");
    }
    const result = await this.withFailureTracking(sessionId, () => this.adapter.act(sessionId, tabId, request, signal, approveDialog));
    this.assertTabBelongsToSession(sessionId, result.tab);
    await this.validateRedirect(tab.url, result.tab.url);
    session.tabs.set(tabId, result.tab);
    return result;
  }

  async wait(
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    request: BrowserWaitRequest,
    signal?: AbortSignal,
  ): Promise<BrowserWaitResult> {
    return this.withSessionLock(sessionId, () => this.waitUnlocked(sessionId, tabId, request, signal));
  }

  private async waitUnlocked(
    sessionId: BrowserSessionId,
    tabId: BrowserTabId,
    request: BrowserWaitRequest,
    signal?: AbortSignal,
  ): Promise<BrowserWaitResult> {
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    await this.validateUrl(tab.url);
    const result = await this.withFailureTracking(sessionId, () => this.adapter.wait(sessionId, tabId, request, signal));
    this.assertTabBelongsToSession(sessionId, result.tab);
    await this.validateRedirect(tab.url, result.tab.url);
    session.tabs.set(tabId, result.tab);
    return result;
  }

  async screenshot(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<BrowserArtifactInfo> {
    return this.withSessionLock(sessionId, () => this.screenshotUnlocked(sessionId, tabId, signal));
  }

  private async screenshotUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal): Promise<BrowserArtifactInfo> {
    const store = this.artifactStore;
    if (!store) throw new BrowserError("artifact-violation", "Browser artifact storage is not configured.");
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    await this.validateUrl(tab.url);
    const target = await store.createScreenshotTarget(sessionId, tabId);
    try {
      const capture: BrowserScreenshotCapture = await this.withFailureTracking(sessionId, () => this.adapter.screenshot(sessionId, tabId, target, signal));
      return await store.finalizeScreenshot(target, capture);
    } catch (error) {
      await store.discardScreenshot(target).catch(() => undefined);
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("adapter-failure", "The browser screenshot could not be captured.", { cause: error });
    }
  }

  async reserveDownload(sessionId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserDownloadTarget> {
    return this.withSessionLock(sessionId, () => this.reserveDownloadUnlocked(sessionId, tabId));
  }

  private async reserveDownloadUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId): Promise<BrowserDownloadTarget> {
    const store = this.artifactStore;
    if (!store) throw new BrowserError("artifact-violation", "Browser artifact storage is not configured.");
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    await this.validateUrl(tab.url);
    return store.createDownloadTarget(sessionId, tabId);
  }

  async discardDownload(target: BrowserDownloadTarget): Promise<void> {
    const store = this.artifactStore;
    if (!store) throw new BrowserError("artifact-violation", "Browser artifact storage is not configured.");
    await store.discardDownload(target);
  }

  async upload(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    return this.withSessionLock(sessionId, () => this.uploadUnlocked(sessionId, tabId, request, signal, approveDialog));
  }

  private async uploadUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    if (!request.sourcePath) throw new BrowserError("invalid-action", "A browser upload requires a resolved source path.");
    if (request.reference && request.reference.documentId !== tab.documentId) {
      throw new BrowserError("stale-reference", "The browser upload reference is stale; take a new snapshot before uploading.");
    }
    await this.validateUrl(tab.url);
    const result = await this.withFailureTracking(sessionId, () => this.adapter.upload(sessionId, tabId, request, signal, approveDialog));
    this.assertTabBelongsToSession(sessionId, result.tab);
    await this.validateRedirect(tab.url, result.tab.url);
    session.tabs.set(tabId, result.tab);
    return result;
  }

  async download(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, target: BrowserDownloadTarget, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserArtifactInfo> {
    return this.withSessionLock(sessionId, () => this.downloadUnlocked(sessionId, tabId, request, target, signal, approveDialog));
  }

  private async downloadUnlocked(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, target: BrowserDownloadTarget, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserArtifactInfo> {
    const store = this.artifactStore;
    if (!store) throw new BrowserError("artifact-violation", "Browser artifact storage is not configured.");
    const session = this.requireActiveSession(sessionId);
    const tab = this.requireTab(session, tabId);
    await this.validateUrl(tab.url);
    try {
      const capture = await this.withFailureTracking(sessionId, () => this.adapter.download(sessionId, tabId, request, target, signal, approveDialog));
      return await store.finalizeDownload(target, capture);
    } catch (error) {
      await store.discardDownload(target).catch(() => undefined);
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("adapter-failure", "The browser download could not be captured.", { cause: error });
    }
  }

  private requireSession(sessionId: BrowserSessionId): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new BrowserError("session-not-found", `Browser session '${sessionId}' was not found.`);
    return session;
  }

  private async withSessionLock<T>(sessionId: BrowserSessionId, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.sessionQueues.set(sessionId, current);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.sessionQueues.get(sessionId) === current) this.sessionQueues.delete(sessionId);
    }
  }

  private async validateUrl(rawUrl: string) {
    try {
      return await this.urlPolicy.validate(rawUrl);
    } catch (error) {
      throw new BrowserError("navigation-policy", error instanceof Error ? error.message : "Browser navigation target was rejected.", { cause: error });
    }
  }

  private async validateRedirect(fromUrl: string, toUrl: string): Promise<void> {
    try {
      await this.urlPolicy.validateRedirect(fromUrl, toUrl);
    } catch (error) {
      throw new BrowserError("navigation-policy", error instanceof Error ? error.message : "Browser redirect target was rejected.", { cause: error });
    }
  }

  private requireActiveSession(sessionId: BrowserSessionId): SessionState {
    const session = this.requireSession(sessionId);
    if (session.info.status === "closed") {
      throw new BrowserError("session-closed", `Browser session '${sessionId}' is closed.`);
    }
    if (session.info.status === "expired") {
      throw new BrowserError("session-timeout", session.info.failure ?? `Browser session '${sessionId}' exceeded its lifetime.`);
    }
    if (session.info.status === "failed") {
      throw new BrowserError("browser-crash", session.info.failure ?? `Browser session '${sessionId}' is no longer available.`);
    }
    return session;
  }

  private async expireSession(sessionId: BrowserSessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status !== "active") return;
    let closeError: unknown;
    if (!session.adapterClosed) {
      try {
        await this.adapter.closeSession(sessionId);
        session.adapterClosed = true;
      } catch (error) {
        closeError = error;
      }
    }
    let cleanupError: unknown;
    if (this.cleanupProfile && session.info.profileDirectory && !session.profileCleaned) {
      try {
        await this.cleanupProfile(session.info.profileDirectory);
        session.profileCleaned = true;
      } catch (error) {
        cleanupError = error;
      }
    }
    let leaseError: unknown;
    if (session.profileLease) {
      try {
        await session.profileLease.release();
        session.profileLease = undefined;
      } catch (error) {
        leaseError = error;
      }
    }
    session.info = {
      ...session.info,
      status: "expired",
      expiredAt: this.now(),
      failure: closeError instanceof Error
        ? `Browser session lifetime expired; browser cleanup failed: ${closeError.message}`
        : "Browser session lifetime expired.",
      ...(cleanupError || leaseError ? { cleanupError: cleanupError instanceof Error ? cleanupError.message : leaseError instanceof Error ? leaseError.message : "Browser profile cleanup failed." } : {}),
    };
  }

  private async withFailureTracking<T>(sessionId: BrowserSessionId, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BrowserError && error.browserCode === "browser-crash") {
        const session = this.requireSession(sessionId);
        session.info = {
          ...session.info,
          status: "failed",
          failedAt: this.now(),
          failure: error.message,
        };
      }
      throw error;
    }
  }

  private async withReadOnlyRetry<T>(sessionId: BrowserSessionId, parentSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.readOnlyTimeoutMs;
    let attempts = 0;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new BrowserError("browser-timeout", "The browser read-only operation exceeded its timeout.");
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort("timeout"), remaining);
      const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutController.signal]) : timeoutController.signal;
      let timeoutTimer: NodeJS.Timeout | undefined;
      try {
        const operationPromise = this.withFailureTracking(sessionId, () => operation(signal));
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          const onTimeout = () => reject(new BrowserError("browser-timeout", "The browser read-only operation exceeded its timeout."));
          if (remaining <= 0) onTimeout();
          else {
            timeoutTimer = setTimeout(onTimeout, remaining);
            timeoutTimer.unref?.();
          }
        });
        return await Promise.race([operationPromise, timeoutPromise]);
      } catch (error) {
        if (parentSignal?.aborted) {
          throw new BrowserError("browser-cancelled", "The browser read-only operation was cancelled.");
        }
        if (!(error instanceof BrowserError) || error.browserCode !== "adapter-failure" || attempts >= this.readOnlyRetryCount) {
          throw error;
        }
        attempts += 1;
      } finally {
        clearTimeout(timer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    }
  }

  private requireTab(session: SessionState, tabId: BrowserTabId): BrowserTabInfo {
    const tab = session.tabs.get(tabId);
    if (!tab && session.closedTabs.has(tabId)) throw new BrowserError("tab-closed", `Browser tab '${tabId}' is closed.`);
    if (!tab) throw new BrowserError("tab-not-found", `Browser tab '${tabId}' is not owned by this session.`);
    return tab;
  }

  private replaceTabs(session: SessionState, tabs: readonly BrowserTabInfo[]): void {
    session.tabs.clear();
    for (const tab of tabs) {
      this.assertTabBelongsToSession(session.info.sessionId, tab);
      session.tabs.set(tab.tabId, tab);
    }
  }

  private assertTabBelongsToSession(sessionId: BrowserSessionId, tab: BrowserTabInfo): void {
    if (tab.sessionId !== sessionId) {
      throw new BrowserError("tab-ownership", `Browser adapter returned tab '${tab.tabId}' for the wrong session.`);
    }
  }

  private assertTabLimit(count: number): void {
    if (count > this.maxTabs) {
      throw new BrowserError("browser-resource-limit", `The browser session reached its maximum of ${this.maxTabs} browser tab${this.maxTabs === 1 ? "" : "s"}.`);
    }
  }

  private assertSnapshotBelongsToSession(sessionId: BrowserSessionId, tabId: BrowserTabId, snapshot: BrowserSnapshot): void {
    if (snapshot.sessionId !== sessionId || snapshot.tabId !== tabId) {
      throw new BrowserError("tab-ownership", "Browser adapter returned a snapshot for the wrong session or tab.");
    }
  }
}
