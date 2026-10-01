# Model interface module

This module accepts a normalized model request containing shared `AgentMessage`
and `AgentToolCall` protocol values. It returns text, structured tool calls,
provider identity, usage, and useful provider detail. Provider SDKs and
credentials stay inside an implementation or host, not in the shared protocol or
browser.

## Interface

`ModelInterfaceModule.generate` receives a run scope, model selection, ordered messages, optional tool definitions, provider parameters, an optional idempotency key, and an `AbortSignal`. Success returns text and/or tool calls with usage and provider identity. Failure returns a classified category, retryability, and whether dispatch was known not to happen, a response arrived, or the outcome is unknown.

```ts
const result = await model.generate({ scope, model, messages, parameters: {} }, signal);
if (result.outcome === "completed") inspect(result.response.toolCalls, result.response.usage);
```

## Initial implementation: deterministic replay

`createReplayModelInterface(config?)` implements the public contract without contacting a provider. Requests must select `model.provider: "replay"`. The adapter returns a deterministic summary of the request shape: the number of model messages and an estimate for the latest user message. This is useful for exercising and inspecting a harness; it does not answer questions, follow instructions, or simulate tool calls. Tool definitions are accepted as request metadata, but the replay always returns an empty `toolCalls` list.

The adapter echoes the requested provider and model names and identifies itself as `deterministic-replay-model@0.1.0`. Its request ID is a stable hash of the validated request. Usage is a rough estimate from UTF-8 message-content bytes divided by four; it excludes message framing and provider tokenization, so it must not be treated as measured usage. The configured output bound uses the same estimate and truncates text with `finishReason: "length"` when reached.

Package version `0.4.0` adds `createReferenceModelInterface(config)`, a
deterministic implementation selected by the Studio reference assembly. It keeps
one adapter identity and routes ordinary tasks to Replay. Two exact named scenario
tasks use local scripts that emit a fixed calculator or controlled computer tool
call, then check the correlated result before returning their fixed text. These
scripts make no provider or network request; they exercise the Model Interface
contract with the rest of the assembly. They are not general reasoning models or
model-quality alternatives.

The lower-level `createReplayModelInterface(config?)` remains independently
available as a diagnostic implementation. It never emits calls, even when a
request includes tool definitions.

Invalid requests and requests without a text-bearing user message return `invalid-request` with `dispatchOutcome: "not-sent"`. A signal already aborted when generation begins returns `cancelled`, also `not-sent`. The implementation is local and synchronous once called, so it does not emulate network delays, in-flight cancellation, provider errors, or retries. `requestTimeoutMs` and `maxAttempts` do not affect this replay implementation.

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

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency. This replay does not make a real provider request. A real provider adapter still needs separate checks for tool-call parsing, in-flight cancellation, timeouts, provider errors, and unknown dispatch outcomes.
