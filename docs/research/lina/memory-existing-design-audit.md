# Lina memory: existing design and runtime audit

Reviewed 2026-10-08. Research only. This document changes no graph, schemas,
simulation or runtime. The local checkout was at `bf3e2e6f53cabc399f376023e3bdcb49ebfba69c`
with substantial existing uncommitted work. Local links refer to the inspected
working tree, not a claim that every file is in that commit.

## Three separate implementations to keep distinct

| Area | What exists | What it does not establish |
| --- | --- | --- |
| Lina architecture | An empty Memory region, explicit Context namespace/trust contracts, and State storage ownership | Executable Memory nodes or a Lina memory runtime |
| Studio comparison runtime | Policy/store/repository interfaces, five deterministic controls/policies, journal-backed file storage and multi-turn measurement | General extraction, embeddings, a production user-memory service or independent concurrent writers |
| Reusable Memory module | `recall` and `observe`, provenance-bearing records, owner/session validation, bounded object-local lexical recall | Cross-process persistence, update/delete lifecycle or long-term shared namespaces |

Sources: [reserved regions](../../../apps/web/src/features/lina/plannedBlocks.ts),
[Studio contracts](../../../server/src/studio/memory/contracts.ts),
[policies](../../../server/src/studio/memory/policies.ts),
[store](../../../server/src/studio/memory/store.ts),
[repository](../../../server/src/studio/memory/repository.ts), and
[module documentation](../../../studio/modules/memory/README.md).

## Lina's current boundaries

The earlier [four-node proposal](revisit-planned-blocks.md#memory-four-nodes-new-block-development)
separates scope, retrieval, mutation review and commit. It is an initial sketch,
not a researched limit on the number of nodes. The dedicated
[memory synthesis](memory-research.md) should guide the next review.

Context already binds allowed memory namespaces to workspace, requester, agent,
history branch and permission generation. It labels retrieved memory as
untrusted evidence, retains source/revision/digest and omission information, and
rejects evidence from foreign scope. Memory results enter task assembly, while
Context owns selection and request budgeting. Compaction does not automatically
write long-term memory. Sources:
[Context records](../../../apps/web/src/features/lina/contracts/contextRecords.ts),
[Context assembly](../../../apps/web/src/features/lina/contracts/contextAssembly.ts)
and [Context nodes](../../../apps/web/src/features/lina/contextBlock.ts).

State says Memory owns learned knowledge and mutation policy. State supplies
storage and transaction inspection, rather than deciding which fact is relevant.
No current State route connects to an executable Memory node. Sources:
[State block](../../../apps/web/src/features/lina/stateBlock.ts) and
[State ownership audit](state-existing-design-audit.md#records-and-their-owners).

A memory record may share physical storage with execution records. It must never
stand in for a delivery receipt, operation result, approval grant or checkpoint.
This is a proposed invariant consistent with the existing domain boundaries.

## Studio comparison policies are useful controls

`memoryPolicies()` registers no-memory, working-memory, episodic-lexical,
semantic-keyed-facts and procedural-cache. All enabled policies use normalized
ASCII lexical overlap, positive-score selection and a bounded result count.
Tie-breaking uses update time and record ID. Semantic candidates accept a
specific `fact`/`preference` output syntax; procedural candidates accept a
specific `procedure` output syntax. Episodic and working policies store turn
output. Consolidation currently expires explicit TTL records; it does not infer
new lessons, merge experiences or rewrite a knowledge graph.
[Policy implementation](../../../server/src/studio/memory/policies.ts).

These labels vary both what is stored and how it is extracted. A comparison of
these existing policies cannot isolate the effect of episodic versus semantic
representation alone. Keep them as named baselines, then construct controlled
comparisons with one changed mechanism.

The runtime reads memory before preparing Context, then writes the accepted
output and consolidates after output collection. A fixed-memory dependency
skips writes and consolidation changes for that experimental control.
The comparison service can reopen the same trial's repository between turns.
Sources: [harness runtime](../../../server/src/studio/runtime/harness-runtime.ts)
and [comparison service](../../../server/src/studio/application/comparison-service.ts).

Namespace identity is comparison/trial/scenario/session. That prevents trials
from sharing state accidentally, but does not define Lina's future user,
workspace, agent-private or child-task access rules.
[Namespace contract](../../../server/src/studio/memory/contracts.ts).

## Persistence and mutation gaps before reuse

The file repository appends a full-state journal event, then a decision event,
then publishes a JSON snapshot through rename. Loading can recover a journal
revision newer than the snapshot. Operation IDs carry fingerprints; changed
payloads under a prior identity conflict. The queue serializes calls on one
repository instance. Supersession preserves old records. Delete marks a record
`discarded`; expiry marks it `expired`. Journal entries retain historical state.
[Repository source](../../../server/src/studio/memory/repository.ts).

Consequences for Lina, inferred from those mechanisms:

- Reopening a repository is useful local persistence evidence, not a machine
  crash or power-loss durability guarantee. No explicit fsync protocol is shown.
- The instance queue is not a lock shared by independent instances or processes.
  The public mutation API has no expected-revision compare-and-swap parameter.
- Retiring a record is not physical erasure. A real forget operation needs a
  defined policy for snapshots, journals, derived memories, indexes, caches and
  backups. Research evidence retention needs its own separately permitted policy.
- A provenance string and source message IDs are useful, but do not establish
  author identity, observation time versus fact-validity time, extraction model,
  verified outcome, authority or permission to share with children.
- Recovery of a write with an unknown acknowledgment should inspect its original
  operation identity. It must not let an extractor invent a second mutation.

The store distinguishes cancellation before persistence, during an uncertain
acknowledgment, and after an applied write. The applied write remains applied
when a later cancellation occurs. These semantics should be retained, not
collapsed into a generic cancelled result.
[Store implementation](../../../server/src/studio/memory/store.ts).

## Context encoding needs an explicit trust check

`memoryRecordsAsMessages` assigns role `system` while recording metadata
`memoryTrust: retrieved-untrusted`. Research Context projections classify memory
as untrusted. This metadata/role combination warrants inspection when building
Lina's real provider adapter: provenance metadata alone does not lower a message's
provider-level instruction role. Do not copy this representation blindly into
Lina. This is an integration risk, not a demonstrated exploit.
Sources: [message mapping](../../../server/src/studio/runtime/baseline-components.ts)
and [trust classification](../../../server/src/studio/strategies/context-research-contracts.ts).

## Reusable module has a narrower contract

The module checks owner and session on each operation, returns ranked candidates,
and retains observation provenance. Records disappear on close or process exit.
Duplicate observation IDs skip; v0 does not prescribe logical-key merge/update
behavior. Scores are implementation-specific. Its contract has no consolidation,
forget, revision-conflict or external index API. Sources:
[module contract](../../../studio/modules/memory/src/contract.ts) and
[in-memory implementation](../../../studio/modules/memory/src/in-memory.ts).

Use this module as a small reference or disabled/simple-memory experiment.
Expanding it into Lina's complete memory service requires explicit interface
changes; the two existing memory APIs should not be silently treated as identical.

## Verification performed

- `node --import ./server/node_modules/tsx/dist/loader.mjs --test server/tests/studio/memory/*.test.ts`: 27 tests pass.
- `pnpm --filter @agent-harness-lab/module-memory test`: 5 tests pass.
- Inspected the current graph, Context/State contracts, policies, repository,
  write cancellation, Context message mapping and runtime call sites.

The tests cover existing contracts including logical updates, expiry, duplicate
operation identities, invalid state, reopen and acknowledgment loss. They do not
validate retrieval quality, semantic extraction, independent-process writes,
physical erasure or adversarial memory poisoning. No runtime changes were made.
