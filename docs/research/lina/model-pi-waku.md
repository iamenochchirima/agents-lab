# Model Interface in Pi and Waku

## Scope and evidence

Static source audit on 2026-10-08. Pi is pinned to `a276dabe57911253350bffb93cb7d7aff6a73261`; Waku is **ShenSeanChen/waku-agent**, pinned to `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`, the same projects/revisions used in the preceding Context and Tools studies. This is not WakuJS, the messaging network or another similarly named framework.

Source was read with `git show` from the existing isolated Pi bare repository and the existing Waku checkout, without changing either checkout. Pinned raw GitHub files were also opened online. No credentials, remote model requests, provider accounts or upstream test suites were exercised. Tests below are inspected evidence of intended behavior, not tests run during this audit. Statements describe the selected revisions and inspected adapters; they are not blanket compatibility guarantees.

Pi has a substantial provider/capability and normalized streaming layer. Waku deliberately exposes an Anthropic-shaped client to a small loop, translating OpenAI Chat Completions when required. Both are useful references, but Waku's smaller bridge omits information Lina should preserve.

## Responsibility map

| Area | Pi | Waku |
| --- | --- | --- |
| Resolve model | Provider/catalog runtime plus model descriptors and request auth resolution | Provider registry, settings/environment resolution and main/small model defaults |
| Encode request | API-specific codecs and shared transcript transformations | Anthropic SDK directly, or Anthropic-shaped to OpenAI Chat Completions bridge |
| Stream | Typed block lifecycle and normalized terminal events | Text deltas plus separately assembled final response |
| Terminal semantics | Explicit stop, length, tool use, error, aborted and deferred forms | OpenAI bridge infers tool use/end turn from presence of calls |
| Retry owners | Abortable adapter request retries plus session-level recovery policy | SDK policy plus token-parameter fallback and loop stream-to-complete fallback |
| Usage | Input/output/cache counts, reasoning subset and catalog-based cost | Loop records input/output totals; compatible bridge omits cache/reasoning breakdown |

These are responsibility mappings, not evidence that the two agents use Lina's proposed four node names.

## Pi

### Resolution and capability snapshots

The coding-agent `ModelRegistry` is now a compatibility facade over `ModelRuntime`; treating its old synchronous lookup API as the complete implementation would miss the runtime's provider composition, persisted catalogs, credentials, custom configuration, remote catalog wrapping and virtual model routing. Model availability and configured authentication are distinct checks. Request authentication is resolved separately from model metadata.

Sources: [registry facade](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/model-registry.ts), [runtime composition](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/model-runtime.ts), [model/provider collection](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/models.ts).

Chat model descriptors retain provider, API, base URL, supported text/image input, optional input preprocessing limits, context window, maximum output tokens, reasoning support/level mappings, cache lifetimes, compatibility overrides and price schedules. A supported model name alone is therefore insufficient to build a reproducible request. Pricing metadata is not a measured invoice, and an advertised image capability is not proof every image format/size will work.

Source: [model and request types](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/types.ts#L1096-L1142).

### Roles, tools, images and replay

The core loop performs a context transformation, converts agent messages to model messages, normalizes the transcript, resolves the current provider key and then invokes the stream function. API codecs retain distinct responsibilities after that conversion. The OpenAI codec selects system/developer instruction role according to capabilities, serializes function schemas and arguments, pairs tool results with call IDs, and moves supported tool-result images into a following image-bearing user message because the wire API does not represent them identically to Pi's tool-result block.

Sources: [loop request boundary](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L383-L412), [OpenAI message codec](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/openai-completions.ts#L1220-L1470).

Shared transformation is not lossless identity projection: it downgrades unsupported images to explanatory text, manages provider/model-specific thinking signatures, normalizes call IDs for cross-model replay, excludes error/aborted assistant messages, and inserts synthetic error results for calls without results to make replay acceptable to providers. Those repairs affect the model-visible view. Lina should preserve the canonical records and record a declared projection/repair manifest; it should not import the synthetic result as an observed tool outcome. Required media can instead fail preparation under Lina's existing policy. That is a documented design choice rather than claiming Pi always rejects unsupported images.

Source: [message transformation and synthetic replay repair](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/transform-messages.ts).

### Streaming and terminal admission

Pi defines block start/delta/end events for text, thinking and tool calls, followed by a terminal `done` or `error`. Partial response objects are mutable views, not immutable event-time snapshots. Provider setup may fail before `start`. The loop waits for the authoritative final message before deciding whether to run tools; fragment previews do not independently authorize execution.

Sources: [normalized event protocol](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/types.ts#L751-L783), [final-message consumption](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L410-L464).

The inspected OpenAI adapter retains raw finish reason and maps recognized values. It rejects an ended stream without a finish reason when the configured endpoint is expected to supply one. Explicit compatibility configuration can allow inference for endpoints that do not supply it. Anthropic stream assembly separately requires `message_stop`. These are adapter-specific completion checks, not one universal end-of-file rule.

Sources: [OpenAI completion guard](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/openai-completions.ts#L575-L723), [Anthropic stream assembly](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/anthropic-messages.ts#L470-L569).

A `length` termination is especially consequential: the agent loop refuses all tool calls in that truncated assistant message and returns per-call errors instead of executing potentially incomplete arguments. Streaming JSON parsing itself is permissive: it tries JSON repair/partial parsing and can yield an empty object. That parser is useful for previews but is not proof that final arguments are complete or schema-valid. Tools still needs final validation; Lina should retain the original argument text and any explicit repair provenance.

Sources: [truncated-call refusal](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L245-L278), [JSON parser/repair](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/utils/json-parse.ts).

### Retry, cancellation and usage

The inspected OpenAI/Anthropic adapters disable SDK retries on their underlying request and use an abortable provider-request helper. Its default retry count is zero unless configured. The helper considers provider retry headers and status classes, caps server-requested delay, and makes backoff abortable. This retry surrounds request setup; it does not automatically replay a stream after arbitrary partial generation. Session recovery has a separate bounded retry policy: it retains failed attempts in raw history, durably omits them from the model projection and waits with abortable exponential backoff. These layers must be reported together to understand the actual request count.

Sources: [adapter request boundary](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/openai-completions.ts#L365-L381), [abortable provider retries](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/utils/provider-retry.ts), [session recovery](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts#L3707-L3764).

Abort signals reach the request and retry waits, and normalized failures distinguish abort from error. This establishes local cancellation handling, not a guarantee that a remote provider stopped computation or billing.

Usage includes uncached input, output, cache reads/writes, optional long-retention writes, optional reasoning tokens and cost. Reasoning is a subset of output, so adding it again double counts. The OpenAI adapter subtracts cache counts from prompt totals when forming uncached input. Anthropic maps separate cache read/creation fields. Cache retention preferences, cache-control markers and session affinity are provider capabilities/options; they are not observed cache hits.

Sources: [usage semantics](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/types.ts#L427-L447), [OpenAI usage mapping](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/openai-completions.ts#L1512-L1549), [Anthropic cache mapping and options](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/api/anthropic-messages.ts#L66-L93).

## Waku

### Provider selection and request codec

The provider registry supplies wire kind, regional endpoints, key source, default main/small model names and visibility. `models_for` reconciles settings/environment overrides and rejects recognized model-family mismatches. `get_client` applies the same resolution used by settings views, isolates hosted scoped credentials/endpoints from global BYOK overrides, and configures an explicit model-call timeout. This is useful consistency/account isolation, but the inspected resolver does not expose Pi-like per-model context/media/reasoning capability descriptors.

Source: [provider/model resolution](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L243-L333).

The loop speaks Anthropic message blocks. Native Anthropic uses its SDK; `OpenAICompatClient` converts system text, assistant text/tool-use blocks, tool-result IDs and tool schemas to Chat Completions. Nonstream responses parse function arguments with `json.loads`; malformed JSON raises. It preserves tool-call `extra_content` for Gemini thought-signature replay, with a dedicated deterministic test. The codec's non-assistant list branch processes tool-result dictionaries; it does not implement a general user image/audio/file block conversion. Therefore the bridge cannot be assumed to preserve arbitrary multimodal Context payloads merely because an endpoint accepts Chat Completions.

Sources: [wire bridge](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L336-L443), [signature replay test](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/evals/deterministic/test_models.py#L91-L113).

### Stream assembly and gaps

The compatible stream accumulates text and tool argument fragments by stream index, exposes text deltas, and constructs final tool-use blocks after consumption. Unlike its nonstream path, the reviewed stream assembly does not retain tool-call extra content/thought signatures. It does not preserve or validate `finish_reason`; both compatible response paths infer tool use/end turn from whether tool calls exist. A length-limited answer may consequently look like a normal final answer. Malformed accumulated arguments raise during final `json.loads`; absent arguments are parsed as `{}`. No explicit incomplete-stream terminal guard was found in this bridge.

Source: [compatible stream owner](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L453-L517).

The loop appends a returned assistant message, executes its tool-use blocks, and treats absence of calls as a final answer. It does not check truncation before dispatch in the reviewed path, including native Anthropic responses. The missing terminal distinctions are a gap for Lina to address, not a pattern to copy. This is static evidence of missing guards; no malformed/truncated live response was sent.

Source: [loop admission](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L79-L145).

### Retry, cancellation and accounting

Waku has several retry/fallback layers. SDK clients retain their own retry policy because construction does not override `max_retries`. The bridge retries a request with the alternate output-token parameter only when the exception message names `max_completion_tokens` or `max_tokens`. The loop also falls back from a failed streaming call to a fresh nonstream call for exceptions without a 4xx status. Four-hundred-class responses are rethrown; SDK handling of rate limits remains separate. Inspected tests cover 401 refusal and 500 fallback. This should not be simplified to “Waku retries every error” or “Waku never retries 4xx.”

Sources: [client and token parameter fallback](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L324-L409), [loop fallback](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L79-L112), [fallback/error tests](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/evals/deterministic/test_model_errors.py).

A late stream failure can already have emitted preview text before the replacement request. The loop has no explicit attempt identity/retraction protocol in those text notifications, and records usage only for the final successful response. Fallback therefore creates an accounting/UI ambiguity and can incur additional provider work. The reviewed synchronous loop has no cooperative cancellation parameter; `_OpenAIStream.__exit__` does not explicitly close its iterator. Timeout is not the same as cancellation. Hosted process/gateway cancellation was not audited, so this does not establish that the entire Waku product cannot be stopped.

The compatible bridge normalizes prompt/completion counts and defaults absent usage to zero; cache details, reasoning breakdown and raw usage provenance are not retained in that normalized response. The loop's `llm` event exposes only input/output totals, including on native Anthropic where its SDK may provide richer usage. Lina should represent unavailable usage explicitly, and account for abandoned/retried attempts separately.

Sources: [stream accumulation and usage](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/models.py#L453-L517), [observed usage event](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L65-L114).

## Lina implications ready for node design

| Proposed Model Interface node | Required contract detail derived from this audit |
| --- | --- |
| Resolve model binding | Provider/API/model/endpoint/account reference; auth availability separately; immutable capability/config revision; context/output/media/reasoning/cache constraints; resolver origin and explicit unknown capabilities. No raw credentials. |
| Encode provider request | Exact Context snapshot and tool-catalog binding; declared role/media/call-ID transformations; original-to-wire mapping; provider replay/signature metadata kept opaque and scoped; rejected required media or explicitly approved fallback; request digest and codec revision. |
| Invoke provider attempt | Logical round versus attempt IDs; SDK/adapter retry budget and actual subattempt records; stream previews correlated to the attempt; request timeout, abort signal and terminal completion evidence; partial usage/artifacts retained on interruption. No tool execution from fragments. |
| Normalize provider response | Raw and normalized terminal reason; complete versus length/error/aborted/incomplete; final text plus all calls; original/final argument text and explicit repair record; opaque replay metadata; usage availability, source and cache/reasoning detail; no invented observed outcomes. |

Execution owns whether another logical attempt is allowed, whether to reprepare Context, and whether a complete tool batch can proceed. Model Interface owns the actual wire attempt and exposes any lower-level retries. Tools owns final registered-schema validation and effects. Context owns source selection and complete request budgeting. Streaming preview is an observation, not a final answer or a settled tool request.

Baseline graph cases should include: ordinary final text; mixed text and complete calls; fragmented arguments; valid JSON with invalid registered schema; length-limited calls refused before dispatch; stream interruption after visible text; missing terminal marker; malformed final arguments; authentication refusal; retryable setup failure with bounded attempts; cancellation during request/backoff; provider switch with opaque metadata scoped correctly; unsupported required media; and usage with cache hits versus missing usage. Exercise Auto and Next with the same deterministic scripted trace. These fixtures do not measure live provider latency, cost or compatibility.

Experiment candidates, after that baseline exists: compatible encoding choices, cache retention/affinity where supported, streaming versus completion for UI latency, and bounded recovery policies under controlled failures. Complete-message gating, exact call/schema identity, explicit truncation, credential isolation and usage provenance are baseline requirements, not experiments that justify losing those guarantees.

## Limitations and open verification

- No live provider conformance or end-to-end upstream tests were run.
- Pi has additional Responses, Google, Bedrock and other codecs; this audit sampled its shared records and OpenAI/Anthropic paths, not every adapter.
- Waku's hosted proxy, routing graph and browser-agent cancellation behavior are outside this model-loop audit.
- Neither catalog metadata nor source comments prove advertised provider support, cache duration, billing cancellation or measured performance.
- SDK retry defaults and provider wire specifications should be pinned explicitly when Lina chooses concrete adapters. The graph must expose the configured policy rather than relying on an unrecorded library default.
