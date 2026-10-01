import { accessSync, constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { ActionResult, ScrollDirection as CuaScrollDirection, ToolResult } from "@trycua/cua-driver";
import type {
  ComputerEnvironment,
  ComputerEnvironmentAction,
  ComputerEnvironmentObservation,
  ComputerEnvironmentReadiness,
  ComputerEnvironmentResult,
  ComputerEnvironmentVerification,
  ComputerScrollDirection,
} from "./contracts.js";
import { encodeCuaJson } from "../browser/cua-json.js";
import { stableStringify } from "../persistence/json.js";
import type { ComputerRuntimeEvidence } from "./contracts.js";
import { cuaLinuxHealthProblem } from "./cua-health.js";
import { addCuaRuntimeIdentity, readCuaRuntimeIdentity } from "./cua-runtime-evidence.js";
import type { ComputerVerificationSpec } from "./verification.js";

/** The small driver seam keeps native generated types out of fake-host tests. */
export interface CuaDriverClient {
  callTool?(name: string, argumentsJson: string, options?: unknown): Promise<ToolResult>;
  /** Installed Cua SDK capability inventory; optional for deterministic fakes. */
  listToolsJson?(): string | Promise<string>;
  metadata?(options?: unknown): Promise<unknown>;
  startSession(input: unknown, options?: unknown): Promise<unknown>;
  setAgentCursorTheme(input: unknown, options?: unknown): Promise<unknown>;
  setAgentCursorEnabled(input: unknown, options?: unknown): Promise<unknown>;
  getAgentCursorState?(input: unknown, options?: unknown): Promise<unknown>;
  getDesktopState(input: unknown, options?: unknown): Promise<unknown>;
  listWindows?(input: unknown, options?: unknown): Promise<unknown>;
  getWindowState?(input: unknown, options?: unknown): Promise<unknown>;
  verifyState?(input: unknown, options?: unknown): Promise<unknown>;
  moveCursor(input: unknown, options?: unknown): Promise<unknown>;
  click(input: unknown, options?: unknown): Promise<unknown>;
  typeText(input: unknown, options?: unknown): Promise<unknown>;
  pressKey(input: unknown, options?: unknown): Promise<unknown>;
  scroll(input: unknown, options?: unknown): Promise<unknown>;
  drag(input: unknown, options?: unknown): Promise<unknown>;
  endSession(input: unknown, options?: unknown): Promise<unknown>;
  shutdown(options?: unknown): Promise<void>;
}

/**
 * Generic Cua dispatch is narrower than the runtime's complete inventory.
 * Keep this list next to the callTool wrapper so a new generic operation cannot
 * become reachable merely by adding a string at a call site.
 */
export const NATIVE_CALL_TOOL_NAMES = [
  "health_report",
  "launch_app",
  "kill_app",
  "invoke_menu",
  "set_value",
  "type_text",
  "press_key",
  "scroll",
] as const;

type NativeCallToolName = (typeof NATIVE_CALL_TOOL_NAMES)[number];

/**
 * Dispatch one code-owned native generic tool. The Cua manifest remains the
 * runtime ceiling, while this second check prevents Lina code from reaching
 * an unrelated operation through the SDK's generic escape hatch.
 */
export async function callNativeTool(
  driver: CuaDriverClient,
  name: string,
  argumentsJson: string,
  options?: unknown,
): Promise<ToolResult> {
  const callTool = driver.callTool;
  if (!callTool) {
    throw new CuaEnvironmentError("driver-failure", "The configured CUA driver does not expose generic native tool dispatch.");
  }
  if (!(NATIVE_CALL_TOOL_NAMES as readonly string[]).includes(name)) {
    throw new CuaEnvironmentError("invalid-action", `Native generic tool '${name}' is outside Lina's code-owned dispatch ceiling.`);
  }
  return callTool.call(driver, name as NativeCallToolName, argumentsJson, options);
}

type CuaSdk = typeof import("@trycua/cua-driver");

export type CuaEnvironmentErrorCode =
  | "unavailable"
  | "not-started"
  | "already-closed"
  | "stale-observation"
  | "invalid-action"
  | "driver-failure";

export class CuaEnvironmentError extends Error {
  readonly code: CuaEnvironmentErrorCode;

  constructor(code: CuaEnvironmentErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "CuaEnvironmentError";
    this.code = code;
  }
}

/**
 * An approved application binding is a safety boundary, not optional
 * accessibility metadata. Keep this subtype distinguishable from ordinary
 * accessibility-source failures, which may be safely projected as a
 * screenshot-only observation.
 */
class CuaApplicationBindingError extends CuaEnvironmentError {}

export interface CuaNativeDriverOwnerOptions {
  readonly manifestPath?: string;
  readonly loadSdk?: () => Promise<CuaSdk>;
  /** Test seam; production uses the pinned SDK and immutable manifest below. */
  readonly createDriver?: () => CuaDriverClient | Promise<CuaDriverClient>;
}

export type CuaDriverMode = "production" | "deterministic-fake";

const productionDrivers = new WeakSet<object>();

// Native tasks are short-lived; keep a small TTL ceiling if the process exits
// before its normal session cleanup runs. These values remain below the
// application driver's configured eight-hour / thirty-minute ceilings.
const NATIVE_TASK_SESSION_TTL_SECONDS = 30n * 60n;
const NATIVE_TASK_SESSION_IDLE_TTL_SECONDS = 5n * 60n;

function markProductionDriver(driver: CuaDriverClient): CuaDriverClient {
  productionDrivers.add(driver);
  return driver;
}

/**
 * Owns one configured native Cua driver for the lifetime of an Lina
 * application. Individual tasks still receive separate named Cua sessions;
 * the driver process and its immutable authorization ceiling are not recreated
 * per action or per task.
 */
export class CuaNativeDriverOwner {
  private readonly options: CuaNativeDriverOwnerOptions;
  private driver: CuaDriverClient | undefined;
  private sdk: CuaSdk | undefined;
  private closed = false;
  private preflighted = false;
  private capabilityEvidence: ComputerRuntimeEvidence | undefined;

  constructor(options: CuaNativeDriverOwnerOptions = {}) {
    this.options = options;
  }

  async acquire(): Promise<CuaDriverClient> {
    if (this.closed) throw new CuaEnvironmentError("already-closed", "The native CUA driver owner has already been closed.");
    if (this.driver) return this.driver;
    if (this.options.createDriver) {
      this.driver = await this.options.createDriver();
      return this.driver;
    }
    this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
    const mode = this.sdk.SessionPermissionMode.Bounded;
    this.driver = markProductionDriver(this.sdk.CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [mode],
        compatibilityMode: mode,
        compatibilityCapabilityManifestPath: this.options.manifestPath ?? `${process.cwd()}/config/cua-native-capabilities.yaml`,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: 8n * 60n * 60n,
        maxIdleTtlSeconds: 30n * 60n,
      },
    }) as unknown as CuaDriverClient);
    return this.driver;
  }

  async loadSdk(): Promise<CuaSdk> {
    if (this.sdk) return this.sdk;
    this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
    return this.sdk;
  }

  /** Prove the application-lifetime native runtime before any task approval. */
  async preflight(): Promise<void> {
    if (this.closed) throw new CuaEnvironmentError("already-closed", "The native CUA driver owner has already been closed.");
    if (this.preflighted) return;
    const driver = await this.acquire();
    // A custom driver is the deterministic test/extraction seam. Production
    // drivers are created only by the pinned SDK and must prove both contracts.
    const required = !this.options.createDriver || productionDrivers.has(driver) || driver.listToolsJson !== undefined;
    this.capabilityEvidence = await assertNativeCapabilities(driver, required);
    assertNativeAdapterMethods(driver, required);
    await assertNativeHealth(driver, required);
    this.preflighted = true;
  }

  runtimeEvidence(): ComputerRuntimeEvidence | undefined {
    return this.capabilityEvidence;
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.driver) return;
    const driver = this.driver;
    this.driver = undefined;
    await driver.shutdown();
  }
}

export interface CuaEnvironmentOptions {
  readonly sessionId?: string;
  readonly displayId?: string;
  /** Keep screenshot coordinates and native input in the same desktop or window frame. */
  readonly captureScope?: "desktop" | "window";
  readonly screenshotPath?: string;
  readonly maxObservationBytes?: number;
  readonly maxCoordinate?: number;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  /** Optional code-resolved application from the checked-in native allow-list. */
  readonly application?: { readonly name?: string; readonly launchPath?: string; readonly launchArguments?: readonly string[] };
  readonly manifestPath?: string;
  /** Shared application-lifetime owners pass false; isolated drivers default true. */
  readonly shutdownDriver?: boolean;
  /** Test seam and an extraction seam for an already-authorized host. */
  readonly driver?: CuaDriverClient;
  /** Production requires capability and health proof; deterministic fakes may omit the SDK probes. */
  readonly driverMode?: CuaDriverMode;
  readonly loadSdk?: () => Promise<CuaSdk>;
}

const DEFAULT_MAX_OBSERVATION_BYTES = 32 * 1024;
const DEFAULT_MAX_COORDINATE = 16_384;
// GNOME applications can cold-start through several desktop services before
// their first X11 window is mapped. Keep launch readiness bounded, but leave
// enough room for that real host lifecycle inside the task's larger deadline.
const NATIVE_WINDOW_READY_TIMEOUT_MS = 30_000;
const NATIVE_WINDOW_READY_POLL_MS = 50;
const REQUIRED_NATIVE_TOOLS = [
  "launch_app",
  "kill_app",
  "invoke_menu",
  "list_windows",
  "get_window_state",
  "click",
  "set_value",
  "type_text",
  "press_key",
  "scroll",
  "verify_state",
  "health_report",
  "set_agent_cursor_enabled",
  "get_agent_cursor_state",
  "move_cursor",
  "start_session",
  "end_session",
] as const;

const REQUIRED_NATIVE_SCHEMA_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  launch_app: ["launch_path"],
  kill_app: ["pid"],
  invoke_menu: ["pid", "window_id", "path"],
  list_windows: ["pid"],
  get_window_state: ["pid", "window_id"],
  set_value: ["pid", "value"],
  type_text: ["text"],
  press_key: ["key"],
  scroll: ["direction"],
  verify_state: ["pid", "window_id", "expect"],
  set_agent_cursor_enabled: ["session", "enabled"],
  get_agent_cursor_state: ["session"],
  move_cursor: ["x", "y"],
};

const REQUIRED_NATIVE_SCHEMA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  invoke_menu: ["pid", "window_id", "path"],
  set_value: ["pid", "value"],
  type_text: ["text"],
  press_key: ["key"],
  scroll: ["direction"],
  verify_state: ["pid", "window_id", "expect"],
  set_agent_cursor_enabled: ["session", "enabled"],
  get_agent_cursor_state: ["session"],
  move_cursor: ["x", "y"],
};

const READ_ONLY_NATIVE_TOOLS = new Set(["list_windows", "get_window_state", "verify_state", "health_report", "get_agent_cursor_state"]);

function bounded(value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const marker = "\n[cua observation truncated]";
  const source = Buffer.from(value, "utf8");
  return `${source.subarray(0, Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"))).toString("utf8")}${marker}`;
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CuaEnvironmentError("driver-failure", "Computer use was cancelled before the native operation started.");
}

function waitForNativeWindowPoll(signal: AbortSignal | undefined, cancellationMessage: string): Promise<void> {
  abortIfRequested(signal);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (cancelled: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (cancelled) reject(new CuaEnvironmentError("driver-failure", cancellationMessage));
      else resolve();
    };
    const onAbort = (): void => finish(true);
    const timer = setTimeout(() => finish(false), NATIVE_WINDOW_READY_POLL_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    // Abort can race with listener registration. Recheck after subscribing.
    if (signal?.aborted) onAbort();
  });
}

function assertCodeOwnedApplicationInstalled(application: NonNullable<CuaEnvironmentOptions["application"]>, required: boolean): void {
  if (!required || !application.launchPath) return;
  try {
    accessSync(application.launchPath, fsConstants.X_OK);
  } catch (error) {
    throw new CuaEnvironmentError("unavailable", `The code-owned native application '${application.name ?? application.launchPath}' is not installed at its approved launch path.`, { cause: error });
  }
}

function asyncOptions(signal?: AbortSignal): { readonly signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    const inner = record.inner;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const detail = inner as Record<string, unknown>;
      if (typeof detail.message === "string" && detail.message.length > 0) {
        return detail.errorCode && typeof detail.errorCode === "string"
          ? `${detail.message.slice(0, 900)} (${detail.errorCode.slice(0, 128)})`
          : detail.message.slice(0, 1_000);
      }
    }
  }
  return error instanceof Error ? error.message.slice(0, 1_000) : "The CUA driver rejected the operation.";
}

/**
 * A launch PID comes from Cua, so checking that exact PID is useful lifecycle
 * evidence. This is only used for a driver-created production process; fake
 * drivers intentionally keep their synthetic PIDs opaque to the host.
 */
function nativeProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function toolResultDetail(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.structuredJson === "string") {
    try {
      const parsed = JSON.parse(record.structuredJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const refusal = (parsed as Record<string, unknown>).refusal;
        if (refusal && typeof refusal === "object" && !Array.isArray(refusal)) {
          const detail = refusal as Record<string, unknown>;
          const code = typeof detail.code === "string" ? detail.code.slice(0, 128) : undefined;
          const message = typeof detail.message === "string" ? detail.message.slice(0, 900) : undefined;
          if (code || message) return [code, message].filter(Boolean).join(": ");
        }
      }
    } catch {
      // The bounded text fallback below still preserves a useful refusal reason.
    }
  }
  return typeof record.text === "string" && record.text.trim().length > 0
    ? record.text.trim().slice(0, 1_000)
    : undefined;
}

function hasObjectInputSchema(record: Record<string, unknown> | undefined): record is Record<string, unknown> & { readonly inputSchema: Record<string, unknown> } {
  const schema = record?.inputSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const value = schema as Record<string, unknown>;
  return value.type === "object"
    && !!value.properties && typeof value.properties === "object" && !Array.isArray(value.properties);
}

/**
 * Cua owns visual perception. Lina may consume that route only when one
 * inventory advertises both the registered-capture parser and a click schema
 * that can bind the input to the exact capture. Presence of either half alone
 * is not enough to prevent stale or unbound pixel input.
 */
function nativeVisualRegionCapability(records: ReadonlyMap<string, Record<string, unknown>>): "available" | "unavailable" {
  const parser = records.get("parse_visual_regions");
  const click = records.get("click");
  if (!hasObjectInputSchema(parser) || !hasObjectInputSchema(click)) return "unavailable";
  const parserProperties = parser.inputSchema.properties as Record<string, unknown>;
  const clickProperties = click.inputSchema.properties as Record<string, unknown>;
  return "capture_id" in parserProperties && "capture_id" in clickProperties ? "available" : "unavailable";
}

async function assertNativeCapabilities(driver: CuaDriverClient, required: boolean): Promise<ComputerRuntimeEvidence | undefined> {
  if (!required) return undefined;
  if (!driver.listToolsJson) {
    throw new CuaEnvironmentError("driver-failure", "CUA native runtime cannot prove its capability inventory before task approval.");
  }
  let raw: string;
  try {
    raw = await driver.listToolsJson();
  } catch (error) {
    throw new CuaEnvironmentError("driver-failure", "CUA capability discovery failed.", { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CuaEnvironmentError("driver-failure", "CUA capability discovery returned malformed JSON.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CuaEnvironmentError("driver-failure", "CUA capability discovery returned an invalid inventory.");
  }
  const inventory = parsed as Record<string, unknown>;
  if (inventory.schema_version !== "1") {
    throw new CuaEnvironmentError("driver-failure", "CUA native capability discovery returned an unsupported schema version.");
  }
  const capabilityVersion = typeof inventory.capability_version === "string" && inventory.capability_version.length <= 64
    ? inventory.capability_version
    : undefined;
  const tools = inventory.tools;
  const records = new Map<string, Record<string, unknown>>();
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
      const value = tool as Record<string, unknown>;
      const name = value.name;
      if (typeof name === "string" && name.length > 0 && name.length <= 128 && !records.has(name)) records.set(name, value);
    }
  }
  const names = new Set(records.keys());
  const missing = REQUIRED_NATIVE_TOOLS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new CuaEnvironmentError("driver-failure", `CUA native runtime is missing required operations: ${missing.join(", ")}.`);
  }
  for (const name of REQUIRED_NATIVE_TOOLS) {
    const schema = records.get(name)?.inputSchema;
    if (!schema || typeof schema !== "object" || Array.isArray(schema) || (schema as Record<string, unknown>).type !== "object") {
      throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' did not expose a bounded object input schema.`);
    }
    if (Buffer.byteLength(stableStringify(schema), "utf8") > 64 * 1024) {
      throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' exposed an oversized input schema.`);
    }
    const properties = (schema as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' did not expose an input property map.`);
    }
    const missingProperties = (REQUIRED_NATIVE_SCHEMA_PROPERTIES[name] ?? []).filter((property) => !(property in properties));
    if (missingProperties.length > 0) {
      throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' is missing schema properties: ${missingProperties.join(", ")}.`);
    }
    const requiredFields = (schema as Record<string, unknown>).required;
    if (requiredFields !== undefined && (!Array.isArray(requiredFields) || requiredFields.some((field) => typeof field !== "string" || !(field in properties)))) {
      throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' exposed an invalid required-field declaration.`);
    }
    const expectedRequired = REQUIRED_NATIVE_SCHEMA_FIELDS[name] ?? [];
    if (expectedRequired.length > 0 && Array.isArray(requiredFields)) {
      const declared = new Set(requiredFields.filter((field): field is string => typeof field === "string"));
      const missingRequired = expectedRequired.filter((field) => !declared.has(field));
      if (missingRequired.length > 0) throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' does not require fields: ${missingRequired.join(", ")}.`);
    }
    const annotations = records.get(name)?.annotations;
    if (annotations !== undefined) {
      if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' exposed invalid annotations.`);
      const readOnlyHint = (annotations as Record<string, unknown>).readOnlyHint;
      if (readOnlyHint !== undefined && readOnlyHint !== READ_ONLY_NATIVE_TOOLS.has(name)) {
        throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' exposed an unsafe readOnlyHint annotation.`);
      }
      const idempotentHint = (annotations as Record<string, unknown>).idempotentHint;
      if (idempotentHint !== undefined && typeof idempotentHint !== "boolean") throw new CuaEnvironmentError("driver-failure", `CUA native operation '${name}' exposed an invalid idempotentHint annotation.`);
    }
  }
  const evidence: ComputerRuntimeEvidence = {
    provider: "cua",
    schemaVersion: "1",
    ...(capabilityVersion ? { capabilityVersion } : {}),
    capabilityFingerprint: createHash("sha256").update(stableStringify({
      required: REQUIRED_NATIVE_TOOLS.map((name) => ({ name, inputSchema: records.get(name)?.inputSchema })),
      visualRegionCapability: nativeVisualRegionCapability(records),
    }), "utf8").digest("hex"),
    requiredOperations: [...REQUIRED_NATIVE_TOOLS],
    visualRegionCapability: nativeVisualRegionCapability(records),
  };
  return addCuaRuntimeIdentity(evidence, await readCuaRuntimeIdentity(driver));
}

function assertNativeAdapterMethods(driver: CuaDriverClient, required: boolean): void {
  if (!required) return;
  const missing = [
    ["list_windows", driver.listWindows],
    ["get_window_state", driver.getWindowState],
    ["verify_state", driver.verifyState],
    ["move_cursor", driver.moveCursor],
  ].filter(([, method]) => typeof method !== "function").map(([name]) => name);
  if (missing.length > 0) {
    throw new CuaEnvironmentError("driver-failure", `CUA native SDK adapter is missing callable methods for: ${missing.join(", ")}.`);
  }
}

async function assertNativeHealth(driver: CuaDriverClient, required: boolean): Promise<void> {
  if (!required) return;
  if (!driver.listToolsJson || !driver.callTool) {
    throw new CuaEnvironmentError("driver-failure", "CUA native runtime cannot prove its health before task approval.");
  }
  let result: ToolResult;
  try {
    result = await callNativeTool(driver, "health_report", "{}");
  } catch (error) {
    throw new CuaEnvironmentError("driver-failure", "CUA native health checks failed.", { cause: error });
  }
  if (result.isError) throw new CuaEnvironmentError("driver-failure", "CUA native health checks failed.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.structuredJson ?? "");
  } catch (error) {
    throw new CuaEnvironmentError("driver-failure", "CUA native health checks returned malformed JSON.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CuaEnvironmentError("driver-failure", "CUA native health checks returned an invalid report.");
  }
  const health = parsed as Record<string, unknown>;
  const problem = cuaLinuxHealthProblem(health);
  if (problem) throw new CuaEnvironmentError("driver-failure", `CUA native health checks did not pass: ${problem}.`);
}

function actionResultStatus(effect: unknown, sdk: CuaSdk | undefined): ComputerEnvironmentResult["status"] {
  if (effect === "Refused" || (sdk && effect === sdk.ActionEffect.Refused)) return "refused";
  if (effect === "Partial" || effect === "Unverifiable" || effect === "SuspectedNoop" || (sdk && (effect === sdk.ActionEffect.Partial || effect === sdk.ActionEffect.Unverifiable || effect === sdk.ActionEffect.SuspectedNoop))) return "unknown";
  return "completed";
}

export function inspectCuaReadiness(input: {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
} = {}): ComputerEnvironmentReadiness {
  const platform = input.platform ?? process.platform;
  const environment = input.environment ?? process.env;
  const display = environment.DISPLAY?.trim();
  const isolated = environment.LINA_COMPUTER_CUA_ISOLATED_DISPLAY === "true";
  if (platform !== "linux") {
    return { kind: "ubuntu-x11-cua", available: false, isolated, reason: "linux-only" };
  }
  if (!display) {
    return { kind: "ubuntu-x11-cua", available: false, isolated, reason: "x11-display-not-set" };
  }
  if (!isolated) {
    return { kind: "ubuntu-x11-cua", available: false, display, isolated, reason: "isolated-display-required" };
  }
  return { kind: "ubuntu-x11-cua", available: true, display, isolated };
}

function createFallbackTarget(displayId: string, observation?: ComputerEnvironmentObservation, positionKind?: "coordinates" | "element", captureScope: "desktop" | "window" = "desktop"): unknown {
  if ((captureScope === "window" || positionKind !== "coordinates") && observation?.windowPid !== undefined && observation.windowId !== undefined) {
    return { tag: "Window", inner: { pid: observation.windowPid, windowId: BigInt(observation.windowId) } };
  }
  return { tag: "Desktop", inner: { displayId } };
}

function createFallbackPosition(position: NonNullable<ComputerEnvironmentAction["position"]>): unknown {
  if (position.kind === "coordinates") return { tag: "Coordinates", inner: { x: position.x, y: position.y } };
  return { tag: "Element", inner: { elementToken: position.token } };
}

function createFallbackInput(action: ComputerEnvironmentAction, sessionId: string, displayId: string, observation?: ComputerEnvironmentObservation, captureScope: "desktop" | "window" = "desktop"): unknown {
  return {
    target: createFallbackTarget(displayId, observation, action.position?.kind, captureScope),
    ...(action.position ? { position: createFallbackPosition(action.position) } : {}),
    deliveryMode: action.position?.kind === "element" ? "Background" : "Foreground",
    session: sessionId,
    button: "Left",
    count: 1,
  };
}

function resultStatus(result: unknown, sdk: CuaSdk | undefined): ComputerEnvironmentResult["status"] {
  if (result && typeof result === "object" && "effect" in result) {
    return actionResultStatus((result as ActionResult).effect, sdk);
  }
  const toolResult = result as ToolResult;
  if (toolResult.action) return actionResultStatus(toolResult.action.effect, sdk);
  return toolResult.isError ? "refused" : "completed";
}

function scrollDirection(sdk: CuaSdk, direction: ComputerScrollDirection): CuaScrollDirection {
  return {
    up: sdk.ScrollDirection.Up,
    down: sdk.ScrollDirection.Down,
    left: sdk.ScrollDirection.Left,
    right: sdk.ScrollDirection.Right,
  }[direction] as unknown as CuaScrollDirection;
}

function imageBytes(result: ToolResult): number {
  return result.images.reduce((total, image) => total + Buffer.byteLength(image.dataBase64, "utf8"), 0);
}

function windowImageBytes(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, image) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) return total;
    const dataBase64 = (image as Record<string, unknown>).dataBase64;
    return typeof dataBase64 === "string" ? total + Buffer.byteLength(dataBase64, "utf8") : total;
  }, 0);
}

function desktopMetadata(value: string | undefined): {
  readonly display?: string;
  readonly screenWidth?: number;
  readonly screenHeight?: number;
  readonly scaleFactor?: number;
} {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const numberValue = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const candidate = record[key];
        if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return candidate;
      }
      return undefined;
    };
    const display = typeof record.display === "string" && record.display.length <= 128 ? record.display : undefined;
    return {
      ...(display ? { display } : {}),
      ...(numberValue("screen_width", "screenWidth") !== undefined ? { screenWidth: numberValue("screen_width", "screenWidth") } : {}),
      ...(numberValue("screen_height", "screenHeight") !== undefined ? { screenHeight: numberValue("screen_height", "screenHeight") } : {}),
      ...(numberValue("scale_factor", "scaleFactor") !== undefined ? { scaleFactor: numberValue("scale_factor", "scaleFactor") } : {}),
    };
  } catch {
    return {};
  }
}

function cursorMetadata(value: string | undefined): { readonly cursorX?: number; readonly cursorY?: number } {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const position = record.position && typeof record.position === "object" && !Array.isArray(record.position)
      ? record.position as Record<string, unknown>
      : record;
    const x = position.x;
    const y = position.y;
    return typeof x === "number" && Number.isFinite(x) && x >= 0 && typeof y === "number" && Number.isFinite(y) && y >= 0
      ? { cursorX: x, cursorY: y }
      : {};
  } catch {
    return {};
  }
}

type AccessibilityWindow = {
  readonly pid: number;
  readonly windowId: string;
  readonly snapshotId?: string;
  readonly appName?: string;
  readonly windowTitle?: string;
  readonly windowBounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly elements: readonly Record<string, unknown>[];
};

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function safeElementIndex(value: unknown): number | undefined {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function normalizedWindowBounds(value: unknown): AccessibilityWindow["windowBounds"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const bounds = value as Record<string, unknown>;
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  const [x, y, width, height] = values as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function nativeAgentCursorTargets(value: unknown): Map<string, { readonly x: number; readonly y: number }> {
  const targets = new Map<string, { readonly x: number; readonly y: number }>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return targets;
  const record = value as Record<string, unknown>;
  const bounds = normalizedWindowBounds(record.window_bounds ?? record.windowBounds);
  if (!bounds || !Array.isArray(record.elements)) return targets;

  // Cua Linux AT-SPI element frames and its synthetic agent cursor both use
  // absolute display coordinates. Do not reuse screenshot-normalized frames:
  // those are window-local and only valid for window input coordinates.
  for (const raw of record.elements) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const element = raw as Record<string, unknown>;
    const token = stringValue(element.elementToken ?? element.element_token, 256);
    const frame = normalizedElementFrame(element.frame, undefined);
    if (!token || !frame) continue;
    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height / 2;
    if (centerX < bounds.x || centerX >= bounds.x + bounds.width
      || centerY < bounds.y || centerY >= bounds.y + bounds.height) continue;
    targets.set(token, { x: centerX, y: centerY });
  }
  return targets;
}

function normalizedElementFrame(
  value: unknown,
  windowBounds: AccessibilityWindow["windowBounds"],
  screenshotWidth?: number,
  screenshotHeight?: number,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const frame = value as Record<string, unknown>;
  const frameX = frame.x;
  const frameY = frame.y;
  const frameWidth = frame.width ?? frame.w;
  const frameHeight = frame.height ?? frame.h;
  const values = [frameX, frameY, frameWidth, frameHeight];
  if (values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  const [x, y, width, height] = values as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  if (!windowBounds || screenshotWidth === undefined || screenshotHeight === undefined) {
    return { x, y, width, height };
  }

  // Linux AT-SPI reports element bounds in display coordinates, while
  // get_window_state returns a screenshot cropped to the window content. The
  // bottom-aligned crop accounts for title bars/decorations; the same scale is
  // applied to bounds when CUA downsizes the screenshot.
  const pixelScale = screenshotWidth / windowBounds.width;
  if (!Number.isFinite(pixelScale) || pixelScale <= 0) return undefined;
  const captureHeightInScreenUnits = screenshotHeight / pixelScale;
  const originX = windowBounds.x;
  const originY = windowBounds.y + Math.max(0, windowBounds.height - captureHeightInScreenUnits);
  return {
    x: (x - originX) * pixelScale,
    y: (y - originY) * pixelScale,
    width: width * pixelScale,
    height: height * pixelScale,
  };
}

function normalizedAccessibilityWindow(value: unknown, screenshotWidth?: number, screenshotHeight?: number): AccessibilityWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pid = finiteInteger(record.pid);
  const windowId = typeof record.windowId === "bigint"
    ? record.windowId.toString()
    : stringValue(record.windowId, 128);
  const windowBounds = normalizedWindowBounds(record.window_bounds ?? record.windowBounds);
  const rawElements = Array.isArray(record.elements) ? record.elements : [];
  if (pid === undefined || !windowId) return undefined;
  const elements = rawElements.slice(0, 256).flatMap((raw): Record<string, unknown>[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const element = raw as Record<string, unknown>;
    const token = stringValue(element.elementToken, 256);
    const role = stringValue(element.role, 64);
    if (!token || !role) return [];
    const label = stringValue(element.label, 512);
    const actions = Array.isArray(element.actions)
      ? element.actions.filter((action): action is string => typeof action === "string" && action.length <= 64).slice(0, 16)
      : [];
    const normalizedFrame = normalizedElementFrame(element.frame, windowBounds, screenshotWidth, screenshotHeight);
    return [{
      elementToken: token,
      role,
      ...(label ? { label } : {}),
      ...(typeof element.value === "string" && element.value.length <= 4_096 ? { value: element.value } : {}),
      ...(typeof element.text === "string" && element.text.length <= 4_096 ? { text: element.text } : {}),
      ...(typeof element.description === "string" && element.description.length <= 4_096 ? { description: element.description } : {}),
      ...(typeof element.enabled === "boolean" ? { enabled: element.enabled } : {}),
      ...(typeof element.editable === "boolean" ? { editable: element.editable } : {}),
      ...(typeof element.password === "boolean" ? { password: element.password } : {}),
      ...(typeof element.credential === "boolean" ? { credential: element.credential } : {}),
      ...(typeof element.sensitive === "boolean" ? { sensitive: element.sensitive } : {}),
      ...(typeof element.hidden === "boolean" ? { hidden: element.hidden } : {}),
      ...(typeof element.visible === "boolean" ? { visible: element.visible } : {}),
      ...(typeof element.occluded === "boolean" ? { occluded: element.occluded } : {}),
      ...(typeof element.focusable === "boolean" ? { focusable: element.focusable } : {}),
      ...(typeof element.focused === "boolean" ? { focused: element.focused } : {}),
      ...(typeof element.selected === "boolean" ? { selected: element.selected } : {}),
      ...(typeof element.checked === "boolean" ? { checked: element.checked } : {}),
      ...(safeElementIndex(element.elementIndex ?? element.element_index) !== undefined
        ? { elementIndex: safeElementIndex(element.elementIndex ?? element.element_index) }
        : {}),
      ...(safeElementIndex(element.parentIndex ?? element.parent_index) !== undefined
        ? { parentIndex: safeElementIndex(element.parentIndex ?? element.parent_index) }
        : {}),
      ...(actions.length > 0 ? { actions } : {}),
      ...(normalizedFrame ? { frame: normalizedFrame } : {}),
    }];
  });
  return {
    pid,
    windowId,
    ...(stringValue(record.snapshotId, 256) ? { snapshotId: stringValue(record.snapshotId, 256) } : {}),
    ...(stringValue(record.appName, 128) ? { appName: stringValue(record.appName, 128) } : {}),
    ...(stringValue(record.windowTitle, 512) ? { windowTitle: stringValue(record.windowTitle, 512) } : {}),
    ...(windowBounds ? { windowBounds } : {}),
    elements,
  };
}

function topAccessibleWindow(value: unknown, expectedPid?: number, expectedWindowId?: bigint): { readonly pid: number; readonly windowId: bigint; readonly appName?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const windows = (value as Record<string, unknown>).windows;
  if (!Array.isArray(windows)) return undefined;
  const visible = windows.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const window = raw as Record<string, unknown>;
    const bounds = window.bounds;
    const boundRecord = bounds && typeof bounds === "object" && !Array.isArray(bounds)
      ? bounds as Record<string, unknown>
      : undefined;
    return window.isOnScreen === true && window.minimized !== true && finiteInteger(window.pid) !== undefined
      && (expectedPid === undefined || window.pid === expectedPid)
      && (expectedWindowId === undefined || window.windowId === expectedWindowId)
      && typeof window.windowId === "bigint"
      && boundRecord !== undefined
      && typeof boundRecord.width === "number" && boundRecord.width > 0
      && typeof boundRecord.height === "number" && boundRecord.height > 0;
  }) as Record<string, unknown>[];
  if (visible.length === 0) return undefined;
  if (expectedWindowId !== undefined) return visible.length === 1
    ? { pid: finiteInteger(visible[0]!.pid)!, windowId: visible[0]!.windowId as bigint, ...(stringValue(visible[0]!.appName, 128) ? { appName: stringValue(visible[0]!.appName, 128) } : {}) }
    : undefined;
  if (expectedPid !== undefined && visible.length !== 1) return undefined;
  if (visible.length === 1) {
    return { pid: finiteInteger(visible[0]!.pid)!, windowId: visible[0]!.windowId as bigint, ...(stringValue(visible[0]!.appName, 128) ? { appName: stringValue(visible[0]!.appName, 128) } : {}) };
  }
  const ranked = visible.filter((window) => typeof window.zIndex === "bigint");
  if (ranked.length !== visible.length) return undefined;
  ranked.sort((left, right) => Number((right.zIndex as bigint) - (left.zIndex as bigint)));
  if (ranked.length > 1 && ranked[0]!.zIndex === ranked[1]!.zIndex) return undefined;
  return { pid: finiteInteger(ranked[0]!.pid)!, windowId: ranked[0]!.windowId as bigint, ...(stringValue(ranked[0]!.appName, 128) ? { appName: stringValue(ranked[0]!.appName, 128) } : {}) };
}

type VisibleWindowIdentity = { readonly pid: number; readonly windowId: bigint; readonly appName?: string };

function nativeWindowId(value: unknown): bigint | undefined {
  const max = (1n << 64n) - 1n;
  let parsed: bigint | undefined;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^\d{1,20}$/u.test(value)) {
    try {
      parsed = BigInt(value);
    } catch {
      return undefined;
    }
  }
  return parsed !== undefined && parsed > 0n && parsed <= max ? parsed : undefined;
}

function visibleWindowIdentities(value: unknown): readonly VisibleWindowIdentity[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const windows = (value as Record<string, unknown>).windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((raw): VisibleWindowIdentity[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const window = raw as Record<string, unknown>;
    const pid = finiteInteger(window.pid);
    const windowId = nativeWindowId(window.windowId ?? window.window_id);
    const bounds = window.bounds;
    const boundRecord = bounds && typeof bounds === "object" && !Array.isArray(bounds)
      ? bounds as Record<string, unknown>
      : undefined;
    const onScreen = window.isOnScreen ?? window.is_on_screen;
    if (pid === undefined || windowId === undefined || onScreen !== true
      || window.minimized === true || window.is_minimized === true
      || boundRecord === undefined || typeof boundRecord.width !== "number" || boundRecord.width <= 0
      || typeof boundRecord.height !== "number" || boundRecord.height <= 0) return [];
    const appName = stringValue(window.appName ?? window.app_name, 128);
    return [{ pid, windowId, ...(appName ? { appName } : {}) }];
  });
}

function launchAcknowledgementMayBeLost(value: unknown): boolean {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const message = [
    errorMessage(value),
    typeof record?.text === "string" ? record.text : "",
    typeof record?.errorCode === "string" ? record.errorCode : "",
  ].join(" ");
  return /\b(?:acknowledg(?:e|ement)|timeout|timed\s+out|connection|disconnected|transport|stream)\b/iu.test(message);
}

function launchResultFromTool(value: ToolResult): { readonly pid?: number; readonly windows: readonly VisibleWindowIdentity[] } {
  if (!value.structuredJson) return { windows: [] };
  try {
    const parsed: unknown = JSON.parse(value.structuredJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { windows: [] };
    const record = parsed as Record<string, unknown>;
    const pid = finiteInteger(record.pid);
    return {
      ...(pid !== undefined && pid > 0 ? { pid } : {}),
      windows: visibleWindowIdentities(record),
    };
  } catch {
    return { windows: [] };
  }
}

function nativeApplicationMatches(expected: string | undefined, observed: string | undefined): boolean {
  if (!expected || !observed) return false;
  // Cua exposes WM_CLASS-style identities on Linux (for example
  // `gnome-text-editor`) and human-readable identities on other hosts. Treat
  // only the separators in this code-owned application vocabulary as
  // equivalent; do not broaden matching to arbitrary substring heuristics.
  const normalizeIdentity = (value: string): string => value.trim().toLocaleLowerCase().replace(/[\s_-]+/gu, " ");
  const normalizedExpected = normalizeIdentity(expected);
  const normalizedObserved = normalizeIdentity(observed);
  const aliases: Readonly<Record<string, RegExp>> = {
    notes: /\b(?:notes?|text editor|gnome text editor)\b/iu,
    "text editor": /\b(?:notes?|text editor|gnome text editor)\b/iu,
    calendar: /\b(?:calendar|gnome calendar)\b/iu,
    clocks: /\b(?:clocks?|gnome clocks)\b/iu,
    calculator: /\b(?:calculator|gnome calculator)\b/iu,
    settings: /\b(?:settings?|system settings?|gnome control center)\b/iu,
  };
  const alias = aliases[normalizedExpected];
  return alias ? alias.test(normalizedObserved) : normalizedExpected === normalizedObserved;
}

function observedElementToken(observation: ComputerEnvironmentObservation, token: string): boolean {
  if (!observation.structuredJson) return false;
  try {
    const parsed: unknown = JSON.parse(observation.structuredJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const accessibility = (parsed as Record<string, unknown>).accessibility;
    if (!accessibility || typeof accessibility !== "object" || Array.isArray(accessibility)) return false;
    const elements = (accessibility as Record<string, unknown>).elements;
    return Array.isArray(elements) && elements.some((element) => element && typeof element === "object" && !Array.isArray(element) && (element as Record<string, unknown>).elementToken === token);
  } catch {
    return false;
  }
}

/**
 * Native Ubuntu/X11 adapter backed by Cua Driver's in-process TypeScript SDK.
 *
 * This class accepts one typed native action per fresh observation. It does not
 * start a daemon, use CUA's MCP CLI, attach to a display without an explicit
 * isolation marker, or retry a possibly-delivered input after the driver reports
 * an error.
 */
export class CuaEnvironment implements ComputerEnvironment {
  readonly kind = "ubuntu-x11-cua" as const;
  readonly sessionId: string;

  private readonly options: Required<Pick<CuaEnvironmentOptions, "displayId" | "captureScope" | "maxObservationBytes" | "maxCoordinate">> & CuaEnvironmentOptions;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly ownsDriver: boolean;
  /** Application-lifetime runtime; used for preflight and owner shutdown. */
  private runtimeDriver: CuaDriverClient | undefined;
  /** Task-bound session client; every operation after start goes through it. */
  private driver: CuaDriverClient | undefined;
  private taskSessionHandle: { close(): void } | undefined;
  private sdk: CuaSdk | undefined;
  private started = false;
  private closed = false;
  private generation = 0;
  private currentObservation: ComputerEnvironmentObservation | undefined;
  private currentAgentCursorTargets = new Map<string, { readonly x: number; readonly y: number }>();
  private consumedObservationId: string | undefined;
  private applicationPid: number | undefined;
  private boundWindowId: bigint | undefined;
  private capabilityEvidence: ComputerRuntimeEvidence | undefined;

  constructor(options: CuaEnvironmentOptions = {}) {
    this.sessionId = options.sessionId ?? `lina-cua-${randomUUID()}`;
    this.environment = options.environment ?? process.env;
    this.options = {
      ...options,
      displayId: options.displayId ?? "primary",
      captureScope: options.captureScope ?? (options.application ? "window" : "desktop"),
      maxObservationBytes: options.maxObservationBytes ?? DEFAULT_MAX_OBSERVATION_BYTES,
      maxCoordinate: options.maxCoordinate ?? DEFAULT_MAX_COORDINATE,
    };
    this.runtimeDriver = options.driver;
    this.driver = options.driver;
    this.ownsDriver = options.shutdownDriver ?? true;
  }

  readiness(): ComputerEnvironmentReadiness {
    return inspectCuaReadiness({ platform: this.options.platform, environment: this.environment });
  }

  /**
   * Checks the host, immutable native capability inventory, and Cua health
   * without opening a session or launching an application. Callers can use it
   * before task approval. Injected deterministic fakes remain intentionally
   * exempt unless they opt into production mode.
   */
  async preflight(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness> {
    abortIfRequested(signal);
    if (this.closed) throw new CuaEnvironmentError("already-closed", "The CUA environment has already been closed.");
    const readiness = this.readiness();
    if (!readiness.available) throw new CuaEnvironmentError("unavailable", `CUA is unavailable: ${readiness.reason ?? "host is not ready"}.`);
    try {
      const driver = await this.ensureDriver();
      const required = this.options.driverMode !== "deterministic-fake"
        && (this.options.driverMode === "production" || !this.options.driver || productionDrivers.has(driver));
      this.capabilityEvidence = await assertNativeCapabilities(driver, required);
      assertNativeAdapterMethods(driver, required);
      await assertNativeHealth(driver, required);
      if (this.options.application) assertCodeOwnedApplicationInstalled(this.options.application, required);
      return readiness;
    } catch (error) {
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA readiness preflight failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  runtimeEvidence(): ComputerRuntimeEvidence | undefined {
    return this.capabilityEvidence;
  }

  async start(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness> {
    abortIfRequested(signal);
    if (this.closed) throw new CuaEnvironmentError("already-closed", "The CUA environment has already been closed.");
    if (this.started) return this.readiness();
    try {
      const readiness = await this.preflight(signal);
      const runtimeDriver = await this.ensureDriver();
      if (!this.sdk && (this.options.loadSdk || this.options.driverMode === "production" || productionDrivers.has(runtimeDriver))) {
        this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
      }
      const driver = this.createTaskSession(runtimeDriver);
      this.driver = driver;
      await driver.startSession(this.input("StartSessionInput", {
        session: this.sessionId,
        // Window scope keeps screenshot pixels and coordinate actions in the
        // same local frame. Desktop scope remains available for callers that
        // explicitly need absolute display coordinates.
        captureScope: this.options.captureScope === "window"
          ? this.sdk?.CaptureScope.Window ?? "Window"
          : this.sdk?.CaptureScope.Desktop ?? "Desktop",
      }), asyncOptions(signal));
      await driver.setAgentCursorTheme(this.input("SetAgentCursorThemeInput", {
        session: this.sessionId,
        themeId: "cua.default",
        reducedMotion: this.sdk?.CursorReducedMotion.Auto ?? "Auto",
      }), asyncOptions(signal));
      await driver.setAgentCursorEnabled(this.input("SetAgentCursorEnabledInput", { session: this.sessionId, enabled: true }), asyncOptions(signal));
      this.started = true;
      if (this.options.application) {
        const launch = await this.launchApplication(this.options.application, signal);
        this.applicationPid = launch.pid;
        await this.waitForApplicationWindow(launch.windows, signal);
      }
      return readiness;
    } catch (error) {
      await this.shutdownAfterFailedStart();
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA could not start the isolated session: ${errorMessage(error)}`, { cause: error });
    }
  }

  private async ensureDriver(): Promise<CuaDriverClient> {
    if (this.runtimeDriver) return this.runtimeDriver;
    this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
    const mode = this.sdk.SessionPermissionMode.Bounded;
    this.runtimeDriver = markProductionDriver(this.sdk.CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [mode],
        compatibilityMode: mode,
        compatibilityCapabilityManifestPath: this.options.manifestPath ?? `${process.cwd()}/config/cua-native-capabilities.yaml`,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: 8n * 60n * 60n,
        maxIdleTtlSeconds: 30n * 60n,
      },
    }) as unknown as CuaDriverClient);
    this.driver = this.runtimeDriver;
    return this.runtimeDriver;
  }

  private createTaskSession(runtimeDriver: CuaDriverClient): CuaDriverClient {
    const sdk = this.sdk;
    if (!sdk || typeof sdk.createTrustedSession !== "function") {
      if (this.options.driverMode === "production" || productionDrivers.has(runtimeDriver)) {
        throw new CuaEnvironmentError("driver-failure", "The pinned CUA SDK does not expose trusted task-session binding.");
      }
      return runtimeDriver;
    }
    const bound = sdk.createTrustedSession(
      runtimeDriver as unknown as Parameters<CuaSdk["createTrustedSession"]>[0],
      sdk.TrustedSessionOptions.new({
        publicSession: this.sessionId,
        mode: sdk.SessionPermissionMode.Bounded,
        ttlSeconds: NATIVE_TASK_SESSION_TTL_SECONDS,
        idleTtlSeconds: NATIVE_TASK_SESSION_IDLE_TTL_SECONDS,
        capabilityManifestPath: this.options.manifestPath ?? `${process.cwd()}/config/cua-native-capabilities.yaml`,
      }),
    );
    this.taskSessionHandle = bound;
    const client = bound as unknown as CuaDriverClient;
    return productionDrivers.has(runtimeDriver) ? markProductionDriver(client) : client;
  }

  async observe(signal?: AbortSignal): Promise<ComputerEnvironmentObservation> {
    abortIfRequested(signal);
    this.requireStarted();
    this.currentAgentCursorTargets.clear();
    if (this.options.captureScope === "window") return this.observeWindow(signal);
    try {
      const result = await this.driver!.getDesktopState(this.input("GetDesktopStateInput", {
        session: this.sessionId,
        ...(this.options.screenshotPath ? { screenshotOutFile: this.options.screenshotPath } : {}),
      }), asyncOptions(signal)) as ToolResult;
      if (result.isError) {
        const detail = result.text.trim().slice(0, 1_000);
        throw new CuaEnvironmentError("driver-failure", `CUA observation failed${result.errorCode ? ` (${result.errorCode})` : ""}${detail ? `: ${detail}` : "."}`);
      }
      this.generation += 1;
      const metadata = desktopMetadata(result.structuredJson);
      let accessibility: AccessibilityWindow | undefined;
      if (this.driver!.listWindows && this.driver!.getWindowState) {
        try {
          const window = topAccessibleWindow(
            await this.driver!.listWindows(this.input("ListWindowsInput", {
              onScreenOnly: true,
              ...(this.applicationPid !== undefined ? { pid: this.applicationPid } : {}),
            }), asyncOptions(signal)),
            this.applicationPid,
            this.boundWindowId,
          );
          if (window) {
            if (this.options.application?.name && !nativeApplicationMatches(this.options.application.name, window.appName)) {
              throw new CuaApplicationBindingError("driver-failure", `CUA bound a '${window.appName ?? "unknown"}' window, not the approved '${this.options.application.name ?? "unknown"}' application.`);
            }
            const state = await this.driver!.getWindowState(this.input("GetWindowStateInput", {
              pid: window.pid,
              windowId: window.windowId,
              session: this.sessionId,
              includeAccessibilityTree: true,
              includeScreenshot: false,
              maxElements: 256,
              maxDepth: 16,
            }), asyncOptions(signal));
            this.currentAgentCursorTargets = nativeAgentCursorTargets(state);
            accessibility = normalizedAccessibilityWindow(state);
          }
        } catch (error) {
          if (error instanceof CuaApplicationBindingError) throw error;
          // Accessibility is an optional semantic source. Native Jev must
          // abstain when it is absent; the screenshot path remains usable.
        }
      }
      let cursor = {} as { readonly cursorX?: number; readonly cursorY?: number };
      if (this.driver!.getAgentCursorState) {
        try {
          const cursorResult = await this.driver!.getAgentCursorState(this.input("GetAgentCursorStateInput", { session: this.sessionId }), asyncOptions(signal)) as ToolResult;
          if (!cursorResult.isError) cursor = cursorMetadata(cursorResult.structuredJson);
        } catch {
          // Cursor metadata is diagnostic evidence; a cursor-state query must not
          // make an otherwise valid desktop observation unusable.
        }
      }
      let desktopStructured: unknown;
      try {
        desktopStructured = result.structuredJson ? JSON.parse(result.structuredJson) : undefined;
      } catch {
        desktopStructured = undefined;
      }
      const structured = JSON.stringify({
        ...(desktopStructured === undefined ? {} : { desktop: desktopStructured }),
        ...(accessibility ? { accessibility } : {}),
      });
      const observation: ComputerEnvironmentObservation = {
        observationId: randomUUID(),
        environment: this.kind,
        sessionId: this.sessionId,
        generation: this.generation,
        text: bounded(result.text, this.options.maxObservationBytes) ?? "",
        ...(bounded(structured, this.options.maxObservationBytes) ? { structuredJson: bounded(structured, this.options.maxObservationBytes) } : {}),
        imageCount: result.images.length,
        imageBytes: imageBytes(result),
        ...metadata,
        ...cursor,
        ...(accessibility ? { windowPid: accessibility.pid, windowId: accessibility.windowId, ...(accessibility.snapshotId ? { windowSnapshotId: accessibility.snapshotId } : {}) } : {}),
        ...(this.options.screenshotPath ? { screenshotPath: this.options.screenshotPath } : {}),
      };
      this.currentObservation = observation;
      this.consumedObservationId = undefined;
      return observation;
    } catch (error) {
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA observation failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  /**
   * Use Cua's bounded, exact-window verifier as an additional proof layer.
   * Lina still runs its application-specific verifier over the fresh
   * observation; a Cua `unknown` or unstable result can never be upgraded to
   * success by that projection.
   */
  async verify(spec: ComputerVerificationSpec, observation: ComputerEnvironmentObservation, signal?: AbortSignal): Promise<ComputerEnvironmentVerification | undefined> {
    abortIfRequested(signal);
    this.requireStarted();
    if (!this.currentObservation
      || observation.observationId !== this.currentObservation.observationId
      || observation.generation !== this.currentObservation.generation
      || observation.sessionId !== this.sessionId) {
      throw new CuaEnvironmentError("stale-observation", "CUA verify_state requires the latest observation from this native session.");
    }
    const predicates = this.verificationPredicates(spec);
    if (predicates.length === 0) {
      return undefined;
    }
    if (observation.windowPid === undefined || observation.windowId === undefined) {
      return { status: "unknown", summary: "Cua verify_state requires the exact observed native PID and window identity.", evidence: { cuaStatus: "missing-binding" } };
    }
    if (!this.driver?.verifyState) {
      return { status: "unknown", summary: "The configured Cua driver cannot provide verify_state.", evidence: { cuaStatus: "unavailable" } };
    }
    let result: unknown;
    try {
      result = await this.driver.verifyState(this.input("VerifyStateInput", {
        pid: BigInt(observation.windowPid),
        windowId: BigInt(observation.windowId),
        expect: predicates,
        session: this.sessionId,
        timeoutMs: 5_000n,
        stableSamples: 2n,
        includeScreenshot: false,
      }), asyncOptions(signal));
    } catch (error) {
      throw new CuaEnvironmentError("driver-failure", `CUA verify_state failed: ${errorMessage(error)}`, { cause: error });
    }
    const record = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
    if (record.isError === true) {
      return { status: "unknown", summary: "CUA verify_state refused the native postcondition.", evidence: { cuaStatus: "refused" } };
    }
    let structured: unknown = record.structuredJson;
    if (typeof structured === "string") {
      try {
        structured = JSON.parse(structured);
      } catch {
        structured = undefined;
      }
    }
    const output = structured && typeof structured === "object" && !Array.isArray(structured) ? structured as Record<string, unknown> : record;
    const rawStatus = output.status;
    const status = rawStatus === 0 || rawStatus === "Satisfied" || rawStatus === "satisfied" ? "satisfied"
      : rawStatus === 1 || rawStatus === "Unsatisfied" || rawStatus === "unsatisfied" ? "unsatisfied"
        : "unknown";
    const stable = output.stable === true;
    const samples = typeof output.samples === "number" || typeof output.samples === "string" || typeof output.samples === "bigint"
      ? String(output.samples)
      : "unknown";
    const evidence = { cuaStatus: status, cuaStable: String(stable), cuaSamples: samples };
    if (status === "satisfied" && stable) return { status: "verified", summary: "Cua verify_state satisfied the exact native predicates with stable samples.", evidence };
    if (status === "unsatisfied") return { status: "unsatisfied", summary: "Cua verify_state found that the native postcondition is not satisfied.", evidence };
    return { status: "unknown", summary: "Cua verify_state could not prove the native postcondition.", evidence };
  }

  private async observeWindow(signal?: AbortSignal): Promise<ComputerEnvironmentObservation> {
    try {
      if (!this.driver!.listWindows || !this.driver!.getWindowState) {
        throw new CuaEnvironmentError("driver-failure", "CUA window observations are unavailable in this driver adapter.");
      }
      this.ensureApplicationProcessAlive();
      const window = topAccessibleWindow(
        await this.driver!.listWindows(this.input("ListWindowsInput", {
          onScreenOnly: true,
          ...(this.applicationPid !== undefined ? { pid: this.applicationPid } : {}),
        }), asyncOptions(signal)),
        this.applicationPid,
        this.boundWindowId,
      );
      if (!window) {
        this.generation += 1;
        const observation: ComputerEnvironmentObservation = {
          observationId: randomUUID(),
          environment: this.kind,
          sessionId: this.sessionId,
          generation: this.generation,
          text: "CUA did not expose one unambiguous visible X11 window for this observation.",
          structuredJson: JSON.stringify({ window: { candidates: 0 } }),
          imageCount: 0,
          imageBytes: 0,
        };
        this.currentAgentCursorTargets.clear();
        this.currentObservation = observation;
        this.consumedObservationId = undefined;
        return observation;
      }
      if (this.options.application?.name && !nativeApplicationMatches(this.options.application.name, window.appName)) {
        throw new CuaEnvironmentError("driver-failure", `CUA bound a '${window.appName ?? "unknown"}' window, not the approved '${this.options.application.name ?? "unknown"}' application.`);
      }
      const state = await this.driver!.getWindowState(this.input("GetWindowStateInput", {
        pid: window.pid,
        windowId: window.windowId,
        session: this.sessionId,
        includeAccessibilityTree: true,
        includeScreenshot: true,
        ...(this.options.screenshotPath ? { screenshotOutFile: this.options.screenshotPath } : {}),
        maxElements: 256,
        maxDepth: 16,
      }), asyncOptions(signal));
      const stateRecord = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
      this.currentAgentCursorTargets = nativeAgentCursorTargets(state);
      this.generation += 1;
      const snapshotId = stringValue(stateRecord.snapshotId, 256);
      const appName = stringValue(stateRecord.appName, 128);
      const windowTitle = stringValue(stateRecord.windowTitle, 512);
      const treeMarkdown = typeof stateRecord.treeMarkdown === "string" ? stateRecord.treeMarkdown : "";
      const screenshotWidth = typeof stateRecord.screenshotWidth === "number" && Number.isFinite(stateRecord.screenshotWidth) && stateRecord.screenshotWidth > 0 ? stateRecord.screenshotWidth : undefined;
      const screenshotHeight = typeof stateRecord.screenshotHeight === "number" && Number.isFinite(stateRecord.screenshotHeight) && stateRecord.screenshotHeight > 0 ? stateRecord.screenshotHeight : undefined;
      const scaleFactor = typeof stateRecord.screenshotScale === "number" && Number.isFinite(stateRecord.screenshotScale) && stateRecord.screenshotScale > 0 ? stateRecord.screenshotScale : undefined;
      const accessibility = normalizedAccessibilityWindow(state, screenshotWidth, screenshotHeight);
      const structured = JSON.stringify({
        window: {
          pid: window.pid,
          windowId: window.windowId.toString(),
          ...(snapshotId ? { snapshotId } : {}),
          ...(appName ? { appName } : {}),
          ...(windowTitle ? { windowTitle } : {}),
          ...(screenshotWidth ? { screenshotWidth } : {}),
          ...(screenshotHeight ? { screenshotHeight } : {}),
          ...(scaleFactor ? { scaleFactor } : {}),
        },
        ...(accessibility ? { accessibility } : {}),
      });
      const text = treeMarkdown || windowTitle || `CUA window observation for PID ${window.pid}.`;
      const observation: ComputerEnvironmentObservation = {
        observationId: randomUUID(),
        environment: this.kind,
        sessionId: this.sessionId,
        generation: this.generation,
        text: bounded(text, this.options.maxObservationBytes) ?? "",
        ...(bounded(structured, this.options.maxObservationBytes) ? { structuredJson: bounded(structured, this.options.maxObservationBytes) } : {}),
        imageCount: Array.isArray(stateRecord.images) ? stateRecord.images.length : 0,
        imageBytes: windowImageBytes(stateRecord.images),
        display: this.options.displayId,
        ...(screenshotWidth ? { screenWidth: screenshotWidth } : {}),
        ...(screenshotHeight ? { screenHeight: screenshotHeight } : {}),
        ...(scaleFactor ? { scaleFactor } : {}),
        windowPid: window.pid,
        windowId: window.windowId.toString(),
        ...(snapshotId ? { windowSnapshotId: snapshotId } : {}),
        ...(this.options.screenshotPath ? { screenshotPath: this.options.screenshotPath } : {}),
      };
      let cursor = {} as { readonly cursorX?: number; readonly cursorY?: number };
      if (this.driver!.getAgentCursorState) {
        try {
          const cursorResult = await this.driver!.getAgentCursorState(this.input("GetAgentCursorStateInput", { session: this.sessionId }), asyncOptions(signal)) as ToolResult;
          if (!cursorResult.isError) cursor = cursorMetadata(cursorResult.structuredJson);
        } catch {
          // Cursor metadata is diagnostic evidence; it must not make a valid
          // window observation unusable.
        }
      }
      const withCursor = { ...observation, ...cursor };
      if (this.applicationPid !== undefined) this.boundWindowId = window.windowId;
      this.currentObservation = withCursor;
      this.consumedObservationId = undefined;
      return withCursor;
    } catch (error) {
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA window observation failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  async presentAction(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<void> {
    abortIfRequested(signal);
    this.requireStarted();
    const observation = this.currentObservation;
    if (!observation || action.observationId !== observation.observationId
      || action.generation !== observation.generation
      || this.consumedObservationId === observation.observationId) {
      throw new CuaEnvironmentError("stale-observation", "Native cursor presentation requires the latest unused Cua observation.");
    }
    if (!action.position || action.position.kind !== "element"
      || !["type", "press", "scroll"].includes(action.operation)) return;
    if (!observedElementToken(observation, action.position.token)) {
      throw new CuaEnvironmentError("invalid-action", "Native cursor presentation requires an element from the current accessibility observation.");
    }
    const point = this.currentAgentCursorTargets.get(action.position.token);
    if (!point) return;
    this.validateObservationBinding(action, observation);
    this.validateAction(action, observation);
    await this.validateLiveBinding(observation, signal);
    if (observation.windowPid === undefined || !observation.windowId) {
      throw new CuaEnvironmentError("invalid-action", "Native cursor presentation requires an exact current window target.");
    }
    const driver = this.driver;
    if (!driver?.moveCursor) {
      throw new CuaEnvironmentError("driver-failure", "The configured Cua driver cannot present its session cursor before native input.");
    }
    try {
      // A window target keeps this overlay operation inside the app-scoped
      // manifest. Cua's default agent-cursor route leaves the real pointer alone.
      const result = await driver.moveCursor(this.input("MoveCursorInput", {
        x: point.x,
        y: point.y,
        target: this.sdk
          ? this.nativeTarget(observation)
          : createFallbackTarget(this.options.displayId, observation, "coordinates", "window"),
        session: this.sessionId,
      }), asyncOptions(signal)) as ToolResult;
      if (result.isError) {
        const detail = toolResultDetail(result);
        throw new CuaEnvironmentError("driver-failure", `Cua could not present the native agent cursor: ${detail ?? "The CUA driver rejected the operation."}`);
      }
    } catch (error) {
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `Cua could not present the native agent cursor: ${errorMessage(error)}`, { cause: error });
    }
  }

  async execute(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<ComputerEnvironmentResult> {
    abortIfRequested(signal);
    this.requireStarted();
    const observation = this.currentObservation;
    if (!observation || action.observationId !== observation.observationId || action.generation !== observation.generation || this.consumedObservationId === observation.observationId) {
      throw new CuaEnvironmentError("stale-observation", "The native computer action did not target the latest unused observation.");
    }
    this.validateObservationBinding(action, observation);
    await this.validateLiveBinding(observation, signal);
    this.validateAction(action, observation);
    // Consume before dispatch. A driver timeout can mean the OS accepted the
    // input but the acknowledgement was lost; retrying the same observation
    // would risk a duplicate click.
    this.consumedObservationId = observation.observationId;
    try {
      const result = await this.dispatch(action, observation, asyncOptions(signal));
      const toolResult = result as ToolResult;
      const actionResult = result && typeof result === "object" && "effect" in result
        ? result as ActionResult
        : toolResult.action;
      const status = resultStatus(result, this.sdk);
      if (status === "refused") {
        const detail = toolResultDetail(result);
        return { ok: false, status, summary: `CUA refused ${action.operation} ${action.actionId}${detail ? `: ${detail}` : ""}; no retry was attempted.` };
      }
      if (status === "unknown") {
        return { ok: false, status, summary: `CUA returned an uncertain effect for ${action.operation} ${action.actionId}; the observation was consumed and no retry was attempted.` };
      }
      return {
        ok: true,
        status,
        summary: `CUA dispatched ${action.operation} ${action.actionId}${actionResult?.effect ? ` (${String(actionResult.effect)})` : ""}.`,
      };
    } catch (error) {
      throw new CuaEnvironmentError("driver-failure", `CUA ${action.operation} may have been delivered; the observation was consumed and will not be retried: ${errorMessage(error)}`, { cause: error });
    }
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const driver = this.driver;
    const runtimeDriver = this.runtimeDriver;
    const taskSessionHandle = this.taskSessionHandle;
    this.driver = undefined;
    this.runtimeDriver = undefined;
    this.taskSessionHandle = undefined;
    if (!driver && !runtimeDriver) return;
    let firstError: unknown;
    try {
      // Ending a Cua session revokes its capabilities but does not guarantee
      // that a native application's process exits. Terminate only the exact
      // PID returned by this runtime's code-owned launch path; the manifest's
      // driver_launched rule makes reuse of a pre-existing process fail closed.
      const launchedProcessIsKnownAlive = driver !== undefined && this.applicationPid !== undefined
        && (!productionDrivers.has(driver) || nativeProcessIsAlive(this.applicationPid));
      if (this.started && driver && this.applicationPid !== undefined && launchedProcessIsKnownAlive) {
        const result = await callNativeTool(
          driver,
          "kill_app",
          JSON.stringify({ pid: this.applicationPid, session: this.sessionId }),
          asyncOptions(signal),
        );
        if (result.isError) {
          throw new CuaEnvironmentError("driver-failure", `CUA could not clean up native process ${this.applicationPid}: ${errorMessage(result)}`);
        }
      }
    } catch (error) {
      firstError = error;
    }
    try {
      if (this.started && driver) await driver.endSession(this.input("EndSessionInput", { session: this.sessionId }), asyncOptions(signal));
    } catch (error) {
      firstError = error;
    } finally {
      try {
        taskSessionHandle?.close();
      } catch (error) {
        firstError ??= error;
      }
      if (this.ownsDriver) {
        try {
          await runtimeDriver?.shutdown(asyncOptions(signal));
        } catch (error) {
          firstError ??= error;
        }
      }
    }
    this.started = false;
    this.currentAgentCursorTargets.clear();
    if (firstError) throw new CuaEnvironmentError("driver-failure", `CUA did not close cleanly: ${errorMessage(firstError)}`, { cause: firstError });
  }

  private requireStarted(): void {
    if (!this.started || !this.driver) throw new CuaEnvironmentError("not-started", "The CUA environment has not been started.");
  }

  private ensureApplicationProcessAlive(): void {
    if (this.applicationPid === undefined || !this.driver || !productionDrivers.has(this.driver)) return;
    if (!nativeProcessIsAlive(this.applicationPid)) {
      throw new CuaEnvironmentError(
        "driver-failure",
        `CUA launched '${this.options.application?.name ?? "the native application"}' with PID ${this.applicationPid}, but that process exited before the next usable observation.`,
      );
    }
  }

  private async launchApplication(
    application: NonNullable<CuaEnvironmentOptions["application"]>,
    signal?: AbortSignal,
  ): Promise<{ readonly pid: number; readonly windows: readonly VisibleWindowIdentity[] }> {
    const driver = this.driver;
    if (!driver?.callTool) throw new CuaEnvironmentError("driver-failure", "The configured CUA driver cannot launch the requested native application.");
    const launchPath = application.launchPath?.trim();
    const name = application.name?.trim();
    if (this.options.driverMode === "production" && !launchPath) {
      throw new CuaEnvironmentError("driver-failure", "Production native launch requires a code-resolved launch path.");
    }
    if (!launchPath && !name) {
      throw new CuaEnvironmentError("driver-failure", "A native application launch must contain a trusted launch path or application name.");
    }
    if (application.launchArguments !== undefined
      && (application.launchArguments.length > 8
        || application.launchArguments.some((argument) => typeof argument !== "string" || argument.length === 0 || argument.length > 128 || argument.includes("\u0000")))) {
      throw new CuaEnvironmentError("invalid-action", "Native application launch arguments must contain at most eight bounded non-empty strings.");
    }
    // The human-readable name is retained for task identity and evidence. If
    // the compiler supplied both fields, the path is authoritative and is
    // checked against the code-owned application allow-list before this call.
    const launchInput = JSON.stringify({
      session: this.sessionId,
      ...(launchPath ? { launch_path: launchPath } : { name }),
      ...(application.launchArguments && application.launchArguments.length > 0 ? { additional_arguments: [...application.launchArguments] } : {}),
    });
    let result: ToolResult;
    try {
      result = await callNativeTool(driver, "launch_app", launchInput, asyncOptions(signal));
    } catch (error) {
      if (launchAcknowledgementMayBeLost(error)) {
        throw new CuaEnvironmentError("driver-failure", "CUA lost the native launch acknowledgement without a PID that could be reconciled.", { cause: error });
      }
      throw new CuaEnvironmentError("driver-failure", `CUA could not launch the requested native application: ${errorMessage(error)}`, { cause: error });
    }
    if (result.isError) {
      const launch = launchResultFromTool(result);
      if (launchAcknowledgementMayBeLost(result) && launch.pid !== undefined) {
        const pid = await this.recoverLostLaunch(application, launch.pid, launch.windows, signal);
        return { pid, windows: launch.windows };
      }
      throw new CuaEnvironmentError("driver-failure", `CUA could not launch the requested native application: ${errorMessage(result)}`);
    }
    const launch = launchResultFromTool(result);
    if (launch.pid === undefined || launch.pid <= 0) {
      throw new CuaEnvironmentError("driver-failure", "CUA launched the native application without returning an exact process identity.");
    }
    return { pid: launch.pid, windows: launch.windows };
  }

  /**
   * Reconcile only a lost launch acknowledgement. An existing same-app window
   * is never adopted. CUA must expose exactly one newly visible, app-matching
   * window after the launch attempt, otherwise the task fails closed.
   */
  private async recoverLostLaunch(
    application: NonNullable<CuaEnvironmentOptions["application"]>,
    pid: number,
    returnedWindows: readonly VisibleWindowIdentity[],
    signal?: AbortSignal,
  ): Promise<number> {
    const returned = returnedWindows.filter((window) => window.pid === pid);
    if (returned.length > 1) {
      throw new CuaEnvironmentError("driver-failure", `CUA could not reconcile the lost native launch acknowledgement because multiple windows are visible for PID ${pid}.`);
    }
    if (returned[0]) {
      if (!nativeApplicationMatches(application.name, returned[0].appName)) {
        throw new CuaEnvironmentError("driver-failure", `CUA could not reconcile PID ${pid} to the approved '${application.name ?? "unknown"}' application.`);
      }
      return pid;
    }
    if (!this.driver?.listWindows) {
      throw new CuaEnvironmentError("driver-failure", "CUA lost the native launch acknowledgement and cannot reconcile the exact PID because window listing is unavailable.");
    }
    const deadline = Date.now() + NATIVE_WINDOW_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      abortIfRequested(signal);
      const after = await this.driver.listWindows(this.input("ListWindowsInput", { pid, onScreenOnly: true }), asyncOptions(signal));
      const candidates = visibleWindowIdentities(after).filter((window) => window.pid === pid);
      if (candidates.length > 1) {
        throw new CuaEnvironmentError("driver-failure", `CUA could not reconcile the lost native launch acknowledgement because multiple windows are visible for PID ${pid}.`);
      }
      const candidate = candidates[0];
      if (candidate) {
        if (!nativeApplicationMatches(application.name, candidate.appName)) {
          throw new CuaEnvironmentError("driver-failure", `CUA could not reconcile PID ${pid} to the approved '${application.name ?? "unknown"}' application.`);
        }
        return pid;
      }
      await waitForNativeWindowPoll(signal, "CUA native launch reconciliation was cancelled.");
    }
    throw new CuaEnvironmentError("driver-failure", `CUA lost the native launch acknowledgement and did not expose one new '${application.name ?? "approved"}' window before reconciliation expired.`);
  }

  /**
   * Launch acknowledgement is not window readiness. Poll only the exact PID
   * returned by Cua, and bind a single attested window before native input can
   * be proposed. This never falls back to desktop-wide discovery.
   */
  private async waitForApplicationWindow(
    returnedWindows: readonly VisibleWindowIdentity[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.applicationPid === undefined || !this.driver?.listWindows) {
      throw new CuaEnvironmentError("driver-failure", "CUA cannot prove readiness for the approved native application window.");
    }
    this.ensureApplicationProcessAlive();
    const returned = returnedWindows.filter((window) => window.pid === this.applicationPid);
    if (returned.length > 1) {
      throw new CuaEnvironmentError("driver-failure", `CUA launch returned multiple visible windows for PID ${this.applicationPid}; Lina will not choose one.`);
    }
    if (returned[0]) {
      if (this.options.application?.name && !nativeApplicationMatches(this.options.application.name, returned[0].appName)) {
        throw new CuaEnvironmentError("driver-failure", `CUA launch returned a '${returned[0].appName ?? "unknown"}' window, not the approved '${this.options.application.name}' application.`);
      }
      this.boundWindowId = returned[0].windowId;
      return;
    }
    const deadline = Date.now() + NATIVE_WINDOW_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      abortIfRequested(signal);
      this.ensureApplicationProcessAlive();
      const windows = await this.driver.listWindows(this.input("ListWindowsInput", {
        pid: this.applicationPid,
        onScreenOnly: true,
      }), asyncOptions(signal));
      const candidates = visibleWindowIdentities(windows).filter((window) => window.pid === this.applicationPid);
      if (candidates.length > 1) {
        throw new CuaEnvironmentError("driver-failure", `CUA exposed multiple visible windows for PID ${this.applicationPid}; Lina will not choose one.`);
      }
      const window = candidates[0];
      if (window && (!this.options.application?.name || nativeApplicationMatches(this.options.application.name, window.appName))) {
        this.boundWindowId = window.windowId;
        return;
      }
      if (window) {
        throw new CuaEnvironmentError("driver-failure", `CUA exposed a '${window.appName ?? "unknown"}' window, not the approved '${this.options.application?.name ?? "unknown"}' application.`);
      }
      await waitForNativeWindowPoll(signal, "CUA native window readiness was cancelled.");
    }
    throw new CuaEnvironmentError("driver-failure", `CUA did not expose exactly one usable '${this.options.application?.name ?? "approved"}' window for PID ${this.applicationPid} before the readiness deadline.`);
  }

  private validatePosition(position: NonNullable<ComputerEnvironmentAction["position"]>, observation: ComputerEnvironmentObservation): void {
    if (position.kind === "element") {
      if (position.token.trim().length === 0 || position.token.length > 256) throw new CuaEnvironmentError("invalid-action", "The native element token must contain between 1 and 256 characters.");
      if (observation.windowId !== undefined && !observedElementToken(observation, position.token)) {
        throw new CuaEnvironmentError("invalid-action", "The native element token was not present in the current accessibility observation.");
      }
      return;
    }
    const maxX = observation.screenWidth === undefined ? this.options.maxCoordinate : Math.min(this.options.maxCoordinate, Math.max(0, observation.screenWidth - 1));
    const maxY = observation.screenHeight === undefined ? this.options.maxCoordinate : Math.min(this.options.maxCoordinate, Math.max(0, observation.screenHeight - 1));
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0 || position.x > maxX || position.y > maxY) {
      throw new CuaEnvironmentError("invalid-action", `Native coordinates must be within the observed screen (x: 0-${maxX}, y: 0-${maxY}).`);
    }
  }

  private validateObservationBinding(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation): void {
    const bindings: readonly [string, unknown, unknown][] = [
      ["display", action.display, observation.display],
      ["screenWidth", action.screenWidth, observation.screenWidth],
      ["screenHeight", action.screenHeight, observation.screenHeight],
      ["scaleFactor", action.scaleFactor, observation.scaleFactor],
      ["windowPid", action.windowPid, observation.windowPid],
      ["windowId", action.windowId, observation.windowId],
      ["windowSnapshotId", action.windowSnapshotId, observation.windowSnapshotId],
    ];
    const mismatch = bindings.find(([, actionValue, observationValue]) => actionValue !== undefined && actionValue !== observationValue);
    if (mismatch) {
      throw new CuaEnvironmentError("stale-observation", `The native action's ${mismatch[0]} binding no longer matches the observed host state.`);
    }
  }

  private async validateLiveBinding(observation: ComputerEnvironmentObservation, signal?: AbortSignal): Promise<void> {
    abortIfRequested(signal);
    if (this.options.captureScope === "desktop") {
      let result: ToolResult;
      try {
        result = await this.driver!.getDesktopState(this.input("GetDesktopStateInput", { session: this.sessionId }), asyncOptions(signal)) as ToolResult;
      } catch (error) {
        throw new CuaEnvironmentError("driver-failure", `CUA could not revalidate the desktop before input: ${errorMessage(error)}`, { cause: error });
      }
      if (result.isError) {
        throw new CuaEnvironmentError("driver-failure", "CUA could not revalidate the desktop before input.");
      }
      const current = desktopMetadata(result.structuredJson);
      const dimensions: readonly [string, number | undefined, number | undefined][] = [
        ["screen width", observation.screenWidth, current.screenWidth],
        ["screen height", observation.screenHeight, current.screenHeight],
        ["scale factor", observation.scaleFactor, current.scaleFactor],
      ];
      const changed = dimensions.find(([, observed, latest]) => observed !== undefined && latest !== undefined && observed !== latest);
      if (changed) {
        throw new CuaEnvironmentError("stale-observation", `The native action's ${changed[0]} changed after the observation was captured.`);
      }
    }
    if (observation.windowId !== undefined && this.driver!.listWindows) {
      let window: { readonly pid: number; readonly windowId: bigint } | undefined;
      try {
        window = topAccessibleWindow(
          await this.driver!.listWindows(this.input("ListWindowsInput", {
            onScreenOnly: true,
            ...(this.applicationPid !== undefined ? { pid: this.applicationPid } : {}),
          }), asyncOptions(signal)),
          this.applicationPid,
          this.boundWindowId,
        );
      } catch (error) {
        throw new CuaEnvironmentError("driver-failure", `CUA could not revalidate the foreground window: ${errorMessage(error)}`, { cause: error });
      }
      if (!window || window.pid !== observation.windowPid || window.windowId.toString() !== observation.windowId) {
        throw new CuaEnvironmentError("stale-observation", "The observed foreground window changed before native input.");
      }
      if (this.options.captureScope === "window" && this.driver!.getWindowState) {
        let state: unknown;
        try {
          state = await this.driver!.getWindowState(this.input("GetWindowStateInput", {
            pid: window.pid,
            windowId: window.windowId,
            session: this.sessionId,
            includeAccessibilityTree: false,
            // CUA rejects a window-state request when both payload sources are
            // disabled. Request the same-size window capture used by the
            // observation so screenshot dimensions remain a meaningful
            // freshness signal; the image is discarded and never enters
            // Lina evidence.
            includeScreenshot: true,
          }), asyncOptions(signal));
        } catch (error) {
          throw new CuaEnvironmentError("driver-failure", `CUA could not revalidate the foreground window geometry: ${errorMessage(error)}`, { cause: error });
        }
        const record = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
        if (record.isError === true) {
          throw new CuaEnvironmentError("driver-failure", "CUA could not revalidate the foreground window geometry.");
        }
        const current = {
          screenWidth: typeof record.screenshotWidth === "number" && Number.isFinite(record.screenshotWidth) ? record.screenshotWidth : undefined,
          screenHeight: typeof record.screenshotHeight === "number" && Number.isFinite(record.screenshotHeight) ? record.screenshotHeight : undefined,
          scaleFactor: typeof record.screenshotScale === "number" && Number.isFinite(record.screenshotScale) ? record.screenshotScale : undefined,
        };
        const changed = ([
          ["screen width", observation.screenWidth, current.screenWidth],
          ["screen height", observation.screenHeight, current.screenHeight],
          ["scale factor", observation.scaleFactor, current.scaleFactor],
        ] as const).find(([, observed, latest]) => observed !== undefined && latest !== undefined && observed !== latest);
        if (changed) {
          throw new CuaEnvironmentError("stale-observation", `The native action's ${changed[0]} changed after the window observation was captured.`);
        }
      }
    }
  }

  private validateAction(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation): void {
    if (action.operation === "wait") throw new CuaEnvironmentError("invalid-action", "The native CUA adapter does not dispatch wait as an input action.");
    if (action.menuPath && action.operation !== "click") {
      throw new CuaEnvironmentError("invalid-action", "A native application-menu path is valid only for a click action.");
    }
    if (action.menuPath && action.position) {
      throw new CuaEnvironmentError("invalid-action", "A native application-menu action cannot also contain a screen position.");
    }
    if (action.menuPath && (action.menuPath.length < 1 || action.menuPath.length > 16 || action.menuPath.some((segment) => typeof segment !== "string" || segment.trim().length === 0 || segment.length > 256))) {
      throw new CuaEnvironmentError("invalid-action", "Native application-menu paths must contain between one and sixteen bounded non-empty segments.");
    }
    if (["click", "move", "scroll"].includes(action.operation) && !action.position && !action.menuPath) {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} requires a screen position.`);
    }
    if (action.position) this.validatePosition(action.position, observation);
    if (action.operation === "move" && action.position?.kind !== "coordinates") {
      throw new CuaEnvironmentError("invalid-action", "Native cursor movement requires coordinate input on the native desktop.");
    }
    if (action.operation === "scroll" && action.position?.kind !== "coordinates" && action.position?.kind !== "element") {
      throw new CuaEnvironmentError("invalid-action", "Native scrolling requires an observed coordinate or element target.");
    }
    if (["type", "press"].includes(action.operation) && action.position?.kind === "coordinates") {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} does not accept coordinate input; use an observed element target or the host-focused route.`);
    }
    if (["type", "press", "scroll"].includes(action.operation) && action.position?.kind === "element" && !this.driver?.callTool) {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} requires CUA's element-targeted tool route, which is unavailable in this driver.`);
    }
    if (action.operation === "drag") {
      if (!action.position || !action.endPosition || action.position.kind !== "coordinates" || action.endPosition.kind !== "coordinates") {
        throw new CuaEnvironmentError("invalid-action", "Native drag requires coordinate start and end positions.");
      }
      this.validatePosition(action.endPosition, observation);
    }
    if (action.operation === "type" && (!action.text || action.text.length === 0 || action.text.length > 4_096)) {
      throw new CuaEnvironmentError("invalid-action", "Native text input must contain between 1 and 4,096 characters.");
    }
    if (action.operation === "press" && (!action.key || action.key.length === 0 || action.key.length > 64)) {
      throw new CuaEnvironmentError("invalid-action", "Native key input must contain between 1 and 64 characters.");
    }
    if (action.modifiers && (action.modifiers.length > 8 || action.modifiers.some((modifier) => modifier.length === 0 || modifier.length > 32))) {
      throw new CuaEnvironmentError("invalid-action", "Native keyboard modifiers are limited to eight short names.");
    }
    if (["scroll"].includes(action.operation) && (!action.direction || (action.amount !== undefined && (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 100)))) {
      throw new CuaEnvironmentError("invalid-action", "Native scroll requires a direction and an integer amount from 1 to 100.");
    }
  }

  private clickInput(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation): unknown {
    const position = action.position!;
    if (!this.sdk) return createFallbackInput(action, this.sessionId, this.options.displayId, observation);
    return this.sdk.ClickInput.new({
      // Window observations report window-local screenshot coordinates. Keep
      // those coordinates paired with the exact window target; desktop
      // observations retain their absolute display target.
      target: position.kind === "element" || this.options.captureScope === "window"
        ? this.nativeTarget(observation)
        : this.desktopTarget(),
      position: position.kind === "coordinates"
        ? this.sdk.ClickPosition.Coordinates.new({ x: position.x, y: position.y })
        : this.sdk.ClickPosition.Element.new({ elementToken: position.token }),
      // Accessibility-token clicks use CUA's least disruptive route. Coordinate
      // actions remain explicit foreground input after approval; refusal never
      // triggers an automatic foreground retry.
      deliveryMode: position.kind === "element" ? this.sdk.InputDeliveryMode.Background : this.sdk.InputDeliveryMode.Foreground,
      session: this.sessionId,
      button: this.sdk.ClickButton.Left,
      count: 1,
    });
  }

  private nativeTarget(observation?: ComputerEnvironmentObservation): ReturnType<CuaSdk["ActionTarget"]["Desktop"]["new"]> | ReturnType<CuaSdk["ActionTarget"]["Window"]["new"]> {
    if (!this.sdk) throw new CuaEnvironmentError("driver-failure", "The CUA SDK is not loaded.");
    if (observation?.windowPid !== undefined && observation.windowId !== undefined) {
      return this.sdk.ActionTarget.Window.new({ pid: observation.windowPid, windowId: BigInt(observation.windowId) });
    }
    return this.sdk.ActionTarget.Desktop.new({ displayId: this.options.displayId });
  }

  private desktopTarget(): ReturnType<CuaSdk["ActionTarget"]["Desktop"]["new"]> {
    if (!this.sdk) throw new CuaEnvironmentError("driver-failure", "The CUA SDK is not loaded.");
    return this.sdk.ActionTarget.Desktop.new({ displayId: this.options.displayId });
  }

  private nativePosition(position: NonNullable<ComputerEnvironmentAction["position"]>): unknown {
    if (!this.sdk) return createFallbackPosition(position);
    if (position.kind === "coordinates") return this.sdk.ClickPosition.Coordinates.new({ x: position.x, y: position.y });
    return this.sdk.ClickPosition.Element.new({ elementToken: position.token });
  }

  private async dispatchElementAction(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation, options?: { readonly signal: AbortSignal }): Promise<unknown> {
    const position = action.position;
    const driver = this.driver;
    if (!position || position.kind !== "element" || !driver?.callTool) return undefined;
    const pid = observation.windowPid ?? action.windowPid;
    const windowId = observation.windowId ?? action.windowId;
    if (!pid || !windowId) throw new CuaEnvironmentError("invalid-action", "An element-targeted native action requires the exact observed process and window.");
    let parsedWindowId: bigint;
    try {
      parsedWindowId = BigInt(windowId);
    } catch {
      throw new CuaEnvironmentError("invalid-action", "The observed native window identity is not an exact integer.");
    }
    const common = {
      pid,
      window_id: parsedWindowId,
      element_token: position.token,
      ...(observation.windowSnapshotId ?? action.windowSnapshotId ? { snapshot_id: observation.windowSnapshotId ?? action.windowSnapshotId } : {}),
      session: this.sessionId,
    } as const;
    let tool: string;
    let input: Record<string, unknown>;
    switch (action.operation) {
      case "type":
        tool = action.inputMethod === "set_value" ? "set_value" : "type_text";
        input = tool === "set_value"
          ? { ...common, value: action.text }
          : { ...common, text: action.text, delivery_mode: "background" };
        break;
      case "press":
        tool = "press_key";
        input = { ...common, key: action.key, ...(action.modifiers ? { modifiers: [...action.modifiers] } : {}), delivery_mode: "background" };
        break;
      case "scroll":
        tool = "scroll";
        input = { ...common, direction: action.direction, amount: action.amount ?? 1, by: "line", delivery_mode: "background" };
        break;
      default:
        return undefined;
    }
    return callNativeTool(driver, tool, encodeCuaJson(input as never), options);
  }

  private async dispatch(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation, options?: { readonly signal: AbortSignal }): Promise<unknown> {
    if (action.menuPath) {
      const driver = this.driver;
      const pid = observation.windowPid;
      const windowId = observation.windowId;
      if (!driver?.callTool || pid === undefined || !windowId) {
        throw new CuaEnvironmentError("invalid-action", "A native application-menu action requires the exact observed process, window, and Cua generic tool route.");
      }
      let parsedWindowId: bigint;
      try {
        parsedWindowId = BigInt(windowId);
      } catch {
        throw new CuaEnvironmentError("invalid-action", "The observed native window identity is not an exact integer.");
      }
      return callNativeTool(driver, "invoke_menu", encodeCuaJson({
        pid,
        window_id: parsedWindowId,
        path: action.menuPath.map((segment) => segment.trim()),
        session: this.sessionId,
      }), options);
    }
    if (action.position?.kind === "element") {
      const elementResult = await this.dispatchElementAction(action, observation, options);
      if (elementResult !== undefined) return elementResult;
    }
    if (!this.sdk) {
      const input = createFallbackInput(action, this.sessionId, this.options.displayId, observation, this.options.captureScope) as Record<string, unknown>;
      switch (action.operation) {
        case "click": return this.driver!.click(input, options);
        case "move": return this.driver!.moveCursor(input, options);
        case "type": return this.driver!.typeText({ ...input, text: action.text }, options);
        case "press": return this.driver!.pressKey({ ...input, key: action.key, modifiers: action.modifiers }, options);
        case "scroll": return this.driver!.scroll({ ...input, direction: action.direction, amount: action.amount ?? 1 }, options);
        case "drag": return this.driver!.drag({ ...input, fromX: action.position && action.position.kind === "coordinates" ? action.position.x : undefined, fromY: action.position && action.position.kind === "coordinates" ? action.position.y : undefined, toX: action.endPosition && action.endPosition.kind === "coordinates" ? action.endPosition.x : undefined, toY: action.endPosition && action.endPosition.kind === "coordinates" ? action.endPosition.y : undefined }, options);
        case "wait": throw new CuaEnvironmentError("invalid-action", "Native wait is not dispatched.");
      }
    }
    switch (action.operation) {
      case "click": return this.driver!.click(this.clickInput(action, observation), options);
      case "move": {
        const position = action.position;
        if (!position || position.kind !== "coordinates") throw new CuaEnvironmentError("invalid-action", "Native cursor movement requires coordinates.");
        return this.driver!.moveCursor(this.sdk!.MoveCursorInput.new({ x: position.x, y: position.y, target: this.options.captureScope === "window" ? this.nativeTarget(observation) : this.desktopTarget(), session: this.sessionId }), options);
      }
      case "type": return this.driver!.typeText(this.sdk!.TypeTextInput.new({ text: action.text!, target: this.nativeTarget(observation), session: this.sessionId }), options);
      case "press": return this.driver!.pressKey(this.sdk!.PressKeyInput.new({ key: action.key!, target: this.nativeTarget(observation), session: this.sessionId, modifiers: action.modifiers ? [...action.modifiers] : undefined }), options);
      case "scroll": {
        const position = action.position;
        if (!position || position.kind !== "coordinates") throw new CuaEnvironmentError("invalid-action", "Native scrolling requires coordinates.");
        return this.driver!.scroll(this.sdk!.ScrollInput.new({ x: position.x, y: position.y, direction: scrollDirection(this.sdk!, action.direction!), target: this.options.captureScope === "window" ? this.nativeTarget(observation) : this.desktopTarget(), session: this.sessionId, by: this.sdk!.ScrollBy.Line, amount: BigInt(action.amount ?? 1) }), options);
      }
      case "drag": {
        const from = action.position;
        const to = action.endPosition;
        if (!from || from.kind !== "coordinates" || !to || to.kind !== "coordinates") throw new CuaEnvironmentError("invalid-action", "Native drag requires coordinate start and end positions.");
        return this.driver!.drag(this.sdk!.DragInput.new({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, target: this.options.captureScope === "window" ? this.nativeTarget(observation) : this.desktopTarget(), session: this.sessionId, durationMs: 300n, steps: 10n, button: this.sdk!.ClickButton.Left }), options);
      }
      case "wait": throw new CuaEnvironmentError("invalid-action", "Native wait is not dispatched.");
    }
  }

  private verificationPredicates(spec: ComputerVerificationSpec): readonly unknown[] {
    const sdk = this.sdk;
    const selector = (value: Record<string, unknown>): unknown => sdk ? sdk.ElementSelector.new(value) : value;
    const element = (value: Record<string, unknown>): unknown => sdk
      ? sdk.ElementPredicate.new(value as Parameters<CuaSdk["ElementPredicate"]["new"]>[0])
      : value;
    const state = (value: Record<string, unknown>): unknown => sdk ? sdk.StatePredicate.new(value) : value;
    const byLabel = (label: string, extra: Record<string, unknown> = {}): unknown => state({ element: element({ selector: selector({ labelContains: label }), exists: true, ...extra }) });
    switch (spec.kind) {
      case "native-app-open":
        return [state({ window: sdk ? sdk.WindowPredicate.new({ exists: true }) : { exists: true } })];
      case "native-text-editor-value":
        // Linux AT-SPI exposes GNOME Text Editor's editor as a `text box`.
        // Its text interface is projected into the element label, not the
        // numeric Value interface, so valueEquals would remain unknown even
        // after a successful type_text. labelContains is still evaluated by
        // Cua against the fresh exact-window accessibility snapshot.
        return [state({ element: element({ selector: selector({ labelContains: spec.expected ?? "" }), exists: true }) })];
      case "native-calendar-event":
        return [
          byLabel(spec.expected ?? ""),
          ...(spec.nativeFacts?.date ? [byLabel(spec.nativeFacts.date)] : []),
          ...(spec.nativeFacts?.time ? [byLabel(spec.nativeFacts.time)] : []),
        ];
      case "native-clock-alarm":
        return [byLabel(spec.nativeFacts?.time ?? spec.expected ?? "", { enabled: spec.nativeFacts?.requireEnabled === true })];
      case "element-visible":
        return spec.expected ? [byLabel(spec.expected)] : [];
      case "element-state-changed": {
        if (!spec.expected || !spec.state) return [];
        const stateExpectation: Record<string, unknown> = {};
        if (spec.state === "enabled" || spec.state === "disabled") stateExpectation.enabled = spec.state === "enabled";
        if (spec.state === "selected" || spec.state === "unselected") stateExpectation.selected = spec.state === "selected";
        return Object.keys(stateExpectation).length > 0 ? [byLabel(spec.expected, stateExpectation)] : [];
      }
      default:
        return [];
    }
  }

  private input(name: "StartSessionInput" | "SetAgentCursorThemeInput" | "SetAgentCursorEnabledInput" | "GetAgentCursorStateInput" | "GetDesktopStateInput" | "ListWindowsInput" | "GetWindowStateInput" | "VerifyStateInput" | "MoveCursorInput" | "EndSessionInput", value: Record<string, unknown>): unknown {
    const factory = this.sdk?.[name] as { readonly new: (input: Record<string, unknown>) => unknown } | undefined;
    return factory ? factory.new(value) : value;
  }

  private async shutdownAfterFailedStart(): Promise<void> {
    const driver = this.driver;
    const runtimeDriver = this.runtimeDriver;
    const taskSessionHandle = this.taskSessionHandle;
    try {
      if (taskSessionHandle) {
        await driver?.endSession(this.input("EndSessionInput", { session: this.sessionId }));
      } else if (!this.ownsDriver) {
        await driver?.endSession(this.input("EndSessionInput", { session: this.sessionId }));
      }
    } catch {
      // Preserve the start error; the task session will not be used again.
    } finally {
      try {
        taskSessionHandle?.close();
      } catch {
        // Preserve the original startup error.
      }
    }
    if (this.ownsDriver) {
      try {
        await runtimeDriver?.shutdown();
      } catch {
        // Preserve the original startup error.
      }
      this.driver = undefined;
      this.runtimeDriver = undefined;
    } else {
      this.driver = runtimeDriver;
    }
    this.taskSessionHandle = undefined;
    this.started = false;
  }
}
