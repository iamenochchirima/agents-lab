import { randomUUID } from "node:crypto";
import type { ActionResult, ScrollDirection as CuaScrollDirection, ToolResult } from "@trycua/cua-driver";
import type {
  ComputerEnvironment,
  ComputerEnvironmentAction,
  ComputerEnvironmentObservation,
  ComputerEnvironmentReadiness,
  ComputerEnvironmentResult,
  ComputerScrollDirection,
} from "./contracts.js";

/** The small driver seam keeps native generated types out of fake-host tests. */
export interface CuaDriverClient {
  startSession(input: unknown, options?: unknown): Promise<unknown>;
  setAgentCursorTheme(input: unknown, options?: unknown): Promise<unknown>;
  setAgentCursorEnabled(input: unknown, options?: unknown): Promise<unknown>;
  getAgentCursorState?(input: unknown, options?: unknown): Promise<unknown>;
  getDesktopState(input: unknown, options?: unknown): Promise<unknown>;
  listWindows?(input: unknown, options?: unknown): Promise<unknown>;
  getWindowState?(input: unknown, options?: unknown): Promise<unknown>;
  moveCursor(input: unknown, options?: unknown): Promise<unknown>;
  click(input: unknown, options?: unknown): Promise<unknown>;
  typeText(input: unknown, options?: unknown): Promise<unknown>;
  pressKey(input: unknown, options?: unknown): Promise<unknown>;
  scroll(input: unknown, options?: unknown): Promise<unknown>;
  drag(input: unknown, options?: unknown): Promise<unknown>;
  endSession(input: unknown, options?: unknown): Promise<unknown>;
  shutdown(options?: unknown): Promise<void>;
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

export interface CuaEnvironmentOptions {
  readonly sessionId?: string;
  readonly displayId?: string;
  /** Use desktop screenshots for the traditional path or exact window snapshots for Jev. */
  readonly captureScope?: "desktop" | "window";
  readonly screenshotPath?: string;
  readonly maxObservationBytes?: number;
  readonly maxCoordinate?: number;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  /** Test seam and an extraction seam for an already-authorized host. */
  readonly driver?: CuaDriverClient;
  readonly loadSdk?: () => Promise<CuaSdk>;
}

const DEFAULT_MAX_OBSERVATION_BYTES = 32 * 1024;
const DEFAULT_MAX_COORDINATE = 16_384;

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
  const isolated = environment.ANESU_COMPUTER_CUA_ISOLATED_DISPLAY === "true";
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

function createFallbackTarget(displayId: string, observation?: ComputerEnvironmentObservation, positionKind?: "coordinates" | "element"): unknown {
  if (positionKind !== "coordinates" && observation?.windowPid !== undefined && observation.windowId !== undefined) {
    return { tag: "Window", inner: { pid: observation.windowPid, windowId: BigInt(observation.windowId) } };
  }
  return { tag: "Desktop", inner: { displayId } };
}

function createFallbackPosition(position: NonNullable<ComputerEnvironmentAction["position"]>): unknown {
  if (position.kind === "coordinates") return { tag: "Coordinates", inner: { x: position.x, y: position.y } };
  return { tag: "Element", inner: { elementToken: position.token } };
}

function createFallbackInput(action: ComputerEnvironmentAction, sessionId: string, displayId: string, observation?: ComputerEnvironmentObservation): unknown {
  return {
    target: createFallbackTarget(displayId, observation, action.position?.kind),
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
  readonly elements: readonly Record<string, unknown>[];
};

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function normalizedAccessibilityWindow(value: unknown): AccessibilityWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pid = finiteInteger(record.pid);
  const windowId = typeof record.windowId === "bigint"
    ? record.windowId.toString()
    : stringValue(record.windowId, 128);
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
    const frame = element.frame && typeof element.frame === "object" && !Array.isArray(element.frame)
      ? element.frame as Record<string, unknown>
      : undefined;
    const normalizedFrame = frame && ["x", "y", "width", "height"].every((key) => typeof frame[key] === "number" && Number.isFinite(frame[key]))
      ? { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
      : undefined;
    return [{
      elementToken: token,
      role,
      ...(label ? { label } : {}),
      ...(typeof element.enabled === "boolean" ? { enabled: element.enabled } : {}),
      ...(typeof element.selected === "boolean" ? { selected: element.selected } : {}),
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
    elements,
  };
}

function topAccessibleWindow(value: unknown): { readonly pid: number; readonly windowId: bigint } | undefined {
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
      && typeof window.windowId === "bigint"
      && boundRecord !== undefined
      && typeof boundRecord.width === "number" && boundRecord.width > 0
      && typeof boundRecord.height === "number" && boundRecord.height > 0;
  }) as Record<string, unknown>[];
  if (visible.length === 0) return undefined;
  if (visible.length === 1) {
    return { pid: finiteInteger(visible[0]!.pid)!, windowId: visible[0]!.windowId as bigint };
  }
  const ranked = visible.filter((window) => typeof window.zIndex === "bigint");
  if (ranked.length !== visible.length) return undefined;
  ranked.sort((left, right) => Number((right.zIndex as bigint) - (left.zIndex as bigint)));
  if (ranked.length > 1 && ranked[0]!.zIndex === ranked[1]!.zIndex) return undefined;
  return { pid: finiteInteger(ranked[0]!.pid)!, windowId: ranked[0]!.windowId as bigint };
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
  private driver: CuaDriverClient | undefined;
  private sdk: CuaSdk | undefined;
  private started = false;
  private closed = false;
  private generation = 0;
  private currentObservation: ComputerEnvironmentObservation | undefined;
  private consumedObservationId: string | undefined;

  constructor(options: CuaEnvironmentOptions = {}) {
    this.sessionId = options.sessionId ?? `anesu-cua-${randomUUID()}`;
    this.environment = options.environment ?? process.env;
    this.options = {
      ...options,
      displayId: options.displayId ?? "primary",
      captureScope: options.captureScope ?? "desktop",
      maxObservationBytes: options.maxObservationBytes ?? DEFAULT_MAX_OBSERVATION_BYTES,
      maxCoordinate: options.maxCoordinate ?? DEFAULT_MAX_COORDINATE,
    };
    this.driver = options.driver;
  }

  readiness(): ComputerEnvironmentReadiness {
    return inspectCuaReadiness({ platform: this.options.platform, environment: this.environment });
  }

  async start(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness> {
    abortIfRequested(signal);
    if (this.closed) throw new CuaEnvironmentError("already-closed", "The CUA environment has already been closed.");
    if (this.started) return this.readiness();
    const readiness = this.readiness();
    if (!readiness.available) throw new CuaEnvironmentError("unavailable", `CUA is unavailable: ${readiness.reason ?? "host is not ready"}.`);
    try {
      if (!this.driver) {
        this.sdk = await (this.options.loadSdk ?? (() => import("@trycua/cua-driver")))();
        this.driver = this.sdk.CuaDriver.create(undefined) as unknown as CuaDriverClient;
      }
      await this.driver.startSession(this.input("StartSessionInput", {
        session: this.sessionId,
        // The traditional path explicitly requests desktop scope for a full
        // display screenshot. Jev uses window scope so its accessibility
        // snapshot and token remain authorized by the same CUA session.
        captureScope: this.options.captureScope === "window"
          ? this.sdk?.CaptureScope.Window ?? "Window"
          : this.sdk?.CaptureScope.Desktop ?? "Desktop",
      }), asyncOptions(signal));
      await this.driver.setAgentCursorTheme(this.input("SetAgentCursorThemeInput", {
        session: this.sessionId,
        themeId: "cua.default",
        reducedMotion: this.sdk?.CursorReducedMotion.Auto ?? "Auto",
      }), asyncOptions(signal));
      await this.driver.setAgentCursorEnabled(this.input("SetAgentCursorEnabledInput", { session: this.sessionId, enabled: true }), asyncOptions(signal));
      this.started = true;
      return readiness;
    } catch (error) {
      await this.shutdownAfterFailedStart();
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA could not start the isolated session: ${errorMessage(error)}`, { cause: error });
    }
  }

  async observe(signal?: AbortSignal): Promise<ComputerEnvironmentObservation> {
    abortIfRequested(signal);
    this.requireStarted();
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
          const window = topAccessibleWindow(await this.driver!.listWindows(this.input("ListWindowsInput", { onScreenOnly: true, }), asyncOptions(signal)));
          if (window) {
            accessibility = normalizedAccessibilityWindow(await this.driver!.getWindowState(this.input("GetWindowStateInput", {
              pid: window.pid,
              windowId: window.windowId,
              session: this.sessionId,
              includeAccessibilityTree: true,
              includeScreenshot: false,
              maxElements: 256,
              maxDepth: 16,
            }), asyncOptions(signal)));
          }
        } catch {
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

  private async observeWindow(signal?: AbortSignal): Promise<ComputerEnvironmentObservation> {
    try {
      if (!this.driver!.listWindows || !this.driver!.getWindowState) {
        throw new CuaEnvironmentError("driver-failure", "CUA window observations are unavailable in this driver adapter.");
      }
      const window = topAccessibleWindow(await this.driver!.listWindows(this.input("ListWindowsInput", { onScreenOnly: true }), asyncOptions(signal)));
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
        this.currentObservation = observation;
        this.consumedObservationId = undefined;
        return observation;
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
      const accessibility = normalizedAccessibilityWindow(state);
      this.generation += 1;
      const snapshotId = stringValue(stateRecord.snapshotId, 256);
      const appName = stringValue(stateRecord.appName, 128);
      const windowTitle = stringValue(stateRecord.windowTitle, 512);
      const treeMarkdown = typeof stateRecord.treeMarkdown === "string" ? stateRecord.treeMarkdown : "";
      const screenshotWidth = typeof stateRecord.screenshotWidth === "number" && Number.isFinite(stateRecord.screenshotWidth) && stateRecord.screenshotWidth > 0 ? stateRecord.screenshotWidth : undefined;
      const screenshotHeight = typeof stateRecord.screenshotHeight === "number" && Number.isFinite(stateRecord.screenshotHeight) && stateRecord.screenshotHeight > 0 ? stateRecord.screenshotHeight : undefined;
      const scaleFactor = typeof stateRecord.screenshotScale === "number" && Number.isFinite(stateRecord.screenshotScale) && stateRecord.screenshotScale > 0 ? stateRecord.screenshotScale : undefined;
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
      this.currentObservation = withCursor;
      this.consumedObservationId = undefined;
      return withCursor;
    } catch (error) {
      if (error instanceof CuaEnvironmentError) throw error;
      throw new CuaEnvironmentError("driver-failure", `CUA window observation failed: ${errorMessage(error)}`, { cause: error });
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
        return { ok: false, status, summary: `CUA refused ${action.operation} ${action.actionId}; no retry was attempted.` };
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
    this.driver = undefined;
    if (!driver) return;
    let firstError: unknown;
    try {
      if (this.started) await driver.endSession(this.input("EndSessionInput", { session: this.sessionId }), asyncOptions(signal));
    } catch (error) {
      firstError = error;
    } finally {
      try {
        await driver.shutdown(asyncOptions(signal));
      } catch (error) {
        firstError ??= error;
      }
    }
    this.started = false;
    if (firstError) throw new CuaEnvironmentError("driver-failure", `CUA did not close cleanly: ${errorMessage(firstError)}`, { cause: firstError });
  }

  private requireStarted(): void {
    if (!this.started || !this.driver) throw new CuaEnvironmentError("not-started", "The CUA environment has not been started.");
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
        window = topAccessibleWindow(await this.driver!.listWindows(this.input("ListWindowsInput", { onScreenOnly: true }), asyncOptions(signal)));
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
            // Anesu evidence.
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
    if (["click", "move", "scroll"].includes(action.operation) && !action.position) {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} requires a screen position.`);
    }
    if (action.position) this.validatePosition(action.position, observation);
    if (["move", "scroll"].includes(action.operation) && action.position?.kind !== "coordinates") {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} requires coordinate input on the native desktop.`);
    }
    if (["type", "press"].includes(action.operation) && (action.position || action.endPosition)) {
      throw new CuaEnvironmentError("invalid-action", `${action.operation} does not accept a coordinate; focus must already be established by the host.`);
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
      // Desktop observations report absolute screen coordinates. Even when CUA
      // also exposes the foreground window, sending those coordinates to a
      // window target would reinterpret them as window-relative and can click a
      // different control. Semantic element tokens are the only clicks that use
      // the exact window target.
      target: position.kind === "element" ? this.nativeTarget(observation) : this.desktopTarget(),
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

  private async dispatch(action: ComputerEnvironmentAction, observation: ComputerEnvironmentObservation, options?: { readonly signal: AbortSignal }): Promise<unknown> {
    if (!this.sdk) {
      const input = createFallbackInput(action, this.sessionId, this.options.displayId, observation) as Record<string, unknown>;
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
        return this.driver!.moveCursor(this.sdk!.MoveCursorInput.new({ x: position.x, y: position.y, target: this.desktopTarget(), session: this.sessionId }), options);
      }
      case "type": return this.driver!.typeText(this.sdk!.TypeTextInput.new({ text: action.text!, target: this.nativeTarget(observation), session: this.sessionId }), options);
      case "press": return this.driver!.pressKey(this.sdk!.PressKeyInput.new({ key: action.key!, target: this.nativeTarget(observation), session: this.sessionId, modifiers: action.modifiers ? [...action.modifiers] : undefined }), options);
      case "scroll": {
        const position = action.position;
        if (!position || position.kind !== "coordinates") throw new CuaEnvironmentError("invalid-action", "Native scrolling requires coordinates.");
        return this.driver!.scroll(this.sdk!.ScrollInput.new({ x: position.x, y: position.y, direction: scrollDirection(this.sdk!, action.direction!), target: this.desktopTarget(), session: this.sessionId, by: this.sdk!.ScrollBy.Line, amount: BigInt(action.amount ?? 1) }), options);
      }
      case "drag": {
        const from = action.position;
        const to = action.endPosition;
        if (!from || from.kind !== "coordinates" || !to || to.kind !== "coordinates") throw new CuaEnvironmentError("invalid-action", "Native drag requires coordinate start and end positions.");
        return this.driver!.drag(this.sdk!.DragInput.new({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, target: this.desktopTarget(), session: this.sessionId, durationMs: 300n, steps: 10n, button: this.sdk!.ClickButton.Left }), options);
      }
      case "wait": throw new CuaEnvironmentError("invalid-action", "Native wait is not dispatched.");
    }
  }

  private input(name: "StartSessionInput" | "SetAgentCursorThemeInput" | "SetAgentCursorEnabledInput" | "GetAgentCursorStateInput" | "GetDesktopStateInput" | "ListWindowsInput" | "GetWindowStateInput" | "EndSessionInput", value: Record<string, unknown>): unknown {
    const factory = this.sdk?.[name] as { readonly new: (input: Record<string, unknown>) => unknown } | undefined;
    return factory ? factory.new(value) : value;
  }

  private async shutdownAfterFailedStart(): Promise<void> {
    if (!this.driver) return;
    try {
      await this.driver.shutdown();
    } catch {
      // Preserve the start error. The failed native runtime is no longer used.
    }
    this.driver = undefined;
    this.started = false;
  }
}
