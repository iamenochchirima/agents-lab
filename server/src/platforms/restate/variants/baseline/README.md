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

## What it does not prove

This is not a complete professional agent. It has no side-effecting tools, skills,
memory, MCP, OAuth, plugins, streaming, or business integrations. It does not
claim exactly-once execution for an external model provider. A transport failure
after dispatch is represented as `outcome_unknown`. The current Restate workflow
does not yet own the shared session-context preparation path; context continuity
and compaction remain a separate platform integration step. When a provider
returns usage, the run retains it in normalized metrics without treating it as a
substitute for the canonical context store.

See the [local development guide](../../docs/local-development.md) and
[semantics](../../docs/semantics.md).
