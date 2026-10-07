# models

Owns this variant's provider and model wiring.

## Recoverable connected read feedback

A known failed `fixture_lookup` or `mcp_fixture_lookup` returns its real bounded
error content to the native Mastra continuation. Tool observations and failure
events remain retained. Write failures, unknown outcomes, cancellation and
timeouts preserve their terminal behavior. This policy does not retry the tool;
the next model step decides whether a new permitted read is useful.

The eval-owned `fake-eval-behaviour` model is admitted for an explicitly injected
synthetic model factory. The ordinary model factory does not provide a fallback.
Mastra may validate a tool schema before invoking its execute callback. The
runner observes the SDK's real step results and records rejection at that native
boundary, with zero tool dispatch. Unregistered tool requests are likewise
recorded as rejected SDK calls; the SDK can omit their feedback message, unlike
schema validation errors that it returns as correlated tool results.

Usage normalization preserves missing native counts as `null`. Mastra can
aggregate missing counts into zero, so an unmeasured zero total is not reported
as measured usage. Explicitly measured zero counts remain zero. Step evidence
reads the SDK's actual usage object rather than its scalar-only metadata reader.
