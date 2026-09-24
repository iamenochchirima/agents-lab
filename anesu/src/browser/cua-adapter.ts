import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { stableStringify } from "../persistence/json.js";
import type { EndSessionOutput, ListWindowsOutput } from "@trycua/cua-driver";
import { BrowserError } from "./errors.js";
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserAdapter,
  BrowserAdapterStartRequest,
  BrowserDialogApproval,
  BrowserSessionId,
  BrowserSnapshot,
  BrowserSnapshotRequest,
  BrowserTabId,
  BrowserTabInfo,
  BrowserWaitRequest,
  BrowserWaitResult,
  BrowserScreenshotCapture,
  BrowserInputRoute,
  BrowserProfileMode,
} from "./contracts.js";
import type { BrowserDownloadTarget, BrowserScreenshotTarget } from "./artifacts.js";
import { asBrowserDocumentId, asBrowserTabId } from "./contracts.js";
import { BrowserUrlPolicy } from "./policy.js";
import {
  CuaBrowserGateway,
  type BrowserActionOutput,
  type BrowserDialogOutput,
  type BrowserNavigateOutput,
  type BrowserSetInputFilesOutput,
  type BrowserSnapshotOutput,
  type CuaBrowserDriver,
} from "./cua-browser-gateway.js";
import type { ComputerRuntimeEvidence } from "../computer/contracts.js";
import { cuaLinuxHealthProblem } from "../computer/cua-health.js";
import { addCuaRuntimeIdentity, readCuaRuntimeIdentity } from "../computer/cua-runtime-evidence.js";
import { createCuaAuthorizationHost, type CuaAuthorizationCallback } from "./cua-authorization.js";
import { createCuaBrowserTaskManifest } from "./cua-manifest.js";

type CuaRuntimeDriver = CuaBrowserDriver & {
  listToolsJson?: () => string | Promise<string>;
  metadata?: (options?: unknown) => Promise<unknown>;
  startSession(input: unknown, options?: { readonly signal: AbortSignal }): Promise<unknown>;
  listWindows(input: unknown, options?: { readonly signal: AbortSignal }): Promise<ListWindowsOutput>;
  shutdown(options?: { readonly signal: AbortSignal }): Promise<void>;
};

type CuaSdk = typeof import("@trycua/cua-driver");

interface ManagedTab {
  readonly tab: BrowserTabInfo;
  readonly targetId: string;
}

interface ManagedSession {
  readonly gateway: CuaBrowserGateway;
  readonly driver: CuaRuntimeDriver;
  readonly closeTrustedSession?: () => void;
  readonly taskManifestPath?: string;
  readonly allowedOrigins?: ReadonlySet<string>;
  readonly profileMode: BrowserProfileMode;
  readonly pid: number;
  readonly windowId: bigint;
  targetId: string;
  activeTabId: BrowserTabId;
  generation: number;
  readonly tabs: Map<BrowserTabId, ManagedTab>;
  readonly stagedUploadPaths: Set<string>;
  readonly stagingDirectory?: string;
  continuation?: {
    readonly token: string;
    readonly targetId: string;
    readonly tabId: BrowserTabId;
  };
}

export interface CuaBrowserAdapterOptions {
  readonly manifestPath?: string;
  /** Must mirror the exact origins declared by the immutable Cua manifest. */
  readonly allowedOrigins?: readonly string[];
  readonly urlPolicy?: BrowserUrlPolicy;
  readonly maxSnapshotChars?: number;
  /** Host-selected route; Linux X11 commonly needs dom_event for background input. */
  readonly inputRoute?: BrowserInputRoute;
  /** Private application-owned root granted to Cua for upload staging copies. */
  readonly uploadStagingRoot?: string;
  readonly createDriver?: () => Promise<CuaRuntimeDriver>;
  /** Test seam. The production owner remains application-lifetime scoped. */
  readonly driver?: CuaRuntimeDriver;
  readonly loadSdk?: () => Promise<CuaSdk>;
}

/**
 * Cua's native window record is the attestation boundary for the prepared
 * browser product. Keep the accepted product set aligned with the checked-in
 * browser manifest; an executable-name heuristic would allow an unsupported
 * Chromium embedding or WebView to enter the typed browser path.
 */
function supportedBrowserProduct(appName: string): "chrome" | "edge" | undefined {
  const normalized = appName.trim().toLocaleLowerCase();
  if (normalized === "google chrome" || normalized === "google-chrome" || normalized === "chrome") return "chrome";
  if (normalized === "microsoft edge" || normalized === "microsoft-edge" || normalized === "edge") return "edge";
  return undefined;
}
const DEFAULT_MAX_SNAPSHOT_CHARS = 16_000;
const DEFAULT_MAX_STAGED_UPLOAD_BYTES = 4 * 1024 * 1024;
const SUPPORTED_BROWSER_KEYS = new Set(["Enter", "Tab", "Escape", "Space", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const REQUIRED_BROWSER_TOOLS = [
  "browser_prepare",
  "get_browser_state",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_pointer",
  "browser_dialog",
  "browser_set_input_files",
] as const;

const REQUIRED_BROWSER_SCHEMA_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  browser_prepare: ["allow_launch", "profile", "session"],
  get_browser_state: ["continuation", "query", "scope_ref", "session", "snapshot_format"],
  browser_navigate: ["session", "tab_id", "target_id", "url"],
  browser_click: ["input_route", "ref", "session", "tab_id", "target_id"],
  // Cua 0.28.2 deliberately does not expose input_route on browser_type.
  // Typing therefore uses the typed browser tool's own trusted delivery
  // contract; a task explicitly configured for synthetic DOM delivery must
  // stop rather than silently changing route.
  browser_type: ["mode", "ref", "replace", "session", "tab_id", "target_id", "text"],
  browser_pointer: ["action", "destination_ref", "input_route", "ref", "session", "tab_id", "target_id"],
  browser_dialog: ["action", "dialog_id", "prompt_text", "session", "tab_id", "target_id"],
  browser_set_input_files: ["files", "ref", "session", "tab_id", "target_id"],
};

const REQUIRED_BROWSER_SCHEMA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  browser_navigate: ["target_id", "tab_id", "url"],
  browser_click: ["target_id", "tab_id"],
  browser_type: ["target_id", "tab_id", "ref", "text"],
  browser_pointer: ["target_id", "tab_id", "action"],
  browser_dialog: ["target_id", "tab_id", "action"],
  browser_set_input_files: ["target_id", "tab_id", "ref", "files"],
};

const READ_ONLY_BROWSER_TOOLS = new Set(["get_browser_state"]);

export const DEFAULT_CUA_BROWSER_ORIGINS = [
  "https://example.com",
  "http://127.0.0.1",
  "http://127.0.0.1:4173",
  "http://localhost",
  "http://localhost:4173",
  "http://anesu.test",
] as const;

function signalOptions(signal?: AbortSignal): { readonly signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined;
}

function textValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function gatewayValue<T = Record<string, unknown>>(response: unknown, operation: string): T {
  const record = objectValue(response);
  if (!record) throw new BrowserError("adapter-failure", `Cua ${operation} returned an invalid response.`);
  if (record.kind === "ok") {
    const value = objectValue(record.value);
    if (!value) throw new BrowserError("adapter-failure", `Cua ${operation} returned an invalid success response.`);
    return value as T;
  }
  if (record.kind === "refused") {
    const refusal = objectValue(record.refusal);
    const code = textValue(refusal?.code, 128) ?? "cua_refused";
    const message = textValue(refusal?.message, 1_000) ?? `Cua refused ${operation}.`;
    const browserCode = code.includes("stale")
      ? "stale-reference"
      : code.includes("origin") || code.includes("scope")
        ? "navigation-policy"
        : code.includes("input_trust")
          ? "browser-input-trust-unavailable"
          : code === "browser_action_refused"
            ? "browser-action-refused"
          : "adapter-failure";
    throw new BrowserError(browserCode, `${message} (${code}).`, { cuaCode: code });
  }
  throw new BrowserError("adapter-failure", `Cua ${operation} returned an unknown response shape.`);
}

function assertBoundResponse(
  response: { readonly targetId: string; readonly tabId: string },
  expectedTargetId: string,
  expectedTabId: BrowserTabId,
  operation: string,
): void {
  if (response.targetId !== expectedTargetId || response.tabId !== String(expectedTabId)) {
    throw new BrowserError(
      "adapter-failure",
      `Cua ${operation} returned a target or tab identity different from the authorized binding.`,
    );
  }
}

function actionMetadata(output: BrowserActionOutput): Pick<BrowserActionResult, "effect" | "route" | "delivery" | "escalation"> {
  return {
    ...(output.effect === undefined ? {} : { effect: output.effect }),
    ...(output.route === undefined ? {} : { route: output.route }),
    ...(output.delivery === undefined ? {} : { delivery: output.delivery }),
    ...(output.escalation === undefined ? {} : { escalation: output.escalation }),
  };
}

function exactBrowserWindow(output: ListWindowsOutput, pid?: number): { readonly pid: number; readonly windowId: bigint } {
  const candidates = output.windows.filter((window) =>
    typeof window.pid === "number"
      && (pid === undefined || window.pid === pid)
      && window.isOnScreen
      && window.minimized !== true
      && window.bounds.width > 0
      && window.bounds.height > 0
    && supportedBrowserProduct(window.appName) !== undefined,
  );
  if (candidates.length !== 1 || !candidates[0]) {
    throw new BrowserError("browser-ambiguous", pid === undefined
      ? "Cua did not expose exactly one usable existing Chrome or Edge window."
      : `Cua did not expose exactly one usable Chrome or Edge window for prepared PID ${pid}.`);
  }
  const candidate = candidates[0];
  if (typeof candidate.pid !== "number") throw new BrowserError("browser-ambiguous", "Cua did not expose a usable browser PID.");
  return { pid: candidate.pid, windowId: candidate.windowId };
}

function semanticRole(value: string): string {
  const role = value.trim().toLocaleLowerCase();
  return role === "input" ? "textbox" : role;
}

/**
 * Cua's semantic refs may omit the current textbox value even though the same
 * snapshot's accessibility outline includes it. Recover it only for one
 * uniquely named typed ref. Duplicate labels stay unknown rather than being
 * assigned a value from a neighbouring control.
 */
function outlineCurrentValue(outline: string, rawRefs: readonly unknown[], role: string | undefined, name: string | undefined): string | undefined {
  if (!role || !name || !outline) return undefined;
  const normalizedRole = semanticRole(role);
  const matchingRefs = rawRefs.filter((raw) => {
    const ref = objectValue(raw);
    const refRole = textValue(ref?.role ?? ref?.node, 64);
    const refName = textValue(ref?.name ?? ref?.label, 512);
    return refRole !== undefined && refName === name && semanticRole(refRole) === normalizedRole;
  });
  if (matchingRefs.length !== 1) return undefined;
  const prefix = `- ${normalizedRole} ${JSON.stringify(name)}`;
  const lines = outline.split(/\r?\n/u).map((line) => line.trimStart()).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) return undefined;
  const match = lines[0]?.slice(prefix.length).match(/^\s*:\s*(?<value>.*?)\s+\[[^\]]*\]\s*$/u);
  return match?.groups?.value?.trim();
}

function activeTab(
  value: Record<string, unknown>,
  options: { readonly allowUnidentifiedSingleton: boolean },
): { readonly tabId: BrowserTabId; readonly title: string; readonly url: string } {
  const tabs = Array.isArray(value.tabs) ? value.tabs : [];
  const active = tabs.filter((tab) => objectValue(tab)?.active === true);
  const selected = active.length === 1
    ? active[0]
    : active.length === 0 && options.allowUnidentifiedSingleton && tabs.length === 1
      ? tabs[0]
      : undefined;
  if (!selected) {
    throw new BrowserError("browser-ambiguous", "Cua did not expose exactly one active browser tab for the exact binding.");
  }
  const record = objectValue(selected);
  const tabId = textValue(record?.tabId ?? record?.tab_id, 256);
  if (!tabId) throw new BrowserError("adapter-failure", "Cua binding did not return an opaque tab id.");
  return {
    tabId: asBrowserTabId(tabId),
    title: textValue(record?.title, 512) ?? "",
    url: textValue(record?.url, 4_096) ?? "about:blank",
  };
}

function bounded(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 28))}\n[cua snapshot truncated]`;
}

function isActionVisible(raw: Record<string, unknown>): boolean {
  return textValue(raw.visibility, 64) === "in_viewport";
}

function semanticSnapshot(value: Record<string, unknown> | BrowserSnapshotOutput, sessionId: BrowserSessionId, targetId: string, tabId: BrowserTabId, maxSnapshotChars: number): BrowserSnapshot {
  const documentId = textValue(value.snapshotId, 256);
  const url = textValue(value.url, 4_096);
  const reportedTitle = textValue(value.title, 512);
  if (!documentId || !url || reportedTitle === undefined) throw new BrowserError("adapter-failure", "Cua semantic_v2 state did not contain bounded page identity.");
  // Cua 0.28.2 can retain the isolated browser's initial tab title after a
  // successful navigation. Do not project that stale placeholder as a fact
  // about the observed page; semantic headings/content remain independent.
  const title = url !== "about:blank" && reportedTitle.trim().toLocaleLowerCase() === "about:blank"
    ? ""
    : reportedTitle;
  const outline = textValue(value.outline, 100_000) ?? "";
  const rawRefs = Array.isArray(value.refs) ? value.refs : [];
  const references = rawRefs.flatMap((raw): Array<{
    readonly value: string;
    readonly documentId: ReturnType<typeof asBrowserDocumentId>;
    readonly actions?: readonly string[];
    readonly currentValue?: string;
    readonly role?: string;
    readonly name?: string;
    readonly type?: string;
    readonly destinationRef?: string;
    readonly states?: Readonly<Partial<Record<"checked" | "selected" | "expanded" | "disabled" | "required", boolean>>>;
  }> => {
    const ref = objectValue(raw);
    const valueRef = textValue(ref?.ref, 256);
    if (!valueRef) return [];
    const actions = Array.isArray(ref?.actions)
      ? ref.actions.filter((action): action is string => typeof action === "string" && action.length > 0 && action.length <= 64).slice(0, 16)
      : undefined;
    const role = textValue(ref?.role, 64);
    const name = textValue(ref?.name, 512) ?? textValue(ref?.label, 512);
    const type = textValue(ref?.type, 64);
    const currentValue = textValue(ref?.value, 4_096)
      ?? (actions?.some((action) => action.trim().toLocaleLowerCase() === "type") === true
        ? outlineCurrentValue(outline, rawRefs, role, name)
        : undefined);
    const destinationRef = textValue(ref?.destinationRef ?? ref?.destination_ref, 256);
    return [{
      value: valueRef,
      documentId: asBrowserDocumentId(documentId),
      ...(actions !== undefined ? { actions } : {}),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
      ...(currentValue !== undefined ? { currentValue } : {}),
      ...(ref?.states && typeof ref.states === "object" && !Array.isArray(ref.states)
        ? { states: ref.states as Readonly<Partial<Record<"checked" | "selected" | "expanded" | "disabled" | "required", boolean>>> }
        : {}),
      ...(destinationRef ? { destinationRef } : {}),
    }];
  });
  const contentRefs = Array.isArray(value.contentRefs) ? value.contentRefs : [];
  const headings = contentRefs.flatMap((raw): string[] => {
    const ref = objectValue(raw);
    if (!ref || !isActionVisible(ref) || textValue(ref.role, 64)?.toLocaleLowerCase() !== "heading") return [];
    const name = textValue(ref.name, 512) ?? textValue(ref.label, 512);
    return name ? [name] : [];
  }).slice(0, 64);
  const lines = rawRefs.flatMap((raw): string[] => {
    const ref = objectValue(raw);
    if (!ref || !isActionVisible(ref)) return [];
    const refValue = textValue(ref?.ref, 256);
    const role = textValue(ref?.role, 64) ?? textValue(ref?.node, 64) ?? "element";
    const name = textValue(ref?.name, 512) ?? textValue(ref?.label, 512) ?? "";
    const actions = Array.isArray(ref?.actions)
      ? ref.actions.filter((action): action is string => typeof action === "string" && action.length <= 64)
      : [];
    if (!refValue || !name) return [];
    if (actions.includes("upload") && (role === "input" || role === "textbox")) {
      return [`[${refValue}] input file ${name}`];
    }
    if (actions.includes("type") && (role === "textbox" || role === "input" || role === "textarea")) {
      return [`[${refValue}] input text ${name}`];
    }
    if (actions.includes("click") && ["button", "a", "link", "checkbox", "radio", "input"].includes(role)) {
      return [`[${refValue}] ${role === "a" ? "link" : role} ${name}`];
    }
    return [];
  });
  const readableContent = contentRefs.flatMap((raw): string[] => {
    const ref = objectValue(raw);
    if (!ref || !isActionVisible(ref)) return [];
    const contentRole = textValue(ref?.role, 64) ?? "content";
    const contentName = textValue(ref?.name, 512) ?? textValue(ref?.value, 512);
    return contentName ? [`${contentRole} ${contentName}`] : [];
  });
  const rawOmissions = objectValue(value.omissions);
  const omissions = rawOmissions
    ? Object.fromEntries(Object.entries(rawOmissions).flatMap(([key, omission]) => typeof omission === "number" && Number.isSafeInteger(omission) && omission >= 0 ? [[key, omission]] : []))
    : undefined;
  const oopif = objectValue(value.oopif);
  const complete = typeof value.complete === "boolean" ? value.complete : undefined;
  const scope = textValue(value.scope, 4_096);
  const continuation = textValue(value.continuation, 4_096);
  return {
    sessionId,
    tabId,
    documentId: asBrowserDocumentId(documentId),
    url,
    title,
    content: bounded(`${outline}${outline && (lines.length > 0 || readableContent.length > 0) ? "\n\n" : ""}${[...readableContent, ...lines].join("\n")}`, maxSnapshotChars),
    references,
    ...(headings.length > 0 ? { headings } : {}),
    ...(complete === undefined ? {} : { complete }),
    ...(scope === undefined ? {} : { scope }),
    ...(continuation === undefined ? {} : { continuation }),
    ...(omissions === undefined ? {} : { omissions }),
    ...(oopif && typeof oopif.status === "string" && typeof oopif.frames === "number" && Number.isSafeInteger(oopif.frames) && oopif.frames >= 0
      ? { oopif: { status: bounded(oopif.status, 128), frames: oopif.frames } }
      : {}),
  };
}

function driverOptions(signal?: AbortSignal): { readonly signal: AbortSignal } | undefined {
  return signalOptions(signal);
}

async function assertBrowserCapabilities(driver: CuaRuntimeDriver): Promise<ComputerRuntimeEvidence | undefined> {
  if (!driver.listToolsJson) {
    throw new BrowserError("adapter-failure", "Cua browser capability discovery is unavailable; refusing to run without the installed tool contract.");
  }
  let raw: string;
  try {
    raw = await driver.listToolsJson();
  } catch (error) {
    throw new BrowserError("adapter-failure", "Cua browser capability discovery failed.", { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BrowserError("adapter-failure", "Cua browser capability discovery returned malformed JSON.", { cause: error });
  }
  const record = objectValue(parsed);
  if (record?.schema_version !== "1") {
    throw new BrowserError("adapter-failure", "Cua browser capability discovery returned an unsupported schema version.");
  }
  const capabilityVersion = textValue(record?.capability_version, 64);
  const tools = Array.isArray(record?.tools) ? record.tools : [];
  const records = new Map<string, Record<string, unknown>>();
  for (const tool of tools) {
    const value = objectValue(tool);
    const name = textValue(value?.name, 128);
    if (name && !records.has(name)) records.set(name, value!);
  }
  const names = new Set(records.keys());
  const missing = REQUIRED_BROWSER_TOOLS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new BrowserError("adapter-failure", `Cua browser runtime is missing required operations: ${missing.join(", ")}.`);
  }
  for (const name of REQUIRED_BROWSER_TOOLS) {
    const schema = objectValue(records.get(name)?.inputSchema);
    const properties = objectValue(schema?.properties);
    if (schema?.type !== "object" || !properties) {
      throw new BrowserError("adapter-failure", `Cua browser operation '${name}' did not expose a bounded object input schema.`);
    }
    const schemaBytes = Buffer.byteLength(stableStringify(schema), "utf8");
    if (schemaBytes > 64 * 1024) throw new BrowserError("adapter-failure", `Cua browser operation '${name}' exposed an oversized input schema.`);
    const missingProperties = (REQUIRED_BROWSER_SCHEMA_PROPERTIES[name] ?? []).filter((property) => !(property in properties));
    if (missingProperties.length > 0) throw new BrowserError("adapter-failure", `Cua browser operation '${name}' is missing schema properties: ${missingProperties.join(", ")}.`);
    const requiredFields = schema.required;
    if (requiredFields !== undefined && (!Array.isArray(requiredFields) || requiredFields.some((field) => typeof field !== "string" || !(field in properties)))) {
      throw new BrowserError("adapter-failure", `Cua browser operation '${name}' exposed an invalid required-field declaration.`);
    }
    const expectedRequired = REQUIRED_BROWSER_SCHEMA_FIELDS[name] ?? [];
    if (expectedRequired.length > 0 && Array.isArray(requiredFields)) {
      const declared = new Set(requiredFields.filter((field): field is string => typeof field === "string"));
      const missingRequired = expectedRequired.filter((field) => !declared.has(field));
      if (missingRequired.length > 0) throw new BrowserError("adapter-failure", `Cua browser operation '${name}' does not require fields: ${missingRequired.join(", ")}.`);
    }
    const annotations = records.get(name)?.annotations;
    if (annotations !== undefined) {
      if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) throw new BrowserError("adapter-failure", `Cua browser operation '${name}' exposed invalid annotations.`);
      const readOnlyHint = (annotations as Record<string, unknown>).readOnlyHint;
      if (readOnlyHint !== undefined && readOnlyHint !== READ_ONLY_BROWSER_TOOLS.has(name)) {
        throw new BrowserError("adapter-failure", `Cua browser operation '${name}' exposed an unsafe readOnlyHint annotation.`);
      }
      const idempotentHint = (annotations as Record<string, unknown>).idempotentHint;
      if (idempotentHint !== undefined && typeof idempotentHint !== "boolean") throw new BrowserError("adapter-failure", `Cua browser operation '${name}' exposed an invalid idempotentHint annotation.`);
    }
  }
  const fingerprint = createHash("sha256").update(stableStringify(REQUIRED_BROWSER_TOOLS.map((name) => ({ name, inputSchema: records.get(name)?.inputSchema }))), "utf8").digest("hex");
  const evidence: ComputerRuntimeEvidence = {
    provider: "cua",
    schemaVersion: "1",
    ...(capabilityVersion ? { capabilityVersion } : {}),
    capabilityFingerprint: fingerprint,
    requiredOperations: [...REQUIRED_BROWSER_TOOLS],
  };
  return addCuaRuntimeIdentity(evidence, await readCuaRuntimeIdentity(driver));
}

function assertBrowserAdapterMethods(driver: CuaRuntimeDriver): void {
  const missing = [
    "callTool",
    "startSession",
    "listWindows",
    "endSession",
    "shutdown",
  ].filter((method) => typeof (driver as unknown as Record<string, unknown>)[method] !== "function");
  if (missing.length > 0) {
    throw new BrowserError(
      "adapter-failure",
      `Cua browser runtime is missing callable adapter methods: ${missing.join(", ")}.`,
    );
  }
}

async function assertBrowserHealth(driver: CuaRuntimeDriver): Promise<void> {
  if (!driver.listToolsJson) {
    throw new BrowserError("adapter-failure", "Cua browser health cannot be proven without capability discovery.");
  }
  const result = await driver.callTool("health_report", "{}");
  const record = objectValue(result);
  if (record?.isError === true) throw new BrowserError("adapter-failure", "Cua browser health checks failed.");
  const raw = textValue(record?.structuredJson, 16_384);
  if (!raw) throw new BrowserError("adapter-failure", "Cua browser health checks returned no structured report.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BrowserError("adapter-failure", "Cua browser health checks returned malformed JSON.", { cause: error });
  }
  const problem = cuaLinuxHealthProblem(parsed);
  if (problem) throw new BrowserError("adapter-failure", `Cua browser health checks did not pass: ${problem}.`);
}

/**
 * Browser execution owned by Cua. The adapter translates the existing Anesu
 * tool seam to Cua's typed browser calls, but it never creates a page, locator,
 * browser process, CDP endpoint, or Anesu-side selector.
 */
export class CuaBrowserAdapter implements BrowserAdapter {
  readonly ownsProfileLifecycle = true;
  private readonly sessions = new Map<BrowserSessionId, ManagedSession>();
  private readonly urlPolicy: BrowserUrlPolicy;
  private readonly maxSnapshotChars: number;
  private readonly inputRoute: BrowserInputRoute;
  private readonly options: CuaBrowserAdapterOptions;
  private driver: CuaRuntimeDriver | undefined;
  private sdk: CuaSdk | undefined;
  private preflighted = false;
  private capabilityEvidence: ComputerRuntimeEvidence | undefined;
  private readonly pendingExistingProfileAuthorizations = new Map<BrowserSessionId, CuaAuthorizationCallback>();

  constructor(options: CuaBrowserAdapterOptions = {}) {
    this.options = options;
    this.urlPolicy = options.urlPolicy ?? new BrowserUrlPolicy();
    this.maxSnapshotChars = options.maxSnapshotChars ?? DEFAULT_MAX_SNAPSHOT_CHARS;
    this.inputRoute = options.inputRoute ?? "trusted";
    this.driver = options.driver;
  }

  /** Prove the immutable browser tool inventory and host health before approval. */
  async preflight(): Promise<void> {
    if (this.preflighted) return;
    const driver = await this.requireDriver();
    assertBrowserAdapterMethods(driver);
    this.capabilityEvidence = await assertBrowserCapabilities(driver);
    await assertBrowserHealth(driver);
    this.preflighted = true;
  }

  runtimeEvidence(): ComputerRuntimeEvidence | undefined {
    return this.capabilityEvidence;
  }

  async startSession(request: BrowserAdapterStartRequest): Promise<void> {
    if (this.sessions.has(request.sessionId)) throw new BrowserError("adapter-failure", `Browser session '${request.sessionId}' already exists.`);
    const profileMode: BrowserProfileMode = request.profileMode ?? "isolated_new";
    if (profileMode === "existing_profile" && !request.authorizeExistingProfile) {
      throw new BrowserError("browser-task-unauthorized", "Existing browser-profile attachment requires a separate trusted authorization decision.");
    }
    const driver = await this.requireDriver();
    let taskDriver = driver;
    let closeTrustedSession: (() => void) | undefined;
    let taskManifestPath: string | undefined;
    let sessionStartAttempted = false;
    const admittedOrigins = request.allowedOrigins ?? this.options.allowedOrigins;
    try {
      await this.preflight();
      if (profileMode === "existing_profile") this.pendingExistingProfileAuthorizations.set(request.sessionId, request.authorizeExistingProfile!);
      if (admittedOrigins && this.sdk?.createTrustedSession && this.sdk.TrustedSessionOptions) {
        const normalizedOrigins = [...new Set(admittedOrigins)].sort();
        for (const origin of normalizedOrigins) await this.urlPolicy.validate(`${origin}/`);
        const manifestRoot = path.dirname(this.options.manifestPath ?? `${process.cwd()}/config/cua-browser-capabilities.yaml`);
        const manifestName = createHash("sha256").update(request.sessionId, "utf8").digest("hex").slice(0, 32);
        taskManifestPath = await createCuaBrowserTaskManifest({
          basePath: this.options.manifestPath ?? `${process.cwd()}/config/cua-browser-capabilities.yaml`,
          outputPath: path.join(manifestRoot, `browser-task-${manifestName}.yaml`),
          allowedOrigins: normalizedOrigins,
        });
        const trusted = this.sdk.createTrustedSession(
          driver as unknown as Parameters<CuaSdk["createTrustedSession"]>[0],
          this.sdk.TrustedSessionOptions.new({
            publicSession: request.sessionId,
            mode: this.sdk.SessionPermissionMode.Bounded,
            ttlSeconds: 30n * 60n,
            idleTtlSeconds: 30n * 60n,
            capabilityManifestPath: taskManifestPath,
          }),
        );
        taskDriver = trusted as unknown as CuaRuntimeDriver;
        closeTrustedSession = () => trusted.close();
      } else if (admittedOrigins && !this.options.driver && !this.options.createDriver) {
        throw new BrowserError("adapter-failure", "The pinned Cua SDK cannot bind the task's browser origin permissions.");
      }
      sessionStartAttempted = true;
      await taskDriver.startSession(this.sdk?.StartSessionInput.new({ session: request.sessionId }) ?? { session: request.sessionId }, driverOptions(request.signal));
      const gateway = new CuaBrowserGateway({
        callTool: taskDriver.callTool.bind(taskDriver),
        endSession: (input: { readonly session?: string }) => taskDriver.endSession(this.sdk?.EndSessionInput.new(input) ?? input, driverOptions(request.signal)) as Promise<EndSessionOutput>,
      }, request.sessionId);
      let pid: number;
      let windowId: bigint;
      if (profileMode === "existing_profile") {
        // Existing-profile attachment must bind one already-visible, product-attested
        // Chrome/Edge window before Cua receives the attach request. It never launches
        // a browser and never chooses the first process returned by the host.
        const windows = await taskDriver.listWindows(this.sdk?.ListWindowsInput.new({ onScreenOnly: true }) ?? { onScreenOnly: true }, driverOptions(request.signal));
        const selected = exactBrowserWindow(windows);
        pid = selected.pid;
        windowId = selected.windowId;
        const prepared = gatewayValue(await gateway.prepare({ pid, windowId, strategy: { kind: "existing_profile" } }, request.signal), "browser_prepare");
        if (prepared.preparedPid !== undefined && prepared.preparedPid !== pid) {
          throw new BrowserError("browser-ambiguous", "Cua attached a different browser PID than the exact existing window selected by Anesu.");
        }
        if (prepared.attachment !== undefined && prepared.attachment !== "existing_profile") {
          throw new BrowserError("browser-ambiguous", "Cua did not confirm an existing-profile browser attachment.");
        }
      } else {
        const prepared = gatewayValue(await gateway.prepare({ allowLaunch: true, profile: { mode: "isolated_new" } }, request.signal), "browser_prepare");
        if (typeof prepared.preparedPid !== "number" || !Number.isSafeInteger(prepared.preparedPid) || prepared.preparedPid <= 0) throw new BrowserError("adapter-failure", "Cua browser_prepare did not return a usable prepared PID.");
        pid = prepared.preparedPid;
        const windows = await taskDriver.listWindows(this.sdk?.ListWindowsInput.new({ pid, onScreenOnly: true }) ?? { pid, onScreenOnly: true }, driverOptions(request.signal));
        windowId = exactBrowserWindow(windows, pid).windowId;
      }
      const bound = gatewayValue(await gateway.getBrowserState({ mode: "bind", pid, windowId }, request.signal), "get_browser_state");
      const bindingQuality = bound.bindingQuality;
      if (bindingQuality !== "exact" || bound.mutationAllowed !== true) throw new BrowserError("browser-ambiguous", "Cua did not establish an exact mutable browser binding.");
      const targetId = textValue(bound.targetId, 256);
      if (!targetId) throw new BrowserError("adapter-failure", "Cua browser binding did not return an opaque target id.");
      const selected = activeTab(bound, { allowUnidentifiedSingleton: profileMode === "isolated_new" });
      const tabs = Array.isArray(bound.tabs) ? bound.tabs : [];
      const managedTabs = new Map<BrowserTabId, ManagedTab>();
      for (const raw of tabs) {
        const tabId = textValue(raw.tabId ?? raw.tab_id, 256);
        const url = textValue(raw.url, 4_096);
        const title = textValue(raw.title, 512);
        if (!tabId || !url || title === undefined) throw new BrowserError("adapter-failure", "Cua browser binding returned an invalid tab identity.");
        const typedTabId = asBrowserTabId(tabId);
        if (managedTabs.has(typedTabId)) throw new BrowserError("browser-ambiguous", "Cua browser binding returned duplicate tab identities.");
        const tab: BrowserTabInfo = {
          sessionId: request.sessionId,
          tabId: typedTabId,
          documentId: asBrowserDocumentId(`bind:${request.sessionId}:${tabId}`),
          url,
          title,
          active: typedTabId === selected.tabId,
        };
        managedTabs.set(typedTabId, { tab, targetId });
      }
      if (!managedTabs.has(selected.tabId)) throw new BrowserError("adapter-failure", "Cua active tab was not present in its bound tab list.");
      const stagingDirectory = this.options.uploadStagingRoot
        ? path.join(path.resolve(this.options.uploadStagingRoot), createHash("sha256").update(request.sessionId, "utf8").digest("hex").slice(0, 32))
        : undefined;
      this.sessions.set(request.sessionId, {
        gateway,
        driver: taskDriver,
        ...(closeTrustedSession ? { closeTrustedSession } : {}),
        ...(taskManifestPath ? { taskManifestPath } : {}),
        ...(admittedOrigins ? { allowedOrigins: new Set(admittedOrigins.map((origin) => new URL(origin).origin)) } : {}),
        profileMode,
        pid,
        windowId,
        targetId,
        activeTabId: selected.tabId,
        generation: 0,
        tabs: managedTabs,
        stagedUploadPaths: new Set(),
        ...(stagingDirectory ? { stagingDirectory } : {}),
      });
      this.pendingExistingProfileAuthorizations.delete(request.sessionId);
    } catch (error) {
      this.pendingExistingProfileAuthorizations.delete(request.sessionId);
      const setupError = error instanceof BrowserError
        ? error
        : new BrowserError("adapter-failure", "Cua could not prepare and bind the isolated browser.", { cause: error });
      if (sessionStartAttempted) {
        try {
          const ended = await taskDriver.endSession(this.sdk?.EndSessionInput.new({ session: request.sessionId }) ?? { session: request.sessionId }, driverOptions(request.signal));
          if (ended.active !== false) throw new Error("Cua reported the failed browser session as still active.");
        } catch (cleanupError) {
          closeTrustedSession?.();
          if (taskManifestPath) await rm(taskManifestPath, { force: true }).catch(() => undefined);
          throw new BrowserError("adapter-failure", `${setupError.message} Cleanup also failed; the Cua browser session was not proven inactive.`, { cause: cleanupError });
        }
      }
      closeTrustedSession?.();
      if (taskManifestPath) await rm(taskManifestPath, { force: true }).catch(() => undefined);
      throw setupError;
    }
  }

  async closeSession(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<void> {
    const session = this.requireSession(sessionId);
    let firstError: unknown;
    try {
      const ended = await session.gateway.endSession(signal);
      if (ended.active !== false) throw new BrowserError("adapter-failure", "Cua did not confirm that the browser session became inactive during cleanup.");
    } catch (error) {
      firstError = error instanceof BrowserError ? error : new BrowserError("adapter-failure", "Cua browser session did not close cleanly.", { cause: error });
    }
    try {
      session.closeTrustedSession?.();
      if (session.taskManifestPath) await rm(session.taskManifestPath, { force: true });
    } catch (error) {
      firstError ??= new BrowserError("adapter-failure", "Cua task-scoped browser authorization cleanup failed.", { cause: error });
    }
    try {
      for (const stagedPath of session.stagedUploadPaths) await rm(stagedPath, { force: true });
      if (session.stagingDirectory) await rm(session.stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      firstError ??= new BrowserError("adapter-failure", "Cua browser upload staging cleanup failed.", { cause: error });
    }
    this.sessions.delete(sessionId);
    if (firstError) throw firstError;
  }

  async listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    const session = this.requireSession(sessionId);
    const driver = session.driver;
    const windows = await driver.listWindows(this.sdk?.ListWindowsInput.new({ pid: session.pid, onScreenOnly: true }) ?? { pid: session.pid, onScreenOnly: true }, driverOptions(signal));
    const { windowId } = exactBrowserWindow(windows, session.pid);
    if (windowId !== session.windowId) throw new BrowserError("browser-ambiguous", "The prepared browser window changed; its tab capabilities are no longer valid.");
    const bound = gatewayValue(await session.gateway.getBrowserState({ mode: "bind", pid: session.pid, windowId }, signal), "get_browser_state");
    if (bound.bindingQuality !== "exact" || bound.mutationAllowed !== true) {
      throw new BrowserError("browser-ambiguous", "Cua could not re-prove the exact browser endpoint and target binding.");
    }
    const reboundTargetId = textValue(bound.targetId, 256);
    if (!reboundTargetId) throw new BrowserError("adapter-failure", "Cua binding refresh did not return an opaque target id.");
    const tabs = Array.isArray(bound.tabs) ? bound.tabs : [];
    const activeTabIdentity = activeTab(bound, { allowUnidentifiedSingleton: session.profileMode === "isolated_new" });
    const refreshed = new Map<BrowserTabId, ManagedTab>();
    for (const raw of tabs) {
      const tabId = textValue(raw.tabId ?? raw.tab_id, 256);
      const url = textValue(raw.url, 4_096);
      const title = textValue(raw.title, 512);
      if (!tabId || !url || title === undefined) throw new BrowserError("adapter-failure", "Cua browser binding returned an invalid tab identity.");
      const typedTabId = asBrowserTabId(tabId);
      if (refreshed.has(typedTabId)) throw new BrowserError("browser-ambiguous", "Cua browser binding returned duplicate tab identities.");
      const tab: BrowserTabInfo = {
        sessionId,
        tabId: typedTabId,
        documentId: this.nextDocumentId(session),
        url,
        title,
        active: typedTabId === activeTabIdentity.tabId,
      };
      // Rebinding is a new capability generation even when the visible tab
      // metadata is unchanged. Existing refs must not survive a binding read.
      refreshed.set(typedTabId, { tab, targetId: reboundTargetId });
    }
    session.activeTabId = activeTabIdentity.tabId;
    if (!refreshed.has(session.activeTabId)) throw new BrowserError("tab-not-found", "Cua browser binding refresh no longer contains the active tab.");
    // Cua mints a new target capability for every bind. Rebinding is therefore
    // a deliberate capability-generation boundary, even when the exact native
    // PID/window and visible tabs did not change. Adopt only the newly returned
    // opaque target and discard every document/ref namespace from the prior bind.
    session.targetId = reboundTargetId;
    session.continuation = undefined;
    session.tabs.clear();
    for (const [tabId, tab] of refreshed) session.tabs.set(tabId, tab);
    return [...session.tabs.values()].map((entry) => entry.tab);
  }

  async open(sessionId: BrowserSessionId, url: string, signal?: AbortSignal): Promise<BrowserTabInfo> {
    const session = this.requireSession(sessionId);
    const requested = await this.urlPolicy.validate(url);
    if (session.allowedOrigins && !session.allowedOrigins.has(new URL(requested.url).origin)) {
      throw new BrowserError("navigation-policy", `The requested browser origin '${new URL(requested.url).origin}' is outside the Cua browser manifest.`);
    }
    const tab = this.activeTab(session);
    session.continuation = undefined;
    const result = gatewayValue<BrowserNavigateOutput>(await session.gateway.navigate({ targetId: session.targetId, tabId: tab.tabId, url: requested.url }, signal), "browser_navigate");
    assertBoundResponse(result, session.targetId, tab.tabId, "browser_navigate");
    if (result.refsInvalidated !== true) {
      throw new BrowserError("adapter-failure", "Cua browser_navigate did not confirm invalidation of the prior semantic references.");
    }
    const nextUrl = textValue(result.url, 4_096) ?? requested.url;
    // Cua launches an isolated browser on about:blank. That initial opaque
    // document is not an HTTP origin and must not be fed into the URL policy
    // as though it were a redirect source; the destination is still validated
    // above and by Cua's origin-scoped browser runtime.
    if (tab.url !== "about:blank") await this.urlPolicy.validateRedirect(tab.url, nextUrl);
    const next: BrowserTabInfo = { ...tab, documentId: this.nextDocumentId(session), url: nextUrl };
    session.tabs.set(tab.tabId, { tab: next, targetId: session.targetId });
    session.activeTabId = tab.tabId;
    return next;
  }

  async snapshot(sessionId: BrowserSessionId, tabId: BrowserTabId, signal?: AbortSignal, request?: BrowserSnapshotRequest): Promise<BrowserSnapshot> {
    const session = this.requireSession(sessionId);
    const managed = this.requireTab(session, tabId);
    if (request?.continuation !== undefined) {
      const continuation = session.continuation;
      if (!continuation
        || continuation.token !== request.continuation
        || continuation.targetId !== managed.targetId
        || continuation.tabId !== tabId) {
        throw new BrowserError("stale-reference", "The browser semantic continuation is stale, unknown, or belongs to another target.");
      }
    }
    // Any new snapshot replaces the previous read namespace. This also makes a
    // continuation single-use if Cua loses the acknowledgement after dispatch.
    session.continuation = undefined;
    const result = gatewayValue<BrowserSnapshotOutput>(await session.gateway.getBrowserState({
      mode: "snapshot",
      targetId: managed.targetId,
      tabId: String(tabId),
      snapshotFormat: "semantic_v2",
      ...(request?.scopeRef === undefined ? {} : { scopeRef: request.scopeRef }),
      ...(request?.query === undefined ? {} : { query: request.query }),
      ...(request?.continuation === undefined ? {} : { continuation: request.continuation }),
    }, signal), "get_browser_state");
    assertBoundResponse(result, managed.targetId, tabId, "get_browser_state");
    const snapshot = semanticSnapshot(result, sessionId, managed.targetId, tabId, this.maxSnapshotChars);
    const tab: BrowserTabInfo = { ...managed.tab, documentId: snapshot.documentId, url: snapshot.url, title: snapshot.title };
    session.tabs.set(tabId, { targetId: managed.targetId, tab });
    if (snapshot.continuation !== undefined) {
      session.continuation = { token: snapshot.continuation, targetId: managed.targetId, tabId };
    }
    return snapshot;
  }

  async act(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    const session = this.requireSession(sessionId);
    const managed = this.requireTab(session, tabId);
    this.assertCurrentReferences(managed.tab.documentId, request);
    session.continuation = undefined;
    let actionOutput: BrowserActionOutput = {};
    if (request.kind === "scroll") {
      if (!request.direction || request.amount === undefined) throw new BrowserError("invalid-action", "A browser scroll requires a direction and amount.");
      actionOutput = gatewayValue<BrowserActionOutput>(await session.gateway.pointer({ targetId: managed.targetId, tabId, action: "scroll", ...(request.reference ? { ref: request.reference.value } : {}), deltaX: request.direction === "left" ? -request.amount : request.direction === "right" ? request.amount : 0, deltaY: request.direction === "up" ? -request.amount : request.direction === "down" ? request.amount : 0, inputRoute: request.inputRoute ?? this.inputRoute }, signal), "browser_pointer");
    } else if (request.kind === "pointer") {
      const ref = request.reference?.value;
      const destinationRef = request.destinationReference?.value;
      const action = request.pointerAction;
      if (!ref || !action) throw new BrowserError("invalid-action", "A Cua browser pointer action requires a current source ref and action.");
      if (action === "drag" && !destinationRef) throw new BrowserError("invalid-action", "A Cua browser drag requires a current destination ref.");
      actionOutput = gatewayValue<BrowserActionOutput>(await session.gateway.pointer({
        targetId: managed.targetId,
        tabId,
        action,
        ref,
        ...(destinationRef ? { destinationRef } : {}),
        inputRoute: request.inputRoute ?? this.inputRoute,
      }, signal), "browser_pointer");
    } else {
      const ref = request.reference?.value;
      if (!ref) throw new BrowserError("stale-reference", "A current Cua semantic ref is required for this browser action.");
      if (request.kind === "click") {
        actionOutput = gatewayValue<BrowserActionOutput>(await session.gateway.click({ targetId: managed.targetId, tabId, ref, inputRoute: request.inputRoute ?? this.inputRoute }, signal), "browser_click");
      } else if (request.kind === "type") {
        if (request.text === undefined) throw new BrowserError("invalid-action", "A browser type action requires text.");
        const inputRoute = request.inputRoute ?? this.inputRoute;
        if (inputRoute !== "trusted") {
          throw new BrowserError("browser-input-trust-unavailable", "Cua's installed browser_type contract has no synthetic DOM input route; the task must use trusted browser typing.");
        }
        const isDateInput = request.reference.role?.toLocaleLowerCase() === "date";
        if (isDateInput && request.reference.currentValue !== undefined && request.reference.currentValue !== "") {
          throw new BrowserError("invalid-action", "Cua's typed browser route cannot safely replace a known non-empty date control.");
        }
        // Cua's replace=true path selects the existing value before typing.
        // Chromium date inputs do not support that text-selection operation;
        // insert into an observed date ref instead. When Cua omits its value,
        // the user-directed type action may still run; Anesu must re-observe
        // the date before reporting success and must not replay an uncertain type.
        actionOutput = gatewayValue<BrowserActionOutput>(await session.gateway.type({
          targetId: managed.targetId,
          tabId,
          ref,
          text: request.text,
          ...(request.typingMode === undefined ? {} : { mode: request.typingMode }),
          replace: !isDateInput,
        }, signal), "browser_type");
      } else if (request.kind === "press") {
        if (!request.key || !SUPPORTED_BROWSER_KEYS.has(request.key)) {
          throw new BrowserError("invalid-action", "Cua browser key input is limited to Enter, Tab, Escape, Space, Backspace, Delete, and arrow keys.");
        }
        const inputRoute = request.inputRoute ?? this.inputRoute;
        if (inputRoute !== "trusted") {
          throw new BrowserError("browser-input-trust-unavailable", "Cua's installed browser_type contract has no synthetic DOM input route; the task must use trusted browser key input.");
        }
        actionOutput = gatewayValue<BrowserActionOutput>(await session.gateway.type({ targetId: managed.targetId, tabId, ref, text: request.key, mode: "keystrokes" }, signal), "browser_type");
      } else if (request.kind === "select") {
        throw new BrowserError("invalid-action", "Native select controls are not exposed by Cua's typed browser tool surface.");
      } else {
        throw new BrowserError("invalid-action", `Cua browser action '${request.kind}' is not supported by this adapter.`);
      }
    }
    const dialogSummary = await this.resolvePageDialog(session, tabId, signal, approveDialog);
    const next: BrowserTabInfo = { ...managed.tab, documentId: this.nextDocumentId(session) };
    session.tabs.set(tabId, { ...managed, tab: next });
    session.activeTabId = tabId;
    return { sessionId, tab: next, summary: `Cua ${request.kind} dispatched.${dialogSummary ? ` ${dialogSummary}` : ""}`, ...actionMetadata(actionOutput) };
  }

  async wait(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserWaitRequest, signal?: AbortSignal): Promise<BrowserWaitResult> {
    if (!Number.isSafeInteger(request.milliseconds) || request.milliseconds < 0) throw new BrowserError("invalid-action", "Browser wait duration must be a non-negative integer.");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, request.milliseconds);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); reject(new BrowserError("browser-cancelled", "The browser wait was cancelled.")); }, { once: true });
    });
    const session = this.requireSession(sessionId);
    const tab = this.requireTab(session, tabId).tab;
    session.continuation = undefined;
    const next: BrowserTabInfo = { ...tab, documentId: this.nextDocumentId(session) };
    session.tabs.set(tabId, { ...this.requireTab(session, tabId), tab: next });
    session.activeTabId = tabId;
    return { sessionId, tab: next, waitedMs: request.milliseconds };
  }

  async screenshot(_sessionId: BrowserSessionId, _tabId: BrowserTabId, _target: BrowserScreenshotTarget): Promise<BrowserScreenshotCapture> {
    throw new BrowserError("artifact-violation", "Browser screenshots are not enabled through the current public Cua TypeScript browser gateway.");
  }

  async upload(sessionId: BrowserSessionId, tabId: BrowserTabId, request: BrowserActionRequest, signal?: AbortSignal, approveDialog?: BrowserDialogApproval): Promise<BrowserActionResult> {
    const session = this.requireSession(sessionId);
    const managed = this.requireTab(session, tabId);
    this.assertCurrentReferences(managed.tab.documentId, request);
    session.continuation = undefined;
    const ref = request.reference?.value;
    if (!ref || !request.sourcePath) throw new BrowserError("invalid-action", "A Cua browser upload requires one current ref and one approved file.");
    const sourcePath = await this.stageUpload(session, request.sourcePath, request.maxBytes);
    const uploadResult = gatewayValue<BrowserSetInputFilesOutput>(await session.gateway.setInputFiles({ targetId: managed.targetId, tabId, ref, files: [sourcePath] }, signal), "browser_set_input_files");
    assertBoundResponse(uploadResult, managed.targetId, tabId, "browser_set_input_files");
    if (uploadResult.ref !== ref || uploadResult.fileCount !== 1) {
      throw new BrowserError("adapter-failure", "Cua browser_set_input_files returned a ref or file count different from the authorized upload.");
    }
    const dialogSummary = await this.resolvePageDialog(session, tabId, signal, approveDialog);
    const next: BrowserTabInfo = { ...managed.tab, documentId: this.nextDocumentId(session) };
    session.tabs.set(tabId, { ...managed, tab: next });
    session.activeTabId = tabId;
    return { sessionId, tab: next, summary: `Cua browser upload dispatched.${dialogSummary ? ` ${dialogSummary}` : ""}` };
  }

  private async stageUpload(session: ManagedSession, sourcePath: string, requestedMaxBytes?: number): Promise<string> {
    if (!session.stagingDirectory) return sourcePath;
    if (!path.isAbsolute(sourcePath)) throw new BrowserError("invalid-action", "Cua browser upload paths must be absolute.");
    const maxBytes = requestedMaxBytes ?? DEFAULT_MAX_STAGED_UPLOAD_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new BrowserError("artifact-violation", "The Cua browser upload byte limit must be a positive safe integer.");
    }
    const fileName = path.basename(sourcePath);
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
      throw new BrowserError("artifact-violation", "The Cua browser upload source must have a regular file name.");
    }
    let source;
    try {
      source = await lstat(sourcePath);
    } catch (error) {
      throw new BrowserError("invalid-action", "The approved browser upload file is no longer available.", { cause: error });
    }
    if (!source.isFile() || source.isSymbolicLink() || source.size > maxBytes) {
      throw new BrowserError("invalid-action", "The approved browser upload source must be a regular non-symlink file.");
    }
    await mkdir(session.stagingDirectory, { recursive: true, mode: 0o700 });
    const stagedPath = path.join(session.stagingDirectory, fileName);
    try {
      await copyFile(sourcePath, stagedPath);
      const staged = await lstat(stagedPath);
      if (!staged.isFile() || staged.isSymbolicLink() || staged.size > maxBytes) {
        throw new BrowserError("artifact-violation", `The Cua browser upload exceeds the ${maxBytes}-byte limit or is not a regular file.`);
      }
      session.stagedUploadPaths.add(stagedPath);
      return stagedPath;
    } catch (error) {
      await rm(stagedPath, { force: true }).catch(() => undefined);
      throw new BrowserError("adapter-failure", "The approved browser upload could not be staged for Cua.", { cause: error });
    }
  }

  private async resolvePageDialog(
    session: ManagedSession,
    tabId: BrowserTabId,
    signal: AbortSignal | undefined,
    approveDialog: BrowserDialogApproval | undefined,
  ): Promise<string | undefined> {
    const inspected = gatewayValue<BrowserDialogOutput>(await session.gateway.dialog({ targetId: session.targetId, tabId, action: "inspect" }, signal), "browser_dialog");
    assertBoundResponse(inspected, session.targetId, tabId, "browser_dialog");
    if (inspected.present !== true) return undefined;
    const dialogId = typeof inspected.dialogId === "string" ? inspected.dialogId : undefined;
    if (!dialogId) throw new BrowserError("adapter-failure", "Cua reported a page dialog without an opaque dialog id.");
    if (!approveDialog) throw new BrowserError("adapter-failure", "Cua reported a page dialog, but no dialog approval callback is available.");
    const type = inspected.kind === "alert" || inspected.kind === "beforeunload" || inspected.kind === "confirm" || inspected.kind === "prompt"
      ? inspected.kind
      : "alert";
    const resolution = await approveDialog({ type, message: "The page dialog message is not exposed by Cua semantic state." }, signal);
    const result = await gatewayValue<BrowserDialogOutput>(await session.gateway.dialog({
      targetId: session.targetId,
      tabId,
      action: resolution.decision === "accept" ? "accept" : "dismiss",
      dialogId,
      ...(resolution.promptText !== undefined ? { promptText: resolution.promptText } : {}),
      // Foreground escalation is deliberately not inferred. Cua will return a
      // structured refusal when the background route cannot prove safe delivery.
      deliveryMode: "background",
    }, signal), "browser_dialog");
    assertBoundResponse(result, session.targetId, tabId, "browser_dialog");
    if (result.dialogId !== undefined && result.dialogId !== dialogId) {
      throw new BrowserError("adapter-failure", "Cua resolved a different page dialog than the authorized dialog.");
    }
    if (result.action !== undefined && result.action !== resolution.decision) {
      throw new BrowserError("adapter-failure", "Cua reported a page-dialog action different from the authorized decision.");
    }
    if (result.present === true && result.action === undefined) {
      throw new BrowserError("adapter-failure", "Cua did not confirm the page dialog resolution.");
    }
    return `Page ${type} dialog ${resolution.decision}ed.`;
  }

  async download(_sessionId: BrowserSessionId, _tabId: BrowserTabId, _request: BrowserActionRequest, _target: BrowserDownloadTarget): Promise<never> {
    throw new BrowserError("adapter-failure", "Browser downloads are unavailable through the public Cua TypeScript SDK because its trusted MCP-host approval evidence is not available.");
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    let firstError: unknown;
    try {
      await this.closeAll(signal);
    } catch (error) {
      firstError = error;
    }
    try {
      if (this.driver) await this.driver.shutdown(signalOptions(signal));
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }

  private async closeAll(signal?: AbortSignal): Promise<void> {
    let firstError: unknown;
    for (const sessionId of [...this.sessions.keys()]) {
      try {
        await this.closeSession(sessionId, signal);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  private async requireDriver(): Promise<CuaRuntimeDriver> {
    if (this.driver) return this.driver;
    if (this.options.createDriver) {
      this.driver = await this.options.createDriver();
      return this.driver;
    }
    this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
    const manifestPath = this.options.manifestPath ?? `${process.cwd()}/config/cua-browser-capabilities.yaml`;
    const mode = this.sdk.SessionPermissionMode.Bounded;
    const configured = {
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [mode],
        compatibilityMode: mode,
        compatibilityCapabilityManifestPath: manifestPath,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: 8n * 60n * 60n,
        maxIdleTtlSeconds: 30n * 60n,
      },
    };
    this.driver = this.sdk.CuaDriver.createConfiguredWithAuthorizationHost(
      configured,
      createCuaAuthorizationHost({
        actions: {
          allow: this.sdk.DriverAuthorizationAction.Allow,
          deny: this.sdk.DriverAuthorizationAction.Deny,
          cancel: this.sdk.DriverAuthorizationAction.Cancel,
        },
        authorize: async (request, signal) => {
          const sessionId = request.publicSession as BrowserSessionId;
          const authorize = this.pendingExistingProfileAuthorizations.get(sessionId);
          if (!authorize) return "cancel";
          return authorize(request, signal);
        },
      }),
    ) as unknown as CuaRuntimeDriver;
    return this.driver;
  }

  private requireSession(sessionId: BrowserSessionId): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new BrowserError("session-not-found", `Browser session '${sessionId}' was not found by Cua.`);
    return session;
  }

  private activeTab(session: ManagedSession): BrowserTabInfo {
    const tab = session.tabs.get(session.activeTabId)?.tab;
    if (!tab) throw new BrowserError("tab-not-found", "Cua did not expose an active browser tab.");
    return tab;
  }

  private nextDocumentId(session: ManagedSession): ReturnType<typeof asBrowserDocumentId> {
    session.generation += 1;
    return asBrowserDocumentId(`generation:${session.generation}`);
  }

  private assertCurrentReferences(documentId: ReturnType<typeof asBrowserDocumentId>, request: BrowserActionRequest): void {
    if (request.reference && request.reference.documentId !== documentId) {
      throw new BrowserError("stale-reference", "The browser element reference is stale; take a new semantic snapshot before acting.");
    }
    if (request.destinationReference && request.destinationReference.documentId !== documentId) {
      throw new BrowserError("stale-reference", "The browser pointer destination reference is stale; take a new semantic snapshot before acting.");
    }
  }

  private requireTab(session: ManagedSession, tabId: BrowserTabId): ManagedTab {
    const tab = session.tabs.get(tabId);
    if (!tab) throw new BrowserError("tab-not-found", `Browser tab '${tabId}' is not owned by the Cua session.`);
    return tab;
  }
}
