# Real OpenRouter model connection and shared model selection

**Created:** `2026-09-15T18:23:15+02:00`
**Last updated:** `2026-09-16T20:17:11+02:00`
**Status:** Active
**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [`repository rules`](../../../AGENTS.md)
- [`server ownership`](../../../server/README.md)
- [`server architecture`](../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../server/src/platforms/README.md)
- [`runner interface`](../../../server/src/control-plane/ports/README.md)
- [`server platform foundation`](../completed/server-platform-foundation.md)
- [`platform batch plan`](platform-parallel-implementation.md)

First-party OpenRouter references used for this slice:

- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models) — list and search models with `GET /api/v1/models`.
- [Model detail API](https://openrouter.ai/docs/api/api-reference/models/get-model) — model metadata contract.
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) — provider-selection behaviour and request options.

The plan preserves the existing boundary: the Lab server admits and projects runs,
while each platform owns the model request inside its own execution boundary. The
browser never receives or sends the OpenRouter key. Computer Native is excluded because
it is a separate implementation owned by another agent; AWS Step Functions remains
outside the active platform wave.

## Purpose

Replace the platform UI's fake model defaults and free-text provider/model fields with
a real, server-mediated OpenRouter model selection that can be searched, passed through
the common run contract, and executed by every active non-AWS platform baseline.

## Definition of done

From the Platform UI, a contributor can open any active runnable platform, search the
OpenRouter catalog, select a model, submit a prompt, and inspect the real provider
response and normalized run evidence. The same selected model can be used by Compare.

```text
UI model picker → GET /api/models → OpenRouter catalog
UI run request → Lab server → selected platform runner/service → OpenRouter chat completion → run evidence
```

The UI contains no fake model option. The internal run contract still accepts explicit
fake adapters for deterministic lifecycle tests and failure/recovery exercises, so those
checks do not spend money or depend on network availability. They are not a silent
fallback for a missing or failed OpenRouter request.

## Scope

- [x] Add one server-owned OpenRouter configuration and model-catalog boundary.
- [x] Add a bounded, searchable `GET /api/models` API with safe model metadata only.
- [x] Keep provider credentials process-local and out of requests, manifests, events,
      results, logs, and native execution references.
- [x] Make the selected OpenRouter model flow through the common run contract and every
      active non-AWS baseline: Temporal, Restate, LangGraph, Mastra, Inngest, DBOS,
      Hatchet, Vercel Workflows, and Trigger.dev.
- [x] Replace runner and comparison model inputs with one shared searchable model picker.
- [x] Make local service and worker entry points load the same ignored local provider
      configuration so real runs work outside the Fastify process as well.
- [x] Update platform, server, UI, local-development, and plan documentation.
- [ ] Verify one real run and one real comparison path with configured OpenRouter access.

## Explicitly out of scope

- Computer Native model behaviour or its separate environment/configuration; another
  agent owns that repository area.
- AWS Step Functions; its plan remains active but outside this platform wave.
- Tool calling, skills, connections, memory, context management, or model streaming.
  The first real provider slice is a single prompt-to-text completion.
- A general multi-provider marketplace or browser-side provider SDK.
- Removing fake adapters or fake failure fixtures from the test suite.
- Promoting one OpenRouter model as a quality winner; the selected model is an explicit
  run variable.

## Finished behaviour

### User-visible behaviour

- The runner and Compare surfaces show one shared OpenRouter model picker.
- Clicking the closed control opens a select modal. Searching happens inside the modal,
  with debounce, loading, empty, error, and retry states.
- A result shows a readable model name, stable model ID, context length, and compact
  pricing/free metadata where available.
- Submit is disabled until a prompt and catalog model are selected.
- A missing key or unavailable catalog is shown as a concise inline error; no native
  browser dialog is used.
- Run status and result views show the selected provider/model ID as they do now.

### Ownership and boundaries

```text
server/src/models/openrouter/
  provider config, catalog client, completion request/response helpers, redaction

server/src/control-plane/http/
  model catalog route and safe API DTO; run request parsing remains here

server/src/platforms/<platform>/
  platform-specific lifecycle, retry, timeout, cancellation, and model adapter wrapper

apps/web/src/features/models/
  shared API types, hook, picker, debounce, and selection state

lab/runs/<run-id>/
  normalized manifest/events/result plus platform-native evidence; never credentials
```

State explicitly:

- The model catalog service is the sole owner of OpenRouter catalog HTTP calls made by
  the UI API.
- A platform execution boundary is the sole owner of its OpenRouter completion request;
  the server does not proxy model completions for durable platforms.
- `RunService` remains the sole coordinator of normalized Lab evidence.
- The browser may read safe catalog metadata and run projections only.
- OpenRouter SDK/API types stay inside the shared provider boundary or a platform's
  adapter; they do not become scenario or common lifecycle types.

## State, persistence, and evidence

Model catalog data is an ephemeral server cache. A selected model is persisted as the
non-secret `provider` and `model` fields of the existing run manifest so a run can be
reproduced. The provider key is never persisted.

```text
server memory: catalog cache keyed by normalized search/options, bounded TTL
lab/runs/<run-id>/config.json: manifest.model.provider + manifest.model.model
lab/runs/<run-id>/events.jsonl: safe provider/model identifiers and usage metadata
lab/runs/<run-id>/result.json: output, status, safe error, usage; no request headers
```

- [x] Catalog cache has a bounded TTL, result limit, and no durable secret state.
- [x] Model IDs are treated as opaque OpenRouter IDs; variants such as `:free` remain
      valid and are not rewritten.
- [x] Request bodies and manifests contain the model ID but never an API key.
- [x] Evidence redaction checks cover headers, error bodies, and native references for
      the live smoke run and provider/catalog tests.
- [x] Ambiguous provider outcomes remain `unknown`/reconciliation evidence rather than
      being converted into success.

## Failure, retry, and recovery semantics

- [x] Catalog requests use a bounded timeout and return a clear unavailable error; the
      UI may retry a read but does not silently substitute a fake model.
- [x] Catalog reads are safe to retry because they are GET requests and have no side
      effects.
- [x] A model completion is not blindly repeated after an ambiguous response unless
      that platform's existing durability contract explicitly retries the step; any
      possible duplicate is recorded using the platform's current attempt semantics.
- [x] Existing platform-specific retry, timeout, cancellation, and unknown-outcome
      rules remain intact while replacing only the model implementation.
- [x] A missing key fails validation or the platform task with a safe configuration
      error before a provider request is attempted.
- [x] A server, worker, or platform restart uses the existing execution reference and
      does not create a new run or silently change its selected model.
- [x] Duplicate/out-of-order normalized events continue to be handled by the existing
      evidence store and runner reconciliation rules.

## Security and configuration

- [x] `OPENROUTER_API_KEY` is accepted only from the process environment or ignored
      local `server/.env`; it is never accepted from the browser request.
- [x] `AGENTLAB_OPENROUTER_BASE_URL` defaults to the documented OpenRouter API origin
      and is validated as an HTTP(S) URL.
- [x] `AGENTLAB_OPENROUTER_DEFAULT_MODEL` optionally chooses the initial UI selection;
      the UI does not hardcode a fake model or trust arbitrary client defaults.
- [x] `AGENTLAB_OPENROUTER_CATALOG_TTL_MS`, request timeout, and result limit have safe
      bounded defaults and reject invalid values.
- [x] `AGENTLAB_ALLOWED_MODEL_PROVIDERS` may retain `fake` for tests, but the product UI
      exposes only `openrouter` and production-facing runnable defaults do not select
      fake.
- [x] Logs expose status/code/request ID only; prompts, authorization headers, API keys,
      and full provider error payloads are redacted.
- [x] Services started by `scripts/run_local_stack.sh` receive local provider settings
      without printing or committing the secret.

## Implementation checklist

### 1. Contracts and configuration

- [x] Add typed OpenRouter config with URL, key-presence, timeout, cache TTL, result
      limit, and optional default model.
- [x] Add safe catalog DTOs and parser for the documented OpenRouter `/models` response.
- [x] Add server route query parsing for provider, search term, limit, and text-capable
      model filtering; reject unsupported providers and invalid limits.
- [x] Define the UI selection as `{ provider: "openrouter", model: string }` while
      preserving the existing manifest schema and deterministic fake test contract.

### 2. Core provider and platform implementation

- [x] Implement the server catalog client with timeout, cache, stable sorting, bounded
      output, upstream error classification, and secret-safe diagnostics.
- [x] Keep OpenRouter completion adapters at each platform execution boundary so each
      platform retains its own lifecycle and retry semantics; preserve common response
      parsing and redaction rules without forcing a cross-platform runtime helper.
- [x] Update Temporal, Restate, Inngest, DBOS, Hatchet, and Vercel Workflows adapters to
      use the selected model through their platform-owned provider adapters.
- [x] Update Mastra's model-router configuration to use the selected model without
      leaking provider credentials.
- [x] Update LangGraph's Python service path and local launcher to use the selected model
      and provider environment safely.
- [x] Add the Trigger.dev OpenRouter task path, retaining its platform-native task retry
      and ambiguous-outcome semantics.
- [x] Load local OpenRouter settings for every worker/service entry point that can execute
      a model call, not only the Fastify server.

### 3. Integration and user surface

- [x] Add `getModels()` to the web API client with typed error handling.
- [x] Build one accessible `ModelPicker` with debounce, keyboard navigation, selection,
      metadata, loading, error, empty, and retry states.
- [x] Use the picker in the single-platform runner and Compare modal; remove provider
      and model free-text inputs and fake defaults from both surfaces.
- [x] Ensure platform changes, modal reopen, failed requests, and a selected model remain
      predictable without stale requests overwriting current state.
- [x] Show selected model in the resulting run view and preserve model IDs in compare
      requests.

### 4. Documentation and learning material

- [x] Update server/platform README and local-development docs with the real model flow,
      environment variables, key boundary, and unavailable-provider behaviour.
- [x] Update UI/API documentation with the model picker endpoint and request contract.
- [x] Update platform plan references that currently describe fake as the user-facing
      default or Trigger OpenRouter as permanently deferred.
- [x] Add a short inspection guide explaining where to verify model ID, provider request
      evidence, usage, and redaction in `lab/runs/<run-id>/`.
- [ ] Record this plan's completion validation, commits, and known limitations before
      moving it to `completed/`.

## Test coverage

### Unit tests

- [x] Parse valid/invalid OpenRouter catalog responses, including missing optional fields,
      free pricing, modalities, and malformed model entries.
- [x] Verify search normalization, result limiting, stable ordering, cache hits/expiry,
      timeout, non-2xx, malformed-upstream, and missing-key behaviour.
- [x] Verify catalog and completion requests contain the selected model but never the key
      in a body, DTO, error, manifest, event, or reference.
- [x] Verify model IDs with provider namespaces and variant suffixes are preserved.
- [x] Bound provider response bodies and assistant output at each platform-local
      OpenRouter boundary; oversized payloads are rejected without entering durable
      state, and the behaviour is covered by platform model tests.
- [x] Verify every active non-AWS platform accepts OpenRouter and retains its existing fake-only
      failure fixtures; add Trigger OpenRouter validation/task tests.
- [x] Verify run request parsing rejects client-supplied secret/config fields.
- [ ] Add browser-level coverage for picker loading, empty, error, keyboard selection,
      and stale response cases.

### Integration tests

- [x] Exercise `GET /api/models` against a mocked OpenRouter HTTP server and verify safe
      response shape, query parameters, cache, and error status mapping.
- [ ] Exercise one run per active non-AWS platform with a mocked provider boundary and
      verify selected model propagation through native execution and normalized evidence.
- [x] Exercise at least one real local platform run with OpenRouter, using an explicitly
      selected low-cost/free text model and a real configured key.
- [ ] Exercise a real Compare request with two reachable platforms and one selected model.
- [ ] Exercise missing-key, provider rejection, timeout, cancellation, restart, and
      ambiguous-acknowledgement paths using existing deterministic platform fixtures.

### Manual acceptance checks

- [x] Start the server and web app with the ignored local key configuration.
- [ ] Open each active platform runner, search for a model, select it, submit a prompt,
      and inspect the returned model ID and real response.
- [ ] Open Compare, select two platforms, choose one model once, run, and inspect both
      run records.
- [ ] Disconnect or unset the key and verify the UI shows an actionable error without a
      fake fallback.
- [ ] Inspect `config.json`, `events.jsonl`, `result.json`, logs, and native evidence;
      verify no secret or full authorization header is retained.

## Validation performed to date

- `pnpm --dir server exec tsx --test tests/models/openrouter/catalog.test.ts tests/control-plane/http.test.ts tests/control-plane/config.test.ts tests/platforms/trigger-dev/trigger-dev-runner.test.ts tests/platforms/trigger-dev/openrouter.test.ts` — 21 passed.
- `pnpm --filter @agent-harness-lab/lab-server test` — 233 passed after the LangGraph wire-boundary fix.
- `pnpm --dir apps/web run typecheck` — passed; document catalog generated 59 documents.
- `pnpm --dir apps/web run build` — passed; Vite emitted only the existing large-chunk warning.
- `bash -n scripts/run_local_stack.sh` — passed.
- `git diff --check` on this slice — passed.
- Live `GET /api/models?provider=openrouter&limit=3` — returned the OpenRouter catalog.
- Live Mastra run with selected model `cohere/north-mini-code:free` — completed with real provider output and usage; run ID `787e3db5-0c81-4d74-861e-00f170e675ed`.
- The live run evidence was scanned for API keys, bearer headers, and provider secret prefixes; none were present.
- `server/src/platforms/langgraph/.local311/bin/pytest -q` — 22 passed, 1 deprecation warning; the provider response limit and parsing tests are included. The `.local` Python 3.12 environment remains unusable because its interpreter lacks `_sqlite3`.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/langgraph/runner-adapter.test.ts` — 4 passed after verifying that UI-only context metadata is stripped from LangGraph's strict wire request.
- `pnpm --dir apps/web exec tsx --test tests/chatState.test.ts` — 8 passed, including stale-run, duplicate-message, and model-selection stability checks.
- `pnpm --dir apps/web run typecheck` and `pnpm --dir apps/web run build` — passed after the shared picker request-lifecycle fix; Vite emitted only the existing large-chunk warning.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/trigger-dev/openrouter.test.ts` — 5 passed, including bounded provider-response and assistant-output rejection.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/temporal/fake-model.test.ts tests/platforms/restate/models.test.ts tests/platforms/inngest/models.test.ts tests/platforms/dbos/models.test.ts tests/platforms/hatchet/models.test.ts tests/platforms/vercel-workflows/models.test.ts` — 31 passed; each OpenRouter boundary now asserts that the selected model ID is sent and the secret is absent from the request body.
- `server/src/platforms/langgraph/.local311/bin/pytest -q server/src/platforms/langgraph/service/tests/test_graph.py` — 4 passed; the Python boundary asserts the selected model ID in the outbound request.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/hatchet/task.test.ts` — 3 passed; a mocked OpenRouter response traversed the Hatchet task and produced normalized result, usage, trajectory, and events for the selected model.
- `pnpm --filter @agent-harness-lab/lab-server run typecheck` — passed after the Trigger.dev response-boundary change.
- A fresh server on `127.0.0.1:4319` completed a real LangGraph run with `cohere/north-mini-code:free`; run ID `d97ef0f8-e4f6-405d-b0ca-46e75c51ca28`. The original run `4dd500b8-8e46-44bd-a20c-8298bde9c971` was correctly recorded as failed with `DISPATCH_FAILED` when the strict protocol rejected the extra field.
- Live OpenRouter smoke runs with `cohere/north-mini-code:free` completed on Temporal (`c54e4a8d-58c3-469e-9fe5-630d2a41f5ca`), Restate (`f7119cc2-f277-41dd-874b-618917f1db9a`), Mastra (`dacf5f45-e867-493d-9fcb-790a1ae7a007`), and Vercel Workflows (`537fc9db-a48f-4c8b-aa23-a62b180595d9`) at `2026-09-16T19:51:00+02:00`; only safe status/model fields were inspected.
- An API-equivalent Compare fan-out using one selected model completed concurrently on Temporal (`ca7c760a-b872-4a6e-b6b8-00c12c82cf30`) and Restate (`0cf5406d-2681-46d6-a83e-2b3bc5be6ef7`) at `2026-09-16T19:56:00+02:00`; this does not replace the pending browser Compare acceptance check.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server test
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
bash -n scripts/run_local_stack.sh
git diff --check
```

For the real acceptance path, record the exact selected model, platform(s), date/time,
and run IDs in the completion record without recording the API key or full prompt.
If a local platform dependency is unavailable, record that platform as not validated;
do not mark it runnable or fabricate an external result.

## Completion gate

- [ ] Every applicable implementation and test checkbox is complete.
- [ ] The UI has one shared searchable real-model picker and no fake model control.
- [ ] Every active non-AWS platform has a real OpenRouter execution path or a documented,
      tested, explicitly blocked dependency with no false readiness claim.
- [ ] Failure, timeout, cancellation, retry, ambiguous outcome, and secret-redaction
      behaviour is implemented and tested.
- [ ] Documentation and examples match the implementation.
- [ ] Required validation commands and manual checks are recorded.

## Commit discipline and handoff

- [x] Commit the provider contracts/configuration and catalog API in the focused server
      foundation commit `e9edb4f` (`feat(server): integrate context and model projections`).
- [x] Commit the Trigger.dev OpenRouter task execution, its pre-dispatch cancellation
      guard, tests, and platform docs in `dce6e9c` (`feat(trigger): add OpenRouter task execution`).
- [x] Commit the Inngest provider/configuration update in `cdf847f` (`feat(inngest): use selected model provider`).
- [x] Commit the DBOS provider/configuration update in `c626a74` (`feat(dbos): use selected model provider`).
- [x] Commit the Hatchet provider documentation update in `c04ca49` (`docs(hatchet): document selected model provider`).
- [x] Commit the Vercel Workflows provider/configuration update in `2b0dc4b` (`feat(vercel): use selected model provider`).
- [x] Commit response bounds and model-level tests for Inngest in `e734081` (`fix(inngest): bound OpenRouter responses`).
- [x] Commit response bounds and model-level tests for Hatchet in `cfe12e7` (`fix(hatchet): bound OpenRouter responses`).
- [x] Commit response bounds and model-level tests for Temporal in `a3c34ea` (`fix(temporal): bound OpenRouter responses`).
- [x] Commit response bounds and provider-boundary tests for LangGraph in `d63bf4e` (`fix(langgraph): bound OpenRouter responses`).
- [x] Commit streamed response bounds and model-level tests for DBOS in `cd10341` (`fix(dbos): bound OpenRouter responses`).
- [x] Commit streamed response bounds and model-level tests for Vercel Workflows in `7832961` (`fix(vercel): bound OpenRouter responses`).
- [x] Commit the LangGraph wire-boundary fix and regression test in `363e50b` (`fix(langgraph): strip UI metadata from wire model`).
- [x] Commit the shared model picker, runner/Compare wiring, browser chat, context meter, and web regression state tests in `d0c47ce` (`feat(web): connect platform chat and model controls`).
- [x] Commit Trigger.dev response bounds and provider-boundary tests in `0b03650` (`fix(trigger): bound OpenRouter responses`).
- [x] Clarify Restate's deterministic fake fixture boundary in `4987a42` (`docs(restate): clarify fake model fixture boundary`).
- [x] Commit selected-model assertions across provider boundaries in `042a7b7` (`test(platforms): assert selected model at provider boundaries`).
- [x] Commit a mocked OpenRouter execution through the Hatchet task in `d551ef2` (`test(hatchet): cover selected OpenRouter task execution`).
- [x] Commit the remaining platform execution changes in coherent platform groups, with their tests and
      docs; do not create one giant provider migration commit.
- [x] Commit the shared web picker and runner/Compare integration separately in `d0c47ce`.
- [ ] Commit documentation and plan completion records separately when practical.
- [ ] Before each commit, inspect status and the exact staged diff; preserve unrelated
      Computer Native and generated `server/lab/` changes.
- [ ] Record all implementation commit hashes in the completion record.

## Release impact record

- Documentation: applicable; update server/platform/UI docs in this slice.
- Analytics: not applicable; this is a local research lab and no product analytics are
  emitted by the model picker.
- Structured logging: applicable; retain safe provider/model status and request IDs while
  redacting prompts, keys, authorization headers, and full upstream error bodies.
- Version/migration: no durable schema migration; the existing manifest schema remains
  version 1 and fake fixtures remain backward-compatible for tests.
- Rollout: environment-gated; no provider call occurs at server startup, and catalog
  access begins only when the picker requests it.
- Rollback: remove/disable OpenRouter credentials or set the allowed provider profile to
  the deterministic test configuration; keep the UI unavailable rather than silently
  falling back to fake in production-facing flows.
- Validation: the commands and manual run IDs are recorded above before completion.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`
- `[manual check]` — `[what was observed]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

`[Record any later architecture change that makes this scope or terminology outdated.]`
