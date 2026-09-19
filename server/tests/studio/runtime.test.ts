import assert from "node:assert/strict";
import test from "node:test";

import { ReplayModelAdapter } from "../../src/studio/adapters/replay-model.js";
import { FullHistoryStrategy } from "../../src/studio/strategies/index.js";
import {
  BoundedControlLoop,
  ContainedExecutionEnvironment,
  FixtureMemoryStore,
  FixtureToolUseAdapter,
  FailClosedSafetyGate,
  ResponseCollector,
  SingleStepPlanner,
  StudioEventObservability,
  UnavailableComputerUseAdapter,
  createBaselineStudioComponents,
} from "../../src/studio/runtime/baseline-components.js";
import {
  StudioHarnessCompositionError,
  assertStudioHarnessComponents,
} from "../../src/studio/runtime/harness-runtime.js";

test("the baseline kernel composition exposes all twelve component slots", () => {
  const components = createBaselineStudioComponents({
    context: new FullHistoryStrategy(),
    model: new ReplayModelAdapter(),
  });

  assert.deepEqual(Object.keys(components).sort(), [
    "computerUse",
    "context",
    "control",
    "environment",
    "input",
    "memory",
    "model",
    "observability",
    "output",
    "planner",
    "safety",
    "tools",
  ]);
  assert.equal(components.computerUse.inspectModelResponse(components.model as never).status, "unavailable");
  assert.equal(components.environment.network, "disabled");
  assert.equal(components.environment.filesystem, "fixture-only");
  assert.equal(components.environment.sideEffects, "disabled");
  assert.deepEqual(components.tools.definitions().map((definition) => definition.name), ["studio_echo"]);
  assert.equal(components.tools.validate({ toolCallId: "call-1", name: "studio_echo", arguments: { value: "ok" }, round: 1 }).accepted, true);
  assert.equal(components.tools.validate({ toolCallId: "call-2", name: "unknown", arguments: {}, round: 1 }).accepted, false);
});

test("baseline adapters have explicit identities and bounded behaviour", async () => {
  const components = createBaselineStudioComponents({
    context: new FullHistoryStrategy(),
    model: new ReplayModelAdapter(),
  });
  const adapters = [
    components.input,
    components.memory,
    components.planner,
    components.tools,
    components.computerUse,
    components.control,
    components.environment,
    components.output,
    components.safety,
    components.observability,
  ];
  for (const adapter of adapters) {
    assert.match(adapter.adapterId, /^[a-z0-9-]+$/);
    assert.equal(adapter.adapterVersion, "1");
  }
  assert.equal(components.control.maxTurns, 1);
  const written = await components.memory.write({ trialId: "trial-1", output: "fixture output", signal: new AbortController().signal });
  assert.deepEqual(written.writtenRecordIds, ["working-trial-1"]);
  const read = await components.memory.read({ task: "fixture", signal: new AbortController().signal });
  assert.deepEqual(read.retrievedRecordIds, ["working-trial-1"]);
  assert.equal(read.records[0].scope, "working");
});

test("the runtime rejects a composition with a missing required slot", () => {
  assert.throws(
    () => assertStudioHarnessComponents({} as never),
    (error: unknown) => error instanceof StudioHarnessCompositionError && /slot is missing/.test((error as Error).message),
  );
});

test("the replay adapter returns its fixture response without grading context", async () => {
  const response = await new ReplayModelAdapter().complete({
    model: "context-replay-v1",
    task: "answer",
    messages: [],
    seed: "seed-1",
    requiredMessageId: "missing-source",
    expectedAnswer: "fixture answer",
  });
  assert.equal(response.output, "fixture answer");
});
