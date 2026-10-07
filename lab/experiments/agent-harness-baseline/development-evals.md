# Run the first development evals

The executable slice covers B01 response/instructions, B02 calculator feedback,
B03 two-turn context, and B07 call/round limits. The eight remaining core cases,
all live-model companions, and optional extensions remain unimplemented by this
command. One trial helps development; it does not satisfy the full protocol's
three-trial readiness gate.

## Run

From the repository root with dependencies installed:

```bash
pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform mastra
```

Mastra executes its real SDK locally. The other choices are `temporal`, `restate`,
and `langgraph`; each needs its documented native service and current code.
The driver always selects scripted models and disables connected capabilities.
It makes no live-provider call. Only the pure calculator is enabled for tool cases.

Optional arguments are `--trials 2` and `--deadline-ms 30000`. Trials must be 1–20;
the per-run observation deadline must be 100–120000 milliseconds. Each trial uses
fresh sessions and run identities. B03 shares one session across its two turns.
B07 uses separate call and round probes, requesting one call/four rounds and
eight calls/two rounds respectively. These separate probes distinguish which
budget stopped execution. B07's slow-call deadline specification is deferred.

Platform services must share the absolute `AGENTLAB_CONTEXT_ROOT` with the driver.
The command resolves default run/context paths from the repository root even when
launched through the server package. To use an existing LangGraph service:

```bash
AGENTLAB_LANGGRAPH_SERVICE_URL=http://127.0.0.1:2024 \
AGENTLAB_CONTEXT_ROOT="$PWD/lab/sessions" \
pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform langgraph
```

See the [LangGraph setup](../../../server/src/platforms/langgraph/README.md),
[Temporal setup](../../../server/src/platforms/temporal/README.md), and
[Restate setup](../../../server/src/platforms/restate/README.md). The evaluator
checks connectivity before admission. An absent service gives four blocked rows,
no fabricated runs, and a retained invocation summary. A reachable Temporal
server also needs its worker listening on the configured task queue.

## Read the result

The command prints each verdict, its report path, failed assertions, category
counts, and an invocation summary path. Exit code is zero only when every
implemented case passed. Failures, blocked services, and driver errors exit with
code one. The unimplemented cases always remain listed separately.

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  context.json
  trajectory.json
  metrics.json
  result.json
  native/<platform>.json
  artifacts/eval.json
lab/runs/.evals/<invocation-id>/summary.json
```

`artifacts/eval.json` contains schema/suite/grader versions, trial identity,
correlated run IDs, assertion verdicts and expected/observed values, and synthetic
model/tool observations. Its metadata records revision, dirty state, installed
SDK versions, native runtime versions when supplied, timestamps, and trial count.
Resolved tools, policies, context and limits remain in the ordinary configuration
and context records. A dirty revision identifies an unfinished checkout; retain
its patch separately when publishing a reproducible comparison.

B03 and B07 reports live in the first run directory and reference both runs.
The driver retains earlier evidence if a later turn fails. Reports do not rewrite
run status. In B07, a truthful failed run can produce a passing eval verdict.
Inspect `observations[0].requests` for delivered inputs, `tools` for actual
execution results, and `assertions` for the checks. Ordinary events retain the
original native receipts on Temporal, Restate, and LangGraph. Mastra's observers
capture only synthetic inputs for this evaluator and are disabled by default.

A deadline preserves the latest observed view, requests cancellation of the
admitted run, and records an error. Cancellation does not prove external rollback.
Polling never resubmits a task. Reports are bounded to 256 KiB and immutable;
summary records retain driver/storage errors when a report cannot be written.

## Inspect a passing and failing control

Set `EVAL_REPORT` to the B02 report printed by a completed invocation. This
example regrades the retained observations, then removes tool feedback from a
copy to demonstrate the failed assertion. It leaves original evidence untouched.
The negative control is a grader check, not another native run.

```bash
EVAL_REPORT=/absolute/path/to/run/artifacts/eval.json node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { gradeBaselineCase } from './lab/scenarios/platform-agent-conformance/baseline-evals.mjs';
const report = JSON.parse(await readFile(process.env.EVAL_REPORT, 'utf8'));
if (report.caseId !== 'B02') throw new Error('Choose the B02 report.');
const original = report.observations[0];
console.log('Retained result:', gradeBaselineCase('B02', original));
const control = structuredClone(original);
for (const request of control.requests) {
  request.messages = request.messages.filter(message => message.role !== 'tool');
}
const failed = gradeBaselineCase('B02', control);
console.log('Missing-feedback control:', failed.verdict);
console.log(failed.assertions.filter(assertion => !assertion.passed));
JS
```

For an actual failed eval, inspect its printed failed assertions and corresponding
observations in the same way. A correct-looking answer cannot compensate for
missing execution receipts or context. Missing observations fail rather than
being inferred from final text.

## Limits on interpretation

These scripts test the platform-owned execution path and observable contract.
They do not measure reasoning quality, live-provider reliability, recovery across
crashes, security, production readiness, or cost. No platform ranking follows
from four passing rows. The [full protocol](README.md) and
[case specification](../../scenarios/platform-agent-conformance/eval-cases.md)
remain the broader development targets.
