# Documentation

This directory contains the project's explanatory material.

Keep the README concise. Put concepts, architecture, harness notes, scenario notes, experiment procedures, contributor guides, and decision records in their dedicated directories.

Source-pinned reading notes for external reference harnesses live in
`research/harness-code-maps/`. They explain those projects for study; they do
not make them Agent Harness Lab platforms or benchmark subjects by default.

Documentation should explain why a choice exists, how a reader can verify it, and what remains uncertain.

[Platform agent eval research](research/platform-agent-evals.md) grounds the
[baseline eval cases](../lab/scenarios/platform-agent-conformance/eval-cases.md)
and [experiment protocol](../lab/experiments/agent-harness-baseline/README.md).
The [first development evaluator](../lab/experiments/agent-harness-baseline/development-evals.md)
executes four cases and retains inspectable results. The full suite remains a
development target.

The [platform readiness investigation](research/platform-eval-readiness.md)
audits current implementations and tests, selects the next executable slice,
and defines when scripted, live-model, and recovery evals can start.

[Context Lab lifecycle studies](research/context-lifecycles/README.md) trace how
reference harnesses construct, transform and persist model context. Start with Hermes.

[Agent system explorers](research/system-explorers/README.md) pair source studies
with interactive Studio maps of OpenClaw, Pi and Waku Agent. Each map pins its
source revision and distinguishes optional behavior and coverage limits.

[Lina architecture research](research/lina/README.md) links the agreed Input
decisions, mechanism experiment candidates, and architecture audit alongside
the Studio architecture workspace.
