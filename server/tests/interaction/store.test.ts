import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskInteractionStore } from "../../src/capabilities/interaction/store.js";

test("inputs persist before delivery, reject conflicts, and replay an exact ordered consumption boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-input-"));
  try {
    const store = new TaskInteractionStore(root);
    const input = {runId: "run", turnId: "turn", inputId: "input-1", kind: "steering" as const, content: "Only edit research notes."};
    const first = await store.accept(input);
    assert.equal(first.status, "accepted");
    assert.deepEqual(await store.accept(input), first);
    await assert.rejects(store.accept({...input, content: "Edit every note."}), /conflicting/);
    await store.accept({...input, inputId: "input-2", content: "Keep existing owners."});
    const rebuilt = new TaskInteractionStore(root);
    const consumed = await rebuilt.consume("run", "turn", "model:2");
    assert.deepEqual(consumed.map(item => item.sequence), [1, 2]);
    assert.ok(consumed.every(item => item.status === "consumed"));
    assert.deepEqual(await new TaskInteractionStore(root).consume("run", "turn", "model:2"), consumed);
    assert.deepEqual(await rebuilt.consume("run", "turn", "model:3"), []);
    assert.equal(await rebuilt.hasPendingSteering("run"), false);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("clarification requires matched pending question, retains one answer and cannot grant permission", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-question-"));
  try {
    const store = new TaskInteractionStore(root);
    const question = await store.question({runId: "run", turnId: "turn", toolCallId: "call", question: "Which notes should I update?"});
    assert.equal(await store.answer("run", "turn", question.questionId), null);
    const input = {runId: "run", turnId: "turn", inputId: "reply", kind: "clarification_reply" as const, content: "Research only.", questionId: question.questionId};
    await assert.rejects(store.accept({...input, turnId: "wrong"}), /not awaiting/);
    await store.accept(input);
    await assert.rejects(store.accept({...input, inputId: "second"}), /not awaiting/);
    assert.deepEqual(await store.consume("run", "turn", "model:1"), []);
    const answer = await store.answer("run", "turn", question.questionId);
    assert.equal(answer?.status, "consumed");
    assert.equal((await store.read("run")).questions[0]?.status, "answered");
    assert.deepEqual(await new TaskInteractionStore(root).answer("run", "turn", question.questionId), answer);
    assert.equal(Object.hasOwn(answer!, "approval"), false);
    const second = await store.question({runId: "run", turnId: "turn", toolCallId: "other-call", question: "Which owner?"});
    await store.accept({...input, inputId: "old-reply", questionId: second.questionId});
    await store.accept({runId: "run", turnId: "turn", inputId: "steering", kind: "steering", content: "Do not change owners."});
    await store.consume("run", "turn", "model:2");
    const snapshot = await store.read("run");
    assert.equal(snapshot.questions.find(item => item.questionId === second.questionId)?.status, "cancelled");
    assert.equal(snapshot.inputs.find(item => item.inputId === "old-reply")?.status, "rejected");
    await assert.rejects(store.answer("run", "turn", second.questionId), /cancelled/);
    await assert.rejects(store.question({runId: "run", turnId: "turn", toolCallId: "call", question: "Changed question?"}), /identity changed/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("run validation runs inside acceptance lock and closing rejects pending inputs/questions", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-close-"));
  try {
    const store = new TaskInteractionStore(root);
    const input = {runId: "run", turnId: "turn", inputId: "late", kind: "steering" as const, content: "Change it."};
    await assert.rejects(store.accept(input, async () => { throw new Error("Run terminal"); }), /terminal/);
    assert.equal((await store.read("run")).inputs.length, 0);
    await store.accept(input);
    await store.question({runId: "run", turnId: "turn", toolCallId: "call", question: "Which one?"});
    await store.close("run");
    assert.equal((await store.read("run")).inputs[0]?.status, "rejected");
    assert.equal((await store.read("run")).questions[0]?.status, "cancelled");
    assert.deepEqual(await store.consume("run", "turn", "model:2"), []);
  } finally { await rm(root, {recursive: true, force: true}); }
});
