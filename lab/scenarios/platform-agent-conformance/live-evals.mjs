/** Objective development probes, not statistical reliability estimates. Version when semantics change. */
export const LIVE_SUITE_VERSION = "1";
export const LIVE_GRADER_VERSION = "1";
export const LIVE_MARKER = "live-conformance-5831";
export const LIVE_INSTRUCTIONS = "Follow the user's task. Use only the enabled tools when requested. Keep final answers brief.";
export const LIVE_CASES = Object.freeze([
  { id: "L01", name: "Live prompt completion", prompts: [`Briefly explain why execution evidence matters. Include the marker ${LIVE_MARKER} in your answer.`], enabledTools: [], maxCalls: 2, maxRounds: 3 },
  { id: "L02", name: "Live calculator use", prompts: ["Use the calculator tool to add 17 and 25, then state the result."], enabledTools: ["calculator"], maxCalls: 2, maxRounds: 3 },
  { id: "L03", name: "Live context continuation", prompts: [`Remember this synthetic test value for the next turn: ${LIVE_MARKER}. Acknowledge briefly.`, "What test value did I ask you to remember? Answer with the value."], enabledTools: [], maxCalls: 2, maxRounds: 3 },
].map((item) => Object.freeze({ ...item, prompts: Object.freeze(item.prompts), enabledTools: Object.freeze(item.enabledTools) })));
export function liveCase(id) {
  const value = LIVE_CASES.find((item) => item.id === id);
  if (!value) throw new Error(`Unsupported live case: ${id}`);
  return value;
}
const calculatorInput = (value) => value?.operation === "add" && value?.left === 17 && value?.right === 25;
const result42 = (value) => {
  if (typeof value === "string") {
    try { return result42(JSON.parse(value)); } catch { return false; }
  }
  return value === 42 || value?.value === 42;
};

/** Grade actual mapped requests and dispatches. Missing evidence fails independently of answer quality. */
export function gradeLiveCase(id, observation) {
  const fixture = liveCase(id);
  const { runs, requests, tools } = observation;
  const assertions = [];
  const check = (id, passed, expected, observed) => assertions.push({ id, passed: Boolean(passed), expected, observed: observed ?? null });
  const count = id === "L03" ? 2 : 1;
  check("run-count", runs.length === count && new Set(runs.map((run) => run.runId)).size === count, count, runs.map((run) => run.runId));
  check("observation-identities", requests.every((request) => runs.some((run) => run.runId === request.runId)) && tools.every((tool) => runs.some((run) => run.runId === tool.runId)), "all observations belong to trial", { requests: requests.map((request) => request.runId), tools: tools.map((tool) => tool.runId) });
  for (const [index, run] of runs.entries()) {
    const captured = requests.filter((request) => request.runId === run.runId).sort((a, b) => a.sequence - b.sequence);
    check(`${run.runId}:completion`, run.status === "completed" && typeof run.output === "string" && run.output.trim().length > 0, "completed with nonempty final output", { status: run.status, output: run.output });
    check(`${run.runId}:request-sequences`, captured.length > 0 && captured.every((request, index) => request.sequence === index + 1), "contiguous request sequences", captured.map((request) => request.sequence));
    const systems = captured.map((request) => request.messages.filter((message) => message.role === "system").map((message) => message.content));
    check(`${run.runId}:instructions`, run.instructions.length > 0 && systems.length > 0 && systems.every((values) => values.length === 1 && values[0] === run.instructions), run.instructions, systems);
    const task = captured[0]?.messages.filter((message) => message.role === "user").at(-1)?.content;
    check(`${run.runId}:task`, task === fixture.prompts[index], fixture.prompts[index], task);
    check(`${run.runId}:within-limits`, run.maxCalls === fixture.maxCalls && run.maxRounds === fixture.maxRounds && captured.length <= run.maxRounds && tools.filter((tool) => tool.runId === run.runId).length <= run.maxCalls, { maxCalls: fixture.maxCalls, maxRounds: fixture.maxRounds }, { maxCalls: run.maxCalls, maxRounds: run.maxRounds, requests: captured.length, dispatches: tools.filter((tool) => tool.runId === run.runId).length });
  }
  if (id !== "L02") {
    check("no-tool-dispatch-or-demand", tools.length === 0 && requests.every((request) => (request.responseToolCalls?.length ?? 0) === 0), "no tools enabled", { dispatches: tools.length, calls: requests.flatMap((request) => request.responseToolCalls ?? []) });
  }
  if (id === "L01") check("marker-in-final-answer", runs[0]?.output?.includes(LIVE_MARKER), LIVE_MARKER, runs[0]?.output);
  if (id === "L02") {
    const unique = new Set(tools.map((tool) => `${tool.runId}:${tool.callId}`));
    check("calculator-execution", tools.length > 0 && unique.size === tools.length && tools.every((tool) => tool.toolName === "calculator" && tool.status === "completed" && calculatorInput(tool.input) && result42(tool.output)), "successful distinct calculator calls with add(17,25) = 42", tools);
    const demands = requests.flatMap((request) => (request.responseToolCalls ?? []).map((call) => ({ ...call, runId: request.runId })));
    check("tool-demand-coverage", demands.length > 0 && demands.every((call) => call.toolName === "calculator" && calculatorInput(call.input) && tools.some((tool) => tool.runId === call.runId && tool.callId === call.callId)), "all requested tools are valid calculator calls with observed dispatch", demands);
    const correlations = tools.map((tool) => {
      const sources = requests.filter((request) => request.runId === tool.runId && request.responseToolCalls?.some((call) => call.callId === tool.callId && call.toolName === tool.toolName && calculatorInput(call.input)));
      const next = sources.length === 1 && requests.find((request) => request.runId === tool.runId && request.sequence === sources[0].sequence + 1);
      const feedback = next?.messages.filter((message) => message.role === "tool" && message.toolCallId === tool.callId) ?? [];
      const assistant = next?.messages.some((message) => message.role === "assistant" && message.toolCalls?.some((call) => call.callId === tool.callId && call.toolName === tool.toolName && calculatorInput(call.input)));
      return { callId: tool.callId, sourceCount: sources.length, sourceSequence: sources[0]?.sequence ?? null, nextSequence: next?.sequence ?? null, feedback, assistant: Boolean(assistant), valid: sources.length === 1 && feedback.length === 1 && result42(feedback[0].content) && Boolean(assistant) };
    });
    check("correlated-tool-feedback", correlations.length > 0 && correlations.every((item) => item.valid), "model returned call and saw correlated successful feedback in next request", correlations);
    check("answer-includes-result", /\b42\b/.test(runs[0]?.output ?? ""), "numeric result 42", runs[0]?.output);
  }
  if (id === "L03") {
    const [first, second] = runs;
    check("one-session-two-turns", Boolean(first?.sessionId) && first?.sessionId === second?.sessionId && Boolean(first?.turnId) && Boolean(second?.turnId) && first?.turnId !== second?.turnId, "same fresh session, distinct turns", runs.map((run) => ({ sessionId: run.sessionId, turnId: run.turnId })));
    const transcript = requests.find((request) => request.runId === second?.runId && request.sequence === 1)?.messages.filter((message) => message.role !== "system").map(({ role, content }) => ({ role, content })) ?? [];
    const expected = [{ role: "user", content: fixture.prompts[0] }, { role: "assistant", content: first?.output ?? null }, { role: "user", content: fixture.prompts[1] }];
    check("retained-transcript-order", JSON.stringify(transcript) === JSON.stringify(expected), expected, transcript);
    check("recalled-marker", second?.output?.includes(LIVE_MARKER), LIVE_MARKER, second?.output);
  }
  return { caseId: id, verdict: assertions.every((assertion) => assertion.passed) ? "pass" : "fail", assertions };
}
