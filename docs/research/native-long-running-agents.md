# Native long-running agents

Research date: 2026-10-10. Scope: Temporal, Restate, LangGraph, Mastra and
Vercel Workflows baselines, using the shared tools and skills already in the laboratory.
The source findings and baseline inspection below preceded implementation. The
final section records subsequent local implementation observations. Neither scope
introduces native filesystem access or a profiles UI.

Version boundary: the server declares Restate SDK/client 1.17.0 and Temporal
client/worker/workflow `^1.23.0` in
[package.json](../../server/package.json); LangGraph pins 1.2.10. These are
repository dependency declarations, not measured running-service versions.
The checked-in lockfile resolves Temporal client/workflow to 1.24.0.
Official pages describe their current releases. Check the resolved lockfile,
service version and SDK API before importing a newly documented feature.

## What the official sources establish

### Temporal

Temporal reconstructs Workflow state from event history when a Worker processes
the next Workflow Task. Workflow code must remain deterministic; model calls and
external tool I/O belong in Activities. This separates durable orchestration from
the process performing an external operation. [Tasks](https://docs.temporal.io/tasks)

Signals change Workflow state asynchronously. Updates can return a tracked result,
while Queries read state. `workflow.condition` can wait for a validated approval
message without keeping a model or tool Activity alive. An asynchronous Signal
does not by itself tell the caller that application validation accepted the
decision. [Message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)

A Worker crash during an Activity can leave its result unknown. Temporal uses
timeouts to detect lost work and applies the configured retry policy. A single
attempt policy prevents automatic redispatch after a timeout. Activities must
heartbeat to receive service cancellation, and the Workflow can choose whether
to wait for Activity cancellation. These are execution controls, not proof that
an external write was undone. [Activity execution](https://docs.temporal.io/activity-execution)

Continue-As-New preserves the Workflow ID while creating a new native Run ID and
fresh history. Long-lived execution must carry forward explicit state and finish
message handlers before continuing. This matters if the lab extends a bounded
turn into a continuously running agent. [Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)

### Restate

Restate records operation results in an execution log. Non-deterministic I/O belongs
inside `ctx.run`, whose successful result is retained for replay. Exceptions retry
unless the policy or a terminal error stops them. Long I/O also needs an explicit
inactivity and abort timeout policy. A completed journal entry avoids ordinary
re-execution; a process loss before recording an external response still needs
an external idempotency or reconciliation contract. The last sentence is an
inference from the boundary between external I/O and retained results.
[Durable steps](https://docs.restate.dev/develop/ts/durable-steps)

Workflow promises are named by Workflow key and resolve once. All handlers can
retrieve their resolved value during retention. Signals support repeated
notifications; awakeables provide a unique one-shot callback identity. These
waits survive retries and restarts, and Restate can suspend an invocation until
input arrives. The existing per-review promise remains a suitable implementation
for an exact approval revision. The newer repeatable Signal API is an alternative
for future steering, subject to the installed SDK version.
[Signals and external events](https://docs.restate.dev/develop/ts/external-events)

Cancellation is non-blocking and reaches SDK await points. It requires a reachable
deployment and application compensation for already completed writes. Detached
one-way and delayed calls continue independently. Killing an invocation skips
compensation. Resuming on a different deployment can produce non-determinism
errors when the new code changes the retained execution sequence.
[Managing invocations](https://docs.restate.dev/services/invocation/managing-invocations)

### LangGraph

A persistent checkpointer saves thread state at super-step boundaries and retains
successful node writes within an incomplete step. Durability modes make the
checkpoint timing explicit: `sync` commits before the next step, `async` writes
while the next step executes, and `exit` leaves intermediate state unpersisted
until execution exits. SQLite is intended for local workflows; production
checkpointer options include PostgreSQL. A checkpointer's storage contract does
not describe worker admission, ownership, leases or automatic scheduling after a
service crash. That distinction is an architectural inference.
[Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)

`interrupt()` persists a wait that can resume using `Command(resume=...)` and the
same thread ID. Resumption starts the interrupted node again, so code before the
interrupt executes again. Preparation must therefore be idempotent, and a write
must occur after the decision in a separate execution boundary. Current docs
include APIs newer than this repository's pinned `langgraph==1.2.10`; a design
must check the pinned release before adopting those additions.
[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

Agent Server adds a pool of background run workers and PostgreSQL/Redis
infrastructure. This is a distinct deployment choice from importing the
LangGraph library with `SqliteSaver`. It should be named separately in experiments
and operational requirements. [LangSmith data plane](https://docs.langchain.com/langsmith/data-plane)

## Repository facts

These observations describe the files inspected, not measured deployment behavior.

| Concern | Temporal | Restate | LangGraph |
| --- | --- | --- | --- |
| Native agent loop | Workflow calls model and tool Activities | Workflow calls named `ctx.run` actions | Graph has model, approval and tools nodes |
| Approval wait | Validated `baselineReviewDecision` Signal and `condition` | Revision-specific `ctx.promise` and shared `reviewDecision` handler | Dedicated approval node calls `interrupt`; service resumes with `Command` |
| Shared capability execution | Activity dispatches through capability host | Durable action dispatches through capability host | Tool node dispatches through capability host |
| Running process interruption | Native Workflow history retained; automatic Activity retry deliberately limited | Native journal replay, subject to durable-action ambiguity | Service marks queued/running rows unknown; no automatic restart dispatcher |
| Suspended process interruption | Workflow owns wait | Workflow owns promise | Suspended SQLite row and checkpoint survive startup marking; trusted resume explicitly starts a new in-process task |

Relevant implementation paths:

- [Temporal Workflow](../../server/src/platforms/temporal/variants/baseline/workflow.ts)
  configures `maximumAttempts: 1`, validates review request/call/revision identities,
  and waits on review or cancellation. [Activities](../../server/src/platforms/temporal/variants/baseline/activities.ts)
  heartbeat while context, model and hosted tool I/O is active.
- [Restate Workflow](../../server/src/platforms/restate/variants/baseline/workflow.ts)
  has named model/tool actions, pending review state, revision-bound promises and
  duplicate decision checks. [Semantics](../../server/src/platforms/restate/docs/semantics.md)
  explicitly preserve unknown external outcomes.
- [LangGraph graph](../../server/src/platforms/langgraph/variants/baseline/graph.py)
  separates approval from tool execution and documents replay-safe preparation.
  [Service](../../server/src/platforms/langgraph/service/app.py) starts work with
  `asyncio.create_task` and `asyncio.to_thread`, keeps task ownership in memory,
  retains the admission request, validates checkpoint review identity, and marks
  incomplete active runs unknown at startup/shutdown.
  [Store](../../server/src/platforms/langgraph/service/store.py) excludes suspended
  rows from `mark_incomplete_unknown`, so a persisted approval wait is different
  from an interrupted active call.
- The LangGraph service's `graph.stream` call does not select a durability mode.
  [Pinned dependencies](../../server/src/platforms/langgraph/pyproject.toml) and
  the actual default need to be checked before claiming synchronous checkpoint
  persistence.
- The shared host and skill admission already exist in
  [extensions](../../server/src/capabilities/extensions/host.ts) and
  [skills](../../server/src/capabilities/skills/README.md). This work should extend
  native lifecycle handling while retaining that shared execution contract.

## Concrete gaps and proposed next steps

1. Define what a long-running task means. Existing loops have bounded model/tool
   rounds. Approval suspension can already outlive an HTTP request. Continuous
   autonomous work, durable timers and repeated steering need an explicit native
   execution state and budgets rather than a larger round limit.
2. Make LangGraph recovery a deliberate variant choice. Keep the present conservative
   unknown state for an interrupted external call. For automatic restart, either
   add durable admission/ownership and recovery classification to this local
   service or introduce an Agent Server variant with its infrastructure declared.
   A checkpoint alone cannot choose whether redispatch is safe.
   For the requested local scope, prefer a single-owner service that recovers
   only from a checkpoint known to precede a safe next step. Persist pending
   external-call identity before dispatch and classify unresolved unsafe calls as
   `reconciliation_required`. LangGraph should continue to own graph execution;
   wrapping it in Temporal would change the platform composition and experiment.
3. Keep external write reconciliation shared. Retain stable operation identity,
   exact approved arguments/catalog revision, dispatch receipt and external
   idempotency key where supported. If a provider acknowledgement is lost, record
   unknown, inspect provider state, then resume only from established evidence.
   Approval authorizes a call; it does not prove completion or safe repetition.
4. Preserve native execution identifiers in evidence. Temporal continuation needs
   the Workflow chain and native Run IDs. Restate needs Workflow key, invocation
   ID, deployment and retention. LangGraph needs thread/checkpoint identity and
   the service execution owner. Never use a fresh identity to hide an unresolved
   old execution.
5. Correct stale platform semantics. Temporal's
   [semantics page](../../server/src/platforms/temporal/docs/semantics.md) still
   describes one model call and no side effects, while the
   [variant README](../../server/src/platforms/temporal/variants/baseline/README.md)
   and code implement the shared tool loop and invocation review. Reviewers must
   use the current code contract until the page is reconciled.
6. Close the review delivery gap. The current
   [decision handler](../../server/src/control-plane/application/run-service.ts)
   retains the host decision before sending the native resume request. A process
   loss between those steps can leave a decided action suspended. Persist an
   undelivered native-resume intent and retry delivery with the same decision ID,
   request ID, call ID and revision. Distinguish delivery acknowledgement from
   tool execution completion; neither proves exactly-once external effects.

Proposed verification should stop the worker during approval waiting, after
checkpoint/journal commit, before dispatch, after external acceptance before
receipt persistence, and during cancellation. Reuse the same run and operation
identities after restart; inject duplicate and stale decisions; verify that
unknown work neither redispatches nor becomes fabricated success. Test suspended
LangGraph restart separately from an active node crash. Capture native records
alongside normalized events and retain the fixture's external operation ledger.

No platform winner follows from this inspection. It establishes different
durability owners and identifies the failure windows that an experiment must
measure.


## Mastra: durable agent versus persisted approval

The current official durable-agent documentation describes snapshot-backed execution,
recovery leases and explicit recovery configuration. It warns that recovery may repeat
model/tool work and that multiple replicas need coordinated ownership. Durable execution
therefore does not replace external call receipts or establish exactly-once effects.
[Durable agents](https://mastra.ai/docs/harness/durable-agents)

Native agent tool approvals support continuing approved or declined calls. Workflow
suspend/resume and workflow snapshots are separate execution mechanisms; an approval
snapshot is not evidence that arbitrary active work recovers.
[Agent approvals](https://mastra.ai/docs/agents/human-in-the-loop),
[Workflow suspend/resume](https://mastra.ai/docs/workflows/suspend-and-resume),
[Workflow snapshots](https://mastra.ai/docs/workflows/snapshots)

Repository observations:

- [Baseline agent](../../server/src/platforms/mastra/variants/baseline/agent.ts)
  currently uses regular `Agent.generate`, shared schemas and native tool approval.
  The [runner](../../server/src/platforms/mastra/runner-adapter/mastra-runner.ts)
  reconstructs approval snapshots from per-run LibSQL and preserves the original call.
  This establishes suspended-review reconstruction, not active-step recovery.
- The [workflow variant](../../server/src/platforms/mastra/variants/workflow/workflow.ts)
  has a synthetic pre-model approval followed by one workflow step containing the
  complete agent loop. It does not independently checkpoint each model/tool call.
- Installed `@mastra/core@1.66.0` declarations expose `createDurableAgent`, durable
  `generate`/`stream`, `resume`, `recover`, `recoverActiveRuns` and
  `Mastra.recoverAllDurableAgents`. The durable configuration types do not expose
  `shouldPersistSnapshot`, although current docs show it. These are local type
  inspections, not successful runtime recovery evidence. Recheck installed exports
  under `@mastra/core/dist/agent/durable` during implementation.

Recommended implementation: probe the pinned durable API, then wrap the existing
baseline agent with it under the same native run identity and existing tool adapters.
Register the model/tools before explicit startup recovery. Preserve one local owner,
record the new implementation mode, and refuse redispatch of unresolved host receipts.
Do not claim old regular-Agent runs acquired new guarantees, or switch to the workflow
variant merely because its whole-loop step is called durable.

## Vercel Workflows: preserve the existing native loop

Hooks suspend workflows for externally supplied input; typed hooks add validation
contracts. Native sleep provides durable time-based waits. Run APIs expose cancellation,
which cannot retract a provider write already accepted. Those are native execution
mechanisms, distinct from chat polling.
[Hooks](https://workflow-sdk.dev/docs/api-reference/workflow/create-hook),
[Typed hooks](https://workflow-sdk.dev/docs/api-reference/workflow/define-hook),
[Sleep](https://workflow-sdk.dev/docs/api-reference/workflow/sleep),
[Run API](https://workflow-sdk.dev/docs/api-reference/workflow-api/get-run)

The SDK also documents durable AI integration, but adopting a second agent package is
not required to extend this repository's existing native workflow.
[AI integration](https://workflow-sdk.dev/docs/ai)

Repository observations:

- [Workflow](../../server/src/platforms/vercel-workflows/variants/baseline/execution/workflow.ts)
  already owns the multi-round model/tool loop, revision-bound review hooks, denial,
  renewal and unknown-effect stopping. External I/O is in native steps.
- [Platform service](../../server/src/platforms/vercel-workflows/service/platform-service.ts)
  configures local World active-run recovery, retains admissions/review delivery,
  resumes hooks and invokes native cancellation. Projection files do not own replay.
- [Capability initialization](../../server/src/platforms/vercel-workflows/variants/baseline/execution/capability-steps.ts)
  prepares/compacts initial context. Growing tool/model history inside that same run
  is not compacted before every subsequent model round.
- [Model step](../../server/src/platforms/vercel-workflows/variants/baseline/execution/model-step.ts)
  and capability steps disable automatic retries. The
  [semantics document](../../server/src/platforms/vercel-workflows/docs/semantics.md)
  contains a stale statement about retained provider retries and needs correction.
- [Common reconciliation](../../server/src/control-plane/application/run-service.ts)
  already settles terminal conversation turns. Browser-independent observation needs
  improvement; settlement should not be duplicated inside each Vercel step.

Recommended implementation: retain the existing workflow, add per-round budget checks
and compaction as native steps, project immutable context revisions, and verify process
replacement with the same local World storage. Existing active-run/review restart tests
are foundations to reuse. Local recovery does not establish hosted retention or
multi-process guarantees. Add no `@workflow/ai` dependency solely for durability.

## Shared asynchronous tools and progress

MCP cancellation and progress are optional. A cancellation notification is not a
rollback confirmation; servers may ignore cancellation. Progress only exists when a
request supplies a token and the server sends updates. Neither mechanism is a durable
execution checkpoint. The long-running agent implementation should remain useful with
ordinary tools that emit no progress. Experimental asynchronous task support is a
separate future adapter decision, not a prerequisite for platform-native agent waits.
[MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation),
[MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)

Implementation checklist: [native long-running agents plan](../../development/implementation-plans/platforms/active/native-long-running-agents.md).


## Implementation observations — 2026-10-10

All five baselines now admit sustained execution with shared capabilities and native
execution ownership. Focused native checks cover retained action identity, process
replacement, deadlines, cancellation and unknown-effect refusal. Those checks use
scripted model responses to isolate harness behavior. They are distinct from the
six-record task driven by real free models below.

| Platform | Native implementation verified | Real Cohere task observation | Limit |
| --- | --- | --- | --- |
| Temporal | Workflow replay, bounded Activities, retained signal, deadline and within-round context. | Original action survived a 65-second wait/restart. Corrective run saved Cedar once, then proposed an unnecessary Birch write; observer canceled it. | Completed Activities do not establish exactly-once external effects. |
| Restate | Journaled rounds, original durable promise, bounded I/O and context. | Corrective run retained all four decisions and three expected writes; model omitted a fresh verification read after the final Willow write. Task verdict remains failed. | A journal cannot prove whether an unacknowledged external write occurred. |
| LangGraph | SQLite checkpoints, safe local recovery, retained interrupts and waiting deadline. | Original action survived wait/restart; Cedar saved once, then unnecessary Birch write caused observer cancellation. | Single local owner; uncertain dispatched work refuses automatic recovery. |
| Mastra | DurableAgent, retained LibSQL state, exact review resume and native waiting cancellation. | After transport correction, actual Cohere requests loaded the skill and sources; original action survived a 65-second wait/API replacement and saved Cedar once. Subsequent unnecessary Birch write was refused; task failed. | Active recovery conservatively refuses dispatch barriers. Pinned SDK snapshot-pruning workaround is documented. |
| Vercel Workflows | Durable steps/hooks, within-run compaction, bounded deadline and local World recovery. | Initial run produced three expected writes and a complete report but lacked required model-input observations. Corrective run retained the first action through restart, then proposed unnecessary Birch write and was canceled. Neither is a full-task pass. | Local World observations do not establish hosted-deployment retention. |

The first five-platform Cohere report is
[`connected-76f62915`](../../lab/runs/.sustained-proof/runs/.connected-proof/connected-76f62915-72e9-4493-abfe-582e6efc79eb/summary.json).
Original verdicts were preserved. Actual execution exposed common review-event
identity suppression, missing Vercel eval transport observations, and a Mastra free-eval
wrapper that rejected the streaming API internally used by DurableAgent. Focused fixes
retain every decision identity, observe actual eval transport inputs, and adapt the same
bounded free HTTP response to native SDK stream chunks. No provider-specific tool
branch or forced model decision was added.

The separate corrective four-platform Cohere report is
[`connected-88e2dc95`](../../lab/runs/.sustained-proof/runs/.connected-proof/connected-88e2dc95-18c7-40d3-b85d-0cd210520185/summary.json).
The final Mastra Cohere report is
[`connected-cc1df00e`](../../lab/runs/.sustained-proof/runs/.connected-proof/connected-cc1df00e-62d8-460e-b8e2-568ada552ab8/summary.json).
These early-aborted driver reports retain an incomplete stage under a failed outcome.
The observer was subsequently corrected to retain abort/cancellation observations
for future runs, including explicit failed-observation fields; it does not infer terminal
state from a cancellation request. A separate read-only
[terminal observation](../../lab/runs/.sustained-proof/runs/.connected-proof/terminal-followup-20261010.json)
confirms cancellation and exactly one saved Cedar effect in each of Temporal,
LangGraph, Mastra and Vercel; the unauthorized Birch actions had no effect. It does
not change the original verdicts. Restate independently retained exactly three effects.

One bounded Gemma alternative returned HTTP 429 on every platform before tools:
[`connected-4410b670`](../../lab/runs/.sustained-proof/runs/.connected-proof/connected-4410b670-3ab3-4420-9bd0-3d3c731dfb71/summary.json).
These are provider-availability failures, not measurements of agent reasoning or
successful long-running task completion. Free pricing was checked against the live
catalog; requests retained zero-price restrictions and no paid fallback.

Direct browser acceptance used Temporal and disposable connected records. Approve
saved Cedar/Morgan once; Deny left Pine/Devon unchanged. The model verified both;
refresh retained the two cards inside their assistant message. Conversation reload and
a follow-up also retained an observed calculator result without another tool call.
[Browser report and screenshots](../../lab/runs/.connected-proof/browser-sustained-20261010/summary.json).
This verifies the shared chat path on Temporal; it is not five separate browser proofs.

**Interpretation:** native execution and focused recovery checks passed; full six-record
real-model acceptance has zero passing platforms in these cohorts. Model omissions,
unnecessary proposals and provider rate limits remain visible. This evidence cannot
rank platforms or prove hour/day retention. The next acceptance work should investigate
capability descriptions and task comprehension under fixed controls, then rerun a
bounded cohort when free capacity is available. Do not replace model decisions with a
scripted runtime sequence to turn this task green.

Operational limits remain: a hung adapter inspection can stall the common observation
pass; local service ownership is single-process where specified; hosted/multi-replica
hardening is deferred. A separate broad evidence-store check also exposed an existing
grader-error wording mismatch (17/18 passed); that unrelated assertion was not weakened.
For usage, defaults and recovery contracts, see
[connected agent tools](../guides/connected-agent-tools.md).
