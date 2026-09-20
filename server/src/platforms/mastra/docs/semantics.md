# Mastra execution semantics

The Lab exposes two Mastra variants. They share model selection, typed tools, and the
Lab-owned context contract, but they do not make the same durability claims.

## What this variant is

The baseline owns one in-process call to Mastra's `Agent.generate()`. The Lab run ID
is the execution identity. Mastra does not provide a durable workflow identity for
this direct call, so the adapter exposes a safe process-scoped reference:

```json
{
  "platform": "mastra",
  "variant": "baseline",
  "executionId": "mastra:<lab-run-id>",
  "native": {
    "mastraVersion": "1.66.0",
    "operation": "agent.generate",
    "processScoped": true,
    "storage": "none"
  }
}
```

This is not a Mastra workflow run, snapshot, memory thread, or crash-durable
execution.

## Workflow variant

`mastra/workflow` uses the native Mastra workflow engine with a typed approval step and
model step. The workflow run ID is the Lab run ID in the local profile, while the
opaque execution reference retains the workflow ID and storage profile. A prompt that
starts with `[approval]` suspends before the model step; the browser's approval action
calls `POST /api/runs/:runId/resume` with `{ "approved": true }` and continues the same
native run.

Workflow snapshots are persisted by Mastra's `LibSQLStore` at the configured local
file path. A replacement runner can inspect a suspended or completed native run from
that file. The Lab evidence store still owns normalized evidence and context
projection. A local file does not provide safe concurrent multi-process ownership, so
the profile is explicitly single-process.

## Lifecycle and evidence

When a session turn is supplied, the adapter first prepares the Lab-owned context
snapshot and passes its messages to Mastra. The snapshot ID, token budget, pressure,
and compaction flag are recorded in `ContextPrepared`. If the budget is due, the
selected Mastra model performs the summary call for a real provider profile; fake
profiles use a bounded deterministic extractive summary. The current direct baseline
does not use Mastra Memory or Storage, and it does not adopt in-flight work after a
process restart.

The adapter emits safe event intents in this order for a normal call:

```text
AgentStarted
ContextPreparationStarted
ContextPrepared
ModelRequested
AgentStepCompleted (when Mastra reports a completed step)
ToolCallRequested / ToolCallValidated / ToolExecutionStarted / ToolExecutionCompleted (when a tool is used)
ModelCompleted
AgentCompleted
RunCompleted
```

The common evidence store deduplicates those source sequences and writes the normalized
result, trajectory, and metrics. The adapter never writes `lab/runs/` directly.

## Failure and cancellation

- Configuration and missing OpenRouter credentials fail before dispatch.
- The baseline sets Mastra `maxRetries: 0`; it does not silently repeat a model call.
- A provider rejection after dispatch is recorded as a provider failure when the
  adapter can classify it safely.
- A sent request whose result cannot be confirmed is `outcome_unknown`, not a made-up
  success or retry.
- Cancellation uses the in-memory `AbortController`. If Mastra returns an empty output
  after an abort, the run is recorded as cancelled. If a non-empty response wins the
  cancellation race, the observed response remains the terminal result.
- A timeout after dispatch is recorded as `outcome_unknown` because the provider may
  have received the request.

## Restart and process loss

The execution registry, promise, abort controller, and terminal result live in the
runner process. Replacing the runner loses in-flight execution state. Inspection of a
retained reference then returns not-found to the common server, which projects
`reconciliation_required` without inventing completion.

There is no orphan adoption, replay, or automatic restart in the baseline. The workflow
variant is the separate storage-backed suspension/resumption profile described above.

## Deliberately excluded features

- automatic workflow replay or orphan adoption
- Mastra memory and storage
- MCP, skills, plugins, OAuth, channels, and external side effects
- distributed workflow storage and multi-process ownership
- exactly-once provider-call claims

These exclusions keep the direct-agent comparison honest. Mastra's official docs
describe storage-backed memory and workflow snapshots separately from a bare direct
agent call:

- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)
