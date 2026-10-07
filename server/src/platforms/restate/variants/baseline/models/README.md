# models

Owns this variant's provider and model wiring. The adapter translates between the
provider-neutral `ModelMessage` contract and OpenRouter's chat-completions shape.

For a tool round, the first request contains the enabled function definition. The
assistant response may contain `content: null` and structured `tool_calls`. The
next request preserves the assistant call ID, function name, JSON arguments, and
the matching `tool_call_id` tool message. A text-only response remains valid and
does not create a tool round.

The adapter classifies a transport failure after dispatch as `outcome_unknown`;
it does not retry that request as if it had never reached the provider. Only a
pre-dispatch failure is eligible for the bounded, numbered model-attempt policy;
each safe retry is a separate durable action.
API keys stay in the service process and never enter model request bodies,
workflow input, normalized events, or results.

`fake.ts` contains deterministic test and local failure-recovery fixtures only.
The Platform UI exposes the OpenRouter catalog; a real run selects
`OpenRouterRestateModel`, while the fake adapter is selected only when a test
explicitly submits `provider: "fake"`.

Provider responses are bounded before they enter workflow state: the adapter
rejects oversized response bodies, assistant text, tool batches, call IDs,
tool names, and raw tool arguments. This protects the durable message history
from untrusted provider payloads; the registry still performs the authoritative
tool-specific validation at the execution boundary.


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

For the synthetic slow-operation deadline probe, `timeoutMs` constructs an
abortable operation deadline combined with the Restate attempt-completed signal.
The resulting timeout is journaled as a non-retryable model failure with its
request observation; this measures the local adapter operation, not an overall
Restate workflow deadline.

Provider rejection and malformed-response directives use an injected local
transport response with the actual OpenRouter adapter decoder. No external
provider request is made. The observation retains `faultKind` separately from
the original decoder error code (`OPENROUTER_HTTP_403` or
`OPENROUTER_INVALID_RESPONSE`).
