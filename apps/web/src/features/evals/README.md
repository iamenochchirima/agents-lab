# Agent evals

`/evals` reads recent retained evaluation summaries and browses the baseline
specification. The page never starts evaluations. Refresh reloads the latest 25
invocations from `GET /api/evals?limit=25` on the existing lab control-plane server,
configured by `VITE_AGENTLAB_API_URL` and defaulting to port 4318.

Filter saved results by live or scripted execution. Expand a trial to inspect its
failure reason and open retained verdicts, assertions, trajectories, model/tool
events, and context through the existing run-evidence API. Blocked trials with no
admitted run show their reason without invented evidence links. Empty results and
an unavailable server remain explicit. Interrupted or malformed summaries show an
incomplete invocation, without a fabricated pass. The API scans at most 500 index
entries, returns at most 50 invocations, bounds each summary to 256 KiB, rejects
linked files/directories, and projects safe fields rather than raw configuration
or local evidence paths. Summaries describe observed development
trials; their counts do not establish platform reliability or complete readiness.

Below the saved results, select core harness, real-model, or platform capability
cases, search, and expand a case to inspect task and acceptance criteria. Group
selection is retained in the URL.

The canonical source is `lab/scenarios/platform-agent-conformance/eval-cases.md`,
imported as text at build time. `evalModel.ts` reads its three-column case tables
so frontend criteria and Docs use the same saved specification. Case rows have
stable B/M/X IDs; literal pipes must be escaped. Invalid or duplicate rows fail
explicitly. Research and protocol links use existing Docs routes. Temporary
implementation plans are not published by this feature.

Validate from the repository root:

```bash
pnpm --filter @agent-harness-lab/web run build
pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalModel.test.ts
pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalResults.test.tsx
git diff --check
```

The result rendering check covers retained pass/fail/blocked outcomes, reasons,
safe API evidence links, absence of local filesystem paths, and an empty list.
Runtime model results require separate live execution evidence.
