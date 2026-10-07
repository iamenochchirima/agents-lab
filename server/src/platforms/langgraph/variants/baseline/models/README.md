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

## Behaviour milestone fixtures

`fake-eval-behaviour` is an explicitly selected synthetic fixture. Its current
user prompt contains `[eval-behaviour:<base64url JSON>]`; the decoded directive
selects `complete`, `tool`, `context`, `provider-error`, `malformed`, or `slow`.
Tool directives use `toolName` and `input`; the final response follows only an
actual matching `eval-behaviour-call-1` tool result. Context directives use
`marker` and inspect retained user content with directive envelopes removed.
They cannot pass recall by reading the hidden directive itself.

The model node retains actual request observations, including controlled
provider rejections. Slow fixtures use `delayMs` and observe native cancellation.
These probes do not change real-provider selection or provide paid fallback.

Known failed `fixture_lookup` and `mcp_fixture_lookup` reads become correlated
model feedback. Failed writes, cancellations, timeouts and unknown external
outcomes retain the native terminal policy; no uncertain write is retried by
this continuation rule.

Malformed responses pass a controlled invalid response shape through the actual
OpenRouter decoder. Its native policy reports `LANGGRAPH_OUTCOME_UNKNOWN` rather
than inventing provider rejection. The model observation records
`faultKind: malformed` independently of that original failure category.
