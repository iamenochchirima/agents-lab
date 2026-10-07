import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type { BaselineCaseId, BaselineObservation, BaselineRun } from "../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs";

let repositoryRoot = process.cwd();
while (!existsSync(resolve(repositoryRoot, "pnpm-workspace.yaml"))) {
  const parent = dirname(repositoryRoot);
  if (parent === repositoryRoot) throw new Error("Cannot locate the repository for baseline grader tests.");
  repositoryRoot = parent;
}
const { baselineCase, gradeBaselineCase } = await import(pathToFileURL(resolve(repositoryRoot, "lab/scenarios/platform-agent-conformance/baseline-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs");
const instruction = "Follow the synthetic eval instructions.";
const call = { callId: "call-1", toolName: "calculator", input: { operation: "add", left: 17, right: 25 } };
function run(id: string, output: string | null): BaselineRun {
  return { runId: id, sessionId: "session-1", turnId: `turn-${id}`, status: "completed", output, instructions: instruction, maxCalls: 8, maxRounds: 6 };
}
function valid(id: BaselineCaseId): BaselineObservation {
  const fixture = baselineCase(id);
  const first = run("run-1", fixture.outputs[0]);
  const observation: BaselineObservation = { runs: [first], requests: [{ runId: first.runId, sequence: 1, messages: [{ role: "system", content: instruction }, { role: "user", content: fixture.prompts[0] }] }], tools: [] };
  if (id === "B02") {
    observation.requests[0].responseToolCalls = [call];
    observation.tools.push({ ...call, runId: first.runId, output: '{"value":42}', status: "completed", requestSequence: 1 });
    observation.requests.push({ runId: first.runId, sequence: 2, messages: [...observation.requests[0].messages, { role: "assistant", content: "", toolCalls: [call] }, { role: "tool", content: '{"value":42}', toolCallId: call.callId }] });
  }
  if (id === "B03") {
    const second = run("run-2", fixture.outputs[1]);
    observation.runs.push(second);
    observation.requests.push({ runId: second.runId, sequence: 1, messages: [...observation.requests[0].messages, { role: "assistant", content: fixture.outputs[0] }, { role: "user", content: fixture.prompts[1] }] });
  }
  if (id === "B07") {
    observation.requests = [];
    observation.runs = ["calls", "rounds"].map((probe, index) => ({ ...run(`run-${index + 1}`, null), probe: probe as "calls" | "rounds", status: "failed", maxCalls: probe === "calls" ? 2 : 8, maxRounds: 3, error: { code: probe === "calls" ? "TOOL_CALL_LIMIT_EXCEEDED" : "TOOL_ROUND_LIMIT_EXCEEDED" } }));
    for (const candidate of observation.runs) {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        const returned = { ...call, callId: `${candidate.runId}-call-${sequence}` };
        observation.requests.push({ runId: candidate.runId, sequence, messages: [{ role: "system", content: instruction }, { role: "user", content: fixture.prompts[0] }], responseToolCalls: [returned] });
        if (sequence <= candidate.maxCalls) observation.tools.push({ ...returned, runId: candidate.runId, output: '{"value":42}', status: "completed", requestSequence: sequence });
      }
    }
  }
  return observation;
}

test("baseline graders accept complete observations and reject misleading or missing controls", async (t) => {
  for (const id of ["B01", "B02", "B03", "B07"] as const) {
    await t.test(`${id} valid observations`, () => assert.equal(gradeBaselineCase(id, valid(id)).verdict, "pass"));
    await t.test(`${id} absent evidence`, () => assert.equal(gradeBaselineCase(id, { runs: [], requests: [], tools: [] }).verdict, "fail"));
  }
  const controls: Array<{ name: string; id: BaselineCaseId; mutate: (value: BaselineObservation) => void }> = [
    { name: "failed completion", id: "B01", mutate: (value) => { value.runs[0].status = "failed"; } },
    { name: "instruction mismatch", id: "B01", mutate: (value) => { value.requests[0].messages[0].content = "Different instructions"; } },
    { name: "answer without execution", id: "B02", mutate: (value) => { value.tools = []; } },
    { name: "answer without feedback", id: "B02", mutate: (value) => { value.requests[1].messages = value.requests[0].messages; } },
    { name: "unrelated tool identity", id: "B02", mutate: (value) => { value.tools[0].callId = "other-call"; } },
    { name: "number in error is not result", id: "B02", mutate: (value) => { value.requests[1].messages.at(-1)!.content = '{"error":"42 unavailable"}'; } },
    { name: "missing retained context", id: "B03", mutate: (value) => { value.requests[1].messages.splice(1, 2); } },
    { name: "duplicated retained context", id: "B03", mutate: (value) => { value.requests[1].messages.splice(2, 0, value.requests[1].messages[1]); } },
    { name: "wrong role order", id: "B03", mutate: (value) => { value.requests[1].messages[2].role = "user"; } },
    { name: "different sessions", id: "B03", mutate: (value) => { value.runs[1].sessionId = "other-session"; } },
    { name: "exceeded calls", id: "B07", mutate: (value) => { value.tools.push({ ...value.tools[0], callId: "extra-call" }); } },
    { name: "exceeded rounds", id: "B07", mutate: (value) => { value.requests.push({ ...value.requests[0], sequence: 4 }); } },
    { name: "unrelated failure", id: "B07", mutate: (value) => { value.runs[0].error = { code: "PROVIDER_UNAVAILABLE" }; } },
    { name: "no attempted exhaustion", id: "B07", mutate: (value) => { value.requests.forEach((request) => { request.responseToolCalls = []; }); } },
    { name: "fabricated completion", id: "B07", mutate: (value) => { value.runs[0].status = "completed"; value.runs[0].output = "42"; } },
  ];
  for (const control of controls) {
    await t.test(control.name, () => {
      const value = valid(control.id);
      control.mutate(value);
      const grade = gradeBaselineCase(control.id, value);
      assert.equal(grade.verdict, "fail");
      assert.ok(grade.assertions.some((assertion) => !assertion.passed));
    });
  }
});
