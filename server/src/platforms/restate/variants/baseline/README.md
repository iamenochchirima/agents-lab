# Restate baseline harness variant

The baseline is a single prompt-to-model turn executed by the Restate Workflow
`AgentLabRestateBaseline.run`.

## Runtime

- Node.js 22 or newer.
- `@restatedev/restate-sdk` and `@restatedev/restate-sdk-clients` `1.17.0`.
- Local Restate server image `docker.restate.dev/restatedev/restate:1.7.10` for the
  checked-in local profile.
- Workflow retention defaults to seven days.
- Workflow and model-step retry limits are explicit and bounded.
- `fake/fake-success` is the default model path. `openrouter/<model>` is opt-in and
  reads `OPENROUTER_API_KEY` only inside the service process.

## What it proves

The model request runs inside a durable `ctx.run` step. Restate owns the journal,
workflow key, replay, retries, invocation lifecycle, and workflow state. The Lab
runner owns only the submission/inspection boundary and the common evidence
projection.

## What it does not prove

This is not a complete professional agent. It has no tools, skills, memory, MCP,
OAuth, plugins, streaming, or business side effects. It does not claim exactly-once
execution for an external model provider. A transport failure after dispatch is
represented as `outcome_unknown`.

See the [local development guide](../../docs/local-development.md) and
[semantics](../../docs/semantics.md).
