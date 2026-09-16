# Real OpenRouter model connection and shared model selection

**Created:** `2026-09-15T18:23:15+02:00`
**Last updated:** `2026-09-16T21:51:48+02:00`
**Status:** Completed
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
- [x] Verify one real run and one real comparison path with configured OpenRouter access.

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
- [x] Add browser-level coverage for picker loading, empty, error, keyboard selection,
      and stale response cases.

### Integration tests

- [x] Exercise `GET /api/models` against a mocked OpenRouter HTTP server and verify safe
      response shape, query parameters, cache, and error status mapping.
- [x] Exercise one run per active non-AWS platform with a mocked provider boundary and
      verify selected model propagation through native execution and normalized evidence.
- [x] Exercise at least one real local platform run with OpenRouter, using an explicitly
      selected low-cost/free text model and a real configured key.
- [x] Exercise a real Compare request with two reachable platforms and one selected model.
- [x] Exercise missing-key, provider rejection, timeout, cancellation, restart, and
      ambiguous-acknowledgement paths using the existing explicit deterministic platform
      fixtures and platform integration suites; these are not production model selections.

### Manual acceptance checks

- [x] Start the server and web app with the ignored local key configuration.
- [x] Open each currently reachable platform runner, search for a model, select it,
      submit a prompt, and inspect the returned model ID and real response.
- [x] Re-run the same runner acceptance check for Inngest after its local function service
      and Dev Server became available.
- [x] Run the same acceptance check for DBOS and Hatchet after bringing up their local
      dependencies without Docker. DBOS used an isolated temporary PostgreSQL instance
      with the canonical `127.0.0.1:55432` profile; Hatchet used an isolated embedded
      data directory so its native engine and worker could start without colliding with
      another local Hatchet process.
- [x] Check Trigger.dev availability through the same acceptance path. The runner
      reported `TRIGGER_SECRET_KEY is not configured for the Trigger.dev profile`, so
      no Trigger run was claimed or fabricated; its real acceptance remains an explicit
      credential-gated follow-up.
- [x] Open Compare, select two reachable platforms, choose one model once, run, and inspect
      both run records.
- [x] Disconnect or unset the key and verify the UI shows an actionable error without a
      fake fallback; an isolated no-key server/web pair showed the configuration error,
      zero model options, and no fake model.
- [x] Inspect `config.json`, `events.jsonl`, `result.json`, and native evidence for the
      real comparison; verify no secret or full authorization header is retained.

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
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/restate/workflow.test.ts` — 12 passed; the in-process durable workflow executed mocked OpenRouter responses, preserved the selected model, recorded normalized evidence, and aggregated usage across model calls.
- `pnpm --filter @agent-harness-lab/lab-server run typecheck` — passed after the Restate usage-aggregation fix.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/trigger-dev/task.test.ts tests/platforms/trigger-dev/openrouter.test.ts tests/platforms/trigger-dev/trigger-dev-runner.test.ts` — 15 passed; the exact Trigger task handler executed a mocked OpenRouter response and returned normalized task evidence.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/inngest/store.test.ts tests/platforms/inngest/service.test.ts tests/platforms/inngest/models.test.ts tests/platforms/inngest/inngest-runner.test.ts` — 14 passed; Inngest function execution and persisted lifecycle events retain the selected provider/model identity.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/mastra/mastra-runner.test.ts` — 6 passed; Mastra's real `Agent.generate()` path sent the selected model to a mocked OpenRouter endpoint and retained normalized usage/evidence.
- `AGENTLAB_RUN_LANGGRAPH_NATIVE_OPENROUTER=1 pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/langgraph/langgraph-runner.test.ts` — 3 passed; a real LangGraph Python service and `StateGraph` reached the mocked provider, persisted a checkpoint, and retained usage.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/dbos/dbos-runner.test.ts` — 5 passed; the registered DBOS workflow and native step reached the mocked OpenRouter boundary.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test --test-name-pattern='selected OpenRouter model' tests/platforms/vercel-workflows/service.integration.test.ts` — 1 passed; the local Workflow World executed the selected model through its durable step and retained native step identity.
- `AGENTLAB_RUN_TEMPORAL_NATIVE_OPENROUTER=1 pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/temporal/native-openrouter.test.ts` — 1 passed; an actual local Temporal workflow and activity used an isolated task queue and reached a local mocked OpenRouter boundary with the selected model, usage, native reference, normalized evidence, and redaction checks.
- `node --test apps/web/tests/browser/model-picker.browser.test.mjs` — 1 passed against the running Vite app in Chromium; the real picker rendered catalog loading, selected by keyboard, rendered empty/error states, and kept the newer result when an older search request was aborted.
- `AGENTLAB_RUN_LIVE_PLATFORM_UI=1 node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs` — 1 passed; real Chromium runner acceptance completed Temporal (`b8680ef4-54ff-48df-8bb8-c61fc812d738`), Restate (`1e23992d-d41a-4ea7-88ef-b580d4bf36a7`), LangGraph (`0a114e87-161e-4208-b34e-d941141bcb63`), Mastra (`27c4aec3-4cad-4d26-ba3d-22f6cf09ccf8`), and Vercel Workflows (`d7e237c5-5e98-4d03-8a88-dd0bcef8254e`) with the selected OpenRouter model. Inngest, Trigger.dev, DBOS, and Hatchet were reported unavailable by their individual health checks.
- `OPENROUTER_API_KEY='' AGENTLAB_ALLOWED_MODEL_PROVIDERS=openrouter AGENTLAB_API_ORIGIN=http://127.0.0.1:5174 AGENTLAB_API_PORT=4320` with an isolated Vite app on `5174` — passed; the browser rendered `OPENROUTER_NOT_CONFIGURED`, showed no model options, and did not expose or substitute a fake model.
- `AGENTLAB_RUN_LIVE_PLATFORM_UI=1 AGENTLAB_LIVE_PLATFORM_IDS=inngest node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs` — 1 passed; Inngest completed a real UI run (`6dd9f146-d5d3-4f56-b991-f0494d423322`) with `provider: openrouter`, `cohere/north-mini-code:free`, terminal result, usage, native evidence, and no secret-like fields.
- `pnpm --filter @agent-harness-lab/web run build` — passed after comparison lifecycle guards and responsive modal changes; Vite emitted only the existing large-chunk warning.
- `git diff --check` — passed after clarifying the Run API and platform provider-boundary documentation.
- `pnpm --filter @agent-harness-lab/lab-server run typecheck` — passed after the Mastra, LangGraph, DBOS, and Vercel native-boundary coverage.
- `pnpm --filter @agent-harness-lab/lab-server test` — 243 passed, 2 intentionally skipped (the opt-in native LangGraph and Temporal tests); this includes the compiled DBOS and Vercel native-boundary tests.
- `pnpm --filter @agent-harness-lab/web run typecheck` — passed; the generated documentation catalog contains 63 documents.
- `pnpm --filter @agent-harness-lab/web run build` — passed; Vite emitted only the existing large-chunk warning.
- `git diff --check` — passed after the native-boundary test additions and compiled-path fix.
- A fresh server on `127.0.0.1:4319` completed a real LangGraph run with `cohere/north-mini-code:free`; run ID `d97ef0f8-e4f6-405d-b0ca-46e75c51ca28`. The original run `4dd500b8-8e46-44bd-a20c-8298bde9c971` was correctly recorded as failed with `DISPATCH_FAILED` when the strict protocol rejected the extra field.
- Live OpenRouter smoke runs with `cohere/north-mini-code:free` completed on Temporal (`c54e4a8d-58c3-469e-9fe5-630d2a41f5ca`), Restate (`f7119cc2-f277-41dd-874b-618917f1db9a`), Mastra (`dacf5f45-e867-493d-9fcb-790a1ae7a007`), and Vercel Workflows (`537fc9db-a48f-4c8b-aa23-a62b180595d9`) at `2026-09-16T19:51:00+02:00`; only safe status/model fields were inspected.
- An API-equivalent Compare fan-out using one selected model completed concurrently on Temporal (`ca7c760a-b872-4a6e-b6b8-00c12c82cf30`) and Restate (`0cf5406d-2681-46d6-a83e-2b3bc5be6ef7`) at `2026-09-16T19:56:00+02:00`; the later browser acceptance check below exercised the same comparison through the UI.
- A fresh real OpenRouter fan-out completed concurrently on Temporal (`91e9fc4b-8e61-4b13-bf59-33e88fa0a105`) and Restate (`de45c4b1-e18c-405b-8e0f-3adad707a7eb`) at `2026-09-16T20:49:00+02:00` with `cohere/north-mini-code:free`. Both run manifests recorded `provider: openrouter`, both returned terminal results and usage, and no fake model was involved. This was exercised at the API boundary; browser-level Compare acceptance is recorded below.
- Browser Compare acceptance completed at `2026-09-16T21:18:41+02:00` against the local Vite app and Lab server. The UI selected `cohere/north-mini-code:free` once and concurrently completed Temporal (`78977acc-0463-4f0e-ac52-226e888e1a5f`) and Restate (`5c9108e8-556f-4b92-8ece-6e91044e38e5`). Both manifests recorded `provider: openrouter`; both results were terminal with usage and the expected smoke output.
- Evidence inspection for the browser Compare runs found `config.json`, `events.jsonl`, `metrics.json`, `trajectory.json`, `result.json`, and native evidence for both runs. A secret-pattern scan found no authorization header, API key, or provider secret in either run directory.
- Local availability snapshot at `2026-09-16T21:48:00+02:00`: Temporal, Restate,
  LangGraph, Mastra, Vercel Workflows, Inngest, DBOS, and Hatchet were reachable in
  the isolated acceptance topology. Trigger.dev remained unavailable because
  `TRIGGER_SECRET_KEY` was not configured. The consolidated browser pass completed
  real OpenRouter runs with `cohere/north-mini-code:free` for:
  - Temporal: `8c4f93ab-f860-47a7-807c-cb1768764932`
  - Restate: `abbdcf8c-bf28-46a5-85ac-1a6ddc777162`
  - LangGraph: `d43a0d54-c81d-466e-b9b3-621b209c256f`
  - Mastra: `1eb37c19-7141-453e-ad9d-e48722f3ffbe`
  - Vercel Workflows: `fb85ce2f-b35b-484e-a992-6aed60d3bacf`
  - Inngest: `c5a21f88-e6fe-439e-b33e-5ade4a867637`
  - DBOS: `3e4d400e-faf8-4fc9-b135-ad97739e2992`
  - Hatchet: `d1488f3e-b595-41e2-9907-881d4226ba20`
  Each completed run recorded the selected provider/model, terminal result, native
  reference, trajectory, metrics, and no secret-like fields in its API projection.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server test
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
bash -n scripts/run_local_stack.sh
node --test apps/web/tests/browser/model-picker.browser.test.mjs
AGENTLAB_RUN_LIVE_PLATFORM_UI=1 node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs
git diff --check
```

For the real acceptance path, record the exact selected model, platform(s), date/time,
and run IDs in the completion record without recording the API key or full prompt.
If a local platform dependency is unavailable, record that platform as not validated;
do not mark it runnable or fabricate an external result.

## Completion gate

- [x] Every applicable implementation and test checkbox is complete.
- [x] The UI has one shared searchable real-model picker and no fake model control.
- [x] Every active non-AWS platform has a real OpenRouter execution path or a documented,
      tested, explicitly blocked dependency with no false readiness claim; Trigger.dev
      is the only platform not live-executed because its required credential is absent.
- [x] Failure, timeout, cancellation, retry, ambiguous outcome, and secret-redaction
      behaviour is implemented and tested.
- [x] Documentation and examples match the implementation.
- [x] Required validation commands and manual checks are recorded.

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
- [x] Commit the Restate native workflow OpenRouter coverage and first-call usage accumulation fix in `7a65729` (`fix(restate): preserve OpenRouter usage across workflow calls`).
- [x] Commit the Trigger native task OpenRouter coverage in `2789f0e` (`test(trigger): cover selected OpenRouter task execution`).
- [x] Commit selected provider/model identity in Inngest lifecycle evidence in `9371cc9` (`fix(inngest): retain model identity in lifecycle evidence`).
- [x] Commit Mastra native OpenRouter coverage in `5658d4c` (`test(mastra): cover selected OpenRouter agent execution`).
- [x] Commit LangGraph native OpenRouter coverage and usage persistence in `96914bc` (`fix(langgraph): preserve OpenRouter usage in native runs`).
- [x] Commit DBOS native OpenRouter workflow coverage in `43ede1e` (`test(dbos): cover selected OpenRouter workflow execution`).
- [x] Commit Vercel Workflows native OpenRouter coverage in `2e9a51e` (`test(vercel): cover selected OpenRouter workflow execution`).
- [x] Commit the compiled-test DBOS SDK resolution fix in `3e56e25` (`fix(test): resolve DBOS SDK from compiled test paths`).
- [x] Commit the native Temporal OpenRouter workflow coverage in `22d66eb` (`test(temporal): cover native OpenRouter workflow`).
- [x] Commit the Chromium model-picker browser coverage in `88afa51` (`test(web): cover model picker in Chromium`).
- [x] Commit the opt-in live platform runner acceptance test in `bd122cc` (`test(web): add live platform runner acceptance`).
- [x] Commit the live acceptance platform filter in `fd813b6` (`test(web): filter live platform acceptance`).
- [x] Commit comparison polling guards and responsive/focusable modal controls in `829e322` (`fix(web): guard comparison lifecycle updates`).
- [x] Commit the Run API and platform provider-boundary documentation in `ccff5f4` (`docs(server): clarify real and fixture model providers`).
- [x] Commit the remaining platform execution changes in coherent platform groups, with their tests and
      docs; do not create one giant provider migration commit.
- [x] Commit the shared web picker and runner/Compare integration separately in `d0c47ce`.
- [x] Commit documentation and plan completion records separately when practical.
- [x] Before each commit, inspect status and the exact staged diff; preserve unrelated
      Computer Native and generated `server/lab/` changes.
- [x] Record all implementation commit hashes in the completion record.

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

**Completed:** `2026-09-16T21:51:48+02:00`
**Commits:** `e9edb4f, dce6e9c, cdf847f, c626a74, c04ca49, 2b0dc4b, e734081, cfe12e7, a3c34ea, d63bf4e, cd10341, 7832961, 363e50b, d0c47ce, 0b03650, 4987a42, 042a7b7, d551ef2, 7a65729, 2789f0e, 9371cc9, 5658d4c, 96914bc, 43ede1e, 2e9a51e, 3e56e25, 22d66eb, 88afa51, bd122cc, fd813b6, 829e322, ccff5f4, cf41f92, 2db48d9`

### Validation

- `pnpm --filter @agent-harness-lab/lab-server run typecheck` — passed.
- `pnpm --filter @agent-harness-lab/lab-server test` — 243 passed, 2 intentionally
  skipped opt-in native-provider tests, 0 failed.
- `pnpm --filter @agent-harness-lab/web run typecheck` — passed.
- `pnpm --filter @agent-harness-lab/web run build` — passed; only the existing Vite
  large-chunk warning remained.
- `bash -n scripts/run_local_stack.sh` — passed.
- `node --test apps/web/tests/browser/model-picker.browser.test.mjs` — passed.
- `AGENTLAB_RUN_LIVE_PLATFORM_UI=1 AGENTLAB_API_URL=http://127.0.0.1:4320
  AGENTLAB_WEB_URL=http://127.0.0.1:5174 node --test
  apps/web/tests/browser/live-platform-runners.browser.test.mjs` — passed; eight
  platforms completed real OpenRouter runs, and Trigger.dev was explicitly reported
  unavailable because its credential was absent.
- `git diff --check` — passed.

### Known limitations

- Trigger.dev's live acceptance requires a configured `TRIGGER_SECRET_KEY` and a
  reachable Trigger.dev API/task worker. The implementation, mocked task path, and
  unavailable-state handling are covered; no external credential was invented.
- LangGraph's live run does not currently receive provider token usage from its strict
  Python wire response, so its normalized usage remains unavailable even though the
  real model response and lifecycle evidence are present.
- The browser acceptance used isolated local service topologies for DBOS PostgreSQL
  and Hatchet embedded state; these prove local execution wiring, not hosted-provider
  availability or production capacity.

### Historical-scope note

No later architecture change is recorded for this completed slice. The separate
Computer Native implementation remains intentionally outside its scope.
