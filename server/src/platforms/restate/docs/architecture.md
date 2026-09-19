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

## Session and turn boundary

The browser and shared context layer own conversation continuity. Restate owns the
durable execution of one admitted turn:

| Identity | Owner | Meaning |
| --- | --- | --- |
| `sessionId` | browser and `ContextSessionStore` | one conversation and transcript |
| `clientTurnId` | browser and admission store | one user-submission intent and retry key |
| `runId` | Lab server | one evidence directory and runner execution |
| `agentlab:<runId>` | Restate runner | one native Workflow key |
| invocation ID | Restate | one accepted native invocation |
| snapshot ID | `ContextService` | one prepared model input |

The Restate service receives the prepared context contract and returns event intents;
it does not append transcript messages or write `lab/runs`. This prevents a Restate
replay from becoming a second source of truth for session state.

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

## Terminal write order

The common server projects a durable result in this order:

1. Admit and persist the context turn and user message.
2. Persist the immutable run manifest and `RunCreated` event.
3. Submit the Workflow using the run-derived key.
4. Persist the redacted native execution reference.
5. Reconcile native event intents and write the result.
6. Write trajectory, metrics, context snapshot, and terminal context settlement
   idempotently.

If a process stops between these boundaries, the next read uses the retained run and
native reference to reconcile. A missing or ambiguous native execution becomes
`reconciliation_required`; it is not silently replaced with a new turn. A terminal
Lab result is retained even if the native Workflow later expires.

## Native and normalized evidence

The runner keeps the service name, handler, workflow key, optional invocation ID,
submission outcome, native status, retry count, safe endpoint labels, and stable error
codes in the native execution reference. The common evidence store owns persistence
and deduplication. The HTTP boundary also appends bounded operator records to
`logs/operations.jsonl` for create, recovery, and cancellation requests. Those records
contain request identity, safe status classifications, native status, timing, and error
codes only; prompts, output, credentials, and arbitrary native payloads are excluded.
The workflow emits monotonic event intents, but the common store remains responsible
for recorded sequence numbers.

## Official references

- [TypeScript services and workflows](https://docs.restate.dev/develop/ts/services)
- [Serving TypeScript services](https://docs.restate.dev/develop/ts/serving)
- [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Error handling](https://docs.restate.dev/guides/error-handling)
- [TypeScript testing](https://docs.restate.dev/develop/ts/testing)
- [TypeScript SDK clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)
- [Invocation introspection](https://docs.restate.dev/services/introspection)
- [Managing invocations and cancellation](https://docs.restate.dev/services/invocation/managing-invocations)

The baseline intentionally does not use a Restate Virtual Object for chat sessions.
That would introduce a different concurrency and interaction model and belongs in a
separate experiment rather than being mixed into this run-oriented comparison.
