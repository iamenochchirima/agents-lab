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
