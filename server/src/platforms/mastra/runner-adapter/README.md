# Lab runner adapter

`mastra-runner.ts` adapts one direct Mastra `Agent.generate()` invocation to the
Lab's generic `PlatformRunner` interface. It owns only process-local execution state;
the common evidence store remains the writer of normalized run files.

The adapter deliberately does not register itself in the shared server bootstrap. That
registration requires a separate composition-owner change to the root dependency and
bootstrap files.
