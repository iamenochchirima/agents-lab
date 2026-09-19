# Restate recovery walkthrough

This is a hands-on development walkthrough for inspecting one real Restate recovery
slice. It is not a test case, scenario, benchmark, or published experiment result.

## What this demonstrates

The walkthrough replaces the TypeScript service during an active Workflow, then
replaces both the service and the native Restate server while another Workflow is
active. The native server uses a temporary persistent data directory and isolated
ports, so the normal local stack is not touched.

The fixture is `fake-delay`. It makes the replacement window deterministic. It proves
Workflow/journal recovery for this local exercise; it does not prove exactly-once
execution or exactly-once billing for an external model provider.

## Run it

From the repository root:

```bash
AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run test:restate
```

The test also runs the offline Restate unit suite. To run the complete native baseline
and restart checks together:

```bash
AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 \
AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run test:restate
```

The isolated exercise cleans its temporary context and Restate data directories when
it exits. The optional Docker-backed test is separate and is not required.

## Inspect the evidence

For a browser or API run, inspect the run directory after completion:

```text
lab/runs/<run-id>/
  config.json
  context.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/restate.json
```

Compare `result.json` with `native/restate.json`. The common result explains what the
Lab concluded; the native record explains which Restate execution was observed. If
the two disagree about a terminal state, that is a defect to investigate, not a reason
to hide one record.

## Questions to ask while reading the code

- Which process owns each record, and what happens if it stops before the next write?
- Which identity is reused when a submission acknowledgement is lost?
- Which operations are safe to retry, and which external provider outcomes remain
  ambiguous?
- Where does the browser learn that a run requires recovery rather than a new prompt?

The implementation boundaries and failure matrix are documented in
[`server/src/platforms/restate/docs/architecture.md`](../../server/src/platforms/restate/docs/architecture.md)
and [`server/src/platforms/restate/docs/semantics.md`](../../server/src/platforms/restate/docs/semantics.md).
