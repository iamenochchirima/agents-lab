# Agent protocol

`@agent-harness-lab/agent-protocol` contains only concepts that carry the same
meaning across module areas: module identity, run scope, JSON evidence values,
capability descriptors, and the common event envelope. Module operations and
their data stay in the owning module package.

Cancellation uses the platform `AbortSignal`; this package does not create a
second cancellation abstraction. Capability descriptors describe available
operations, but do not grant access to the underlying service.

```sh
pnpm --filter @agent-harness-lab/agent-protocol typecheck
pnpm --filter @agent-harness-lab/agent-protocol test
```

The package has no runtime dependencies. Its exported declarations and small ID
constructors are built to `dist/`; generated output is not checked in.
