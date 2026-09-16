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
