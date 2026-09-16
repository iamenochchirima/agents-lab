import assert from "node:assert/strict";
import test from "node:test";

import { validateRunRequest } from "../../src/control-plane/domain/manifest.js";
import {
  CONFORMANCE_CASES,
  CONFORMANCE_SCENARIO_ID,
  PRIORITY_PLATFORMS,
  assertConformanceEvents,
  buildConformanceRequest,
  conformanceCase,
} from "./workload.js";

test("the conformance matrix has three explicit workload cases", () => {
  assert.deepEqual(CONFORMANCE_CASES.map((candidate) => candidate.id), [
    "prompt-completion",
    "calculator-tool",
    "context-continuation",
  ]);
  assert.deepEqual(PRIORITY_PLATFORMS, ["temporal", "restate", "langgraph", "mastra"]);
  assert.equal(conformanceCase("calculator-tool").enabledTools[0], "calculator");
});

test("conformance requests reuse the generic run shape and stable turn IDs", () => {
  const request = buildConformanceRequest("restate", "calculator-tool");

  assert.deepEqual(request, {
    platform: "restate",
    variant: "baseline",
    clientTurnId: "calculator-tool-turn-1",
    task: { kind: "prompt", prompt: "Use the calculator tool to add 17 and 25, then state the result." },
    model: { provider: "fake", model: "fake-tool-call" },
    capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 } },
    selection: { scenarioId: CONFORMANCE_SCENARIO_ID },
  });
});

test("the context workload requires one explicit session and keeps turn identity separate", () => {
  const first = buildConformanceRequest("temporal", "context-continuation", {
    sessionId: "conformance-session-1",
    turnIndex: 0,
  });
  const second = buildConformanceRequest("temporal", "context-continuation", {
    sessionId: "conformance-session-1",
    turnIndex: 1,
  });

  assert.equal(first.sessionId, second.sessionId);
  assert.notEqual(first.clientTurnId, second.clientTurnId);
  assert.notEqual(first.task.prompt, second.task.prompt);
  assert.throws(() => buildConformanceRequest("temporal", "context-continuation"), /explicit sessionId/);
});

test("tool conformance assertions require actual tool lifecycle evidence", () => {
  const events = [
    event("run-1", "event-1", "AgentStarted"),
    event("run-1", "event-2", "ModelRequested"),
    event("run-1", "event-3", "ToolCallRequested"),
    event("run-1", "event-4", "ToolExecutionCompleted"),
    event("run-1", "event-5", "AgentCompleted"),
  ];

  assertConformanceEvents(conformanceCase("calculator-tool"), events);
  assert.throws(
    () => assertConformanceEvents(conformanceCase("calculator-tool"), events.filter((item) => item.kind !== "ToolExecutionCompleted")),
    /tool outcome/,
  );
});

test("capability declarations reject duplicate or unbounded tool settings", () => {
  const request = buildConformanceRequest("mastra", "calculator-tool");
  assert.doesNotThrow(() => validateRunRequest(request));

  assert.throws(
    () => validateRunRequest({
      ...request,
      capabilities: { tools: { enabledNames: ["calculator", "calculator"], maxRounds: 6, maxCalls: 8 } },
    }),
    /Duplicate enabled tool/,
  );
  assert.throws(
    () => validateRunRequest({
      ...request,
      capabilities: { tools: { enabledNames: ["calculator"], maxRounds: 33, maxCalls: 8 } },
    }),
    /maxRounds/,
  );
});

function event(runId: string, eventId: string, kind: string) {
  return {
    schemaVersion: 1 as const,
    eventId,
    recordedSequence: Number(eventId.replace("event-", "")),
    source: "conformance-test",
    sourceSequence: Number(eventId.replace("event-", "")),
    kind,
    runId,
    occurredAt: "2026-09-17T00:00:00.000Z",
    payload: {},
  };
}
