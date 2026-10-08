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
| Driver observation deadline | 180 seconds by default; explicit `--deadline-ms` permits 1000–600000 ms and is retained |
| Routing | Fresh zero-price catalog check, zero billing ceilings, required parameters, disabled provider fallback |
| Fault injection | None in these live workflows |
| Temperature and seed | Omitted; provider defaults apply and deterministic reproduction is not claimed |

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
profile IDs, sessions, run IDs, statuses, assertion results and tool evidence. New
reports also retain installed SDK versions, native configuration/references and
invocation start/completion markers. Older reports remain explicitly incomplete
in Evals if they lack completion metadata; their original verdicts stay unchanged.
Workspace output and service snapshots provide independent effect inspection.
Canonical run directories retain resolved catalogs, skill/context identity,
`EvalModelObserved` provider requests and returned decisions, tool results, native
identifiers, configuration, events, metrics and result records.

The command exits unsuccessfully if any task errors or fails an assertion.
An error is different from a completed native run with failing artifact checks.
Retain both. Classify a failure as adapter, harness, model, provider, environment
or unresolved only after inspecting its evidence; the driver does not infer a
cause merely from an unsuccessful outcome.

Dispatch evidence differs by native runtime. TypeScript can retain separate
request/response observations; Python retains a combined observation with the
actual dispatched request. Both must satisfy the same free-routing policy.
To reinspect a retained report after an observation-format fix, without calling
a model or replacing its original verdicts:

```sh
pnpm --filter @agent-harness-lab/lab-server eval:capabilities -- \
  --review-routing /absolute/path/lab/runs/.evals/capabilities-ID/summary.json
```

The adjacent `routing-review.json` records only the new routing assessment and
grader revision. Task assertions and original failures remain in `summary.json`.

These live workflows do not inject crashes, duplicate events, cancellation at a
controlled effect boundary or lost acknowledgements. Focused adapter and lifecycle
checks cover named contracts separately. Passing this experiment does not establish
those failure guarantees, exactly-once external effects, arbitrary plugin safety,
full MCP conformance or a production-ready agent.

## Development observation on 2026-10-08

One free Nemotron invocation retained eight task observations and sixteen native
turn records. The original local report is
`lab/runs/.evals/capabilities-51211f00-2c24-4bd6-b6b6-98cb8afc14ae/summary.json`.
Its adjacent routing review confirms zero-price, fallback-disabled requests for
every turn. The original driver incorrectly required phased telemetry; Temporal
and LangGraph retain combined request/response observations. Their original
routing failures remain in the report, and the separate review records the fix.

| Platform | Workspace task | Service task |
| --- | --- | --- |
| Mastra | Passed both turns | Passed both turns |
| LangGraph | Saved and verified the correction, but skipped the required fresh read before editing | Saved and verified both owners, but skipped the requested skill |
| Temporal | Passed both turns | Passed both turns |
| Restate | Saved and verified the correction, but its final response exceeded the 180-second observation deadline | Saved and verified both owners, but skipped the requested skill |

The Restate correction subsequently settled as cancelled. Its successful artifact
checks do not convert the deadline failure into a passing task. Every service
namespace ended with Avery at revision 3 and preserved the approved date and
dependency. Every workspace contained the saved, corrected report. The workflow
assertions still distinguish these effects from following all requested steps.

Earlier failed observations remain alongside this invocation. One used the wrong
host port; another lost its LangGraph worker and settled as reconciliation-required.
The host-port default was corrected. A directory-creation hallucination recovered
through tool feedback, and the write tool now explicitly describes creating parent
directories. These findings prompted configuration, telemetry and description fixes;
they do not establish a platform ranking or reliable success rates.

## Connected business and external document extension

The `support` task in `eval:capabilities` uses `customer-support.json` and the
[connected support scenario](../../scenarios/business-agent/README.md). All four
native baselines receive the same customer/order/policy task. The model must load
the named skill and choose the reads and adjustment. The driver reviews its exact
proposal under a recorded local-fixture-only 500-cent policy, independently checks
that no write occurred while waiting, and then verifies one persisted effect and
a native verification read. A wrong proposal is denied and remains failed evidence.

The companion `workspace` task now accesses the optional external document MCP
provider. The runtime no longer creates session workspaces. Historical reports
remain evidence of the older implementation and are not reinterpreted as external
provider results. Newly retained reports inspect `.document-provider` storage.
The provider owns the session directory, path restrictions and edit digests.

These are functional integration observations with actual free-model decisions,
not general claims of third-party compatibility, production authorization or
model competence. Scripted lifecycle checks and local service contracts are
separate evidence. Pending invocation review and final service effects must both
be retained; a successful assistant message alone does not pass the scenario.

## Connected review acceptance

`--tasks support,workspace` selects the reviewed support adjustment and external
provider document/correction scenarios using `customer-support.json`. The driver
checks availability for the entire requested suite before admitting a model run.
It approves only the model-proposed, fictional 500-cent adjustment under the
recorded local acceptance policy. It never supplies the model's calls or preloads
skills. Saved support state and document content are inspected independently.

Use the same observation deadline and explicit native budgets across the requested
platform set, then record their different scopes. Mastra bounds an active generation
segment, LangGraph bounds individual provider requests, Temporal bounds individual
Activities, and Restate retains its service execution policy. See the
[budget contract](../agent-harness-baseline/development-evals.md#observation-and-native-time-budgets).
A changed common instruction or declared provider effect contract is an experimental
change. Record it as a separate invocation; do not replace earlier outcomes or imply
that the trials differ only in their framework.
