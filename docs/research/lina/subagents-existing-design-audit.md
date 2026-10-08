# Subagents: current Lina design audit

Audited 2026-10-08. This report examines repository source, contract examples and scripted simulation, rather than claiming a live Lina runtime. The current graph has 112 nodes and 400 edges. Subagents remains an empty reserved block.

## What already exists

The earlier [planned-block revisit](revisit-planned-blocks.md#subagents-five-nodes-proposed-new-block-and-region) proposed five nodes: Validate, Prepare, Launch, Coordinate and Return. It chose model-led delegation through a registered tool, selected child context, required result joining and bounded independent children. That is a useful starting point, but it predates the completed Model, Safety, State and Memory slices. Its State and Memory sketches are superseded by their dedicated studies.

| Existing responsibility | Source | What can be reused |
| --- | --- | --- |
| Reserved Subagents region | [`plannedBlocks.ts`](../../../apps/web/src/features/lina/plannedBlocks.ts), [`blockLayout.ts`](../../../apps/web/src/features/lina/blockLayout.ts) | Keep this block identity and layout region; replace its placeholder with actual design nodes. |
| Main model/tool loop | [`executionBlock.ts`](../../../apps/web/src/features/lina/executionBlock.ts), [`contracts/turnExecution.ts`](../../../apps/web/src/features/lina/contracts/turnExecution.ts) | Child instances should reuse Start, Limits, Prepare, Model, Decide, Tools, Controls, Recover and Settle. Model attempts and logical rounds are already separate. |
| Registered capability admission and bounded parallel scheduling | [`toolsBlock.ts`](../../../apps/web/src/features/lina/toolsBlock.ts), [`contracts/toolsCalls.ts`](../../../apps/web/src/features/lina/contracts/toolsCalls.ts) | Spawn is an internal registered capability. Resolve, Validate, Permissions, Schedule and Dispatch remain the front door. Children are not a direct Model bypass of Tools. |
| Isolated child Context contract example | [`contracts/contextRecords.ts`](../../../apps/web/src/features/lina/contracts/contextRecords.ts), [`contracts/contextAssembly.ts`](../../../apps/web/src/features/lina/contracts/contextAssembly.ts), [`linaRevisitContracts.test.ts`](../../../apps/web/tests/linaRevisitContracts.test.ts) | Scope already carries `parentAgentId`, `inheritanceMode`, `taskPacketRef`, excluded sources, memory namespaces and account binding references. The child example has its own history and selected sources. This is a schema example, not a spawned child. |
| Child result Context projection | [`contracts/contextRecords.ts`](../../../apps/web/src/features/lina/contracts/contextRecords.ts) | `observationProjection.childResultRef` can retain a child result artifact through ordinary tool feedback. Raw child histories need not be injected into parent context. |
| Model selection and replay isolation | [`contracts/modelRecords.ts`](../../../apps/web/src/features/lina/contracts/modelRecords.ts), [`modelFixtures.ts`](../../../apps/web/src/features/lina/modelFixtures.ts), [`linaModelFixtures.test.ts`](../../../apps/web/tests/linaModelFixtures.test.ts) | Model binding recognizes `subagent-config`; opaque replay binds agent/account/protocol/history identities. Existing compatibility checks reject another agent's replay. |
| Safety grant delegation ceiling | [`contracts/safetyRecords.ts`](../../../apps/web/src/features/lina/contracts/safetyRecords.ts), [`contracts/safetyPermissions.ts`](../../../apps/web/src/features/lina/contracts/safetyPermissions.ts) | Grants and reviewed scopes default to `delegateToChildren: false`. Launch permission and child operation permission are separate. A spawn request cannot grant itself tools or account access. |
| Persisted child placeholder | [`contracts/stateRecords.ts`](../../../apps/web/src/features/lina/contracts/stateRecords.ts) | `child-task` exists, with parent turn, task ID, status and result reference. It explicitly says runnable orchestration is absent. Extend this record instead of creating a second unrelated child registry. |
| State request/response continuation | [`stateBlock.ts`](../../../apps/web/src/features/lina/stateBlock.ts), [`contracts/statePersistence.ts`](../../../apps/web/src/features/lina/contracts/statePersistence.ts) | Load/Record/Checkpoint return to their original requester phase. Add precise child phases; do not let unknown phases use generic operation-intent defaults. |
| Child Memory access and reviewed publication | [`memoryBlock.ts`](../../../apps/web/src/features/lina/memoryBlock.ts), [`contracts/memoryRecords.ts`](../../../apps/web/src/features/lina/contracts/memoryRecords.ts), [`contracts/memoryKnowledge.ts`](../../../apps/web/src/features/lina/contracts/memoryKnowledge.ts), [`memoryFixtures.ts`](../../../apps/web/src/features/lina/memoryFixtures.ts) | User-private, workspace-shared, agent-private and task-local namespaces already exist. Child shared reads require explicit access. Shared writes require parent candidate review. This currently uses supplied child fixtures, not an actual child execution. |
| Existing operation waits, cancellation and uncertainty | [`inputSimulation.ts`](../../../apps/web/src/features/lina/inputSimulation.ts), [`executionBlock.ts`](../../../apps/web/src/features/lina/executionBlock.ts) | Preserve exact operation ownership, settled siblings and unknown effects. Add a child owner variant to retained waits and route answers/control to that owner. |

## Where the present contracts are incomplete

### Internal task origin

`contracts/shared.ts` defines `admitted` through a transport-backed `work` record containing accepted inputs. Execution candidate output also carries an input destination. A child task is internal work and has no CLI/Telegram/WhatsApp envelope of its own.

Add an explicit execution-origin union. Keep the current user-input branch and add an internal child-task branch with parent operation, task-packet reference and child identity. Both feed the same turn initialization invariants. Do not manufacture a transport receipt or user conversation queue admission for a child.

### Agent-owned execution and settlement

The current Execution graph assumes Settle can hand output to `lina-input-delivery`, and Release can notify `lina-input-queue`. Child settlement needs a different destination. The child must first account for required work and persist its result; its completion then returns to Subagents. It must not deliver a second answer to the external user or advance the parent's input queue.

Retain a child-owned turn/fence and a distinct history branch. The parent and child may share a workspace by explicit policy, but they do not share a live turn owner, model replay state, mutable Context candidate or automatic permission grant. Child release concerns the child's owner; parent release remains blocked by the parent's declared required obligations.

### More than a child-task reference

The current State `child-task` record has only `submitted`, `running`, `complete`, `unknown`, a parent turn and result reference. It cannot reconstruct a failed child, cancellation request, launch acknowledgment ambiguity, join subscription or rejected late result.

Extend it with child agent/turn IDs, parent agent/turn/operation/call IDs, immutable task-packet revision/digest, lifecycle revision, launch identity, local/remote handle reference, configured limits, terminal status/reason, result and artifact references, pending obligations, cancellation state and accepted event sequence. Store safe references, not credential material or unrestricted copies of parent context.

Add explicit State command phases for spawn intent, accepted launch, progress, terminal result, join subscription and cancellation. Child checkpoints must retain their own execution counters and pending work. Parent checkpoints must retain the child handles and join obligations needed to resume the parent. A parent restart must inspect original launch evidence before spawning again.

### Simulation state is currently one agent

`SimulationState` has one model work item, one active Model fixture, one set of logical round/attempt counters and one Context snapshot reference. `compileFixture` constructs a fixed `lina-main` request. `activeSimulationNodes` accounts for operations and model work but has no agent instance identity. Child Memory cases do not change this.

A child simulation requires an instance map keyed by agent ID, plus an ordered event stream whose events identify agent/turn/operation. Each child owns execution, model, Context, tool operations, memory-access policy, waits and counters. Parent aggregate resource accounting should be separate from each agent's logical rounds. The graph definitions remain shared. Clicking an agent instance selects its state and path; it does not create a duplicate set of architecture nodes.

Auto and Next should advance the same deterministic reducer. Multiple instances may remain active while a single event cursor advances. Arrival order is an explicit fixture property, not wall-clock performance evidence. Reset must reset all instances and subscriptions together; Stop must preserve acknowledged writes and accepted child results.

## Proposed nodes

These IDs are proposals, not existing nodes. Eight nodes make the broad orchestration responsibilities visible without rebuilding Context, Memory, Tools or State inside Subagents.

| Proposed ID | Responsibility | Inputs and outputs |
| --- | --- | --- |
| `lina-subagents-validate` | Admit a spawn request against current parent authority, available child capacity, delegation depth and permitted configuration. | `SubagentRequest` to admitted/rejected decision and effective policy references. Keep original call/operation identity. |
| `lina-subagents-prepare` | Build the immutable child task packet and initialize isolated child history and scope. | Admission plus explicitly selected sources to `ChildTaskPacket`, or failed preparation. Context remains responsible for actual model-visible assembly. |
| `lina-subagents-launch` | Record launch intent, recheck authority and start or attach the exact child execution instance. | Task packet and stable launch identity to acknowledged handle, known-unstarted failure or unknown launch status. State acknowledgment alone does not establish that the child started. |
| `lina-subagents-coordinate` | Accept correlated child progress/terminal events and retain child registry lifecycle state. | Child handle plus events to revisioned status, accepted terminal evidence, duplicate/stale-event disposition and join notifications. Progress is not completion. |
| `lina-subagents-join` | Evaluate the parent's requested wait policy against a declared child set and retain an exact continuation. | Child handles/statuses and a join request to ready results, retained wait, timeout or cancellation disposition. This is a child-result join; Tools Collect still joins all tool calls in a model batch. |
| `lina-subagents-cancel` | Request cancellation of exact owned children and account for pending or acknowledged cancellation. | Parent Stop, explicit child cancel or deadline policy to signals and lifecycle evidence. Do not erase known results or claim effects were undone. |
| `lina-subagents-reconcile` | Inspect uncertain child launch, ownership or settlement and return evidence to the existing execution reconciliation decision owner. | Original launch/child identity and State/runner evidence to running, known-unstarted, terminal or still-unknown. This node cannot silently retry an uncertain child. |
| `lina-subagents-return` | Publish a bounded settled result or acknowledged handle to the exact parent request. | Joined/settled child evidence to call-ID matched result, or async handle acknowledgment. Preserve task/result provenance, artifact references, terminal reason and usage attribution. Parent Context controls inclusion. |

Node-count alternatives are reasonable. Five nodes can fold Join, Cancel and Reconcile into Coordinate, retaining all contracts. That produces fewer boxes but a large coordinator inspector. Seven can fold Join into Coordinate when only synchronous spawn is implemented. Eight suits a block that also describes background children, parent continuation, explicit wait and cancellation. A separate ninth cleanup node is justified only if a real runner owns disposable child resources that cannot be accounted within settlement. A separate policy/model-selection/context/memory node would duplicate existing owners.

## Existing graph handoffs to extend

The following are endpoint proposals. Every edge must carry parent and child correlation rather than a generic status string.

| Source | Target | Meaning |
| --- | --- | --- |
| `lina-tools-register` | Existing Tools catalog flow | Register internal spawn, wait/status and cancel capabilities with declared schemas and policy/effect metadata. This does not require a new Subagents catalog owner. |
| `lina-tools-dispatch` | `lina-subagents-validate` | Scheduled registered spawn request. Tools keeps parent call and batch ownership. |
| `lina-subagents-validate` | `lina-safety-evaluate` | Current operation-specific admission request when child launch requires Safety evaluation. Avoid a second independent approval workflow. |
| `lina-safety-authorize` | `lina-subagents-validate` or `lina-subagents-launch` | Correlated policy decision and launch authority recheck. Use distinct continuation phases for initial admission and final launch. |
| Validate | Prepare | Admitted request and narrowed policy. |
| Prepare | Launch | Immutable child task packet. |
| Launch | `lina-execution-start` | Internal-origin admitted child turn, with its own owner and fence. |
| Child `lina-execution-prepare` | Existing Context route | Context assembly under child identity, fresh child history and admitted task packet. No direct Prepare-to-Context shortcut is needed. |
| Child `lina-execution-settle` | `lina-subagents-coordinate` | Child terminal evidence once required child work is accounted. Keep user delivery routing for the parent branch only. |
| Child `lina-execution-release` | `lina-subagents-coordinate` | Child owner release acknowledgment. It does not notify the parent input queue. |
| Launch/Coordinate | Join | Retained handles and accepted completion notifications. |
| Join | `lina-execution-wait` | Register a retained child-result wait; exact parent turn, join revision, child set and continuation owner. |
| `lina-execution-wait` | Join | Matched readiness/expiry/control event resumes the original wait operation. Child completion is not arbitrary user prompt text. |
| `lina-tools-dispatch` | Join/Coordinate/Cancel | Registered wait/status/cancel operations on caller-owned child handles. Resolve/Validate/Permissions apply first. |
| `lina-execution-cancel` | Cancel | Parent Stop propagates according to declared child ownership policy. |
| Cancel | Child `lina-execution-cancel` | Exact-child cancellation under child authority; child Tools/Model cancellation remains with their existing owners. |
| Launch/Coordinate/Cancel | Reconcile | Unknown launch or unresolved local child accounting. |
| Reconcile | `lina-input-reconcile` | Evidence and remaining obligations for the existing execution reconciliation decision owner. The historical ID belongs to Turn Execution, despite its `input` prefix. |
| Join/Coordinate | Return | Synchronous terminal result or configured asynchronous handle acknowledgment. |
| Return | `lina-tools-collect` | Parent call-ID matched result. Collect and Publish still perform parent batch accounting and feedback. |
| Subagents lifecycle requesters | `lina-state-load` / `lina-state-record` | Phase-specific reads, conditional transactions and original launch inspection. Responses return to the same requesting phase. |

Memory does not need a direct Spawn-to-Memory shortcut. Child Context recall already passes `lina-context-load` to `lina-memory-scope`. Child explicit memory operations already pass `lina-tools-dispatch` to Memory Scope. Shared publication returns through the existing Memory parent review wait. Subagents supplies the child identity, admitted namespaces and parent provenance to those routes.

## Required contract details

The implementation should extend these existing files at their owner boundaries:

| File | Required change |
| --- | --- |
| `contracts/shared.ts`, `contracts/turnExecution.ts` | Internal child execution origin, child-specific terminal/release destination and agent-owned identities. Preserve current external-input variants. |
| `contracts/toolsCapabilities.ts`, `contracts/toolsCalls.ts` | Declared internal spawn/wait/status/cancel capability schemas and call continuations with safe child handle references. |
| `contracts/safetyRecords.ts` | Add Subagents operation owner variants and reviewed child policy/profile fingerprints. The current `ownerNodeId` choices are Tools-specific. Retain explicit nondelegable grant defaults. |
| `contracts/stateRecords.ts`, `contracts/statePersistence.ts`, `stateBlock.ts` | Richer `child-task` records, tagged Subagents request phases, child ownership/launch inspection, join obligations and checkpoint restoration. |
| `contracts/contextRecords.ts`, `contracts/contextAssembly.ts` | Reuse selected task-packet scope and child-result projections; add precise incoming child preparation examples bound to the new child origin. |
| `contracts/modelRecords.ts`, `modelFixtures.ts` | Preserve child-owned identity and profile selection through binding/readiness/invocation/replay; keep child and parent accounting distinct. |
| `contracts/memoryRecords.ts`, `memoryFixtures.ts` | Bind the existing child cases to actual child instance identity and admitted memory policy instead of an unattached supplied child fixture. Keep publication review under Memory ownership. |
| `inputSimulation.ts`, `stateFixtures.ts`, `LinaSimulation.tsx`, `LinaPage.tsx` | Per-agent state projection, exact child-owned waits, deterministic event routing, selected instance inspector, active child paths and checkpoint restoration. Keep Auto/Next and manual exploration controls. |

Use distinct identity fields instead of making `childId` mean a task, agent, launch and turn at once. A minimum spawn request carries `operationId`, parent `agentId`, `turnId`, `roundId`, `batchId`, `callId`, expected owner revision/fence, task reference, selected source references, requested child profile, memory/tool/account/environment policy references, configured depth/capacity/round/attempt/time budgets and completion mode. Synthetic identifiers are references, never authorization.

The admitted child profile is the intersection of requested access and host policy. A parent grant does not become a child grant merely because it launched the child. Shared workspace access is an explicit environment choice and does not prove process or filesystem isolation. Current Environment is an empty planned block, so this implementation must report that limitation rather than claim sandboxing.

Carry immutable source revisions/digests in task packets. Preserve an explicit empty packet as different from failed source acquisition. Do not inherit parent-private conversation by default. A child's own Context budget can prune admitted task evidence while retaining a reproducible record of what it included. Parent provider replay references cannot be attached to a fresh child route.

Child result contracts distinguish completed, failed, exhausted, cancelled and unresolved/unknown. A timed-out parent wait may coexist with a still-running child. A returned cancellation acknowledgment may still carry a separate unresolved effect obligation. Results include original child task, child turn, result revision, artifact references and child trace reference; raw transcripts are a separate explicit retrieval action.

For asynchronous launch, Return publishes a handle acknowledgment, not a terminal result. A later wait request owns the terminal result observation. Bind subscriptions to parent operation/turn and join revision. A late child result after parent settlement belongs in retained child records and diagnostics until an authorized current parent continuation consumes it. It must not revive a stopped parent, append an orphan tool result or launch a new parent model round.

## Simulation coverage required by this audit

The initial cases should include one child, independent siblings with overlapping activity, a successful sibling plus failed child, denied spawn, selected child Context, refused private Memory, child tool approval, a parent continuing after asynchronous launch, explicit wait on existing handles, result arrival after wait timeout, parent Stop before launch, Stop during child tool work, cancellation acknowledgment versus unknown effect, duplicate terminal result, wrong-parent/stale launch event, lost launch acknowledgment, restart with a running child, restored join wait and parent-reviewed child memory publication.

Some cases are relationships between blocks rather than extra Subagents nodes. Reuse existing child Context, Model, Safety, Memory and State scenarios under an actual child instance. Tests must establish that parent counters and replay state do not change when a child model request starts, child results retain parent call pairing, and late/duplicate events cannot resurrect completed work.

This proposal describes graph contracts and deterministic design playback. A later live runner must implement storage, process/session ownership and real operation cancellation. The graph and fixtures should remain honest about that boundary while being precise enough to guide the runner implementation.
