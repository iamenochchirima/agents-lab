---
status: accepted
---

# Use a layered monorepo for the laboratory

Agent Harness Lab will use one repository organized around the laboratory's concepts, with a generic control plane, isolated harness implementations, reusable scenarios, reusable experiments, canonical schemas, and a separate React/Vite application. Harness variants may use different languages or platform dependencies, but they must connect through explicit interfaces and recorded run contracts.

We chose this shape over separate repositories because the research value comes from comparing implementations under the same scenario, experiment, telemetry model, and evidence format. We chose a concept-oriented top level over a single framework-oriented tree because scenarios and experiments must remain reusable across harnesses. We will keep platform-specific code local and add shared modules only when multiple implementations establish a real seam.

## Consequences

The repository will need clear dependency rules and contract tests. Platform dependencies may need isolated environments. The web application will consume published schemas and run records instead of importing harness code. This structure gives contributors one place to reproduce a comparison while keeping each implementation understandable on its own.
