# Human approval scenario

A synthetic agent chooses one protected owner-assignment tool call. The native
runtime must suspend before provider dispatch and retain the exact arguments and
call identity. No business-agent specialization or filesystem tool is required.

## Inputs, controls and grader

The fixture uses the `review-agent` capability profile and a fake scripted provider
through the actual native SDK/workflow. The provider-shaped write increments an
independent fixture counter. The model asks to assign fictional owner Avery;
separate turns request a declined assignment and cancellation while waiting.

X04 requires all eleven checks in
[`extension-contracts.ts`](../../../server/src/evals/extension-contracts.ts): zero
pending effect, exact arguments, native and host recovery, retained native identity,
zero effect on expiry, renewal without inference/dispatch, one approved effect,
zero denied/cancelled effects and explicit denial feedback. Missing observations
are incomplete; a false observation fails. Merely finishing a run does not pass.

The [native review exercise](../../../server/integration-tests/native-invocation-review.test.ts)
uses the existing four baseline runners, reconstitutes the host, replaces the native
worker/service (Mastra replaces its runner), expires and renews the same request
twice, then approves it. Denial and cancellation run separately for each platform.
Mastra runner reconstruction is persisted suspension recovery, not a process-kill
claim. Restate/Temporal durable services remain running while workers restart.

## Execution and artifacts

From the repository root, with local Temporal and Restate servers running:

```sh
pnpm --filter @agent-harness-lab/lab-server run build
cd server
AGENTLAB_RUN_NATIVE_INVOCATION_REVIEW=1 AGENTLAB_TEMPORAL_ENDPOINT=127.0.0.1:17233 AGENTLAB_RESTATE_INGRESS_URL=http://127.0.0.1:28080 AGENTLAB_RESTATE_ADMIN_URL=http://127.0.0.1:29070 node --test dist/integration-tests/native-invocation-review.test.js
```

The exercise starts isolated workers, a LangGraph service and a capability host;
Python must be installed in the existing LangGraph `.local311` environment. Set
`AGENTLAB_REVIEW_PLATFORMS` to a comma-separated subset for a focused rerun.

Evidence is retained in `lab/runs/.review-proof/native-review-<uuid>/`, including
native run directories, `summary.json`, `extension-observations.json` and
`extensions.json`. A failed partial exercise retains incomplete extension evidence
rather than fabricating missing passes. The summary remains the original integration
report; the extension report is a separately versioned interpretation.

The optional observation grader makes no model or tool calls. It refuses to replace
an existing report:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx src/evals/extensions.ts /absolute/path/extension-observations.json /absolute/path/new-extension-report.json
```

This bounded scripted-native acceptance measures suspension mechanics, not model
judgment or authenticated reviewer identity. It does not establish X01 recovery
at arbitrary persistence boundaries or X02 lost external acknowledgement recovery.
