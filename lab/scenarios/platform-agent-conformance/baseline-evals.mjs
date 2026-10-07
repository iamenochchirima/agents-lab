/** SDK-free synthetic inputs and observable acceptance checks. Version when semantics change. */
export const BASELINE_SUITE_VERSION = "1";
export const BASELINE_GRADER_VERSION = "1";
export const BASELINE_MARKER = "conformance-4318";
export const BASELINE_CASES = Object.freeze([
  { id: "B01", name: "Prompt completion", prompts: ["Explain in one sentence why execution evidence matters in an agent system."], outputs: ["Baseline eval completed."], enabledTools: [], maxCalls: 8, maxRounds: 6 },
  { id: "B02", name: "Tool feedback", prompts: ["Use the calculator tool to add 17 and 25, then state the result."], outputs: ["42"], enabledTools: ["calculator"], maxCalls: 8, maxRounds: 6 },
  { id: "B03", name: "Context continuation", prompts: [`Remember this test value for the next turn: ${BASELINE_MARKER}.`, "What test value did I ask you to remember? Answer with the value only."], outputs: ["Stored the test value.", BASELINE_MARKER], enabledTools: [], maxCalls: 8, maxRounds: 6 },
  { id: "B07", name: "Bounded execution", prompts: ["Keep using the calculator to add 17 and 25. Do not return a final answer."], outputs: [], enabledTools: ["calculator"], maxCalls: 2, maxRounds: 3 },
].map((item) => Object.freeze({ ...item, prompts: Object.freeze(item.prompts), outputs: Object.freeze(item.outputs), enabledTools: Object.freeze(item.enabledTools) })));
export const UNIMPLEMENTED_CORE_CASES = Object.freeze(["B04", "B05", "B06", "B08", "B09", "B10", "B11", "B12"]);
export function baselineCase(id) {
  const value = BASELINE_CASES.find((item) => item.id === id);
  if (!value) throw new Error(`Unsupported baseline case: ${id}`);
  return value;
}
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const calculatorInput = (value) => value?.operation === "add" && value?.left === 17 && value?.right === 25;
const containsResult = (value) => {
  if (typeof value === "string") {
    try { return containsResult(JSON.parse(value)); } catch { return false; }
  }
  return value === 42 || value?.value === 42;
};

/** Consume captured requests, never prepared context or final text as proof of model feedback. */
export function gradeBaselineCase(id, observation) {
  const fixture = baselineCase(id);
  const assertions = [];
  const check = (assertionId, passed, expected, observed) => assertions.push({ id: assertionId, passed: Boolean(passed), expected, observed: observed ?? null });
  const { runs, requests, tools } = observation;
  const expectedRuns = id === "B03" || id === "B07" ? 2 : 1;
  check("run-count", runs.length === expectedRuns && new Set(runs.map((run) => run.runId)).size === expectedRuns, expectedRuns, runs.map((run) => run.runId));
  check("observation-identities", requests.every((request) => runs.some((run) => run.runId === request.runId)) && tools.every((tool) => runs.some((run) => run.runId === tool.runId)), "all observations belong to case runs", { requests: requests.map((item) => item.runId), tools: tools.map((item) => item.runId) });
  for (const run of runs) {
    const captured = requests.filter((item) => item.runId === run.runId).sort((a, b) => a.sequence - b.sequence);
    check(`${run.runId}:request-sequences`, captured.length > 0 && captured.every((item, index) => item.sequence === index + 1), "contiguous sequence starting at 1", captured.map((item) => item.sequence));
    const systems = captured.map((item) => item.messages.filter((message) => message.role === "system").map((message) => message.content));
    check(`${run.runId}:instructions`, run.instructions.length > 0 && systems.length > 0 && systems.every((texts) => texts.length === 1 && texts[0] === run.instructions), run.instructions, systems);
  }
  if (id !== "B07") {
    runs.forEach((run, index) => {
      check(`${run.runId}:completion`, run.status === "completed" && run.output === fixture.outputs[index], { status: "completed", output: fixture.outputs[index] }, { status: run.status, output: run.output });
      const first = requests.find((item) => item.runId === run.runId && item.sequence === 1);
      const users = first?.messages.filter((message) => message.role === "user") ?? [];
      check(`${run.runId}:task`, users.at(-1)?.content === fixture.prompts[index], fixture.prompts[index], users.at(-1)?.content);
    });
  }
  if (id === "B01") {
    check("single-model-request", requests.length === 1 && requests.every((request) => (request.responseToolCalls?.length ?? 0) === 0), "one request returning no tool calls", { requests: requests.length, returnedCalls: requests.flatMap((request) => request.responseToolCalls ?? []).length });
    check("no-tool-dispatch", tools.length === 0, 0, tools.length);
  }
  if (id === "B02") {
    const tool = tools[0];
    check("calculator-executed-once", tools.length === 1 && tool?.toolName === "calculator" && tool.status === "completed" && calculatorInput(tool.input) && containsResult(tool.output), { dispatches: 1, tool: "calculator", input: { operation: "add", left: 17, right: 25 }, output: 42 }, tools);
    const source = requests.find((request) => request.responseToolCalls?.some((call) => call.callId === tool?.callId && call.toolName === "calculator" && calculatorInput(call.input)));
    const next = source && requests.find((request) => request.runId === source.runId && request.sequence === source.sequence + 1);
    const feedback = next?.messages.filter((message) => message.role === "tool" && message.toolCallId === tool?.callId) ?? [];
    check("correlated-next-request-feedback", Boolean(tool?.callId) && source?.runId === tool?.runId && feedback.length === 1 && containsResult(feedback[0].content), "returned calculator call ID and actual result 42 in next request", { callId: tool?.callId, sourceSequence: source?.sequence, nextSequence: next?.sequence, feedback });
  }
  if (id === "B03") {
    const [first, second] = runs;
    check("one-session-two-turns", Boolean(first?.sessionId) && first?.sessionId === second?.sessionId && Boolean(first?.turnId) && Boolean(second?.turnId) && first?.turnId !== second?.turnId, "same session; distinct turn IDs", runs.map((run) => ({ sessionId: run.sessionId, turnId: run.turnId })));
    const next = requests.find((request) => request.runId === second?.runId && request.sequence === 1);
    const transcript = next?.messages.filter((message) => message.role !== "system") ?? [];
    const expected = [{ role: "user", content: fixture.prompts[0] }, { role: "assistant", content: fixture.outputs[0] }, { role: "user", content: fixture.prompts[1] }];
    check("retained-transcript-order", equal(transcript.map(({ role, content }) => ({ role, content })), expected), expected, transcript);
    check("single-request-per-turn", requests.length === 2 && requests.every((request) => request.sequence === 1), 2, requests.map((request) => ({ runId: request.runId, sequence: request.sequence })));
    check("no-tool-dispatch", tools.length === 0, 0, tools.length);
  }
  if (id === "B07") {
    check("distinct-limit-probes", equal(runs.map((run) => run.probe).sort(), ["calls", "rounds"]), ["calls", "rounds"], runs.map((run) => run.probe));
    for (const run of runs) {
      const captured = requests.filter((request) => request.runId === run.runId);
      const dispatched = tools.filter((tool) => tool.runId === run.runId);
      const demand = captured.flatMap((request) => request.responseToolCalls ?? []);
      const reason = `${run.error?.code ?? ""} ${run.error?.failureKind ?? ""} ${run.error?.message ?? ""}`;
      const relevantReason = run.probe === "calls" ? /(?:call.*limit|limit.*call)/i : /(?:round.*limit|limit.*round)/i;
      check(`${run.runId}:within-limits`, Number.isInteger(run.maxCalls) && run.maxCalls > 0 && Number.isInteger(run.maxRounds) && run.maxRounds > 0 && captured.length <= run.maxRounds && dispatched.length <= run.maxCalls, { maxCalls: run.maxCalls, maxRounds: run.maxRounds }, { requests: captured.length, dispatches: dispatched.length });
      check(`${run.runId}:observed-dispatches`, (run.probe === "calls" ? dispatched.length === run.maxCalls : dispatched.length > 0) && dispatched.every((tool) => tool.toolName === "calculator" && calculatorInput(tool.input)) && demand.every((call) => call.toolName === "calculator" && calculatorInput(call.input)), run.probe === "calls" ? "calculator dispatches consume the call allowance" : "calculator dispatch occurs before round exhaustion", { dispatches: dispatched.length, returnedCalls: demand });
      check(`${run.runId}:exhaustion-demand`, run.probe === "calls" ? demand.length > run.maxCalls : captured.length === run.maxRounds && (captured.at(-1)?.responseToolCalls?.length ?? 0) > 0, run.probe === "calls" ? "script requests more calls than allowed" : "last allowed round still requests tools", { returnedCalls: demand.length, requests: captured.length, lastReturnedCalls: captured.at(-1)?.responseToolCalls?.length ?? 0 });
      check(`${run.runId}:truthful-limit-outcome`, run.status === "failed" && run.output === null && relevantReason.test(reason), { status: "failed", output: null, reason: `${run.probe} limit` }, { status: run.status, output: run.output, error: run.error });
    }
  }
  return { caseId: id, verdict: assertions.every((item) => item.passed) ? "pass" : "fail", assertions };
}
