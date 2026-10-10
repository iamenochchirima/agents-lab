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
provider state. Denial requires a subsequent successful read after the persisted
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
