# Lina Safety: current design audit and integration proposal

Research date: 2026-10-08. Repository HEAD: `396466c32a1e6397b70d90b5711682ff59f8048a`. This audit includes the uncommitted working tree. It inspects local primary source and existing design fixtures. No runtime permission service, grant storage or new graph nodes were implemented, and no tests were run for this audit.

## Finding

The existing three-node proposal covers an exact-operation approval but does not represent the agreed choices **Allow once, Allow for this session, Always allow, Deny**. Add explicit policy loading and grant management to its evaluate, approval and authorize responsibilities. Five nodes are sufficient if the grant node owns lookup, persistence, reservation, consumption and revocation as tagged actions. A separate persistence node would duplicate the future State/storage boundary without adding a distinct decision.

Safety should own permission. Tools should keep argument validation, scheduling and effect execution. Input should identify the responder and correlate the answer. Execution should retain waits and settled siblings. Account authentication must stay with the protected credential owner. This follows the current separation in [Tools permissions and dispatch](../../../apps/web/src/features/lina/contracts/toolsCalls.ts), [Execution waits](../../../apps/web/src/features/lina/contracts/turnExecution.ts), and [Model credential records](../../../apps/web/src/features/lina/contracts/modelRecords.ts).

The earlier [three-node proposal](revisit-planned-blocks.md#safety-and-permissions-three-nodes-new-block-development) and its [manifest](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.graph.json) are design proposals. Their Safety edges are not present in the current composed graph.

## What exists, and what it actually guarantees

| Current source | Observed behavior | Required update |
| --- | --- | --- |
| [toolsCalls.ts](../../../apps/web/src/features/lina/contracts/toolsCalls.ts), `grant`, `authorized`, `intent`, permissions node | Grants carry `callId`, final `argumentDigest`, exact catalog/schema/account binding, `policyRevision`, `permissionDecisionRef`, `scope:"this-call"`, and `actorId`. Post-hook examples obtain a fresh digest-bound grant. Safety is still a coordinator dependency. | Distinguish an approval choice, a reusable grant and one dispatch authorization. Add operation/session/workspace/agent identities, grant revision, expiry, revocation generation and authorization consumption evidence. Preserve existing validation and binding fields. |
| Same file, schedule and dispatch nodes | Trusted conflict metadata controls parallel waves. Dispatch rechecks Stop and permission. Intent-before-effect requires an applied State acknowledgment; failed/conflicting/unknown acknowledgments block launch. | Add an explicit final Safety authorization handoff for each launch admission. A cached `permissionDecisionRef` alone must not survive revocation while waiting in a wave. Keep intent persistence and permission persistence as separate records. |
| [inputAdmission.ts](../../../apps/web/src/features/lina/contracts/inputAdmission.ts), Telegram `approvalAnswer`/callback mappings and shared `promptOperation` | Telegram callbacks resolve opaque server mappings for a live actor/prompt/turn. The example maps only `approve`; CLI and other channels use the shared structured action rather than trusted arbitrary prose. Intent handling checks service operation permissions. | Add the four typed choices to trusted callback mappings and CLI/channel structured actions. Preserve actor, topic/destination, prompt, turn and expiry. A button may reference only an existing server mapping; it must not supply its own grant matcher or account. Keep route admission and prompt-responder permission separate from operation authorization. |
| [inputExecution.ts](../../../apps/web/src/features/lina/contracts/inputExecution.ts), prompt node and `input.prompt.matched` | Correlates turn/prompt/responder/account/wait and retains `continuationGranted:false`. The shared [promptAnswer](../../../apps/web/src/features/lina/contracts/shared.ts) still demonstrates `answer:"approve"`. | Carry a typed approval choice or an evidence reference to that typed choice. Keep generic clarification and tool-protocol answers as separate variants. Input must not decide the grant scope. |
| [turnExecution.ts](../../../apps/web/src/features/lina/contracts/turnExecution.ts), `waitIdentity`, `retainedWork`, wait/cancel nodes | Waits preserve batch/call/prompt identity, settled siblings, pending waits and authority. Answers return to the owning permissions node. Expiry routes to that owner. Stop signals active work and preserves unknown effects. | Add `approvalId`, `operationId`, `sessionId`, `bindingDigest`, policy/grant generations and an explicit Safety continuation owner. Add Safety prompt registration acknowledgment before delivery. Invalidate pending approvals on Stop without erasing already-settled siblings or revoking unrelated reusable grants. |
| [inputExecution.ts](../../../apps/web/src/features/lina/contracts/inputExecution.ts), delivery node | Saved output, transport acknowledgment and delivered/read observations remain distinct; unknown sends go to reconciliation without replaying agent execution. | Add a prompt output variant with saved prompt/mapping identity and delivery-status correlation. Known failed prompt send may retry the same prompt under delivery policy; unknown send must not mint another approval or consume a grant. Prompt registration remains live until exact answer, expiry or cancellation. |
| [toolsContextAcquisition.ts](../../../apps/web/src/features/lina/contracts/toolsContextAcquisition.ts) | Resource/prompt requests already carry `permissionDecisionRef`, exact preparation/dependency, account binding, inventory/schema revision and limits. Required failure differs from optional omission. Permission currently comes from a coordinator fixture. | Request real proposed Safety evaluation/final authorization at the acquisition owner. Preserve `preparationId`/`dependencyId`; do not fabricate a model call, tool batch or round to obtain approval. |
| [contextRecords.ts](../../../apps/web/src/features/lina/contracts/contextRecords.ts) | Scope specifies workspace/requester/agent, accounts, source roots, memory namespaces and `permissionGeneration`. Child examples have selected task packets and `grantsAdditionalPermission:false`. Catalog exposure and hooks also grant no authority. | Consume Safety scope/permission generation references as declared dependencies. A policy or grant change invalidates pending operation admission and may invalidate Context selection. A snapshot or inherited task packet cannot become a permission token. |
| [modelRecords.ts](../../../apps/web/src/features/lina/contracts/modelRecords.ts), [toolsConnections.ts](../../../apps/web/src/features/lina/contracts/toolsConnections.ts) | Native provider readiness has `owner:"model"`, metadata/invocation purpose, provider audience, account and no fake Tools call. Normalized output has `grantsToolPermission:false`. | Preserve these routes. Safety approval does not log into a provider, and provider login does not approve tools. Enforce model launch authority at the existing Invoke gate; no new four-choice prompt for routine inference is implied. |
| [inputSimulation.ts](../../../apps/web/src/features/lina/inputSimulation.ts), approval scenario and `answerSimulationWait` | Scripted approval supports `approve`, `deny`, `expire`; one visible `state.wait`; one pending approval call with a settled sibling. Permission steps still describe future Safety. Model and Tool waits use tagged ownership. | Add four approval choices, scoped fixture grant state, revocation/expiry/persistence outcomes, multiple pending wait records and explicit selected-wait answering. Auto/Next must apply the same state transition. No automatic fabricated human approval. |

The exact existing transitions to preserve are `lina-tools-edge-validate-permissions`, `permissions-schedule`, `permissions-collect`, `permissions-wait`, `schedule-dispatch`, `dispatch-collect`, `dispatch-reprepare`, plus `lina-execution-edge-prompt-answer`, `wait-approval`, `controls-cancel`, `cancel-tools`. Existing acquisition returns remain `lina-tools-edge-resource-context` and `prompt-context`; acquisition waits/resumes retain their current `resource-wait`, `prompt-wait`, `wait-resource-resume` and `wait-prompt-resume` IDs. See the maintained [Tools graph](../../../apps/web/src/features/lina/toolsBlock.ts) and [Execution graph](../../../apps/web/src/features/lina/executionBlock.ts).

## Existing executable policy code is useful, but narrower

The server [CapabilityResolver](../../../server/src/capabilities/policies/resolver.ts) checks registered versions, run allowlists, enabled grants, risk, declared operations, limits, connection references and exact approval operation lists. It distinguishes granted, denied and approval-required, and rejects expired approvals. Its [CapabilityApproval](../../../server/src/capabilities/contracts.ts) has capability/version/operation/connection, approved-or-denied, decision time and expiry. It has no operation argument digest, human responder identity, session lifetime, once consumption or revocation transaction. Treat it as run admission, not an interactive grant store.

[RunService](../../../server/src/control-plane/application/run-service.ts) projects approved capabilities into `approvedNames`. The [ToolRegistry](../../../server/src/capabilities/tools/registry.ts) then checks enabled tool names and explicit approval for writes/external tools. `execute()` revalidates arguments and checks cancellation, but does not itself call `authorize()`. Name-level approval is broader than Lina's proposed exact-operation permission. A Lina adapter must preserve operation-bound decisions instead of treating `approvedNames` as a reusable Safety token.

The [Studio Safety contract](../../../studio/modules/safety/src/contract.ts) evaluates tool, environment, output and memory checkpoints. Its [allowlist implementation](../../../studio/modules/safety/src/allowlist.ts) checks configured capability identities and operations. It never dispatches or grants interactive approval. The [kernel](../../../studio/agent-kernel/src/text-turn.ts) rejects decisions other than `allow`. Its `approval-required` status is therefore a useful boundary, not an implemented four-choice workflow. These pieces support responsibility separation; none supplies durable session/always approval.

## Approval and grant semantics

| Choice | Stored meaning | Matching and lifetime |
| --- | --- | --- |
| Allow once | One logical operation, exact final arguments and binding | Reserve/consume once for that `operationId`; duplicate answer or dispatch cannot obtain another permit. Bounded known-no-effect retries belong to the same logical operation but require fresh attempt admission and retry policy. Unknown effects never reuse permission as proof replay is safe. |
| Allow for this session | Reusable constrained grant | Explicit `sessionId`, requester/workspace/account/tool/resource matcher and expiry/session-end generation. Session means a declared runtime session, not whichever turn or conversation happens to arrive. |
| Always allow | Persisted constrained grant | Same reviewed matcher, explicit issuer/creation/policy revision and revocation support. "Always" means until revoked or invalidated, not unrestricted accounts, arguments, tools or child agents. Do not publish success before the selected persistence contract acknowledges commit. |
| Deny | Known no-launch decision for the pending operation | Does not silently create a permanent denial rule. Persistent deny rules belong to policy management, outside these four prompt choices. |

Policy hard-deny rules and scope ceilings outrank grants. A grant may satisfy an approval requirement within policy; it cannot override a prohibited target. Show the reviewed matcher when offering session/always scope, for example this account and document-write operation in one workspace. Default to exact arguments if a broader matcher cannot be stated safely. Record the displayed matcher digest so the stored grant cannot silently broaden it. Prompt records carry `offeredChoices` and permitted scope ceilings; an unavailable persistent/session choice cannot be accepted by submitting its enum directly.

Do not release a once reservation merely because a callback timed out. Release requires authoritative evidence that launch admission was cancelled before dispatch. An unknown grant-store commit blocks launch and stays unresolved until its request ID is inspected. This is separate from an unknown external tool effect.

## Proposed five nodes and shared records

| Proposed node | Responsibility and branch outputs |
| --- | --- |
| `lina-safety-policy` | Load configured policy and scope ceilings for the operation's principal/workspace/agent. Produce `safety.policy-ready`, `safety.policy-denied`, `safety.policy-unavailable`. Record precedence, revision and source references. No model-generated rule becomes trusted configuration. |
| `lina-safety-evaluate` | Join the exact operation with current policy and applicable grant lookup. Produce `safety.allowed`, `safety.denied`, `safety.approval-required`, `safety.evaluation-unavailable`. No effects or prompt delivery here. |
| `lina-safety-approval` | Create/correlate the four-choice prompt, register its wait, then request delivery. Validate responder, displayed scope, expiry and exactly one resolution. Produce `safety.approval-waiting`, `safety.approval-resolved`, `safety.approval-expired`, `safety.approval-cancelled`, `safety.approval-rejected`. |
| `lina-safety-grants` | Own tagged `lookup`, `commit-choice`, `reserve-once`, `consume`, `release-unlaunched`, `revoke`, `inspect-commit` operations. Produce grant match/miss/expired/revoked, committed/conflict/failed/unknown, reservation acquired/refused/unknown and revocation acknowledgment. Secret credentials never enter this store. |
| `lina-safety-authorize` | Recheck live authority/fence, Stop, exact final arguments/schema/account/target, policy and grant generation immediately before launch. Require matching reservation/commit evidence when applicable. Produce `safety.operation-decided` with allow/deny/recheck/wait/unavailable, and a bounded permit only on allow. |

Shared field sketch, not executable schemas:

```json
{
  "OperationPermissionRequest": {
    "requestId": "permission-request:call-001:v1",
    "operationId": "call-001",
    "kind": "tool-call",
    "requesterNodeId": "lina-tools-permissions",
    "returnNodeId": "lina-tools-permissions",
    "identity": {
      "requesterId": "user-demo",
      "workspaceId": "workspace-demo",
      "agentId": "lina-main",
      "parentAgentId": null,
      "sessionId": "session-demo",
      "conversationId": "conversation-demo",
      "turnId": "turn-001",
      "roundId": "round-001",
      "batchId": "batch-001",
      "callId": "call-001",
      "preparationId": null,
      "dependencyId": null,
      "attemptId": null
    },
    "operation": {
      "toolId": "tool:docs-demo:update",
      "operationName": "update",
      "targetRef": "document:document-demo",
      "argumentDigest": "sha256:final-arguments",
      "schemaDigest": "sha256:fixture-docs-update-schema",
      "schemaRevision": "v1",
      "catalogRevision": "catalog:demo:7",
      "adapterRef": "adapter:native-docs:v1",
      "connectionId": "conn-docs-demo",
      "accountId": "account-demo",
      "readinessGeneration": 3,
      "effectClass": "write",
      "sourceTrust": "validated-untrusted-proposal"
    },
    "authorityRef": "authority:turn-001:fence-2",
    "scopeRef": "context-scope:lina-main:v1",
    "policyRevision": "permission-policy:v1",
    "permissionGeneration": 4,
    "delegationRef": null,
    "requestedAt": "2026-10-08T10:00:00Z"
  },
  "ApprovalResolution": {
    "approvalId": "approval:call-001:v1",
    "promptId": "prompt-001",
    "waitId": "wait:approval:call-001",
    "operationRequestRef": "permission-request:call-001:v1",
    "choice": "allow-session",
    "responderId": "person-demo",
    "responderAuthorityRef": "human-authority:person-demo:v1",
    "answerEvidenceRef": "answer-evidence:prompt-001",
    "displayedMatcherDigest": "sha256:reviewed-session-scope",
    "bindingDigest": "sha256:operation-binding",
    "resolvedAt": "2026-10-08T10:00:01Z",
    "status": "accepted"
  },
  "GrantRecord": {
    "grantId": "grant:docs-update:session-demo:1",
    "scope": "session",
    "matcherRef": "matcher:reviewed-session-scope",
    "matcherDigest": "sha256:reviewed-session-scope",
    "issuerRef": "human-authority:person-demo:v1",
    "sessionId": "session-demo",
    "operationId": null,
    "delegable": false,
    "revision": 1,
    "revocationGeneration": 0,
    "status": "active",
    "expiresAt": null,
    "persistence": "fixture-only",
    "commitEvidenceRef": "grant-commit:1"
  },
  "OperationAuthorization": {
    "authorizationId": "authorization:call-001:attempt-1",
    "operationRequestRef": "permission-request:call-001:v1",
    "decision": "allow",
    "grantRef": "grant:docs-update:session-demo:1",
    "grantRevision": 1,
    "policyRevision": "permission-policy:v1",
    "permissionGeneration": 4,
    "ownerFence": 2,
    "argumentDigest": "sha256:final-arguments",
    "bindingDigest": "sha256:operation-binding",
    "launchAdmissionRef": "admission:call-001:attempt-1",
    "expiresAt": "2026-10-08T10:00:05Z",
    "effectOccurred": false
  }
}
```

Use discriminated variants for tool-call, resource-read and prompt-get identities, with nullable unrelated IDs as above or separate shapes. Choices are `allow-once|allow-session|allow-always|deny`; grant scopes are `operation|session|persistent`. Resolution rejection/expiry/cancellation is not another user choice. Missing or unknown evidence never defaults to allow.

## Graph-ready routes

Retain the three original Safety node IDs and add two. Edge names shortened after the first full ID use the same `lina-safety-edge-` prefix; `/request/return` denotes two separate edges. Each proposed edge must carry the producer record unchanged; local owner state stays separate.

| Proposed edge IDs | Route and event |
| --- | --- |
| `lina-safety-edge-tool-request` | Tools permissions → evaluate, `safety.operation-requested`, from exact post-hook validation. |
| `lina-safety-edge-evaluate-policy`, `policy-evaluate` | evaluate → policy on `safety.policy-requested`; policy → evaluate on policy ready/denied/unavailable, retaining request identity. |
| `lina-safety-edge-evaluate-grants`, `grants-evaluate` | evaluate → grants on `safety.grant-lookup`; grants → evaluate on matched/missing/expired/revoked/unavailable. This is a dependency join, not an unbounded loop. |
| `lina-safety-edge-evaluate-authorize`, `evaluate-approval` | Allowed/denied/unavailable evaluation → authorize; approval-required → approval. Denial never creates a grant. |
| `lina-safety-edge-approval-wait-tools`, `wait-registered` | approval → Tools permissions with `safety.approval-waiting`; permissions uses existing permissions-wait → Execution. Execution → approval with proposed `safety.approval-wait-registered` only after retained wait registration. |
| `lina-safety-edge-approval-prompt` | approval → Input delivery with `delivery.prompt-requested`, after registration acknowledgment. Include four choices, exact reviewed matcher, eligible responders, prompt/wait/operation IDs and expiry. Future Output can replace this owner when represented. |
| `lina-safety-edge-approval-answer` | Input prompt → existing Execution wait → existing Tools permissions → approval on `safety.answer-received`. No second Input → Safety shortcut. |
| `lina-safety-edge-approval-grants`, `grants-authorize` | Accepted allow choice → grants on `safety.grant-commit-requested`; committed/conflict/failed/unknown → authorize with unchanged resolution and commit evidence. Deny/expiry/cancel → authorize via retained `approval-authorize`. |
| `lina-safety-edge-authorize-grants`, `reservation-authorize` | authorize → grants for once reservation/consumption; grants → authorize with transaction outcome. Tag action/request ID to avoid confusing grant lookup with a fresh approval. |
| `lina-safety-edge-decision-tools` | authorize → Tools permissions on `safety.operation-decided`, preserving existing schedule/collect branches. This decision may prepare scheduling; it cannot remain an unlimited launch permit. |
| `lina-safety-edge-dispatch-authorize`, `authorize-dispatch` | Tools dispatch → authorize for the exact queued launch; authorize → dispatch on `safety.launch-decided`. Permit must still match the current admission epoch at dispatch. Expired/revoked/stale decisions re-evaluate or produce known no-launch outcomes. |
| `lina-safety-edge-resource-read-request/return`, `prompt-get-request/return` | Existing acquisition owners → evaluate and authorize → exact owner. Add corresponding approval-wait and answer forwarding variants through Execution, retaining preparation/dependency identity. |
| `lina-safety-edge-cancel-approval`, `cancel-authorization` | Execution cancel → approval/authorize on exact operation invalidation. A late accepted answer cannot revive stopped work. Existing cancel-tools still handles started effects. |

Grant revocation/session-end are external verified configuration/lifecycle events into grants. No graph arrow to a nonexistent State or Subagents node should be added now. Record their owner references and `implemented:false` until those blocks exist.

## Required branch coverage and implementation cuts

- Allowed by policy, allowed once, reused session grant and reused persistent grant. Every success has current binding/digest evidence and a paired final launch decision.
- Deny by policy, user denial, expired prompt/grant, revoked grant, ended session, changed arguments/account/schema/policy, wrong responder/prompt and duplicate answer. Known no-launch results preserve successful siblings; stale answers retain the original unresolved wait.
- Prompt delivery success, known failure and unknown acknowledgment, with retries retaining the same prompt/approval IDs and no inference replay.
- Two simultaneous approvals, one denied while another is approved, and a completed sibling in the same batch. Store waits by ID rather than a single `state.wait`; selecting one answer cannot clear the other.
- Stop before answer, before grant commit, while queued for dispatch and after an effect starts. Late callbacks stay diagnostic. Persistent grant revocation and cancellation of one pending operation are distinct events.
- Grant persistence failure/conflict and unknown acknowledgment. Failures withhold reusable grants; unknown commits require inspection by the same transaction ID and do not permit blind writes or dispatch. Fixture persistence must stay labelled `fixture-only`.
- Hook changes followed by fresh validation/evaluation, final authorization expiration during a serial wave, and retry after known-no-effect versus unknown effect. Permission never substitutes for effect certainty or idempotency.
- Resource/prompt approval before a model round, required source failure and optional omission. Provider-auth waits keep `owner:model` or connection authorization tags; an approval choice cannot resolve either.
- Child readiness as a contract boundary only. A future child receives an explicitly narrowed delegation manifest intersected with parent scope and policy, its own agent/turn/history identity and reviewed account matcher. Default reusable grants are not delegable. Context's existing child example is no evidence that launch, delegated grants or child cancellation already work.

Update the [active cross-block plan](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.md), its paired graph manifest and the earlier planned-block research together after accepting this proposal. Existing completed plans should receive a correction where their baseline approval description changed, not a new unfinished implementation checklist. No live grant-store, authentication interoperability or durable permission guarantee was established by this inspection.
