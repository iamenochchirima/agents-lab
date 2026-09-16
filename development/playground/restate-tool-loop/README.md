# Restate tool-loop playground

This is a hands-on learning walkthrough for the first real tool-enabled platform
slice. It is separate from automated tests, scenarios, experiments, and published
run evidence.

## Run it

1. Start the local Restate server, the TypeScript service, and the Lab server by
   following [`local-development.md`](../../../server/src/platforms/restate/docs/local-development.md).
2. Register `AgentLabRestateBaseline` with the local Restate server.
3. Open the Restate Chat page in the Lab UI and choose an OpenRouter model that
   advertises tool support. For a deterministic check, use the server API or the
   in-process fixture tests with `fake-tool-call`.
4. Submit a prompt such as `Calculate twenty plus twenty-two.`.
5. In the run details, identify `ModelRequested`, `ToolCallRequested`,
   `ToolCallValidated`, `ToolExecutionStarted`, `ToolExecutionCompleted`, the
   second `ModelRequested`, and the terminal events.
6. Inspect `lab/runs/<run-id>/events.jsonl`, `metrics.json`, `trajectory.json`,
   and `result.json`. Compare the normalized event order with the Restate Admin
   invocation and workflow journal.

## Failure exercises

The deterministic model fixtures make the boundary observable without a provider
key:

- `fake-tool-malformed` — calculator validation returns a tool-role error and the
  repeated malformed response eventually reaches the round limit;
- `fake-tool-unknown` — the disabled name is rejected before execution;
- `fake-tool-duplicate` — the response fails closed because the calls cannot be
  paired safely;
- `fake-tool-loop` — the configured model-round limit stops the loop.
- `fake-tool-call-delay` — the calculator round completes, then the continuation
  model request pauses for fifteen seconds so a controlled service interruption
  can be tested.

For cancellation, select `fake-delay`, start a run, cancel it while it is active,
and poll until Restate returns `RunCancelled`. The UI should show cancellation
only after that terminal observation. If an evidence write is made unavailable,
the UI should show a stale projection and retain the last recorded run state;
restore the path and poll again to observe reconciliation.

Run the focused checks with:

```bash
cd server
node --import tsx --test tests/capabilities/tools.test.ts tests/platforms/restate/models.test.ts tests/platforms/restate/workflow.test.ts
```

The Docker-backed integration test is opt-in. It is the check for actual Restate
journaling/replay; the in-process test only verifies the workflow handler's
observable contract and does not replace that integration test.

## Questions

- Which values are normalized by the shared registry, and which remain provider-specific?
- Why does each model round and calculator execution have its own durable action name?
- Which failures can be retried safely, and which are ambiguous after dispatch?
- Where can you inspect the final tool count without reading raw provider payloads?
