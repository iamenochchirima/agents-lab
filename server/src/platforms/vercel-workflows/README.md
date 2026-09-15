# Vercel Workflows platform

This directory contains the Lab's `workflow` SDK baseline. It is separate from the
Vercel AI SDK: the Workflow SDK owns durable execution, while the model call is one
explicit Workflow step.

The local profile runs a compiled standalone Workflow bundle against
`@workflow/world-local`. The local World stores run data as JSON and delivers queued
messages through the local service's flow route. The service is a learning and
reproducibility profile; it is not a claim that a local process provides Vercel's
managed production durability.

Start it from this directory with:

```sh
npm install
npm run dev
```

The default readiness endpoint is `http://127.0.0.1:9093/ready`. The runner adapter
is exported from `index.ts`; the shared server does not register it until the primary
integration work adds the platform wiring.

Further reading:

- [baseline](variants/baseline/README.md)
- [local development](docs/local-development.md)
- [execution semantics](docs/semantics.md)
- [hosted profile](docs/hosted-profile.md)
- [official Workflow repository](https://github.com/vercel/workflow)
