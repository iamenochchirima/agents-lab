# Studio Context component experiment

**Created:** `2026-10-02T23:52:59+02:00`<br>
**Last updated:** `2026-10-03T00:20:30+02:00`<br>
**Status:** Active<br>
**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [`repository rules`](../../../../AGENTS.md)
- [`Studio program plan`](../modular-agent-studio.md)
- [`Studio module and assembly ownership`](../../../../studio/README.md)
- [`Context module contract`](../../../../studio/modules/context/README.md)
- [`reference assembly`](../../../../studio/assemblies/reference-agent/README.md)
- [`Studio API`](../../../../apps/studio-api/README.md)
- [`Studio Components UI`](../../../../apps/web/src/features/component-lab/README.md)
- [`documentation guide`](../../../../docs/contributing/documentation.md)

Preserve the module seams: Context owns selection and ordering of model-visible
material; the scenario owns its fixed workload; the experiment owns the changed
variable and controls; the reference assembly supplies all other module choices;
the API owns execution and saved run records; the browser renders only the safe
HTTP projection. Keep module loading static and server-side.

## Purpose

Turn the Context Management preview into Studio's first executable component
experiment. It compares the existing budget-fitted recent-history implementation
with a fixed recent-message window while holding the scenario, task, model, budget,
and other reference-assembly modules constant. The experiment lets contributors
inspect a real module decision without presenting deterministic Replay as a measure
of answer quality.

The experiment hypothesis is: when all six prior messages fit the pinned token
budget, the current budget-fitted recent-history policy retains all six, while the
default four-message window retains only sequences 2–5 and omits sequences 0–1 for
the `window` reason. This demonstrates the policies' selection boundary; it does not
measure whether Replay can retrieve or answer from the retained material.

## Definition of done

From `/components/context-management`, a contributor can run the fixed
`old-important-fact` case, inspect both Context implementations side by side, and
reopen the saved comparison after a browser refresh. The two normal run records
identify the same case and controls, the Context implementation and configuration
used, the exact model messages, source inclusion and omission reasons, token count
and basis, ordered events, and persistence status.

```text
fixed scenario + shared controls
  → static Context implementation registry
  → two isolated reference-assembly runs
  → saved run records and comparison identity
  → browser evidence view that can reopen the comparison
```

## Scope

- [ ] Add a version `0.1.0` data-only workspace package named
      `@agent-harness-lab/scenario-context-stress` for the `context-stress` scenario.
      Keep its task and ordered source messages independent from Studio modules and
      API code.
- [ ] Add no runtime dependency for the scenario package; update `pnpm-lock.yaml`
      after workspace and package version changes with `pnpm install --lockfile-only`.
- [ ] Preserve `deterministic-context-assembler@0.4.0` and add
      `fixed-recent-message-window@0.1.0` through the same `ContextAssembler`
      contract.
- [ ] Record fixed-window omissions with a distinct `window` reason and publish the
      additive contract using the repository's pre-1.0 versioning rule.
- [ ] Extend the reference assembly's static registry to select either known Context
      implementation while keeping every other module selection fixed.
- [ ] Add a versioned Studio HTTP contract and endpoints to run and reopen one
      Context comparison by its caller-generated comparison ID.
- [ ] Persist a comparison manifest and one ordinary Studio run record per strategy.
      Keep the shared fixture, selected Context identity, and all fixed controls in
      each run's configuration.
- [ ] Change the Context Management page from preview-only to an honest two-strategy
      comparison. Keep the other planned strategy choices visibly unavailable.
- [ ] Document the scenario, experiment procedure, run format, retry behavior,
      cancellation, restart limits, and interpretation limits.
- [ ] Add meaningful contract, module, assembly, API persistence, browser, and
      documentation checks.

## Design choices

| Decision | Chosen approach | Alternative considered | Reason |
| --- | --- | --- | --- |
| Scenario ownership | Versioned data-only package under `lab/scenarios/` | Embed the case in the Context module or API route | Keeps workload independent and reusable; neither selection policy nor transport owns the task. |
| Implementation selection | Two server-compiled Context constructors in a static allowlist | Import selected package code or accept constructors from the browser | Keeps execution reviewable and prevents arbitrary code loading. |
| Run evidence | One comparison manifest points to two ordinary run records | Duplicate all run evidence in a new comparison-only format | Preserves the existing artifact writers and standard run inspection path. |
| Cancellation | Abort when all attached POST callers disconnect | Add a separate cancel endpoint | Fits this deterministic, no-external-side-effect case without another public operation. |
| Model | Existing deterministic Replay | Add a live provider or answer grader | Isolates Context selection evidence and avoids treating answer quality as a Context metric. |
| Failure tests | Internal runner seam accepts deterministic test doubles | Expose failure controls over HTTP or add a general plugin API | Exercises failure and cancellation without making production runs configurable by callers. |

## Explicitly out of scope

- A general assembly editor, arbitrary package loading, marketplace, or client-side
  module execution.
- More than two Context implementations or any Planning, Memory, Tool Use, or Model
  Interface alternatives.
- A live provider, model-quality grader, leaderboard, synthetic score, or claim that
  one policy is universally better.
- General run search, sorting, retention management, remote storage, or a global Runs
  page. This slice reopens a comparison when given its ID.
- Live event streaming, automatic resumption after process restart, cross-process
  writers, authentication, or multi-tenant hosting.
- Changes to Platform Lab routes, run execution, evidence, or comparisons.

## Finished behaviour

### User-visible behaviour

- The Context workspace identifies the current implementation as budget-fitted
  recent history and the new implementation as a fixed recent-message window.
- The first case is server-owned and versioned as `old-important-fact-v1`. Its early
  preference and later distractor messages are synthetic. It contains six ordered
  prior messages with source IDs `old-important-fact:history:0` through
  `old-important-fact:history:5`. Sequence 0 is the user message “For future meal
  suggestions, I prefer Mediterranean food.” Sequence 1 is an assistant
  acknowledgement. Sequences 2–5 alternate two unrelated garden and desk-light
  details with brief assistant acknowledgements. The fixed task is “Using the prior
  conversation, identify the preference stated for future meal suggestions.” The
  shared token budget fits all six. With the default four-message window, the
  fixed-window implementation includes sequences 2–5 and reports sequences 0–1 as
  omitted for `window`.
- The contributor can set the fixed window from 1 to 12 prior messages; the default is
  four. Both implementations receive the same fixture, task, empty initial Memory state,
  planning behavior, Replay model, token budget, and remaining module configuration.
- The API runs the two variants sequentially. Each variant gets a fresh Memory
  session and its own run ID. The comparison ID is not a session or run ID.
- The result view shows implementation identity and configuration, exact messages
  passed to Replay, included and omitted source IDs with reasons, token count and
  basis, Replay output, ordered-event and flush status, and the run ID. It does not
  display a quality score.
- A URL containing the comparison ID loads the saved comparison after refresh. If
  the API cannot be reached, the UI shows that state and does not present stale
  evidence as a new run.
- Unknown cases, invalid window sizes, conflicting reuse of a comparison ID, and
  unavailable evidence produce clear error or incomplete states.

### Ownership and boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| `lab/scenarios/context-stress/` | Versioned, deterministic case data and workload description | Context selection policy, API behavior, or run comparison rules |
| `studio/modules/context/` | Budget-fitted and fixed-window selection, source dispositions, token-budget handling | Scenario task wording, run persistence, or UI state |
| `studio/assemblies/reference-agent/` | Static mapping from the selected Context identity to its constructor and configuration | Arbitrary imports, browser-selected code, or user-supplied constructors |
| `studio/experiments/` and `lab/experiments/` | Experiment identity, hypothesis, fixed controls, changed variable, and interpretation limits | Scenario content or implementation-specific execution |
| `apps/studio-api/` | Request validation, comparison lifecycle, run invocation, persistence, and safe read projection | Dynamic module loading or filesystem paths in responses |
| `apps/web/src/features/component-lab/` | Selection controls, comparison view, URL state, and presentation | Module execution, authoritative evidence, or fabricated results |

### HTTP contract and lifecycle

The Context experiment endpoint family has its own contract version,
`STUDIO_CONTEXT_EXPERIMENT_API_VERSION = "1"`. The shared chat evidence contract also
adds the `window` omission reason, so bump `STUDIO_CHAT_API_VERSION` from `"5"` to
`"6"`; ordinary `/chat` behavior and route payload fields otherwise stay unchanged.
Runtime validators reject unknown fields, malformed UUIDs, unsupported versions, and
bodies over 4 KiB. The only accepted request is:

```json
{
  "apiVersion": "1",
  "comparisonId": "<UUID>",
  "caseId": "old-important-fact-v1",
  "maxRecentMessages": 4
}
```

`POST /context-experiments` waits for the active attempt and returns its comparison
projection with HTTP 200. An identical concurrent POST joins the same in-process
operation; an identical POST after any terminal state returns the saved projection.
`GET /context-experiments/:comparisonId` returns the projection for a known UUID,
including while it is running; an unknown ID returns 404. Invalid bodies and unsupported
versions return 400, a known ID reused with a different request fingerprint returns
409, and persistence failures return 500. Error responses use
`{ apiVersion, error: { code, message } }` with `INVALID_REQUEST`,
`UNSUPPORTED_API_VERSION`, `COMPARISON_NOT_FOUND`, `COMPARISON_ID_REUSED`, or
`COMPARISON_PERSISTENCE_FAILED` as applicable. They contain no stack trace or local
path.

The JSON-safe comparison projection has these required fields: `apiVersion`,
`experiment`, `comparisonId`, `status`, `case` (`scenarioId`, `fixtureId`,
`fixtureVersion`),
`sharedControls` (task identity, reference Model Interface identity and parameters,
context token budget, and full reference assembly), `changedVariable`
(`id: "max-recent-context-messages"`, `maxRecentMessages`), and exactly two ordered
`variants`. Each variant contains its stable strategy identity and configuration,
`runId` once allocated, `status`, and the normal Studio turn evidence when available.
An optional typed failure explains a failed variant without exposing internals. The
normal turn evidence retains its own chat API version; its Context omission-reason
union adds `window`.

The projection field names are fixed: `experiment` is `{ id: "context-retention",
version: "1" }`; `case` is `{ scenarioId: "context-stress", fixtureId:
"old-important-fact", fixtureVersion: "1" }`; `sharedControls` is `{ taskId:
"old-important-fact:task:v1", model, modelParameters, contextBudget, assembly }`;
`changedVariable` is `{ id: "max-recent-context-messages", maxRecentMessages }`; and each
variant is `{ strategy, runId, status, evidence, failure }`, with `runId`, `evidence`,
and `failure` nullable until available. `strategy` uses the existing component identity
record; variants are ordered with `deterministic-context-assembler@0.4.0` first and
`fixed-recent-message-window@0.1.0` second. `model` and `assembly` use the existing
Studio contract identity records. `contextBudget` is
the exact kernel budget `{ contextWindowTokens: 8192, reservedOutputTokens: 512,
safetyMarginTokens: 256, tokenizer: "utf8-bytes-div4-estimate-v1" }`. `evidence` is
the existing `StudioChatTurnResponse` shape. `failure` is either null or
`{ code, message }` with a public error code and a safe diagnostic message. Responses
also contain `createdAt`, `startedAt`, `updatedAt`, and nullable `finishedAt` UTC
RFC 3339 timestamps. Persisted manifests and response projections are validated
against the same strict schema.

Comparison status is `running`, `completed`, `partial`, `failed`, `cancelled`,
`interrupted`, or `unknown`. Variant status is `pending`, `running`, `completed`,
`failed`, `cancelled`, `interrupted`, or `unknown`. `completed` requires two completed
variants; `partial` means exactly one variant completed and the other failed;
`failed` means both variants have terminal failed results and neither completed;
`cancelled` means cancellation prevented the pair from completing; `interrupted`
means a prior API instance left the manifest running; `unknown` means the durable
outcome cannot be established. Each status transition and per-variant run ID is
committed to the manifest before it is returned to a caller.

A variant is `completed` only when its `result.json` contains a successful terminal
turn. Its Observability receipt remains independently visible and may report `partial`
or `unknown`; neither state is converted into a quality score. A missing or unreadable
terminal result after an uncertain write is `unknown` until recovery can establish
the outcome.

An active operation tracks its connected POST callers and aborts the current variant
through its `AbortSignal` only after all attached callers disconnect. This prevents a
retrying duplicate caller from canceling work still awaited by another caller. Abort
does not roll back persisted work. The page uses that request lifecycle when the user
leaves or refreshes during execution, then uses GET to inspect the saved terminal or
interrupted state. There is no separate cancellation route in this slice.

The scenario package exports plain JSON-safe data and has no dependency on Studio,
the kernel, or a platform. The API adapter maps that data into Context-owned
`ContextMaterial` values and assigns provenance. The Context package does not import
the scenario package.

## State, persistence, and evidence

Use the existing `STUDIO_RUNS_ROOT` as the private local root. One comparison
manifest groups two ordinary run records:

```text
<runs-root>/context-comparisons/<comparison-id>/comparison.json
<runs-root>/run-<run-id>/config.json
<runs-root>/run-<run-id>/events.jsonl
<runs-root>/run-<run-id>/result.json
```

- The comparison store is the sole writer of `comparison.json`. It records schema
  version 1, comparison ID, request fingerprint, experiment and case identities and
  versions, shared controls, changed variable, expected strategy identities, each
  allocated run ID and terminal status, overall status, and `createdAt`, `startedAt`,
  `updatedAt`, and `finishedAt` timestamps in UTC RFC 3339 form. It contains no
  arbitrary paths or credentials.
- The existing run artifact store remains the sole writer of each run's
  `config.json` and `result.json`; the selected Observability module remains the sole
  writer of `events.jsonl`.
- Run configuration records the comparison ID, scenario and fixture versions,
  experiment identity/version, UTC RFC 3339 run timestamps, `environment:
  "studio-local-deterministic"`, `randomSeed: null`, `failureInjection: null`, complete
  reference assembly, exact Context and Memory configuration, empty initial Memory
  state, shared task and budget, deterministic Replay identity and parameters, and
  the effective tool definitions/capabilities. The per-run response retains Context
  messages, source ledger, model request/response (including tool definitions),
  module evidence, and Observability receipts.
- Each run ID is allocated and written to the comparison manifest before that run
  starts. The manifest is updated after each strategy reaches a terminal state.
- Comparison files and run directories use private permissions. Manifest updates
  use `0700` directories and `0600` files, plus a temporary file, file sync, rename,
  and directory sync. Reads validate the comparison ID, reject symlinks with
  no-follow opens, allowlist only `comparison.json`, `config.json`, and `result.json`,
  cap the manifest at 256 KiB and each run JSON file at 2 MiB, and never return
  filesystem paths. Use the existing run-artifact store's real-root and exclusive
  creation checks for run directories.
- No `metrics.json` is written. The token count is module evidence with its reported
  estimate basis, not a benchmark score.

## Failure, retry, and recovery semantics

- `comparisonId` is a browser-generated UUID and a durable idempotency key.
- A repeated identical POST while a comparison is active joins the active operation;
  a repeated identical POST after any terminal state returns the saved projection
  without starting more runs. Reusing the ID with different case or configuration
  returns `409 COMPARISON_ID_REUSED`; retrying a failed or interrupted comparison
  requires a new ID and creates a separate attempt.
- The request fingerprint is SHA-256 over a fixed-key-order serialization of the
  validated request plus the resolved experiment and fixture versions. The API
  instance owner ID is a fresh UUID generated once at process startup.
- The two variants run serially. If one reaches a terminal failure, preserve its
  result and still attempt the other variant unless the caller cancelled the
  comparison or persistence is unsafe. Overall status is `completed` only when both
  runs complete; otherwise it is `partial`, `failed`, or `cancelled` with per-run
  outcomes retained.
- Cancellation is triggered only when every attached POST caller disconnects.
  Cancellation cannot roll back a completed module operation. This case uses
  deterministic Replay and no external tools, so it has no external side effect to
  reconcile.
- A process crash may leave a manifest marked `running`, a run config, partial
  events, and no terminal result. The manifest records the owning API instance ID.
  On first read by a different instance, the store inspects only the known run
  artifacts and reconciles any valid terminal `result.json` before deciding status.
  Two successful terminal results recover as `completed`; one successful result and
  one missing terminal result recover as `interrupted`; an ambiguous write or
  unreadable evidence recovers as `unknown`. It never manufactures a completed result.
  The same comparison ID is not automatically resumed. A new ID starts a clearly
  separate attempt.
- The experiment pins the reference context budget at 8,192 context-window tokens,
  512 reserved output tokens, 256 safety-margin tokens, and
  `utf8-bytes-div4-estimate-v1`. API integration tests verify all six prior messages
  fit this budget under the reported estimator. Deterministic Replay emits
  request-shape diagnostics; it is deliberately not expected to recover the old fact
  or establish answer quality.
- No random sampling or deliberate failure injection is used. The records state this
  explicitly so the absence of a seed or injected failure is inspectable.
- A run write or flush with an uncertain acknowledgement remains `unknown` according
  to its existing receipt contract. The comparison projection preserves that status.
- Only one Studio API process may write a given runs root. Cross-process locking and
  concurrent hosts are outside this slice.

## Security and configuration

- Use the trusted host-selected `STUDIO_RUNS_ROOT`; do not accept paths from HTTP
  requests.
- Accept only the fixed case ID, a valid UUID comparison ID, and an integer window
  size from 1 through 12. Reject unknown fields and oversized JSON bodies.
- Keep the static implementation registry on the API side. The browser can choose
  only the two registered strategy IDs and the bounded window size.
- Keep the API's existing local-development network and no-authentication limits.
  Do not expose it to an untrusted network.
- No secrets, user-provided prompts, live provider requests, or external environment
  capabilities are part of the fixture.

## Implementation checklist

### 1. Define the scenario and experiment

- [ ] Inspect the existing `context-stress` scenario and Context fixture conventions.
- [ ] Add a small scenario workspace package at `lab/scenarios/context-stress/` and
      include that exact package in `pnpm-workspace.yaml`. Export the versioned
      `old-important-fact-v1` task and prior messages as plain data with no Studio or
      Context imports.
- [ ] Add scenario tests for stable source IDs, sequence ordering, synthetic content,
      exact task text, and fixture version.
- [ ] Add `lab/experiments/context-retention/README.md` with the hypothesis, case,
      fixed controls, changed variable, procedure, expected observations, and limits.
- [ ] Record the design choice: keep the reusable fixture in the scenario package;
      keep only the comparison procedure and strategy pair in the experiment/API.
      This avoids embedding a scenario in a Context implementation or HTTP route.

### 2. Add the Context implementation and evidence contract

- [ ] Preserve the current assembler behavior and identity. Add a fixed-window
      assembler that implements the same `ContextAssembler` interface and reports its
      own stable identity and version.
- [ ] Define the fixed-window unit as prior Context messages, not conversation turns.
      Validate `maxRecentMessages` as an integer from 1 through 12.
- [ ] Select the newest configured number of prior messages, retain chronological
      model order, then apply the existing complete-message token budget and Memory
      selection rules. Required instructions, the current task, Planning proposal,
      and correlated tool exchanges keep their existing handling.
- [ ] Add `window` to the omission-reason union. Distinguish messages omitted by the
      fixed window from those omitted by token budget or invalid source data in both
      module evidence and the HTTP `omissions` and `sourceLedger` records.
- [ ] Bump `module-context` from `0.5.0` to `0.6.0`, update the workspace lockfile,
      document both implementations and their configuration, and retain the existing
      package's pre-1.0 minor-version rule.
- [ ] Bump `reference-agent-assembly` from `0.3.0` to `0.4.0` and its reported
      descriptor from `0.5.0` to `0.6.0`; preserve the baseline identity and report
      the fixed window as `fixed-recent-message-window@0.1.0`.
- [ ] Add tests for stable ordering, inclusion within the window, `window` omission
      evidence, budget omissions after window selection, required-message overflow,
      invalid configuration, cancellation, and deterministic repeated input.

### 3. Make Context selection static and replaceable in the reference assembly

- [ ] Refactor the reference assembly's one-entry-per-area registry into an explicit
      static allowlist for the two Context constructors while keeping every other
      area fixed.
- [ ] Keep the kernel's existing 8,192/512/256 budget as the shared runtime value;
      ensure the assembly descriptor reports that same value for both strategies.
- [ ] Resolve the selected Context identity and its validated configuration before
      constructing run-scoped modules or writing artifacts. Reject unknown identities,
      package versions, configuration keys, and incompatible descriptors before a
      run starts.
- [ ] Ensure both resolved assemblies report all twelve components and differ only
      in Context implementation identity/configuration. Run configs may additionally
      differ by their required run/session IDs and timestamps.
- [ ] Keep `runTextTurn` on the existing role-specific Context interface. Do not add
      an experiment-only branch to the kernel.
- [ ] Add reference-assembly tests for both allowlisted selections, exact descriptor
      reporting, shared non-Context selections, and rejection of arbitrary or altered
      module descriptors.

### 4. Add the versioned API and durable comparison lifecycle

- [ ] Define request, response, error, status, and runtime validator types in a new
      `studio/http-contract` Context experiment module. Add an independent schema
      version for this endpoint family. Use the exact DTO fields and nullability
      specified in the HTTP contract section; validate response projections too.
- [ ] Bump `studio-http-contract` from `0.2.0` to `0.3.0` and update the workspace
      lockfile for the additive contract exports.
- [ ] Bump `STUDIO_CHAT_API_VERSION` from `"5"` to `"6"` for the additive Context
      omission reason and update its runtime validators and contract tests; preserve
      ordinary `/chat` behavior.
- [ ] Implement `POST /context-experiments` with `comparisonId`, the fixed case ID,
      and bounded `maxRecentMessages`; the server always runs the current baseline
      and fixed-window alternative as the pair.
- [ ] Implement `GET /context-experiments/:comparisonId` with UUID validation and a
      safe projection reconstructed from the manifest and its run records.
- [ ] Add a comparison store under `STUDIO_RUNS_ROOT/context-comparisons/` with
      private directories, exclusive creation, atomic status updates, request
      fingerprint checks, file sync, symlink checks, and size limits.
- [ ] Allocate a distinct run ID for each strategy and record it in the manifest
      before run creation. Extend the run execution helper to accept the allocated ID
      and comparison metadata without changing existing chat routes.
- [ ] Keep one internal variant-runner seam at the route registrar for deterministic
      API tests. Production always supplies the static reference runner; do not add
      runner selection to `StudioApiAppOptions` or the HTTP request.
- [ ] Adapt the scenario package's neutral messages into Context materials at the API
      adapter. Give both variants identical fixture source IDs, task, budget, empty
      Memory state, deterministic Replay model, and non-Context configuration.
- [ ] Run variants serially with independent empty Memory sessions and no Memory
      writes (`remember: false`). Persist the standard config, ordered events, and
      terminal result for each run.
- [ ] Add idempotent duplicate handling: identical active requests share one
      operation, identical terminal requests return saved data, and ID reuse with a
      different fingerprint returns 409. Do not retry a failed or interrupted ID.
- [ ] Preserve per-run failed and cancelled outcomes plus Observability `partial` and
      `unknown` receipts.
      Do not start a second variant after request cancellation or an unsafe persistence
      failure.
- [ ] On API restart, report a manifest left in `running` as interrupted when no
      local operation owns it. Do not resume or rerun automatically.
- [ ] Add API tests using temporary run roots for successful comparison, reopening
      after API recreation, idempotent duplicate requests, conflicting ID reuse,
      invalid inputs, symlink/path rejection, partial failure, cancellation, and
      missing terminal evidence after interruption. Verify reconciliation both when
      valid terminal results survived a stale manifest and when they did not. Verify
      one disconnected duplicate does not cancel a comparison while another caller
      remains connected.

### 5. Connect the Context workspace

- [ ] Add typed client functions for POST and GET using the new HTTP contract.
- [ ] Check the existing `/health` route when the Context workspace opens and provide
      a retry action; show the API as unavailable and disable Run until health is
      confirmed.
- [ ] Update `contextStrategies` and status labels so the two implemented choices
      have accurate names, identities, parameters, and evidence; keep unsupported
      choices marked planned.
- [ ] Add the bounded recent-message control and a Run comparison action. Disable the
      action while running or when the API is unavailable.
- [ ] Show the fixed controls and changed variable before execution, then show the
      actual two run results, source-ledger differences, exact model messages, token
      basis, run IDs, and persistence status after execution.
- [ ] Put the comparison ID in the page query string and load saved evidence on direct
      navigation or refresh. Show missing, interrupted, and partial results plainly.
- [ ] Generate a fresh UUID for each new Run action. Changing the window value creates
      a new comparison ID; reloading an existing comparison performs GET only.
- [ ] Keep all strategy constructors and authoritative status in the API. Preserve the
      current `/studio/chat` behavior and other component-area planned views.
- [ ] Add a Chromium browser acceptance check for run, side-by-side evidence,
      refresh/reopen, API unavailable, and no fabricated score.

### 6. Document and validate the slice

- [ ] Update `studio/modules/context/README.md`,
      `studio/assemblies/reference-agent/README.md`,
      `studio/http-contract/README.md`, `apps/studio-api/README.md`,
      `apps/web/src/features/component-lab/README.md`, and
      `docs/planning/component-lab.md` to match the implementation and its limits.
- [ ] Document the scenario package and experiment in their own READMEs. Keep the
      scenario definition independent from the experiment procedure.
- [ ] Update the Studio program and product plan indexes with the implementation
      results and any follow-up needed for broader Context strategies.
- [ ] Run the narrow module, scenario, assembly, HTTP contract, and API test suites.
- [ ] Run web typecheck and production build, then the Studio Context browser check
      against the local Studio stack.
- [ ] Run the documentation generator, resolve local links, and inspect
      `git diff --check` and the complete diff.

## Test coverage

### Unit tests

- [ ] Scenario fixture version, stable source IDs, and ordering; API adaptation preserves
      those IDs and assigns the documented provenance.
- [ ] Both Context implementations' ordering, omission reasons, token budget, and
      failure behavior.
- [ ] Fixed-window configuration bounds and unknown-key rejection.
- [ ] Static assembly allowlist and Context-only substitution.
- [ ] HTTP schema runtime validation and unsupported version handling.
- [ ] Comparison manifest serialization, atomic update, and request fingerprint.
- [ ] Comparison status derivation for complete, partial, failed, cancelled,
      interrupted, and unknown evidence combinations.

### Integration tests

- [ ] POST runs both implementations against one fixed case and writes two normal run
      directories plus one comparison manifest.
- [ ] The baseline includes all six fixture messages and the default four-message
      window includes only sequences 2–5, with sequences 0–1 omitted for `window`;
      both reports use the pinned shared budget and same fixture source IDs.
- [ ] GET returns the same saved comparison after creating a fresh API app against
      the same temporary root.
- [ ] Duplicate requests do not create extra run directories; changed requests under
      the same ID fail with 409.
- [ ] A Context failure remains visible and does not erase the other variant's run.
- [ ] Cancellation leaves honest partial evidence and does not start the next variant.
- [ ] A manifest or run with no terminal result is reported as interrupted or unknown,
      never completed.
- [ ] API responses contain no local filesystem paths and reject traversal or
      symlink-based reads.

### Manual acceptance checks

- [ ] Start the documented local Studio stack and open
      `/components/context-management`.
- [ ] Run the old-important-fact case with the default fixed window and verify the
      baseline includes the early preference while the fixed window marks it omitted
      for `window`.
- [ ] Open the resulting comparison URL in a fresh browser tab and confirm it loads
      the saved evidence without starting another run.
- [ ] Simulate unavailable health and comparison responses and confirm the page reports
      unavailable status without replacing saved evidence with preview text. A manual
      process-stop check must run the web app separately so the API can stop alone.
- [ ] Inspect `comparison.json`, both run configs, ordered event files, and results
      under a temporary `STUDIO_RUNS_ROOT`; confirm the case/model/shared controls
      match and the run differences are limited to Context identity/configuration and
      required per-run IDs/timestamps.
- [ ] Confirm there are no quality scores, real-provider claims, or path disclosures.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/scenario-context-stress test
pnpm --filter @agent-harness-lab/module-context test
pnpm --filter @agent-harness-lab/reference-agent-assembly test
pnpm --filter @agent-harness-lab/studio-http-contract test
pnpm --filter @agent-harness-lab/studio-api test
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
node --test apps/web/tests/browser/context-experiment.browser.test.mjs
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

API tests must use a temporary `STUDIO_RUNS_ROOT` and remove it in `finally` blocks.
Before the browser command, start `./scripts/run_local_stack.sh studio` with a fresh
temporary `STUDIO_RUNS_ROOT` exported in that shell; the web app defaults to
`http://127.0.0.1:5173`. The browser check uses the deterministic local API and
controlled fixture only; it does not require Docker, credentials, or a live model
provider. It does require Chromium (`google-chrome` by default, or set
`AGENTLAB_CHROME_BIN`). Stop the stack and remove the temporary run root after
inspecting its records.

## Completion gate

- [ ] Every applicable checklist item and test passes.
- [ ] One contributor can run, inspect, and reopen the two-strategy experiment from
      the browser.
- [ ] The two strategy runs share the same scenario and controls, and the evidence
      proves which Context sources each implementation selected or omitted.
- [ ] Failure, duplicate request, cancellation, interruption, and persistence
      uncertainty remain visible without false completion claims.
- [ ] Documentation describes the actual strategy algorithms, fixture, evidence,
      version identities, local setup, and interpretation limits.
- [ ] The other eleven areas and the remaining unsupported Context strategies remain
      clearly marked planned.

## Commit discipline and handoff

- [ ] Keep the Context module and scenario package work separate from API persistence
      and browser presentation when each section is independently reviewable.
- [ ] Include relevant tests and documentation with each coherent implementation
      section.
- [ ] Review the baseline and full diff before staging. Preserve unrelated work.
- [ ] Record commit hashes, validation results, and known limitations before moving
      this plan to `completed/`.

## Completion record

Not completed. Fill this section when the plan passes its completion gate.
