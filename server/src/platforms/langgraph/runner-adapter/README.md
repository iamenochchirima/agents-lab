# LangGraph runner adapter

`langgraph-runner.ts` implements the generic `PlatformRunner` interface without importing Python, FastAPI, or LangGraph SDK types into the common server.

It owns:

- the platform-local HTTP client and request timeout;
- strict validation of health, start, inspection, and cancellation responses;
- stable `langgraph:<run-id>` execution references;
- mapping of native `unknown` outcomes to a `reconciliation_required` Lab result; and
- conversion of source-sequenced service events into generic event intents.

The adapter is registered by the common server alongside the other first-wave
baselines. The registration still does not imply that the Python service is
reachable: `checkConnection()` reports that dependency state, while the runner
preserves the platform's native execution and reconciliation semantics.
