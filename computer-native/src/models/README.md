# Models

Owns provider adapters, request transport, streaming, model selection, provider
normalization, usage accounting, and model-specific retry classification. It presents a
stable model-interaction contract to the runtime without deciding the wider agent
lifecycle or context contents.

Keeping this boundary separate makes it possible to measure model quality independently
from harness behaviour and to replace a provider without changing the agent loop.
