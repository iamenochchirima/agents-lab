# Restate platform

This directory contains the `restate/baseline` platform implementation.

The baseline is one Restate Workflow keyed by `agentlab:<runId>`. The workflow owns
the durable model step and returns normalized event intents, trajectory, metrics, and
the terminal result. The runner adapter owns submission, inspection, cancellation,
and safe mapping of Restate-native identity and status into the Lab runner contract.

The Platform UI selects an OpenRouter model from the shared server catalog. The
model call remains inside the durable workflow step; fake models are retained
only for deterministic tests and failure experiments.

The common server remains the owner of Lab evidence files. This platform never writes
`lab/runs/` directly and never places provider credentials in workflow input or native
references.

Status: baseline implementation and shared server registration complete. Restate is
advertised as runnable when the Lab server starts, but it reports unavailable until the
local Restate runtime and registered service are reachable. The default local runtime
is the pinned native Restate server binary; Docker is an optional profile.

Start with:

- [architecture](./docs/architecture.md)
- [local development](./docs/local-development.md)
- [semantics](./docs/semantics.md)
- [baseline variant](./variants/baseline/README.md)
