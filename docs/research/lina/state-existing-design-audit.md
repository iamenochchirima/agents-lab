# State, persistence and recovery: existing Lina and runtime audit

Date: 2026-10-08. Scope: repository source as inspected at base commit `ab2cadd74b30b645f586d7019a17d0d24f9b4916`, including current uncommitted Lina design changes. This is research and a graph proposal. It does not add a runtime storage backend or establish crash guarantees.

## What exists now

Lina reserves an empty **State, persistence and recovery** region. Its maintained document assembles Input, Turn Execution, Context, Tools, Model and Safety only. The four State nodes are a saved proposal, not graph nodes. See [reserved regions](../../../apps/web/src/features/lina/plannedBlocks.ts), [maintained document](../../../apps/web/src/features/lina/architectureDocument.ts) and [previous State proposal](revisit-planned-blocks.md#state-persistence-and-recovery-four-nodes-new-block-development).

Several current contracts already depend on persistence. They explicitly describe proposed stores or fixture behavior. The Input route has `lina-input-claim`, `lina-input-accept`, `lina-input-queue`, `lina-input-claim-recovery` and `lina-input-recovery`. Acceptance requires acknowledged persistence; uncertain acceptance must inspect the original claim rather than create another input. Execution has retained waits and release boundaries. Safety's grant records explicitly say the current grant store is a deterministic fixture and production atomic enforcement is absent. See [Input contracts](../../../apps/web/src/features/lina/contracts/inputExecution.ts), [Safety contracts](../../../apps/web/src/features/lina/contracts/safetyPermissions.ts) and [Safety record types](../../../apps/web/src/features/lina/contracts/safetyRecords.ts).

The simulation's waits, results, operation states and grant fixtures live in a browser reducer. Its restart scenarios do not prove that a real process can reconstruct those records. The editable architecture document is saved separately. See [simulation reducer](../../../apps/web/src/features/lina/inputSimulation.ts) and [architecture editor](../../../apps/web/src/features/lina/LinaPage.tsx).

## Actual repository persistence, with limits

| Existing owner | Observed mechanism | What it does not establish for Lina |
| --- | --- | --- |
| [Studio API LinaStore](../../../apps/studio-api/src/http/lina.ts) | SQLite WAL, `synchronous = FULL`, one architecture document, revision comparison and replacement in one `BEGIN IMMEDIATE` transaction. Lost PUT receipt requires GET before retry. | This stores graph authoring, not agent execution, grants, tool waits or checkpoints. |
| [Studio API ComparisonStore](../../../apps/studio-api/src/http/comparison-store.ts) | SQLite manual comparison notes; an import is transactional. | These notes are research authoring, not recovered runs. |
| [Studio comparison domain state](../../../server/src/studio/domain/state.ts) | Validates allowed transitions between comparison statuses. | The filename `state.ts` is not a persistence implementation. |
| [Studio evidence store](../../../server/src/studio/adapters/evidence-store.ts) | Config/events/trial evidence and idempotency reservations; exclusive create for idempotency, temporary-file rename for JSON records. | No reusable Lina operation journal or coherent full-agent checkpoint follows from these files. |
| [Studio comparison service](../../../server/src/studio/application/comparison-service.ts) | Active controllers/promises are an in-memory map. Inspection of a started comparison without a live owner reports `recovery_required` if no terminal result exists. | It does not automatically resume an interrupted comparison's loop. |
| [ContextSessionStore](../../../server/src/capabilities/context/session-store.ts) | Persistent session metadata, transcript, turn records and context snapshots; session revision, stable `clientTurnId`, active-turn checks, per-session in-process serialization and a filesystem lock. It repairs specific partially admitted turns. | Multi-file writes happen sequentially through per-file rename. This is not an atomic multi-record checkpoint or a demonstrated distributed execution fence. A filesystem lock is not authority checked by remote tools. |
| [Studio Memory repository](../../../server/src/studio/memory/repository.ts) | Operation IDs and fingerprints, journal-before-snapshot ordering, recovered latest state from journal, serialized access per repository instance, explicit crash hooks. | This recovers Memory mutations. It does not recover the whole execution loop or unknown tool effects. Instance serialization is not a multi-process storage contract. |
| [Control-plane evidence](../../../server/src/control-plane/application/evidence-store.ts) and [RunService](../../../server/src/control-plane/application/run-service.ts) | Retain a platform execution reference; inspect through the selected runner, persist refreshed native identity, resume through an optional runner method. Missing identity leads to reconciliation; provisional reconciliation results can become confirmed terminal results. | Native durability remains owned by the platform implementation. These normalized evidence records do not reproduce every platform checkpoint or give Lina a durable scheduler. |
| [Protected OAuth store](../../../server/src/capabilities/integrations/oauth/encrypted-file-store.ts) | A separate encrypted credential store with safe references outside the secret boundary. | Ordinary State records must not duplicate token material into checkpoints, manifests or traces. |

The inspected filesystem implementations do not make explicit file/directory `fsync` calls. Temporary rename helps readers see a whole file, but this audit does not infer power-loss durability or a transaction across several renamed files. SQLite's configured durability is a separate implementation choice. No change of storage dependency is proposed here.

## Keep the four semantic nodes

The current four-node proposal is enough if its contracts expose coordination and commit outcomes precisely. Input and Execution keep their lifecycle ownership. State provides persistence and conditional updates for them.

| Node ID | Proposed refinement | Required outcomes |
| --- | --- | --- |
| `lina-state-load` | Read a declared record kind, scope and revision, or inspect a previous transaction by stable identity. History reads have a bounded selection, rather than loading all history. | `found`, `missing`, `incompatible`, `corrupt`, `unavailable`; a missing record is distinct from a failed read. |
| `lina-state-record` | Persist immutable observations and conditional mutable records. Commands include input receipt commit, queue insert/remove, owner acquire/renew/release, grant transaction and operation intent/result. Owner updates compare the expected revision/fence. | `applied`, `already-applied`, `conflict`, `failed`, `unknown`; duplicate ID with changed contents is conflict. Acknowledgment names the persisted revision. |
| `lina-state-checkpoint` | Commit a versioned manifest whose exact referenced records form a coherent resumable position. Distinguish saving fragments from publishing a usable checkpoint. | `committed`, `already-committed`, `incomplete`, `conflict`, `failed`, `unknown`. Only committed checkpoints become recovery candidates. |
| `lina-state-recover` | Validate compatibility and referenced records, inspect unresolved writes/effects, reacquire fenced execution ownership, revalidate current bindings, then propose a resume plan to the existing coordinator. | `resume`, `restore-waits`, `reconcile`, `required-review`, `reject`; no physical dispatch directly from this node. |

This recommendation retains the four existing IDs. A fifth **Acquire execution ownership** node becomes justified if the design needs to expose claim/renew/release as a separately configured coordination service, with its own failures and scheduling policy. That responsibility is real, but the graph already assigns admission, reclaim and release decisions to Input/Execution. Initially give those owners explicit conditional State commands rather than silently adding another competing coordinator.

## Records and their owners

| Record family | Semantic owner | Stored facts |
| --- | --- | --- |
| Input claim and acceptance receipt | Input claim/acceptance | Transport event identity, original route, input ID, claim revision, custody references, committed acceptance, status. Dedupe is not based on identical text. |
| Queue membership and dispatch progress | Input queue/dispatcher | Queue entry identity, stable ordering, work references, eligibility, paused state, claim progress. Do not release/remove a queue entry before its successor ownership is established. |
| Conversation execution owner | Input admission plus Execution release/cancel/reconciliation | Turn ID, owner revision, monotonically increasing execution fence, lease/ownership state, unresolved-work references. Lease expiry by itself does not prove an external effect never happened. |
| Transcript/history and context snapshot | Context and turn settlement | Original message IDs, accepted assistant/tool records, revisioned history, selected snapshot/artifact references, transformation provenance. A saved Context snapshot is not fresh authorization or provider readiness. |
| Pending wait | Execution retained-wait owner | Wait/prompt IDs and revisions, exact operation owner, request binding, eligible responder references, expiry, safe continuation reference, terminal/consumed status. Persist registration before asking externally. |
| Permission grant/reservation | Safety grants | Reviewed matcher and scope, grant/session generations, transaction ID, consumed/reserved attempts, revocation. No account token. Persistent grants require acknowledged commit. |
| Tool/model/delivery intent and observation | Respective effect owner | Logical operation ID, physical attempt/launch ID, exact request fingerprint, bound account/capability generation, launch state, result/uncertainty and external reference when available. A recorded intent does not prove a launch, or prove absence of a launch. |
| Checkpoint | Execution coordinator through State | Schema and implementation compatibility, record revisions, next safe entry, counters, terminal intent, active/waiting/unresolved work, settled sibling references, Context snapshot. |
| Learned knowledge | Memory | Memory owns retrieval relevance and mutation policy. State may provide storage acknowledgment; recovery must not interpret remembered facts as execution receipts. |
| Trace, metrics and exported evidence | Observability | Safe projections and original evidence references. A playback trace is not automatically authoritative execution state. |

State can persist several families in the same physical backend without merging their permissions or semantics. Artifact references can point to a separate blob store; the checkpoint must validate required blob presence/digest before claiming it is complete. Retention must not delete required recovery evidence while live work references it.

## Proposed edges and return ownership

These are additions to the graph, not existing routes. Every State request must carry `requestId`, requester node, original operation identity, scope, expected revision/fence and a phase-discriminated return context. An acknowledgment resumes that exact requester; it does not start a new turn.

| Request edge | Return edge and branch |
| --- | --- |
| `lina-input-claim` → `lina-state-record` | Record → claim, conditional dedupe claim result. Existing duplicate/claim-recovery branches remain. |
| `lina-input-accept` → `lina-state-record` | Record → accept, acknowledged receipt/accepted record or failed/unknown. Existing failure path cannot claim acceptance when unknown. |
| `lina-input-duplicate` or `lina-input-claim-recovery` → `lina-state-load` | Load → same requester, original receipt/custody evidence; do not reroute an old input to today's conversation mapping. |
| `lina-input-queue` → `lina-state-record` / `lina-state-load` | Return to queue for stable membership/selection; emitted work still returns to existing admission. |
| `lina-input-admission`, `lina-execution-release` → `lina-state-record` | Return to same owner for fenced acquire/release. Known release alone permits the existing `lina-execution-release` → `lina-input-queue` lifecycle notification. |
| `lina-execution-wait` → `lina-state-record` | Record → wait, registered/consumed/cancelled revision. Existing `lina-execution-wait` → `lina-safety-approval` registration acknowledgment happens only after required save succeeds. |
| `lina-safety-grants` → `lina-state-load` / `lina-state-record` | Return to grants with transaction evidence. Unknown persistence withholds launch and triggers transaction inspection. Preserve existing grants → authorize route. |
| `lina-context-load` → `lina-state-load` | Return selected versioned history/context evidence to Context; optional missing sources and required failures stay distinct. |
| `lina-tools-dispatch`, `lina-tools-collect`, `lina-model-invoke`, `lina-model-normalize`, `lina-execution-settle` → `lina-state-record` | Return to the exact effect/settlement owner with a declared phase. Prelaunch intent acknowledgment and postlaunch outcome acknowledgment are different phases. Do not recursively launch when recording a result. |
| `lina-execution-controls`, `lina-execution-tool-outcomes`, `lina-execution-wait`, `lina-execution-settle` → `lina-state-checkpoint` | Checkpoint → same coordinator, committed safe boundary or withheld acknowledgment. Call outcomes and incomplete siblings remain distinct. Checkpoint is requested explicitly, not after every generic write. |
| `lina-input-recovery` → `lina-state-load` | Load → `lina-state-recover` for recovery-specific reads; ordinary State reads do not enter recovery. |
| `lina-state-recover` → `lina-state-record` / `lina-state-load` | Owner reacquisition and transaction inspection return to recover by request ID and phase. Conflicts with a newer live owner reject takeover. |
| `lina-state-recover` → `lina-input-recovery` | Resume plan; existing Input recovery → runtime uses prepare/controls/settle/retained-wait entries. Unknown effects use `lina-input-reconcile` under reacquired/retained authority. |

The existing safe-resume entries preserve turn/round identity. `lina-input-runtime` already connects to `lina-execution-prepare`, `lina-execution-controls`, `lina-execution-settle` and `lina-execution-wait`. The existing matched-answer route remains Input prompt → Execution wait → original Tools/Safety owner. Recovery must not introduce a shortcut where arbitrary saved chat text grants permission. See [Execution edges](../../../apps/web/src/features/lina/executionBlock.ts) and [Safety edges](../../../apps/web/src/features/lina/safetyBlock.ts).

Future Output record and Memory commit can use State record when those blocks exist. Do not add invented executable edges to current empty blocks merely to imply coverage.

## JSON contract sketches

These examples guide later JSON Schema implementation. They are synthetic records, not current exported formats or proof that transaction semantics exist.

```json
{
  "schemaVersion": 1,
  "requestId": "state-write:accepted-input-001:1",
  "requester": {"nodeId": "lina-input-accept", "phase": "commit-acceptance"},
  "command": "commit-record-set",
  "transactionId": "acceptance-tx:input-001",
  "idempotencyKey": "accepted-input:account-demo:event-001",
  "requestFingerprint": "sha256:fixture-acceptance-fingerprint",
  "scope": {"workspaceId": "workspace-demo", "conversationId": "conversation-demo"},
  "expectedRevision": 3,
  "executionFence": 1,
  "records": [
    {"kind": "accepted-input", "recordRef": "input:001", "payloadRef": "artifact:accepted-input:001"},
    {"kind": "input-receipt", "recordRef": "receipt:001", "payloadRef": "artifact:receipt:001"}
  ],
  "requiredCommitBoundary": "all-listed-records",
  "containsCredentials": false,
  "synthetic": true
}
```

The all-listed-records boundary is a requested guarantee. A backend must support it or report unavailable/unsupported, not acknowledge two independent file writes as an atomic transaction.

```json
{
  "requestId": "state-write:accepted-input-001:1",
  "transactionId": "acceptance-tx:input-001",
  "status": "unknown",
  "acknowledgedRevision": null,
  "mayAcknowledgeAcceptance": false,
  "inspectTransactionBeforeRetry": true,
  "externalEffectOccurred": false,
  "synthetic": true
}
```

An unknown State write acknowledgment does not mean an unknown remote tool effect. Both require inspection, but by different owners and using different identities.

```json
{
  "schemaVersion": 1,
  "checkpointId": "checkpoint:turn-001:4",
  "commitStatus": "committed",
  "implementationRevision": "lina-design:state-v1",
  "agentId": "lina-main",
  "turnId": "turn-001",
  "roundId": "round-001",
  "ownerRevision": 4,
  "executionFenceAtSave": 8,
  "recordRevisions": [{"recordRef": "turn:001", "revision": 4}],
  "resumeEntry": "lina-execution-wait",
  "contextSnapshotRef": "artifact:context:round-001",
  "settledWork": [{"operationId": "call-001", "resultRef": "artifact:result:call-001", "status": "complete"}],
  "pendingWork": [{"operationId": "call-002", "waitId": "wait:approval:call-002", "waitRevision": 1, "ownerNodeId": "lina-tools-permissions", "status": "waiting", "launched": false}],
  "unresolvedEffects": [],
  "counters": {"roundsStarted": 1, "physicalModelAttempts": 1},
  "stopIntentRef": null,
  "synthetic": true
}
```

```json
{
  "requestId": "recover:turn-001:1",
  "checkpointId": "checkpoint:turn-001:4",
  "status": "restore-waits",
  "turnId": "turn-001",
  "newOwnerRevision": 5,
  "newExecutionFence": 9,
  "resumeNodeId": "lina-execution-wait",
  "restoredWaitIds": ["wait:approval:call-002"],
  "preservedResultRefs": ["artifact:result:call-001"],
  "requiresCurrentPolicyRecheck": true,
  "requiresCurrentBindingRecheck": true,
  "sessionGrantsSurviveRestart": false,
  "relaunchAuthorized": false,
  "synthetic": true
}
```

Restoring a wait preserves its prompt/operation correlation. If it expired, was consumed/cancelled, or its binding changed, the original owner decides the appropriate denial, fresh review or recovery branch. A restored model attempt's transcript is insufficient to claim the provider call can reconnect; unsupported active attempts retain unknown/aborted observations and follow explicit retry policy.

## Deterministic design simulation cases

| Case | Expected behavior |
| --- | --- |
| Missing optional history versus unavailable State | Missing history permits explicitly configured first-use initialization; unavailable required storage blocks admission. |
| Duplicate accepted input | Same transport identity and transaction fingerprint returns original receipt/input; no new turn. Changed fingerprint conflicts. |
| Lost acceptance acknowledgment | Inspect transaction by ID; committed acceptance returns original record; proven absent permits conditional retry; unavailable inspection remains unknown. |
| Queue persistence and competing admission | One fenced owner admitted; second claimant observes conflict/queue state. Removing an entry cannot lose work during transfer. |
| Owner lease expiry plus unknown tool effect | Takeover gets a new fence but reconciles the unknown call. Expiry does not authorize replay. |
| Late callback from prior owner | Preserve source evidence, reject stale state mutation/launch under the old fence; route useful result evidence to reconciliation. |
| Saved approval with completed sibling | Restore exact wait and completed sibling result. Approval resumes only pending call; do not repeat the completed sibling. |
| Stop persisted before crash | Restore Stop, invalidate launch authority, retain completed outcomes, collect or reconcile active effects. No automatic next round. |
| Partial checkpoint | Fragments saved without committed manifest are not a usable latest checkpoint. Recover previous committed checkpoint and inspect later operation records. |
| Checkpoint acknowledgment lost | Inspect checkpoint ID and fingerprint before retry/publication; do not create a new checkpoint identity to hide uncertainty. |
| Missing referenced artifact or incompatible schema | Reject or require review; no successful restore claim with absent required payload. |
| Account/schema/policy changed since save | Saved context/grant does not permit current dispatch. Re-resolve exact binding and policy through existing owners. |
| Grant commit persisted, response lost | Safety requests State inspection of same transaction, then grants become available only on known matching commit. |
| Runtime restart with session and persistent grants | Invalidate runtime-session grants per current Safety contract; load persistent grants and recheck policy/revocation. |
| Model launched but no terminal observation | Preserve attempt/round counters and launch evidence. Do not classify intent alone as completion, or fabricate a reconnect capability. |
| Saved final answer and unknown delivery | Reuse saved answer; delivery owner inspects delivery/part identity. Do not rerun the agent or blindly resend. |

Each case must use the same reducer for Auto and Next, preserve active/waiting/settled siblings in playback, and clearly label fixture storage. Counter values change at their actual simulated launch/commit transition, not when reconstructing the checkpoint. Restart itself is a new control action; it should not erase the original run's evidence or imply a live server restart occurred.

## Open implementation choices

Select the backend after the required conditional-update and checkpoint guarantees are explicit. SQLite fits the current single-workspace local application and already stores authoring, but sharing that authoring table would erase the boundary. A journal plus materialized snapshots or a framework checkpointer can also satisfy selected contracts with different limits. Do not promise that all backends support the same transaction, lease, replay and power-loss behavior.

A design simulation can demonstrate the chosen rules now. A production implementation later needs backend tests for duplicate commands, concurrent owners, crash before/after acknowledgment, partial writes, retention and owner fencing. Passing graph or schema fixture tests cannot replace those checks.
