# Restate baseline harness variant

The baseline is a bounded model/tool turn executed by the Restate Workflow
`AgentLabRestateBaseline.run`. A text-only model response completes in one model
round. A model response that requests the enabled pure `calculator` tool runs one
or more named durable tool actions, feeds each result back as a provider tool
message, and then requests final text.

## Runtime

- Node.js 22 or newer.
- `@restatedev/restate-sdk` and `@restatedev/restate-sdk-clients` `1.17.0`.
- Pinned native Restate server binary `1.7.10` for the default local profile;
  the pinned Docker profile is optional.
- Workflow retention defaults to seven days.
- Workflow and model-step retry limits are explicit and bounded. Safe
  pre-dispatch model retries are separate durable actions, so `attemptCount`,
  `modelAttemptCount`, and retry events describe the normalized attempts that
  occurred. Restate-native action re-execution after a worker crash remains a
  platform-level recovery detail and is retained in native evidence.
- The Platform UI selects `openrouter/<model>` from the shared model catalog. The
  service reads `OPENROUTER_API_KEY` only inside its process; fake model names are
  reserved for deterministic tests. `fake-tool-call-delay` is a deterministic
  recovery fixture that pauses the continuation model request; it is not a
  production provider.

## What it proves

Each model request and calculator execution runs inside a separate durable
`ctx.run` step. Restate owns the journal, workflow key, replay, bounded action
retries, invocation lifecycle, and workflow state. The Lab runner owns only the
submission/inspection boundary and the common evidence projection.

The tool loop records requested, validated, rejected, policy-denied, started,
completed, failed, and cancelled lifecycle events. It caps the number of model
rounds and logical tool executions. Calculator failures stop the run; malformed
or unknown calls can be returned to the model as bounded tool-role error results
when the provider call can still be paired safely.

## Context continuity

When the common manifest includes a session and turn, the workflow prepares the
canonical filesystem-backed context snapshot in a named `ctx.run` action before
the first model request. The snapshot includes the system instruction and
admitted transcript, records its budget and compaction result as normalized
events, and supplies those messages to the Restate model adapter. The control
plane remains responsible for admitting and settling the turn; Restate owns
durable preparation and the model/tool loop for that invocation.

The shared tool capability in the manifest is authoritative. An explicit empty
tool list disables the baseline calculator instead of silently re-enabling it.
Requests without the shared capability field retain the baseline calculator
default for backwards-compatible native tests and local exercises.

## What it does not prove

This is not a complete professional agent. It has no side-effecting tools, skills,
memory, MCP, OAuth, plugins, streaming, or business integrations. It does not
claim exactly-once execution for an external model provider. A transport failure
after dispatch is represented as `outcome_unknown`. The current Restate workflow
does not yet expose provider-overflow recovery or a platform-native context
store. Context preparation uses the Lab's canonical store as a durable action;
it does not make filesystem writes transactional with the external model call.
When a provider returns usage, the run retains it in normalized metrics without
treating it as a substitute for the canonical context store.

See the [local development guide](../../docs/local-development.md) and
[semantics](../../docs/semantics.md).
