# Platform Agent Conformance scenario

Run one bounded agent workload through multiple execution platforms and compare the
observed lifecycle without treating the platforms as equivalent implementations.

This scenario is the acceptance workload for
[the cross-platform agent conformance plan](../../../development/implementation-plans/platforms/completed/platform-agent-conformance.md).
It is independent of platform code: the same inputs and observations are used for
Temporal, Restate, LangGraph, and Mastra.

## Workload cases

The research-backed [baseline eval specification](eval-cases.md) extends these
three original workload definitions into shared-core acceptance, live-model
measurements, and optional capability tests. B01–B12 are executable through the
native development evaluator; consult its implementation map and retained
observations before claiming acceptance.

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

## Historical four-case definitions

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

These pure tests validate the historical four-case grading, not native platform
acceptance. Version-1 saved reports retain these original meanings. The expanded
executable suite below provides the remaining core cases and the native B07 deadline.

## Expanded behaviour contracts

[`behaviour-evals.mjs`](behaviour-evals.mjs) provides suite and grader version `2`
for B01 through B12. It delegates the unchanged B01 through B03 contracts to
version `1`, extends B07 with a native deadline probe, and grades the additional
session, validation, permission, failure, cancellation, identity, evidence and
uncertainty cases. Its [declarations](behaviour-evals.d.mts) define the receipt types.

`eval:baseline` now runs these contracts through the
[behaviour driver](../../../server/src/evals/behaviour.ts). It defaults to all twelve
cases on Mastra; `--cases B04,B05` selects cases and
`--platforms mastra,langgraph,temporal,restate` selects up to four native profiles.
Use `--trials 1` for initial development observations; 1–5 trials are supported.

The SDK-independent module performs no execution. The driver collects actual
mapped requests, dispatches, rejections, independent fixture state and lifecycle
evidence through native runners. Integrity receipts inspect retained files and
projection output.
A missing required subcase fails; an unrelated failure does not satisfy an expected
failure category. Repeated cancellation needs evidence of repeated requests.

Schema-v1 reports retain historical compatibility and accept expanded case IDs,
up to sixteen referenced runs, and L04 through L06 live IDs. A human rubric still
awaiting assessment uses `reviewRequired: true` with verdict `blocked`.

Run the focused contract controls after building the server:

```bash
node --test server/dist/tests/platform-conformance/behaviour-graders.test.js server/dist/tests/control-plane/eval-report.test.js
```

This validates pure grading and report contracts. It does not replace an actual
native acceptance invocation. Follow the [development evaluator guide](../../experiments/agent-harness-baseline/development-evals.md)
for service setup, disposable fixture port `9191`, selected capability/approval
profiles, native deadline accounting and platform-specific failure policies.
B12 refuses a loopback readiness endpoint without changing production endpoints;
its lost-reference control preserves the actual accepted identity and reconciles
without redispatch. Broad crash matrices and optional X01–X05 remain separate.

## Controls

- Use the same scenario inputs, model selection, enabled tool list, context policy, and
  timeout for each platform in a comparison.
- Keep automated tests deterministic and offline. Fake models are test fixtures only;
  they must exercise the real selected platform runner and agent lifecycle.
- Use the separate free-only live evaluator for real-model decision probes.
  Record the exact model ID, provider outcome, runtime versions and evidence path.
  Scripted core cases make no provider calls.
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
