# Controlled connected-tool acceptance

This scenario exercises a fictional release dispatch board through MCP and an
independent handbook through the HTTP adapter. The tool names and schemas are
scenario data; native agent loops and chat approval components need no edits.
The dispatch provider stores one record per disposable namespace under ignored
`lab/runs/.connected-fixture`. It does not connect to an account or notify people.

The real-model driver checks retrieval, an approved owner assignment, a corrected
assignment, denial without effects, and an observed missing-record error. Retrieval
must include skill activation and both sources. Approved changes require two
successful record reads and one actual mutation, plus independently inspected
provider state. At least one verification read must complete after the final
successful mutation; two pre-reads cannot establish verification.
Denial requires a subsequent successful read after the persisted
review decision. An error requires a failed tool event and its provider code in a
retained receipt. Native completion or an unchanged fixture alone cannot pass.

From `server/`:

```sh
pnpm run dev:connected-fixture
```

Start an isolated control plane with `AGENTLAB_API_PORT=4322`,
`AGENTLAB_CAPABILITY_HOST_URL=http://127.0.0.1:4322`,
`AGENTLAB_CAPABILITY_PACKAGES=<repo>/lab/scenarios/connected-tools/packages.json`,
`AGENTLAB_CAPABILITY_STATE_ROOT=lab/runs/.connected-proof/management`,
`AGENTLAB_CONNECTED_CAPABILITIES_ENABLED=true`,
`AGENTLAB_NATIVE_EXECUTION_TIMEOUT_MS=180000`, and
`AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS=120000`. Give the server and all native
workers the same absolute run/context roots and host endpoint. Follow each
platform's setup guide for its native service; enable the Vercel baseline only
after its connected capability path is ready. Preserve existing user services.
The execution deadline does not override every adapter's model-call timeout.
For example, Vercel defaults to a 30-second model-call timeout; set
`AGENTLAB_VERCEL_WORKFLOWS_MODEL_TIMEOUT_MS` explicitly when a comparison needs a
different allowance. Retain each admitted run's `platformConfig` rather than
assuming all native timeout and retry controls are identical.

Then, from `server/`:

```sh
pnpm run eval:connected -- --api http://127.0.0.1:4322 \
  --platforms mastra,temporal,langgraph,restate,vercel-workflows \
  --scenario ../lab/scenarios/connected-tools/scenario.json
```

The driver validates the exact free model against a fresh catalog and uses the
`agent-capabilities-live` experiment's zero-price routing and 2048 output tokens.
It does not choose a paid fallback. One session per platform retains context
between stages. Failed observations and independent state remain under
`lab/runs/.connected-proof`; normal native run records retain model calls,
snapshots, reviews, results and receipts. Unknown effects stop the observation.
The fixture has a deliberately narrow contract, not production concurrency or
exactly-once guarantees.

Automatic decisions are **scripted local-fixture approvals**, limited to the
scenario's declared operation, namespace and exact owner/key values. They verify
native continuation, not the frontend. A separate human walkthrough must approve
or deny the controlled proposal in chat; record that evidence separately. Do not
point the automatic driver at a personal connector or weaken its loopback check.

For a shared catalog refresh check, add a read-only operation through the existing
management API and verify its schema on a later run while an earlier retained
snapshot remains unchanged. Run that shared check once rather than multiplying
it by every platform. The management/source lifecycle tests provide independent
contract coverage; list their actual command and result in milestone evidence.

The actual management rediscovery check uses a live local MCP source whose schema
changes. It checks that the managed profile publishes the changed schema on a
later catalog admission, preserves the earlier snapshot, and performs no provider
operation during discovery:

```sh
pnpm exec tsx --test --test-name-pattern='saved PAT discovers' \
  tests/management/service.test.ts
```

Use `--model` for an explicitly separate approved free-model comparison. Keep
the original report when a model fails to submit a proposal, invents a successful
verification, or receives a rate limit. A provider rejection does not measure
task decisions, and a model's completion text does not establish tool execution.
Do not combine successful stages from different models into a claimed single
end-to-end pass.

For an explicitly separate continuation, use `--continuation continuation.json`
alongside `--platforms` and `--model`. The JSON is an array with one entry per
selected platform:

```json
[
  {
    "platform": "restate",
    "sourceReport": "/absolute/path/to/retained/summary.json",
    "startStage": "deny",
    "feedback": "The approved correction is already saved. Continue with the remaining task; do not repeat it."
  }
]
```

The driver retains the original namespace/session, validates independent provider
state against the earlier observation, rejects pending reviews, and refuses to
replay an applied mutation. It does not skip a missing retrieval or denial pass.
A confirmed approved effect may be preserved despite a later model-response
failure; that exception is recorded separately from task success. Continuation
uses a new turn identity and records corrective feedback and prior model/run
references. Its verdict covers only the selected remaining stages. A provider
429 stops the continuation without another trial or fallback.
