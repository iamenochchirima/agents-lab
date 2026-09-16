# Computer Native tests

Tests for runtime, security, workspace, tool, and environment behavior belong here.
They must run independently of Agent Harness Lab.

The first terminal slice is validated from this package directory with:

```bash
pnpm run typecheck
pnpm test
```

The test suite uses the deterministic local provider for repeatable success, failure,
timeout, cancellation, persistence, and restart cases. It never needs a real provider
credential.
