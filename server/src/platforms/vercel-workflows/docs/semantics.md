# Execution semantics

The local baseline uses Workflow SDK `5.0.0-beta.52` and local World
`5.0.0-beta.45`. The native Workflow function owns the model/tool loop. The common
capability layer owns schema validation, policy, invocation reviews and receipts.
The platform has no connector-specific dispatch or shared agent loop.

The Lab admission ledger writes `pending` before `workflow.start()`. Once a native
run ID is returned, the ledger changes to `accepted`. Repeating the same Lab run ID
and request hash returns that native run. Different input conflicts. If acceptance
was not recorded, the reservation remains unknown and needs reconciliation. The
service never submits another native run to repair that uncertainty.

## Model, context and tool steps

The admitted input freezes tools, catalog revision, connection bindings, capability
inventory, model and session turn. An initialization step projects exact tool
schemas and prepares the common session snapshot, including skills and inventory.
OpenRouter receives those schemas and paired assistant/tool messages. Each native
model round feeds observed results into the next round, bounded by admitted round
and call limits. Duplicate or missing call IDs reject the entire batch before an
effect. A denial becomes tool feedback, allowing a subsequent model response.

Network access, credentials, context storage, clock reads and progress writes stay
inside Workflow steps. Model, context-summary, tool dispatch and review preparation steps set
`maxRetries = 0`. Provider failures remain classified results, including rate
limits; an unconfirmed model transport stops with reconciliation required. Native
recovery can reuse a completed step result, but it cannot assume an interrupted
unacknowledged provider request was never sent. A failed dispatch must not cause
the SDK to blindly repeat a mutation. The capability host also reserves the original run/turn/call
receipt before dispatch. On restart, a pending receipt remains unknown. An unknown
status or unknown effect stops further model/tool rounds with
`reconciliation_required`. An approved decision alone does not establish an effect.

## Sustained task policy and context

An optional admitted `execution` policy retains one absolute `deadlineAt` and a
separate per-model timeout. Legacy runs without that policy keep their prior
limits. Native clock steps guard each model/tool boundary; model, review-host and
tool-host abort timers are clipped to the remaining task duration. Review waits
race the registered hook against native `sleep` using the same retained deadline.
Renewal and service replacement cannot reset that deadline. A deadline ends the
agent task without retracting an effect already dispatched. Unknown receipts
still stop with reconciliation required. `ExecutionProgress` retains actual model
and tool counters alongside the deadline; review activity remains separately
identified by its call/revision. No shared scheduler owns the native loop.

Before every model round, a native context step evaluates the retained session
policy with the common estimator. It counts message text, assistant call payloads
and declared tool schemas. Loaded skill context stays untrusted and protected,
with its admitted digest. A summary can replace only complete assistant/tool
groups: every declared call ID must have exactly one paired result. The current
user task and immutable instructions remain. This uses the same common compaction
policy as conversation preflight, including its recent-group tail and safe-budget
check. If no safe group can be summarized or the result remains too large, the
next model request does not dispatch.

The summarizer runs inside that native step under the same selected model and
free-evaluation policy. Its usage counts as a model call; summary quality remains
a model behavior. Native history retains the returned projection for replay.
Private files `<world-data>/agentlab-progress/<hashed-run-id>.context-round-N.json`
retain request messages, budget, compaction source messages/IDs and skill digests.
They are inspection evidence, not executable state or a replacement transcript.
Character-based counts remain estimates. Large immutable schemas or skill bodies
can exhaust the window; this phase adds no tool-search or automatic schema pruning.
Local single-owner recovery is tested, not hosted multi-replica execution or replay
after arbitrary source changes.

## Free evaluation routing

Admission propagates the recorded `agent-harness-live` or `agent-capabilities-live`
experiment through the local service to every model step, including context summaries.
Immediately before transport, the adapter applies the common exact-model allowlist,
zero prompt/completion/request/image price ceilings, required parameter support and
disabled provider fallback. Output allowances are 512 and 2048 tokens respectively.
Unapproved model IDs or unknown evaluation settings fail before sending a request.
The evaluation driver must still validate the current raw model catalog; a request
ceiling is not proof of catalog availability or actual model task quality. Interactive
runs outside these experiments retain their configured model and routing behavior.

## Native review delivery

The native waiter is `createHook`, with a token derived from Lab run, request ID and
review revision. Calling `createHook` alone does not register it. The workflow awaits
`hook.getConflict()` before publishing a deliverable pending-review projection.
Browser polling reads that projection; the workflow suspends on the native hook.

The HTTP resume endpoint validates request, revision, tool-call ID and decision ID
against the pending action. It retains one delivery payload in the admission ledger
before calling `resumeHook(token, payload)`. Conflicting deliveries reject. Renewals
wake the prior revision and prepare the same original call for a new revision and
hook, without another model choice or effect. Approval continues the original call;
denial produces feedback. Stale revisions and mismatched call identities reject
without waking the waiter. The host rechecks the immutable decision at dispatch.

The installed SDK writes `hook_received` before enqueueing the wake. A failed wake
can therefore leave a durable payload. Retrying uses the same token and retained
decision, never a new call ID. SDK token lookup uses the World's atomic resume claim;
a cached Hook object would not retain the same retry guarantee. After consumption,
repeating the retained decision reports the prior delivery instead of producing a
second resume event. The ledger does not expose a different decision as equivalent.
These choices follow the [official hook contract](https://workflow-sdk.dev/docs/foundations/hooks)
and the installed SDK `runtime/resume-hook.d.ts` contract.

## Inspection, restart and cancellation

A durable progress step writes the complete event list and current pending review
under the World's configured data directory. Files use hashed Lab IDs, private
permissions and atomic replacement. Replay cannot replace a longer projection with
an earlier one. Inspection combines World status with that projection to expose
`suspended`, pending identity and incremental events before terminal output exists.
The runner preserves these events and the review in its native execution reference.
Terminal inspection projects only the common result fields into `result.json`.
The full event history, trajectory and metrics use their separate evidence lanes;
native result metadata remains under `executionReference.native.resultMetadata`.
This avoids duplicating retained provider requests inside the bounded final-result
file. Existing per-record storage limits still apply; no history is truncated.
Native World history remains authoritative for replay; this is an inspection
projection, not a second decision store.

The local queue transports an entire inline workflow delivery, which can include
several model/tool rounds before an approval hook yields. Its SDK default of 30
seconds can interrupt a valid delivery and re-enter an unacknowledged model step.
The service therefore sets the public `WORKFLOW_LOCAL_HEADERS_TIMEOUT_MS` setting
to at least the maximum admitted sustained task duration plus one minute (61
minutes currently). This is a bounded delivery transport deadline, separate from
the retained task deadline and each model timeout. It does not increase those
budgets or enable model retries. A larger explicit setting is accepted; zero or
shorter settings reject service configuration. The SDK captures the setting during
World creation, and the environment bridge is immediately restored. The ordinary
body-chunk timeout remains unchanged. This establishes local transport behavior,
not hosted delivery guarantees or recovery of unacknowledged model effects.

The service loads the admission ledger, builds the flow and begins listening before
World recovery. The local World then requeues persisted active runs through the
configured URL. Bundle imports use a content digest so repeated service restarts do
not retain another copy of an identical generated module. Pending reviews and
accepted admissions remain inspectable across restart. Pending admission remains
unknown and is not automatically resubmitted.

Cancellation calls native `Run.cancel()`. The shared API cancels pending reviews and
retains its cancellation event. Native cancellation prevents later orchestration;
it cannot retract an already dispatched provider effect. Dispatch has a bounded
host timeout, and its recorded receipt determines effect certainty independently
from cancellation status. Hosted deployment, managed retention and multi-process
World behavior require a separate hosted profile and are not established here.

## Validation

`connected-native.test.ts` uses the actual local World, authenticated capability
host and deterministic model with an unfamiliar schema. It checks pending review
restart, renewal, original-call approval, denial feedback, stale delivery rejection,
an unreachable host before dispatch, compaction before a second pending review
and service replacement, an absolute review-wait deadline, and the existing
external effect fixture's lost acknowledgement. It makes no paid model call or account
mutation. These checks establish native fixture behavior, not real-model task
selection or Vercel-hosted guarantees. A Workflow can finish normally by returning
a failed agent result: the runner keeps the native completed status while exposing
the agent failure, cancellation or need for reconciliation in the Lab result.

For an admitted free live evaluation, the OpenRouter adapter returns an observation
of the actual serialized provider request body and response identity. The native
workflow retains it as `EvalModelObserved`, including paired tool-result messages,
so task retention and skill delivery can be checked against a subsequent model
request. Headers and credentials are excluded. Interactive runs do not retain
this evaluation-only request body. Missing observations in older runs remain an
evidence gap; completed effects cannot substitute for model-request evidence.

Live model observations also retain bounded `finishReason`, response ID/model/provider
and `providerUsage` token counts, including reasoning-token counts, for parsed
successful or failed responses. Empty content remains an invalid-response failure;
the recorded metadata allows diagnosis of combined reasoning/output budget
exhaustion without inferring that cause or changing experiment controls. Reasoning
text and arbitrary provider usage fields are excluded. Earlier failed runs retain
their original evidence gaps; observations are not backfilled.
