import { BASELINE_CASES, gradeBaselineCase } from "./baseline-evals.mjs";

/** Expanded scripted contracts. Receipts describe inspected evidence, never guessed outcomes. */
export const BEHAVIOUR_SUITE_VERSION = "2";
export const BEHAVIOUR_GRADER_VERSION = "2";
export const ISOLATION_MARKERS = Object.freeze(["isolation-alpha-7319", "isolation-beta-8264"]);
export const BEHAVIOUR_CASES = Object.freeze([
  ...BASELINE_CASES,
  { id: "B04", name: "Session isolation", probes: ["alpha-store", "beta-store", "alpha-recall", "beta-recall"] },
  { id: "B05", name: "Invalid tool input", probes: ["invalid"] },
  { id: "B06", name: "Permission boundary", probes: ["disabled", "unapproved", "approved"] },
  { id: "B08", name: "Failure propagation", probes: ["provider", "malformed", "tool"] },
  { id: "B09", name: "Cancellation", probes: ["during", "completed", "repeated"] },
  { id: "B10", name: "Submission identity", probes: ["replay", "conflict"] },
  { id: "B11", name: "Evidence integrity", probes: ["successful", "failed", "cancelled", "ambiguous"] },
  { id: "B12", name: "Availability and uncertainty", probes: ["unavailable", "ack-loss"] },
].sort((a, b) => a.id.localeCompare(b.id)).map((value) => Object.freeze(value)));
export function behaviourCase(id) {
  const fixture = BEHAVIOUR_CASES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unsupported behaviour case: ${id}`);
  return fixture;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nonempty = (value) => typeof value === "string" && value.length > 0;
const startsWork = (event) => /^(ModelRequested|ToolRequested|ToolStarted|ModelStarted|model-start|tool-start)$/.test(event.type);

/** Missing subcases, identities, or independent effects fail rather than becoming generic error passes. */
export function gradeBehaviourCase(id, observation) {
  const fixture = behaviourCase(id);
  if (["B01", "B02", "B03"].includes(id)) return gradeBaselineCase(id, observation);
  const { runs, requests, tools } = observation;
  const assertions = [];
  const check = (key, passed, expected, observed) => assertions.push({ id: key, passed: Boolean(passed), expected, observed: observed ?? null });
  const events = observation.events ?? [];
  const admissions = observation.admissions ?? [];
  const snapshots = observation.fixtureSnapshots ?? [];
  const rejections = observation.rejections ?? [];
  const probes = id === "B07" ? ["calls", "rounds", "deadline"] : fixture.probes;
  if (!["B10", "B12"].includes(id)) check("distinct-required-probes", runs.length === probes.length && same(runs.map((run) => run.probe).sort(), [...probes].sort()), probes, runs.map((run) => run.probe));
  check("observation-identities", new Set(runs.map((run) => run.runId)).size === runs.length && [...requests, ...tools, ...events, ...rejections].every((item) => runs.some((run) => run.runId === item.runId)), "unique runs and every observation belongs to a case run", runs.map((run) => run.runId));
  const runFor = (probe) => runs.find((run) => run.probe === probe);
  const unchanged = (probe) => { const value = snapshots.find((item) => item.probe === probe); return value && nonempty(value.namespace) && same(value.before, value.after) && value.effectCount === 0; };
  if (id === "B04") {
    const alpha = runs.filter((run) => run.probe?.startsWith("alpha"));
    const beta = runs.filter((run) => run.probe?.startsWith("beta"));
    check("independent-two-turn-sessions", alpha.length === 2 && beta.length === 2 && nonempty(alpha[0]?.sessionId) && nonempty(beta[0]?.sessionId) && alpha[0].sessionId === alpha[1].sessionId && beta[0].sessionId === beta[1].sessionId && alpha[0].sessionId !== beta[0].sessionId && new Set(runs.map((run) => run.turnId)).size === 4, "two distinct sessions with two distinct turns each", runs);
    for (const run of runs) {
      const index = run.probe?.startsWith("alpha") ? 0 : 1;
      const captured = requests.filter((item) => item.runId === run.runId);
      const text = JSON.stringify(captured);
      check(`${run.runId}:isolated-context`, captured.length > 0 && text.includes(ISOLATION_MARKERS[index]) && !text.includes(ISOLATION_MARKERS[1 - index]), { own: ISOLATION_MARKERS[index], absent: ISOLATION_MARKERS[1 - index] }, captured);
      check(`${run.runId}:completion`, run.status === "completed" && (run.probe.endsWith("recall") ? run.output === ISOLATION_MARKERS[index] : nonempty(run.output)), "completed with own marker on recall", { status: run.status, output: run.output });
    }
    check("tool-call-session-correlation", tools.every((tool) => requests.some((request) => request.runId === tool.runId && request.responseToolCalls?.some((call) => call.callId === tool.callId))) && new Set(tools.map((tool) => tool.callId)).size === tools.length, "each tool call belongs to its own run, no reused call identities", tools);
    check("interleaved-turn-order", same(runs.map((run) => run.probe), fixture.probes), fixture.probes, runs.map((run) => run.probe));
  }
  if (id === "B05" || id === "B06") {
    for (const probe of id === "B05" ? ["invalid"] : ["disabled", "unapproved"]) {
      const run = runFor(probe);
      const captured = requests.filter((item) => item.runId === run?.runId);
      const denied = rejections.filter((item) => item.runId === run?.runId);
      const kind = probe === "invalid" ? "validation" : probe === "disabled" ? "disabled" : "approval";
      const calls = captured.flatMap((item) => item.responseToolCalls ?? []);
      check(`${probe}:rejected-before-dispatch`, calls.length === 1 && denied.length === 1 && denied[0].kind === kind && nonempty(denied[0].reason) && denied[0].callId === calls[0].callId && denied[0].toolName === calls[0].toolName && tools.filter((item) => item.runId === run?.runId).length === 0, { kind, dispatches: 0, rejectedCalls: 1 }, { calls, denied, tools: tools.filter((item) => item.runId === run?.runId) });
      if (probe === "invalid") {
        const call = calls[0];
        const input = call?.input;
        const validInput = input && ["add", "subtract", "multiply", "divide"].includes(input.operation) && typeof input.left === "number" && Number.isFinite(input.left) && typeof input.right === "number" && Number.isFinite(input.right);
        check("invalid:actually-invalid-calculator-input", call?.toolName === "calculator" && !validInput, "calculator with unsupported operation or nonnumeric operand", call);
      }
      const feedback = captured.slice(1).flatMap((item) => item.messages).some((message) => message.role === "tool" && message.toolCallId === calls[0]?.callId && nonempty(message.content));
      check(`${probe}:declared-policy`, run?.failurePolicy === "terminal" ? run.status === "failed" && run.output === null && nonempty(run.error?.code) : run?.failurePolicy === "continue" && run.status === "completed" && feedback, "declared terminal failure or actual correlated feedback followed by completion", { policy: run?.failurePolicy, status: run?.status, error: run?.error, feedback });
      if (id === "B06") check(`${probe}:no-effects`, unchanged(probe), "unchanged fixture and zero effects", snapshots.find((item) => item.probe === probe));
    }
    if (id === "B06") {
      const run = runFor("approved");
      const snapshot = snapshots.find((item) => item.probe === "approved");
      const dispatched = tools.filter((item) => item.runId === run?.runId);
      check("approved:scoped-write", run?.status === "completed" && run.approvalGranted === true && dispatched.length === 1 && dispatched[0].toolName === "fixture_write" && dispatched[0].status === "completed" && snapshot?.effectCount === 1 && nonempty(snapshot.namespace) && !same(snapshot.before, snapshot.after), "explicit scoped approval, one successful effect and changed fixture", { run, dispatched, snapshot });
      check("independent-fixtures", snapshots.length === 3 && new Set(snapshots.map((item) => item.namespace)).size === 3, "three fresh fixture namespaces", snapshots.map((item) => item.namespace));
    }
  }
  if (id === "B07") {
    const budgetRuns = runs.filter((run) => ["calls", "rounds"].includes(run.probe));
    const ids = new Set(budgetRuns.map((run) => run.runId));
    const baseline = gradeBaselineCase(id, { runs: budgetRuns, requests: requests.filter((item) => ids.has(item.runId)), tools: tools.filter((item) => ids.has(item.runId)) });
    assertions.push(...baseline.assertions);
    const run = runFor("deadline");
    check("deadline:native-enforcement", run?.status === "failed" && run.output === null && /deadline|timeout/i.test(`${run.error?.code} ${run.error?.failureKind}`) && Number.isFinite(run.deadlineMs) && run.deadlineMs > 0 && Number.isFinite(run.elapsedMs) && run.elapsedMs >= run.deadlineMs && run.deadlineSource === "native" && ["cancelled", "completed", "unknown"].includes(run.inFlight), "native deadline failure with measured elapsed time and explicit in-flight state", run);
    check("deadline:actual-dispatch", tools.some((tool) => tool.runId === run?.runId) || requests.some((request) => request.runId === run?.runId), "slow work actually dispatched", { tools: tools.filter((item) => item.runId === run?.runId), requests: requests.filter((item) => item.runId === run?.runId) });
  }
  if (id === "B08") {
    for (const probe of fixture.probes) {
      const run = runFor(probe);
      const dispatched = tools.filter((item) => item.runId === run?.runId);
      const expected = { provider: "provider", malformed: "malformed", tool: "tool" }[probe];
      check(`${probe}:failure-category-and-attempts`, run?.observedFailureKind === expected && Number.isInteger(run.attemptCount) && run.attemptCount >= 1 && run.attemptCount === run.expectedAttempts, { kind: expected, attempts: run?.expectedAttempts }, { kind: run?.observedFailureKind, attempts: run?.attemptCount });
      const feedback = requests.filter((item) => item.runId === run?.runId).some((request) => request.messages.some((message) => message.role === "tool" && dispatched.some((tool) => tool.status === "failed" && tool.callId === message.toolCallId) && nonempty(message.content)));
      check(`${probe}:truthful-failure-policy`, run?.failurePolicy === "terminal" ? run.status === "failed" && run.output === null && nonempty(run.error?.code) : probe === "tool" && run?.failurePolicy === "continue" && run.status === "completed" && feedback, "category-specific failure or declared recoverable tool feedback", { run, feedback });
      if (probe === "tool") check("tool:actual-error", dispatched.length === 1 && dispatched[0].status === "failed", "one actual failed tool dispatch", dispatched);
    }
  }
  if (id === "B09") {
    for (const probe of fixture.probes) {
      const run = runFor(probe);
      const receipt = observation.cancellations?.find((item) => item.runId === run?.runId && item.probe === probe);
      check(`${probe}:canonical-terminal`, receipt?.terminalCount === 1 && receipt.status === run?.status && (probe === "completed" ? run.status === "completed" && nonempty(run.output) : run?.status === "cancelled" && run.output === null) && ["cancelled", "completed", "unknown", "none"].includes(receipt?.inFlight), "one truthful terminal result; completed work stays completed", { run, receipt });
      check(`${probe}:cancellation-requests`, Number.isInteger(receipt?.requestedCount) && receipt.requestedCount >= (probe === "repeated" ? 2 : 1), probe === "repeated" ? "at least two cancellation requests" : "at least one cancellation request", receipt?.requestedCount);
      const ownEvents = events.filter((item) => item.runId === run?.runId);
      check(`${probe}:no-work-after-cancel`, Number.isInteger(receipt?.observedSequence) && ownEvents.some((item) => item.sequence === receipt.observedSequence && /cancel/i.test(item.type)) && !ownEvents.some((item) => item.sequence > receipt.observedSequence && startsWork(item)), "observed cancellation and no later work starts", ownEvents);
      if (probe !== "completed") check(`${probe}:dispatch-before-cancel`, ownEvents.some((item) => item.sequence < receipt?.observedSequence && startsWork(item)), "work dispatched before cancellation", ownEvents);
    }
  }
  if (id === "B10") {
    const replay = admissions.find((item) => item.probe === "replay");
    const conflict = admissions.find((item) => item.probe === "conflict");
    check("one-canonical-run", runs.length === 1 && replay?.accepted === true && replay.runId === runs[0].runId && replay.canonicalRunId === runs[0].runId && replay.dispatchCount === 1, "identical replay returns one canonical run and one dispatch", { runs, replay });
    check("conflicting-reuse-rejected", conflict?.accepted === false && nonempty(conflict.errorCode) && conflict.canonicalRunId === runs[0]?.runId && conflict.dispatchCount === 0, "changed content rejected with canonical identity and no new dispatch", conflict);
  }
  if (id === "B11") {
    for (const run of runs) {
      const receipt = observation.integrity?.find((item) => item.runId === run.runId);
      const expectedStatus = { successful: "completed", failed: "failed", cancelled: "cancelled" }[run.probe];
      check(`${run.runId}:outcome-class`, expectedStatus ? run.status === expectedStatus : ["dispatch-unknown", "reconciliation-required", "unknown"].includes(run.status), expectedStatus ?? "ambiguous outcome", run.status);
      for (const key of ["configImmutable", "eventIdentities", "eventOrder", "trajectoryConsistent", "metricsConsistent", "resultConsistent", "referencesSafe", "credentialsAbsent", "usageUnknownCorrect"]) check(`${run.runId}:${key}`, receipt?.[key] === true, true, receipt?.[key]);
    }
    const projection = observation.projection;
    check("duplicate-out-of-order-projection", projection?.duplicateCount >= 1 && projection.outOfOrderCount >= 1 && Number.isInteger(projection.expectedActions) && projection.expectedActions > 0 && projection.uniqueActions === projection.expectedActions && projection.inputCount > projection.uniqueActions, "duplicate and reordered events project each action once", projection);
  }
  if (id === "B12") {
    const unavailable = admissions.find((item) => item.probe === "unavailable");
    const lost = admissions.find((item) => item.probe === "ack-loss");
    check("unavailable:no-admission", unavailable?.accepted === false && nonempty(unavailable.errorCode) && unavailable.dispatchCount === 0 && !unavailable.runId, "service unavailable before dispatch, no admitted run", unavailable);
    check("ack-loss:retained-identity-no-redispatch", lost?.accepted === true && nonempty(lost.runId) && runs.some((run) => run.runId === lost.runId && ((["dispatch-unknown", "reconciliation-required", "unknown"].includes(run.status) && run.output === null) || (lost.observedUnknown === true && lost.resolved === true && ["completed", "failed", "cancelled"].includes(run.status)))) && lost.dispatchCount === 1 && lost.reconciliationRequired === true, "one dispatch and retained identity, initially unknown until evidence-based reconciliation", { lost, runs });
  }
  return { caseId: id, verdict: assertions.every((item) => item.passed) ? "pass" : "fail", assertions };
}
