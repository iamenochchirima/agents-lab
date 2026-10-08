# Lina Model Interface: research and architecture direction

Reviewed 2026-10-08. The researched design is now represented by four maintained
Model nodes, provisional contracts and deterministic playback. The graph has
91 nodes and 221 connections. Provider clients and a real Lina runtime remain
unimplemented; source observations below are evidence for the design, not measured
provider behavior.

## Architecture direction

The block has four Model Interface responsibilities: **Resolve model binding**, **Encode
provider request**, **Invoke and collect response**, and **Normalize model
outcome**. The important refinement is their lifecycle, not extra boxes for every
SDK method. Resolution has a metadata-only path used before Context budgeting and
an invocation-readiness path. Invocation retains per-attempt stream state;
normalization establishes terminal usability before Turn Execution can choose
Tools, completion or recovery.

This is a Lina design inferred from recurring responsibilities, not a universal
industry-standard graph. Use protocol profiles within the block so provider
specific roles, tool schemas, continuation state and finish reasons remain
inspectable. Use the same block for each agent instance later; do not share child
history, credentials or provider continuation state implicitly.

## Evidence set

The following studies distinguish directly observed source behavior from proposed
Lina policy. Each records exact primary sources and limits:

- [Provider protocols](model-provider-protocols.md): official OpenAI, Anthropic,
  Gemini and OpenRouter formats, terminal events, tool calls, usage and capabilities.
- [Hermes and OpenClaw](model-hermes-openclaw.md): source-pinned resolution,
  request conversion, streaming, retry ownership and retained provider data.
- [Pi and Waku](model-pi-waku.md): source-pinned typed provider abstraction,
  stream finalization and compatibility-bridge losses.
- [Existing Context research](context-research.md) and
  [Turn Execution research](turn-execution-research.md): prior boundary decisions.

No upstream test suite, real provider call or performance experiment was run.
Official documentation was checked on the review date. Dynamic API docs are not
immutable specifications; provider profiles must declare the version/SDK and
capability evidence they implement. Earlier agent-study pins are not silently
replaced by the fresh pins in these studies.

## What the evidence means for Lina

| Finding | Design consequence |
| --- | --- |
| Provider protocols have different roles, tool/result structures, finish signals and opaque continuation fields | Encode with a declared protocol profile; retain both canonical records and provider-specific evidence |
| Stream previews and partial JSON are not terminal tool requests | Draft state is visible but unlaunchable; baseline Tools dispatch follows terminal normalization |
| Some source implementations lose finish/usage metadata or fall back after partial output | Treat these as limitations to avoid, not practices to copy |
| Retry can live in SDKs, adapters and outer agent controllers | Give Turn Execution one explicit retry budget; disable hidden retries in future clients or count every actual attempt |
| Model/capability and effective budget-setting changes affect Context sizing and request compatibility | Resolve capabilities before preparation; a changed binding returns to bounded reprepare |
| Cancellation may stop local observation without proving remote compute stopped | Record local and remote cancellation evidence separately; late output cannot reactivate stopped execution |
| Models differ in support for media, tool schemas, reasoning settings and continuation state | Capabilities are versioned supported/unsupported/unknown facts, never a single tools-supported boolean |

Complete-call enforcement is a conservative baseline. Some agents have
committed streamed-tool execution paths; those require a separate experiment
with admission, partial failure and side-effect controls. Lina's current Tools
parallelism remains required after a complete batch becomes available.

## Preimplementation audit of local boundaries

The following records the working-tree audit before the Model slice. Its needed
graph updates are now represented by the maintained nodes/contracts and playback;
the rows do not claim deployed Lina behavior. Existing reference-harness clients
remain separate.

| File/boundary | Existing behavior | Needed graph-slice update |
| --- | --- | --- |
| `apps/web/src/features/lina/executionBlock.ts` | Call model produces a fixture directly into Decide next action; Recover owns provider retries | Make Call model delegate into Model; retire direct summary edge only when detailed routes work |
| `contracts/turnExecution.ts` | Simple message projection and response text/tool calls; raw `providerPayload` example; complete/truncated/malformed and failure/abort variants | Consume rich normalized outcomes, retain safe provider evidence refs, add unknown usage/cancel and refusal/filter distinctions |
| `contracts/contextAssembly.ts` | Rich immutable context snapshot; capability ref is a coordinator fixture and dependencyAvailability marks model runtime unimplemented | Add correlated Model metadata request/return; carry validated binding/profile/generation and provider continuation refs |
| `contracts/contextRecords.ts` | Exact catalog/schema/binding identity and source generations already preserved | Preserve them through provider schema projection with explicit mapping and fidelity verdict |
| `contracts/toolsConnections.ts` | Shared credential lifecycle exists but readiness continuations are shaped around Tools batches/context acquisitions | Add a tagged Model readiness continuation rather than a dummy tool call or MCP connection |
| `inputSimulation.ts` | Model outcomes are immediate fixture visits; logical round/attempt counters advance at Call model | Add invocation state and preview events; only a real simulated launch increments model attempts |
| `server/src/models/openrouter/catalog.ts` and README | Server-side model selection metadata; `resolve` returns context-window information; no completion proxy | Reusable boundary evidence only; not enough to promise model protocol, codec or runtime execution |
| Platform-specific model clients | Completions and their lifecycle remain within each platform | Do not replace these or spread Lina assumptions into reference harnesses |

The preimplementation Context message union included text, media, calls/results
and derived summaries without a complete opaque-continuation boundary. The Model
slice adds scoped references and a transformation manifest; never flatten them into
ordinary user-visible text or carry them to another provider/account silently.

The shared credential contracts support native-provider audiences. The Model
slice adds a tagged readiness continuation carrying provider/account audience and
requester/agent scope with no fake MCP session. Keep storage, refresh and credential material inside the protected
credential owner; the Model block consumes readiness metadata.

## Baseline, use-case configuration and experiment candidates

| Category | Mechanisms |
| --- | --- |
| Required correctness | Versioned capabilities; instruction/media fidelity; exact tool-call/result mapping; no fragment dispatch; terminal completeness; one retry owner; cancellation accounting; unavailable usage stays unknown; safe scoped references |
| Use-case configuration | Provider/protocol/model selection, output limits, supported reasoning/temperature settings, streaming presentation, response formats, auth method, deadlines, whether refusal is terminal |
| Potential experiments | Explicit model routing/fallback strategy; reasoning effort/output reservation; prompt-cache placement; constrained structured output; streaming versus buffered delivery; committed early tool launch in a later controlled slice |

Provider choice changes model quality and infrastructure, so it cannot establish
harness superiority by itself. Routing and fallback experiments must record both
configured and actual returned model/provider, every physical attempt, prompt and
schema transformations, input/output/cache/reasoning usage availability, context
changes and any partial output discarded. Keep seeds where supported, but do not
claim provider determinism from a seed alone.

Cache hit rates and latency are future measurements. Synthetic cache or token
values in Studio must be labeled fixture data. Pricing is versioned metadata; an
absent cost is unknown rather than zero. Tool schema projection is a correctness
boundary, not a competition to see which schema loses fewer constraints.

## Implemented bounded first slice

The graph, contracts and deterministic simulation illustrate representative
Chat Completions, Responses, Messages and Gemini GenerateContent shapes through
versioned local fake fixtures. Automatic and Next use the same event reducers.
These profiles are not live adapters. Current Gemini Interactions and other newer/hosted protocols stay
visible as research-backed profile candidates until their API revision and
fixtures are pinned; do not infer support from the provider name.

Metadata resolution returns to the same Context preparation with zero inference
attempts. Encoding preserves catalog constraints, snapshot/profile identity,
media examples and actual retained tool-result groups. Invoke retains interleaved
drafts; Normalize establishes terminal usability and usage availability before
Tools or the next round. Required unsupported inputs, malformed calls and unknown
finish evidence fail explicitly. Shared readiness waits, prelaunch Stop and local
attempt settlement preserve the original owner. Local cancellation never claims
remote compute or billing stopped.

No real provider connection, secret-store backend, hosted tool execution,
production token counter, fallback engine or new loop strategy was added.
Reference examples and simulation state remain distinct; fixture counters are
not performance measurements.

The [implementation checklist](../../../development/implementation-plans/studio/completed/lina-model-interface.md)
records exact node IDs, edge changes, contract records, JSON examples, fixture
cases and acceptance checks. It supersedes the earlier four-row Model sketch for
this block; the cross-block proposal remains the authority for other blocks.
