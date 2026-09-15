# Restate baseline architecture

## Boundary

```text
Lab request
  -> RestateBaselineRunner
  -> Restate ingress: workflowSubmit(input, key = agentlab:<runId>)
  -> AgentLabRestateBaseline.run
  -> durable ctx.run("model.request")
  -> workflow result and workflow state
  -> runner inspection
  -> common Lab evidence projection
```

The Restate server is the durable execution system. It owns the journal, replay,
workflow routing, retry scheduling, invocation status, and workflow-scoped state.
The TypeScript service is replaceable process code. It must be safe to stop and
restart because its process memory is not the source of truth.

The common server is outside this directory's ownership. It receives only the generic
runner values: a `PlatformExecutionReference`, status, event intents, result,
trajectory, and metrics. It writes `config.json`, `events.jsonl`, `trajectory.json`,
`metrics.json`, `result.json`, and `native/restate.json`.

## Workflow choice

The baseline uses a Workflow rather than a Basic Service or Virtual Object because a
run needs a stable key, one durable request/response result, and a place to retain a
small lifecycle snapshot. It does not add signals, awakeables, or multiple handlers
until a later variant needs them.

## Durable boundary

The provider request is inside `ctx.run`. Timestamps are obtained from the Restate
context, and the model adapter receives the attempt-completion signal so a cancelled
attempt does not keep an external request running unnecessarily. The adapter returns
safe model output, usage, provider request ID, or a classified failure. Raw provider
responses and authorization headers never become workflow output.

The workflow key is the idempotency identity. The runner retries an ambiguous
submission with that same key and treats `PreviouslyAccepted` as the existing
workflow. The external model call is not described as exactly once: a request may be
sent before its acknowledgement is lost.

## Native and normalized evidence

The runner keeps the service name, handler, workflow key, optional invocation ID,
submission outcome, native status, retry count, safe endpoint labels, and stable error
codes in the native execution reference. The common evidence store owns persistence
and deduplication. The workflow emits monotonic event intents, but the common store
remains responsible for recorded sequence numbers.

## Official references

- [TypeScript services and workflows](https://docs.restate.dev/develop/ts/services)
- [Serving TypeScript services](https://docs.restate.dev/develop/ts/serving)
- [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Error handling](https://docs.restate.dev/guides/error-handling)
- [TypeScript testing](https://docs.restate.dev/develop/ts/testing)
- [TypeScript SDK clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)
- [Invocation introspection](https://docs.restate.dev/services/introspection)
