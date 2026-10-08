# Real capability acceptance experiment

## Question and hypothesis

Can each native baseline use the same admitted capability packages to perform a
workspace task and a service task, then apply a correction with inspectable effects?
The hypothesis is that catalog-based tool declarations and shared source adapters
support these workflows without platform-specific tool-name branches. A successful
trial requires actual artifacts or saved application state plus native tool evidence.

This is development acceptance with one workflow per task and platform. It is not a
ranking of platforms, a statistical reliability estimate or a model-quality benchmark.
Deterministic adapter tests and real-model observations answer different questions
and must retain separate labels.

## Changed variable and controls

The changed variable is the native baseline: Mastra, LangGraph, Temporal or Restate.
Each uses the same fictional inputs, package definitions, task prompts, correction,
shared context store and approval policy. Workspace and service are separate
scenarios with separate sessions. Only the two turns of one task share state.

| Control | Current value |
| --- | --- |
| Experiment ID | `agent-capabilities-live` |
| Default model | `nvidia/nemotron-3.5-lightning:free` |
| Alternate approved model | `google/gemma-4-31b-it:free` |
| Output allowance | 2048 tokens per provider request |
| Agent limits | 24 model rounds and 32 logical tool calls per turn |
| Driver observation deadline | 180 seconds per turn |
| Routing | Fresh zero-price catalog check, zero billing ceilings, required parameters, disabled provider fallback |
| Fault injection | None in these live workflows |

The model remains identical across a comparison invocation. An alternate model
requires its exact approved free ID and current zero-price catalog eligibility.
There is no paid substitute. Existing `agent-harness-live` experiments keep their
512-token allowance; this experiment has its own controls because the multi-step
workload needs more output. Remote models have no deterministic seed guarantee.

Set native execution allowances as described in the guide. Provider time, catalog
availability and service load remain uncontrolled influences. Platform order is
fixed by the CLI list, so latency comparisons can be confounded by time and order.

## Procedure

1. Start the controlled task service, load `acceptance.json` in the control plane,
   and start the selected real platform services or workers. Use consistent
   absolute run/context roots and host credentials.
2. Check the currently available zero-price model catalog before any trial admission.
3. Create a fresh session for each platform/task pair, with explicit approval for
   every declared side-effecting operation in its selected profile.
4. Submit the task and correction through normal run admission. The native platform
   owns model decisions and execution; the driver only submits and observes.
5. Inspect retained receipts, ordered native events, actual saved artifacts and
   independent service snapshots. Apply the scenario's assertions.
6. Preserve every outcome, including incomplete trials and provider failures.

Run from the repository root:

```sh
pnpm --filter @agent-harness-lab/lab-server eval:capabilities -- \
  --api http://127.0.0.1:4318 \
  --platforms mastra,langgraph,temporal,restate --tasks workspace,service
```

Use a smaller platform or task list for the available local services. Full setup
is in [the capability guide](../../../docs/guides/capability-packages.md).
Scenario inputs and grading rules are documented beside
[workspace fixtures](../../scenarios/workspace-capabilities/README.md) and
[the service task](../../scenarios/service-capabilities/README.md).

## Evidence and interpretation

The aggregate report at `lab/runs/.evals/capabilities-<uuid>/summary.json` records
repository revision and dirty state, exact prompts, free model ID, budgets,
profile IDs, sessions, run IDs, statuses, assertion results and tool evidence.
Workspace output and service snapshots provide independent effect inspection.
Canonical run directories retain resolved catalogs, skill/context identity,
`EvalModelObserved` provider requests and returned decisions, tool results, native
identifiers, configuration, events, metrics and result records.

The command exits unsuccessfully if any task errors or fails an assertion.
An error is different from a completed native run with failing artifact checks.
Retain both. Classify a failure as adapter, harness, model, provider, environment
or unresolved only after inspecting its evidence; the driver does not infer a
cause merely from an unsuccessful outcome.

These live workflows do not inject crashes, duplicate events, cancellation at a
controlled effect boundary or lost acknowledgements. Focused adapter and lifecycle
checks cover named contracts separately. Passing this experiment does not establish
those failure guarantees, exactly-once external effects, arbitrary plugin safety,
full MCP conformance or a production-ready agent.
