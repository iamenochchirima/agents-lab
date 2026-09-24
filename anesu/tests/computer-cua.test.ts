import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import {
  CuaEnvironment,
  CuaEnvironmentError,
  CuaNativeDriverOwner,
  callNativeTool,
  inspectCuaReadiness,
  type CuaDriverClient,
} from "../src/computer/cua-driver.js";
import type { ComputerEnvironmentAction } from "../src/computer/contracts.js";

function toolResult(overrides: Partial<{
  text: string;
  images: Array<{ mimeType: string; dataBase64: string }>;
  structuredJson: string;
  isError: boolean;
}> = {}) {
  return {
    text: overrides.text ?? "desktop state",
    images: overrides.images ?? [],
    ...(overrides.structuredJson === undefined ? {} : { structuredJson: overrides.structuredJson }),
    isError: overrides.isError ?? false,
    degraded: false,
    rawJson: "{\"untrusted\":true}",
  };
}

function healthyCuaReport() {
  return {
    schema_version: "1",
    platform: "linux",
    overall: "ok",
    checks: [
      "binary_version",
      "platform_supported",
      "session_active",
      "ax_capability",
      "screen_capture_capability",
    ].map((name) => ({ name, status: "pass" })),
  };
}

class FakeCuaDriver implements CuaDriverClient {
  readonly calls: Array<{ name: string; input: unknown }> = [];
  readonly state = toolResult({
    text: "desktop state with a bounded observation",
    images: [{ mimeType: "image/png", dataBase64: "a".repeat(200) }],
    structuredJson: JSON.stringify({ screen_width: 1_280, screen_height: 720, elements: [{ token: "element-1" }] }),
  });
  liveDesktopState = this.state;
  liveWindowId = 42n;
  liveWindowAppName = "Text Editor";
  liveWindowWidth = 800;
  liveWindowHeight = 600;
  liveWindowScale = 1;
  clickCount = 0;
  requireTrustedWindowSession = false;
  readonly trustedWindowSessions: string[] = [];
  clickResult: unknown = { effect: "Applied", route: "GlobalInput" };
  moveCursorResult: unknown = toolResult();
  startError: unknown;
  capabilityInventory = JSON.stringify({ tools: [] });
  healthReport = toolResult({ structuredJson: JSON.stringify(healthyCuaReport()) });
  verifyStateResult: unknown = toolResult({ structuredJson: JSON.stringify({ status: "satisfied", stable: true, samples: 2, predicates: [] }) });

  async callTool(name: string, argumentsJson: string): Promise<ReturnType<typeof toolResult>> {
    this.calls.push({ name, input: JSON.parse(argumentsJson) });
    if (name === "launch_app") return toolResult({ text: "launched", structuredJson: JSON.stringify({ pid: 9001 }) });
    if (name === "kill_app") return toolResult({ text: "terminated" });
    if (name === "invoke_menu") return toolResult({ text: "menu invoked", structuredJson: JSON.stringify({ effect: "Applied" }) });
    if (name === "health_report") return this.healthReport;
    if (["set_value", "type_text", "press_key", "scroll"].includes(name)) return toolResult({ text: `${name} applied`, structuredJson: JSON.stringify({ effect: "Applied" }) });
    throw new Error(`Unexpected generic Cua tool ${name}`);
  }

  async startSession(input: unknown): Promise<unknown> {
    this.calls.push({ name: "startSession", input });
    if (this.startError) throw this.startError;
    return {};
  }

  async setAgentCursorTheme(input: unknown): Promise<unknown> {
    this.calls.push({ name: "setAgentCursorTheme", input });
    return {};
  }

  async setAgentCursorEnabled(input: unknown): Promise<unknown> {
    this.calls.push({ name: "setAgentCursorEnabled", input });
    return {};
  }

  async getAgentCursorState(input: unknown): Promise<ReturnType<typeof toolResult>> {
    this.calls.push({ name: "getAgentCursorState", input });
    return toolResult({ structuredJson: JSON.stringify({ position: { x: 50, y: 60 } }) });
  }

  async getDesktopState(input: unknown): Promise<ReturnType<typeof toolResult>> {
    this.calls.push({ name: "getDesktopState", input });
    return this.liveDesktopState;
  }

  async listWindows(input: unknown, options?: unknown): Promise<unknown> {
    this.calls.push({ name: "listWindows", input });
    const trustedSession = options && typeof options === "object" && !Array.isArray(options)
      ? (options as Record<string, unknown>).trustedSession
      : undefined;
    if (typeof trustedSession === "string") this.trustedWindowSessions.push(trustedSession);
    if (this.requireTrustedWindowSession && typeof trustedSession !== "string") {
      throw new Error("this session has ended; call start_session explicitly to reuse its label");
    }
    return {
      windows: [{ windowId: this.liveWindowId, pid: 9001, appName: this.liveWindowAppName, title: this.liveWindowAppName, isOnScreen: true, minimized: false, bounds: { x: 0, y: 0, width: 800, height: 600 } }],
    };
  }

  async getWindowState(input: unknown): Promise<unknown> {
    this.calls.push({ name: "getWindowState", input });
    return {
      pid: 9001,
      windowId: 42n,
      snapshotId: "snapshot-1",
      appName: this.liveWindowAppName,
      windowTitle: this.liveWindowAppName,
      treeMarkdown: "- [0] push button \"Reveal safe result\"",
      screenshotWidth: this.liveWindowWidth,
      screenshotHeight: this.liveWindowHeight,
      screenshotScale: this.liveWindowScale,
      elements: [{ elementIndex: 1n, parentIndex: 0n, role: "button", depth: 1, elementToken: "element-1", label: "Reveal safe result", enabled: true, actions: ["click"], frame: { x: 150, y: 300, w: 80, h: 70 } }],
      window_bounds: { x: 50, y: 100, width: 800, height: 640 },
      images: [{ mimeType: "image/png", dataBase64: "b".repeat(100) }],
    };
  }

  async verifyState(input: unknown): Promise<unknown> {
    this.calls.push({ name: "verifyState", input });
    return this.verifyStateResult;
  }

  async moveCursor(input: unknown): Promise<unknown> {
    this.calls.push({ name: "moveCursor", input });
    return this.moveCursorResult;
  }

  async click(input: unknown): Promise<unknown> {
    this.calls.push({ name: "click", input });
    this.clickCount += 1;
    return this.clickResult;
  }

  async typeText(input: unknown): Promise<unknown> {
    this.calls.push({ name: "typeText", input });
    return toolResult();
  }

  async pressKey(input: unknown): Promise<unknown> {
    this.calls.push({ name: "pressKey", input });
    return toolResult();
  }

  async scroll(input: unknown): Promise<unknown> {
    this.calls.push({ name: "scroll", input });
    return toolResult();
  }

  async drag(input: unknown): Promise<unknown> {
    this.calls.push({ name: "drag", input });
    return toolResult();
  }

  async endSession(input: unknown): Promise<unknown> {
    this.calls.push({ name: "endSession", input });
    return {};
  }

  async shutdown(): Promise<void> {
    this.calls.push({ name: "shutdown", input: undefined });
  }
}

class LostLaunchAcknowledgementDriver extends FakeCuaDriver {
  launchAttempted = false;
  windowCount = 1;

  override async callTool(name: string, argumentsJson: string): Promise<ReturnType<typeof toolResult>> {
    if (name === "launch_app") {
      this.calls.push({ name, input: JSON.parse(argumentsJson) });
      this.launchAttempted = true;
      return toolResult({ text: "launch request timed out", isError: true, structuredJson: JSON.stringify({ pid: 9002 }) });
    }
    return super.callTool(name, argumentsJson);
  }

  override async listWindows(input: unknown): Promise<unknown> {
    this.calls.push({ name: "listWindows", input });
    if (!this.launchAttempted) return { windows: [] };
    return {
      windows: Array.from({ length: this.windowCount }, (_, index) => ({
        windowId: BigInt(90 + index),
        pid: 9002,
        appName: "Text Editor",
        title: "Text Editor",
        isOnScreen: true,
        minimized: false,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      })),
    };
  }
}

class LateNativeWindowDriver extends FakeCuaDriver {
  private windowPolls = 0;

  override async listWindows(input: unknown): Promise<unknown> {
    this.calls.push({ name: "listWindows", input });
    this.windowPolls += 1;
    if (this.windowPolls === 1) return { windows: [] };
    return {
      windows: [{
        windowId: this.liveWindowId,
        pid: 9001,
        appName: this.liveWindowAppName,
        title: this.liveWindowAppName,
        isOnScreen: true,
        minimized: false,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      }],
    };
  }
}

class LaunchWindowResultDriver extends FakeCuaDriver {
  constructor(private readonly returnedWindowCount = 1, private readonly returnedAppName = "Text Editor") {
    super();
  }

  override async callTool(name: string, argumentsJson: string): Promise<ReturnType<typeof toolResult>> {
    if (name !== "launch_app") return super.callTool(name, argumentsJson);
    this.calls.push({ name, input: JSON.parse(argumentsJson) });
    const windows = Array.from({ length: this.returnedWindowCount }, (_, index) => ({
      window_id: 42 + index,
      pid: 9001,
      app_name: this.returnedAppName,
      title: this.returnedAppName,
      is_on_screen: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    }));
    return toolResult({ text: "launched", structuredJson: JSON.stringify({ pid: 9001, running: true, windows }) });
  }
}

function trackedAbortSignal(): {
  readonly signal: AbortSignal;
  readonly listenerCount: () => number;
  readonly abort: () => void;
} {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const mutableSignal = {
    aborted: false,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (type === "abort" && listener) listeners.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
      if (type === "abort" && listener) listeners.delete(listener);
    },
  };
  const signal = mutableSignal as unknown as AbortSignal;
  return {
    signal,
    listenerCount: () => listeners.size,
    abort: () => {
      mutableSignal.aborted = true;
      for (const listener of [...listeners]) {
        if (typeof listener === "function") listener(new Event("abort"));
        else listener.handleEvent(new Event("abort"));
      }
    },
  };
}

function environment(driver: FakeCuaDriver, captureScope: "desktop" | "window" = "desktop"): CuaEnvironment {
  return new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "test-computer-session",
    displayId: "primary",
    captureScope,
    platform: "linux",
    environment: {
      DISPLAY: ":99",
      ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true",
    },
  });
}

const nativeCapabilityNames = [
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
];

class ProductionProbeDriver extends FakeCuaDriver {
  listToolsJson(): string {
    this.calls.push({ name: "listToolsJson", input: undefined });
    return this.capabilityInventory;
  }
}

class ExitedProcessLaunchDriver extends ProductionProbeDriver {
  constructor(private readonly exitedPid: number) {
    super();
  }

  override async callTool(name: string, argumentsJson: string): Promise<ReturnType<typeof toolResult>> {
    if (name !== "launch_app") return super.callTool(name, argumentsJson);
    this.calls.push({ name, input: JSON.parse(argumentsJson) });
    return toolResult({
      text: "launched",
      structuredJson: JSON.stringify({
        pid: this.exitedPid,
        running: true,
        windows: [{
          window_id: 42,
          pid: this.exitedPid,
          app_name: "Text Editor",
          title: "Text Editor",
          is_on_screen: true,
          bounds: { x: 0, y: 0, width: 800, height: 600 },
        }],
      }),
    });
  }
}

function productionReadyDriver(): ProductionProbeDriver {
  const driver = new ProductionProbeDriver();
  const schemaProperties: Readonly<Record<string, readonly string[]>> = {
    launch_app: ["launch_path"],
    kill_app: ["pid"],
    invoke_menu: ["pid", "window_id", "path"],
    list_windows: ["pid"],
    get_window_state: ["pid", "window_id"],
    click: ["capture_id", "element_token"],
    set_value: ["pid", "value"],
    type_text: ["text"],
    press_key: ["key"],
    scroll: ["direction"],
    verify_state: ["pid", "window_id", "expect"],
    set_agent_cursor_enabled: ["session", "enabled"],
    get_agent_cursor_state: ["session"],
    move_cursor: ["x", "y"],
  };
  driver.capabilityInventory = JSON.stringify({
    schema_version: "1",
    capability_version: "1",
    tools: nativeCapabilityNames.map((name) => ({
      name,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries((schemaProperties[name] ?? []).map((property) => [property, { type: "string" }])),
      },
    })),
  });
  return driver;
}

function productionSdkFor(driver: ProductionProbeDriver): never {
  return {
    SessionPermissionMode: { Bounded: "bounded" },
    CaptureScope: { Window: "Window", Desktop: "Desktop" },
    CursorReducedMotion: { Auto: "Auto" },
    TrustedSessionOptions: { new: (options: Record<string, unknown>) => options },
    createTrustedSession: (runtime: CuaDriverClient) => new Proxy(runtime, {
      get(target, property, receiver) {
        if (property === "close") return () => undefined;
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    CuaDriver: { createConfigured: () => driver },
  } as never;
}

test("CUA readiness requires an explicit X11 display and isolation opt-in", () => {
  assert.equal(inspectCuaReadiness({ platform: "linux", environment: {} }).available, false);
  assert.equal(inspectCuaReadiness({ platform: "linux", environment: { DISPLAY: ":0" } }).reason, "isolated-display-required");
  const ready = inspectCuaReadiness({
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });
  assert.equal(ready.available, true);
  assert.equal(ready.display, ":99");
});

test("CUA production preflight proves capabilities and health before any session starts", async () => {
  const driver = productionReadyDriver();
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "preflight-test",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  const readiness = await cua.preflight();

  assert.equal(readiness.available, true);
  assert.deepEqual(driver.calls.map((call) => call.name), ["listToolsJson", "health_report"]);
  assert.equal(cua.runtimeEvidence()?.visualRegionCapability, "unavailable");
});

test("CUA native evidence admits visual regions only when parsing and capture-bound click are both advertised", async () => {
  const driver = productionReadyDriver();
  const inventory = JSON.parse(driver.capabilityInventory) as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
  inventory.tools.push({
    name: "parse_visual_regions",
    inputSchema: { type: "object", properties: { capture_id: { type: "string" } } },
  });
  driver.capabilityInventory = JSON.stringify(inventory);
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "visual-capability-test",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await cua.preflight();

  assert.equal(cua.runtimeEvidence()?.visualRegionCapability, "available");
});

test("CUA native evidence keeps visual regions unavailable when the parser is present but click is not capture-bound", async () => {
  const driver = productionReadyDriver();
  const inventory = JSON.parse(driver.capabilityInventory) as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
  inventory.tools.push({
    name: "parse_visual_regions",
    inputSchema: { type: "object", properties: { capture_id: { type: "string" } } },
  });
  const click = inventory.tools.find((tool) => tool.name === "click");
  assert.ok(click);
  click.inputSchema.properties = { element_token: { type: "string" } };
  driver.capabilityInventory = JSON.stringify(inventory);
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "visual-capability-mismatch-test",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await cua.preflight();

  assert.equal(cua.runtimeEvidence()?.visualRegionCapability, "unavailable");
});

test("native generic dispatch rejects tools outside Anesu's code-owned ceiling before driver dispatch", async () => {
  const driver = new FakeCuaDriver();

  await assert.rejects(
    () => callNativeTool(driver, "browser_prepare", "{}"),
    (error: unknown) => error instanceof CuaEnvironmentError
      && error.code === "invalid-action"
      && /outside Anesu's code-owned dispatch ceiling/u.test(error.message),
  );
  assert.equal(driver.calls.length, 0);

  await callNativeTool(driver, "health_report", "{}");
  assert.deepEqual(driver.calls.map((call) => call.name), ["health_report"]);
});

test("CUA production preflight fails closed when capability proof is unavailable", async () => {
  const driver = new FakeCuaDriver();
  (driver as CuaDriverClient).listToolsJson = undefined;
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => cua.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "driver-failure" && /capability inventory/u.test(error.message),
  );
  assert.deepEqual(driver.calls, []);
});

test("CUA production preflight rejects an advertised contract without callable adapter methods", async () => {
  const driver = productionReadyDriver();
  (driver as CuaDriverClient).verifyState = undefined;
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "preflight-methods-test",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => cua.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && /callable methods.*verify_state/u.test(error.message),
  );
  assert.equal(driver.calls.some((call) => call.name === "health_report"), false);
});

test("CUA production preflight fails closed when health proof is unavailable or unhealthy", async () => {
  const missingHealthDriver = productionReadyDriver();
  (missingHealthDriver as CuaDriverClient).callTool = undefined;
  const missingHealth = new CuaEnvironment({
    driver: missingHealthDriver,
    driverMode: "production",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => missingHealth.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "driver-failure" && /health/u.test(error.message),
  );

  const unhealthyDriver = productionReadyDriver();
  unhealthyDriver.healthReport = toolResult({ structuredJson: JSON.stringify({ ...healthyCuaReport(), overall: "degraded" }) });
  const unhealthy = new CuaEnvironment({
    driver: unhealthyDriver,
    driverMode: "production",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => unhealthy.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "driver-failure" && /did not pass/u.test(error.message),
  );
});

test("CUA native preflight rejects a schema that does not require the fields Anesu sends", async () => {
  const driver = productionReadyDriver();
  const inventory = JSON.parse(driver.capabilityInventory) as { readonly tools: Array<{ readonly name: string; readonly inputSchema: Record<string, unknown> }> };
  const typeText = inventory.tools.find((tool) => tool.name === "type_text");
  assert.ok(typeText);
  typeText.inputSchema.required = [];
  driver.capabilityInventory = JSON.stringify(inventory);
  const cua = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "preflight-required-fields",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => cua.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && /type_text.*does not require fields/u.test(error.message),
  );
});

test("the application-owned native CUA owner caches successful capability proof", async () => {
  const driver = productionReadyDriver();
  let inventoryCalls = 0;
  const original = driver.listToolsJson.bind(driver);
  driver.listToolsJson = () => {
    inventoryCalls += 1;
    return original();
  };
  const owner = new CuaNativeDriverOwner({ createDriver: () => driver });

  await owner.preflight();
  await owner.preflight();

  assert.equal(inventoryCalls, 1);
  assert.match(owner.runtimeEvidence()?.packageVersion ?? "", /^\d+\.\d+\.\d+(?:[-+].*)?$/u);
  await owner.shutdown();
});

test("deterministic CUA fakes remain usable without production preflight methods", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);

  await cua.preflight();
  await cua.start();

  assert.deepEqual(driver.calls.map((call) => call.name), [
    "startSession",
    "setAgentCursorTheme",
    "setAgentCursorEnabled",
  ]);
});

test("the native CUA owner reuses one driver and shuts it down once", async () => {
  const driver = new FakeCuaDriver();
  let created = 0;
  const owner = new CuaNativeDriverOwner({
    createDriver: () => {
      created += 1;
      return driver;
    },
  });

  assert.equal(await owner.acquire(), driver);
  assert.equal(await owner.acquire(), driver);
  assert.equal(created, 1);

  await owner.shutdown();
  await owner.shutdown();
  assert.equal(driver.calls.filter((call) => call.name === "shutdown").length, 1);
});

test("CUA starts a named session and turns on the visible agent cursor", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);

  const readiness = await cua.start();

  assert.equal(readiness.available, true);
  assert.deepEqual(driver.calls.map((call) => call.name), [
    "startSession",
    "setAgentCursorTheme",
    "setAgentCursorEnabled",
  ]);
  assert.deepEqual(driver.calls[0]?.input, { session: "test-computer-session", captureScope: "Desktop" });
  assert.deepEqual(driver.calls[2]?.input, { session: "test-computer-session", enabled: true });
});

test("CUA moves only its session cursor to a fresh semantic target before accessibility input", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver, "window");
  await cua.start();
  const observation = await cua.observe();
  const action: ComputerEnvironmentAction = {
    actionId: "type-into-editor",
    operation: "type",
    observationId: observation.observationId,
    generation: observation.generation,
    windowPid: observation.windowPid,
    windowId: observation.windowId,
    windowSnapshotId: observation.windowSnapshotId,
    position: { kind: "element", token: "element-1" },
    inputMethod: "set_value",
    text: "visible cursor acceptance",
  };

  await cua.presentAction(action);
  const result = await cua.execute(action);

  assert.equal(result.ok, true);
  const cursorCall = driver.calls.find((call) => call.name === "moveCursor");
  const inputCall = driver.calls.find((call) => call.name === "set_value");
  assert.deepEqual(cursorCall?.input, {
    x: 190,
    y: 335,
    target: { tag: "Window", inner: { pid: 9001, windowId: 42n } },
    session: "test-computer-session",
  });
  assert.ok(driver.calls.indexOf(cursorCall!) < driver.calls.indexOf(inputCall!));
});

test("CUA surfaces a bounded cursor refusal reason before native input", async () => {
  const driver = new FakeCuaDriver();
  driver.moveCursorResult = toolResult({ isError: true, text: "Cursor overlay is unavailable for this task session." });
  const cua = environment(driver, "window");
  await cua.start();
  const observation = await cua.observe();
  const action: ComputerEnvironmentAction = {
    actionId: "type-into-editor",
    operation: "type",
    observationId: observation.observationId,
    generation: observation.generation,
    windowPid: observation.windowPid,
    windowId: observation.windowId,
    windowSnapshotId: observation.windowSnapshotId,
    position: { kind: "element", token: "element-1" },
    inputMethod: "set_value",
    text: "visible cursor acceptance",
  };

  await assert.rejects(cua.presentAction(action), /Cursor overlay is unavailable for this task session\./u);
  assert.equal(driver.calls.some((call) => call.name === "set_value"), false);
});

test("CUA uses a fresh trusted session for each task's sessionless window discovery on a shared driver", async () => {
  const driver = new FakeCuaDriver();
  driver.requireTrustedWindowSession = true;
  const trustedSessionOptions: Record<string, unknown>[] = [];
  const trustedTaskCalls: Array<{ readonly session: unknown; readonly method: string }> = [];
  const sdk = {
    SessionPermissionMode: { Bounded: 1 },
    CaptureScope: { Window: "Window", Desktop: "Desktop" },
    CursorReducedMotion: { Auto: "Auto" },
    TrustedSessionOptions: { new: (options: Record<string, unknown>) => options },
    createTrustedSession: (runtime: CuaDriverClient, options: Record<string, unknown>): CuaDriverClient => {
      trustedSessionOptions.push(options);
      const session = options.publicSession;
      assert.equal(typeof session, "string");
      return new Proxy(runtime, {
        get(target, property, receiver) {
          if (property === "close") return () => undefined;
          if (property === "listWindows") {
            return (input: unknown, callOptions?: unknown) => {
              trustedTaskCalls.push({ session, method: "listWindows" });
              return target.listWindows!(input, {
                ...(callOptions && typeof callOptions === "object" && !Array.isArray(callOptions) ? callOptions as Record<string, unknown> : {}),
                trustedSession: session,
              });
            };
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? (...args: unknown[]) => {
                trustedTaskCalls.push({ session, method: String(property) });
                return value.apply(target, args);
              }
            : value;
        },
      });
    },
  };
  const loadSdk = async () => sdk as never;
  const labels: string[] = [];

  for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
    const cua = new CuaEnvironment({
      driver,
      driverMode: "deterministic-fake",
      shutdownDriver: false,
      loadSdk,
      manifestPath: "/trusted/native.yaml",
      captureScope: "window",
      platform: "linux",
      environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    });
    labels.push(cua.sessionId);
    await cua.start();
    const observation = await cua.observe();
    assert.equal(observation.windowId, "42");
    await cua.close();
  }

  assert.equal(new Set(labels).size, 2);
  assert.deepEqual(trustedSessionOptions, labels.map((publicSession) => ({
    publicSession,
    mode: 1,
    ttlSeconds: 30n * 60n,
    idleTtlSeconds: 5n * 60n,
    capabilityManifestPath: "/trusted/native.yaml",
  })));
  assert.deepEqual(driver.trustedWindowSessions, labels);
  assert.deepEqual(
    [...new Set(trustedTaskCalls.map((call) => call.session))],
    labels,
  );
  for (const sessionId of labels) {
    assert.deepEqual(
      trustedTaskCalls.filter((call) => call.session === sessionId).map((call) => call.method),
      ["startSession", "setAgentCursorTheme", "setAgentCursorEnabled", "listWindows", "getWindowState", "getAgentCursorState", "endSession"],
    );
  }
  assert.deepEqual(driver.calls.filter((call) => call.name === "listWindows").map((call) => call.input), [
    { onScreenOnly: true },
    { onScreenOnly: true },
  ]);
  assert.equal(driver.calls.filter((call) => call.name === "shutdown").length, 0);
});

test("CUA launches only a code-resolved native application through the bounded generic tool seam", async () => {
  const driver = new FakeCuaDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-test",
    application: { launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await instance.start();
  const launch = driver.calls.find((call) => call.name === "launch_app");
  assert.deepEqual(launch?.input, { session: "native-launch-test", launch_path: "/usr/bin/gnome-text-editor" });
  await instance.observe();
  const windowState = driver.calls.find((call) => call.name === "getWindowState");
  assert.equal((windowState?.input as { readonly pid?: number }).pid, 9001);
  await instance.close();
  assert.deepEqual(driver.calls.find((call) => call.name === "kill_app")?.input, { pid: 9001, session: "native-launch-test" });
});

test("CUA binds the exact window returned by launch_app before polling", async () => {
  const driver = new LaunchWindowResultDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-window-result-test",
    application: { name: "Text Editor", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await instance.start();
  assert.equal(driver.calls.filter((call) => call.name === "listWindows").length, 0);
  await instance.observe();
  assert.deepEqual(driver.calls.find((call) => call.name === "getWindowState")?.input, {
    pid: 9001,
    windowId: 42n,
    session: "native-launch-window-result-test",
    includeAccessibilityTree: true,
    includeScreenshot: true,
    maxElements: 256,
    maxDepth: 16,
  });
  await instance.close();
});

test("CUA refuses multiple windows returned by launch_app instead of choosing one", async () => {
  const driver = new LaunchWindowResultDriver(2);
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-window-ambiguous-test",
    application: { name: "Text Editor", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => instance.start(),
    (error: unknown) => error instanceof CuaEnvironmentError && /multiple visible windows/u.test(error.message),
  );
  assert.equal(driver.calls.filter((call) => call.name === "listWindows").length, 0);
  assert.equal(driver.calls.filter((call) => call.name === "shutdown").length, 1);
});

test("CUA refuses a launch result whose window belongs to another application", async () => {
  const driver = new LaunchWindowResultDriver(1, "Calculator");
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-window-app-mismatch-test",
    application: { name: "Text Editor", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => instance.start(),
    (error: unknown) => error instanceof CuaEnvironmentError && /not the approved 'Text Editor' application/u.test(error.message),
  );
  assert.equal(driver.calls.filter((call) => call.name === "listWindows").length, 0);
});

test("CUA refuses a launch-returned window after its exact process has exited", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const exitedPid = child.pid;
  assert.ok(exitedPid);
  await once(child, "exit");

  const driver = new ExitedProcessLaunchDriver(exitedPid);
  driver.capabilityInventory = productionReadyDriver().capabilityInventory;
  const instance = new CuaEnvironment({
    driverMode: "production",
    sessionId: "native-launch-window-exited-process-test",
    application: { name: "Text Editor", launchPath: process.execPath },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    loadSdk: async () => productionSdkFor(driver),
  });

  await assert.rejects(
    () => instance.start(),
    (error: unknown) => error instanceof CuaEnvironmentError && /process exited before the next usable observation/u.test(error.message),
  );
  assert.equal(driver.calls.some((call) => call.name === "listWindows"), false);
  assert.equal(driver.calls.filter((call) => call.name === "shutdown").length, 1);
});

test("production native launch sends only the exact code-owned path", async () => {
  const driver = productionReadyDriver();
  driver.liveWindowAppName = "Calculator";
  const instance = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "native-installed-app-test",
    application: { name: "Calculator", launchPath: "/usr/bin/gnome-calculator", launchArguments: ["--equation", "2 + 2"] },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    loadSdk: async () => productionSdkFor(driver),
  });

  await instance.start();

  const names = driver.calls.map((call) => call.name);
  assert.equal(names.includes("list_apps"), false);
  assert.equal(names.filter((name) => name === "launch_app").length, 1);
  assert.deepEqual(driver.calls.find((call) => call.name === "launch_app")?.input, {
    session: "native-installed-app-test",
    launch_path: "/usr/bin/gnome-calculator",
    additional_arguments: ["--equation", "2 + 2"],
  });
});

test("production native launch does not broaden into desktop-wide app discovery", async () => {
  const driver = productionReadyDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "native-installed-command-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    loadSdk: async () => productionSdkFor(driver),
  });

  await instance.start();
  const launch = driver.calls.find((call) => call.name === "launch_app");
  assert.deepEqual(launch?.input, { session: "native-installed-command-test", launch_path: "/usr/bin/gnome-text-editor" });
  assert.equal(driver.calls.some((call) => call.name === "list_apps"), false);
  await instance.close();
});

test("production native launch remains Cua-authorized even without app inventory access", async () => {
  const driver = productionReadyDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "native-missing-app-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    loadSdk: async () => productionSdkFor(driver),
  });

  await instance.start();
  assert.equal(driver.calls.some((call) => call.name === "launch_app"), true);
  await instance.close();
});

test("production native preflight reports a missing code-owned application before launch", async () => {
  const driver = productionReadyDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "production",
    sessionId: "native-missing-installed-app-test",
    application: { name: "Notes", launchPath: "/usr/bin/anesu-app-that-does-not-exist" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => instance.preflight(),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "unavailable" && /not installed/u.test(error.message),
  );
  assert.equal(driver.calls.some((call) => call.name === "launch_app"), false);
});

test("CUA reconciles a lost native launch acknowledgement only to one new matching window", async () => {
  const driver = new LostLaunchAcknowledgementDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-reconcile-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await instance.start();
  assert.equal(driver.calls.some((call) => call.name === "launch_app"), true);
  const listWindowCalls = driver.calls.filter((call) => call.name === "listWindows");
  assert.deepEqual(listWindowCalls[listWindowCalls.length - 1]?.input, { pid: 9002, onScreenOnly: true });
  await instance.close();
});

test("CUA refuses a lost native launch acknowledgement when new matching windows are ambiguous", async () => {
  const driver = new LostLaunchAcknowledgementDriver();
  driver.windowCount = 2;
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-launch-ambiguous-reconcile-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await assert.rejects(
    () => instance.start(),
    (error: unknown) => error instanceof CuaEnvironmentError && /multiple windows are visible for PID 9002/u.test(error.message),
  );
});

test("CUA removes abort listeners after native window readiness polls complete", async () => {
  const driver = new LateNativeWindowDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-window-poll-listener-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });
  const tracked = trackedAbortSignal();

  await instance.start(tracked.signal);
  assert.equal(driver.calls.filter((call) => call.name === "listWindows").length, 2);
  assert.equal(tracked.listenerCount(), 0);
  await instance.close();
});

test("CUA cancels a native window readiness poll and removes its abort listener", async () => {
  const driver = new LateNativeWindowDriver();
  const instance = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-window-poll-cancel-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });
  const tracked = trackedAbortSignal();
  const abortTimer = setTimeout(tracked.abort, 5);

  await assert.rejects(
    () => instance.start(tracked.signal),
    (error: unknown) => error instanceof CuaEnvironmentError && /native window readiness was cancelled/u.test(error.message),
  );
  clearTimeout(abortTimer);
  assert.equal(driver.calls.filter((call) => call.name === "listWindows").length, 1);
  assert.equal(tracked.listenerCount(), 0);
  assert.equal(driver.calls.filter((call) => call.name === "shutdown").length, 1);
});

test("CUA surfaces host-driver startup failure as a distinct error", async () => {
  const driver = new FakeCuaDriver();
  driver.startError = new Error("native host driver crashed");
  const cua = environment(driver);

  await assert.rejects(
    () => cua.start(),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "driver-failure" && /host driver crashed/u.test(error.message),
  );
});

test("CUA observations are bounded and never expose screenshot bytes", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();

  const observation = await cua.observe();

  assert.equal(observation.imageCount, 1);
  assert.equal(observation.imageBytes, 200);
  assert.equal("images" in observation, false);
  assert.match(observation.text, /bounded observation/);
  assert.match(observation.structuredJson ?? "", /element-1/);
  assert.equal(observation.cursorX, 50);
  assert.equal(observation.cursorY, 60);
  assert.equal(observation.windowPid, 9001);
  assert.equal(observation.windowId, "42");
  assert.equal(observation.windowSnapshotId, "snapshot-1");
  assert.match(observation.structuredJson ?? "", /Reveal safe result/);
});

test("CUA desktop observations fail closed when the approved application changes", async () => {
  const driver = new FakeCuaDriver();
  const cua = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-desktop-binding-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    captureScope: "desktop",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await cua.start();
  driver.liveWindowAppName = "Calculator";

  await assert.rejects(
    () => cua.observe(),
    (error: unknown) => error instanceof CuaEnvironmentError && /not the approved 'Notes' application/u.test(error.message),
  );
  await cua.close();
});

test("CUA accepts code-owned Linux X11 application identities", async () => {
  const cases = [
    ["Notes", "gnome-text-editor"],
    ["Calendar", "gnome-calendar"],
    ["Clocks", "gnome-clocks"],
  ] as const;
  for (const [applicationName, windowAppName] of cases) {
    const driver = new FakeCuaDriver();
    driver.liveWindowAppName = windowAppName;
    const cua = new CuaEnvironment({
      driver,
      driverMode: "deterministic-fake",
      sessionId: `native-linux-identity-${applicationName.toLocaleLowerCase()}`,
      application: { name: applicationName, launchPath: `/usr/bin/${windowAppName}` },
      captureScope: "window",
      platform: "linux",
      environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    });

    await cua.start();
    const observation = await cua.observe();
    assert.equal(observation.windowPid, 9001);
    await cua.close();
  }
});

test("CUA native observation refuses Chrome and Edge windows", async () => {
  for (const browserName of ["Google Chrome", "Microsoft Edge"] as const) {
    const driver = new FakeCuaDriver();
    const cua = new CuaEnvironment({
      driver,
      driverMode: "deterministic-fake",
      sessionId: `native-browser-boundary-${browserName === "Google Chrome" ? "chrome" : "edge"}`,
      application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
      captureScope: "desktop",
      platform: "linux",
      environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
    });

    await cua.start();
    driver.liveWindowAppName = browserName;
    await assert.rejects(
      () => cua.observe(),
      (error: unknown) => error instanceof CuaEnvironmentError
        && /not the approved 'Notes' application/u.test(error.message),
    );
    await cua.close();
  }
});

test("CUA verify_state proves native predicates against the exact observed window", async () => {
  const driver = new FakeCuaDriver();
  const cua = new CuaEnvironment({
    driver,
    driverMode: "deterministic-fake",
    sessionId: "native-verify-state-test",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    captureScope: "window",
    platform: "linux",
    environment: { DISPLAY: ":99", ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: "true" },
  });

  await cua.start();
  const observation = await cua.observe();
  const result = await cua.verify({ kind: "native-app-open", expected: "Notes" }, observation);

  assert.ok(result);
  assert.equal(result.status, "verified");
  const call = driver.calls.find((entry) => entry.name === "verifyState");
  assert.deepEqual(call?.input, {
    pid: 9001n,
    windowId: 42n,
    expect: [{ window: { exists: true } }],
    session: "native-verify-state-test",
    timeoutMs: 5_000n,
    stableSamples: 2n,
    includeScreenshot: false,
  });
  const textResult = await cua.verify({ kind: "native-text-editor-value", expected: "Meeting notes" }, observation);
  assert.ok(textResult);
  assert.equal(textResult.status, "verified");
  const textCall = driver.calls.filter((entry) => entry.name === "verifyState").at(-1);
  assert.deepEqual((textCall?.input as { readonly expect?: unknown[] }).expect, [{
    element: { selector: { labelContains: "Meeting notes" }, exists: true },
  }]);
  await cua.close();
});

test("CUA verify_state unknown never becomes a native success", async () => {
  const driver = new FakeCuaDriver();
  driver.verifyStateResult = toolResult({ structuredJson: JSON.stringify({ status: "unknown", stable: false, samples: 1, predicates: [] }) });
  const cua = environment(driver, "window");
  await cua.start();
  const observation = await cua.observe();
  const result = await cua.verify({ kind: "native-app-open", expected: "Notes" }, observation);

  assert.ok(result);
  assert.equal(result.status, "unknown");
  assert.equal(result.evidence.cuaStatus, "unknown");
  await cua.close();
});

test("CUA verify_state refuses a stale native observation", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver, "window");
  await cua.start();
  const first = await cua.observe();
  await cua.observe();

  await assert.rejects(
    () => cua.verify({ kind: "native-app-open", expected: "Notes" }, first),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  await cua.close();
});

test("CUA window scope uses the exact accessibility snapshot instead of unauthorized desktop capture", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver, "window");

  await cua.start();
  const observation = await cua.observe();

  assert.deepEqual(driver.calls[0]?.input, { session: "test-computer-session", captureScope: "Window" });
  assert.equal(driver.calls.some((call) => call.name === "getDesktopState"), false);
  assert.equal(observation.screenWidth, 800);
  assert.equal(observation.screenHeight, 600);
  assert.equal(observation.imageCount, 1);
  assert.equal(observation.imageBytes, 100);
  assert.match(observation.text, /Reveal safe result/);
  assert.match(observation.structuredJson ?? "", /accessibility/);
  const structured = JSON.parse(observation.structuredJson ?? "{}") as { readonly accessibility?: { readonly elements?: ReadonlyArray<{ readonly frame?: unknown; readonly elementIndex?: unknown; readonly parentIndex?: unknown }> } };
  assert.deepEqual(structured.accessibility?.elements?.[0]?.frame, { x: 100, y: 160, width: 80, height: 70 });
  assert.equal(structured.accessibility?.elements?.[0]?.elementIndex, 1);
  assert.equal(structured.accessibility?.elements?.[0]?.parentIndex, 0);
});

test("CUA semantic clicks retain the exact observed window target and element token", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();
  const result = await cua.execute({
    actionId: "native_accessibility_click_0",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "element", token: "element-1" },
  });
  assert.equal(result.ok, true);
  const click = driver.calls.find((call) => call.name === "click");
  assert.deepEqual(click?.input, {
    target: { tag: "Window", inner: { pid: 9001, windowId: 42n } },
    position: { tag: "Element", inner: { elementToken: "element-1" } },
    deliveryMode: "Background",
    session: "test-computer-session",
    button: "Left",
    count: 1,
  });
});

test("CUA semantic native text, key, and scroll actions use exact element-bound tool calls", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();

  const typeObservation = await cua.observe();
  await cua.execute({
    actionId: "native_accessibility_type_0",
    operation: "type",
    observationId: typeObservation.observationId,
    generation: typeObservation.generation,
    windowPid: typeObservation.windowPid,
    windowId: typeObservation.windowId,
    windowSnapshotId: typeObservation.windowSnapshotId,
    position: { kind: "element", token: "element-1" },
    inputMethod: "set_value",
    text: "safe text",
  });
  const setValue = driver.calls.find((call) => call.name === "set_value");
  assert.deepEqual(setValue?.input, {
    pid: 9001,
    window_id: 42,
    element_token: "element-1",
    snapshot_id: "snapshot-1",
    session: "test-computer-session",
    value: "safe text",
  });

  const pressObservation = await cua.observe();
  await cua.execute({
    actionId: "native_accessibility_press_0",
    operation: "press",
    observationId: pressObservation.observationId,
    generation: pressObservation.generation,
    position: { kind: "element", token: "element-1" },
    key: "return",
  });
  const press = driver.calls.find((call) => call.name === "press_key");
  assert.deepEqual(press?.input, {
    pid: 9001,
    window_id: 42,
    element_token: "element-1",
    snapshot_id: "snapshot-1",
    session: "test-computer-session",
    key: "return",
    delivery_mode: "background",
  });

  const scrollObservation = await cua.observe();
  await cua.execute({
    actionId: "native_accessibility_scroll_0",
    operation: "scroll",
    observationId: scrollObservation.observationId,
    generation: scrollObservation.generation,
    position: { kind: "element", token: "element-1" },
    direction: "down",
    amount: 2,
  });
  const scroll = driver.calls.find((call) => call.name === "scroll");
  assert.deepEqual(scroll?.input, {
    pid: 9001,
    window_id: 42,
    element_token: "element-1",
    snapshot_id: "snapshot-1",
    session: "test-computer-session",
    direction: "down",
    amount: 2,
    by: "line",
    delivery_mode: "background",
  });
});

test("CUA native menu actions use the exact observed window and session-bound menu path", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  const result = await cua.execute({
    actionId: "native_accessibility_menu_0",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    windowPid: observation.windowPid,
    windowId: observation.windowId,
    windowSnapshotId: observation.windowSnapshotId,
    menuPath: ["New Event"],
  });

  assert.equal(result.ok, true);
  const menu = driver.calls.find((call) => call.name === "invoke_menu");
  assert.deepEqual(menu?.input, {
    pid: 9001,
    window_id: 42,
    path: ["New Event"],
    session: "test-computer-session",
  });
});

test("CUA coordinate clicks retain desktop coordinates when an accessible window is also observed", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  const result = await cua.execute({
    actionId: "desktop-coordinate-click",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates", x: 460, y: 320 },
  });

  assert.equal(result.ok, true);
  const click = driver.calls.find((call) => call.name === "click");
  assert.deepEqual(click?.input, {
    target: { tag: "Desktop", inner: { displayId: "primary" } },
    position: { tag: "Coordinates", inner: { x: 460, y: 320 } },
    deliveryMode: "Foreground",
    session: "test-computer-session",
    button: "Left",
    count: 1,
  });
});

test("CUA window coordinate clicks use the same window-local target as the screenshot", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver, "window");
  await cua.start();
  const observation = await cua.observe();

  const result = await cua.execute({
    actionId: "window-coordinate-click",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates", x: 460, y: 320 },
  });

  assert.equal(result.ok, true);
  const click = driver.calls.find((call) => call.name === "click");
  assert.deepEqual(click?.input, {
    target: { tag: "Window", inner: { pid: 9001, windowId: 42n } },
    position: { tag: "Coordinates", inner: { x: 460, y: 320 } },
    deliveryMode: "Foreground",
    session: "test-computer-session",
    button: "Left",
    count: 1,
  });
});

test("CUA consumes an observation before input and rejects stale or duplicate clicks", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();
  const action: ComputerEnvironmentAction = {
    actionId: "click-element-1",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates", x: 100, y: 200 },
  };

  const result = await cua.execute(action);
  assert.equal(result.ok, true);
  assert.equal(driver.clickCount, 1);
  await assert.rejects(
    () => cua.execute(action),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  assert.equal(driver.clickCount, 1);
});

test("CUA maps the bounded native action set to typed driver methods", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();

  const actions: Array<Pick<ComputerEnvironmentAction, "operation" | "position" | "endPosition" | "text" | "key" | "modifiers" | "direction" | "amount">> = [
    { operation: "move", position: { kind: "coordinates", x: 10, y: 20 } },
    { operation: "type", text: "safe text" },
    { operation: "press", key: "ENTER", modifiers: ["CTRL"] },
    { operation: "scroll", position: { kind: "coordinates", x: 100, y: 200 }, direction: "down", amount: 2 },
    { operation: "drag", position: { kind: "coordinates", x: 100, y: 200 }, endPosition: { kind: "coordinates", x: 200, y: 220 } },
  ];

  for (const [index, partial] of actions.entries()) {
    const observation = await cua.observe();
    const result = await cua.execute({
      actionId: `native-${index}`,
      observationId: observation.observationId,
      generation: observation.generation,
      ...partial,
    });
    assert.equal(result.ok, true);
  }

  assert.deepEqual(driver.calls.filter((call) => ["moveCursor", "typeText", "pressKey", "scroll", "drag"].includes(call.name)).map((call) => call.name), [
    "moveCursor",
    "typeText",
    "pressKey",
    "scroll",
    "drag",
  ]);
});

test("CUA refuses invalid coordinates before reaching the native driver", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  await assert.rejects(
    () => cua.execute({
      actionId: "invalid",
      operation: "click",
      observationId: observation.observationId,
      generation: observation.generation,
      position: { kind: "coordinates", x: -1, y: 20 },
    }),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "invalid-action",
  );
  assert.equal(driver.clickCount, 0);
});

test("CUA refuses coordinates outside the current observed screen", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  await assert.rejects(
    () => cua.execute({
      actionId: "outside-screen",
      operation: "click",
      observationId: observation.observationId,
      generation: observation.generation,
      position: { kind: "coordinates", x: 1_280, y: 719 },
    }),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "invalid-action",
  );
  assert.equal(driver.clickCount, 0);
});

test("CUA rejects native actions whose observed geometry or window identity is stale", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  await assert.rejects(
    () => cua.execute({
      actionId: "stale-geometry",
      operation: "click",
      observationId: observation.observationId,
      generation: observation.generation,
      screenWidth: (observation.screenWidth ?? 1) - 1,
      position: { kind: "coordinates", x: 100, y: 200 },
    }),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  await assert.rejects(
    () => cua.execute({
      actionId: "stale-window",
      operation: "click",
      observationId: observation.observationId,
      generation: observation.generation,
      windowId: "different-window",
      windowSnapshotId: observation.windowSnapshotId,
      position: { kind: "element", token: "element-1" },
    }),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  assert.equal(driver.clickCount, 0);
});

test("CUA revalidates live desktop and foreground window state before dispatch", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();
  const action = {
    actionId: "live-revalidation",
    operation: "click" as const,
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates" as const, x: 100, y: 200 },
  };

  driver.liveDesktopState = toolResult({ structuredJson: JSON.stringify({ screen_width: 1_024, screen_height: 720, scale_factor: 1 }) });
  await assert.rejects(
    () => cua.execute(action),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  driver.liveDesktopState = driver.state;
  driver.liveWindowId = 43n;
  await assert.rejects(
    () => cua.execute(action),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  assert.equal(driver.clickCount, 0);

  driver.liveWindowId = 42n;
  const windowCua = environment(driver, "window");
  await windowCua.start();
  const windowObservation = await windowCua.observe();
  driver.liveWindowWidth = 700;
  await assert.rejects(
    () => windowCua.execute({
      actionId: "stale-window-geometry",
      operation: "click",
      observationId: windowObservation.observationId,
      generation: windowObservation.generation,
      position: { kind: "element", token: "element-1" },
    }),
    (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation",
  );
  const liveWindowStateCalls = driver.calls.filter((call) => call.name === "getWindowState");
  assert.deepEqual(liveWindowStateCalls.at(-1)?.input, {
    pid: 9001,
    windowId: 42n,
    session: "test-computer-session",
    includeAccessibilityTree: false,
    includeScreenshot: true,
  });
});

test("CUA close is idempotent and ends the named session before shutdown", async () => {
  const driver = new FakeCuaDriver();
  const cua = environment(driver);
  await cua.start();

  await cua.close();
  await cua.close();

  assert.deepEqual(driver.calls.map((call) => call.name), [
    "startSession",
    "setAgentCursorTheme",
    "setAgentCursorEnabled",
    "endSession",
    "shutdown",
  ]);
});

test("CUA preserves refusal and uncertain native effects without retrying", async () => {
  const driver = new FakeCuaDriver();
  driver.clickResult = { effect: "Unverifiable", route: "GlobalInput" };
  const cua = environment(driver);
  await cua.start();
  const observation = await cua.observe();

  const result = await cua.execute({
    actionId: "uncertain-click",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates", x: 100, y: 200 },
  });

  assert.deepEqual(result, {
    ok: false,
    status: "unknown",
    summary: "CUA returned an uncertain effect for click uncertain-click; the observation was consumed and no retry was attempted.",
  });
  await assert.rejects(() => cua.execute({
    actionId: "uncertain-click",
    operation: "click",
    observationId: observation.observationId,
    generation: observation.generation,
    position: { kind: "coordinates", x: 100, y: 200 },
  }), (error: unknown) => error instanceof CuaEnvironmentError && error.code === "stale-observation");
  assert.equal(driver.clickCount, 1);
});
