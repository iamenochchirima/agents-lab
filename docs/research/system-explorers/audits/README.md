# Explorer source audit

Audit date: 2026-10-04. This pass reconciles the **represented surface claims**
in the four Studio maps with their pinned local source. It checks named owners,
caller relationships, conditions, execution ordering, state ownership, persistence
and example-path assumptions. It does not certify the full implementations or
external integrations.

## Evidence by system

| Ledger | Coverage at audit date | Item-level outcome |
| --- | --- | --- |
| [Hermes](hermes.md) | 51 architecture nodes, 91 edges; 45 older walkthrough phases and 12 paths | 160 verified, 24 corrected, 15 need deeper review |
| [Pi](pi.md) | 132 nodes, 188 edges, six paths | 204 verified, 51 corrected, 71 need deeper review |
| [Waku](waku.md) | 124 nodes, 191 edges, six paths | 233 verified, 63 corrected, 25 need deeper review |
| [OpenClaw](openclaw.md) | 133 nodes, 136 edges, six paths | 137 verified, 71 corrected, 67 need deeper review |

Hermes architecture and older walkthrough entries are separate namespaces;
some describe the same owner. Counts measure reviewed map items, not code
coverage, confidence percentages, framework quality or completeness. The
maps intentionally have different boundaries and granularities.

Hermes was subsequently expanded; see its [coverage inventory and addition
evidence](../hermes.md). The Hermes figures above remain the original audit
snapshot, not a certification of the expanded map.

## How to interpret a status

- **verified:** source and caller support the bounded surface claim. It does not
  establish every internal branch, a runtime outcome or an external guarantee.
- **corrected:** this pass repaired an anchor, statement, edge kind, condition or
  example assumption. Read the remaining limit alongside the correction.
- **needs-deeper-review:** the boundary exists, but its broader contract or
  implementation is not fully established by this pass. Do not treat it as verified.

Each ledger records every node/edge/path ID at its audit date, evidence and remaining
limits. Correction logs preserve what changed and why. Anchors are reproduced
against the exact source revisions recorded in each study. Inspect surrounding
function bodies and actual callers; matching a symbol string or finding a valid
line number is insufficient evidence.

## Findings that changed the diagrams

- OpenClaw authentication invokes preliminary admission. Plugin registration
  checks do not activate a harness; checkpoints consume already-executed tool
  outcomes. Recovery compaction and direct session compaction have distinct owners.

- Hermes tool batches can contain parallel segments and sequential barriers.
  Delegation can return a handle before later completion; one-shot/no-consumer
  sessions join instead. A no-store flush does not establish durability.
- Pi manual compaction aborts first; reload does not do so itself. Pending queues
  are volatile, and concurrent tool results join before ordered message publication.
- Waku settings toggles do not rebuild the current agent; eligible integration
  changes do. Pure graph topology and constructors had been mistaken for direct
  runtime calls. The calendar read is not an Apple integration.

The original Hermes context lifecycle document remains unchanged. Its corrections
are recorded in this separate audit and applied to the explorer data.

## Validation and limits

Source checkouts are read-only. No studied agents, models, tools, subprocess
runtimes, external integrations or test suites were executed. Validation checks
source-file/line bounds, unique IDs, endpoints, group membership, path references,
ledger coverage and frontend compilation. These checks complement semantic reading;
they cannot establish semantic accuracy by themselves.

Full application typechecking has a preexisting blocker at
`studio/http-contract/src/context-experiment.ts:123` (TS2366, missing return).
The affected explorer modules compile independently. Deeper studies should first
resolve the explicitly flagged state/recovery/admission boundaries and expand
missing topology before assuming a complete execution simulation.
