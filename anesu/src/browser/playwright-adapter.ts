import { createHash, randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { chromium, type BrowserContext, type Dialog, type Locator, type Page } from "playwright";
import { BrowserError } from "./errors.js";
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserAdapter,
  BrowserAdapterStartRequest,
  BrowserDocumentId,
  BrowserDialogObservation,
  BrowserDialogApproval,
  BrowserDialogResolution,
  BrowserSessionId,
  BrowserSnapshot,
  BrowserWaitRequest,
  BrowserWaitResult,
  BrowserScreenshotCapture,
  BrowserTabId,
  BrowserTabInfo,
} from "./contracts.js";
import { readPngDimensions, type BrowserDownloadTarget, type BrowserScreenshotTarget } from "./artifacts.js";
import { asBrowserDocumentId, asBrowserTabId } from "./contracts.js";
import { BrowserUrlPolicy } from "./policy.js";

export interface PlaywrightBrowserAdapterOptions {
  readonly headless?: boolean;
  readonly actionTimeoutMs?: number;
  readonly snapshotMaxChars?: number;
  readonly maxSnapshotReferences?: number;
  readonly urlPolicy?: BrowserUrlPolicy;
}

interface ManagedPage {
  readonly tabId: BrowserTabId;
  readonly page: Page;
  documentId: BrowserDocumentId;
  readonly references: Map<string, ManagedReference>;
}

interface ManagedReference {
  readonly locator: Locator;
  readonly fingerprint: string;
}

interface ManagedSession {
  readonly context: BrowserContext;
  readonly pages: Map<BrowserTabId, ManagedPage>;
  readonly closedTabs: Set<BrowserTabId>;
}

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(",");
const MAX_DIALOG_MESSAGE_CHARS = 2_000;
const BROWSER_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
] as const;

/**
 * Keep browser child processes independent from provider credentials, workspace
 * secrets, and arbitrary parent-process injection settings. The browser only
 * receives ordinary runtime and display variables needed to start Chromium.
 */
export function sanitizedBrowserEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of BROWSER_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function pageTitle(page: Page): Promise<string> {
  return page.title().catch(() => "");
}

function pageDocumentId(): BrowserDocumentId {
  return asBrowserDocumentId(`document_${randomUUID().replaceAll("-", "")}`);
}

function tabId(): BrowserTabId {
  return asBrowserTabId(`tab_${randomUUID().replaceAll("-", "")}`);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "TimeoutError" || /timeout|timed out/iu.test(error.message));
}

function isClosedBrowserError(error: unknown): boolean {
  return error instanceof Error
    && /target page, context or browser has been closed|browser has been closed|page has been closed|context has been closed/iu.test(error.message);
}

function mapPlaywrightError(
  error: unknown,
  fallbackMessage: string,
  signal?: AbortSignal,
): BrowserError {
  if (error instanceof BrowserError) return error;
  if (signal?.aborted) return new BrowserError("browser-cancelled", `${fallbackMessage} The operation was cancelled.`);
  if (isTimeoutError(error)) return new BrowserError("browser-timeout", fallbackMessage, { cause: error });
  if (isClosedBrowserError(error)) return new BrowserError("browser-crash", `${fallbackMessage} The browser process or page is no longer available.`, { cause: error });
  return new BrowserError("adapter-failure", fallbackMessage, { cause: error });
}

function throwIfCancelled(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw new BrowserError("browser-cancelled", message);
}

function referenceFingerprint(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function browserStartFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/executable doesn't exist|browserType\.launch|playwright install/iu.test(detail)) {
    return "Managed Chromium is unavailable. Install it with `pnpm --filter @agent-harness-lab/anesu exec playwright install chromium`.";
  }
  return "The managed Chromium browser could not be started.";
}

/**
 * Playwright adapter for a managed local Chromium session. It owns browser handles and
 * pages, but deliberately exposes only the Anesu browser contracts.
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
  private readonly sessions = new Map<BrowserSessionId, ManagedSession>();
  private readonly headless: boolean;
  private readonly actionTimeoutMs: number;
  private readonly snapshotMaxChars: number;
  private readonly maxSnapshotReferences: number;
  private readonly urlPolicy: BrowserUrlPolicy;

  constructor(options: PlaywrightBrowserAdapterOptions = {}) {
    this.headless = options.headless ?? true;
    this.actionTimeoutMs = options.actionTimeoutMs ?? 10_000;
    this.snapshotMaxChars = options.snapshotMaxChars ?? 16_000;
    this.maxSnapshotReferences = options.maxSnapshotReferences ?? 100;
    this.urlPolicy = options.urlPolicy ?? new BrowserUrlPolicy();
  }

  async startSession(request: BrowserAdapterStartRequest): Promise<void> {
    throwIfCancelled(request.signal, "The browser session start was cancelled before it began.");
    if (this.sessions.has(request.sessionId)) {
      throw new BrowserError("adapter-failure", `Browser session '${request.sessionId}' already exists.`);
    }
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(request.profileDirectory, {
        headless: this.headless,
        env: sanitizedBrowserEnvironment(),
      });
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          await route.continue();
          return;
        }
        try {
          await this.urlPolicy.validate(url);
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      const session: ManagedSession = { context, pages: new Map(), closedTabs: new Set() };
      this.sessions.set(request.sessionId, session);
      context.on("page", (page) => this.registerPage(request.sessionId, session, page));
      for (const page of context.pages()) this.registerPage(request.sessionId, session, page);
    } catch (error) {
      await context?.close().catch(() => undefined);
      throw new BrowserError("adapter-failure", browserStartFailureMessage(error), { cause: error });
    }
  }

  async closeSession(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<void> {
    throwIfCancelled(signal, "The browser session close was cancelled before it began.");
    const session = this.requireSession(sessionId);
    try {
      await session.context.close();
    } catch (error) {
      throw new BrowserError("adapter-failure", "The managed Chromium browser could not be closed.", { cause: error });
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async closeTab(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, signal?: AbortSignal): Promise<void> {
    throwIfCancelled(signal, "The browser tab close was cancelled before it began.");
    const managed = this.requirePage(sessionId, tabIdValue);
    try {
      await managed.page.close({ runBeforeUnload: false });
    } catch (error) {
      throw mapPlaywrightError(error, `Browser tab '${tabIdValue}' could not be closed.`, signal);
    }
  }

  async listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    throwIfCancelled(signal, "The browser tab listing was cancelled before it began.");
    const session = this.requireSession(sessionId);
    const tabs: BrowserTabInfo[] = [];
    for (const page of session.context.pages()) {
      const managed = this.registerPage(sessionId, session, page);
      tabs.push(await this.toTabInfo(sessionId, managed));
    }
    return tabs;
  }

  async open(sessionId: BrowserSessionId, url: string, signal?: AbortSignal): Promise<BrowserTabInfo> {
    throwIfCancelled(signal, "The browser navigation was cancelled before it started.");
    const session = this.requireSession(sessionId);
    const page = await session.context.newPage();
    const managed = this.registerPage(sessionId, session, page);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.actionTimeoutMs });
      return await this.toTabInfo(sessionId, managed);
    } catch (error) {
      await page.close().catch(() => undefined);
      throw mapPlaywrightError(error, `The browser could not open '${url}'.`);
    }
  }

  async snapshot(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, signal?: AbortSignal): Promise<BrowserSnapshot> {
    throwIfCancelled(signal, "The browser snapshot was cancelled before collection.");
    const managed = this.requirePage(sessionId, tabIdValue);
    try {
      managed.references.clear();
      const interactive = managed.page.locator(INTERACTIVE_SELECTOR);
      const count = Math.min(await interactive.count(), this.maxSnapshotReferences);
      const lines: string[] = [];
      const references = [] as { value: string; documentId: BrowserDocumentId }[];
      for (let index = 0; index < count; index += 1) {
        const locator = interactive.nth(index);
        if (!(await locator.isVisible().catch(() => false))) continue;
        const ref = `@e${references.length + 1}`;
        await locator.evaluate((element, value) => element.setAttribute("data-anesu-ref", value), ref).catch(() => undefined);
        const descriptor = await locator.evaluate((element) => {
          const node = element as HTMLElement;
          const role = node.getAttribute("role") ?? node.tagName.toLowerCase();
          const label = node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "";
          const type = node instanceof HTMLInputElement ? node.type : "";
          const outerHTML = node.outerHTML;
          return {
            description: [role, type, label].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim(),
            // Keep page-side identity bounded. Only the digest leaves this
            // boundary, so page text is not persisted as reference metadata.
            fingerprintSource: `${outerHTML.length}:${outerHTML.slice(0, 8_192)}`,
          };
        }).catch(() => ({ description: "interactive element", fingerprintSource: "interactive element" }));
        managed.references.set(ref, { locator, fingerprint: referenceFingerprint(descriptor.fingerprintSource) });
        references.push({ value: ref, documentId: managed.documentId });
        lines.push(`[${ref}] ${descriptor.description}`);
      }
      const bodyText = await managed.page.locator("body").innerText({ timeout: this.actionTimeoutMs }).catch(() => "");
      const content = this.boundSnapshot(`${bodyText.trim()}\n\n${lines.join("\n")}`);
      const tab = await this.toTabInfo(sessionId, managed);
      return {
        ...tab,
        content,
        references,
      };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, "The browser page snapshot could not be collected.");
    }
  }

  async act(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    throwIfCancelled(signal, "The browser action was cancelled before it started.");
    const managed = this.requirePage(sessionId, tabIdValue);
    const reference = request.reference;
    const managedReference = reference ? managed.references.get(reference.value) : undefined;
    if (!reference || !managedReference) {
      throw new BrowserError("stale-reference", "The browser element reference is unavailable; take a new snapshot before acting.");
    }
    try {
      return await this.runCancellableAction(managed, signal, () => this.withDialogGuard(managed.page, async () => {
        const locator = await this.requireFreshReference(managedReference, reference.value);
        if (request.kind === "click") {
          await locator.click({ timeout: this.actionTimeoutMs });
        } else if (request.kind === "type") {
          if (request.text === undefined) throw new BrowserError("invalid-action", "A type action requires text.");
          await locator.fill(request.text, { timeout: this.actionTimeoutMs });
        } else {
          if (!request.key) throw new BrowserError("invalid-action", "A press action requires a key.");
          await locator.press(request.key, { timeout: this.actionTimeoutMs });
        }
        await managed.page.waitForLoadState("domcontentloaded", { timeout: Math.min(this.actionTimeoutMs, 1_000) }).catch(() => undefined);
        const tab = await this.toTabInfo(sessionId, managed);
        return { sessionId, tab, summary: `${request.kind} completed on ${reference.value}.` };
      }, `The browser action '${request.kind}' encountered a page dialog.`, signal, approveDialog));
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, `The browser action '${request.kind}' failed.`);
    }
  }

  async wait(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, request: BrowserWaitRequest, signal?: AbortSignal): Promise<BrowserWaitResult> {
    const managed = this.requirePage(sessionId, tabIdValue);
    if (!Number.isInteger(request.milliseconds) || request.milliseconds < 0) {
      throw new BrowserError("invalid-action", "Browser wait duration must be a non-negative integer.");
    }
    try {
      await waitFor(request.milliseconds, signal);
      const tab = await this.toTabInfo(sessionId, managed);
      return { sessionId, tab, waitedMs: request.milliseconds };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, "The browser wait failed.", signal);
    }
  }

  async screenshot(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, target: BrowserScreenshotTarget, signal?: AbortSignal): Promise<BrowserScreenshotCapture> {
    const managed = this.requirePage(sessionId, tabIdValue);
    if (signal?.aborted) throw new BrowserError("browser-cancelled", "The browser screenshot was cancelled before capture.");
    try {
      await managed.page.screenshot({
        path: target.path,
        type: "png",
        fullPage: false,
        animations: "disabled",
        timeout: this.actionTimeoutMs,
      });
      const size = (await stat(target.path)).size;
      const dimensions = size <= target.maxBytes ? await readPngDimensions(target.path) : undefined;
      if (size > target.maxBytes || !dimensions || dimensions.width > target.maxWidth || dimensions.height > target.maxHeight) {
        await rm(target.path, { force: true });
        throw new BrowserError("artifact-violation", `The browser screenshot exceeded its ${target.maxBytes}-byte, ${target.maxWidth}x${target.maxHeight} pixel, or PNG validity limit.`);
      }
      return { byteSize: size, width: dimensions.width, height: dimensions.height };
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, "The browser screenshot could not be captured.", signal);
    }
  }

  async upload(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    const managed = this.requirePage(sessionId, tabIdValue);
    const managedReference = request.reference ? managed.references.get(request.reference.value) : undefined;
    if (!request.reference || !managedReference) throw new BrowserError("stale-reference", "The browser element reference is unavailable; take a new snapshot before uploading.");
    if (!request.sourcePath) throw new BrowserError("invalid-action", "A browser upload requires a source path.");
    if (signal?.aborted) throw new BrowserError("browser-cancelled", "The browser upload was cancelled before it started.");
    try {
      return await this.runCancellableAction(managed, signal, () => this.withDialogGuard(managed.page, async () => {
        const locator = await this.requireFreshReference(managedReference, request.reference?.value ?? "");
        await locator.setInputFiles(request.sourcePath as string, { timeout: this.actionTimeoutMs });
        const tab = await this.toTabInfo(sessionId, managed);
        return { sessionId, tab, summary: `upload completed on ${request.reference?.value}.` };
      }, "The browser upload encountered a page dialog.", signal, approveDialog));
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, "The browser upload failed.", signal);
    }
  }

  async download(sessionId: BrowserSessionId, tabIdValue: BrowserTabId, request: BrowserActionRequest, target: BrowserDownloadTarget, signal?: AbortSignal, approveDialog?: BrowserDialogApproval) {
    const managed = this.requirePage(sessionId, tabIdValue);
    const managedReference = request.reference ? managed.references.get(request.reference.value) : undefined;
    if (!request.reference || !managedReference) throw new BrowserError("stale-reference", "The browser element reference is unavailable; take a new snapshot before downloading.");
    if (signal?.aborted) throw new BrowserError("browser-cancelled", "The browser download was cancelled before it started.");
    try {
      return await this.runCancellableAction(managed, signal, () => this.withDialogGuard(managed.page, async () => {
        const locator = await this.requireFreshReference(managedReference, request.reference?.value ?? "");
        const [download] = await Promise.all([
          managed.page.waitForEvent("download", { timeout: this.actionTimeoutMs }),
          locator.click({ timeout: this.actionTimeoutMs }),
        ]);
        await download.saveAs(target.path);
        const size = (await stat(target.path)).size;
        if (size > target.maxBytes) {
          await rm(target.path, { force: true });
          throw new BrowserError("artifact-violation", `The browser download exceeded the ${target.maxBytes}-byte limit.`);
        }
        return { byteSize: size, fileName: download.suggestedFilename() };
      }, "The browser download encountered a page dialog.", signal, approveDialog));
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw mapPlaywrightError(error, "The browser download failed.", signal);
    }
  }

  private registerPage(sessionId: BrowserSessionId, session: ManagedSession, page: Page): ManagedPage {
    const existing = [...session.pages.values()].find((candidate) => candidate.page === page);
    if (existing) return existing;
    const managed: ManagedPage = {
      tabId: tabId(),
      page,
      documentId: pageDocumentId(),
      references: new Map(),
    };
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        managed.documentId = pageDocumentId();
        managed.references.clear();
      }
    });
    page.on("close", () => {
      session.pages.delete(managed.tabId);
      session.closedTabs.add(managed.tabId);
    });
    session.pages.set(managed.tabId, managed);
    return managed;
  }

  private async requireFreshReference(reference: ManagedReference, value: string): Promise<Locator> {
    try {
      const current = await reference.locator.evaluate((element) => {
        const outerHTML = (element as HTMLElement).outerHTML;
        return `${outerHTML.length}:${outerHTML.slice(0, 8_192)}`;
      });
      if (referenceFingerprint(current) !== reference.fingerprint) {
        throw new BrowserError("stale-reference", `The browser element reference '${value}' changed after the snapshot; take a new snapshot before acting.`);
      }
      return reference.locator;
    } catch (error) {
      if (error instanceof BrowserError) throw error;
      throw new BrowserError("stale-reference", `The browser element reference '${value}' is no longer stable; take a new snapshot before acting.`, { cause: error });
    }
  }

  private async toTabInfo(sessionId: BrowserSessionId, managed: ManagedPage): Promise<BrowserTabInfo> {
    if (managed.page.isClosed()) {
      const session = this.requireSession(sessionId);
      throw this.closedPageError(session, managed.tabId);
    }
    return {
      sessionId,
      tabId: managed.tabId,
      documentId: managed.documentId,
      url: managed.page.url(),
      title: await pageTitle(managed.page),
    };
  }

  private requireSession(sessionId: BrowserSessionId): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new BrowserError("session-not-found", `Browser session '${sessionId}' was not found by the adapter.`);
    return session;
  }

  private requirePage(sessionId: BrowserSessionId, tabIdValue: BrowserTabId): ManagedPage {
    const session = this.requireSession(sessionId);
    const managed = session.pages.get(tabIdValue);
    if (!managed) {
      if (session.closedTabs.has(tabIdValue)) throw this.closedPageError(session, tabIdValue);
      throw new BrowserError("tab-not-found", `Browser tab '${tabIdValue}' was not found by the adapter.`);
    }
    return managed;
  }

  private closedPageError(session: ManagedSession, tabIdValue: BrowserTabId): BrowserError {
    const browser = session.context.browser();
    if (!browser || !browser.isConnected()) {
      return new BrowserError("browser-crash", `The browser process closed while tab '${tabIdValue}' was active.`);
    }
    return new BrowserError("tab-closed", `Browser tab '${tabIdValue}' is closed.`);
  }

  private boundSnapshot(content: string): string {
    if (content.length <= this.snapshotMaxChars) return content;
    return `${content.slice(0, this.snapshotMaxChars)}\n[... snapshot truncated ...]`;
  }

  private async runCancellableAction<T>(
    managed: ManagedPage,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!signal) return operation();
    if (signal.aborted) throw new BrowserError("browser-cancelled", "The browser action was cancelled before it started.");

    let operationPromise: Promise<T> | undefined;
    let operationFinished = false;
    let cancellationObservedWhileRunning = false;
    let terminationPromise: Promise<boolean> | undefined;
    let rejectCancellation: ((error: BrowserError) => void) | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const beginTermination = (): void => {
      if (!operationPromise || terminationPromise) return;
      terminationPromise = this.terminateAction(managed, operationPromise);
      void terminationPromise.then((confirmed) => {
        rejectCancellation?.(new BrowserError(
          "browser-cancelled",
          confirmed
            ? "The browser action was cancelled and the underlying operation terminated."
            : "The browser action was cancelled but termination could not be confirmed.",
          { cancellationConfirmed: confirmed },
        ));
      });
    };
    const onAbort = (): void => {
      if (operationFinished) return;
      cancellationObservedWhileRunning = true;
      beginTermination();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operationPromise = operation().finally(() => {
      operationFinished = true;
    });
    if (signal.aborted) onAbort();
    try {
      const result = await Promise.race([operationPromise, cancellation]);
      if (cancellationObservedWhileRunning) {
        const confirmed = await terminationPromise;
        throw new BrowserError(
          "browser-cancelled",
          confirmed
            ? "The browser action was cancelled and the underlying operation terminated."
            : "The browser action was cancelled but termination could not be confirmed.",
          { cancellationConfirmed: confirmed },
        );
      }
      return result;
    } catch (error) {
      if (cancellationObservedWhileRunning) {
        const confirmed = await terminationPromise;
        throw new BrowserError(
          "browser-cancelled",
          confirmed
            ? "The browser action was cancelled and the underlying operation terminated."
            : "The browser action was cancelled but termination could not be confirmed.",
          { cancellationConfirmed: confirmed },
        );
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async terminateAction(managed: ManagedPage, operation: Promise<unknown>): Promise<boolean> {
    const closePromise = (async (): Promise<void> => {
      if (!managed.page.isClosed()) await managed.page.close({ runBeforeUnload: false });
    })().catch(() => undefined);
    await settlesWithin(closePromise, this.actionTimeoutMs);
    return settlesWithin(operation, this.actionTimeoutMs);
  }

  private async withDialogGuard<T>(page: Page, operation: () => Promise<T>, message: string, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<T> {
    let dialog: BrowserDialogObservation | undefined;
    let resolution: BrowserDialogResolution | undefined;
    let dismissal: Promise<void> | undefined;
    const onDialog = (observed: Dialog): void => {
      const rawMessage = observed.message();
      dialog = {
        type: observed.type() as BrowserDialogObservation["type"],
        message: rawMessage.length > MAX_DIALOG_MESSAGE_CHARS
          ? `${rawMessage.slice(0, MAX_DIALOG_MESSAGE_CHARS)}\n[dialog message truncated]`
          : rawMessage,
      };
      dismissal = (async () => {
        try {
          resolution = approveDialog
            ? await approveDialog(dialog as BrowserDialogObservation, signal)
            : { decision: "dismiss" as const };
          if (resolution.decision === "accept") await observed.accept(resolution.promptText);
          else await observed.dismiss();
        } catch {
          resolution = { decision: "dismiss" };
          await observed.dismiss().catch(() => undefined);
        }
      })();
    };
    page.on("dialog", onDialog);
    try {
      const result = await operation();
      await dismissal;
      if (dialog) throw new BrowserError("browser-ambiguous", message, { dialog, dialogDecision: resolution?.decision });
      return result;
    } catch (error) {
      await dismissal;
      if (dialog) throw new BrowserError("browser-ambiguous", message, { cause: error, dialog, dialogDecision: resolution?.decision });
      throw error;
    } finally {
      page.off("dialog", onDialog);
    }
  }
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new BrowserError("browser-cancelled", "The browser wait was cancelled.");
  if (milliseconds === 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      finish(new BrowserError("browser-cancelled", "The browser wait was cancelled."));
    };
    const timer = setTimeout(() => finish(), milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
