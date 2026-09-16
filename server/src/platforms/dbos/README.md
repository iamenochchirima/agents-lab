# DBOS platform

This directory contains the DBOS baseline: a TypeScript workflow host backed by
PostgreSQL and an adapter that exposes it through the Lab runner contract.

DBOS owns workflow state and step records in PostgreSQL. The Lab server owns the
normalized evidence projection under `lab/runs/`; the DBOS service never writes that
directory directly.

Start with [`docs/local-development.md`](docs/local-development.md) and
[`docs/semantics.md`](docs/semantics.md).

The baseline uses `@dbos-inc/dbos-sdk@4.27.6` and executes the selected OpenRouter
model inside a DBOS workflow step. It does not claim exactly-once provider calls:
PostgreSQL makes workflow progress durable, but an external model call still needs
explicit idempotency or reconciliation. Fake models remain deterministic test
fixtures.
