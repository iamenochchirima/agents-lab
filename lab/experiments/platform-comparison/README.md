# Four-platform comparison

## Question

Can the Lab submit one workload to Temporal, Restate, LangGraph, and Mastra while
keeping each platform's execution, context session, lifecycle result, and native
evidence independent?

This experiment studies harness behaviour at the Lab boundary. It does not compare
the quality of generated text and it does not claim that the four platforms have the
same durability guarantees.

## Hypothesis

The shared run contract can normalize admission, context, tools, status, and evidence
without merging platform state. A partial failure should leave successful members
inspectable and an unknown provider outcome should remain unknown.

## Workload and controls

Each selected platform receives the same task, model identifier, scenario, experiment,
tool capability, context policy, and comparison identity. Each member receives a
different session ID, client-turn ID, Lab run ID, native execution identity, and
evidence directory.

| Case | Input | Control |
| --- | --- | --- |
| Prompt | A short response request | No tool call required |
| Calculator | `Calculate 40 + 2 and explain the result.` | Only the shared calculator is enabled |
| Continuation | Two turns in one Chat session | Same member session, new turn ID |
| Unavailable | Disable one platform dependency before dispatch | Other members remain runnable |
| Cancellation | Stop an active run | Provider dispatch ambiguity is not retried |

Deterministic browser fixtures and platform fixtures are used for repeatable automated
coverage. They cross the production server, runner, tool, context, and evidence
boundaries but do not call OpenRouter. Manual acceptance uses the selected OpenRouter
model and non-sensitive prompts.

## Procedure

1. Start the native local stack without Docker:

   ```bash
   temporal server start-dev --db-filename /tmp/agent-harness-lab-temporal.db
   ./scripts/run_local_stack.sh
   ```

2. Open `http://127.0.0.1:5173/platforms/temporal` and use Chat to run the prompt,
   calculator, and second-turn cases on each priority platform.
3. Open Compare, select at least Temporal, Restate, LangGraph, and Mastra, choose one
   OpenRouter model, and submit the same task.
4. Inspect every row independently. Follow its run link and inspect the run details,
   context usage, tool activity, normalized evidence, and native reference.
5. Stop or misconfigure one platform service, repeat Compare, and confirm only that row
   is unavailable or failed.
6. Record the exact model, runtime versions, service commands, run IDs, observed
   statuses, and evidence paths. Never record the API key, authorization header, raw
   provider response, or sensitive prompt.

## Automated validation

Run the deterministic checks from the repository root:

```bash
pnpm --filter @agent-harness-lab/lab-server typecheck
pnpm --filter @agent-harness-lab/lab-server test
pnpm --filter @agent-harness-lab/web typecheck
pnpm --filter @agent-harness-lab/web build
node --test apps/web/tests/browser/platform-chat.browser.test.mjs
```

The live UI check is opt-in and requires the native services and
`OPENROUTER_API_KEY`:

```bash
AGENTLAB_RUN_LIVE_PLATFORM_UI=1 \
AGENTLAB_LIVE_PLATFORM_IDS=temporal,restate,langgraph,mastra \
node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
```

## Evidence

Each member remains a normal run:

```text
lab/runs/<run-id>/
  config.json
  context.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  logs/operations.jsonl
  native/<platform>.json
```

`comparisonId` correlates members but is never used as an evidence directory or
session identity. `RunEvidenceStore` is the only writer for normalized evidence.
Native references retain platform-specific IDs and status without prompts, outputs,
credentials, headers, or unrestricted workflow state.

## Interpretation limits

- Provider output and usage vary by model and are not a quality benchmark.
- Mastra baseline is process-local; Mastra workflow uses local single-process LibSQL.
- LangGraph owns checkpoint state in its local Python service.
- Restate and Temporal retain their own native execution histories.
- No automatic provider fallback or blind retry is inferred from a successful row.
- Docker is not required for the four-platform local profile; optional platform
  services outside this profile may remain unavailable.

## Current validation record

The implementation plan records the exact commands and timestamped validation results:

[`platform-cross-comparison-acceptance.md`](../../development/implementation-plans/platforms/completed/platform-cross-comparison-acceptance.md)
