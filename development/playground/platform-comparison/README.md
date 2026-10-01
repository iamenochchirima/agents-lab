# Platform comparison playground

This is a hands-on browser walkthrough for one four-platform comparison. It is for
learning the real request, lifecycle, context, tool, and evidence boundaries. It is
not a test, scenario, experiment, or published result.

## Question

What is shared between four platform runs, and what stays owned by each platform?

## Setup without Docker

Use Node.js `23.11.1`, pnpm `10.30.1`, Python `3.12.1`, Temporal CLI `1.8.2`,
Temporal server `1.31.2`, `@restatedev/restate-sdk` `1.17.0`, `langgraph` `1.2.10`,
and `@mastra/core` `1.66.0` as the currently verified local versions.

Start Temporal once in a separate terminal:

```bash
temporal server start-dev --db-filiname /tmp/agent-harness-lab-temporal.db
```

Then start the rest of the native comparison stack:

```bash
./scripts/run_local_stack.sh
```

The launcher starts Restate, LangGraph, Vercel Workflows, the Lab server, the
Temporal worker, and the web app. It stops existing Lab-owned listeners on the
configured ports before starting them.

## Walkthrough

1. Open each priority platform tab: Temporal, Restate, LangGraph, and Mastra.
2. Open Chat, select the same OpenRouter model, send a short prompt, then send a
   second turn. Inspect the context-window percentage and the Run details disclosure.
3. Send `Calculate 40 + 2 and explain the result.` and inspect Tool activity.
4. On Mastra, choose the workflow variant and send:

   ```text
   [approval] Prepare a short launch announcement.
   ```

   Observe `suspended`, inspect the native workflow details, select **Approve and
   resume**, and confirm that the same run completes instead of creating a second run.
5. From a platform page, open Compare, select at least two priority platforms, submit
   one task, and inspect each independent result row and run link.
6. Stop one optional native dependency or use a deliberately unavailable profile.
   Repeat Compare and observe one unavailable row without a fabricated result.

## Inspect one run

Copy a run ID from Run details and inspect only that run:

```bash
RUN_ID='<run-id>'
curl "http://127.0.0.1:4318/api/runs/${RUN_ID}"
curl "http://127.0.0.1:4318/api/runs/${RUN_ID}/events?after=0&limit=100"
find "lab/runs/${RUN_ID}" -maxdepth 2 -type f -print | sort
```

Compare `config.json` with the browser selection, then inspect `context.json`,
`events.jsonl`, `trajectory.json`, `metrics.json`, `result.json`, and the platform's
native file. The `comparisonId` should match the other member runs while session IDs,
run IDs, native IDs, and evidence directories remain different.

## What to notice

- The browser calls the Lab server, not Temporal, Restate, LangGraph, or Mastra directly.
- Context usage is a projection of the Lab-owned context session; it is not a hidden
  browser transcript.
- Normalized events make common lifecycle phases comparable while native references
  retain platform-specific state.
- A missing dependency, cancellation race, or unknown provider outcome is visible as
  a non-success state.
- A successful model response does not prove identical durability or exactly-once
  provider delivery across platforms.

## Cleanup

Stop the stack with `Ctrl-C`. Temporal is intentionally left running by the launcher.
Use a separate run/context root for disposable walkthroughs:

```bash
AGENTLAB_RUN_ROOT=/tmp/agentlab-playground-runs \
AGENTLAB_CONTEXT_ROOT=/tmp/agentlab-playground-sessions \
./scripts/run_local_stack.sh
```

Do not commit generated runs, local workflow databases, screenshots, secrets, or raw
provider responses.
