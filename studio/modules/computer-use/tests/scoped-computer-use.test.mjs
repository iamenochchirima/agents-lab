import assert from "node:assert/strict";
import test from "node:test";

import {
  ComputerUseError,
  createScopedComputerUse,
  parseComputerUseConfig,
} from "../dist/index.js";

const scope = { runId: "run-computer-use-test", turnId: "turn-1" };
const action = { actionId: "click-1", kind: "click", target: "submit-button" };
const signal = () => new AbortController().signal;

function fixture(options = {}) {
  let revision = 0;
  let observations = 0;
  let performs = 0;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  const environment = {
    async observe() {
      observations += 1;
      if (options.observeNeverResolves) return new Promise(() => {});
      if (options.observeError) throw options.observeError;
      return {
        observationId: `observation-${observations}`,
        kind: "dom",
        capturedAt: "2026-09-25T10:00:00.000Z",
        content: options.observationContent ?? { revision },
      };
    },
    async perform() {
      performs += 1;
      notifyStarted();
      if (options.performNeverResolves) return new Promise(() => {});
      if (options.mutateBeforeReject) revision += 1;
      if (options.performError) throw options.performError;
      const receipt = options.receipt ?? {
        status: "completed",
        startedAt: "2026-09-25T10:00:00.000Z",
        finishedAt: "2026-09-25T10:00:01.000Z",
        detail: "Fixture changed the page state.",
      };
      if (receipt.status === "completed") revision += 1;
      return receipt;
    },
  };
  const verify = options.verify ?? (({ before, after }) => {
    if (!after) return { status: "not-verified", evidence: "No post-action observation was available." };
    const changed = before.content.revision !== after.content.revision;
    return { status: changed ? "verified" : "not-verified", evidence: changed ? "The fixture state changed." : "The fixture state did not change." };
  });
  return {
    computer: createScopedComputerUse(options.config ?? {}, { environment, verify }),
    environment,
    started,
    counts: () => ({ observations, performs }),
  };
}

test("observes, performs one supplied action, captures after state, and reports verification", async () => {
  const { computer, counts } = fixture();
  assert.deepEqual(computer.requiredCapabilities(), [{ id: "computer", version: "1.0.0", kind: "computer", operations: ["observe", "click"] }]);
  const result = await computer.act(action, scope, signal());

  assert.equal(computer.identity.id, "scoped-computer-use");
  assert.equal(computer.identity.version, "0.2.0");
  assert.equal(result.action.actionId, "click-1");
  assert.equal(result.receipt.status, "completed");
  assert.equal(result.before.content.revision, 0);
  assert.equal(result.after.content.revision, 1);
  assert.deepEqual(result.verification, { status: "verified", evidence: "The fixture state changed." });
  assert.deepEqual(counts(), { observations: 2, performs: 1 });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.before.content));
});

test("records a failed environment receipt and does not claim verification without a state change", async () => {
  const { computer } = fixture({ receipt: {
    status: "failed",
    startedAt: "2026-09-25T10:00:00.000Z",
    finishedAt: "2026-09-25T10:00:01.000Z",
    detail: "The fixture refused the action.",
  } });
  const result = await computer.act(action, scope, signal());

  assert.equal(result.receipt.status, "failed");
  assert.equal(result.after.content.revision, 0);
  assert.equal(result.verification.status, "not-verified");
});

test("turns a rejected operation after dispatch into an unknown receipt and retains post-state evidence", async () => {
  const { computer } = fixture({ mutateBeforeReject: true, performError: new Error("connection lost") });
  const result = await computer.act(action, scope, signal());

  assert.equal(result.receipt.status, "unknown");
  assert.match(result.receipt.detail, /outcome is unknown/);
  assert.equal(result.after.content.revision, 1);
  assert.equal(result.verification.status, "verified");
});

test("enforces per-turn action limits before another environment call", async () => {
  const { computer, counts } = fixture({ config: { maxActionsPerTurn: 1 } });
  await computer.act(action, scope, signal());

  await assert.rejects(
    computer.act({ ...action, actionId: "click-2" }, scope, signal()),
    (error) => error instanceof ComputerUseError && error.code === "COMPUTER_ACTION_LIMIT_EXCEEDED",
  );
  assert.deepEqual(counts(), { observations: 2, performs: 1 });
});

test("a retry-safe pre-action observation failure does not consume the turn quota", async () => {
  let observations = 0;
  let performs = 0;
  const environment = {
    async observe() {
      observations += 1;
      if (observations === 1) throw new Error("temporary observation failure");
      return {
        observationId: `observation-${observations}`,
        kind: "dom",
        capturedAt: "2026-09-25T10:00:00.000Z",
        content: { revision: observations },
      };
    },
    async perform() {
      performs += 1;
      return {
        status: "completed",
        startedAt: "2026-09-25T10:00:00.000Z",
        finishedAt: "2026-09-25T10:00:01.000Z",
        detail: "done",
      };
    },
  };
  const computer = createScopedComputerUse({ maxActionsPerTurn: 1 }, {
    environment,
    verify: () => ({ status: "not-verified", evidence: "Fixture has no comparable state." }),
  });
  await assert.rejects(computer.act(action, scope, signal()), { code: "ENVIRONMENT_UNAVAILABLE" });
  const result = await computer.act(action, scope, signal());
  assert.equal(result.receipt.status, "completed");
  assert.equal(performs, 1);
});

test("concurrent actions cannot both consume the final per-turn slot", async () => {
  let preflightObservations = 0;
  let observations = 0;
  let performs = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const environment = {
    async observe() {
      observations += 1;
      if (preflightObservations < 2) {
        preflightObservations += 1;
        if (preflightObservations === 2) releaseBarrier();
        await barrier;
      }
      return {
        observationId: `observation-${observations}`,
        kind: "dom",
        capturedAt: "2026-09-25T10:00:00.000Z",
        content: { revision: observations },
      };
    },
    async perform() {
      performs += 1;
      return {
        status: "completed",
        startedAt: "2026-09-25T10:00:00.000Z",
        finishedAt: "2026-09-25T10:00:01.000Z",
        detail: "done",
      };
    },
  };
  const computer = createScopedComputerUse({ maxActionsPerTurn: 1 }, {
    environment,
    verify: () => ({ status: "not-verified", evidence: "Fixture has no comparable state." }),
  });

  const results = await Promise.allSettled([
    computer.act(action, scope, signal()),
    computer.act({ ...action, actionId: "click-2" }, scope, signal()),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "COMPUTER_ACTION_LIMIT_EXCEEDED");
  assert.equal(performs, 1);
  assert.equal(observations, 3);
});

test("keeps an omitted turn ID separate from the literal sentinel-like ID", async () => {
  const { computer, counts } = fixture({ config: { maxActionsPerTurn: 1 } });
  await computer.act(action, { runId: scope.runId }, signal());
  await computer.act({ ...action, actionId: "click-2" }, { ...scope, turnId: "<no-turn-id>" }, signal());
  assert.deepEqual(counts(), { observations: 4, performs: 2 });
});

test("rejects oversized observations before dispatch", async () => {
  const { computer, counts } = fixture({
    config: { maxObservationBytes: 100 },
    observationContent: { text: "x".repeat(200) },
  });
  await assert.rejects(
    computer.act(action, scope, signal()),
    (error) => error instanceof ComputerUseError && error.code === "COMPUTER_OBSERVATION_TOO_LARGE",
  );
  assert.equal(counts().performs, 0);
});

test("reports a timed-out action as unknown and makes one post-timeout observation", async () => {
  const { computer, counts } = fixture({
    config: { actionTimeoutMs: 5 },
    performNeverResolves: true,
  });
  const result = await computer.act(action, scope, signal());

  assert.equal(result.receipt.status, "unknown");
  assert.match(result.receipt.detail, /may have completed/);
  assert.ok(result.after);
  assert.equal(result.verification.status, "not-verified");
  assert.deepEqual(counts(), { observations: 2, performs: 1 });
});

test("bounds a hanging observation using the environment timeout", async () => {
  const { computer, counts } = fixture({
    config: { actionTimeoutMs: 5 },
    observeNeverResolves: true,
  });
  await assert.rejects(
    computer.observe(scope, signal()),
    (error) => error instanceof ComputerUseError && error.code === "ENVIRONMENT_UNAVAILABLE",
  );
  assert.deepEqual(counts(), { observations: 1, performs: 0 });
});

test("cancellation before dispatch throws; cancellation after dispatch retains an unknown result", async () => {
  const beforeFixture = fixture();
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    beforeFixture.computer.act(action, scope, before.signal),
    (error) => error instanceof ComputerUseError && error.code === "COMPUTER_USE_CANCELLED",
  );
  assert.deepEqual(beforeFixture.counts(), { observations: 0, performs: 0 });

  const afterFixture = fixture({ performNeverResolves: true });
  const after = new AbortController();
  const pending = afterFixture.computer.act(action, scope, after.signal);
  await afterFixture.started;
  after.abort();
  const result = await pending;
  assert.equal(result.receipt.status, "unknown");
  assert.match(result.receipt.detail, /Cancellation arrived after dispatch/);
  assert.equal(result.after, null);
  assert.equal(result.verification.status, "not-verified");
  assert.deepEqual(afterFixture.counts(), { observations: 1, performs: 1 });
});

test("verification callback errors are preserved as failed verification evidence", async () => {
  const { computer } = fixture({ verify: () => { throw new Error("broken verifier"); } });
  const result = await computer.act(action, scope, signal());

  assert.equal(result.receipt.status, "completed");
  assert.equal(result.verification.status, "failed");
  assert.match(result.verification.evidence, /broken verifier/);
});

test("rejects malformed operations and unavailable observations with typed errors", async (t) => {
  const invalid = fixture();
  await t.test("malformed action", async () => {
    await assert.rejects(
      invalid.computer.act({ ...action, kind: "shell" }, scope, signal()),
      (error) => error instanceof ComputerUseError && error.code === "INVALID_COMPUTER_INPUT",
    );
  });

  await t.test("environment unavailable", async () => {
    const { computer } = fixture({ observeError: new Error("fixture offline") });
    await assert.rejects(
      computer.observe(scope, signal()),
      (error) => error instanceof ComputerUseError && error.code === "ENVIRONMENT_UNAVAILABLE",
    );
  });
});

test("config parser retains its defaults and rejects unsupported controls", () => {
  assert.equal(parseComputerUseConfig().maxActionsPerTurn, 20);
  assert.throws(() => parseComputerUseConfig({ allowNetwork: true }));
});
