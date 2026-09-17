# Anesu tests

Tests for runtime, security, workspace, tool, and environment behavior belong here.
They must run independently of Agent Harness Lab.

The first terminal slice is validated from this package directory with:

```bash
pnpm run typecheck
pnpm test
```

The test suite uses the deterministic local provider for repeatable success, failure,
timeout, cancellation, persistence, and restart cases. Test files run serially because
browser fixtures, managed profiles, and process/admission tests share host resources;
this keeps the documented command reproducible under normal developer workloads. It
never needs a real provider credential.
