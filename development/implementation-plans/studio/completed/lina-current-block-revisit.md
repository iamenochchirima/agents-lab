# Lina populated-block revisit

Completed 2026-10-08. This applies the approved first slice of the
[cross-block audit](../active/lina-cross-block-revisit.md) to the maintained graph,
contracts and deterministic simulation. It does not implement a live Lina harness.

## Scope and decisions

Input, Turn Execution, Context and Tools now have 87 nodes and 201 connections.
Planning is required future capability; simple turns may bypass explicit plan
creation. Computer Use is deferred. Other empty blocks remain future work.

The eight additions are:

| Block | Added nodes |
| --- | --- |
| Turn Execution | Await external work; Cancel active work |
| Context | Bind context scope; Shape observations |
| Tools | Read selected connector resources; Get selected connector prompt; Apply declared plugin hooks; Decide bounded adapter retry |

## Completed checklist

- [x] Keep input account/channel binding, admission authority, prompt correlation, queue, checkpoint and delivery records explicit.
- [x] Move active-work reconciliation to Execution with its stable node ID; preserve annotations and existing saved positions; make migration idempotent.
- [x] Add wait/cancel paths with operation-bound responses, sibling preservation and explicit known/unknown effect handling.
- [x] Bind Context source scope before reads; preserve rich results and original artifact references through preparation and publication.
- [x] Stage catalogs and skill contributions through Context load; preserve catalog schema constraints, binding generations and skill provenance.
- [x] Acquire selected resources/prompts through Tools; return to their owning Context preparation rather than inventing model tool calls.
- [x] Stage plugin contributions until activation; apply argument hooks before validation/permissions and projection hooks before budgeting.
- [x] Separate adapter retry, model retry and context reprepare budgets; never replay unknown writes automatically.
- [x] Replace the tool-summary bypass with detailed event playback, overlapping independent calls, serialized conflicts and ordered canonical results.
- [x] Preserve successes through mixed outcomes, approval/auth/input waits and safe retries.
- [x] Share the reducer between Automatic and Next; expose following/manual graph navigation in the modal.
- [x] Distinguish Pause from Stop; prevent new launches, account for admitted active work and hold uncertain writes for evidence before cancelled settlement.
- [x] Provide schemas and paired JSON examples for all maintained nodes; retain syntax coloring and nested disclosure.
- [x] Update local documentation, research status and checklist indexes; leave remaining block development unchecked.

## Validation

The six focused architecture/contract/simulation suites pass **206 tests**.
A standard Draft 2020-12 validator accepts **907 examples across 87 nodes**.
Web type checking and the production build pass. No dependency was added for this slice.

```sh
pnpm --filter @agent-harness-lab/studio-api exec tsx --test \
  ../web/tests/linaArchitecture.test.ts \
  ../web/tests/linaContracts.test.ts \
  ../web/tests/linaToolsContracts.test.ts \
  ../web/tests/linaRevisitContracts.test.ts \
  ../web/tests/linaSimulation.test.ts \
  ../web/tests/linaRevisitSimulation.test.ts
pnpm --filter @agent-harness-lab/web build
```

Live browser checks verified all eight new node inspectors, expandable colored
JSON, manual and automatic detailed tool paths, visible overlapping call tokens,
matched/mismatched approval/auth/input/reconciliation responses, and Stop retaining
an uncertain write until evidence. No page errors were observed. The isolated
browser context did not save architecture changes or alter the user's open tab.
The saved-design regression verifies migration from the previous 79-node design
with all existing positions and annotations retained except the intended move of
reconciliation; refresh is idempotent.

## Limits and remaining work

This simulation uses fixed operation events and fake references. It measures no
model quality or production latency and performs no real authentication, tool
execution, plugin loading, credential storage, persistence recovery or delivery.
State/write failures and richer input/recovery branches have reference contracts;
not every example has an interactive fixture. Child scope contracts do not create
subagents. Model, Safety, Environment, State, Output, Observability, Subagents,
Memory and Planning development remain in the active proposal. Computer Use will
be revisited later.
