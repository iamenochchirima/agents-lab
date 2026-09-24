import type {
  CuaDriverLike,
  EndSessionOutput,
  ToolResult,
} from "@trycua/cua-driver";
import { encodeCuaJson, type CuaJsonValue } from "./cua-json.js";

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_ID_BYTES = 4 * 1024;
const MAX_TABS = 64;
const MAX_REFS = 512;
const MAX_FILES = 32;
const MAX_FILE_BYTES = 4 * 1024;
const MAX_REF_ACTIONS = 16;

type AsyncOptions = { readonly signal: AbortSignal } | undefined;

/** The smallest installed-SDK seam needed by this gateway. */
export type CuaBrowserDriver = Pick<CuaDriverLike, "callTool" | "endSession"> & {
  /** Present on the installed SDK; optional so deterministic gateway fakes stay small. */
  readonly listToolsJson?: () => string | Promise<string>;
};

export type BrowserToolName =
  | "browser_prepare"
  | "get_browser_state"
  | "browser_navigate"
  | "browser_click"
  | "browser_type"
  | "browser_pointer"
  | "browser_dialog"
  | "browser_set_input_files";

export interface BrowserPrepareInput {
  readonly pid?: number;
  readonly windowId?: bigint;
  readonly allowLaunch?: boolean;
  readonly profile?: { readonly mode: "isolated_new" | "isolated_named"; readonly name?: string };
  readonly strategy?: { readonly kind: "existing_profile" };
}

export interface BrowserStateBindInput {
  readonly mode: "bind";
  readonly pid: number;
  readonly windowId: bigint;
}

export interface BrowserStateSnapshotInput {
  readonly mode: "snapshot";
  readonly targetId: string;
  readonly tabId: string;
  readonly snapshotFormat?: "dom_refs_v1" | "semantic_v2";
  readonly scopeRef?: string;
  readonly query?: string;
  readonly continuation?: string;
  readonly includeScreenshot?: boolean;
}

export type BrowserStateInput = BrowserStateBindInput | BrowserStateSnapshotInput;

export interface BrowserNavigateInput {
  readonly targetId: string;
  readonly tabId: string;
  readonly url: string;
}

interface BrowserTab {
  readonly tabId: string;
  readonly title: string;
  readonly url: string;
  /** Cua uses null when it cannot prove which tab is active. */
  readonly active: boolean | null;
}

export interface BrowserPrepareOutput {
  readonly prepared: boolean;
  readonly action?: string;
  readonly message?: string;
  readonly preparedPid?: number;
  readonly attachment?: string;
}

export interface BrowserBindOutput {
  readonly mode: "bind";
  readonly targetId: string;
  readonly bindingQuality: "exact" | "heuristic";
  readonly mutationAllowed: boolean;
  readonly tabs: readonly BrowserTab[];
}

export interface BrowserSemanticRef {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly actions: readonly string[];
  readonly destinationRef?: string;
  readonly frame: string;
  readonly visibility: string;
}

export interface BrowserSnapshotOutput {
  readonly mode: "snapshot";
  readonly targetId: string;
  readonly tabId: string;
  readonly snapshotId: string;
  readonly format: "dom_refs_v1" | "semantic_v2";
  readonly url: string;
  readonly title?: string;
  readonly outline?: string;
  readonly complete?: boolean;
  readonly scope?: string;
  readonly continuation?: string;
  readonly refs: readonly BrowserSemanticRef[];
  readonly contentRefs: readonly BrowserSemanticRef[];
  readonly omissions?: Readonly<Record<string, number>>;
  readonly oopif?: { readonly status: string; readonly frames: number };
}

export type BrowserStateOutput = BrowserBindOutput | BrowserSnapshotOutput;

export interface BrowserNavigateOutput {
  readonly targetId: string;
  readonly tabId: string;
  readonly url: string;
  readonly refsInvalidated: boolean;
}

export interface BrowserDialogInput {
  readonly targetId: string;
  readonly tabId: string;
  readonly action: "inspect" | "accept" | "dismiss";
  readonly dialogId?: string;
  readonly promptText?: string;
  readonly deliveryMode?: "background" | "foreground";
}

export interface BrowserDialogOutput {
  readonly targetId: string;
  readonly tabId: string;
  readonly present: boolean;
  readonly dialogId?: string;
  readonly kind?: string;
  readonly action?: "accept" | "dismiss";
}

export interface BrowserSetInputFilesInput {
  readonly targetId: string;
  readonly tabId: string;
  readonly ref: string;
  readonly files: readonly string[];
}

export interface BrowserSetInputFilesOutput {
  readonly targetId: string;
  readonly tabId: string;
  readonly ref: string;
  readonly fileCount: number;
}

export type BrowserActionEffect = "confirmed" | "partial" | "unverifiable" | "suspected_noop" | "refused";
export type BrowserActionRoute = "accessibility" | "synthetic_events" | "global_input" | "system_api" | "dom" | "trusted_input" | "trusted" | "dom_event";
export type BrowserDeliveryMode = "background" | "foreground" | "not_applicable" | "unknown";
export type BrowserEscalationTarget = "pixel" | "foreground" | "page" | "session";
export type BrowserEscalationReason = "route_unavailable" | "delivery_failed" | "effect_unconfirmed" | "suspected_noop" | "permission_required";

export interface BrowserActionOutput {
  readonly effect?: BrowserActionEffect;
  readonly route?: BrowserActionRoute;
  readonly delivery?: { readonly mode: BrowserDeliveryMode; readonly deliveredCount?: number };
  readonly escalation?: { readonly target: BrowserEscalationTarget; readonly reason: BrowserEscalationReason };
}

export interface BrowserClickInput {
  readonly targetId: string;
  readonly tabId: string;
  readonly ref?: string;
  readonly x?: number;
  readonly y?: number;
  readonly inputRoute?: "trusted" | "dom_event";
}

export interface BrowserTypeInput {
  readonly targetId: string;
  readonly tabId: string;
  readonly ref: string;
  readonly text: string;
  readonly mode?: "insert_text" | "keystrokes";
  readonly replace?: boolean;
}

export type BrowserPointerInput =
  | BrowserPointerCommon & { readonly action: "hover" | "right_click" | "double_click"; readonly ref?: string; readonly x?: number; readonly y?: number }
  | BrowserPointerCommon & { readonly action: "scroll"; readonly deltaX?: number; readonly deltaY?: number; readonly ref?: string; readonly x?: number; readonly y?: number }
  | BrowserPointerCommon & { readonly action: "drag"; readonly ref?: string; readonly x?: number; readonly y?: number; readonly destinationRef?: string; readonly toX?: number; readonly toY?: number };

interface BrowserPointerCommon {
  readonly targetId: string;
  readonly tabId: string;
  readonly inputRoute?: "trusted" | "dom_event";
}

export interface BrowserRefusal {
  readonly code: string;
  readonly message: string;
  readonly nextAction?: string;
}

export type BrowserGatewayResponse<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "refused"; readonly refusal: BrowserRefusal };

export type CuaBrowserGatewayErrorCode = "invalid-input" | "tool-failure" | "malformed-result";

export class CuaBrowserGatewayError extends Error {
  readonly code: CuaBrowserGatewayErrorCode;

  constructor(code: CuaBrowserGatewayErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "CuaBrowserGatewayError";
    this.code = code;
  }
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, field: string, maxBytes: number = MAX_TEXT_BYTES): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new CuaBrowserGatewayError("malformed-result", `Cua ${field} must be a nonempty bounded string.`);
  }
  return value;
}

function boundedText(value: unknown, field: string, maxBytes: number = MAX_TEXT_BYTES): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new CuaBrowserGatewayError("malformed-result", `Cua ${field} must be a bounded string.`);
  }
  return value;
}

function boundedInputString(value: string, field: string, maxBytes = MAX_TEXT_BYTES): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new CuaBrowserGatewayError("invalid-input", `${field} must be a nonempty string of at most ${maxBytes} bytes.`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxBytes = MAX_TEXT_BYTES): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedString(value, field, maxBytes);
}

function boundedNumber(value: unknown, field: string, integer = false, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || value < minimum))) {
    throw new CuaBrowserGatewayError("malformed-result", `Cua ${field} has an invalid bounded number.`);
  }
  return value;
}

function validateInputNumber(value: number | undefined, field: string, integer = false): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || value < 1))) {
    throw new CuaBrowserGatewayError("invalid-input", `${field} must be a finite bounded ${integer ? "positive integer" : "number"}.`);
  }
  return value;
}

function id(value: string, field: string): string {
  return boundedInputString(value, field, MAX_ID_BYTES);
}

function validateWindowId(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new CuaBrowserGatewayError("invalid-input", `${field} must be a non-negative bigint.`);
  }
  return value;
}

function validateUrl(value: string): string {
  const url = boundedInputString(value, "url");
  const lower = url.toLowerCase();
  if (!(lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("about:"))) {
    throw new CuaBrowserGatewayError("invalid-input", "url must use http, https, or about.");
  }
  return url;
}

function parseStructured(result: ToolResult, tool: BrowserToolName): RecordValue {
  if (typeof result.structuredJson !== "string" || result.structuredJson.length === 0) {
    throw new CuaBrowserGatewayError("malformed-result", `${tool} returned no bounded structured result.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.structuredJson);
  } catch (error) {
    throw new CuaBrowserGatewayError("malformed-result", `${tool} returned invalid structured JSON.`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new CuaBrowserGatewayError("malformed-result", `${tool} structured result must be an object.`);
  }
  return parsed;
}

function refusalOrThrow(result: ToolResult, tool: BrowserToolName, structured: RecordValue): BrowserRefusal | undefined {
  if (structured.status !== "refused") {
    if (result.isError) {
      throw new CuaBrowserGatewayError("tool-failure", `${tool} failed without a structured browser refusal.`);
    }
    return undefined;
  }
  const refusal = structured.refusal;
  if (!isRecord(refusal)) {
    throw new CuaBrowserGatewayError("malformed-result", `${tool} returned a refusal without a refusal object.`);
  }
  const code = boundedString(refusal.code, `${tool}.refusal.code`, MAX_ID_BYTES);
  const message = boundedString(refusal.message, `${tool}.refusal.message`);
  const detail = isRecord(refusal.detail) ? refusal.detail : undefined;
  const nextAction = detail ? optionalString(detail.next_action, `${tool}.refusal.detail.next_action`, MAX_ID_BYTES) : undefined;
  return { code, message, ...(nextAction === undefined ? {} : { nextAction }) };
}

function requireOk(structured: RecordValue, tool: BrowserToolName): void {
  if (structured.status !== "ok") {
    throw new CuaBrowserGatewayError("malformed-result", `${tool} returned an unknown structured status.`);
  }
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new CuaBrowserGatewayError("malformed-result", `Cua ${field} must be boolean.`);
  return value;
}

function decodeTab(value: unknown, index: number): BrowserTab {
  if (!isRecord(value)) throw new CuaBrowserGatewayError("malformed-result", `Cua tab ${index} must be an object.`);
  return {
    tabId: boundedString(value.tab_id, `tabs[${index}].tab_id`, MAX_ID_BYTES),
    title: boundedText(value.title, `tabs[${index}].title`),
    url: boundedString(value.url, `tabs[${index}].url`),
    active: value.active === null || typeof value.active === "boolean"
      ? value.active
      : (() => { throw new CuaBrowserGatewayError("malformed-result", `tabs[${index}].active must be boolean or null.`); })(),
  };
}

function decodeSemanticRef(value: unknown, index: number): BrowserSemanticRef {
  if (!isRecord(value)) throw new CuaBrowserGatewayError("malformed-result", `Cua semantic ref ${index} must be an object.`);
  const actions = value.actions;
  if (!Array.isArray(actions) || actions.length > MAX_REF_ACTIONS || actions.some((action) => typeof action !== "string" || action.length === 0 || Buffer.byteLength(action, "utf8") > MAX_ID_BYTES)) {
    throw new CuaBrowserGatewayError("malformed-result", `Cua semantic ref ${index}.actions is invalid.`);
  }
  return {
    ref: boundedString(value.ref, `refs[${index}].ref`, MAX_ID_BYTES),
    role: boundedString(value.role, `refs[${index}].role`, MAX_ID_BYTES),
    ...(value.name === undefined || value.name === null ? {} : { name: boundedString(value.name, `refs[${index}].name`) }),
    ...(value.value === undefined || value.value === null ? {} : { value: boundedString(value.value, `refs[${index}].value`) }),
    actions: actions as string[],
    ...(value.destination_ref === undefined || value.destination_ref === null ? {} : { destinationRef: boundedString(value.destination_ref, `refs[${index}].destination_ref`, MAX_ID_BYTES) }),
    frame: boundedString(value.frame, `refs[${index}].frame`, MAX_ID_BYTES),
    visibility: boundedString(value.visibility, `refs[${index}].visibility`, MAX_ID_BYTES),
  };
}

function decodeDomRef(value: unknown, index: number): BrowserSemanticRef {
  if (!isRecord(value)) throw new CuaBrowserGatewayError("malformed-result", `Cua DOM ref ${index} must be an object.`);
  return {
    ref: boundedString(value.ref, `refs[${index}].ref`, MAX_ID_BYTES),
    role: boundedString(value.node, `refs[${index}].node`, MAX_ID_BYTES),
    ...(value.label === undefined || value.label === null ? {} : { name: boundedString(value.label, `refs[${index}].label`) }),
    actions: [],
    frame: boundedString(value.frame, `refs[${index}].frame`, MAX_ID_BYTES),
    visibility: "unknown",
  };
}

function decodeRefusal<T>(result: ToolResult, tool: BrowserToolName, decoder: (structured: RecordValue) => T): BrowserGatewayResponse<T> {
  const structured = parseStructured(result, tool);
  const refusal = refusalOrThrow(result, tool, structured);
  if (refusal) return { kind: "refused", refusal };
  requireOk(structured, tool);
  return { kind: "ok", value: decoder(structured) };
}

function actionField<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new CuaBrowserGatewayError("malformed-result", `Cua action ${field} is outside its closed vocabulary.`);
  }
  return value as T;
}

function decodeAction(result: ToolResult, tool: BrowserToolName): BrowserGatewayResponse<BrowserActionOutput> {
  const structured = parseStructured(result, tool);
  const refusal = refusalOrThrow(result, tool, structured);
  if (refusal) return { kind: "refused", refusal };
  const hasActionShape = structured.status === "ok"
    || structured.effect !== undefined
    || structured.route !== undefined
    || structured.delivery !== undefined
    || structured.escalation !== undefined;
  if (!hasActionShape) throw new CuaBrowserGatewayError("malformed-result", `${tool} returned an unknown structured status.`);
  const output = (() => {
    const output: {
      effect?: BrowserActionOutput["effect"];
      route?: BrowserActionOutput["route"];
      delivery?: BrowserActionOutput["delivery"];
      escalation?: BrowserActionOutput["escalation"];
    } = {};
    if (structured.effect !== undefined) output.effect = actionField(structured.effect, "effect", ["confirmed", "partial", "unverifiable", "suspected_noop", "refused"] as const);
    if (structured.route !== undefined) output.route = actionField(structured.route, "route", ["accessibility", "synthetic_events", "global_input", "system_api", "dom", "trusted_input", "trusted", "dom_event"] as const);
    if (isRecord(structured.delivery)) {
      const deliveredCount = structured.delivery.delivered_count === null || structured.delivery.delivered_count === undefined
        ? undefined
        : boundedNumber(structured.delivery.delivered_count, "delivery.delivered_count", true, 0);
      output.delivery = {
        mode: actionField(structured.delivery.mode, "delivery.mode", ["background", "foreground", "not_applicable", "unknown"] as const),
        ...(deliveredCount === undefined ? {} : { deliveredCount }),
      };
    } else if (structured.delivery !== undefined && structured.delivery !== null) {
      throw new CuaBrowserGatewayError("malformed-result", `${tool} delivery must be an object.`);
    }
    if (isRecord(structured.escalation)) {
      output.escalation = {
        target: actionField(structured.escalation.target, "escalation.target", ["pixel", "foreground", "page", "session"] as const),
        reason: actionField(structured.escalation.reason, "escalation.reason", ["route_unavailable", "delivery_failed", "effect_unconfirmed", "suspected_noop", "permission_required"] as const),
      };
    } else if (structured.escalation !== undefined && structured.escalation !== null) {
      throw new CuaBrowserGatewayError("malformed-result", `${tool} escalation must be an object.`);
    }
    return output;
  })();
  if (output.effect === "refused") {
    return {
      kind: "refused",
      refusal: {
        // Cua 0.28.2 does not expose a structured refusal code for these
        // action effects. Bounded text is diagnostic only; never infer policy
        // from a parenthesized token in it.
        code: "browser_action_refused",
        message: `Cua refused ${tool}.`,
      },
    };
  }
  return { kind: "ok", value: output };
}

function callInput(value: CuaJsonValue): string {
  try {
    return encodeCuaJson(value);
  } catch (error) {
    if (error instanceof CuaBrowserGatewayError) throw error;
    throw new CuaBrowserGatewayError("invalid-input", error instanceof Error ? error.message : "Cua input could not be encoded.", { cause: error });
  }
}

/**
 * Low-level, typed bridge to Cua's browser tool surface.
 *
 * This class intentionally has no generic `call` method, no browser_download
 * method, and no page/selector/CDP escape hatch. The coordinator owns policy;
 * this gateway owns wire encoding and bounded Cua result decoding.
 */
export class CuaBrowserGateway {
  readonly session: string;

  constructor(private readonly driver: CuaBrowserDriver, session: string) {
    const normalizedSession = typeof session === "string" ? session.trim() : "";
    if (normalizedSession.length === 0 || normalizedSession === "default") {
      throw new CuaBrowserGatewayError("invalid-input", "Cua browser gateway requires a nonempty non-default session.");
    }
    this.session = normalizedSession;
  }

  private async call<T>(tool: BrowserToolName, input: Record<string, CuaJsonValue>, decoder: (result: ToolResult) => BrowserGatewayResponse<T>, signal?: AbortSignal): Promise<BrowserGatewayResponse<T>> {
    let result: ToolResult;
    try {
      result = await this.driver.callTool(tool, callInput({ ...input, session: this.session }), signal ? { signal } : undefined);
    } catch (error) {
      throw new CuaBrowserGatewayError("tool-failure", `Cua ${tool} call failed.`, { cause: error });
    }
    return decoder(result);
  }

  async prepare(input: BrowserPrepareInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserPrepareOutput>> {
    const pid = validateInputNumber(input.pid, "pid", true);
    if (input.windowId !== undefined) validateWindowId(input.windowId, "windowId");
    if (input.profile?.mode === "isolated_named") boundedInputString(input.profile.name ?? "", "profile.name", MAX_ID_BYTES);
    if (input.profile?.mode === "isolated_new" && input.profile.name !== undefined) {
      throw new CuaBrowserGatewayError("invalid-input", "isolated_new does not accept profile.name.");
    }
    const args: Record<string, CuaJsonValue> = {
      ...(pid === undefined ? {} : { pid }),
      ...(input.windowId === undefined ? {} : { window_id: input.windowId }),
      ...(input.allowLaunch === undefined ? {} : { allow_launch: input.allowLaunch }),
      ...(input.profile === undefined ? {} : { profile: { mode: input.profile.mode, ...(input.profile.name === undefined ? {} : { name: input.profile.name }) } }),
      ...(input.strategy === undefined ? {} : { strategy: { kind: input.strategy.kind } }),
    };
    return this.call("browser_prepare", args, (result) => decodeRefusal(result, "browser_prepare", (structured) => ({
      prepared: typeof structured.prepared === "boolean" ? structured.prepared : (() => { throw new CuaBrowserGatewayError("malformed-result", "browser_prepare.prepared must be boolean."); })(),
      ...(structured.action === undefined ? {} : { action: boundedString(structured.action, "browser_prepare.action", MAX_ID_BYTES) }),
      ...(structured.message === undefined ? {} : { message: boundedString(structured.message, "browser_prepare.message") }),
      ...(structured.prepared_pid === undefined || structured.prepared_pid === null ? {} : { preparedPid: boundedNumber(structured.prepared_pid, "browser_prepare.prepared_pid", true, 1) }),
      ...(structured.attachment === undefined || structured.attachment === null ? {} : { attachment: boundedString(structured.attachment, "browser_prepare.attachment", MAX_ID_BYTES) }),
    })), signal);
  }

  async getBrowserState(input: BrowserStateInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserStateOutput>> {
    const args: Record<string, CuaJsonValue> = input.mode === "bind"
      ? { pid: validateInputNumber(input.pid, "pid", true) as number, window_id: validateWindowId(input.windowId, "windowId") }
      : {
        target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"),
        ...(input.snapshotFormat === undefined ? {} : { snapshot_format: input.snapshotFormat }),
        ...(input.scopeRef === undefined ? {} : { scope_ref: id(input.scopeRef, "scopeRef") }),
        ...(input.query === undefined ? {} : { query: boundedInputString(input.query, "query") }),
        ...(input.continuation === undefined ? {} : { continuation: id(input.continuation, "continuation") }),
        ...(input.includeScreenshot === undefined ? {} : { include_screenshot: input.includeScreenshot }),
      };
    return this.call("get_browser_state", args, (result) => decodeRefusal(result, "get_browser_state", (structured) => {
      if (structured.mode === "bind") {
        const tabs = structured.tabs;
        if (!Array.isArray(tabs) || tabs.length > MAX_TABS) throw new CuaBrowserGatewayError("malformed-result", "get_browser_state.tabs is invalid.");
        return {
          mode: "bind",
          targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
          bindingQuality: actionField(structured.binding_quality, "binding_quality", ["exact", "heuristic"]),
          mutationAllowed: typeof structured.mutation_allowed === "boolean" ? structured.mutation_allowed : (() => { throw new CuaBrowserGatewayError("malformed-result", "mutation_allowed must be boolean."); })(),
          tabs: tabs.map(decodeTab),
        } satisfies BrowserBindOutput;
      }
      if (structured.mode !== "snapshot") throw new CuaBrowserGatewayError("malformed-result", "get_browser_state.mode is invalid.");
      const snapshot = isRecord(structured.snapshot) ? structured.snapshot : undefined;
      const page = isRecord(structured.page) ? structured.page : undefined;
      const refs = structured.refs;
      const contentRefs = structured.content_refs;
      if (!Array.isArray(refs) || refs.length > MAX_REFS) {
        throw new CuaBrowserGatewayError("malformed-result", "get_browser_state refs are invalid or exceed the bound.");
      }
      if (snapshot === undefined) {
        return {
          mode: "snapshot",
          targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
          tabId: boundedString(structured.tab_id, "tab_id", MAX_ID_BYTES),
          snapshotId: boundedString(structured.snapshot_id, "snapshot_id", MAX_ID_BYTES),
          format: "dom_refs_v1",
          url: boundedString(structured.url, "url"),
          refs: refs.map(decodeDomRef),
          contentRefs: [],
        } satisfies BrowserSnapshotOutput;
      }
      if (!page || !Array.isArray(contentRefs) || contentRefs.length > MAX_REFS) {
        throw new CuaBrowserGatewayError("malformed-result", "get_browser_state semantic snapshot/page/refs are invalid.");
      }
      const omissions = isRecord(snapshot.omitted)
        ? Object.fromEntries(Object.entries(snapshot.omitted).map(([key, value]) => [key, boundedNumber(value, `snapshot.omitted.${key}`, true, 0)]))
        : undefined;
      const oopif = isRecord(structured.oopif) ? {
        status: boundedString(structured.oopif.status, "oopif.status", MAX_ID_BYTES),
        frames: boundedNumber(structured.oopif.frames, "oopif.frames", true, 0),
      } : undefined;
      return {
        mode: "snapshot",
        targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
        tabId: boundedString(structured.tab_id, "tab_id", MAX_ID_BYTES),
        snapshotId: boundedString(snapshot.id, "snapshot.id", MAX_ID_BYTES),
        format: actionField(snapshot.format, "snapshot.format", ["semantic_v2"] as const),
        url: boundedString(page.url, "page.url"),
        title: boundedText(page.title, "page.title"),
        ...(structured.outline === undefined || structured.outline === null ? {} : { outline: boundedText(structured.outline, "outline", MAX_TEXT_BYTES) }),
        ...(snapshot.complete === undefined ? {} : { complete: optionalBoolean(snapshot.complete, "snapshot.complete") as boolean }),
        ...(snapshot.scope === undefined ? {} : { scope: boundedString(snapshot.scope, "snapshot.scope", MAX_ID_BYTES) }),
        ...(snapshot.continuation === undefined || snapshot.continuation === null ? {} : { continuation: boundedString(snapshot.continuation, "snapshot.continuation", MAX_ID_BYTES) }),
        refs: refs.map(decodeSemanticRef),
        contentRefs: contentRefs.map(decodeSemanticRef),
        ...(omissions === undefined ? {} : { omissions }),
        ...(oopif === undefined ? {} : { oopif }),
      } satisfies BrowserSnapshotOutput;
    }), signal);
  }

  async navigate(input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserNavigateOutput>> {
    const args = { target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"), url: validateUrl(input.url) } satisfies Record<string, CuaJsonValue>;
    return this.call("browser_navigate", args, (result) => decodeRefusal(result, "browser_navigate", (structured) => ({
      targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
      tabId: boundedString(structured.tab_id, "tab_id", MAX_ID_BYTES),
      url: boundedString(structured.url, "url"),
      refsInvalidated: typeof structured.refs_invalidated === "boolean" ? structured.refs_invalidated : (() => { throw new CuaBrowserGatewayError("malformed-result", "browser_navigate.refs_invalidated must be boolean."); })(),
    })), signal);
  }

  async click(input: BrowserClickInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserActionOutput>> {
    const args: Record<string, CuaJsonValue> = {
      target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"),
      ...(input.ref === undefined ? {} : { ref: id(input.ref, "ref") }),
      ...(input.x === undefined ? {} : { x: validateInputNumber(input.x, "x") as number }),
      ...(input.y === undefined ? {} : { y: validateInputNumber(input.y, "y") as number }),
      ...(input.inputRoute === undefined ? {} : { input_route: input.inputRoute }),
    };
    if ((input.x === undefined) !== (input.y === undefined) || (input.ref === undefined && input.x === undefined)) throw new CuaBrowserGatewayError("invalid-input", "click requires a ref or both x and y.");
    if (input.inputRoute === "dom_event" && input.ref === undefined) throw new CuaBrowserGatewayError("invalid-input", "dom_event click requires a ref.");
    return this.call("browser_click", args, (result) => decodeAction(result, "browser_click"), signal);
  }

  async type(input: BrowserTypeInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserActionOutput>> {
    const args: Record<string, CuaJsonValue> = {
      target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"), ref: id(input.ref, "ref"), text: boundedInputString(input.text, "text"),
      ...(input.mode === undefined ? {} : { mode: input.mode }), ...(input.replace === undefined ? {} : { replace: input.replace }),
    };
    return this.call("browser_type", args, (result) => decodeAction(result, "browser_type"), signal);
  }

  async pointer(input: BrowserPointerInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserActionOutput>> {
    const args: Record<string, CuaJsonValue> = {
      target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"), action: input.action,
      ...(input.inputRoute === undefined ? {} : { input_route: input.inputRoute }),
    };
    if ("ref" in input && input.ref !== undefined) args.ref = id(input.ref, "ref");
    if ("x" in input && input.x !== undefined) args.x = validateInputNumber(input.x, "x") as number;
    if ("y" in input && input.y !== undefined) args.y = validateInputNumber(input.y, "y") as number;
    if (input.action === "scroll") {
      if (input.deltaX === undefined && input.deltaY === undefined) throw new CuaBrowserGatewayError("invalid-input", "scroll requires deltaX or deltaY.");
      if (input.deltaX !== undefined) args.delta_x = validateInputNumber(input.deltaX, "deltaX") as number;
      if (input.deltaY !== undefined) args.delta_y = validateInputNumber(input.deltaY, "deltaY") as number;
    } else if (input.action === "drag") {
      if (input.destinationRef !== undefined) args.destination_ref = id(input.destinationRef, "destinationRef");
      if (input.toX !== undefined) args.to_x = validateInputNumber(input.toX, "toX") as number;
      if (input.toY !== undefined) args.to_y = validateInputNumber(input.toY, "toY") as number;
      if ((input.destinationRef === undefined) !== (input.toX === undefined || input.toY === undefined)) throw new CuaBrowserGatewayError("invalid-input", "drag requires destinationRef or both toX and toY.");
    }
    if ((input.inputRoute === "dom_event") && !("ref" in input && input.ref !== undefined)) throw new CuaBrowserGatewayError("invalid-input", "dom_event pointer input requires a ref.");
    return this.call("browser_pointer", args, (result) => decodeAction(result, "browser_pointer"), signal);
  }

  async dialog(input: BrowserDialogInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserDialogOutput>> {
    const args: Record<string, CuaJsonValue> = {
      target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"), action: input.action,
      ...(input.dialogId === undefined ? {} : { dialog_id: id(input.dialogId, "dialogId") }),
      ...(input.promptText === undefined ? {} : { prompt_text: boundedInputString(input.promptText, "promptText") }),
      ...(input.deliveryMode === undefined ? {} : { delivery_mode: input.deliveryMode }),
    };
    if (input.action !== "inspect" && input.dialogId === undefined) throw new CuaBrowserGatewayError("invalid-input", "dialog resolution requires dialogId.");
    if (input.promptText !== undefined && input.action !== "accept") throw new CuaBrowserGatewayError("invalid-input", "promptText is valid only for accepting a dialog.");
    return this.call("browser_dialog", args, (result) => decodeRefusal(result, "browser_dialog", (structured) => ({
      targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
      tabId: boundedString(structured.tab_id, "tab_id", MAX_ID_BYTES),
      present: typeof structured.present === "boolean" ? structured.present : (() => { throw new CuaBrowserGatewayError("malformed-result", "browser_dialog.present must be boolean."); })(),
      ...(structured.dialog_id === undefined || structured.dialog_id === null ? {} : { dialogId: boundedString(structured.dialog_id, "dialog_id", MAX_ID_BYTES) }),
      ...(structured.kind === undefined || structured.kind === null ? {} : { kind: boundedString(structured.kind, "kind", MAX_ID_BYTES) }),
      ...(structured.action === undefined || structured.action === null ? {} : { action: actionField(structured.action, "action", ["accept", "dismiss"] as const) }),
    })), signal);
  }

  async setInputFiles(input: BrowserSetInputFilesInput, signal?: AbortSignal): Promise<BrowserGatewayResponse<BrowserSetInputFilesOutput>> {
    if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > MAX_FILES) throw new CuaBrowserGatewayError("invalid-input", `files must contain 1-${MAX_FILES} paths.`);
    const files = input.files.map((file) => {
      const value = boundedInputString(file, "file", MAX_FILE_BYTES);
      if (!value.startsWith("/")) throw new CuaBrowserGatewayError("invalid-input", "upload file paths must be absolute.");
      return value;
    });
    const args: Record<string, CuaJsonValue> = { target_id: id(input.targetId, "targetId"), tab_id: id(input.tabId, "tabId"), ref: id(input.ref, "ref"), files };
    return this.call("browser_set_input_files", args, (result) => decodeRefusal(result, "browser_set_input_files", (structured) => ({
      targetId: boundedString(structured.target_id, "target_id", MAX_ID_BYTES),
      tabId: boundedString(structured.tab_id, "tab_id", MAX_ID_BYTES),
      ref: boundedString(structured.ref, "ref", MAX_ID_BYTES),
      fileCount: boundedNumber(structured.file_count, "file_count", true, 1),
    })), signal);
  }

  async endSession(signal?: AbortSignal): Promise<EndSessionOutput> {
    return this.driver.endSession({ session: this.session }, signal ? { signal } : undefined);
  }
}
