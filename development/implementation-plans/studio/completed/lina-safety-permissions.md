# Lina Safety nodes and permission simulation

Implement the [researched five-node design](../../../../docs/research/lina/safety-permissions-research.md) in Studio's maintained graph and deterministic playback. This is a design implementation, not a live permission service.

## Checklist

- [x] Add policy/evaluate/approval/grants/authorize nodes and exact graph routes.
- [x] Refresh saved drafts without losing notes, custom connections or user layout.
- [x] Position Safety near Tools with no populated-block overlaps.
- [x] Supply JSON input/output schemas, multiple examples and producer handoffs.
- [x] Represent four choices and operation/session/persistent grant scopes.
- [x] Traverse Safety admission and final dispatch checks, including acquisition ownership.
- [x] Preserve independent waits and settled siblings, with selected-wait controls.
- [x] Model grant reuse, session end, revocation, binding/policy changes and failed/unknown commits.
- [x] Preserve Stop, expiry/mismatched answers and known versus unknown effects.
- [x] Verify Auto/Next use the same transitions and stop for explicit review.
- [x] Run relevant tests, web typecheck/build and inspect the browser interaction.
- [x] Update graph manifest, implementation/research indexes and local README.

## Assumptions and limitations

Grants are local deterministic fixture state and carry no real account authority. A new run can reuse reviewed fixture grants; reload is not durable production storage. Session lifecycle and adapter matching are explicit fixture rules. Provider authentication stays separate. State, Environment and Subagents remain future blocks.

## Evidence

Baseline before changes: 420 Lina tests passed with `node --import ./server/node_modules/tsx/dist/loader.mjs --test apps/web/tests/lina*.test.ts`.


The five-node graph has 31 new connections. Final launch remains separate from
scheduling admission. Typed four-choice answers pass through Input and Execution;
Context resource/prompt review retains acquisition identity and starts no inference.
Session/always grants are explicit in-memory fixtures; the future State dependency
is declared in contracts and does not point to invented executable nodes.

Focused coverage includes policy precedence, grant matching/lifetime, failed and
unknown commit inspection, revocation, session end, stale/duplicate responses,
changed queued binding/policy, multiple waits, independent approved-call progress,
Stop and existing Model/Tools recovery paths. Browser inspection verified the
four choices, selected second-call approval, first-call denial, preserved sibling
result, completed turn and the new Safety region. Automatic playback advanced
through the same controls.

Validation commands:

```sh
node --import ./server/node_modules/tsx/dist/loader.mjs --test apps/web/tests/lina*.test.ts
pnpm --filter @agent-harness-lab/web build
```

Final validation: all 460 Lina tests pass, including 27 Safety simulation tests, seven Safety contract tests and six Safety graph tests. The final Safety reducer check also passed after the retained-wait correction. All 96 nodes have contracts with 1,509 total context/input/output examples. Web typecheck and production build pass. The existing asset-size warning remains;
this change adds no dependency. No live remote operation or production permission
store was exercised. Changes remain uncommitted.
