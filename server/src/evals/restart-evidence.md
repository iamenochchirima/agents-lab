# X01 native restart acceptance

X01 applies to the Temporal and Restate baseline deployments. Mastra's active
baseline generation is process-local. LangGraph persists SQLite checkpoints, but
an interrupted active run requires reconciliation rather than automatic recovery.
Their explicit suspended-review reconstruction belongs to X04; it does not imply
arbitrary in-flight generation recovery.

The existing restart integration fixtures now have an optional durable evidence
sink. Set `AGENTLAB_X01_EVIDENCE` to a **new** JSON path under
`lab/runs/.review-proof/`. The sink refuses replacement. It writes source
observations and a sibling directory containing `extensions.json` for coverage.
`AGENTLAB_EVAL_REVISION` may record the exact revision being exercised; absent
revision remains unknown. Native fixture processes and namespaces/ports are
isolated from ordinary conversations.

```sh
# From server/, after the normal build; requires a running Temporal server.
AGENTLAB_RUN_TEMPORAL_NATIVE_MCP_RESTART_INTEGRATION=1 \
AGENTLAB_TEMPORAL_ENDPOINT=127.0.0.1:17233 \
AGENTLAB_X01_EVIDENCE=/absolute/repo/lab/runs/.review-proof/x01-temporal-new.json \
node --test dist/integration-tests/temporal-mcp-restart.test.js

# Starts and stops an isolated Restate backend and service on unused ports.
AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 \
AGENTLAB_X01_EVIDENCE=/absolute/repo/lab/runs/.review-proof/x01-restate-new.json \
node --test dist/integration-tests/restate-restart.test.js
```

Each controlled SIGKILL occurs after the MCP tool completion is visible in native
state, while the following model request is dispatched and its outcome is not
persisted. One crash therefore measures two **different** persistence boundaries:
after the tool result and before the model outcome. It does not establish every
possible checkpoint boundary. Temporal safely stops with an unknown dispatched
outcome after worker heartbeat loss; Restate resumes from its journal. The same
native execution identity and completed tool result must survive replacement.
The Restate fixture separately replaces the durable server and verifies resumed
work from its retained data directory.

The fixture sets `AGENTLAB_X01_MODEL_ATTEMPTS_FILE` only in explicitly selected
fake-provider processes. Each actual synthetic provider invocation appends run ID,
model and timestamp before executing; prompts, tools and credentials are excluded.
This ledger survives process replacement and distinguishes repeated provider
invocations from normalized logical `ModelRequested` events. Temporal additionally
retains Activity attempt count from server history. Missing independent counts
leave acceptance incomplete; normalized events alone never fill that gap.

The MCP fixture independently counts provider lookup dispatches before and after
replacement. It must stay at one. Lookup is read-only: this is not a proof of an
exactly-once external write or arbitrary connected-tool idempotency. X02 owns that
separate provider contract.

A retained native acceptance pass is bounded harness evidence with a scripted
provider, not real-model decision reliability. Original incomplete reports and
failed validation attempts remain available. The source envelope has
`mode: scripted-native`; it cannot satisfy the live-model readiness gate.
