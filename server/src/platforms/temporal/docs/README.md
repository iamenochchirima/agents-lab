# Temporal implementation notes

Status: implementation in progress.

These notes describe decisions that are specific to the Temporal platform
integration. They are not a replacement for the server boundary documentation
or for Temporal's own operational documentation.

## Current notes

- [`local-development.md`](local-development.md) — local Temporal prerequisite,
  persistence caveat, and the current implementation status.

## Intended boundary

The Fastify control plane accepts and records a Lab run. It does not execute
Temporal workflow code. The Temporal runner adapter starts, cancels, and
inspects a workflow through the Temporal client. The worker registers the
workflow and its activities. The baseline variant defines the first single-turn
agent workload.

Temporal owns durable workflow history and recovery for an in-flight execution.
The control plane owns the Lab's normalized evidence files. A workflow may
retain ordered event intents for reconciliation, but it must not write
`lab/runs/` directly.

## What is not implemented yet

The directory currently contains documentation scaffolding for the platform and
its variants. The following remain implementation work:

- the typed runner adapter and Temporal client connection;
- the registered worker and deterministic workflow;
- the model activity and its failure classification;
- control-plane evidence reconciliation; and
- the API/UI path that submits and observes a real run.

The active implementation plan is the source of truth for that work:
[`lab-server-temporal-baseline.md`](../../../../../development/implementation-plans/active/lab-server-temporal-baseline.md).
