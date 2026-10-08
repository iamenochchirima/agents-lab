# Side Effect Ack Loss experiment

Allow an external side effect to succeed while its acknowledgement is lost, then measure duplicate-side-effect protection.

This directory will hold the experiment protocol, deterministic fault plan, analyzers, and experiment tests.

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
