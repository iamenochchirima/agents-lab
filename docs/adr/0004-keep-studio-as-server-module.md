---
status: accepted
---

# Keep Studio as a module family in the Lab server

Studio will use the existing Lab server process and Fastify application while
remaining a separately owned module family. Its routes, domain records, runtime
assembly, strategies, and evidence store will live under a Studio namespace and
will not use the Platform Lab control-plane services as their execution model.

This preserves one local server, one deployment path, and shared low-level server
infrastructure without making Studio a platform runner or coupling it to the
existing Platform Lab run lifecycle.

## Considered options

- **Create a second Studio server:** rejected for the first implementation because
  it would duplicate process management, configuration, observability, and local
  setup before a separate process is needed.
- **Add Studio behaviour to the existing control plane:** rejected because the
  current control plane owns platform dispatch and reconciliation, while Studio
  owns neutral component experiments and a different comparison lifecycle.
- **Keep Studio as its own module family in the existing server:** accepted because
  it provides a real ownership seam without adding deployment noise. A separate
  process can still be introduced later if a production isolation requirement
  makes that necessary.

## Consequences

The server bootstrap will compose both systems through explicit registration. Studio
will use a `/api/studio/` route prefix, its own configuration and evidence namespace,
and its own domain contracts. Shared code is limited to infrastructure and semantics
that genuinely mean the same thing in both systems. Existing Platform Lab routes,
platform registries, runner adapters, and run records remain behaviourally unchanged.
