# Lina Model Interface: provider protocols

Status: research for the graph implementation plan, not a provider implementation.
Research date: 2026-10-08. Sources are official documentation inspected on that date.
No paid calls, credentials, SDK migrations, or runtime adapters were introduced.

## Finding

Model Interface needs a versioned adapter boundary. A generic `messages` array plus
`text` response would lose tool identity, reasoning continuation, multimodal parts,
provider status, usage and cancellation evidence. The graph should expose these
responsibilities while Turn Execution retains the loop, retry allowance and final
settlement decisions. This is a design inference from the protocol differences below.

## Existing repository boundary

[`server/src/models/openrouter/README.md`](../../../server/src/models/openrouter/README.md)
and [`catalog.ts`](../../../server/src/models/openrouter/catalog.ts) define a searchable,
server-side model catalog. It returns safe model metadata and resolves context length
again at admission. It is explicitly not a completion proxy. It exposes tools as a
boolean and input/output modalities, but does not describe strict schema support,
stream event dialect, reasoning continuation, remote cancellation or effective
gateway routing. Reuse its selection evidence where appropriate; do not turn it into
a universal completion service as part of this graph task.

[`turnExecution.ts`](../../../apps/web/src/features/lina/contracts/turnExecution.ts)
already distinguishes logical rounds, provider attempts, complete/truncated/malformed
responses, retries and cancellation observations. Its invariant that incomplete
arguments cannot launch tools remains correct. The new block should expand the
existing model boundary rather than create a second owner of counters or recovery.

## Protocol families and observed differences

### OpenAI Responses and Chat Completions

Chat Completions takes and returns messages. Responses takes and returns typed items,
including messages, reasoning, calls and call results. A Responses function result
uses `function_call_output` with `call_id`; a response may contain several item types,
so collecting only `output_text` loses agent history. Instructions can be top-level
`instructions` or compatible transcript items. Keep `openai-responses` and
`openai-chat-completions` as separate protocol profiles even under one provider.
[Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)

Chat Completions supports developer/user/assistant/tool message forms and typed media
content where the chosen model supports it. Its output uses `choices`, message
`tool_calls` and `finish_reason`. Stream chunks carry `delta` rather than complete
messages. Requesting streaming usage yields a final usage-only chunk with empty
`choices`; interruption may prevent its arrival. Usage includes cached input,
reasoning and audio details. Missing usage must remain unknown rather than zero.
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

Responses emits named lifecycle, output-item, content and delta events. A text delta
is progress; it is not a completed model attempt. Track terminal response evidence
separately from individual item completion.
[Streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses)

Function schemas use JSON Schema but strict support has additional rules: objects
need `additionalProperties: false` and every property must be required, with nullable
types representing optional values. Chat Completions is non-strict by default;
Responses attempts strict normalization when possible and can fall back. Therefore
encode explicitly and retain both original catalog schema and transmitted schema,
including a transformation record. Multiple function calls can be proposed; provider
parallel-call settings do not authorize concurrent execution in Lina's scheduler.
Accumulate each streamed call independently and parse only after completion.
[Function calling](https://developers.openai.com/api/docs/guides/function-calling)

Responses can finish `incomplete` when output or context limits are reached, including
before visible text exists. Its usage can include reasoning tokens consumed during
that failed attempt. Stateless reasoning continuation uses opaque encrypted content
that must remain available for subsequent requests. Do not convert reasoning items
into invented visible reasoning or discard them during normalization.
[Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)

The cancellation endpoint applies only to responses created with `background: true`.
The background guide tells clients to terminate the connection for synchronous
responses. A request to abort and an observed cancelled response are different
records; neither implies that local tools executed zero times.
[Cancel reference](https://developers.openai.com/api/reference/resources/responses/methods/cancel),
[Background mode](https://developers.openai.com/api/docs/guides/background)

### Anthropic Messages

The default instruction location is top-level `system`; content is an ordered array
of blocks. Current Anthropic documentation also supports mid-conversation
`role: "system"` on specifically listed models, including Opus 5.5 and Opus 4.8,
without a beta header. It explicitly excludes Sonnet 5. Inline tool changes use a
separate beta header. Do not encode a blanket rule that Anthropic either always
accepts or always rejects system messages inside history. Gate those forms on the
selected protocol/model capability.
[Mid-conversation instructions and tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)

Streams contain `message_start`, indexed content-block start/delta/stop events,
message deltas and `message_stop`, with pings and possible in-stream errors.
`input_json_delta.partial_json` fragments belong to one indexed tool block;
thinking blocks can carry signatures. Message-delta usage is cumulative, so summing
each update overcounts. Preserve unknown event evidence instead of crashing merely
because a new event type appears.
[Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)

Tools use `name`, `description` and `input_schema`. A streamed `tool_use.input: {}`
is an initial placeholder, not an empty executable request. Fine-grained streaming
can emit invalid JSON; `max_tokens` can truncate a parameter. Retain fragments and
parse errors as evidence, never repair them silently into an operation.
[Fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)

Stop reasons include `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`,
`pause_turn`, `refusal` and `model_context_window_exceeded`. `pause_turn` relates to
a provider server-tool loop and is not Lina's approval wait. Tool results need their
original correlation and required placement in history. Preserve the raw reason
alongside Lina's classification; do not turn every successful HTTP response into an
answer or every refusal into a transport failure.
[Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

Anthropic's current auth guide lists Bearer API keys or workload-identity access
tokens, with `x-api-key` retained as a supported legacy fallback. Requests also carry
`anthropic-version`, and multi-workspace keys require workspace selection. SDKs can
retry internally, so a real adapter must expose or disable those retries to avoid
hidden provider attempts under the Execution budget.
[API overview](https://platform.claude.com/docs/en/api/overview)

Usage distinguishes uncached input, cache creation and cache reads. Total input is
their sum, unlike APIs whose input count already includes cached tokens. Empty
visible output can still consume output tokens. Retain raw usage with explicitly
documented accounting semantics.
[Messages reference](https://platform.claude.com/docs/en/api/typescript/messages)

Error classes distinguish invalid requests, authentication, permission, missing
resources, payload size, rate limits, server failures and overload. Responses carry
request IDs, including errors, and streaming failures can arrive after HTTP success.
The classifier should report these facts to Execution; it must not choose fallback
or retry on its own.
[API errors](https://platform.claude.com/docs/en/api/errors)

### Gemini Interactions and GenerateContent

The official overview inspected on the research date says Interactions is GA since
June 2026 and recommended for new projects; GenerateContent remains supported and
is called legacy. This is a dated provider statement, not a requirement to migrate
the agents in this repository. Interactions has typed steps and optional server
history through `previous_interaction_id`. Tools, system instructions and generation
configuration remain interaction-scoped and must be respecified. Storage defaults
and retention differ from local harness persistence; a provider conversation ID is
not a Lina checkpoint.
[Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview)

Interactions uses `input`, function definitions and `function_result` linked by
`call_id`. Its streaming protocol opens indexed steps, appends `arguments_delta`
strings and closes steps. An `interaction.completed` event can report
`status: "requires_action"`, meaning client tools need results rather than a final
answer. Usage includes input, output, cached, thought and tool-use counts in current
stream examples. Inspect the status, not the event's English name.
[Interactions streaming](https://ai.google.dev/gemini-api/docs/streaming),
[Function calling](https://ai.google.dev/gemini-api/docs/function-calling)

GenerateContent uses `contents` with user/model roles, `systemInstruction`, typed
parts such as text, inline/file data and function calls/responses, and candidate
results. Its `finishReason` distinguishes token exhaustion, safety/recitation blocks,
malformed responses and malformed or unexpected function calls. Request blocking
also has prompt feedback. Preserve candidate index and raw reasons instead of
assuming the first candidate always contains usable content.
[GenerateContent reference](https://ai.google.dev/api/generate-content)

Gemini thought signatures are opaque continuation data. For documented Gemini 3
function-call history they must be returned in the required original order; missing
signatures can reject a request. Official SDKs handle them when the full response
object is appended to history. A normalized history must retain this provider data
and avoid transferring it blindly between model families.
[GenerateContent thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)

Google documents server-side cancellation for background Interactions, with a
`cancelled` status and potentially delayed status observation during cleanup.
Deletion removes records and is a different action. This does not establish an
identical cancellation guarantee for every synchronous Gemini protocol.
[Background execution](https://ai.google.dev/gemini-api/docs/background-execution)

API keys belong on the server and have associated project restrictions. The adapter
profile should reference an account-bound credential and endpoint, not embed a key
in graph examples or browser model selection.
[Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)

There is a source inconsistency to resolve before a real Gemini adapter is built.
The migration guide shows events using `type` and usage using
`prompt_tokens`/`completion_tokens`; the streaming guide uses `event_type` and
`total_input_tokens`/`total_output_tokens`. REST examples also show different API
version paths. The graph can represent named versioned profiles now. Exact wire
schemas require a pinned SDK/API revision and reference check rather than mixing
these snippets into one supposedly authoritative JSON Schema.
[Migration guide](https://ai.google.dev/gemini-api/docs/migrate-to-interactions),
[Streaming guide](https://ai.google.dev/gemini-api/docs/streaming)

### OpenRouter as a gateway

OpenRouter normalizes provider formats but retains differences such as
`native_finish_reason`, effective provider and detailed native-tokenizer usage.
Its final streaming usage chunk currently has a nonempty content-free `choices`
array, unlike OpenAI's usage-only chunk. Do not identify OpenRouter as the upstream
model provider or assume its OpenAI-shaped endpoint has identical semantics.
[API reference](https://openrouter.ai/docs/api_reference/overview)

Routing can choose upstream endpoints and fallback. `require_parameters: true`
restricts selection to endpoints supporting requested parameters; the default can
ignore unsupported parameters. A reproducible comparison needs requested model,
effective upstream, routing policy and effective parameters recorded. Model ID
alone does not freeze all of these.
[Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

HTTP 200 can contain an error once upstream headers have been committed. Gateway
fallback can still occur before output reaches the client, but stops after partial
output arrives. In-stream errors can have `finish_reason: "error"` and a separate
typed `error_type`. Check both body/events and transport status, and retain raw
upstream evidence as allowed by the gateway.
[Error handling](https://openrouter.ai/docs/api_reference/errors-and-debugging)

Aborting a streaming connection stops remote processing and billing only for
supported upstream providers. The current documented list excludes Google and AWS
Bedrock among others; non-streaming cancellation has different behavior. Model the
local abort, capability and remote observation separately. Do not promise uniform
remote cancellation through a gateway.
[Stream cancellation](https://openrouter.ai/docs/api_reference/streaming)

## Recommended graph responsibilities

These responsibilities are a synthesis, not claims that every provider exposes an
endpoint for each node. Split by inspectable contract and decision, not by vendor.

1. Resolve a model profile before Context budgeting. Freeze provider, protocol,
   endpoint/account reference, model, capability revision, limits and parameters.
2. Check required capabilities, including modalities, tool-call support, structured
   output, reasoning continuation and cancellation mode. Unsupported requirements
   return explicit errors, not silent removal.
3. Resolve credential readiness through an account-bound reference. Storage and
   renewal remain owned by the credential service; model auth is not MCP OAuth.
4. Encode the Context snapshot and exact advertised tool revision. Maintain a
   mapping between catalog identity and provider tool names plus schema digests.
   Provider-specific schema transformations are visible and cannot weaken local
   Tools validation.
5. Dispatch only under Execution's attempt authority. Carry turn, round, attempt
   and request IDs; increment launch accounting once at the launch boundary.
6. Assemble progress into separately indexed items/candidates/calls. Keep partial
   text visible, incomplete arguments nonexecutable, and continuation data opaque.
7. Normalize a terminal observation and usage. Preserve raw reason, partial records,
   server-tool events, request/provider IDs and effective model/configuration.
8. Classify failure or cancellation certainty and return it to Execution. Execution
   chooses retry, Context refresh, explicit fallback, waiting or settlement.

The implementation plan can combine credential/profile checks or terminal
normalization/accounting if their graph contracts stay readable. Four opaque nodes
would hide too much, while a node for every HTTP header would add noise.

## Baseline and experiment boundaries

Baseline correctness includes call/result correlation, indexed stream assembly,
terminal-state checks, original provider evidence, unknown usage, explicit capability
checks, pinned request revisions and safe partial-call handling. These are required
before comparison. Retrying a generation must never redispatch an already accepted
tool operation under the same identity.

Meaningful experiments can compare provider-native versus gateway adapters, explicit
fallback policies, streaming versus buffered observation, reasoning/output budgets,
cache-compatible encoding and strict structured output where supported. Record
requested and effective parameters, cache state, transport/SDK retries and usage
semantics. They are workload-dependent comparisons, not evidence that one protocol
is universally best. Dynamic model routing and stateful provider conversation
reuse introduce extra variables and should remain opt-in comparisons.

## Evidence and remaining verification

This study verifies documentation semantics and local catalog ownership. It does
not measure latency, cost, accuracy, cancellation success, available account models
or SDK behavior against live services. Before implementing a real adapter, pin its
API/SDK version, obtain reference-derived fixtures, verify auth headers and model
capabilities, and check documented limits for that selected model/account. For the
current graph phase, use clearly labelled deterministic protocol fixtures and avoid
claiming operational provider health or remote cancellation from simulation data.
