import assert from "node:assert/strict";
import test from "node:test";

import {
  PlanningError,
  createSingleStepResponsePlanner,
  parsePlanningConfig,
} from "../dist/index.js";

const signal = () => new AbortController().signal;

function input(overrides = {}) {
  return {
    scope: { runId: "run-planning-test", turnId: "turn-1" },
    task: "Summarize the report and include its date.",
    context: [
      { role: "system", content: "Be concise.", sourceIds: ["policy-1"] },
      { role: "user", content: "Use the attached report.", sourceIds: ["input-1"] },
      { role: "assistant", content: "I will inspect it.", sourceIds: ["input-1"] },
    ],
    observations: [
      { observationId: "observation-1", kind: "tool-result", summary: "Report opened.", sourceId: "tool-result-1" },
    ],
    ...overrides,
  };
}

test("proposes the same single response step for the same task and records distinct source IDs", async () => {
  const planner = createSingleStepResponsePlanner();
  const request = input();
  const first = await planner.propose(request, signal());
  const second = await planner.propose(request, signal());

  assert.deepEqual(first, second);
  assert.equal(planner.identity.id, "single-step-response-planner");
  assert.equal(planner.identity.version, "0.1.0");
  assert.equal(first.summary, "Produce a response to the supplied task.");
  assert.equal(first.steps.length, 1);
  assert.equal(first.steps[0].kind, "respond");
  assert.equal(first.steps[0].description, "Respond to the supplied task.");
  assert.equal(first.completionCondition, "The task has a recorded response.");
  assert.deepEqual(first.assumptions, []);
  assert.deepEqual(first.evidence.sourceIdsConsidered, ["policy-1", "input-1", "tool-result-1"]);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.steps));
  assert.notEqual(first.planId, "");
});

test("previous plans are validated but do not change the baseline proposal", async () => {
  const planner = createSingleStepResponsePlanner();
  const request = input();
  const prior = await planner.propose(request, signal());
  const withPrior = await planner.propose(input({ previousPlan: prior }), signal());

  assert.equal(withPrior.steps.length, 1);
  assert.equal(withPrior.steps[0].kind, "respond");
  assert.equal(withPrior.steps[0].description, prior.steps[0].description);
  assert.notEqual(withPrior.planId, prior.planId);
  await assert.rejects(
    planner.propose(input({ previousPlan: { planId: "broken" } }), signal()),
    (error) => error instanceof PlanningError && error.code === "INVALID_PLANNING_INPUT",
  );
});

test("rejects malformed scope, task, context, observations, and identifiers", async (t) => {
  const planner = createSingleStepResponsePlanner();
  const cases = [
    ["missing scope", input({ scope: null })],
    ["invalid run ID", input({ scope: { runId: " run-with-space " } })],
    ["empty task", input({ task: " \n " })],
    ["malformed Unicode task", input({ task: "\ud800" })],
    ["wrong context type", input({ context: {} })],
    ["invalid message source ID", input({ context: [{ role: "user", content: "Hi", sourceIds: [" "] }] })],
    ["invalid observation", input({ observations: [{ observationId: "ob-1", kind: "unknown", summary: "Bad", sourceId: "source-1" }] })],
  ];

  for (const [name, request] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        planner.propose(request, signal()),
        (error) => error instanceof PlanningError && error.code === "INVALID_PLANNING_INPUT",
      );
    });
  }
});

test("checks configured step and description limits", async () => {
  const oneStep = createSingleStepResponsePlanner(parsePlanningConfig({ maxSteps: 1 }));
  assert.equal((await oneStep.propose(input(), signal())).steps.length, 1);

  const shortDescriptionLimit = createSingleStepResponsePlanner({ maxDescriptionBytes: 8 });
  await assert.rejects(
    shortDescriptionLimit.propose(input(), signal()),
    (error) => error instanceof PlanningError && error.code === "PLAN_LIMIT_EXCEEDED",
  );
});

test("throws AbortError for cancellation before and after proposal construction", async () => {
  const planner = createSingleStepResponsePlanner();
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(planner.propose(input(), alreadyCancelled.signal), { name: "AbortError" });

  const signalLike = new AbortController();
  let abortedReads = 0;
  const abortAfterConstruction = {
    addEventListener: signalLike.signal.addEventListener.bind(signalLike.signal),
    removeEventListener: signalLike.signal.removeEventListener.bind(signalLike.signal),
    get aborted() {
      abortedReads += 1;
      if (abortedReads === 3) signalLike.abort();
      return abortedReads >= 3;
    },
  };
  await assert.rejects(planner.propose(input(), abortAfterConstruction), { name: "AbortError" });
});
