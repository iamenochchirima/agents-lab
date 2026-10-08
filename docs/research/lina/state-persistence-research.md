# Lina State, persistence and recovery research

Reviewed 2026-10-08. This report refines the earlier four-node proposal using official agent source, current primary documentation and the existing repository. It proposes the next design-graph slice; it does not implement persistence or validate upstream crash guarantees.

## Finding

State and recovery are real harness responsibilities. The agents implement them through session managers, databases, task journals and delivery ledgers rather than a shared block with the same name. Their guarantees differ. Loading saved conversation history, recovering scheduled execution and reconciling an uncertain external action are three separate operations.

| Implementation | Verified mechanism | Important limit |
| --- | --- | --- |
| Hermes | SQLite session/routing records, persisted active-turn ownership, startup resume markers, delivery and asynchronous delegation ledgers | Interactive restoration asks what to do next. Non-interactive continuation is prompt-driven; a missing result is not proof an action had no effect. Delivery ledger explicitly permits at-least-once recovery. |
| OpenClaw | Persisted recovery classification, conditional delivery claims, approval write readback and child lifecycle ownership; current docs describe transactional turn admission | Recovery distinguishes unknown effects and audited replay-safe checkpoints. Current documentation must not be attributed automatically to an older source pin. |
| Ordinary Pi | Versioned JSONL conversation tree, compaction/context entries and branch reconstruction | Reopening a conversation and repairing an orphan tool-result pair do not establish safe replay of the original effect. |
| Pi experimental durable package | Transactional submissions/tasks/checkpoints, request-ID deduplication, persisted tool intent and owned child reuse | Separate experimental package. A tool is replayed only under compatible recorded and current replay policies; backend configuration still determines durability. |
| Waku | SQLite completed exchanges, separate facts/episodes and conversation reload | The inspected live loop, graph dictionary and gateway executor queue have no equivalent execution-checkpoint interface. |

Detailed pinned evidence, current-documentation boundaries and source links are in [Hermes/OpenClaw](state-hermes-openclaw.md) and [Pi/Waku](state-pi-waku.md). These are source observations, not measured reliability rankings.

## Cross-check against established execution systems

LangGraph distinguishes thread checkpoints from cross-thread stores. A RAM checkpointer does not survive restart. This supports keeping Lina execution State separate from learned Memory, even when their physical database is shared. [Persistence documentation](https://docs.langchain.com/oss/python/langgraph/persistence)

Its checkpointers retain task-level writes from successful parallel siblings, then publish full checkpoints at super-step boundaries. The documentation distinguishes sync, async and exit-only persistence, each with different loss windows and overhead. Lina should preserve completed sibling results and make the acknowledged recovery boundary explicit. These are documented semantics, not results of a crash test conducted here. [Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)

An interrupted LangGraph node starts again from its beginning when resumed. Code before the interrupt can therefore run again. Lina's saved wait must carry an explicit safe continuation rather than imply restoration of an arbitrary instruction pointer. [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

Temporal separates recorded workflow progress from external Activity effects. A worker can finish an Activity and die before reporting success, causing retry. The called service must enforce stable idempotency keys where duplicate effects matter. Lina consequently needs separate operation intent, observed outcome and reconciliation, even with a transactional State backend. [Activity definition](https://docs.temporal.io/activity-definition)

Restate journals operation results and uses replayable time/random helpers. Its durable-step wrapper retries failures under a declared policy. This provides another basis for recording nondeterministic outcomes and stable operation identity; wrapping a call alone must not become a claim of exactly-once external effects. [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)

These systems are references for semantics, not proposed dependencies. Lina can implement the required contracts without adopting their scheduler or naming.

## Proposed nodes

Keep the four proposed nodes, with richer contracts. Neither copying an upstream module list nor adding a generic node for every database table would improve the graph.

| Node | Responsibility | Main branches |
| --- | --- | --- |
| **Load state** `lina-state-load` | Read scoped, versioned history, execution records, grants, waits and checkpoints; inspect a previous transaction by its original identity | Found, missing, incompatible, corrupt, unavailable |
| **Record state** `lina-state-record` | Commit named record sets and conditional transitions: acceptance, queue, execution ownership, intent/result, wait, cancellation and grant transactions | Applied, already applied, conflict, failed, unknown |
| **Create execution checkpoint** `lina-state-checkpoint` | Publish a committed manifest tying exact record revisions to a supported continuation, completed siblings and pending work | Committed, already committed, incomplete, conflict, failed, unknown |
| **Recover execution** `lina-state-recover` | Validate the manifest, reacquire execution ownership, inspect uncertain writes and classify outstanding work; return a plan to its coordinator | Resume, restore waits, reconcile, require review, reject |

The detailed [existing-design audit](state-existing-design-audit.md) supplies graph-ready request/return connections, JSON sketches, semantic owners and failure cases. These refine, rather than implement, the [earlier State proposal](revisit-planned-blocks.md#state-persistence-and-recovery-four-nodes-new-block-development).

Ownership acquisition, renewal and release must be explicit tagged commands with expected revision and an execution fence. A fence identifies the current owner generation so a late old worker cannot mutate current execution state. It does not undo a remote effect already launched. Input and Execution already own admission/reclaim/release decisions; initially they call Record rather than introducing a competing coordinator. A fifth ownership node is justified later if ownership becomes an independently configured service or simulation policy.

## Connections and boundaries

State is a service invoked by other blocks, not a mandatory Load → Record → Checkpoint → Recover chain.

- **Input** persists original input identity, claim, acceptance receipt, queue membership and execution ownership. Acceptance waits for a known commit. Duplicate input reads the original receipt.
- **Turn Execution** persists waits, Stop and settlement, and requests checkpoints at supported boundaries. Recovery returns through the existing `lina-input-recovery` route under the same turn identity.
- **Context** reads versioned transcript and snapshot references. It still owns selection, reduction and request assembly.
- **Tools and Model Interface** record intent before launch and outcomes afterward, with separate phase-specific acknowledgments. Tools retains effect classification and reconciliation through `lina-input-reconcile`.
- **Safety** loads/commits grants and reservations, then rechecks current permission and binding before launch. Restoring a saved grant is not a fresh authorization decision. Current runtime-session grants expire on restart; persistent grants require current-policy validation.
- **Delivery** retains an owed-reply record, send attempt and acknowledgment. Execution completion and reply delivery remain separate. Restore the saved reply instead of rerunning the agent to recreate it.
- **Future Subagents** use parent/child IDs and retained task/results. State can define their record family now; runnable child routes wait for the orchestration block.

Every reply names its original requester and phase. Recording a tool result must return to its collector, not dispatch that tool again. Only recovery reads enter Recover. Checkpoint requests are explicit, not an automatic consequence of every write.

Credential material stays behind the protected credential owner; checkpoints carry safe references only. Memory owns learned knowledge. Observability owns traces and metrics. Neither remembered facts nor a visual playback trace is an execution receipt. Required artifact references must remain readable while live recovery records reference them.

## Initial design simulation

The graph slice should expose these cases using the same event transitions for Auto and Next:

1. Fresh input commits once; a duplicate returns its original receipt.
2. A commit succeeds but its acknowledgment is lost; inspect the same transaction before retry.
3. Crash after admission but before a known-unstarted operation; recover under a new owner generation.
4. Restart with one completed parallel call and another pending; retain the completed result.
5. Restore an approval wait; preserve its identity and recheck expiry, policy and binding.
6. Tool effect may have happened but no result exists; reconcile instead of blindly replaying it.
7. Persist Stop, restart and retain cancellation intent.
8. Save checkpoint fragments without the committed manifest; reject them as a usable latest checkpoint.
9. Reject an incompatible checkpoint, missing required artifact or stale worker mutation.
10. Complete execution with uncertain reply delivery; inspect the existing delivery identity without rerunning the agent.

The audit contains additional cases for grants, queue custody and model attempts. The simulation must label fixture persistence honestly. It can demonstrate these design choices, but real backend crash/concurrency tests will be needed when Lina becomes an executable harness.

## Defaults and experiment opportunities

Baseline requirements are stable identity, conditional ownership, acknowledged commit boundaries, intact wait/result correlation and explicit unknown-effect handling. Do not present blind replay or treating a failed read as empty history as alternative performance strategies.

Meaningful later comparisons include journal plus snapshots versus transactional checkpoint records; checkpoint frequency; full versus incremental snapshots; sync versus async durability with stated loss windows; and retention/blob-placement policy. Measure write latency, storage growth, restart time, repeated work and lost acknowledged progress under the same failure injection. Keep model configuration, tool behavior and workload fixed. Conversation-only restoration and full task recovery should be reported as different capabilities.

For a later local runtime, SQLite is a plausible starting backend because the repository already uses it. This is a proposal, not a dependency decision or a promise that the architecture-authoring database stores execution. Backend choice follows the required transaction/fencing contract. Process restart, machine failure and power loss need separate validation.

## Validation and remaining work

Reviewed agent source and primary documentation, audited local stores and cross-block contracts, and checked research links/JSON sketches and the documentation catalog. No upstream runtime was launched or crashed. No graph, schema registry, simulator, server storage or active implementation checklist was changed by this research.

The next implementation should apply the four nodes, exact request/return routes, JSON Schema contracts and examples, and the deterministic cases above. Backend execution and live recovery remain a separate implementation layer.


## Implemented design slice

The [State implementation checklist](../../../development/implementation-plans/studio/completed/lina-state-persistence.md)
now records four graph nodes, 61 request/return connections, JSON contracts,
reference examples and fourteen deterministic recovery cases. The graph has
100 nodes and 313 edges. All storage and restart behavior in this slice is
explicitly fixture-only. Live backend selection and crash tests remain separate.
