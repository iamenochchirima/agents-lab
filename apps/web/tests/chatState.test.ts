import assert from "node:assert/strict";
import test from "node:test";

import { isModelPickerDisabled, mergeEvents, modelSelectionFromRun, reuseRunView, shouldActivateUrlRun, synchronizeModelSelection, upsertRunMessages, type ChatMessage } from "../src/features/platforms/chatState";
import type { RunEvent, RunView } from "../src/features/platforms/platformApi";

const event: RunEvent = {
  eventId: "run:temporal-workflow:1",
  recordedSequence: 1,
  source: "temporal-workflow",
  sourceSequence: 1,
  kind: "AgentStarted",
  runId: "run",
  occurredAt: "2026-09-16T08:00:00.000Z",
  payload: {},
};

function runView(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "run",
    status: "running",
    manifest: {
      platform: "temporal",
      variant: "baseline",
      task: { prompt: "Hello" },
      model: { provider: "openrouter", model: "openai/gpt-4o-mini" },
    },
    events: [event],
    executionReference: null,
    result: null,
    context: null,
    projection: { state: "current", observedAt: "2026-09-16T08:00:00.000Z", reason: null },
    ...overrides,
  };
}

test("polling identical events preserves the existing event array", () => {
  const current = [event];
  assert.equal(mergeEvents(current, [{ ...event }]), current);
});

test("polling an unchanged run preserves the existing run view", () => {
  const current = runView();
  assert.equal(reuseRunView(current, runView()), current);
});

test("a stale projection is not hidden by polling reuse", () => {
  const current = runView();
  const stale = runView({
    projection: {
      state: "stale",
      observedAt: current.projection.observedAt,
      reason: "The platform is temporarily unavailable.",
    },
  });
  assert.notEqual(reuseRunView(current, stale), current);
});

test("polling an unchanged assistant message preserves the existing message array", () => {
  const current: ChatMessage[] = [
    { id: "user", role: "user", content: "Hello", status: "completed", runId: "run" },
    { id: "assistant", role: "assistant", content: "", status: "running", runId: "run" },
  ];
  assert.equal(upsertRunMessages(current, runView()), current);
});

test("a completed run in the URL is not reactivated after polling stops", () => {
  assert.equal(shouldActivateUrlRun("run", null, runView({ status: "completed" })), false);
  assert.equal(shouldActivateUrlRun("run", null, runView({ status: "running" })), true);
  assert.equal(shouldActivateUrlRun("other-run", null, runView({ status: "completed" })), true);
});

test("a resumed run exposes its recorded model to the chat configuration", () => {
  assert.deepEqual(modelSelectionFromRun(runView({
    manifest: {
      ...runView().manifest,
      model: { provider: "openrouter", model: "openai/gpt-5.6-luna", contextWindowTokens: 1_050_000 },
    },
  })), {
    provider: "openrouter",
    model: "openai/gpt-5.6-luna",
    contextWindowTokens: 1_050_000,
  });
});

test("the model picker is locked after a Temporal session is established", () => {
  assert.equal(isModelPickerDisabled({ hasActiveRun: false, preservesSession: true, sessionId: "session-1" }), true);
  assert.equal(isModelPickerDisabled({ hasActiveRun: false, preservesSession: true, sessionId: null }), false);
  assert.equal(isModelPickerDisabled({ hasActiveRun: true, preservesSession: false, sessionId: null }), true);
});

test("polling the same recorded model does not create a new selection object", () => {
  const current = { provider: "openrouter" as const, model: "openai/gpt-5.6-luna", contextWindowTokens: 1_050_000 };
  assert.equal(synchronizeModelSelection(current, runView({
    manifest: {
      ...runView().manifest,
      model: { provider: "openrouter", model: current.model, contextWindowTokens: current.contextWindowTokens },
    },
  })), current);
});
