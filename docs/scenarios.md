# Scenarios

Scenarios define what an agent must accomplish. They are reusable workloads,
independent from the runtime used to execute them.

Each published scenario will document its inputs, workspace or external fixtures,
expected artifacts, grading rules, controls, and known limitations.

The [platform agent conformance scenario](../lab/scenarios/platform-agent-conformance/README.md)
defines a shared workload for inspecting each platform's agent execution path.
Its [baseline eval cases](../lab/scenarios/platform-agent-conformance/eval-cases.md)
specify twelve core harness checks, four live-model checks, and five optional
capability extensions. The expanded suite is a development target. Its
implementation map distinguishes existing coverage from checks still to build.

Read the [source research](research/platform-agent-evals.md) for the reasoning
behind the cases and the [baseline experiment](../lab/experiments/agent-harness-baseline/README.md)
for the controls and grading procedure.
