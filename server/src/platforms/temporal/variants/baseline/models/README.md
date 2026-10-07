# models

Owns this variant's provider and model wiring.


The explicit `fake-eval-completion`, `fake-eval-tool`, `fake-eval-context`, and
`fake-eval-loop` fixtures support the four-case baseline eval. They retain the
actual mapped request as a synthetic-only observation in the model result. The
native loop publishes `EvalModelObserved` with the request and returned tool
calls, and `EvalToolObserved` with each actual dispatch result. Ordinary fake
fixtures and ordinary real-provider runs emit neither capture. These observations exercise
request assembly and tool feedback; they do not measure model reasoning quality.
The loop fixture keeps requesting calculator calls so the native call and round
limits determine its terminal result.

## Live eval requests

The `agent-harness-live` experiment opts into the native `liveEval` input.
Only these synthetic runs retain bounded `EvalModelObserved` receipts with
mapped messages, tool definitions, the actual provider request body, returned
tool calls, output, and provider request/model/provider identifiers when returned.
Authentication headers are excluded. Provider failures retain the attempted
request and error code. `EvalToolObserved` records actual dispatch output.

Live requests use the selected approved free model, a 512-token output limit,
zero price ceilings for every supported billing dimension, parameter requirements,
and disabled provider fallback. The native model loop still decides and executes
its tool steps. Provider failures and context overflow end the trial without
an automatic retry or a paid substitute. Ordinary interactive runs keep their
existing provider configuration and telemetry.
