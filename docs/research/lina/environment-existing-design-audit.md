# Execution Environment: existing Lina design audit

Research date: 2026-10-08. Repository HEAD `f64bc6b7f7a2015039f898ab947aaa11a6bfd609`, including existing working changes. Repository primary-source audit and graph proposal. No runtime implementation or isolation claim.

## Accepted direction

Default to the current PC workspace. Commands and workspace file tools use the same selected environment. Configurable container or VM sandbox execution must never fall back silently to the host. Whole-harness deployment in a container or VM is a separate choice. Credentials, conversations, Memory and State are harness storage, not ordinary workspace files.

## Existing seams and gaps

| Repository source | Observed responsibility | Needed update |
| --- | --- | --- |
| [plannedBlocks.ts](../../../apps/web/src/features/lina/plannedBlocks.ts), [architectureDocument.ts](../../../apps/web/src/features/lina/architectureDocument.ts), [blockMembership.ts](../../../apps/web/src/features/lina/blockMembership.ts) | Empty Environment reservation near Tools; no maintained Environment nodes or membership. | Add populated block through assembly/layout while preserving saved positions and annotations. |
| [toolsCalls.ts](../../../apps/web/src/features/lina/contracts/toolsCalls.ts) | Dispatch carries `environmentRef`; local context names `environmentBindingSource: coordinator-fixture`. Schedule owns conflict keys, capacity and parallel waves. Collect owns batch joins and effect uncertainty. | Producer-derived environment binding replaces opaque fixture. Environment does not duplicate scheduling or whole-batch collection. |
| [toolsCapabilities.ts](../../../apps/web/src/features/lina/contracts/toolsCapabilities.ts) | Registry has adapter/account bindings and effect/concurrency policy. Plugin trust example explicitly says `in-process-no-sandbox-guarantee`. | Add trusted execution-domain metadata. Workspace sandbox selection does not isolate in-process plugin code. |
| [toolsConnections.ts](../../../apps/web/src/features/lina/contracts/toolsConnections.ts) | Stdio has configured executable/cwd, explicit secret refs, `inheritEnvironment: false`; Connect owns connection/process cleanup. | Bind server placement explicitly. Do not move host MCP servers into the workspace sandbox implicitly. Remote MCP/API effects occur at their server. |
| [subagentRecords.ts](../../../apps/web/src/features/lina/contracts/subagentRecords.ts) | Child configuration has `environmentRef` and cannot expand parent authority; ownership separates foreground/background/detached work. | Bind inherited/separate workspace and exact child lease. Child release cannot destroy shared parent resources. |
| [subagentHarness.ts](../../../apps/web/src/features/lina/subagentHarness.ts) | Child trace identities include namespaced artifacts/operations. | Shared environment/workspace IDs must stay shared; child operation/lease IDs are child-specific. Do not namespace all resource identities indiscriminately. |
| [safetyRecords.ts](../../../apps/web/src/features/lina/contracts/safetyRecords.ts) | Approval matches workspace/agent/tool/account/arguments/schema, but lacks exact environment generation/mount revision. | Bind approval and launch permit to effective target. Sandbox grant must never authorize host execution after retargeting. |
| [stateRecords.ts](../../../apps/web/src/features/lina/contracts/stateRecords.ts), [stateFixtures.ts](../../../apps/web/src/features/lina/stateFixtures.ts) | Operations retain launch/complete/unknown identity and external refs; checkpoints require artifacts. No lease/process registry. | Persist safe leases/process references and inspect original attempts during recovery. State remains persistence owner. |
| [shared.ts](../../../apps/web/src/features/lina/contracts/shared.ts), [inputExecution.ts](../../../apps/web/src/features/lina/contracts/inputExecution.ts) | Original attachment custody records immutable reference, digest, bytes and order before acceptance. | Stage selected originals into workspace with a separate copy manifest. Original custody remains authoritative. |
| [contextRecords.ts](../../../apps/web/src/features/lina/contracts/contextRecords.ts) | Observation projections retain raw artifact refs and distinguish inline/masked/referenced representations. | Export generated files before managed cleanup; Context owns model inclusion. A sandbox path alone is not a retained artifact. |
| [inputSimulation.ts](../../../apps/web/src/features/lina/inputSimulation.ts) | Arithmetic tool outcomes and artifact refs are controlled fixtures; no environment/process/session ledger. | Add deterministic environment evidence/cases without starting actual containers merely for graph playback. |

The earlier three-node Environment sketch in [revisit-planned-blocks.md](revisit-planned-blocks.md) identified the boundary, but hides filesystem consistency, retained processes, artifacts and uncertain acquisition. Replace that sketch with the reviewed richer proposal when implemented.

## Real controlled module already in this repo

[Execution Environment module](../../../studio/modules/execution-environment/README.md) is separate from Lina's graph. Its [contract](../../../studio/modules/execution-environment/src/contract.ts) has `describe`, `openSession`, `invoke`, `close`. Invocation retains operation/capability/version and optional idempotency key. Open/close can report uncertain resources; invocation can report completed/rejected/uncertain.

The implementation supports in-process arithmetic and a synthetic accessibility-tree computer fixture. It has no filesystem, subprocess, browser, network, container or VM adapter. [Configuration](../../../studio/modules/execution-environment/src/config.ts) grants no capabilities by default. Its README explicitly says synchronous fixtures do not exercise actual timeout or uncertain-effect behavior.

[Kernel](../../../studio/agent-kernel/src/text-turn.ts), especially `createScopedToolExecutor` and `verifyEnvironmentCapabilities`, opens a run session, checks Safety and granted capabilities independently, invokes the named operation, records receipts and closes during cleanup. Invocation exceptions become uncertain receipts. Cleanup does not reuse the aborted run signal. Preserve these boundaries. Persistent asynchronous processes and shared leases require richer adapters than the present single invocation receipt; do not claim the controlled module already implements them.

## Graph-ready proposal

Twelve nodes describe distinct services or lifetimes. They are branches, not twelve compulsory steps for every action.

| ID and responsibility | Inputs | Output variants and invariants |
| --- | --- | --- |
| `lina-environment-profile`: resolve execution profile | Trusted owner-scoped profile/revision and requested operation domain. | Effective backend `local|container|vm|remote`, capability/resource/network policy and separate harness placement; invalid/unsupported. Local means no claimed isolation. |
| `lina-environment-workspace`: resolve workspace | Profile, configured root, inherited/separate request and declared mounts. | Canonical root/path mapping, sharing/conflict key, ownership `attached-user|managed`, mount modes/revision; refused/unavailable. Host and environment paths differ. |
| `lina-environment-acquire`: acquire lease | Workspace plan, profile, stable acquisition ID/fingerprint, expected generation and scope `session|agent|shared`. | Ready lease, provisioning wait, known failure or unknown creation. Changed fingerprint conflicts. Backend creates/attaches actual container/worker resources. |
| `lina-environment-ready`: verify readiness | Lease and actual backend observations. | Immutable binding with supported capabilities, runtime/image/dependency revision, root/cwd/mounts, enforced limits and generation; unavailable/degraded/unsupported. Requested limits never imply backend enforcement. |
| `lina-environment-stage`: stage admitted inputs | Ready binding, selected original custody refs/digests, destination mapping, byte/collision policy. | Staging manifest, unnecessary/skipped, known error/refusal, partial/unknown copy. Keep original custody. Model text cannot request arbitrary host-file import. |
| `lina-environment-files`: perform workspace file operation | Typed `read|list|search|write|edit|delete|stat`, exact target binding, final args, launch permit and optional expected digest/revision. | Known bounded result/artifact, conflict, rejection/error/cancelled or unknown write. Enforce actual path/symlink/mount access at backend boundary. Commands and file tools share root. |
| `lina-environment-start`: start command/process | Admitted command intent, shell/argv variant, cwd, explicit private environment refs, deadline/output limit, original launch ID and permit. | Foreground result, persistent process handle, known-unstarted failure or unknown launch. PID alone is not stable identity across restarts. |
| `lina-environment-process`: observe/control process | Owned handle and typed `poll|stdin|signal|terminate|resize`, or correlated output/exit event. | Bounded progress, running handle, known exit, unsupported/stale/rejected control or unknown state. Output cursor and backend generation reject stale updates. |
| `lina-environment-collect`: return environment observation | File result, process result/progress or provisioning observation. | Per-request nonterminal wait, terminal adapter evidence or unresolved operation to retained requester. Tools still joins the batch. |
| `lina-environment-artifacts`: retain selected outputs | Selected path refs, expected digests, export policy and artifact-store target. | Manifest with stable ID, origin environment/path/operation, digest/bytes/MIME and retention/custody; partial/error/unknown export. |
| `lina-environment-reconcile`: inspect original resources | Original acquisition/launch/control/export identity, backend generation and allowed inspection method. | Found running/settled/no-effect, still unknown, unavailable/lost/stale. Inspection cannot relaunch. Exit does not establish rollback of filesystem writes. |
| `lina-environment-release`: release owned resources | Exact lease owner, retain/detach/cleanup policy, active processes, exports and shared leases. | Retained/released lease, cleanup pending/complete/failed/unknown. Never delete user-attached workspace. Stop targets owned work, not unrelated resources. |

Optional sandbox browser provisioning belongs to Acquire/Ready as a companion resource with session/endpoint/network/mount refs. Actual browser observation/action stays deferred Computer Use. Provisioning does not import the host browser profile or credentials automatically.

## Connections ready for graph design

- Tools Resolve requests target/profile/workspace metadata before target-dependent permission checks and conflict scheduling. Pure/remote API domains can bypass workspace execution. Return metadata to the same resolver continuation.
- Tools Dispatch rechecks Ready with exact binding generation and launch permit, then routes to Files/Start/Process by registered operation. Environment Collect returns the same call/batch/attempt to Tools Collect. No second scheduler or join.
- Subagents Prepare requests inherited or separate workspace/lease and freezes the effective binding in the child packet before Launch. Workspace sharing and context copying are separate settings.
- Input admitted custody or child preparation requests Stage for selected attachment/artifact copies. Stage returns a manifest to that preparation, not a new ingress event.
- Execution Cancel reaches exact process controls through the owning tool/environment adapter. Actual cancellation evidence returns to Tools Collect. Execution remains turn cancellation owner.
- Input Reconcile requests Environment Reconcile for the retained original operation and receives inspection evidence. Environment does not release turn authority itself.
- State Recover requests original-process/resource inspection and authorized lease reacquisition; completed or unknown effects do not get fresh launches. State selects continuation.
- Lifecycle writes/readbacks use State Record/Load. Unknown commit acknowledgement inspects the same transaction ID.
- Execution Release and child terminal owners request required Artifact export then lease Release. Retained sessions may release one lease without destroying the environment. Detached work retains explicit supervisor ownership.
- Tools Connect requests environment process hosting only for stdio servers explicitly configured there. Tools owns protocol/auth handles; Environment owns process lease. Plugin execution placement stays explicit.
- Skill Resources may Stage admitted executable helpers/resources. Trusted skill instruction loading stays the configured loader, not automatically workspace tools.

Internal setup is Profile → Workspace → Acquire → Ready, with optional Stage. Ready → Files/Start is request-driven. Start → Process applies to retained sessions, otherwise → Collect. Files/Process → Collect reports an operation. Unknown acquisition/launch/export/cleanup → Reconcile returns to the original continuation. Artifacts → Release only when required exports are satisfied.

## Contracts to add or extend

Environment profile/binding needs configuration owner, backend, profile/image/template revision, capability set, exact root/cwd/mounts, network/resource restrictions, and which restrictions are enforced. Distinguish harness placement from action placement.

Lease records need acquisition ID/fingerprint, environment ID/generation, lease ID, ownership scope, status, expiry/retention, cleanup owner and safe backend handle ref. Operation records retain tool batch/call/attempt/launch IDs, environment/workspace generations, final argument digest, permission and exact launch permit, cancellation owner and deadline.

Process handles need logical process/session ID, backend instance generation, original launch identity, owner/supervisor, status, output cursor, exit evidence and effect certainty. File results need resolved path refs, digest/revision when available, bounded content/truncation, bytes and write certainty. Shell success is not a complete file revision ledger.

Artifact manifests need origin environment/workspace/path/operation, safe content ID, digest/bytes/MIME, trust and retention/export status. Original ingress custody remains separate from a staged working copy. Control requests target exact owner/generation and retain stable ID; cancellation sent is not cancellation acknowledged.

Extend Safety reviewed scope/currentness with effective environment/workspace generation and mount revision. Tools conflict keys must identify the effective shared filesystem. Two containers mounting the same writable directory can conflict despite distinct environment IDs.

State adds scoped lease/binding, process intent/handle/outcome, staging/export manifest and cleanup records. Checkpoints retain refs to outstanding owned work, not live executable clients or raw secrets. Recovery marks missing handles unavailable and inspects original effects.

## Simulation cases

1. Local attached workspace, reads and commands see the same files.
2. Container copied workspace, admitted attachment digest retained, edits isolated.
3. Read-only mount rejects writes before effect.
4. Writable shared mount, parent/child revisions visible; Tools serializes incompatible writes.
5. Separate child environment/lease, parent cleanup respects child ownership.
6. Missing backend/dependency reports unavailable, no host fallback.
7. Provision wait/known failure/lost creation ack, inspect same acquisition ID.
8. Foreground exit and retained process across polls/stdin.
9. Bounded output truncation with explicit raw artifact retention.
10. Stale backend generation/out-of-order process event rejected.
11. Stop before launch, during known work, or with unknown filesystem effect.
12. Restart reconnects to surviving process without rerunning settled work; lost worker does not prove no effect.
13. Partial input staging preserves originals and exposes completed copies.
14. Required export before cleanup; failed/unknown export blocks destructive cleanup.
15. Local attached root remains intact after release.
16. Detached child retains supervisor lease after parent completion.
17. Pure/remote tool bypass and explicit host versus sandbox stdio placement.
18. Optional browser companion provisioned; browser actions remain deferred.

Auto, Next and manual graph following use one reducer. Leases/processes/generations/manifests appear as expandable JSON evidence. Synthetic outputs are not Docker health or benchmark measurements.

## Remaining defaults to settle

Suggested baseline is session reuse, inherited parent environment with child-specific lease, attached local ownership, managed copied sandbox workspace, explicit mount exceptions, owned-process cancellation and required exports before cleanup. Writable sharing and isolated child workspaces remain configurable. Document whether explicitly authorized local paths outside cwd are supported, configured MCP stdio placement, and artifact retention. These are configuration/default decisions, not reasons to add a mandatory model-planning loop or duplicate Tools/Safety nodes.
