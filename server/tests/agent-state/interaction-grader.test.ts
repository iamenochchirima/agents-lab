import { test } from "node:test";
import assert from "node:assert/strict";
import { argumentDigest } from "../../src/capabilities/reviews/store.js";
import { FREE_PROVIDER_ROUTING, SUSTAINED_FREE_MODEL } from "../../src/models/openrouter/free-model-policy.js";
import { identityInteractionCriteria, type IdentityInteractionEvidence } from "../../src/evals/identity-memory-interaction.js";

function fixture(): IdentityInteractionEvidence {
  const namespace = "cap-test", memoryNamespace = "experiment-isolated", value = "AX-random";
  const record = { key: "cedar", owner: "Unassigned", revision: 1, approvedDate: "2030-01-01", dependency: "blocked", status: "blocked" };
  const after = { ...record, owner: "Casey", revision: 2 };
  const seedManifest = { platform: "temporal", context: { turnId: "seed-turn", sessionId: "seed-session", memoryNamespace, identityRevision: 1 }, capabilities: { toolCatalog: { revision: "catalog" } } };
  const taskManifest = { ...seedManifest, platform: "restate", context: { ...seedManifest.context, turnId: "task-turn", sessionId: "new-session", memoryRecordIds: ["saved"] } };
  const saved = { id: "saved", kind: "preference", content: value, namespace: memoryNamespace };
  const seedCall = { toolCallId: "save-call", name: "memory_save", arguments: { kind: "preference", title: "reporting", content: value }, round: 1 };
  const mutationCall = { toolCallId: "casey-call", name: "record_correct", arguments: { namespace, key: "cedar", owner: "Casey", expectedRevision: 1 }, round: 3 };
  const inspectCall = { toolCallId: "inspect-call", name: "record_inspect", arguments: { namespace, key: "cedar" }, round: 4 };
  const toolMessage = (call: any) => ({ role: "assistant", tool_calls: [{ id: call.toolCallId, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] });
  const system = { role: "system", content: "Lab identity revision 1" };
  const observation = (messages: any[]) => ({ recordedSequence: 10, kind: "EvalModelObserved", payload: { observation: { providerRequest: { model: SUSTAINED_FREE_MODEL, max_tokens: 2048, provider: FREE_PROVIDER_ROUTING, messages } } } });
  const completed = (call: any, sequence: number) => ({ recordedSequence: sequence, kind: "ToolExecutionCompleted", payload: { toolCallId: call.toolCallId, toolName: call.name, round: call.round } });
  const receipt = (call: any, manifest: any, result: any, rich: boolean) => ({ status: "complete", toolName: call.name, toolCallId: call.toolCallId, catalogRevision: "catalog", fingerprint: argumentDigest({ revision: "catalog", turnId: manifest.context.turnId, call }), result: { status: "completed", content: JSON.stringify(result), ...(rich ? { structuredContent: result } : {}) } });
  const seed: any = { status: "completed", events: [completed(seedCall, 1), observation([system, toolMessage(seedCall)])] };
  const task: any = { status: "completed", events: [completed({ toolCallId: "question-call", name: "ask_user", round: 1 }, 1), completed(mutationCall, 3), completed(inspectCall, 4), observation([system, { role: "user", content: JSON.stringify(saved) }, { role: "user", content: "Use Casey instead" }, toolMessage(mutationCall), toolMessage(inspectCall)])] };
  return { seed, task, seedReceipts: [receipt(seedCall, seedManifest, saved, false)], taskReceipts: [receipt(mutationCall, taskManifest, after, true), receipt(inspectCall, taskManifest, after, true)], seedManifest, taskManifest, before: { records: { cedar: record }, effectCount: 0, effects: [] }, after: { records: { cedar: after }, effectCount: 1, effects: [{ key: "cedar", owner: "Casey" }] }, namespace, memoryNamespace, marker: "random", preferenceValue: value, identity: { name: "Lab", revision: 1 }, firstReviewHeldMs: 5100, answerInputId: "reply", steeringInputId: "steering", interaction: { schemaVersion: 1, runId: "run", inputs: [{ inputId: "reply", kind: "clarification_reply", questionId: "question", status: "consumed" }, { inputId: "steering", kind: "steering", content: "Use Casey instead", boundaryId: "model:3", status: "consumed" }] as any, questions: [{ questionId: "question", toolCallId: "question-call", answerInputId: "reply", status: "answered" }] as any }, originalReview: { requestId: "old", status: "cancelled", displayArguments: { owner: "Morgan" }, call: { toolCallId: "old-call" } } as any, finalReview: { requestId: "new", displayArguments: { owner: "Casey" }, call: { toolCallId: "casey-call" }, decision: { decision: "approved" } } as any };
}
test("identity interaction grading requires exact source, context, input and final-state evidence", () => {
  assert.ok(Object.values(identityInteractionCriteria(fixture())).every(Boolean));
});
test("a successful story cannot replace recall, consumed input, fresh approval or actual effects", () => {
  const evidence = fixture();
  evidence.taskManifest.context.memoryRecordIds = [];
  evidence.interaction = { ...evidence.interaction, inputs: evidence.interaction.inputs.map(input => ({ ...input, status: "delivered" })) };
  evidence.finalReview = { ...evidence.finalReview!, requestId: "old" };
  evidence.after.effectCount = 2;
  const criteria = identityInteractionCriteria(evidence);
  assert.equal(criteria.freshChatRecall, false); assert.equal(criteria.steeringConsumed, false); assert.equal(criteria.matchedClarificationConsumed, false); assert.equal(criteria.freshApprovalConfirmed, false); assert.equal(criteria.independentExactEffect, false);
});
test("foreign receipt fingerprint and paid routing fail despite completed native runs", () => {
  const evidence = fixture(); evidence.taskReceipts[1].fingerprint = "different-scope";
  (evidence.task.events.at(-1)!.payload.observation as any).providerRequest.provider = { ...FREE_PROVIDER_ROUTING, allow_fallbacks: true };
  const criteria = identityInteractionCriteria(evidence);
  assert.equal(criteria.verificationReceipt, false); assert.equal(criteria.freeRoutingRetained, false);
});
