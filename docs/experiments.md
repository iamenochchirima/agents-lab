# Experiments

Experiments define what the laboratory is trying to learn. They control a
variable or failure condition across comparable runs.

Each published experiment will state its hypothesis, procedure, injected faults,
controls, expected observations, and interpretation limits.

The [agent harness baseline experiment](../lab/experiments/agent-harness-baseline/README.md)
defines how to test the shared agent contract across platform variants. It
separates scripted harness checks from live-model measurements and optional
recovery capabilities, with per-case verdicts and inspectable evidence.
The [development command](../lab/experiments/agent-harness-baseline/development-evals.md)
executes four scripted cases. Mastra and an isolated LangGraph profile have
retained passing development trials; full baseline readiness remains pending.

Start with the [eval case specification](../lab/scenarios/platform-agent-conformance/eval-cases.md),
then read the [source research](research/platform-agent-evals.md) and
[implementation plan](../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).
