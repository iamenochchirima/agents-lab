# Model interface module

This module sends a normalized model request to a selected provider adapter and returns text, structured tool calls, provider identity, usage, and useful provider detail. Provider SDKs and credentials stay inside the implementation or host, not in the shared protocol or browser.

## Interface

`ModelInterfaceModule.generate` receives a run scope, model selection, ordered messages, optional tool definitions, provider parameters, an optional idempotency key, and an `AbortSignal`. Success returns text and/or tool calls with usage and provider identity. Failure returns a classified category, retryability, and whether dispatch was known not to happen, a response arrived, or the outcome is unknown.

```ts
const result = await model.generate({ scope, model, messages, parameters: {} }, signal);
if (result.outcome === "completed") inspect(result.response.toolCalls, result.response.usage);
```

## Lifecycle and retry semantics

The host constructs the selected adapter for the assembly and calls it per model request. Cancellation is passed to the provider client. Adapters classify failures rather than returning fabricated text. Retry only when the failure classification and provider semantics make it safe. A timeout after dispatch can mean the provider completed or billed the request; it must be marked `dispatchOutcome: "unknown"`. The default `maxAttempts` is one. Increasing it does not authorize retries of unknown outcomes.

The config bounds request time, output tokens, and maximum attempts. It contains no credential fields. Provider-specific options can remain in adapter-specific config and telemetry instead of being erased from the normalized record.

## Configuration and checks

`parseModelInterfaceConfig` rejects unknown fields, non-integer bounds, and values outside the documented ranges. The package depends only on shared protocol types.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-model-interface build
pnpm --filter @agent-harness-lab/module-model-interface typecheck
pnpm --filter @agent-harness-lab/module-model-interface test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

This package defines the interface and config parser only. A provider adapter still needs tests for tool-call parsing, cancellation, timeouts, provider errors, usage availability, and unknown dispatch outcomes.
