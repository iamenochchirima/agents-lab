# models

Owns this variant's provider and model wiring.

Explicit `fake-eval-completion`, `fake-eval-tool`, `fake-eval-context`, and
`fake-eval-loop` fixtures support the four-case development eval. The native model
node emits `EvalModelObserved` with its actual messages and returned calls.
The native tool node emits `EvalToolObserved` with actual dispatch results.
Ordinary fake fixtures and real providers emit neither observation.
These fixtures measure request assembly and execution, not model reasoning.
The loop fixture repeatedly requests calculator work until native limits stop it.

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
