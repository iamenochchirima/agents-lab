# LangGraph runner adapter

`langgraph-runner.ts` implements the generic `PlatformRunner` interface without importing Python, FastAPI, or LangGraph SDK types into the common server.

It owns:

- the platform-local HTTP client and request timeout;
- strict validation of health, start, inspection, and cancellation responses;
- stable `langgraph:<run-id>` execution references;
- mapping of native `unknown` outcomes to a `reconciliation_required` Lab result; and
- conversion of source-sequenced service events into generic event intents.

For a session turn, the adapter prepares the shared Lab context snapshot before the
HTTP dispatch. It sends the session ID, turn ID, immutable snapshot ID, compaction
revision, and context-window metadata across the Python boundary. It does not copy the
prepared message list into native metadata. The Python service reads that snapshot from
the shared context root, rejects stale metadata, and does not rebuild or compact the
transcript independently.

If the shared context budget requires compaction, the adapter uses a bounded summary
request before dispatch. Fake model profiles use a deterministic extractive summary
for reproducible tests. OpenRouter profiles call the selected model with the server's
credential and timeout settings. Summary calls are not retried after dispatch because
the provider may have accepted the request even when the response was lost.

If the LangGraph service reports `LANGGRAPH_CONTEXT_OVERFLOW`, the common run service
invokes the optional LangGraph recovery method once. The adapter forces a new shared
compaction snapshot, submits a new native execution on the same thread with a
deterministic recovery identity, and keeps its native events under a separate safe
source name. A second overflow or a failed recovery remains an explicit provider
failure; it does not loop.

The adapter is registered by the common server alongside the other first-wave
baselines. The registration still does not imply that the Python service is
reachable: `checkConnection()` reports that dependency state, while the runner
preserves the platform's native execution and reconciliation semantics.
