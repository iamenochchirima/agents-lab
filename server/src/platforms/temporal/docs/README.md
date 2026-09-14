# Temporal implementation notes

These notes describe the first Temporal-backed path in Agent Harness Lab. They
complement the [server boundary](../../../../README.md) and the [run API contract](../../../../contracts/run-api/README.md).

## Read in this order

- [Architecture](architecture.md): which process owns each decision and how data moves.
- [Semantics](semantics.md): durability, evidence, retries, cancellation, and restart behaviour.
- [Local development](local-development.md): start the dependency, run the stack, and inspect evidence.

The [active implementation plan](../../../../../development/implementation-plans/active/lab-server-temporal-baseline.md)
records the promised scope, tests, and known limits of this first slice.

## Current boundary

The Fastify control plane accepts a run request, writes the immutable Lab
manifest, dispatches `temporal/baseline`, and projects workflow event intents
into `lab/runs/<run-id>/`. The Temporal worker owns workflow execution and
model activity execution. The browser talks only to Fastify.

Temporal workflow history remains the source of truth for an in-flight workflow.
The Lab files are a separate, normalized evidence projection. A workflow never
writes those files directly.

## Current implementation

The runnable path is a single-turn prompt completion using either:

- `fake`, which is deterministic and supports controlled failure fixtures; or
- `openrouter`, which is disabled unless explicitly enabled in server configuration.

The baseline has no tools, skills, memory, integrations, side effects, or
multi-agent execution. Those capabilities belong to later variants and must not
be inferred from this slice.
