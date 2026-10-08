# Lina review: planned blocks and shared ownership

Reviewed 2026-10-08. Proposal only. No graph, contracts, simulation or runtime code is changed by this document.

## What is being revisited

The current graph has Input, Turn Execution, Context and Tools nodes. The other regions in [plannedBlocks.ts](../../../apps/web/src/features/lina/plannedBlocks.ts) are empty design reservations. Adding their nodes is **new block development**, not evidence that an earlier implementation was incomplete. Subagents now has an empty reserved region; its proposed nodes remain pending.

This proposal gives the future blocks concrete endpoints so the implemented blocks can name their dependencies accurately. It does not recommend implementing all these blocks in one change. The compact candidate sets below total **35 new nodes** across ten blocks. Planning is a required future capability; simple turns may bypass explicit plan
creation. Computer Use is deferred for a later revisit. Memory algorithms, workflow strategies and deployment backends remain replaceable inside these boundaries.

The proposed baseline is one parent agent, an ordinary model/tool loop, bounded parallel independent tool calls, explicitly delegated children, selected context, and honest known/unknown operation outcomes. A graph workflow can later replace the loop coordinator without rewriting model, tool, memory or delivery boundaries.

## Evidence and limits

- [Tools responsibility study](tools-architecture-research.md#recommended-responsibility-boundaries) separates connection authentication, operation permission, environment execution, context exposure and persistence.
- [Context study](context-research.md#what-context-means-here) distinguishes retained conversation records, model-visible context and provider requests. Its [child-context section](context-hermes-openclaw.md) pins Hermes `ddc0e65958b326a89f6c440c76c812d31ac27e2a` and OpenClaw `e40ed06f23cb8bd939c9a6ff537eba7136074686`; [Pi/Waku study](context-pi-waku.md) pins their inspected sources. These support isolated task packets and explicit inheritance, not one universal subagent mechanism.
- [Local Tools audit](tools-existing-runtime-audit.md) describes actual local registries, adapter injection, permission boundaries and credential-store limits. Real connector support is narrower than the design.
- [Studio memory contracts](../../../server/src/studio/memory/contracts.ts) already distinguish namespaces, revisions, sources, retrieval candidates, mutations, applied operation IDs and uncertain persistence. They are reusable evidence for boundaries, not proof that Lina has a real memory implementation.
- [Studio environment](../../../server/src/studio/runtime/environment.ts), [delivery notes](../../../server/src/agent-host/delivery/README.md), [OpenRouter model notes](../../../server/src/models/openrouter/README.md) and [current execution design](../../../apps/web/src/features/lina/executionBlock.ts) give local implementation boundaries to inspect before runtime work.

The node sets below are Lina design decisions inferred from that evidence. No upstream behavior, benchmark advantage or production guarantee is claimed for them. Model-specific encoding and computer adapter schemas must be verified against the selected provider when implemented.

## Shared contract convention

Use the current inspector convention: event payloads describe the handoff; coordinator context supplies authority and owned state. Every output variant has an event name and a discriminated JSON schema. Success, refusal, unavailable, waiting, cancellation and unknown outcomes must be distinct where applicable. Exact provider records remain behind adapters; safe source references and provider detail references can survive normalization.

All asynchronous work uses `operationId`, `agentId`, `turnId`, `ownerRevision`, `status` and `sourceRefs`. Add `roundId`, `attemptId`, `callId`, `childId`, `deliveryId` or `checkpointId` only when that work has that identity. Synthetic IDs are references, never credentials. A block may receive control input separately from its ordinary request.

In the tables, each type lists the required fields to convert into JSON schemas. Branch records use `status` enums and separate required fields for each status. The implementation must derive consumer inputs from producer variants using the existing contract registry. Examples below are proposed data shapes, not existing contracts.

Every cross-block route gets an edge ID `lina-<owner>-edge-<source-short>-<target-short>` and a label matching the event name. Internal routes use the same pattern. Observability subscriptions are visually optional; they must not turn the main request into a serial chain through every block.

## Memory: four nodes, new block development

The [dedicated Memory study](memory-research.md), researched on 2026-10-08,
refines this initial sketch into twelve candidate responsibilities and separate
recall/write/maintenance paths. This section retains the historical four-node
proposal; it is not the implementation authority for the next Memory slice.
Memory remains unimplemented and the new proposal awaits review.


| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-memory-scope` | Resolve allowed read/write namespaces for this agent. `MemoryRequest {operationId,agentId,turnId,kind:read|write,query?,candidateRefs?,scopeRequest}` to `MemoryAccess {operationId,namespaces,allowedOperations,policyRevision}` or `memory.refused`. Parent access is not automatically child access. |
| `lina-memory-retrieve` | Select permitted retained records. Access + query + retrieval policy to `MemorySelection {operationId,storeRevision,records,omittedRecordIds,selectionPolicyRef}` or unavailable. Each record has `recordId,namespace,revision,contentRef,sourceRefs,state`. Selection does not inject records into Context. |
| `lina-memory-review-write` | Resolve explicit candidate mutations and their provenance. Access + candidates to `MemoryMutationPlan {operationId,expectedStoreRevision,mutations,policyRef}` or no-op/refusal. Mutations have `mutationId,kind:add|update|delete,targetRecordId?,candidateRef?,sourceRefs`. Model suggestions are candidates until this decision. |
| `lina-memory-commit` | Apply admitted mutations through the configured store. Plan to `MemoryCommit {operationId,status:applied|conflict|failed|unknown,storeRevision?,appliedMutationIds}`. Update/delete semantics and operation-ID deduplication belong here. |

Internal routes: scope → retrieve on `memory.read-admitted`; scope → review-write on `memory.write-admitted`; review-write → commit on `memory.mutations-ready`. Retrieve → `lina-context-load` on `memory.selection-ready`. `lina-context-load` → scope on `memory.read-requested` is an explicit optional staged source dependency, then Context load carries selected memory into task assembly. Ordinary memory tools use `lina-tools-dispatch` → scope, then retrieve/commit → `lina-tools-collect`; a memory write is not automatically a turn-settlement side effect. Commit → State record on `state.record-requested`.

```json
{"operationId":"memory-read-01","agentId":"child-01","storeRevision":4,"records":[{"recordId":"memory-07","namespace":"project:demo","revision":2,"contentRef":"memory-content:07:r2","sourceRefs":["input-03"],"state":"active"}],"omittedRecordIds":[],"selectionPolicyRef":"memory-policy:keyword:v1"}
```

Simulation cases: no matches, permitted retrieval, child private namespace refusal, explicit write, revision conflict, repeated mutation ID, unknown write acknowledgement. Begin with small fixed records; vector retrieval, consolidation and competing write policies are future strategies, not mandatory new nodes.

## Model Interface: four nodes, new block development

The dedicated [Model Interface research](model-interface-research.md) and
[implementation plan](../../../development/implementation-plans/studio/completed/lina-model-interface.md)
refine and supersede this initial sketch. The four-node graph/contract/fixture slice is complete; real provider clients remain deferred.

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-model-resolve` | Resolve provider/model configuration, capabilities and credential readiness. `ModelInvocation {agentId,turnId,roundId,attemptId,contextSnapshotRef,modelConfigRef,launchAuthorityRef}` to `ModelBinding {providerRef,modelId,modelRevision?,capabilitiesRef,credentialBindingRef,settings}` or unavailable. |
| `lina-model-encode` | Convert the accepted context snapshot into a provider request. Binding + snapshot to `ProviderRequest {requestId,attemptId,contextSnapshotRef,catalogRevision,providerPayloadRef,encodingRevision}` or incompatible-context failure. Preserve media, call identities and requested output format. |
| `lina-model-invoke` | Own transport and incremental response collection for one provider attempt. Request to `ProviderObservation {requestId,attemptId,status:progress|complete|failed|aborted,contentRef?,finishReason?,usage?,failure?}`. Partial argument fragments are never executable calls. |
| `lina-model-normalize` | Validate the terminal response and normalize content/tool requests. Observation to `ModelResponse {attemptId,status:complete|truncated|malformed|failed|aborted,contentBlocks,toolCalls,usage,providerDetailRef}`. Model Interface classifies evidence; Turn Execution decides continuation/retry. |

Internal routes: resolve → encode on `model.binding-ready`; encode → invoke on `model.request-encoded`; invoke → normalize on `model.attempt-observed`. `lina-execution-model` → resolve on `model.invocation-requested`; normalize → `lina-execution-decide` on `model.response-ready` and classified failure. Resolve capabilities → `lina-context-load` on `model.capabilities-ready` during setup. Context budget/validation uses the same capability revision as encoding. Provider retry returns through existing `lina-execution-recover`, retains the round and uses a new attempt ID. Existing `lina-execution-model` forwards `model.abort-requested` as a cancellation-input discriminator to invoke; invoke emits `model.abort-observed` through normalize so the original attempt has one terminal accounting record. Turn Execution cancellation owns stop coordination; Model owns its provider abort mechanism. Its abort observation distinguishes confirmed abortion, already-terminal and unconfirmed interruption.

```json
{"attemptId":"attempt-01","status":"complete","contentBlocks":[],"toolCalls":[{"callId":"call-01","name":"calculator","arguments":{"expression":"2+2"}}],"usage":{"inputTokens":120,"outputTokens":15},"providerDetailRef":"provider-observation:01"}
```

Simulation cases: terminal answer, two valid tool calls, streamed fragments followed by a valid terminal call, truncation with unusable fragments, unsupported media, provider retry, stop during streaming. Usage values are explicitly synthetic in Studio.

## Safety and permissions: three nodes, new block development

Superseded on 2026-10-08 by the [dedicated Safety research](safety-permissions-research.md).
The updated proposal has five nodes, adding policy resolution and grant management
for once/session/persistent permission. This section retains the earlier proposal;
the pending implementation plan and graph manifest have not yet adopted the new design.

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-safety-evaluate` | Evaluate an operation against actor, target, argument digest, account/resource binding and policy. `OperationPermissionRequest {operationId,kind,actorRef,targetRef,argumentsDigest,accountBindingRef,policyRevision,authorityRef}` to allow, deny or `ApprovalRequest {approvalId,operationId,bindingDigest,eligibleResponders,expiresAt}`. |
| `lina-safety-approval` | Accept only a correlated eligible answer, expiry or cancellation. Approval + answer/control to `ApprovalResolution {approvalId,operationId,status:approved|denied|expired|cancelled|rejected,bindingDigest,responderRef?}`. Raw text containing “approved” is not trusted approval. |
| `lina-safety-authorize` | Recheck the exact live operation and emit a bounded decision reference. Evaluation/resolution + live bindings to `OperationAuthorization {operationId,decision:allow|deny|recheck,decisionRef,argumentsDigest,policyRevision,ownerRevision}`. Changed arguments/account/catalog invalidate the decision. |

Internal routes: evaluate → authorize on `safety.allowed`; evaluate → approval on `safety.approval-required`; approval → authorize on `safety.approval-resolved`. `lina-tools-permissions` → evaluate on `safety.operation-requested`; authorize → `lina-tools-permissions` on `safety.operation-decided`, which then uses its current Tools scheduling route. Answers use one route: existing `lina-input-prompt` correlates the reply, then `lina-execution-wait` routes it to `lina-tools-permissions`, which forwards `safety.answer-received` to approval. There is no direct Input → Safety shortcut; rejected answers return through the owning wait/status path without creating a model turn. Approval → `lina-input-delivery` on `delivery.prompt-requested`, delegating to Output when available.

Other operations, such as child launch, memory writes and computer actions, can use this same boundary through their operation-specific adapters. Chat admission remains Input policy; connection authentication remains Tools; checking an operation here does not log in to a provider.

```json
{"operationId":"call-01","decision":"recheck","decisionRef":"permission:01","argumentsDigest":"sha256:fixture-new-arguments","policyRevision":"policy:3","ownerRevision":7}
```

Simulation cases: allowed read, denied write, approval/denial, invalid responder, expired approval, arguments changed after approval. Initially reuse existing Tools permission fixtures rather than inventing a second permission system.

## Execution Environment: three nodes, new block development

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-environment-bind` | Resolve the configured process/filesystem/network/browser host and allowed access. `EnvironmentRequest {agentId,operationId,profileRef,requestedResources,authorizationRef}` to `EnvironmentBinding {environmentId,profileRevision,workspaceRef,resourceHandles,limits,isolationKind}` or unavailable/refused. Never describe a local process as sandboxed without an actual boundary. |
| `lina-environment-run` | Execute environment-backed operations under the binding. Binding + `ExecutionIntent {operationId,adapterRef,argumentsRef,deadline,cancellationRef}` to `ExecutionObservation {operationId,status:running|success|error|cancelled|unknown,artifactRefs,effectCertainty}`. |
| `lina-environment-release` | Stop admission and close or retain owned resources according to lifecycle. Binding + release/control to `EnvironmentRelease {environmentId,status:closed|retained|pending,unresolvedOperationIds}`. Child completion cannot destroy a shared parent workspace. |

Internal routes: bind → run on `environment.bound`; run → release on `environment.release-requested` for ephemeral bindings. `lina-tools-dispatch` → bind/run on `environment.operation-requested`; run → `lina-tools-collect` on `environment.operation-observed`. Shared connections and loaded native plugins may request bind/release during setup and teardown, not every call. Environment is an execution boundary, not another tool registry.

```json
{"environmentId":"env-child-01","profileRevision":"local-workspace:v1","workspaceRef":"workspace:demo","resourceHandles":["process-host:01"],"limits":{"maxProcesses":2},"isolationKind":"local-process"}
```

Simulation cases: configured local environment, refused path/network target, unavailable host, interrupted process with known exit, unknown external effect, shared environment retained during child cleanup. Real sandboxing and distributed leasing are separate deployment work.

## Computer Use: three nodes, deferred new block development

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-computer-bind` | Bind an allowed browser/computer target, adapter and live capability set. `ComputerRequest {operationId,agentId,targetRef,adapterRef,authorizationRef}` to `ComputerBinding {sessionRef,targetRef,capabilities,environmentId}` or unavailable. Browser and desktop adapters may expose different methods. |
| `lina-computer-observe` | Obtain one fresh observation with its origin and revision. Binding to `ComputerObservation {observationId,sessionRef,targetRef,revision,contentRefs,observedAt}`. Images, DOM/accessibility or other observations stay explicitly typed. |
| `lina-computer-act` | Execute a validated adapter-specific action against the intended target and observation. `ComputerAction {operationId,sessionRef,targetRef,observationRef,action,arguments,authorizationRef}` to `ComputerActionResult {operationId,status,effectCertainty,artifactRefs,newObservationRef?}`. Stale observations can require another observe, not a blind click retry. |

Internal routes: bind → observe on `computer.bound`; observe → act only on an explicit `computer.action-requested`; act → observe on `computer.refresh-requested`. This is an adapter lifecycle, not an autonomous inner reasoning loop. Tools dispatch → bind/observe/act on the matching registered operation; observe/act → Tools collect on `computer.observation-ready` / `computer.action-observed`. Bind → Environment bind when a host is required; act uses Safety authorization for its operation.

```json
{"operationId":"browser-click-01","sessionRef":"browser:01","targetRef":"tab:demo","observationRef":"observation:5","action":"click","arguments":{"locatorRef":"observed-element:send"},"authorizationRef":"permission:browser-click-01"}
```

Simulation cases: read a browser view, permitted click, missing target, stale observation, action failure, stop after action begins. Selecting an actual adapter precedes exact locator/action schemas; do not claim all providers share coordinates or DOM locators.

## Output and delivery: four nodes, new block development

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-output-prepare` | Convert a candidate answer or status/prompt into a destination-aware delivery plan. `DeliveryRequest {deliveryId,sourceKind,turnId?,replyRoute,contentBlocks,artifactRefs}` to `DeliveryPlan {deliveryId,adapterAccountRef,destination,parts,formatRevision}` or unsupported-format result. |
| `lina-output-record` | Record intent/status before an effect under the selected delivery policy. Plan to `RecordedDelivery {deliveryId,deliveryRevision,planRef,status:ready|failed|unknown}`. Persistence failure must not claim the intent is durable. |
| `lina-output-send` | Use the channel adapter, scoped account readiness and recorded plan to send ordered parts. Record to `DeliveryObservation {deliveryId,partId,status:sent|failed|unknown,remoteMessageId?,failure?}`. Idempotency is provider-specific; part IDs identify acknowledgements. |
| `lina-output-reconcile` | Resolve known status and inspect unknown acknowledgement when supported. Observations to `DeliveryStatus {deliveryId,status:delivered|partial|failed|unknown,parts}`. Unknown acknowledgement is not permission to resend. |

Internal routes: prepare → record on `delivery.plan-ready`; record → send on `delivery.intent-recorded`; send → reconcile on `delivery.attempt-observed`; reconcile → send only on `delivery.retry-authorized` for definitely unperformed/retryable parts under policy. Existing `lina-input-delivery` becomes a gateway into prepare rather than another delivery implementation. Reconcile → `lina-input-delivery` on `delivery.status-ready` with a direction-discriminated receipt, not recursive resubmission. Output record → State record; send requests account readiness through a connector binding without duplicating the Tools OAuth flow.

Keep a turn's execution completion separate from outbound delivery completion. Existing settlement/release still waits for required execution work; configured delivery ownership can continue after that with durable identity. The proposal does not claim an outbox implementation exists.

```json
{"deliveryId":"delivery-01","status":"partial","parts":[{"partId":"part-01","status":"sent","remoteMessageId":"remote-77"},{"partId":"part-02","status":"unknown","remoteMessageId":null}]}
```

Simulation cases: CLI write, Telegram/WhatsApp adapter send, format refusal, part split, one failed part, unknown acknowledgement, receipt without a new turn, definite safe retry. Initial complete-message simulation can use one part.

## State, persistence and recovery: four nodes, new block development

The 2026-10-08 [comparative State research](state-persistence-research.md) retains
these four IDs and refines their proposed contracts, ownership commands,
checkpoint manifests, request/return routes and recovery cases. Use that report
and its linked audit for the next implementation; this table is the earlier
proposal, not the final JSON Schema registry.

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-state-load` | Read owner-scoped configuration, history or checkpoint references at a declared revision. `StateRead {operationId,recordKind,scope,recordRef,expectedRevision?}` to `StateReadResult {operationId,status:found|missing|failed,recordRef,revision?,payloadRef?}`. |
| `lina-state-record` | Persist an intent, observation or lifecycle change with expected revision and deduplication identity. `StateWrite {operationId,recordKind,scope,recordRef,expectedRevision,payloadRef,ownerRevision}` to `StateWriteResult {operationId,status:applied|conflict|failed|unknown,revision?}`. Protected credentials stay behind the credential store; these records contain safe refs only. |
| `lina-state-checkpoint` | Commit a coherent execution checkpoint and referenced owned work. `CheckpointRequest {checkpointId,agentId,turnId,ownerRevision,recordRevision,roundStateRef,pendingWorkRefs,contextSnapshotRef}` to `CheckpointStatus {checkpointId,status:committed|failed|unknown,checkpointRevision?}`. Partial record persistence does not prove a usable checkpoint. |
| `lina-state-recover` | Validate checkpoint compatibility, reacquired authority and unresolved work before returning a resume plan. Checkpoint + current bindings to `ResumePlan {turnId,status:resume|reconcile|required-review|reject,ownerRevision,resumeNodeId,pendingWorkRefs,reason}`. Never relaunch an unknown effect just because the process restarted. |

Internal routes: load → recover on `state.checkpoint-loaded` only for recovery reads. Record and checkpoint return completion to their recorded requester. The coordinator independently emits `state.checkpoint-requested`; record does not automatically chain into checkpoint. recover → existing `lina-input-recovery` on `state.resume-plan-ready`; that coordinator retains the existing ownership/reconciliation paths. Input claim/admission and Execution checkpoint boundaries request state.record/checkpoint without inserting State into every visual edge. Context load requests state.load for record-backed sources. Unknown effects route to existing `lina-input-reconcile` with original call/delivery identity.

```json
{"turnId":"turn-01","status":"reconcile","ownerRevision":8,"resumeNodeId":"lina-input-reconcile","pendingWorkRefs":["call-intent:01"],"reason":"external effect acknowledgement missing"}
```

Simulation cases: read missing state, write conflict, committed checkpoint restart, incompatible checkpoint, lost write acknowledgement, reacquired authority, pending child/tool/delivery reconstruction. Synthetic recovery is a design scenario, not durable execution proof.

## Observability: three nodes, new block development

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-observability-record` | Capture normalized lifecycle events with original safe adapter references. `TraceEvent {eventId,sequence,runId,agentId,parentAgentId?,turnId?,operationId?,kind,logicalTime,payloadRef,sourceRevision}` to `TraceRecordStatus {eventId,status:recorded|failed,traceRef?}`. Sequence/correlation express ordering; wall-clock timestamps alone do not. |
| `lina-observability-project` | Construct graph playback and inspector views from trace data while preserving concurrent active/waiting/terminal operations. `TraceProjectionRequest {traceRef,throughSequence,viewPolicyRef}` to `TraceProjection {cursor,activeNodeIds,edgeTransitions,operationStates,detailRefs}`. Scripted simulator events and real runtime events have an explicit source kind. |
| `lina-observability-export` | Export the configuration manifest and inspectable records/artifacts. `ExportRequest {runId,traceRef,manifestRef,artifactRefs}` to `EvidenceExport {runId,status,pathRefs,omissions}`. Synthetic values are identified; no secret/raw-token export. |

Internal routes: record → project on `trace.recorded`; project → export only on `trace.export-requested`. All relevant blocks publish events to record through subscriptions, not blocking main execution edges. Studio Next advances the event cursor once; Auto uses exactly the same transition function. Multiple active tool/child nodes are visible simultaneously. Export can follow the repository run-record structure without pretending a design run contains model benchmark evidence.

```json
{"cursor":12,"activeNodeIds":["lina-tools-dispatch"],"edgeTransitions":[{"operationId":"call-01","from":"lina-tools-schedule","to":"lina-tools-dispatch"},{"operationId":"call-02","from":"lina-tools-schedule","to":"lina-tools-dispatch"}],"operationStates":[{"operationId":"call-01","status":"running"},{"operationId":"call-02","status":"running"}],"detailRefs":[]}
```

Simulation cases: sequential path, two simultaneously active calls, waiting approval with sibling progress, terminal child delivery, duplicate/out-of-order event, export identifying scripted provenance. This block observes decisions; it never decides tool permission or execution completion.

## Planning: two nodes, required future capability

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-planning-update` | Retain an explicit task plan when the chosen agent mode uses one. `PlanUpdate {agentId,turnId,expectedRevision,steps,sourceRef}` to `PlanSnapshot {planId,revision,steps,status}`. Steps have IDs, dependency IDs and states. A written plan does not schedule actions automatically. |
| `lina-planning-select` | Apply a configured workflow strategy to select ready steps or completion. `PlanSelection {planRef,strategyRef,settledWorkRefs}` to `PlanNext {planRef,readyStepIds,decision:continue|complete|blocked}`. The strategy is explicit; cyclic dependencies are invalid. |

Internal route update → select on `planning.plan-updated`. Tools plan-update calls → update → Tools collect. Context task can request/read a plan snapshot. A future graph coordinator may call select and route work; the current ordinary loop has no forced planning path. Do not insert “make a plan” before every model call.

```json
{"planRef":"plan:01:r2","readyStepIds":["step-tests"],"decision":"continue"}
```

Simulation cases: plan update, prerequisite unfinished, dependency completed, invalid cycle, optional plan disabled. General workflow execution is a later alternative coordinator, not implemented by these two nodes alone.

## Subagents: five nodes, proposed new block and region

Historical sketch. The 2026-10-08 [dedicated subagent study](subagents-research.md)
rechecks upstream implementations and proposes eight nodes, exposing Join,
Cancel and Reconcile separately. Its proposal and current-owner audit guide the
next review; the Subagents region remains unimplemented.

| Exact node ID | Responsibility and contract |
| --- | --- |
| `lina-subagents-validate` | Validate an explicit spawn request against delegation permission and parent budget. `SubagentRequest {operationId,parentAgentId,parentTurnId,taskRef,selectedContextRefs,toolPolicyRef,memoryPolicyRef,modelConfigRef,limits}` to `SubagentAdmission {operationId,status:admitted|refused,childId?,effectivePolicyRefs,limits}`. Model-led delegation uses a registered spawn tool. |
| `lina-subagents-prepare` | Create an isolated task packet and fresh child history with permitted instruction/context sources. Admission to `ChildTaskPacket {childId,parentAgentId,taskRef,contextRefs,historyMode:isolated,toolPolicyRef,memoryPolicyRef,environmentProfileRef,limits}`. Shared project access is explicit; parent private history is not automatically copied. |
| `lina-subagents-launch` | Start a child-owned execution instance of the same harness and record its identity. Packet to `ChildHandle {childId,parentOperationId,childTurnId,status:started|failed,handleRef?}`. Child uses the same Context/Model/Tools blocks with child-specific state; graph definitions are reused, not copied. |
| `lina-subagents-coordinate` | Track child progress, cancellation, timeout and required join policy. Handle + child/control events to `ChildCoordination {childId,status:running|waiting|completed|failed|cancelled|unknown,resultRef?,pendingWorkRefs}`. Parent stop propagates to owned children but does not invent cancellation acknowledgement. |
| `lina-subagents-return` | Publish the child's settled result, limits/outcome and artifact references to its parent operation. Coordination to `SubagentResult {operationId,childId,status:success|failed|cancelled|unknown,resultRef?,artifactRefs,usageRef,childTraceRef}`. The parent decides how to use the result. |

Internal routes validate → prepare on `subagent.admitted`; prepare → launch on `subagent.packet-ready`; launch → coordinate on `subagent.started`; coordinate → return on `subagent.result-ready`. Tools dispatch → validate on `subagent.spawn-requested`; return → Tools collect on `subagent.operation-observed`. Validate → Safety evaluate on `safety.operation-requested` when launch requires approval. Launch → `lina-execution-start` on `subagent.turn-started`, with a child-owned turn/authority and origin discriminant. The child's settlement emits `subagent.execution-settled` to coordinate, bypassing external user reply delivery. Parent controls → coordinate on `subagent.control-requested`; child progress is observable without joining a model round early.

Initial spawn tool waits for its required child result and participates in the Tools batch join. Concurrent children are bounded independent operations. Detached persistent agents, agent-to-agent conversation, arbitrary recursive delegation and transcript forks are later branches requiring separate contracts.

```json
{"childId":"child-01","parentAgentId":"lina-main","taskRef":"task:inspect-tests","contextRefs":["project-instructions:demo:v1","artifact:test-output-01"],"historyMode":"isolated","toolPolicyRef":"tool-policy:read-only","memoryPolicyRef":"memory-policy:project-read","environmentProfileRef":"environment:shared-project-read","limits":{"maxRounds":4,"maxChildren":0}}
```

Simulation cases: one child, two independent children, child refusal, limited child context, read-only tool policy, child failure with successful sibling, stop propagated, unknown pending child effect. Reuse the same harness blocks under a selected agent-instance inspector; do not copy all graph nodes for every child.

## Recommended implementation order and decisions to review

1. Revisit current Context, Execution, Input and Tools ownership/contracts first. Their proposals should name the future endpoints above but must not draw executable edges into empty regions.
2. Model Interface, Safety and Output are direct extractions of responsibilities already delegated by the current graph. Implement their smallest successful paths before claiming the simulation covers them.
3. Add Subagents with isolated context and a required join. It uses existing blocks, with explicit parent/child identities and policies. Memory can remain unavailable or disabled until its own block exists.
4. Add Memory, State/recovery and Environment as coherent design slices with their matching failure branches. Their richer behavior needs separate research before choosing actual storage, retrieval or isolation technologies.
5. Add Observability projection alongside concurrent playback. Initial events can remain in-memory and exportable. Durable trace guarantees depend on State/runtime work.
6. Planning remains a required, not-yet-designed region; Computer Use remains deferred.

Review questions concern architecture, not missing operational detail: accept a separate Subagents block; require Planning while allowing simple-turn bypass; keep credential material inside the protected Tools credential service; keep Output delivery independent from execution settlement; preserve a single reused harness graph across agent instances. These choices make the new nodes implementable without turning every possible deployment concern into another box.

## Acceptance checklist for each accepted block

- [ ] Add only the reviewed IDs, labels, responsibilities and exact cross-block routes.
- [ ] Specify discriminated JSON schemas for every request, response, wait/control and failure route.
- [ ] Add paired valid examples for every output branch and producer-derived consumer input.
- [ ] Retain operation/agent/turn identities through waits, retries and sibling progress.
- [ ] Use one progression function for Auto and Next, with concurrent state where required.
- [ ] Inspect selected-node reachable paths and all contract JSON sections in the running graph.
- [ ] Test the meaningful cases listed for that block, including refusal/unknown branches where relevant.
- [ ] Mark simulated fixtures and unavailable runtime capabilities honestly.
- [ ] Update block notes and architecture/research indexes; preserve saved graph positions and user notes.

This is a review-ready boundary and graph-node proposal. It is not a claim that full provider protocols, memory strategies, storage backends or computer action schemas have already been specified or validated for runtime use.
