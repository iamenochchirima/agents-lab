# Agent evals

`/evals` is the read-only baseline specification browser, linked from the main
sidebar. Select core harness, real-model, or platform capability cases, search,
and expand a case to inspect its task and acceptance criteria. Group selection
is retained in the URL. The page does not execute evaluations or show pass results.

The canonical source is `lab/scenarios/platform-agent-conformance/eval-cases.md`,
imported as text at build time. `evalModel.ts` reads its three-column case tables
so frontend criteria and Docs use the same saved specification. Case rows have
stable B/M/X IDs; literal pipes must be escaped. Invalid or duplicate rows fail
explicitly. Research, protocol, and implementation links use the existing Docs
routes and curated navigation.

Validate from the repository root:

```bash
pnpm --filter @agent-harness-lab/web run build
pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalModel.test.ts
git diff --check
```

Validation on 2026-10-07: web typecheck/build and both specification-reader tests
passed. Browser verification covered all three groups, case expansion, empty
search results, search reset on group change, and the full specification in Docs.
The existing build warning about large chunks remains. No evaluation run was
started and no platform acceptance result is inferred from these UI checks.
