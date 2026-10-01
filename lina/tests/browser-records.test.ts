import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertBrowserActionTransition, type BrowserActionRecord } from "../src/browser/records.js";
import { asBrowserDocumentId, asBrowserSessionId, asBrowserTabId } from "../src/browser/index.js";
import { atomicWriteJson } from "../src/persistence/json.js";
import { SessionStore } from "../src/persistence/session-store.js";

function record(status: BrowserActionRecord["status"], turnId = "turn_test"): BrowserActionRecord {
  return {
    schemaVersion: 1,
    actionId: "browser_action_test",
    callId: "call_browser_test",
    sessionId: asBrowserSessionId("browser_test"),
    turnId,
    tabId: asBrowserTabId("tab_test"),
    action: "click",
    reference: "@e1",
    documentId: asBrowserDocumentId("document_test"),
    actionHash: "a".repeat(64),
    status,
    ...(status === "running" ? { startedAt: "2026-09-15T00:00:00.000Z" } : {}),
    recordedAt: "2026-09-15T00:00:00.000Z",
  };
}

test("browser action records preserve identity and only allow forward transitions", () => {
  const prepared = record("prepared");
  assert.doesNotThrow(() => assertBrowserActionTransition(prepared, { ...prepared, status: "approved" }));
  assert.throws(
    () => assertBrowserActionTransition(prepared, { ...prepared, actionId: "browser_action_other", status: "approved" }),
    /identity cannot change/u,
  );
  assert.throws(
    () => assertBrowserActionTransition({ ...prepared, status: "completed" }, { ...prepared, status: "running" }),
    /cannot transition/u,
  );
  const selected = { ...prepared, action: "select" as const, value: "South Africa" };
  assert.doesNotThrow(() => assertBrowserActionTransition(selected, { ...selected, status: "approved" }));
  assert.throws(
    () => assertBrowserActionTransition(selected, { ...selected, value: "Kenya", status: "approved" }),
    /identity cannot change.*value/u,
  );
  const scrolled = { ...prepared, action: "scroll" as const, reference: "document", direction: "down" as const, amount: 600 };
  assert.doesNotThrow(() => assertBrowserActionTransition(scrolled, { ...scrolled, status: "approved" }));
  assert.throws(
    () => assertBrowserActionTransition(scrolled, { ...scrolled, amount: 800, status: "approved" }),
    /identity cannot change.*amount/u,
  );
  const routed = { ...prepared, inputRoute: "dom_event" as const };
  assert.doesNotThrow(() => assertBrowserActionTransition(routed, { ...routed, status: "approved" }));
  assert.throws(
    () => assertBrowserActionTransition(routed, { ...routed, inputRoute: "trusted", status: "approved" }),
    /identity cannot change.*inputRoute/u,
  );
});

test("a structured Cua action refusal survives durable browser-action storage", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-browser-refusal-record-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("follow a page link", "deterministic", "test-model");
    const refused: BrowserActionRecord = {
      ...record("failed", turn.turnId),
      errorCode: "browser-action-refused",
      effect: "refused",
    };

    await turn.writeBrowserAction(refused);

    const restored = await turn.readBrowserActions();
    assert.deepEqual(restored, [refused]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart marks a running browser action ambiguous without replaying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-browser-records-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("inspect the page", "deterministic", "test-model");
    await turn.writeBrowserAction(record("running", turn.turnId));

    const recovered = await session.recoverInterruptedTurns();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "interrupted");

    const actions = await turn.readBrowserActions();
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.status, "ambiguous");
    assert.equal(actions[0]?.errorCode, "browser-ambiguous");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart repairs a missing first browser lifecycle event", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-browser-first-event-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("recover the browser evidence", "deterministic", "deterministic/browser");
    await turn.updateState("streaming");
    await turn.appendEvent("TurnStarted");
    await turn.writeBrowserAction(record("prepared", turn.turnId));

    const restarted = await SessionStore.open(stateDir, session.metadata.sessionId);
    assert.equal((await restarted.recoverInterruptedTurns())[0]?.status, "interrupted");
    const action = (await turn.readBrowserActions())[0];
    assert.equal(action?.status, "failed");
    assert.equal(action?.errorCode, "browser-approval-unavailable");
    const events = await turn.readEvents();
    assert.deepEqual(events.map((event) => event.type), [
      "TurnStarted",
      "BrowserPrepared",
      "BrowserApprovalDecided",
      "BrowserCompleted",
      "TurnInterrupted",
    ]);
    assert.ok(events.filter((event) => event.type.startsWith("Browser")).every((event) => event.payload.recovered === true));
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("restart repairs a missing browser prelude before an already durable terminal event", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-browser-prelude-recovery-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("repair browser prelude", "deterministic", "deterministic/browser");
    await turn.updateState("streaming");
    const action = { ...record("failed", turn.turnId), actionId: "browser_prelude_recovery", callId: "browser_prelude_call" };
    await turn.appendEvent("TurnStarted");
    await turn.writeBrowserAction(action);
    await turn.appendEvent("BrowserCompleted", {
      actionId: action.actionId,
      callId: action.callId,
      status: "failed",
      errorCode: "browser-crash",
      recovered: true,
    });

    await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns();
    const events = await turn.readEvents();
    assert.deepEqual(events.map((event) => event.type), [
      "TurnStarted",
      "BrowserPrepared",
      "BrowserApprovalDecided",
      "BrowserCompleted",
      "TurnInterrupted",
    ]);
    assert.ok(events.filter((event) => event.type === "BrowserPrepared" || event.type === "BrowserApprovalDecided").every((event) => event.payload.recovered === true));
    assert.equal(events[3]?.payload.recovered, true);
    assert.deepEqual(await (await SessionStore.open(stateDir, session.metadata.sessionId)).recoverInterruptedTurns(), []);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("recovery rejects a malformed browser action before classifying it", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "lina-browser-malformed-record-"));
  try {
    const session = await SessionStore.open(stateDir);
    const turn = await session.admitTurn("malformed browser action", "deterministic", "deterministic/browser");
    const base = record("prepared", turn.turnId);
    await turn.writeBrowserAction(base);
    await atomicWriteJson(path.join(turn.directory, "browser-actions", `${base.actionId}.json`), {
      ...base,
      status: "running",
      decision: "allow-once",
      startedAt: new Date().toISOString(),
      action: "not-a-browser-action",
    });

    await assert.rejects(() => session.recoverInterruptedTurns(), /invalid durable record/u);
    assert.match(await readFile(path.join(turn.directory, "turn.json"), "utf8"), /"state":"submitting"/u);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
