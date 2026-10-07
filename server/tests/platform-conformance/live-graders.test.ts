import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type { BaselineObservation } from "../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs";
import type { LiveCaseId } from "../../../lab/scenarios/platform-agent-conformance/live-evals.mjs";
let root = process.cwd();
while (!existsSync(resolve(root, "pnpm-workspace.yaml"))) { const parent = dirname(root); if (parent === root) throw new Error("Repository not found"); root = parent; }
const { liveCase, gradeLiveCase, LIVE_MARKER } = await import(pathToFileURL(resolve(root, "lab/scenarios/platform-agent-conformance/live-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/live-evals.mjs");
function valid(id: LiveCaseId): BaselineObservation {
  const fixture = liveCase(id);
  const observation: BaselineObservation = { runs: [], requests: [], tools: [] };
  fixture.prompts.forEach((prompt, index) => {
    const runId = `run-${index + 1}`;
    const output = id === "L02" ? "The calculator gives 42." : index === 0 && id === "L03" ? "I will remember it." : `Here is ${LIVE_MARKER}.`;
    observation.runs.push({ runId, sessionId: "fresh", turnId: `turn-${index}`, status: "completed", output, instructions: "Use brief answers.", maxCalls: fixture.maxCalls, maxRounds: fixture.maxRounds });
    observation.requests.push({ runId, sequence: 1, messages: [{ role: "system", content: "Use brief answers." }, ...(index ? [{ role: "user" as const, content: fixture.prompts[0] }, { role: "assistant" as const, content: observation.runs[0].output! }] : []), { role: "user", content: prompt }] });
  });
  if (id === "L02") {
    const call = { callId: "call1", toolName: "calculator", input: { operation: "add", left: 17, right: 25 } };
    observation.requests[0].responseToolCalls = [call];
    observation.tools.push({ ...call, runId: "run-1", status: "completed", output: { value: 42 }, requestSequence: 1 });
    observation.requests.push({ runId: "run-1", sequence: 2, messages: [...observation.requests[0].messages, { role: "assistant", content: "", toolCalls: [call] }, { role: "tool", content: '{"value":42}', toolCallId: call.callId }] });
  }
  return observation;
}
test("live probes accept real answer variation and fail missing evidence", () => {
  for (const id of ["L01", "L02", "L03"] as const) {
    assert.equal(gradeLiveCase(id, valid(id)).verdict, "pass");
    assert.equal(gradeLiveCase(id, { runs: [], requests: [], tools: [] }).verdict, "fail");
  }
});
test("task graders distinguish correct prose from tool execution and retained context", () => {
  const missingTool = valid("L02"); missingTool.tools = [];
  assert.equal(gradeLiveCase("L02", missingTool).verdict, "fail");
  const missingFeedback = valid("L02"); missingFeedback.requests[1].messages.pop();
  assert.equal(gradeLiveCase("L02", missingFeedback).verdict, "fail");
  const wrongArgs = valid("L02"); wrongArgs.tools[0].input = { operation: "add", left: 18, right: 24 };
  assert.equal(gradeLiveCase("L02", wrongArgs).verdict, "fail");
  const orphanDemand = valid("L02"); orphanDemand.requests[0].responseToolCalls!.push({ callId: "orphan", toolName: "write", input: {} });
  assert.equal(gradeLiveCase("L02", orphanDemand).verdict, "fail");
  const absentContext = valid("L03"); absentContext.requests[1].messages.splice(1, 2);
  assert.equal(gradeLiveCase("L03", absentContext).verdict, "fail");
  const wrongSession = valid("L03"); wrongSession.runs[1].sessionId = "unrelated";
  assert.equal(gradeLiveCase("L03", wrongSession).verdict, "fail");
  const missingMarker = valid("L01"); missingMarker.runs[0].output = "Evidence matters.";
  assert.equal(gradeLiveCase("L01", missingMarker).verdict, "fail");
});

import type { LiveObservation } from "../../../lab/scenarios/platform-agent-conformance/live-evals.mjs";
const { buildLiveFixture } = await import(pathToFileURL(resolve(root, "lab/scenarios/platform-agent-conformance/live-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/live-evals.mjs");
function paired(id: "L04" | "L05" | "L06") {
  const fixture = buildLiveFixture(id, "testlive");
  const observation: LiveObservation = { runs: [], requests: [], tools: [], approvals: [id === "L05", id === "L05"], fixtureSnapshots: [] };
  fixture.prompts.forEach((prompt, index) => {
    const runId = `paired-${index}`, namespace = fixture.namespaces![index];
    observation.runs.push({ runId, sessionId: `session-${index}`, turnId: `turn-${index}`, status: "completed", output: id === "L05" ? index === 0 ? "Which record should I update?" : "Updated." : fixture.marker!, instructions: "Use brief answers.", maxCalls: fixture.maxCalls, maxRounds: fixture.maxRounds });
    const messages = [{ role: "system" as const, content: "Use brief answers." }, { role: "user" as const, content: prompt }];
    observation.requests.push({ runId, sequence: 1, messages });
    const before = Object.fromEntries(Object.entries(fixture.seeds![index].records).map(([key, value]) => [`${namespace}:${key}`, value]));
    observation.fixtureSnapshots!.push({ namespace, before, after: { ...before }, effectCount: 0, lookupCount: 0, writeAttemptCount: 0 });
    if (id === "L05" && index === 0) return;
    const addTool = (key: string, status = "completed") => {
      const source = observation.requests.at(-1)!;
      const call = { callId: `${runId}-${source.sequence}`, toolName: id === "L05" ? "fixture_write" : "fixture_lookup", input: id === "L05" ? { key, value: "ready" } : { key } };
      source.responseToolCalls = [call];
      const output = status === "failed" ? { error: fixture.lookupFailure!.message } : { key, value: id === "L06" ? before[key] : fixture.marker };
      observation.tools.push({ ...call, runId, output, status });
      observation.requests.push({ runId, sequence: source.sequence + 1, messages: [...source.messages, { role: "assistant", content: "", toolCalls: [call] }, { role: "tool", toolCallId: call.callId, content: JSON.stringify(output) }] });
      const snapshot = observation.fixtureSnapshots!.at(-1)!;
      if (id === "L05") { snapshot.effectCount = 1; snapshot.writeAttemptCount = 1; snapshot.after[key] = "ready"; }
      else snapshot.lookupCount++;
    };
    if (id === "L04" && index === 0) { addTool(`${namespace}:primary`, "failed"); addTool(`${namespace}:backup`); }
    else addTool(`${namespace}:${id === "L06" ? "note" : id === "L05" ? "record" : "primary"}`);
  });
  return { fixture, observation };
}
test("paired live probes require observed controls and retain human clarification review", () => {
  for (const id of ["L04", "L05", "L06"] as const) {
    const { fixture, observation } = paired(id);
    const grade = gradeLiveCase(id, observation, fixture);
    assert.equal(grade.verdict, id === "L05" ? "blocked" : "pass");
    assert.equal(grade.reviewRequired, id === "L05" ? true : undefined);
    const missingControl = structuredClone(observation); missingControl.runs.pop();
    assert.equal(gradeLiveCase(id, missingControl, fixture).verdict, "fail");
  }
  const skillExpansion = paired("L04");
  for (const run of skillExpansion.observation.runs) { run.declaredSkills = [{ id: "allowlisted", version: "1", digest: "immutable-digest" }]; run.skillContexts = [{ skillId: "allowlisted", skillVersion: "1", digest: "immutable-digest", content: "Known context-only skill" }]; }
  for (const request of skillExpansion.observation.requests) request.messages.splice(1, 0, { role: "system", content: "Known context-only skill" });
  assert.equal(gradeLiveCase("L04", skillExpansion.observation, skillExpansion.fixture).verdict, "pass");
  skillExpansion.observation.runs[0].skillContexts = [{ ...skillExpansion.observation.runs[0].skillContexts![0], digest: "unverified-digest" }];
  assert.equal(gradeLiveCase("L04", skillExpansion.observation, skillExpansion.fixture).verdict, "fail");
  const error = paired("L04"); error.observation.requests[1].messages.pop();
  assert.equal(gradeLiveCase("L04", error.observation, error.fixture).verdict, "fail");
  const injection = paired("L06"); injection.observation.requests[0].responseToolCalls!.push({ callId: "forbidden", toolName: "fixture_write", input: { key: "bad", value: "bad" } });
  assert.equal(gradeLiveCase("L06", injection.observation, injection.fixture).verdict, "fail");
  const unapproved = paired("L05"); unapproved.observation.approvals![1] = false;
  assert.equal(gradeLiveCase("L05", unapproved.observation, unapproved.fixture).verdict, "fail");
});
