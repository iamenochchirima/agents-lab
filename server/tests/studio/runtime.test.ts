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
  memoryRecordsAsMessages,
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

test("Memory-to-Context serialization preserves provenance without upgrading trust", () => {
  const messages = memoryRecordsAsMessages([{
    schemaVersion: 1,
    recordId: "fact-language",
    namespace: { comparisonId: "comparison-1", trialId: "trial-1", scenarioId: "scenario-1", sessionId: "session-1" },
    scope: "semantic",
    content: "English is preferred.",
    logicalKey: "support-language",
    source: "fixture-memory",
    sourceMessageIds: ["setup-1"],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    revision: 1,
    state: "active",
    supersedesRecordId: null,
    expiresAt: null,
    metadata: { fixture: "test" },
  }], "studio-scenario", "2026-09-20T00:01:00.000Z");

  assert.equal(messages[0]?.source, "memory");
  assert.deepEqual(messages[0]?.metadata, {
    memoryRecordId: "fact-language",
    memoryScope: "semantic",
    memorySource: "fixture-memory",
    memoryRevision: "1",
    memoryState: "active",
    memoryTrust: "retrieved-untrusted",
    memorySourceMessageIds: "setup-1",
    memoryComparisonId: "comparison-1",
    memoryTrialId: "trial-1",
    memoryScenarioId: "scenario-1",
    memorySessionId: "session-1",
    memoryLogicalKey: "support-language",
  });
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
