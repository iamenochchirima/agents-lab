# Mastra baseline execution semantics

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

## Lifecycle and evidence

The adapter emits safe event intents in this order for a normal call:

```text
AgentStarted
ModelRequested
AgentStepCompleted (when Mastra reports a completed step)
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

There is no orphan adoption, replay, or automatic restart in this variant. Mastra
workflow snapshots and storage-backed suspension/resumption are deferred to a later
variant.

## Deliberately excluded features

- Mastra workflows and snapshots
- Mastra memory and storage
- tools, MCP, skills, plugins, OAuth, channels, and external side effects
- multi-turn threads and durable resume
- exactly-once provider-call claims

These exclusions keep the direct-agent comparison honest. Mastra's official docs
describe storage-backed memory and workflow snapshots separately from a bare direct
agent call:

- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)
