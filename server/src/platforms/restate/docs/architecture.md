# Restate baseline architecture

## Boundary

```text
Lab request
  -> RestateBaselineRunner
  -> Restate ingress: workflowSubmit(input, key = agentlab:<runId>)
  -> AgentLabRestateBaseline.run
  -> durable ctx.run("model.request.<round>")
  -> durable ctx.run("tool.execute.<round>.<call>.<stable-id>")
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

The provider request is inside a named `ctx.run` action. The calculator is inside a
separate named `ctx.run` action. Timestamps are obtained from the Restate context,
and both adapters receive the attempt-completion signal so a cancelled attempt does
not keep work running unnecessarily. The workflow passes only serializable model
messages and tool definitions into those actions, validates and authorizes calls
before execution, and appends a matching tool-role result before the next model
round. Raw provider responses, tool arguments beyond safe metadata, and
authorization headers never become normalized workflow output.

Tool definitions are shared because schema validation, call identity, risk vocabulary,
and result limits have the same meaning across platforms. Durable execution remains
under this directory because Restate's journal, action names, retry policy, and
cancellation signal are platform-specific. A future platform adapter can reuse the
shared contract without importing this workflow.

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
- [Managing invocations and cancellation](https://docs.restate.dev/services/invocation/managing-invocations)
