# Lina Memory design block

## Accepted scope

Implement the twelve responsibilities in the [Memory study](../../../../docs/research/lina/memory-research.md)
as an executable Studio design model. The user accepted the recommended baseline
and lineage-aware forgetting on 2026-10-08. Live storage, extraction models,
retrieval benchmarks and multi-agent execution are not part of this slice.

## Decisions

- User-private, workspace-shared, agent-private and task-local namespaces. Child
  access is explicit; shared publication needs parent review by default.
- Bounded profile plus source-backed facts/episodes; procedures remain candidate
  knowledge until independently admitted as skills.
- Context preparation and explicit tool recall are distinct modes.
- Explicit mutations plus conservative automatic candidates; captured origin and
  egress eligibility precede model extraction.
- Corrections supersede versioned records and preserve historical meaning.
  Contradictions can remain unresolved.
- Optional bounded consolidation re-enters validation and mutation review.
- Forget immediately revokes recall and pending resurrection, then tracks cleanup
  across declared source/derived/index/cache/replica coverage. Logical removal
  differs from completed purge; exceptions are explicit.
- State receipts, index visibility and Context inclusion remain separate.

## Implementation checklist

- [x] Add scope/query/retrieve/select recall branch and requester-specific returns.
- [x] Add capture/extract/validate/resolve/commit mutation branch and failures.
- [x] Add index/consolidate/forget maintenance branches with bounded lineage.
- [x] Connect actual Context/Tools/State/Model/Safety owners; no invented future endpoints.
- [x] Preserve notes, positions, custom edges and relationship placement on refresh.
- [x] Add precise JSON schemas, input variants and valid examples for all nodes.
- [x] Preserve mutation IDs, temporal facts, revision conflicts, source trust and namespace admission.
- [x] Model immediate recall revocation, descendant cleanup and pending-job exclusion.
- [x] Add Run memory cases, Auto/Next playback and collapsible colored JSON evidence.
- [x] Preserve existing request/model/tool counters and ownership across memory events.
- [x] Integrate reset, matched answers, recovery and Stop semantics without reviving writes.
- [x] Test success, no-match, disabled/unavailable, scope refusal and poisoned-source rejection.
- [x] Test corrections/history/conflict, duplicate/unknown commits and index lag.
- [x] Test consolidation, forget coverage, stale retrieval and resurrection prevention.
- [x] Run Lina suite, web typecheck/build and browser checks.
- [x] Update documentation, indexes and final validation evidence.

## Validation evidence

Verified on 2026-10-08:

- Maintained graph: 112 nodes, 400 connections, 112 provisional contracts and
  2,422 context/input/output examples. Memory contributes twelve nodes and 87 edges.
- Lina suite: 607 tests passed, including all 21 Memory cases through Auto/Next;
  deny/expiry, mismatched parent review and Stop cannot publish a child candidate.
- Web production build passed, including TypeScript checks and generation of
  86 documentation entries. Existing large-chunk build warnings remain.
- Browser: Memory modal, manual forgetting through immediate recall revocation
  and pending replica cleanup, automatic progression/pause, manual graph
  exploration, matched/mismatched parent review, completion and expandable
  syntax-colored node JSON inspected successfully.
- Reset, original operation identity, scoped access, corrections/history,
  poisoned sources, unknown writes, index lag, recovery and cancellation covered.

All stores and observations remain marked as fixture data. These checks establish
Studio design behavior, not memory quality, live durability or universal erasure.
No dependency was added. Existing unrelated uncommitted work was preserved.
