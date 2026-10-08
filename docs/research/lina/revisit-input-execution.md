# Lina Input and Turn Execution revisit proposal

Status: proposal for review. No graph, contracts or playback code changed by this audit. Inspected 2026-10-08 against the current working tree, including the uncommitted Tools block. IDs below are proposed stable IDs. Existing IDs are preserved unless an explicit migration is approved.

## Findings and scope

Input currently has 29 nodes, including the reconciliation node proposed for relocation,, including account-scoped transport intake, identity, access, activation, conversation routing, duplicate claims, custody, acceptance, ordinary/control/answer dispatch, queueing, recovery and delivery. Adding more Intake nodes merely to copy those responsibilities would obscure the design. The needed changes are concrete contracts and cross-block routes.

Turn Execution already has start, limits, preparation, model invocation, classification, Tools delegation, result handling, controls, recovery, settlement and release. Its missing graph responsibilities are visible waiting/resumption and active cancellation. Both are stated in prose but have no useful traversal path. The existing reconciliation node is visually in Input even though its text correctly assigns ownership to the runtime. Move that node into Turn Execution while preserving its ID, then make its safe continuation destinations explicit.

Recommended graph delta for these two blocks: zero new Input nodes, two new Turn Execution nodes, one existing node moved into Turn Execution. This is a responsibility proposal, not a claim that the corresponding services are implemented.

## Evidence

Local inspected sources:

- [Input graph](../../../apps/web/src/features/lina/inputBlock.ts), [Input admission contracts](../../../apps/web/src/features/lina/contracts/inputAdmission.ts), [Input execution contracts](../../../apps/web/src/features/lina/contracts/inputExecution.ts), and [shared records](../../../apps/web/src/features/lina/contracts/shared.ts).
- [Turn Execution graph](../../../apps/web/src/features/lina/executionBlock.ts) and [contracts](../../../apps/web/src/features/lina/contracts/turnExecution.ts).
- [Tools call contracts](../../../apps/web/src/features/lina/contracts/toolsCalls.ts), [Tools connection contracts](../../../apps/web/src/features/lina/contracts/toolsConnections.ts) and [Tools graph](../../../apps/web/src/features/lina/toolsBlock.ts).
- [Current playback](../../../apps/web/src/features/lina/inputSimulation.ts) and [previous completeness audit](turn-execution-completeness-audit.md).

The already inspected primary evidence supports the boundaries, rather than requiring Lina to copy one framework:

- [Pi pinned agent loop](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts), as assessed in [Pi/Waku Tools research](tools-pi-waku.md), distinguishes cooperative cancellation and a joined parallel batch. Cancellation does not prove remote effects were undone.
- [OpenClaw pinned agent loop](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/packages/agent-core/src/agent-loop.ts), as assessed in [Hermes/OpenClaw Tools research](tools-hermes-openclaw.md), supports concurrent eligible work and explicit sequencing constraints.
- [Pi session settlement](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts#L1775-L1865), already examined in the completeness audit, motivates separating an agent answer from actual settlement.

No upstream execution, OAuth exchange, latency measurement or durability experiment was performed for this proposal. New node placement and record names below are Lina design choices based on these observed responsibilities.

## Input updates

### Channel intake, identity and custody

Update existing `lina-input-cli`, `lina-input-whatsapp`, `lina-input-telegram`, `lina-input-telegram-route`, `lina-input-envelope`, `lina-input-identity`, and `lina-input-custody`.

Already represented: transport verification, adapter account, opaque credential handles, CLI reconnect identity, Telegram DM/group/topic/update variants, WhatsApp message and delivery variants, original attachment custody, and account-scoped source deduplication. Preserve these.

Gap: those handles are generic strings with no explicit common connection lifecycle dependency. Add a typed `channelBinding` to each adapter's local context, not to attacker-supplied source data:

```json
{
  "channelBinding": {
    "connectionId": "conn-telegram-bot-demo",
    "adapterRef": "adapter:telegram:v1",
    "accountId": "bot-account-demo",
    "ownerScopeRef": "owner:person-demo",
    "configurationRevision": 2,
    "readinessGeneration": 4,
    "credentialRef": "credential:telegram-bot-demo",
    "state": "ready"
  },
  "authenticityEvidenceRef": "ingress-verification:update-001"
}
```

`state` is `ready | authentication-required | unavailable | disabled`. A channel's adapter owns webhook verification/polling and message projection. The shared connection/credential service owns account readiness and secret access. MCP transport/version negotiation applies only to MCP connections, never to Telegram, WhatsApp or CLI as a pretend MCP layer. Local CLI authentication can omit `credentialRef` through a discriminated binding variant. Channel custody retrieves via its original account binding; account rotation cannot silently fetch an attachment through another user's account.

Keep existing failure routes `lina-input-edge-50`, `51`, `52`, `34`. Add failure examples for disabled binding, changed retrieval account and failed secret retrieval. Do not emit `accepted` for an intake failure. No new arrow from unverified provider data to an authenticated Tools record is valid.

### Admission, conversation and operation permissions

Update `lina-input-access`, `lina-input-conversation`, `lina-input-intent` and `lina-input-admission` with explicit references to the Safety policy decision used at each distinct boundary. Existing checks remain distinct: source admission, permission to route to a conversation, permission to issue a control, permission to execute an external tool. One does not imply the others.

Add to authorization records `decisionId`, `policyRevision`, `subjectRef`, `resourceRef`, `action`, `checkedAt` and `expiresAt` if a time limit exists. Tool OAuth account authorization cannot be reused as a message-source admission decision. The existing authorized ordinary path remains intact; denied decisions use existing failure edges. Queue drain must recheck current source/route/operation permissions rather than assume a previously accepted grant remains current forever.

### Waiting answers

Update `lina-input-prompt` rather than adding another reply router. It already records pending prompt, turn, operation, expiry and permitted responder IDs.

Add pending wait `waitId`, `waitKind`, `owningNodeId`, `batchId`, nullable `callId`, nullable `attemptId`, `bindingGeneration`, `answerSchemaRef` and `answerEvidenceRef`. Kinds are `tool-approval | tool-input | user-clarification`; connection authorization is resumed by its own verified callback/service event. An OAuth browser callback must never be interpreted as an ordinary chat answer.

Retarget existing `lina-execution-edge-prompt-answer` from `lina-execution-controls` to proposed `lina-execution-wait`. Preserve its ID. Existing `input.prompt.matched` should pass the matched identity and answer reference without rewriting the task or granting operation approval itself. Input verifies the sender and route; Safety/Tools verifies whether that answer authorizes the exact operation. Expired, wrong-account, wrong-prompt and changed-argument answers preserve pending work and use the existing prompt-to-delivery rejection route.

### Queue, restart and delivery

Update `lina-input-queue`, `lina-input-recovery`, `lina-input-runtime`, `lina-input-claim-recovery`, `lina-input-delivery` and `lina-input-duplicate`.

Already represented: queue belongs to the conversation, release triggers fresh admission, safe resumes bypass Start turn, saved-answer delivery does not rerun execution, and unknown commits/effects prevent blind replay.

Gaps to specify:

- State owns durable receipt/input/queue/checkpoint/output records. Input owns how those records are interpreted for intake/admission/delivery. Replace unowned store labels with service references and explicit write/read outcomes when State exists.
- Expand checkpoint destinations to include `wait` and `reconcile`. Add `stateRevision`, `ownerFence`, `batchId`, `settledCallIds`, `activeCallIds`, `pendingWaitIds`, `unresolvedEffectCallIds` and `safeResumeEntry`. A checkpoint containing an active external write is not automatically restart-safe.
- Runtime outputs `input.runtime.resume-wait` through new edge `lina-execution-edge-resume-wait` to `lina-execution-wait`. Retained waits resume correlation, not original call dispatch.
- Delivery has distinct `created`, `queued`, `sent`, `failed`, `unknown`, and optional provider `delivered` observations. A webhook acknowledgement is not agent acceptance; an acceptance receipt is not turn completion; a provider send receipt is not user consumption.
- Preserve account-scoped outbound IDs and separate delivery retry from model/tool execution. No additional Output nodes should be implemented in Input; its current delivery node remains the handoff when the Output block is built.

## Turn Execution node additions

### `lina-execution-wait`, Await external work

Owner: Turn Execution coordinator. Purpose: retain turn/batch identity while one or more operations await an answer or connection event, then route validated continuation to the owning operation. This node does not decide tool permissions, perform OAuth or dispatch adapters.

Input union:

1. Tools wait registration: turn state, round, batch ID, wait ID/kind, owning node, call ID, nullable attempt ID, prompt ID or authorization-flow reference, expiry, continuation reference, binding/policy/argument revisions, settled sibling results and required pending IDs.
2. Input matched answer reference with wait/turn/call/prompt/responder identity.
3. Connection owner completion event with authorization-flow/account/connection identity and generation.
4. Expiry or active cancellation event scoped to the retained wait.

Example record:

```json
{
  "turnId": "turn-001",
  "roundId": "round-001",
  "batchId": "batch-001",
  "waitId": "wait:approval:call-001",
  "waitKind": "tool-approval",
  "owningNodeId": "lina-tools-permissions",
  "callId": "call-001",
  "attemptId": null,
  "promptId": "prompt-001",
  "settledCallIds": ["call-002"],
  "pendingCallIds": ["call-001"],
  "authorityRetained": true,
  "nextModelRoundAllowed": false
}
```

Outgoing edges/events:

| Edge ID | Target | Output route | Payload addition |
| --- | --- | --- | --- |
| `lina-execution-edge-wait-approval` | `lina-tools-permissions` | `execution.wait-approval-answer` | matched `answerEvidenceRef`, all exact-operation identifiers; owner revalidates approval |
| `lina-execution-edge-wait-auth` | `lina-tools-resolve` | `execution.wait-auth-ready` | verified connection/account generation and retained pre-dispatch request; resolution/validation/permissions rerun |
| `lina-execution-edge-wait-input` | `lina-tools-collect` | `execution.wait-input-answer` | same call/attempt and private `protocolContinuationRef`, `answerRef`; resume original supported continuation, no effect replay |
| `lina-execution-edge-wait-cancel` | `lina-execution-cancel` | `execution.wait-cancellation` | exact-turn Stop/Interrupt and required active work |

Local no-edge outputs `execution.wait-retained` and `execution.wait-answer-rejected` represent pending/stale answers. Separate `execution.wait-expired` outputs return to the exact owning permissions, collection, resource/prompt or child operation. Expiry is not turn Stop. An expiry produces a known denial/error if no effect started; started work follows cancellation/collection and may remain uncertain. Connection-auth timeout cannot fabricate a cancelled dispatched call.

For call-readiness waits, retarget existing `lina-tools-edge-auth-resolve` to `lina-execution-wait` once its retained wait exists. The wait coordinator then emits the sole resume route to Resolve. Startup readiness still uses `auth-connect`; it does not create an execution wait. This replaces direct call resumption rather than dispatching it twice.

Register ingress edges from `lina-tools-permissions`, `lina-tools-resolve` and `lina-tools-dispatch` authorization waits, and `lina-tools-collect` input wait. Proposed IDs `lina-execution-edge-tools-approval-wait`, `tools-resolve-auth-wait`, `tools-dispatch-auth-wait`, `tools-input-wait`. Existing Tools auth routes still initiate the authorization workflow. Wait registration is a correlated notification, not a second execution of that workflow; contracts must explicitly label side notifications versus alternative routes.

### `lina-execution-cancel`, Cancel active work

Owner: Turn Execution coordinator. Purpose: latch an exact-turn cancellation request, prevent fresh launch, signal the currently active owners, then await known outcomes or reconciliation. This is distinct from consuming guidance at the next checkpoint.

Input: `controlId`, turn/authority/fence, action `stop | interrupt`, stop reason, requested time, active provider attempt IDs, active tool call/attempt IDs, pending wait IDs, settled results, and optional replacement input reference. Output example:

```json
{
  "turnId": "turn-001",
  "controlId": "control-stop-001",
  "freshLaunchAllowed": false,
  "signalledCallIds": ["call-001"],
  "skippedCallIds": ["call-003"],
  "settledCallIds": ["call-002"],
  "outcomeConfirmed": false,
  "releaseReady": false
}
```

Edges/routes:

- Retarget `lina-execution-edge-turn-control` to this node for Stop/Interrupt, preserve Steer as an explicit separate output/edge to controls (`lina-execution-edge-turn-steer`). Retarget `execution.controls-stop` to new `lina-execution-edge-controls-cancel`. Restrict existing `lina-execution-edge-controls-finish` to candidate completion so Stop cannot take both paths.
- `lina-execution-edge-cancel-model` to `lina-execution-model`, `execution.provider-cancellation-requested`: signal the exact active attempt. The model node accepts both invocation and cancellation as a discriminated input, never as two new provider calls.
- `lina-execution-edge-cancel-tools` to `lina-tools-collect`, `execution.tool-cancellation-requested`: Tools owner signals the active adapters and still collects outcomes. Collect receives `cancelRequestedCallIds` and must retain dispatch/attempt correlation. Unstarted Tools calls receive skipped results through existing launch guards.
- `lina-execution-edge-cancel-settle` to settle, `execution.cancellation-resolved`: only when required active work is known settled or safely transferred.
- `lina-execution-edge-cancel-reconcile` to preserved `lina-input-reconcile`, `execution.cancellation-uncertain`: known sibling results plus unknown effects, retained authority and no launch permission.

Model cancellation response still passes through Decide and then terminal/cancellation settlement. A late result may establish an effect succeeded after Stop; preserve it rather than overwriting it with an invented cancellation. Stop is a simulation event. Pause only changes playback pace.

## Existing Turn Execution node updates

| Node | Required update |
| --- | --- |
| `start` | Add explicit per-agent execution scope, state revision and environment/configuration references. Input owns admitted turn identity. Future child agents initialize child scope through Subagents, not fake user admission. |
| `limits` | Keep separate logical rounds/provider attempts. Add configured nullable deadline/tool-call/cost-budget references without inventing measured costs. Authority loss and stopped continuation receive classified terminal/retained-work outcomes. |
| `prepare` | Bind Context snapshot to instruction/history/task/catalog/model/agent-scope revisions. Catalog/schema/account changes invalidate the appropriate preparation or binding; retry reuses a valid snapshot only. Preserve successful sibling results and rich result references. |
| `model` | Add explicit provider attempt lifecycle `requested | streaming | completed | failed | cancellation-requested | cancelled | unknown`; reference Model-owned stream/result evidence. Only complete validated calls go to Decide. Add cancellation signal input union. |
| `decide` | Examples for two complete calls, mixed text plus calls, truncated calls, no-tool continuation and model abort. Candidate text accompanying pending calls does not bypass the batch join. |
| `tools` | Rename display title to `Delegate tool batch`. Tools owns scheduling/adapters; Safety owns policy decisions, with Tools invoking Safety at its permissions node. Emit full batch correlation and visibly enter Tools internals. Retire summary playback bypass once detailed playback exists. |
| `tool-outcomes` | Existing schemas accept lists, but fixtures/classification mostly demonstrate one result. Add multi-result success, known error plus success, denied plus success, and mixed cancellation. Classify the batch under an explicit policy instead of deriving a fatal turn solely from one tool's nonretryable error. Known tool denial/error can inform the next round unless selected policy makes it terminal. Do not call a known operation failure a fatal controller failure. |
| `controls` | Preserve guidance checkpoint and next-action intent. Route answers to wait, active cancellation to cancel; checkpoint consumption cannot claim cancellation already completed. |
| `recover` | Provider/context retries retain logical round and settled calls. Add catalog invalidation and classified provider ambiguity examples. Recovery never replays Tools as a provider retry. |
| `settle` | Add a required-State-write failure output and pending output. State owns the write; Execution chooses release policy from known record state. Failed commit and unknown commit differ. Withhold clean release when required outcome persistence is unconfirmed. |
| `release` | Add `execution.release-stale-owner` and `execution.release-write-unconfirmed` local outputs. Duplicate release events are idempotent for the exact fence and queue deduplication. Current fence checks are prose; give matching and mismatch examples. |

### Reconciliation node ownership and paths

Move existing `lina-input-reconcile` visually into Turn Execution. Keep its ID to preserve saved graph references. Its current resume route goes through `lina-input-runtime`, whose contract only admits safe checkpoint preparation/controls/settlement, so it does not yet express a reconciled batch returning to Tools publication.

Expand its input union to retain the entire `tools.reconciliation-required` payload. In particular, retain `requestedCallIds`, settled sibling results, pending call IDs, batch/round IDs, exact attempt and operation evidence. Do not narrow it to the shared single `uncertainty` example.

Add `lina-execution-edge-reconcile-publish` to `lina-tools-publish`, route `execution.reconciled-batch`: publication receives known results for every now-resolved requested call plus preserved earlier successes, then normal result handling can continue. Add `lina-execution-edge-reconcile-settle` to settle, route `execution.reconciliation-terminal`: uncertainty resolved but turn must terminate. Existing Input recovery-to-reconcile remains valid. Existing reconcile-to-runtime remains only for a separately established safe checkpoint, not ordinary known tool results. Existing reconcile-to-delivery provides status; unresolved/no-evidence stays locally pending.

Reconciliation evidence values `known-success`, `known-no-effect`, `unknown` must be independent of operator action. An operator acknowledging risk cannot turn an unknown write into known success. If future policy supports abandoning an unknown effect, model it as an explicit authority transfer/abandonment with recorded risk and an appropriate terminal status, never ordinary completed release.

## Auto/manual simulation proposal

Current `SimulationCase` has seven fixed precomputed routes and `TurnOutcome` has no cancelled status. No interactive external waits or simultaneous active calls exist. Adding node descriptions alone will not provide the requested experiments.

Use one deterministic transition function for Next and timer playback, with a set of active calls/waits rather than a single highlighted path index. A step may start or settle a named call. Highlight parallel branches at the same time and record their stable call IDs. Automatic mode executes the same fixture events as Next; it pauses when the fixture requires a user answer, then resumes after the configured event. Run settings choose the scenario; an in-run answer/Stop control acts on retained simulated state.

Suggested settings: channel, existing execution/context cases, tool scenario, answer outcome, stop point and viewing mode. Keep advanced choices collapsed. Credentials/tokens/text are unnecessary. All state and results are visibly simulated.

Required cases:

1. Two independent calls overlap, finish in reversed order, publish in call order, then Context prepares round two.
2. Two conflicting writes execute serially; second launch waits for first settlement.
3. Invalid call plus successful sibling join; error and success both reach Context with original IDs.
4. Approval wait with a settled sibling; approve, deny, expiry, stale answer and changed-argument answer variants. None opens a new turn.
5. Connection authorization before dispatch; callback success and wrong-account callback variants; successful completion re-enters resolve/validate/permission checks.
6. Supported tool-input continuation retains call and attempt; answer resumes the protocol operation without repeating the original effect.
7. Stop before model launch, during provider work, before tool dispatch, and while two tools are active. Prevent fresh launch; retain completed siblings and join active work.
8. Write timeout/cancellation with unknown effect plus successful read; reconcile known success, proven no-effect and still-unknown variants. No next round/release during unresolved effects.
9. Required settlement write failed and commit unknown; recorded failure/retry/inspection paths visibly differ from completed release.
10. Restart checkpoint at a retained wait or reconciliation state; safe restores preserve round/counters/results. Saved output delivery bypasses execution.
11. Duplicate source event while waiting; duplicate answer; duplicate release; same provider IDs in different accounts. No extra call, turn or queue drain is inferred.
12. Active catalog/account generation change. Retain the exposed definition for interpretation; refuse stale dispatch and prepare/re-authorize the appropriate next request.

Every new node and edge must have a schema, exact example and outgoing route. Validate producer payloads against consumer schemas and assert semantic correlation across records. Test Next and automatic modes reach equivalent state for the same fixture. Include intermediate assertions that a successful sibling remains recorded, a pending wait does not consume another round, unknown effects block release, and Pause never signals Stop.

## Implementation checklist after proposal approval

- [ ] Agree block ownership for Safety, State, Model and Output handoffs before adding their external dependency arrows.
- [ ] Add wait/cancel nodes and move reconciliation with saved-layout migration preserving node ID.
- [ ] Add discriminated incoming records and route examples, including side notifications versus alternatives.
- [ ] Update shared checkpoint/answer/binding records without importing credential values into context or event examples.
- [ ] Replace single-call outcome examples with mixed/parallel/wait/cancel/reconcile examples.
- [ ] Add typed outcome policy so local denial/error is distinct from controller failure.
- [ ] Add deterministic playback state for active calls, waits, cancellation and external fixture events.
- [ ] Remove the scripted Tools bypass after detailed route parity is verified.
- [ ] Verify selected-node path inspection and simultaneous branch highlighting in the UI.
- [ ] Update architecture/research/playback documentation to state implemented design traversal and remaining real-runtime limits accurately.

The [consolidated proposal and manifest](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.md) specify final cross-block route identities, Model facade extraction, capabilities-only resolution, and child-origin delivery/queue restrictions.
