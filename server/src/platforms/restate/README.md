# Restate platform

This directory contains the `restate/baseline` platform implementation.

The baseline is one Restate Workflow keyed by `agentlab:<runId>`. The workflow owns
the durable model step and returns normalized event intents, trajectory, metrics, and
the terminal result. The runner adapter owns submission, inspection, cancellation,
and safe mapping of Restate-native identity and status into the Lab runner contract.

The common server remains the owner of Lab evidence files. This platform never writes
`lab/runs/` directly and never places provider credentials in workflow input or native
references.

Status: platform-local implementation complete; shared server registration is a
separate primary-agent integration step. Until that handoff is made, this directory
can be tested directly and the generic server will not advertise Restate as runnable.

Start with:

- [architecture](./docs/architecture.md)
- [local development](./docs/local-development.md)
- [semantics](./docs/semantics.md)
- [baseline variant](./variants/baseline/README.md)
