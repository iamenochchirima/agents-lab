# Inngest baseline playground

This is a hands-on inspection path for the platform-owned Inngest baseline. It is
not a test, scenario, benchmark, or normalized run record.

## Prerequisites

Start the pinned Inngest Dev Server and the platform service as described in
[`server/src/platforms/inngest/docs/local-development.md`](../../../server/src/platforms/inngest/docs/local-development.md).

Then run:

```bash
node development/playground/inngest-baseline/run.mjs
```

The script admits and dispatches one fake prompt through the real service boundary,
then polls the service's native projection. Inspect the Inngest Dev Server at
`http://127.0.0.1:8288` to compare its event/function trace with the projection.

The script does not create a fake completed result. If the Dev Server or service is
unavailable, it exits with an error and prints the response that needs attention.
