# Infrastructure

Contains local and experimental infrastructure definitions.

Infrastructure should be optional when possible, explicit when required, and documented with startup, shutdown, persistence, and failure behaviour.

Current infrastructure integrations include:

- `compose/`: shared local service composition.
- `observability/`: tracing, logging, metrics, and telemetry inspection.
- `restate/`: local Restate runtime support.
- `temporal/`: local Temporal runtime support.
- `vercel/`: optional Vercel services and deployment support.

Vercel infrastructure is separate from the `platforms/vercel-ai-sdk/` implementation.
The platform directory describes SDK behaviour; this directory describes hosted
services, authentication, deployment, quotas, resource limits, and failure conditions
when those services are part of an experiment.
