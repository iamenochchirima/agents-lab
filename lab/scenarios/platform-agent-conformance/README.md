# Platform Agent Conformance scenario

Run one bounded agent workload through multiple execution platforms and compare the
observed lifecycle without treating the platforms as equivalent implementations.

This scenario is the acceptance workload for
[the cross-platform agent conformance plan](../../../development/implementation-plans/platforms/completed/platform-agent-conformance.md).
It is independent of platform code: the same inputs and observations are used for
Temporal, Restate, LangGraph, and Mastra.

## Workload cases

The research-backed [baseline eval specification](eval-cases.md) extends these
three implemented workload definitions into shared-core acceptance, live-model
measurements, and optional capability tests. The expanded suite is a development
target; consult its implementation map before claiming coverage.

### 1. Prompt completion

Submit one ordinary prompt and record the complete model-backed response. The expected
common observations are:

- the selected platform and model remain visible in the immutable run configuration;
- the run reaches a truthful terminal state;
- model request and completion events are ordered;
- usage values are recorded when the provider supplies them and remain `null` otherwise;
- normalized and native evidence can be inspected after completion.

### 2. Calculator tool turn

Ask the agent to use the enabled `calculator` tool for one arithmetic operation and then
explain the result. Only the existing pure calculator is enabled. The tool is not a
filesystem, network, subprocess, browser, or social-media capability.

The expected observations are:

- the model receives the calculator definition only when the case enables it;
- a requested call has a stable call ID and round number;
- validation, policy, execution, and result events reflect what actually happened;
- the final response is produced from the observed tool result;
- tool limits and errors remain visible without leaking provider data.

A deterministic model fixture may request the call so automated tests do not depend on
model behaviour. A real OpenRouter run is a separate manual observation; if the selected
model does not request a tool call, record that fact instead of treating a direct answer
as successful tool execution.

### 3. Two-turn context continuation

Submit a first turn with an explicit session ID and client turn ID, then submit a second
turn to the same session with a different client turn ID. The second request must use a
new request-local context snapshot that contains the retained context from the first
turn, subject to the shared context policy.

The expected observations are:

- both turns retain the same session ID and have distinct run and turn IDs;
- the second turn does not duplicate or overwrite the first turn's transcript;
- the server-owned context projection reports the current token budget and pressure;
- the selected platform receives the snapshot through its native execution path;
- a context compaction record appears only when the shared policy actually triggers it.

The case verifies context delivery and evidence identity. It does not claim that a
deterministic fixture demonstrates model reasoning quality.

## Executable four-case definitions

[`baseline-evals.mjs`](baseline-evals.mjs) owns the synthetic inputs and pure
B01, B02, B03, and focused B07 graders. Its
[TypeScript declarations](baseline-evals.d.mts) describe the observation contract.
These files import no platform SDK and perform no model or tool execution.
The driver must supply requests captured after platform-specific model mapping,
actual tool dispatch observations, and ordinary terminal run records.

B01 requires the exact scripted completion and recorded system instructions in the
actual request. B02 requires one completed calculator dispatch, its returned call
identity, and the calculator payload containing `value: 42` in the next actual
request. A final answer containing `42` alone fails. B03 requires distinct turns in
one session and the exact user, assistant, user transcript in the second request.
B07 uses separate call-limit and round-limit runs. The script must demand more
work, observed dispatches and model requests must stay within the recorded limits,
and a failed terminal result must identify the relevant limit without a fabricated
answer. This focused B07 does not test deadlines or cancellation.

Each grade retains individual assertion IDs and expected/observed values. Missing
observations fail. A failed agent run may pass B07 because exhaustion is expected;
a completed run may fail another case. The suite and grader versions are `1`.
Changing these acceptance semantics requires a version change.

The table-driven controls in
[`baseline-graders.test.ts`](../../../server/tests/platform-conformance/baseline-graders.test.ts)
check valid observations and misleading results, absent feedback, transcript
duplication, exceeded budgets, and unrelated failures. From the repository root:

```bash
pnpm --filter @agent-harness-lab/lab-server run build
node --test server/dist/tests/platform-conformance/baseline-graders.test.js
```

These pure tests validate grading, not native platform acceptance. B04, B05, B06,
and B08 through B12 remain unimplemented in this executable slice.

## Controls

- Use the same scenario inputs, model selection, enabled tool list, context policy, and
  timeout for each platform in a comparison.
- Keep automated tests deterministic and offline. Fake models are test fixtures only;
  they must exercise the real selected platform runner and agent lifecycle.
- Use a real OpenRouter model only for explicit manual acceptance. Record the model ID,
  provider outcome, runtime versions, and evidence path.
- Run each platform with its documented native local profile. Missing services produce an
  unavailable result; they are not replaced by a fake successful run.
- Preserve platform-native execution IDs, checkpoints, journal/workflow details, and
  process-local limitations alongside normalized records.

## Evidence to inspect

For each run, inspect the common files under `lab/runs/<run-id>/`:

```text
config.json
events.jsonl
trajectory.json
metrics.json
result.json
native/<platform>.json
```

Also inspect the platform-owned state when relevant:

- Temporal workflow history and worker events;
- Restate workflow key, invocation, durable-step, and journal state;
- LangGraph thread/checkpoint and service event state;
- Mastra direct-agent process-local execution state.

Do not copy provider keys, authorization headers, raw cookies, or unbounded provider
payloads into the evidence.

## Interpretation limits

This scenario compares observed execution behaviour for one workload. It does not prove
that one platform is better overall, that local execution equals hosted production, or
that a durable workflow makes an external model request exactly-once. Tool-call
selection by a real model is a model/provider observation, not a platform conformance
failure by itself.
