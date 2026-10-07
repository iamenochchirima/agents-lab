import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type { BehaviourCaseId, BehaviourObservation, BehaviourRun } from "../../../lab/scenarios/platform-agent-conformance/behaviour-evals.mjs";
let root = process.cwd();
while (!existsSync(resolve(root, "pnpm-workspace.yaml"))) { const parent = dirname(root); if (parent === root) throw new Error("Repository unavailable"); root = parent; }
const { gradeBehaviourCase, ISOLATION_MARKERS } = await import(pathToFileURL(resolve(root, "lab/scenarios/platform-agent-conformance/behaviour-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/behaviour-evals.mjs");
const run = (probe: string, status = "completed"): BehaviourRun => ({ probe, runId: probe, sessionId: `session-${probe}`, turnId: `turn-${probe}`, status, output: status === "completed" ? "Done." : null, instructions: "Fixture instruction", maxCalls: 8, maxRounds: 6 });
function valid(id: BehaviourCaseId): BehaviourObservation {
  const observation: BehaviourObservation = { runs: [], requests: [], tools: [] };
  const request = (candidate: BehaviourRun, text = "Task") => { observation.requests.push({ runId: candidate.runId, sequence: 1, messages: [{ role: "system", content: candidate.instructions }, { role: "user", content: text }] }); };
  if (id === "B04") for (const probe of ["alpha-store", "beta-store", "alpha-recall", "beta-recall"]) { const candidate = run(probe); const index = probe.startsWith("alpha") ? 0 : 1; candidate.sessionId = `session-${index}`; candidate.output = ISOLATION_MARKERS[index]; observation.runs.push(candidate); request(candidate, ISOLATION_MARKERS[index]); }
  if (id === "B05" || id === "B06") {
    observation.rejections = []; observation.fixtureSnapshots = [];
    for (const probe of id === "B05" ? ["invalid"] : ["disabled", "unapproved", "approved"]) {
      const candidate = run(probe, probe === "approved" ? "completed" : "failed"); candidate.failurePolicy = "terminal"; candidate.error = { code: "TOOL_REJECTED" }; observation.runs.push(candidate); request(candidate);
      const call = { callId: `${probe}-call`, toolName: probe === "invalid" ? "calculator" : "fixture_write", input: { value: "fixture" } }; observation.requests.at(-1)!.responseToolCalls = [call];
      if (probe === "approved") { candidate.approvalGranted = true; observation.tools.push({ ...call, runId: candidate.runId, status: "completed", output: "updated" }); }
      else observation.rejections.push({ runId: candidate.runId, callId: call.callId, toolName: call.toolName, kind: probe === "invalid" ? "validation" : probe === "disabled" ? "disabled" : "approval", reason: "Rejected before execution" });
      observation.fixtureSnapshots.push({ probe, namespace: probe, before: {}, after: probe === "approved" ? { value: "fixture" } : {}, effectCount: probe === "approved" ? 1 : 0 });
    }
  }
  if (id === "B07") {
    for (const probe of ["calls", "rounds"]) {
      const candidate = run(probe, "failed"); candidate.maxCalls = probe === "calls" ? 2 : 8; candidate.maxRounds = 3; candidate.error = { code: probe === "calls" ? "CALL_LIMIT" : "ROUND_LIMIT" }; observation.runs.push(candidate);
      for (let sequence = 1; sequence <= 3; sequence++) {
        const call = { callId: `${probe}-${sequence}`, toolName: "calculator", input: { operation: "add", left: 17, right: 25 } };
        observation.requests.push({ runId: candidate.runId, sequence, messages: [{ role: "system", content: candidate.instructions }], responseToolCalls: [call] });
        if (sequence <= candidate.maxCalls) observation.tools.push({ ...call, runId: candidate.runId, output: { value: 42 }, status: "completed" });
      }
    }
    const candidate = run("deadline", "failed"); Object.assign(candidate, { deadlineMs: 100, elapsedMs: 120, deadlineSource: "native", inFlight: "cancelled", error: { code: "MODEL_TIMEOUT" } }); observation.runs.push(candidate); request(candidate);
  }
  if (id === "B08") for (const probe of ["provider", "malformed", "tool"] as const) { const candidate = run(probe, "failed"); Object.assign(candidate, { failurePolicy: "terminal", observedFailureKind: probe, attemptCount: 1, expectedAttempts: 1, error: { code: `${probe}_ERROR` } }); observation.runs.push(candidate); request(candidate); if (probe === "tool") observation.tools.push({ runId: candidate.runId, callId: "failed-call", toolName: "fixture.lookup", input: {}, output: null, status: "failed" }); }
  if (id === "B09") { observation.cancellations = []; observation.events = []; for (const probe of ["during", "completed", "repeated"] as const) { const candidate = run(probe, probe === "completed" ? "completed" : "cancelled"); observation.runs.push(candidate); observation.events.push({ runId: candidate.runId, sequence: 1, type: "ModelRequested" }, { runId: candidate.runId, sequence: 2, type: "CancellationObserved" }); observation.cancellations.push({ runId: candidate.runId, probe, observedSequence: 2, requestedCount: probe === "repeated" ? 2 : 1, status: candidate.status, terminalCount: 1, inFlight: probe === "completed" ? "none" : "cancelled" }); } }
  if (id === "B10") { observation.runs = [run("canonical")]; observation.admissions = [{ probe: "replay", accepted: true, runId: "canonical", canonicalRunId: "canonical", dispatchCount: 1 }, { probe: "conflict", accepted: false, canonicalRunId: "canonical", errorCode: "TURN_CONFLICT", dispatchCount: 0 }]; }
  if (id === "B11") { observation.runs = [run("successful"), run("failed", "failed"), run("cancelled", "cancelled"), run("ambiguous", "dispatch-unknown")]; observation.integrity = observation.runs.map((candidate) => ({ runId: candidate.runId, configImmutable: true, eventIdentities: true, eventOrder: true, trajectoryConsistent: true, metricsConsistent: true, resultConsistent: true, referencesSafe: true, credentialsAbsent: true, usageUnknownCorrect: true })); observation.projection = { inputCount: 4, uniqueActions: 2, expectedActions: 2, duplicateCount: 1, outOfOrderCount: 1 }; }
  if (id === "B12") { observation.runs = [run("unknown", "dispatch-unknown")]; observation.admissions = [{ probe: "unavailable", accepted: false, errorCode: "SERVICE_UNAVAILABLE", dispatchCount: 0 }, { probe: "ack-loss", accepted: true, runId: "unknown", dispatchCount: 1, reconciliationRequired: true }]; }
  return observation;
}
test("expanded graders accept complete contracts and reject absent controls", async (t) => {
  for (const id of ["B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B12"] as const) await t.test(id, () => {
    assert.equal(gradeBehaviourCase(id, valid(id)).verdict, "pass");
    assert.equal(gradeBehaviourCase(id, { runs: [], requests: [], tools: [] }).verdict, "fail");
    const incomplete = valid(id);
    if (id === "B10" || id === "B12") incomplete.admissions!.pop(); else incomplete.runs.pop();
    assert.equal(gradeBehaviourCase(id, incomplete).verdict, "fail");
  });
  const leaked = valid("B04"); leaked.requests[0].messages.push({ role: "user", content: ISOLATION_MARKERS[1] }); assert.equal(gradeBehaviourCase("B04", leaked).verdict, "fail");
  const effect = valid("B06"); effect.fixtureSnapshots![0].effectCount = 1; assert.equal(gradeBehaviourCase("B06", effect).verdict, "fail");
  const late = valid("B09"); late.events!.push({ runId: "during", sequence: 3, type: "ToolRequested" }); assert.equal(gradeBehaviourCase("B09", late).verdict, "fail");
  const polling = valid("B07"); polling.runs.at(-1)!.deadlineSource = undefined; assert.equal(gradeBehaviourCase("B07", polling).verdict, "fail");
  const generic = valid("B08"); generic.runs[0].observedFailureKind = "tool"; assert.equal(gradeBehaviourCase("B08", generic).verdict, "fail");
});
