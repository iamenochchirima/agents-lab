import { createHash, randomUUID } from "node:crypto";
import { stableStringify } from "../persistence/json.js";
import { isRuntimeInterruptionError, redactSecrets, ToolExecutionError } from "../runtime/errors.js";
import type {
  BrowserActionKind,
  BrowserApprovalAction,
  BrowserActionRequest,
  BrowserUploadSource,
  BrowserDialogObservation,
  BrowserDialogApproval,
  BrowserDialogDecision,
  BrowserDialogResolution,
  BrowserDocumentId,
  BrowserElementReference,
  BrowserSessionId,
  BrowserSessionInfo,
  BrowserTabId,
  BrowserTabInfo,
  BrowserWaitResult,
} from "./contracts.js";
import type { BrowserArtifactInfo } from "./artifacts.js";
import type { BrowserDownloadTarget } from "./artifacts.js";
import { BrowserError, type BrowserDiagnostic, type BrowserErrorCode } from "./errors.js";
import { sameBrowserFileIdentity } from "./files.js";
import { BrowserSessionManager } from "./session.js";
import { asBrowserDocumentId } from "./contracts.js";

export type BrowserToolErrorCode = BrowserErrorCode | "browser-approval-denied" | "browser-approval-unavailable";

export interface BrowserApprovalRequest {
  readonly actionId: string;
  readonly callId: string;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly action: BrowserApprovalAction;
  readonly reference: string;
  readonly documentId: BrowserDocumentId;
  readonly text?: string;
  readonly key?: string;
  readonly path?: string;
  readonly maxBytes?: number;
  readonly actionHash: string;
  readonly approvalTimeoutMs?: number;
  readonly warning: string;
  readonly dialog?: BrowserDialogObservation;
}

export type BrowserApprovalDecision =
  | { readonly decision: "allow-once"; readonly dialogDecision?: BrowserDialogDecision; readonly promptText?: string }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type BrowserToolEvent =
  | { readonly type: "prepared"; readonly request: BrowserApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: BrowserApprovalRequest; readonly decision: BrowserApprovalDecision }
  | { readonly type: "started"; readonly request: BrowserApprovalRequest }
  | { readonly type: "artifact"; readonly artifact: BrowserArtifactInfo }
  | { readonly type: "completed"; readonly request: BrowserApprovalRequest; readonly ok: boolean; readonly summary: string; readonly errorCode?: BrowserToolErrorCode; readonly underlyingErrorCode?: BrowserToolErrorCode; readonly dialog?: BrowserDialogObservation; readonly dialogDecision?: BrowserDialogDecision; readonly cancellationConfirmed?: boolean; readonly diagnostic?: BrowserDiagnostic };

export interface BrowserToolContext {
  readonly signal?: AbortSignal;
  readonly approvalTimeoutMs?: number;
  readonly pauseDeadline?: () => void;
  readonly resumeDeadline?: () => void;
  readonly pauseTurnDeadline?: () => void;
  readonly resumeTurnDeadline?: () => void;
  readonly approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>;
  readonly onBrowser?: (event: BrowserToolEvent) => Promise<void> | void;
}

export interface BrowserToolOptions {
  readonly manager: BrowserSessionManager;
  readonly maxOutputBytes: number;
  readonly redactionSecrets?: readonly string[];
  readonly maxWaitMs?: number;
  readonly resolveUpload?: (requestedPath: string) => Promise<BrowserUploadSource>;
}

export interface BrowserToolOutcome {
  readonly ok: boolean;
  readonly content: string;
  readonly summary: string;
  readonly errorCode?: BrowserToolErrorCode;
}

interface ToolArguments {
  readonly [key: string]: unknown;
}

const BROWSER_TOOL_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  browser_start: [],
  browser_open: ["url"],
  browser_tabs: [],
  browser_snapshot: ["tabId"],
  browser_click: ["ref"],
  browser_type: ["ref", "text"],
  browser_press: ["ref", "key"],
  browser_wait: ["tabId", "milliseconds"],
  browser_screenshot: ["tabId"],
  browser_upload: ["ref", "path"],
  browser_download: ["ref"],
  browser_close: [],
};

const REQUIRED_BROWSER_STRING_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  browser_open: ["url"],
  browser_click: ["ref"],
  browser_type: ["ref", "text"],
  browser_press: ["ref", "key"],
  browser_upload: ["ref", "path"],
  browser_download: ["ref"],
};

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

function safeText(value: string, secrets: readonly string[]): string {
  return redactSecrets(value, secrets);
}

function safeDialog(dialog: BrowserDialogObservation, secrets: readonly string[]): BrowserDialogObservation {
  return { type: dialog.type, message: bounded(safeText(dialog.message, secrets), 2_000) };
}

function normalizeStartedActionError(action: BrowserApprovalAction, errorCode: BrowserToolErrorCode): { readonly errorCode: BrowserToolErrorCode; readonly underlyingErrorCode?: BrowserToolErrorCode } {
  if ((action === "click" || action === "type" || action === "press" || action === "upload" || action === "download")
    && (errorCode === "browser-timeout" || errorCode === "browser-cancelled" || errorCode === "browser-crash" || errorCode === "adapter-failure")) {
    return { errorCode: "browser-ambiguous", underlyingErrorCode: errorCode };
  }
  return { errorCode };
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

export const BROWSER_TOOL_DEFINITIONS = [
  {
    name: "browser_start",
    description: "Start an isolated local browser session. The session is managed by Computer Native and does not attach to the user's personal browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_open",
    description: "Open an allowed HTTP or HTTPS URL in the active isolated browser session. Unsafe schemes, credentials, private targets, and unsafe redirects are rejected.",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "browser_tabs",
    description: "List tabs owned by the active browser session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_snapshot",
    description: "Return a bounded accessibility-oriented snapshot of the active browser tab with short-lived element references such as @e1.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "browser_click",
    description: "Click an element from the latest browser snapshot. This action requires explicit approval.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"], additionalProperties: false },
  },
  {
    name: "browser_type",
    description: "Fill an element from the latest browser snapshot. This action requires explicit approval and never reads the existing field value.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, required: ["ref", "text"], additionalProperties: false },
  },
  {
    name: "browser_press",
    description: "Press a key on an element from the latest browser snapshot. This action requires explicit approval.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, key: { type: "string" } }, required: ["ref", "key"], additionalProperties: false },
  },
  {
    name: "browser_wait",
    description: "Wait for a bounded number of milliseconds while keeping the active browser tab managed by Computer Native. This action has no side effect and does not require approval.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" }, milliseconds: { type: "integer", minimum: 0 } }, required: ["milliseconds"], additionalProperties: false },
  },
  {
    name: "browser_screenshot",
    description: "Capture a bounded PNG screenshot of the active browser tab into the managed browser artifact directory. The result contains artifact metadata, not page instructions.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "browser_upload",
    description: "Upload one bounded regular file from the configured workspace into an input element from the latest browser snapshot. The exact workspace path and byte limit require explicit approval.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, path: { type: "string" } }, required: ["ref", "path"], additionalProperties: false },
  },
  {
    name: "browser_download",
    description: "Click an element from the latest browser snapshot and capture its browser download into the managed artifact directory. The exact artifact path and byte limit require explicit approval.",
    inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"], additionalProperties: false },
  },
  {
    name: "browser_close",
    description: "Close the active isolated browser session and its tabs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

/** Model-facing browser tool orchestration over the deep browser session module. */
export class BrowserTools {
  readonly definitions = BROWSER_TOOL_DEFINITIONS;
  private activeSessionId: BrowserSessionId | undefined;
  private activeTabId: BrowserTabId | undefined;
  private readonly snapshots = new Map<BrowserTabId, { readonly sessionId: BrowserSessionId; readonly documentId: string }>();

  constructor(private readonly options: BrowserToolOptions) {}

  async execute(name: string, callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    this.validateArguments(name, args);
    switch (name) {
      case "browser_start": return this.start(context.signal);
      case "browser_open": return this.open(args, context.signal);
      case "browser_tabs": return this.tabs(context.signal);
      case "browser_snapshot": return this.snapshot(args, context.signal);
      case "browser_click": return this.approvedAction("click", callId, args, context);
      case "browser_type": return this.approvedAction("type", callId, args, context);
      case "browser_press": return this.approvedAction("press", callId, args, context);
      case "browser_wait": return this.wait(args, context.signal);
      case "browser_screenshot": return this.screenshot(args, context.signal, context.onBrowser);
      case "browser_upload": return this.upload(callId, args, context);
      case "browser_download": return this.download(callId, args, context);
      case "browser_close": return this.close(context.signal);
      default: throw new ToolExecutionError(`Unknown browser tool '${name}'.`);
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
    if (name === "browser_wait") {
      const maximum = this.options.maxWaitMs ?? 10_000;
      if (typeof args.milliseconds !== "number" || !Number.isInteger(args.milliseconds) || args.milliseconds < 0 || args.milliseconds > maximum) {
        throw new ToolExecutionError(`Tool argument 'milliseconds' must be an integer between 0 and ${maximum}.`);
      }
    }
  }

  private async start(signal?: AbortSignal): Promise<BrowserToolOutcome> {
    if (this.activeSessionId) {
      const current = this.options.manager.get(this.activeSessionId);
      if (current.status === "active") return this.success(current, `Browser session ${current.sessionId} is already active.`);
    }
    const session = await this.options.manager.start(signal);
    this.activeSessionId = session.sessionId;
    this.activeTabId = undefined;
    return this.success(session, `Started isolated browser session ${session.sessionId}.`);
  }

  private async open(args: ToolArguments, signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const url = stringArgument(args, "url", true) ?? "";
    const tab = await this.options.manager.open(sessionId, url, signal);
    this.activeTabId = tab.tabId;
    const visibleTab = safeTab(tab, this.options.redactionSecrets ?? []);
    return { ok: true, content: stableStringify(visibleTab), summary: `Opened ${visibleTab.url} in browser tab ${tab.tabId}.` };
  }

  private async tabs(signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabs = await this.options.manager.listTabs(sessionId, signal);
    if (!this.activeTabId || !tabs.some((tab) => tab.tabId === this.activeTabId)) this.activeTabId = tabs[0]?.tabId;
    const secrets = this.options.redactionSecrets ?? [];
    return { ok: true, content: bounded(stableStringify(tabs.map((tab) => safeTab(tab, secrets))), this.options.maxOutputBytes), summary: `Listed ${tabs.length} browser tab${tabs.length === 1 ? "" : "s"}.` };
  }

  private async snapshot(args: ToolArguments, signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = (stringArgument(args, "tabId", false) ?? this.activeTabId);
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const snapshot = await this.options.manager.snapshot(sessionId, tabId as BrowserTabId, signal);
    this.activeTabId = snapshot.tabId;
    this.snapshots.set(snapshot.tabId, { sessionId, documentId: snapshot.documentId });
    const secrets = this.options.redactionSecrets ?? [];
    const safeSnapshot = {
      ...snapshot,
      url: safeUrl(snapshot.url, secrets),
      title: safeText(snapshot.title, secrets),
      content: `[Untrusted page content begins]\n${safeText(snapshot.content, secrets)}\n[Untrusted page content ends]`,
    };
    return { ok: true, content: bounded(stableStringify(safeSnapshot), this.options.maxOutputBytes), summary: `Captured browser snapshot for ${snapshot.tabId}.` };
  }

  private async wait(args: ToolArguments, signal?: AbortSignal): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = (stringArgument(args, "tabId", false) ?? this.activeTabId);
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const maximum = this.options.maxWaitMs ?? 10_000;
    const milliseconds = integerArgument(args, "milliseconds", 0, maximum);
    const result: BrowserWaitResult = await this.options.manager.wait(sessionId, tabId as BrowserTabId, { milliseconds }, signal);
    this.activeTabId = result.tab.tabId;
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
    const sessionId = this.requireSession();
    const tabId = this.activeTabId;
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const ref = stringArgument(args, "ref", true) ?? "";
    const snapshot = this.requireSnapshot(sessionId, tabId);
    const requestedPath = stringArgument(args, "path", true) ?? "";
    if (!this.options.resolveUpload) throw new BrowserError("artifact-violation", "Browser uploads are disabled because no workspace upload policy is configured.");
    const source = await this.options.resolveUpload(requestedPath);
    const requestWithoutHash = {
      actionId: `browser_action_${randomUUID().replaceAll("-", "")}`,
      callId,
      sessionId,
      tabId,
      action: "upload" as const,
      reference: ref,
      documentId: asBrowserDocumentId(snapshot.documentId),
      path: source.requestedPath,
      maxBytes: source.byteSize,
      approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
      warning: "This browser upload sends a local workspace file to the page. The exact path and byte size must be approved before it runs.",
    } satisfies Omit<BrowserApprovalRequest, "actionHash">;
    const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
    const decision = await this.obtainApproval(request, context);
    if (decision.decision !== "allow-once") return this.deniedAction(request, decision, "upload", context);
    try {
      const currentSource = await this.options.resolveUpload(requestedPath);
      if (currentSource.requestedPath !== source.requestedPath
        || currentSource.absolutePath !== source.absolutePath
        || currentSource.byteSize !== source.byteSize
        || !sameBrowserFileIdentity(currentSource.identity, source.identity)) {
        throw new BrowserError("artifact-violation", "The approved browser upload source changed while approval was pending; the file was not sent.");
      }
      await context.onBrowser?.({ type: "started", request });
      const result = await this.options.manager.upload(sessionId, tabId, {
        kind: "upload",
        reference: { value: ref, documentId: asBrowserDocumentId(snapshot.documentId) },
        sourcePath: source.absolutePath,
        maxBytes: source.byteSize,
      }, context.signal, this.dialogApproval(request, context));
      this.snapshots.delete(tabId);
      const visibleResult = { ...result, tab: safeTab(result.tab, this.options.redactionSecrets ?? []), summary: safeText(result.summary, this.options.redactionSecrets ?? []) };
      const outcome = { ok: true, content: stableStringify(visibleResult), summary: visibleResult.summary } as const;
      await context.onBrowser?.({ type: "completed", request, ok: true, summary: outcome.summary });
      return outcome;
    } catch (error) {
      return this.browserActionFailure(request, error, context);
    }
  }

  private async download(callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = this.activeTabId;
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const ref = stringArgument(args, "ref", true) ?? "";
    const snapshot = this.requireSnapshot(sessionId, tabId);
    const target = await this.options.manager.reserveDownload(sessionId, tabId);
    const requestWithoutHash = {
      actionId: `browser_action_${randomUUID().replaceAll("-", "")}`,
      callId,
      sessionId,
      tabId,
      action: "download" as const,
      reference: ref,
      documentId: asBrowserDocumentId(snapshot.documentId),
      path: target.path,
      maxBytes: target.maxBytes,
      approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
      warning: "This browser download writes a file to the managed artifact directory. The exact destination and byte limit must be approved before it runs.",
    } satisfies Omit<BrowserApprovalRequest, "actionHash">;
    const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
    const decision = await this.obtainApproval(request, context);
    if (decision.decision !== "allow-once") return this.deniedAction(request, decision, "download", context);
    await context.onBrowser?.({ type: "started", request });
    try {
      const artifact = await this.options.manager.download(sessionId, tabId, {
        kind: "download",
        reference: { value: ref, documentId: asBrowserDocumentId(snapshot.documentId) },
        maxBytes: target.maxBytes,
      }, target, context.signal, this.dialogApproval(request, context));
      this.snapshots.delete(tabId);
      await context.onBrowser?.({ type: "artifact", artifact });
      const outcome = { ok: true, content: stableStringify(artifact), summary: `Captured browser download ${artifact.artifactId}.` } as const;
      await context.onBrowser?.({ type: "completed", request, ok: true, summary: outcome.summary });
      return outcome;
    } catch (error) {
      return this.browserActionFailure(request, error, context);
    }
  }

  private requireSnapshot(sessionId: BrowserSessionId, tabId: BrowserTabId): { readonly documentId: string } {
    const snapshot = this.snapshots.get(tabId);
    if (!snapshot || snapshot.sessionId !== sessionId) {
      throw new BrowserError("stale-reference", "Take a browser snapshot before using an element reference.");
    }
    return snapshot;
  }

  private async obtainApproval(request: BrowserApprovalRequest, context: BrowserToolContext): Promise<BrowserApprovalDecision> {
    await context.onBrowser?.({ type: "prepared", request });
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision: BrowserApprovalDecision;
    try {
      decision = context.approveBrowser
        ? await this.awaitApproval(context.approveBrowser, request, context.signal, context.approvalTimeoutMs ?? 120_000)
        : { decision: "unavailable", reason: "No interactive browser approval channel is available; the action was not started." };
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    await context.onBrowser?.({ type: "approval_decided", request, decision });
    return decision;
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
      if (decision.decision !== "allow-once") {
        const errorCode = decision.decision === "deny" ? "browser-approval-denied" as const : "browser-approval-unavailable" as const;
        const reason = decision.reason ? ` ${decision.reason}` : "";
        await context.onBrowser?.({
          type: "completed",
          request,
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
        await context.onBrowser?.({ type: "completed", request, ok: false, summary: reason, errorCode: "browser-approval-unavailable" });
        return { decision: "dismiss" };
      }
      await context.onBrowser?.({ type: "started", request });
      const resolution: BrowserDialogResolution = {
        decision: decision.dialogDecision,
        ...(decision.promptText !== undefined ? { promptText: decision.promptText } : {}),
      };
      await context.onBrowser?.({
        type: "completed",
        request,
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
    await context.onBrowser?.({ type: "completed", request, ok: false, summary, errorCode });
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
    const normalized = normalizeStartedActionError(request.action, browserError.browserCode);
    const underlyingSummary = normalized.underlyingErrorCode ? ` Underlying browser outcome: ${normalized.underlyingErrorCode}.` : "";
    const dialogSummary = dialog ? ` Page dialog (${dialog.type}): ${dialog.message}` : "";
    const outcome = { ok: false, content: `Browser error: ${safeMessage}${underlyingSummary}${dialogSummary}${cancellation}`, summary: `${safeMessage}${underlyingSummary}${dialogSummary}${cancellation}`, errorCode: normalized.errorCode } as const;
    await context.onBrowser?.({ type: "completed", request, ok: false, summary: outcome.summary, errorCode: outcome.errorCode, ...(normalized.underlyingErrorCode ? { underlyingErrorCode: normalized.underlyingErrorCode } : {}), ...(dialog ? { dialog } : {}), ...(browserError.dialogDecision ? { dialogDecision: browserError.dialogDecision } : {}), ...(browserError.cancellationConfirmed !== undefined ? { cancellationConfirmed: browserError.cancellationConfirmed } : {}), ...(diagnostic ? { diagnostic } : {}) });
    return outcome;
  }

  private async approvedAction(action: BrowserActionKind, callId: string, args: ToolArguments, context: BrowserToolContext): Promise<BrowserToolOutcome> {
    const sessionId = this.requireSession();
    const tabId = this.activeTabId;
    if (!tabId) throw new BrowserError("tab-not-found", "No active browser tab exists; open a page first.");
    const ref = stringArgument(args, "ref", true) ?? "";
    const snapshot = this.snapshots.get(tabId);
    if (!snapshot || snapshot.sessionId !== sessionId) {
      throw new BrowserError("stale-reference", "Take a browser snapshot before using an element reference.");
    }
    const text = action === "type" ? stringArgument(args, "text", true) : undefined;
    const key = action === "press" ? stringArgument(args, "key", true) : undefined;
    const requestWithoutHash = {
      actionId: `browser_action_${randomUUID().replaceAll("-", "")}`,
      callId,
      sessionId,
      tabId,
      action,
      reference: ref,
      documentId: asBrowserDocumentId(snapshot.documentId),
      ...(text !== undefined ? { text } : {}),
      ...(key !== undefined ? { key } : {}),
      approvalTimeoutMs: context.approvalTimeoutMs ?? 120_000,
      warning: "This browser interaction may submit data or change remote state. The exact action must be approved before it runs.",
    } satisfies Omit<BrowserApprovalRequest, "actionHash">;
    const request: BrowserApprovalRequest = { ...requestWithoutHash, actionHash: hashAction(requestWithoutHash) };
    await context.onBrowser?.({ type: "prepared", request });
    context.pauseDeadline?.();
    context.pauseTurnDeadline?.();
    let decision: BrowserApprovalDecision;
    try {
      decision = context.approveBrowser
        ? await this.awaitApproval(context.approveBrowser, request, context.signal, context.approvalTimeoutMs ?? 120_000)
        : { decision: "unavailable", reason: "No interactive browser approval channel is available; the action was not started." };
    } finally {
      context.resumeTurnDeadline?.();
      context.resumeDeadline?.();
    }
    await context.onBrowser?.({ type: "approval_decided", request, decision });
    if (decision.decision !== "allow-once") {
      const errorCode = decision.decision === "deny" ? "browser-approval-denied" : "browser-approval-unavailable";
      const reason = decision.reason ? ` ${decision.reason}` : "";
      const outcome = { ok: false, content: `Browser action not started.${reason}`, summary: decision.decision === "deny" ? `Browser ${action} approval denied.` : `Browser ${action} approval unavailable.`, errorCode } as const;
      await context.onBrowser?.({ type: "completed", request, ok: false, summary: outcome.summary, errorCode });
      return outcome;
    }
    await context.onBrowser?.({ type: "started", request });
    const reference: BrowserElementReference = { value: ref, documentId: asBrowserDocumentId(snapshot.documentId) };
    const actionRequest: BrowserActionRequest = { kind: action, reference, ...(text !== undefined ? { text } : {}), ...(key !== undefined ? { key } : {}) };
    try {
      const result = await this.options.manager.act(sessionId, tabId, actionRequest, context.signal, this.dialogApproval(request, context));
      this.snapshots.delete(tabId);
      const visibleResult = { ...result, tab: safeTab(result.tab, this.options.redactionSecrets ?? []), summary: safeText(result.summary, this.options.redactionSecrets ?? []) };
      const outcome = { ok: true, content: stableStringify(visibleResult), summary: visibleResult.summary } as const;
      await context.onBrowser?.({ type: "completed", request, ok: true, summary: outcome.summary });
      return outcome;
    } catch (error) {
      return this.browserActionFailure(request, error, context);
    }
  }

  private async close(signal?: AbortSignal): Promise<BrowserToolOutcome> {
    if (!this.activeSessionId) return { ok: true, content: stableStringify({ status: "already_closed" }), summary: "No browser session was active." };
    const sessionId = this.activeSessionId;
    await this.options.manager.close(sessionId, signal);
    this.activeSessionId = undefined;
    this.activeTabId = undefined;
    this.snapshots.clear();
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
