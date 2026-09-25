# Studio HTTP contract

This package contains JSON-safe schemas shared by `apps/studio-api` and
`apps/web`. It is separate from `agent-protocol` and module packages so the
browser cannot accidentally acquire runtime, storage, or provider dependencies.

The initial contract only identifies whether the Studio API is reachable. It
does not expose assembly or run operations.

```sh
pnpm --filter @agent-harness-lab/studio-http-contract typecheck
pnpm --filter @agent-harness-lab/studio-http-contract test
```
