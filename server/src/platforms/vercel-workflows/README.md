# Vercel Workflows platform

This directory contains the Lab's `workflow` SDK baseline. It is separate from the
Vercel AI SDK: the Workflow SDK owns durable execution, while the model call is one
explicit Workflow step.

The local profile runs a compiled standalone Workflow bundle against
`@workflow/world-local`. The local World stores run data as JSON and delivers queued
messages through the local service's flow route. The service is a learning and
reproducibility profile; it is not a claim that a local process provides Vercel's
managed production durability.

The Platform UI selects an OpenRouter model from the shared server catalog. The
provider request runs inside the explicit Workflow step; fake models remain
available only as deterministic test fixtures.

Start it from this directory with:

```sh
pnpm install
pnpm run dev
```

The default readiness endpoint is `http://127.0.0.1:9094/ready`. The runner adapter
is exported from `index.ts` and registered by the shared server bootstrap. The local
Workflow service remains an optional process because it is not part of the default Lab
stack.

Further reading:

- [baseline](variants/baseline/README.md)
- [local development](docs/local-development.md)
- [execution semantics](docs/semantics.md)
- [hosted profile](docs/hosted-profile.md)
- [official Workflow repository](https://github.com/vercel/workflow)

## Live task input

The native Workflow intercepts only the admitted `ask_user` descriptor from
`agentlab/task-interaction`. A persisted step creates the exact question and registers
a native hook before publishing its suspended state. An exact reply wakes that hook
and is read from the authenticated interaction host; hook replay and local service
replacement retain the original Workflow run, question and absolute deadline.
A durable sleep races the wait against that deadline.

Ordered steering is consumed in native steps at model, completed-response, review
and per-call dispatch boundaries. Steering wakes a question or review hook, cancels
the obsolete question and closes all remaining proposals before another model round.
Live instructions, exact clarification answers and recalled factual memory are
protected during compaction. Wake delivery metadata is retained separately from the
question and action-review lifecycle; retries cannot create a new Workflow execution.
