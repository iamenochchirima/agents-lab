# Platform Agent Conformance scenario

Run one bounded agent workload through multiple execution platforms and compare the
observed lifecycle without treating the platforms as equivalent implementations.

This scenario is the acceptance workload for
[the cross-platform agent conformance plan](../../../development/implementation-plans/active/platform-agent-conformance.md).
It is independent of platform code: the same inputs and observations are used for
Temporal, Restate, LangGraph, and Mastra.

## Workload cases

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
