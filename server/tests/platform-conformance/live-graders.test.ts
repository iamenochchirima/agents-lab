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
