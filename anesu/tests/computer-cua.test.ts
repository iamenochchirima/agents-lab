import assert from "node:assert/strict";
import test from "node:test";
import {
  CuaEnvironment,
  CuaEnvironmentError,
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

class FakeCuaDriver implements CuaDriverClient {
  readonly calls: Array<{ name: string; input: unknown }> = [];
  readonly state = toolResult({
    text: "desktop state with a bounded observation",
    images: [{ mimeType: "image/png", dataBase64: "a".repeat(200) }],
    structuredJson: JSON.stringify({ screen_width: 1_280, screen_height: 720, elements: [{ token: "element-1" }] }),
  });
  liveDesktopState = this.state;
  liveWindowId = 42n;
  liveWindowWidth = 800;
  liveWindowHeight = 600;
  liveWindowScale = 1;
  clickCount = 0;
  clickResult: unknown = { effect: "Applied", route: "GlobalInput" };
  startError: unknown;

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

  async listWindows(input: unknown): Promise<unknown> {
    this.calls.push({ name: "listWindows", input });
    return {
      windows: [{ windowId: this.liveWindowId, pid: 9001, appName: "Fixture", title: "Fixture", isOnScreen: true, minimized: false, bounds: { x: 0, y: 0, width: 800, height: 600 } }],
    };
  }

  async getWindowState(input: unknown): Promise<unknown> {
    this.calls.push({ name: "getWindowState", input });
    return {
      pid: 9001,
      windowId: 42n,
      snapshotId: "snapshot-1",
      appName: "Fixture",
      windowTitle: "Fixture",
      treeMarkdown: "- [0] push button \"Reveal safe result\"",
      screenshotWidth: this.liveWindowWidth,
      screenshotHeight: this.liveWindowHeight,
      screenshotScale: this.liveWindowScale,
      elements: [{ elementIndex: 1n, role: "button", depth: 1, elementToken: "element-1", label: "Reveal safe result", enabled: true, actions: ["click"], frame: { x: 150, y: 300, w: 80, h: 70 } }],
      window_bounds: { x: 50, y: 100, width: 800, height: 640 },
      images: [{ mimeType: "image/png", dataBase64: "b".repeat(100) }],
    };
  }

  async moveCursor(input: unknown): Promise<unknown> {
    this.calls.push({ name: "moveCursor", input });
    return toolResult();
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

function environment(driver: FakeCuaDriver, captureScope: "desktop" | "window" = "desktop"): CuaEnvironment {
  return new CuaEnvironment({
    driver,
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
  const structured = JSON.parse(observation.structuredJson ?? "{}") as { readonly accessibility?: { readonly elements?: ReadonlyArray<{ readonly frame?: unknown }> } };
  assert.deepEqual(structured.accessibility?.elements?.[0]?.frame, { x: 100, y: 160, width: 80, height: 70 });
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
