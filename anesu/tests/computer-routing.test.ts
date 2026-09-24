import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputerRouter } from "../src/computer/router.js";
import { routeComputerRequest, strategyOrder, type ComputerSurface } from "../src/computer/routing.js";
import type { ComputerContext, ComputerOutcome, ComputerStrategy } from "../src/computer/runner.js";
import { compileComputerTask } from "../src/computer/task.js";

test("computer routing sends URL and page requests to the browser", () => {
  const route = routeComputerRequest("Open kasitek.co.za and click the pricing link.", {
    availableSurfaces: ["browser", "desktop"],
    preferredSurface: "desktop",
  });

  assert.equal(route.surface, "browser");
  assert.equal(route.reason, "The request names a URL or browser page interaction.");
});

test("ordinary desktop-browser wording remains a browser route", () => {
  const route = routeComputerRequest("Open the desktop browser and click the pricing link.", {
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.kind, "single-surface");
  assert.equal(route.surface, "browser");
});

test("computer routing sends screen and application requests to the desktop", () => {
  const route = routeComputerRequest("Look at the desktop and click the visible Settings window.", {
    availableSurfaces: ["browser", "desktop"],
    preferredSurface: "browser",
  });

  assert.equal(route.surface, "desktop");
  assert.equal(route.reason, "The request names a desktop, screen, window, or native input interaction.");
});

test("native application intent wins over the editor's generic new-tab wording", () => {
  const route = routeComputerRequest("Open Notes and type the text into a new document tab.", {
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.kind, "single-surface");
  assert.equal(route.surface, "desktop");
});

test("expanded native application names select the desktop surface", () => {
  for (const goal of ["Open the Files app.", "Open System Settings.", "Open Terminal.", "Open VS Code."]) {
    const route = routeComputerRequest(goal, { availableSurfaces: ["browser", "desktop"] });
    assert.equal(route.surface, "desktop", goal);
  }
});

test("an explicit browser term still wins when native wording is also present", () => {
  const route = routeComputerRequest("Open Notes in the browser and inspect the page.", {
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.kind, "mixed-surface");
  assert.equal(route.surface, "ambiguous");
});

test("computer routing marks an explicit browser-plus-native goal as a mixed-surface boundary", () => {
  const route = routeComputerRequest("Open example.com, read the heading, then write it in Text Editor.", {
    surface: "browser",
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.kind, "mixed-surface");
  assert.equal(route.surface, "ambiguous");
  assert.match(route.reason, /coordinated mixed-surface path/u);
});

test("explicit surface selection wins over natural-language cues", () => {
  const route = routeComputerRequest("Open kasitek.co.za in the browser.", {
    surface: "desktop",
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.surface, "desktop");
  assert.equal(route.explicit, true);
});

test("computer routing uses the configured preferred surface for an otherwise ambiguous request", () => {
  const surface: ComputerSurface = "desktop";
  const route = routeComputerRequest("Click the visible button.", {
    availableSurfaces: ["browser", "desktop"],
    preferredSurface: surface,
  });

  assert.equal(route.surface, surface);
  assert.equal(route.reason, "The request is surface-neutral, so the configured available surface is used.");
});

test("computer routing asks for clarification when both surfaces are available and no preference exists", () => {
  const route = routeComputerRequest("Click the visible button.", {
    availableSurfaces: ["browser", "desktop"],
  });

  assert.equal(route.surface, "ambiguous");
  assert.equal(route.reason, "The request could refer to either the managed browser or the desktop.");
});

test("computer routing reports an unavailable requested surface instead of switching silently", () => {
  const route = routeComputerRequest("Open the visible desktop application.", {
    availableSurfaces: ["browser"],
  });

  assert.equal(route.surface, "unavailable");
  assert.equal(route.reason, "The request requires the desktop, but no permitted desktop environment is available.");
});

test("automatic strategy prefers Jev and permits one traditional fallback", () => {
  assert.deepEqual(
    strategyOrder("auto", { typesafe: true, traditional: true }),
    ["typesafe", "traditional"],
  );
  assert.deepEqual(
    strategyOrder("auto", { typesafe: false, traditional: true }),
    ["traditional"],
  );
  assert.deepEqual(
    strategyOrder("auto", { typesafe: true, traditional: false }),
    ["typesafe"],
  );
});

test("explicit strategy selection never adds a hidden fallback", () => {
  assert.deepEqual(strategyOrder("typesafe", { typesafe: true, traditional: true }), ["typesafe"]);
  assert.deepEqual(strategyOrder("traditional", { typesafe: true, traditional: true }), ["traditional"]);
  assert.deepEqual(strategyOrder("compare", { typesafe: true, traditional: true }), ["compare"]);
});

test("explicit retired strategies are unavailable when the runtime does not advertise them", () => {
  assert.deepEqual(strategyOrder("traditional", { typesafe: true, traditional: false }), []);
  assert.deepEqual(strategyOrder("compare", { typesafe: true, traditional: false }), []);
  assert.deepEqual(strategyOrder("typesafe", { typesafe: false, traditional: true }), []);
});

function fakePath(
  strategy: ComputerStrategy,
  outcome: ComputerOutcome,
  events: readonly Parameters<NonNullable<ComputerContext["onComputer"]>>[0][],
  calls: string[],
) {
  return {
    run: async (callId: string, _goal: unknown, context: ComputerContext): Promise<ComputerOutcome> => {
      calls.push(`${strategy}:${callId}`);
      for (const event of events) await context.onComputer?.(event);
      return outcome;
    },
  };
}

const fakeTypeSafePreflight = async () => ({ requestedModel: "jev-test", resolvedModel: "jev-test" });

test("automatic routing may switch from Jev to traditional before any action", async () => {
  const events: Parameters<NonNullable<ComputerContext["onComputer"]>>[0][] = [];
  const calls: string[] = [];
  const router = new ComputerRouter({
    strategy: "auto",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    browser: {
      availableStrategies: { typesafe: true, traditional: true },
      create: (strategy) => strategy === "typesafe"
        ? fakePath("typesafe", { ok: false, content: "", summary: "Jev abstained", errorCode: "computer-confidence-abstention" }, [
            { type: "started", callId: "call", strategy: "typesafe", goal: "click it", environment: "browser" },
            { type: "abstained", strategy: "typesafe", reason: "Jev abstained" },
          ], calls)
        : fakePath("traditional", { ok: true, content: "verified", summary: "traditional verified" }, [
            { type: "started", callId: "call", strategy: "traditional", goal: "click it", environment: "browser" },
            { type: "proposed", strategy: "traditional", actionId: "click", candidateId: "button", observationId: "observation", operation: "click" },
            { type: "act_requested", strategy: "traditional", actionId: "click", candidateId: "button", observationId: "observation", operation: "click" },
            { type: "verified", strategy: "traditional", actionId: "click", observationId: "observation", success: true, terminal: true },
          ], calls),
    },
  });

  const result = await router.run("call", "Click it", { onComputer: (event) => { events.push(event); } });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["typesafe:call", "traditional:call"]);
  assert.equal(events[0]?.type, "routed");
  assert.equal(events[1]?.type, "started");
  assert.equal((events[1] as { readonly strategy?: string }).strategy, "traditional");
  assert.equal((events[1] as { readonly fallbackFrom?: string }).fallbackFrom, "typesafe");
  assert.equal(events.some((event) => event.type === "act_requested"), true);
  assert.equal(events.some((event) => event.type === "abstained"), false);
});

test("automatic routing never switches after an action was requested", async () => {
  const events: Parameters<NonNullable<ComputerContext["onComputer"]>>[0][] = [];
  const calls: string[] = [];
  const router = new ComputerRouter({
    strategy: "auto",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    browser: {
      availableStrategies: { typesafe: true, traditional: true },
      create: (strategy) => {
        const selected = strategy === "compare" ? "traditional" : strategy;
        return fakePath(selected, { ok: false, content: "", summary: "input outcome unknown", errorCode: "computer-provider-timeout" }, [
          { type: "started", callId: "call", strategy: selected, goal: "click it", environment: "browser" },
          { type: "act_requested", strategy: selected, actionId: "click", candidateId: "button", observationId: "observation", operation: "click" },
          { type: "failed", strategy: selected, reason: "input outcome unknown", runStatus: "outcome-unknown", errorCode: "computer-provider-timeout" },
        ], calls);
      },
    },
  });

  const result = await router.run("call", "Click it", { onComputer: (event) => { events.push(event); } });

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["typesafe:call"]);
  assert.equal(events.filter((event) => event.type === "act_requested").length, 1);
  assert.equal(events.some((event) => event.type === "started" && event.strategy === "traditional"), false);
});

test("automatic routing returns a clear result for an ambiguous surface", async () => {
  let called = false;
  const router = new ComputerRouter({
    strategy: "auto",
    browser: { availableStrategies: { typesafe: true, traditional: true }, create: () => ({ run: async () => { called = true; return { ok: true, content: "", summary: "unexpected" }; } }) },
    desktop: { availableStrategies: { typesafe: true, traditional: true }, create: () => ({ run: async () => { called = true; return { ok: true, content: "", summary: "unexpected" }; } }) },
  });

  const result = await router.run("call", "Click the visible button");

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "computer-surface-ambiguous");
  assert.equal(called, false);
});

test("mixed-surface routing coordinates both child paths under one task grant", async () => {
  const calls: string[] = [];
  const approvals: string[] = [];
  const compileTask = ({ taskId, goal, surface }: { readonly taskId: string; readonly goal: string; readonly surface: "browser" | "native" }) => ({
    taskId,
    originalGoal: goal,
    surface,
    ...(surface === "native" ? { application: { name: "Text Editor", launchPath: "/usr/bin/text-editor" } } : {}),
    profile: { mode: "isolated_new" as const },
    timeZone: "Africa/Johannesburg",
    inputRoute: "trusted" as const,
    allowedOrigins: ["https://example.com"],
    values: {},
    allowedActions: surface === "browser" ? ["prepare", "navigate"] as const : ["launch", "type"] as const,
    completion: surface === "browser"
      ? { kind: "browser-heading" as const }
      : { kind: "native-text-editor-value" as const, expected: "Example Domain" },
    maxActions: 2,
    deadlineMs: 10_000,
    createdAtMs: 1_000,
    expiresAtMs: 11_000,
    grantHash: `${taskId}-child`,
  });
  const router = new ComputerRouter({
    strategy: "auto",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    compileTask,
    browser: { availableStrategies: { typesafe: true, traditional: false }, create: () => ({ run: async () => { calls.push("browser"); return { ok: true, content: JSON.stringify({ status: "completed", verification: "browser-heading", verificationEvidence: { observed: "Example Domain" } }), summary: "browser heading verified" }; } }) },
    desktop: { availableStrategies: { typesafe: true, traditional: false }, create: () => ({ run: async () => { calls.push("desktop"); return { ok: true, content: "native verified", summary: "native value verified" }; } }) },
  });

  const result = await router.run("call", "Open example.com, read the heading, then write it in Text Editor", {
    approveComputerTask: async (request) => {
      approvals.push(request.surface);
      return { decision: "allow-task", grantHash: request.grantHash };
    },
  });

  assert.equal(result.ok, true, result.content);
  assert.deepEqual(calls, ["browser", "desktop"]);
  assert.deepEqual(approvals, ["mixed"]);
});

test("selected computer path is preflighted before it can start a task", async () => {
  const events: string[] = [];
  const router = new ComputerRouter({
    strategy: "typesafe",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      preflight: async () => { events.push("preflight"); },
      create: () => ({
        run: async () => { events.push("run"); return { ok: true, content: "verified", summary: "verified" }; },
      }),
    },
  });

  const result = await router.run("call", "Open example.com");
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["preflight", "run"]);
});

test("Jev readiness is proved before the path can emit a started event", async () => {
  const order: string[] = [];
  let model: unknown;
  const router = new ComputerRouter({
    strategy: "typesafe",
    surface: "browser",
    typeSafePreflight: async () => {
      order.push("jev");
      return { requestedModel: "jev-latest", resolvedModel: "jev-2026-09-01" };
    },
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      preflight: async () => { order.push("cua"); },
      create: () => ({
        run: async (_callId, _goal, context) => {
          order.push("run");
          model = context.typeSafeModel;
          await context.onComputer?.({ type: "started", callId: "call", strategy: "typesafe", goal: "Open example.com", environment: "browser", typeSafeModel: context.typeSafeModel });
          return { ok: true, content: "verified", summary: "verified" };
        },
      }),
    },
  });

  const result = await router.run("call", "Open example.com");
  assert.equal(result.ok, true);
  assert.deepEqual(order, ["cua", "jev", "run"]);
  assert.deepEqual(model, { requestedModel: "jev-latest", resolvedModel: "jev-2026-09-01" });
});

test("runtime task serialization prevents concurrent browser runs from sharing state", async () => {
  let active = 0;
  let maximumActive = 0;
  const order: string[] = [];
  let tail: Promise<void> = Promise.resolve();
  const browserRunExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const router = new ComputerRouter({
    strategy: "typesafe",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    browserRunExclusive,
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      create: () => ({
        run: async (callId: string) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          order.push(`start:${callId}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push(`end:${callId}`);
          active -= 1;
          return { ok: true, content: "verified", summary: "verified" };
        },
      }),
    },
  });

  await Promise.all([router.run("first", "Open example.com"), router.run("second", "Open example.com")]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ["start:first", "end:first", "start:second", "end:second"]);
});

test("a failed computer preflight stops before approval or execution", async () => {
  let started = false;
  const router = new ComputerRouter({
    strategy: "typesafe",
    surface: "browser",
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      preflight: async () => { throw new Error("missing browser capability: browser_prepare"); },
      create: () => ({ run: async () => { started = true; return { ok: true, content: "unexpected", summary: "unexpected" }; } }),
    },
  });

  const result = await router.run("call", "Open example.com");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "computer-driver-failure");
  assert.match(result.summary, /missing browser capability/u);
  assert.equal(started, false);
});

test("surface admission uses the original user wording when the model rewrites its tool goal", async () => {
  const started: string[] = [];
  const router = new ComputerRouter({
    strategy: "auto",
    preferredSurface: "desktop",
    typeSafePreflight: fakeTypeSafePreflight,
    browser: { availableStrategies: { typesafe: true, traditional: false }, create: () => ({ run: async () => ({ ok: false, content: "", summary: "browser should not run" }) }) },
    desktop: { availableStrategies: { typesafe: true, traditional: false }, create: () => ({ run: async (_callId, _goal, context) => {
      await context.onComputer?.({ type: "started", callId: "call", strategy: "typesafe", goal: "Open the browser page and click the button", environment: "ubuntu-x11-cua" });
      started.push("desktop");
      return { ok: true, content: "verified", summary: "desktop verified" };
    } }) },
  });

  const result = await router.run("call", "Open the browser page and click the button", {
    routingGoal: "Inspect the screen and click the visible desktop button.",
    onComputer: () => undefined,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(started, ["desktop"]);
});

test("task compilation uses the original user wording, not a model-restated computer goal", async () => {
  let compiledGoal: string | undefined;
  const sourceGoal = 'Open http://127.0.0.1:4173/files and upload "workspace/browser-acceptance.txt".';
  const router = new ComputerRouter({
    strategy: "typesafe",
    surface: "browser",
    typeSafePreflight: fakeTypeSafePreflight,
    compileTask: ({ taskId, goal, surface }) => {
      compiledGoal = goal;
      return compileComputerTask({
        taskId,
        goal,
        surface,
        allowedOrigins: ["http://127.0.0.1:4173"],
        maxActions: 3,
        nowMs: 1_000,
        deadlineMs: 30_000,
      });
    },
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      create: () => ({ run: async () => ({ ok: true, content: "verified", summary: "verified" }) }),
    },
  });

  const result = await router.run("upload_call", "Upload the selected file to the form.", {
    taskGoal: sourceGoal,
  });

  assert.equal(result.ok, true);
  assert.equal(compiledGoal, sourceGoal);
});
