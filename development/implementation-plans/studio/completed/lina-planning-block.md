# Lina Planning and task management

Status: complete. Implements the accepted [research proposal](../../../../docs/research/lina/planning-research.md). Scope is the maintained architecture, JSON inspector contracts and deterministic Studio simulation. No live provider, durable task service or performance result is implied.

## Responsibilities and boundaries

The eight nodes resolve policy, load a scoped plan, apply typed updates, select ready work, bind actual execution, review task evidence, decide revisions and assess whole-goal completion. Turn Execution owns model rounds and settlement. Tools and Subagents admit/execute operations. State records plan revisions and checkpoint references. Context selects bounded task evidence. Plan review does not grant action permissions.

Stable identities distinguish goal, plan, task, revision, attempt and operation. Source kind differs from assessment method. Dependencies require accepted predecessor evidence. Unknown effects remain with the existing reconciliation owner. Revisions preserve accepted work and unresolved attempts.

## Checklist

- [x] Eight maintained nodes and 66 relationships with valid endpoints and exact owner return paths.
- [x] Planning region arranged near Execution, preserving saved layout and custom annotations.
- [x] JSON schemas, alternative examples, typed commands, scopes/revisions/attempts and honest completion statuses.
- [x] State plan record kinds/checkpoint references and bounded Context projection contracts.
- [x] Validated fixture mutations, dependency readiness, bindings and evidence assessments.
- [x] Run modal scenario/strategy/execution mode/replan/ready limits with existing Auto/Next and manual graph following.
- [x] Integrated State journals/checkpoints, child-local plans, Stop and response handling verified.
- [x] All Planning cases verified in Auto/Next with ordinary provider preparation and unchanged ownership.
- [x] Browser verifies manual review, resumed execution, node schemas and automatic traversal.
- [x] Full Lina tests, web typecheck/build and diff/documentation checks pass.
- [x] Documentation reflects the completed design slice and its limitations.

## Scenarios

Direct bypass; sequential dependencies; independent ready work; actual delegated work; plan-only; review before execution; insufficient evidence; failed prerequisite; observation/user revision; invalid reference/cycle; duplicate/conflicting/unknown write; compaction/reload; recovery of accepted prior work; bounded replanning; unresolved work; partial result; child-local plan.

## Verification evidence

The full Lina suite passes: 817 tests, including all 21 Planning cases, Auto/Next parity, valid routes/unique event IDs, evidence-dependent readiness, revision conflict/inspection, child scope, cancellation and exact checkpoint references. Web typecheck and production build pass; the build retains its existing large-chunk warning. `git diff --check` passes.

Browser verification covered manual review before execution (zero attempts), accepting and advancing ordinary execution, independent manual graph following, automatic plan-only completion (43 events, zero model attempts), and the collapsible highlighted JSON contract inspector. Screenshot: `.long-running-work/active/lina-planning-browser.jpg`.

## Limits

Plans and model proposals are deterministic fixtures. JSON inspector schemas describe the richer intended runtime boundary, while playback uses small controlled task records. Fixture verification checks declared source/evidence conditions; it is not independent proof of a real task's success. Provider token estimates are labelled synthetic approximations. Live plan storage, model planning quality and task dispatcher performance remain unmeasured.
