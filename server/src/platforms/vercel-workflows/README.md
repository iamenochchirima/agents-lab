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
