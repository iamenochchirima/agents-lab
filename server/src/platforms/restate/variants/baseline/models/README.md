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
