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
inside Workflow steps. The provider model step retains the SDK retry behavior for
retryable model failures. This can repeat model requests. Tool dispatch and review
preparation set `maxRetries = 0`; a failed dispatch must not cause the SDK to blindly
repeat a mutation. The capability host also reserves the original run/turn/call
receipt before dispatch. On restart, a pending receipt remains unknown. An unknown
status or unknown effect stops further model/tool rounds with
`reconciliation_required`. An approved decision alone does not establish an effect.

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
Native World history remains authoritative for replay; this is an inspection
projection, not a second decision store.

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
an unreachable host before dispatch and the existing external effect fixture's
lost acknowledgement. It makes no paid model call or account
mutation. These checks establish native fixture behavior, not real-model task
selection or Vercel-hosted guarantees. A Workflow can finish normally by returning
a failed agent result: the runner keeps the native completed status while exposing
the agent failure, cancellation or need for reconciliation in the Lab result.
