# Hatchet baseline

The baseline is a single Hatchet task named `agentlab-hatchet-baseline`. It
uses Hatchet task-level retries and execution/schedule timeouts, status-based
idempotency, an embedded or remote worker host, and two model paths:

- `fake/fake-success` and deterministic failure fixtures for lifecycle study;
- `openrouter/<model>` selected in the Platform UI when `OPENROUTER_API_KEY` is
  configured; fake paths are reserved for tests and failure experiments.

The task returns the normalized result, trajectory, metrics, and task-owned
events as one JSON-safe output. Hatchet's own events remain available through
the run inspection API and are projected separately by the runner.

The component directories describe the intended ownership as the baseline grows:

`execution/` · `models/` · `context/` · `durability/` · `telemetry/` · `tests/`
