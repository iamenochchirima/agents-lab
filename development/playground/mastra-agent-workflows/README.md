# Mastra agent and workflow playground

This is a hands-on inspection path for the Mastra platform implementation. It is
separate from automated tests, scenarios, experiments, and product documentation.
Use it to observe one direct agent turn, one calculator turn, and one native workflow
suspend/resume cycle through the browser and the retained evidence.

## Start the local profile

No Docker is required. From the repository root:

```bash
./scripts/run_local_stack.sh
```

The normal stack starts the web app at `http://127.0.0.1:5173` and the Lab server at
`http://127.0.0.1:4318`. Mastra baseline is process-local. Mastra workflow uses the
file-backed LibSQL path configured by `AGENTLAB_MASTRA_STORAGE_PATH` and defaults to
`lab/mastra/mastra-workflows.db`.

## Inspect the baseline agent

1. Open `http://127.0.0.1:5173/platforms/mastra/chat`.
2. Select an OpenRouter model from the model picker, or use the deterministic model in
   automated tests.
3. Send a short prompt and open **Run details**.
4. Expand **Native execution** and inspect `native/mastra.json`.
5. Confirm the context panel shows token usage and remaining percentage.
6. Send a second message and compare the session continuity and context evidence.

For a calculator turn, enable the calculator capability in the run setup and send:

```text
Calculate 17 plus 25 and explain the result.
```

Observe the tool request, validation, execution, and result events before the final
assistant response.

## Inspect suspend and resume

1. Select the `Mastra workflow` variant in the run setup.
2. Send:

   ```text
   [approval] Prepare a short launch announcement.
   ```

3. Confirm the run is `Waiting for approval` and does not have a terminal result.
4. Inspect the native workflow state and the retained run ID.
5. Click **Approve and resume**. The existing run should complete; a second run must
   not be created.

For a restart exercise, stop the Lab server while the workflow is suspended, restart
the stack with the same `AGENTLAB_MASTRA_STORAGE_PATH`, reload the run URL, and resume
the same run. This demonstrates local snapshot recovery only; it does not claim
multi-process or managed-database durability.

## Inspect evidence from the shell

Use the run ID shown in Chat:

```bash
RUN_ID='replace-with-the-run-id'
curl -sS "http://127.0.0.1:4318/api/runs/${RUN_ID}" | jq .
curl -sS "http://127.0.0.1:4318/api/runs/${RUN_ID}/evidence/native/mastra.json" | jq .
```

The retained run contains normalized `config.json`, `events.jsonl`, `context.json`,
`trajectory.json`, `metrics.json`, and, after confirmed terminal completion,
`result.json`. Native details remain in `native/mastra.json`. Keys, authorization
headers, raw provider responses, and unrestricted prompts are not retained there.

## Deliberate limitations

- The workflow storage profile is local, file-backed, and single-process.
- Mastra Memory and durable-agent cache/pub-sub are not enabled in this platform wave;
  the Lab context snapshot remains the comparable context source.
- Real model output and usage depend on the selected provider and are not a benchmark.
- If the workflow database is missing or corrupt, the UI reports workflow availability
  honestly while the baseline remains independently usable.
