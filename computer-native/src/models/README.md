# Models

Owns provider adapters, request transport, streaming, model selection, provider
normalization, usage accounting, and model-specific retry classification. It presents a
stable model-interaction contract to the runtime without deciding the wider agent
lifecycle or context contents.

Keeping this boundary separate makes it possible to measure model quality independently
from harness behaviour and to replace a provider without changing the agent loop.

The first slice includes two adapters behind this contract:

- The deterministic local provider emits repeatable text chunks and controlled failure,
  timeout, and cancellation behaviour without using the network.
- The OpenRouter provider sends a streamed text request when explicitly selected and
  reads its credential from `OPENROUTER_API_KEY`.

The runtime retries only provider failures that happen before the first stream event,
within the configured attempt and backoff limits. A failure after text or a tool call
has been emitted is not retried because replay could duplicate visible output or obscure
an already-started side effect. Every scheduled retry is recorded in lifecycle evidence
and shown in the TUI.

## Provider contract

Concrete adapters expose capability metadata for the features they actually implement:
streaming, tool calls, structured output, vision, reasoning controls, usage reporting,
and context-window knowledge. An unknown provider context window is represented as
`unknown`; the harness still applies its own serialized request and streamed-output
limits. Custom providers used in tests may omit metadata, but the built-in factory
always validates the provider/model pairing before a turn is admitted. OpenRouter model
IDs must be namespaced (for example `nvidia/model:free` or `openrouter/free`), and the
deterministic provider must be selected with a `deterministic/` model ID.

The OpenRouter adapter records a bounded provider request identifier when the response
supplies one and measures adapter latency. These values are attached to model attempt
and completion evidence; credentials are never persisted. HTTP context-limit and
provider-refusal responses, rejected credentials, streamed refusals, empty completions,
incomplete streams, malformed stream shapes, and transport disconnects have distinct
bounded error outcomes. A disconnect before output may be retried by the runtime; a
disconnect after output is not retried because the provider may already have accepted
and partially executed the request.

Provider-reported token usage is normalized to `inputTokens`, `outputTokens`, and
`totalTokens` when present and is copied into the turn metrics and bounded lifecycle
evidence. Providers that omit usage remain valid; the harness does not infer token
counts or cost. Request/output byte observations and effective limits are recorded by
the runtime so a run can be inspected without persisting the request body or response
body.

OpenRouter rejects malformed tool-call fragment fields at the adapter boundary when the
index, ID, function name, or argument fragment has the wrong type. It reports these as
non-retryable `provider-incomplete` errors instead of allowing malformed provider data
to reach tool execution. This is a bounded contract, not validation of every provider
response field.

The adapter does not provide fallback models. If the selected provider is unavailable,
the turn fails with provider evidence rather than silently switching to deterministic
output.

## Registry and selection

`src/models/registry.ts` is the single built-in provider registry. It exposes a
credential-free summary for each supported provider, validates the model identifier, and
constructs the adapter selected by configuration. `computer-native chat` still chooses a
provider and model through `--provider`/`--model` or the development environment; the
session does not switch providers halfway through a turn. The TUI's `/models` command is
a read-only view of those choices and their declared capabilities.
