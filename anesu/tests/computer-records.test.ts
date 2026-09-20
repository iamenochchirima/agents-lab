import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertComputerActionTransition,
  type ComputerRunEventRecord,
  type ComputerRunRecord,
  type ComputerActionRecord,
} from "../src/computer/records.js";
import { SessionStore } from "../src/persistence/session-store.js";

function record(status: ComputerActionRecord["status"], turnId = "turn_test"): ComputerActionRecord {
  return {
    schemaVersion: 1,
    actionId: "screen_click",
    callId: "call_computer_test",
    sessionId: "computer_session_test",
    turnId,
    environment: "ubuntu-x11-cua",
    displayId: ":104",
    operation: "click",
    observationId: "observation_test",
    generation: 1,
    x: 440,
    y: 324,
    status,
    ...(status === "running" ? { startedAt: "2026-09-19T00:00:00.000Z" } : {}),
    recordedAt: "2026-09-19T00:00:00.000Z",
  };
}

test("computer action records preserve the observed action and only allow forward transitions", () => {
  const prepared = record("prepared");
  assert.doesNotThrow(() => assertComputerActionTransition(prepared, { ...prepared, status: "approved", decision: "allow-once" }));
  assert.throws(
    () => assertComputerActionTransition(prepared, { ...prepared, x: 441, status: "approved", decision: "allow-once" }),
    /identity cannot change/u,
  );
  assert.throws(
    () => assertComputerActionTransition({ ...prepared, status: "completed" }, { ...prepared, status: "running", startedAt: "2026-09-19T00:00:00.000Z" }),
    /cannot transition/u,
  );
});

test("computer run evidence keeps bounded ordered events and terminal status", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-run-evidence-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("reveal the safe result", "deterministic", "test-model");
    const run: ComputerRunRecord = {
      schemaVersion: 1,
      runId: "computer_run_test",
      callId: "call_computer_run_test",
      sessionId: session.metadata.sessionId,
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      goal: "reveal the safe result",
      status: "running",
      startedAt: "2026-09-20T00:00:00.000Z",
      recordedAt: "2026-09-20T00:00:00.000Z",
    };
    await turn.writeComputerRun(run);
    const event = (eventId: string, kind: ComputerRunEventRecord["kind"], payload: Record<string, unknown>): Omit<ComputerRunEventRecord, "sequence" | "recordedAt"> => ({
      schemaVersion: 1,
      eventId,
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind,
      strategy: run.strategy,
      payload,
    });
    await turn.appendComputerRunEvent(event("event_observed", "observed", { observationId: "observation_test", candidateCount: 1 }));
    await turn.appendComputerRunEvent(event("event_decision_retry", "decision_attempt", { observationId: "observation_test", attempt: 1, maxAttempts: 2, retrying: true, reason: "provider rate limit", errorCode: "computer-decision" }));
    await turn.appendComputerRunEvent(event("event_proposed", "proposed", { actionId: "native_accessibility_click_0", confidence: 0.8 }));
    await turn.writeComputerRun({ ...run, status: "completed", summary: "safe result verified", finishedAt: "2026-09-20T00:00:01.000Z", recordedAt: "2026-09-20T00:00:01.000Z" });

    const events = await turn.readComputerRunEvents(run.runId);
    assert.deepEqual(events.map((value) => [value.sequence, value.kind]), [[1, "observed"], [2, "decision_attempt"], [3, "proposed"]]);
    assert.equal((await turn.readComputerRuns())[0]?.status, "completed");
    await assert.rejects(
      () => turn.appendComputerRunEvent(event("event_too_large", "failed", { diagnostic: "x".repeat(20_000) })),
      /bounded|limit/u,
    );
    await assert.rejects(
      () => turn.writeComputerRun({ ...run, strategy: "traditional" }),
      /identity cannot change/u,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("compare run evidence retains per-strategy shadow events under one run identity", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-compare-run-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("reveal the safe result", "deterministic", "test-model");
    const run: ComputerRunRecord = {
      schemaVersion: 1,
      runId: "computer_run_compare_test",
      callId: "call_computer_compare_test",
      sessionId: session.metadata.sessionId,
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      environment: "browser",
      strategy: "compare",
      goal: "reveal the safe result",
      status: "running",
      startedAt: "2026-09-20T00:00:00.000Z",
      recordedAt: "2026-09-20T00:00:00.000Z",
    };
    await turn.writeComputerRun(run);
    await turn.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: "compare_traditional_proposal",
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind: "proposed",
      strategy: "traditional",
      payload: { actionId: "click_reveal" },
    });
    await turn.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: "compare_typesafe_proposal",
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind: "proposed",
      strategy: "typesafe",
      payload: { actionId: "click_reveal" },
    });
    const events = await turn.readComputerRunEvents(run.runId);
    assert.deepEqual(events.map((value) => value.strategy), ["traditional", "typesafe"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart closes an incomplete computer run as outcome-unknown without replay", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-run-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("reveal the safe result", "deterministic", "test-model");
    const run: ComputerRunRecord = {
      schemaVersion: 1,
      runId: "computer_run_recovery_test",
      callId: "call_computer_recovery_test",
      sessionId: session.metadata.sessionId,
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      goal: "reveal the safe result",
      status: "running",
      startedAt: "2026-09-20T00:00:00.000Z",
      recordedAt: "2026-09-20T00:00:00.000Z",
    };
    await turn.writeComputerRun(run);
    await turn.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: "recovery_started",
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind: "started",
      strategy: run.strategy,
      payload: { callId: run.callId },
    });

    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered.length, 1);
    assert.equal((await turn.readComputerRun(run.runId)).status, "outcome-unknown");
    const events = await turn.readComputerRunEvents(run.runId);
    assert.deepEqual(events.map((value) => value.kind), ["started", "failed"]);
    assert.deepEqual(events.at(-1)?.payload, {
      recovered: true,
      reason: "The computer run was interrupted; its outcome is unknown and no input was replayed.",
      status: "outcome-unknown",
    });

    await session.recoverInterruptedTurns();
    assert.equal((await turn.readComputerRunEvents(run.runId)).length, 2);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart fails a native action waiting for approval without replaying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-records-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("reveal the safe result", "deterministic", "test-model");
    await turn.writeComputerAction(record("prepared", turn.turnId));

    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "interrupted");

    const actions = await turn.readComputerActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "failed");
    assert.equal(actions[0]?.errorCode, "computer-approval-unavailable");
    const events = await turn.readEvents();
    assert.deepEqual(events.filter((event) => event.payload.actionId === actions[0]?.actionId).map((event) => event.type), [
      "ComputerPrepared",
      "ComputerApprovalDecided",
      "ComputerCompleted",
    ]);
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart marks a running native action ambiguous and never retries the input", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-running-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("reveal the safe result", "deterministic", "test-model");
    const prepared = record("prepared", turn.turnId);
    await turn.writeComputerAction(prepared);
    await turn.writeComputerAction({ ...prepared, status: "approved", decision: "allow-once", recordedAt: "2026-09-19T00:00:01.000Z" });
    await turn.writeComputerAction({ ...prepared, status: "running", decision: "allow-once", startedAt: "2026-09-19T00:00:02.000Z", recordedAt: "2026-09-19T00:00:02.000Z" });

    await session.recoverInterruptedTurns();
    const action = (await turn.readComputerActions())[0];
    assert.equal(action?.status, "ambiguous");
    assert.equal(action?.errorCode, "computer-ambiguous");
    assert.match(action?.errorMessage ?? "", /not replayed/u);
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("computer run summaries expose bounded inspection metadata without raw event payloads", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-run-summary-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("inspect the computer run", "deterministic", "test-model");
    const run: ComputerRunRecord = {
      schemaVersion: 1,
      runId: "computer_run_summary_test",
      callId: "call_computer_summary_test",
      sessionId: session.metadata.sessionId,
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      environment: "ubuntu-x11-cua",
      strategy: "typesafe",
      goal: "inspect the computer run",
      status: "completed",
      startedAt: "2026-09-20T00:00:00.000Z",
      finishedAt: "2026-09-20T00:00:01.000Z",
      recordedAt: "2026-09-20T00:00:01.000Z",
    };
    await turn.writeComputerRun(run);
    await turn.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: "summary_observed",
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind: "observed",
      strategy: run.strategy,
      payload: {
        observationId: "observation_summary",
        candidateCount: 1,
        screenshotPath: "/private/raw/screenshot.png",
        providerBody: "do not expose this",
      },
    });
    await turn.appendComputerRunEvent({
      schemaVersion: 1,
      eventId: "summary_verified",
      runId: run.runId,
      sessionId: run.sessionId,
      turnId: run.turnId,
      correlationId: run.correlationId,
      kind: "verified",
      strategy: run.strategy,
      payload: {
        observationId: "observation_summary",
        previousObservationId: "observation_previous",
        actionId: "native_click",
        candidateId: "candidate_button",
        operation: "click",
        model: "jev-latest",
        latencyMs: 42,
        success: true,
        terminal: true,
        runStatus: "completed",
        reason: "safe result verified",
      },
    });

    const summaries = await session.readComputerRunSummaries({ limit: 10 });
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.run.runId, run.runId);
    assert.equal(summaries[0]?.eventCount, 2);
    assert.equal(summaries[0]?.lastEvent?.kind, "verified");
    assert.equal(summaries[0]?.lastEvent?.observationId, "observation_summary");
    assert.equal(summaries[0]?.lastEvent?.previousObservationId, "observation_previous");
    assert.equal(summaries[0]?.lastEvent?.model, "jev-latest");
    assert.equal(summaries[0]?.lastEvent?.latencyMs, 42);
    assert.equal(summaries[0]?.lastEvent?.runStatus, "completed");
    assert.equal(summaries[0]?.lastEvent?.reason, "safe result verified");
    assert.equal("payload" in (summaries[0]?.lastEvent ?? {}), false);
    assert.equal(JSON.stringify(summaries[0]).includes("raw/screenshot"), false);
    assert.equal(JSON.stringify(summaries[0]).includes("do not expose"), false);
    await assert.rejects(() => session.readComputerRunSummaries({ limit: 0 }), /limit/u);
    await assert.rejects(() => session.cleanupComputerRuns({ maxAgeMs: -1, maxEntries: 10 }), /maxAgeMs/u);
    await assert.rejects(() => session.cleanupComputerRuns({ maxAgeMs: 1, maxEntries: 0 }), /maxEntries/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("computer run retention removes only old terminal journals and preserves active or recent runs", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-run-retention-"));
  try {
    const session = await SessionStore.open(stateDir);
    const makeRun = async (runId: string, status: ComputerRunRecord["status"], recordedAt: string): Promise<void> => {
      const turn = await session.admitTurn(`run ${runId}`, "deterministic", "test-model");
      await turn.writeComputerRun({
        schemaVersion: 1,
        runId,
        callId: `call_${runId}`,
        sessionId: session.metadata.sessionId,
        turnId: turn.turnId,
        correlationId: turn.correlationId,
        environment: "browser",
        strategy: "typesafe",
        goal: `run ${runId}`,
        status,
        startedAt: recordedAt,
        ...(status === "running" ? {} : { finishedAt: recordedAt }),
        recordedAt,
      });
    };
    await makeRun("computer_run_old", "completed", "2026-09-18T00:00:00.000Z");
    await makeRun("computer_run_recent", "completed", "2026-09-19T12:00:00.000Z");
    await makeRun("computer_run_active", "running", "2026-09-18T00:00:00.000Z");

    const result = await session.cleanupComputerRuns({
      maxAgeMs: 24 * 60 * 60 * 1_000,
      maxEntries: 10,
      now: () => Date.parse("2026-09-20T00:00:00.000Z"),
    });
    assert.equal(result.removed, 1);
    assert.equal(result.retained, 2);
    await assert.rejects(() => session.readComputerRun("computer_run_old"), /Could not read|ENOENT|not found/u);
    assert.equal((await session.readComputerRunSummaries({ limit: 10 })).length, 2);
    assert.equal((await session.readComputerRunSummaries({ limit: 10 })).some((summary) => summary.run.runId === "computer_run_active"), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
