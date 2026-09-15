# LangGraph runner adapter

`langgraph-runner.ts` implements the generic `PlatformRunner` interface without importing Python, FastAPI, or LangGraph SDK types into the common server.

It owns:

- the platform-local HTTP client and request timeout;
- strict validation of health, start, inspection, and cancellation responses;
- stable `langgraph:<run-id>` execution references;
- mapping of native `unknown` outcomes to a `reconciliation_required` Lab result; and
- conversion of source-sequenced service events into generic event intents.

The adapter is deliberately not registered in the common platform registry by this scoped change. Registration, configuration, and the shared local launcher belong to the primary integration handoff described in the implementation plan.
