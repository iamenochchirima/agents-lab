# Side Effect Ack Loss experiment

Allow an external side effect to succeed while its acknowledgement is lost, then measure duplicate-side-effect protection.

The bounded native acceptance below implements a provider-key reconciliation control. Broader crash and failure campaigns remain outside this experiment.

## Executable X02 provider-key reconciliation

The [native review exercise](../../../server/integration-tests/native-invocation-review.test.ts)
now includes an external acknowledgement-loss case for each selected baseline.
An evaluator-owned loopback HTTP provider creates a disposable ticket using the
run ID as an idempotency key, then destroys its socket before sending any response.
The actual native agent's protected call records an unknown effect and stops. The
fixture independently confirms one ticket and one provider attempt. Recovery is an
explicit evaluator operation using the **same key and content**; the provider returns
the original receipt, and independent state remains one ticket after two attempts.
Conflicting content with the same key rejects with HTTP 409.

This is provider-safe reconciliation, not blind redispatch from an uncertain agent.
No runtime retry policy changes. The guarantee depends on this fixture's declared
idempotency contract; it is not exactly-once execution for arbitrary tools. The
fixture is disposable in-memory external state and does not claim database survival
across provider-process restart.

Build and run the human-approval scenario command, optionally selecting platforms
with `AGENTLAB_REVIEW_PLATFORMS`. The retained `extensions.json` records X02 separately
from X04; `artifacts/external-effect-recovery.json` retains committed state, recovered
state, receipt and the provider idempotency contract. The envelope records native
scripted mode, revision, installed SDK versions, fixture version, budgets and times.
The original native run remains failed with an unknown-effect result; reconciliation
does not rewrite that historical outcome.

A small passing/failing provider control is executable with:

```sh
node --test server/dist/tests/evals/effect-recovery-fixture.test.js
```

## Recorded observations (2026-10-08)

The four-platform report
`lab/runs/.review-proof/native-review-ffeb524c-da66-4f47-a03f-c6cbd1f76163/extensions.json`
contains passing X02 observations for Mastra, Temporal and Restate. LangGraph was
incomplete because the evaluator initially asserted a generic terminal failure.
Its native adapter correctly retains `reconciliation_required`, with
`LANGGRAPH_OUTCOME_UNKNOWN` and failure kind `reconciliation`. After asserting that
native policy explicitly, the focused report
`lab/runs/.review-proof/native-review-3abed55d-0df9-4aed-b5c9-42c0d63e4185/extensions.json`
contains passing X02 LangGraph observations. All four have an independently counted
single ticket and recovered original receipt. Original agent outcomes remain
uncertain/failed; the provider reconciliation is separate evidence.
