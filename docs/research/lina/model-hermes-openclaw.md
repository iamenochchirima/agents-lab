# Model Interface in Hermes and OpenClaw

Reviewed 2026-10-08. This is a source study for Lina's proposed Model Interface block, not an implementation or a performance comparison.

## Evidence and revisions

| Evidence | Revision | Coverage |
| --- | --- | --- |
| Hermes local reference | `0e21933114c911075782d5744cee5403996d38ae` | Runtime resolution, transport conversion, stream assembly, response intake, error recovery and usage records |
| OpenClaw local reference | `912685f442286233fbbd40762482d98598299497` | Model resolution, normalized stream protocol, Chat Completions terminal validation and host recovery |
| Hermes current upstream HEAD | `a28a5d03a9fa60418db5f44f3436fa2aa029c8f2` | Four downloaded source files matched the local bytes: transport base/types, client lifecycle and runtime provider resolution |
| OpenClaw current upstream HEAD | `bcc3b58b7c614209c6ce01358087c40cca4aeaf1` | Downloaded model resolution, normalized types, Chat Completions stream assembly and fallback attempt files. These differ from the local reference |
| Official documentation | Accessed 2026-10-08 | Model selection, runtime compatibility, fallback policy and Hermes API-mode configuration |

HEADs were read from the official Git remotes without updating either checkout. The pinned citations below identify which version supports each claim. Earlier Lina studies used older revisions and should not be read as an audit of these newer snapshots. Two additional Hermes current-source downloads received HTTP 429 responses, so the detailed stream and error-classifier claims remain explicitly tied to the local pin.

No provider requests, upstream tests, cancellation experiments or latency measurements were run. Source inspection establishes mechanisms and ownership, not their measured reliability or performance.

## Hermes

### Route resolution and encoding

Hermes distinguishes provider identity, API mode and endpoint. Requested provider precedence is explicit argument, saved configuration, environment, then automatic resolution. A provider profile can declare endpoint, authentication mode, models, vision support, tool-message media compatibility and provider-specific classification hooks. This argues for a resolved route record rather than identifying an adapter using only a model name. [Runtime resolution](https://github.com/NousResearch/hermes-agent/blob/a28a5d03a9fa60418db5f44f3436fa2aa029c8f2/hermes_cli/runtime_provider.py#L490-L502), [provider profile](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/providers/base.py#L18-L100).

The transport interface owns message/tool conversion, request keyword construction and response normalization. Its documented boundary excludes client construction, credential handling, interrupts and retry ownership. Chat Completions, Anthropic and Codex Responses therefore have different encoders even when the rest of the agent uses a common conversation representation. [Transport boundary](https://github.com/NousResearch/hermes-agent/blob/a28a5d03a9fa60418db5f44f3436fa2aa029c8f2/agent/transports/base.py#L1-L44).

Each attempt rebuilds provider-specific reasoning echo and prompt-cache decoration. If a destination rejected images, its request view can become text-only while the stored history retains the images. Request middleware and hooks inspect the resulting payload before dispatch. These are explicit transformations that Lina should record, rather than silently changing canonical context. [Attempt request preparation](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/turn_api_request.py#L93-L164).

Current configuration documentation also separates a delegation provider from its wire protocol. Nonstandard endpoints may require an explicit `api_mode`; the provider name alone does not settle encoding. [Official configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/).

### Streams, completion and malformed calls

Hermes prefers streaming even without a display consumer because the stream supports health checks. Some external-process and configured routes disable it. Streaming therefore belongs to invocation lifecycle, not just the UI animation. [Stream selection](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/turn_api_call.py#L47-L107).

Chat Completions assembles calls by stream index, accumulates raw argument text and tracks the provider finish marker. A dropped stream is never repaired by closing its JSON prefix: syntactically valid JSON could omit arguments that never arrived. Repair is allowed for some malformed arguments after finish evidence, and the result carries `args_repaired`. Missing finish evidence plus incomplete arguments becomes a dropped-stream outcome instead of an executable empty call. An output-length terminal is classified separately. [Assembly and completion guard](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/chat_completion_helpers.py#L3306-L3404), [repair examples](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tests/agent/test_streaming_tool_call_repair.py#L1-L43).

Normalized responses retain text, calls, finish reason, optional reasoning and usage. Opaque provider fields preserve Codex response/call identity, Gemini thought signatures and ordered Anthropic thinking blocks. Those fields are replay requirements, not interchangeable text summaries. Missing call IDs can be filled by the agent before persistence. [Normalized records](https://github.com/NousResearch/hermes-agent/blob/a28a5d03a9fa60418db5f44f3436fa2aa029c8f2/agent/transports/types.py#L1-L105).

### Recovery, cancellation and accounting

Request-local OpenAI clients set SDK `max_retries` to zero because the agent owns retries, credential rotation and fallback. Error classification distinguishes auth, permanent auth, rate limits, aggregator upstream limits, context overflow, malformed formats and protocol-specific compatibility failures. The classification returns recovery hints. Context overflow requests compression rather than ordinary model fallback. [Client retry ownership](https://github.com/NousResearch/hermes-agent/blob/a28a5d03a9fa60418db5f44f3436fa2aa029c8f2/agent/client_lifecycle.py#L441-L452), [classified errors](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/error_classifier.py#L34-L90).

Fallback restarts the outer preparation boundary so the replacement model's context window is checked. Truncated tool arguments, truncated text, incomplete reasoning and Codex incomplete responses follow different continuation policies. Lina should preserve these distinctions without copying Hermes's retry counts. [Error owner and reprepare](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/turn_api_error.py#L52-L62), [response intake](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/turn_response_intake.py#L120-L199), [truncation owner](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/turn_truncation.py#L1-L42).

Interrupt monitoring attempts to shut down the active request socket and waits for worker settlement. User interruption is explicitly different from a network failure. The transport's abort signal does not prove the provider stopped generating or that billing is zero. Usage accounting keeps input/output, cache reads/writes, reasoning tokens and raw provider usage in a richer canonical record than the simple normalized response usage class. [Interrupt settlement](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/chat_completion_helpers.py#L3898-L3922), [canonical usage](https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/usage_pricing.py#L55-L94).

## OpenClaw

### Model metadata and route identity

OpenClaw separates logical provider/model selection from runtime transport/auth configuration. Resolution uses scoped prepared runtime data, model registry and provider runtime hooks. Current upstream adds explicit cancellation and generation-currentness checks during asynchronous resolution, and says catalog metadata must not override captured configured transport without the proper owner. [Current model resolution](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/src/agents/embedded-agent-runner/model.ts#L37-L202).

Its model record includes API family, provider, endpoint, reasoning mapping, input modalities, context window, effective runtime context cap, output limit, media limits and compatibility settings. The request options carry a request ID separately from session ID and prompt-cache affinity. Optional settings may be ignored by some providers, so Lina should record effective settings and their support status. [Current shared types](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/packages/llm-core/src/types.ts).

The current official docs distinguish a browsable model catalog from selection policy, credential readiness and runtime compatibility. Explicit user selections can be strict even when configured defaults allow fallback. Runtime fallback is turn-local and does not silently repin the next turn. [Model selection](https://docs.openclaw.ai/concepts/models), [fallback policy](https://docs.openclaw.ai/concepts/model-failover).

### Stream records and tool readiness

The normalized stream protocol has start, text/reasoning/call start-delta-end events, then done or error. `toolcall_delta` carries a preview; `toolcall_end` carries a completed call. Assistant records retain requested and concrete response models, provider response ID, replay state, diagnostics, stop reason and an optional explicit continuation flag. Usage records mark cache and final-context telemetry unavailable when it was not reported. [Current normalized stream and result types](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/packages/llm-core/src/types.ts).

Chat Completions accumulates raw arguments independently of partial JSON previews. At completion it checks cancellation before promoting provisional calls. A missing required finish marker fails the stream. The pinned terminal finalizer rejects missing names, missing raw argument buffers and malformed terminal JSON; it removes calls from non-tool outcomes. Merely showing a parseable preview never authorizes execution. [Current stream barrier](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/packages/ai/src/transports/openai-completions-stream.ts#L566-L644), [pinned finalizer](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/packages/ai/src/providers/openai-completions-tool-calls.ts#L232-L305).

The common contract distinguishes ordinary parallel batches from provider-completed asynchronous calls that can run before generation ends. The latter requires host capability. Lina can model ordinary complete-response parallel calls now and leave early execution as a deliberate later experiment. [Async execution contract](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/packages/llm-core/src/types.ts).

### Host recovery

Shared text options state that built-in transport retries belong to the host runner. The pinned attempt recovery code can continue the owned transcript containing partial output and completed tool work rather than resubmit the original user request. It distinguishes external aborts, tool execution timeouts, provider failures and context overflow. Replay safety and settlement evidence control eligible recovery. [Retry contract](https://github.com/openclaw/openclaw/blob/bcc3b58b7c614209c6ce01358087c40cca4aeaf1/packages/llm-core/src/types.ts), [pinned attempt recovery](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/embedded-agent-runner/run/attempt-recovery.ts#L285-L377).

Current documentation confirms bounded same-model recovery before eligible account rotation or fallback, with transcript continuation and cancellation available. It distinguishes local transcript conflicts from provider failures. These docs are current product policy, not proof that every provider adapter and plugin route has identical behavior. [Official recovery policy](https://docs.openclaw.ai/concepts/model-failover).

## What Lina should represent

These recommendations are inferred from the source evidence, not a cross-provider standard.

| Model Interface responsibility | Suggested graph representation |
| --- | --- |
| Resolve selected route and adapter | Resolve model route, keeping selection source and candidate identity |
| Obtain usable credential authority | Resolve model authentication through the shared credential owner; secrets stay outside graph records |
| Determine supported settings and inputs | Check model capabilities, preserving metadata provenance and unknowns |
| Project admitted context into provider format | Encode provider request, preserving tool schema/binding revisions and opaque replay compatibility |
| Check final request | Validate encoded request, including output allowance and provider/media limits |
| Execute one physical call | Invoke model with attempt identity, deadlines and cancellation |
| Accumulate provider output | Assemble model stream with provisional text/calls, terminal evidence and usage availability |
| Return durable semantic evidence | Normalize model outcome, retaining response identity and provider-specific records |
| Select a subsequent action | Existing Turn Execution recovery/decision nodes consume classified failure or continuation evidence |

Do not add a Model Interface retry owner on top of Turn Execution. Auth/profile rotation and model fallback must be explicit decisions whose target route then re-enters capability checks and Context preparation. Context compaction remains Context work. Tool schema authorization and argument admission remain Tools work. Output delivery owns externally published text. State owns durable attempt and transcript commitment.

Required contract distinctions include logical turn, logical model round, physical attempt, candidate route and stream sequence; complete calls versus previews; provider finish state versus terminal lifecycle settlement; reported usage versus unavailable usage; requested model versus actual response model; and preserved replay state versus portable canonical conversation.

Suggested fixtures include text completion, mixed text and multiple calls, interleaved call arguments, malformed terminal JSON, missing finish marker, output truncation, provider refusal, unknown finish reason, unsupported image/tool schema, auth failure, rate limit with retry delay, overflow, cancellation before/during streaming, failure after visible output, late events from a superseded attempt and unavailable usage. Unknown finish reasons should remain inspectable rather than being silently promoted to success, even though some Hermes transport mappings default unknown reasons to stop.

## Defaults and experiments

Completion barriers, call IDs, faithful tool schemas, cancellation routing and one retry owner are correctness requirements. They should not be presented as optional performance experiments.

Useful experiments later include provider transport choices on compatible routes, bounded argument repair versus rejection, stable cache layout, effective reasoning/output allocation, constrained-output modes, fallback policy and early execution of provider-completed asynchronous calls. Each comparison must hold task/model controls explicit. Different API representations alone do not prove an advantage.

## Limits to preserve in the implementation plan

The study audits selected text-model paths, not every provider, external process or plugin harness. It does not establish universal multimodal support, exactly-once inference, remotely confirmed cancellation, portable encrypted replay state or safe retry after arbitrary side effects. Initial Studio implementation should use honest deterministic fixtures, without calling providers or storing credentials. Full real adapters require provider-specific contract tests and an explicit persistence owner later.
