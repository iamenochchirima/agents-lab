# Cross-platform production acceptance and comparison

**Created:** `2026-09-20T13:11:14+02:00`<br>
**Last updated:** `2026-09-20T15:52:01+02:00`<br>
**Status:** Active — Phase 0 and the shared server contract are underway; final matrix remains gated by Mastra completion<br>
**Owner:** Primary platform integration owner<br>
**Platforms:** Temporal, Restate, LangGraph, Mastra<br>
**Priority:** Next platform phase after `mastra-agent-runtime-and-workflows.md`

This plan validates the four priority platform profiles together through one shared
workload and the actual browser experience. It does not add a new platform. It turns
the existing Compare surface into a reliable acceptance tool while preserving each
platform's native execution, recovery, and evidence semantics.

## Start here

Read these before changing code:

- [repository rules](../../../../AGENTS.md)
- [documentation guide](../../../../docs/contributing/documentation.md)
- [implementation-plan lifecycle](../../../README.md)
- [platform ownership](../../../../server/src/platforms/README.md)
- [server ownership](../../../../server/README.md)
- [runner interface](../../../../server/src/control-plane/ports/README.md)
- [run evidence layout](../../../../lab/runs/README.md)
- [Mastra completion plan](./mastra-agent-runtime-and-workflows.md)
- [completed cross-platform conformance plan](../completed/platform-agent-conformance.md)
- [completed platform completion wave](../completed/platform-completion-wave.md)
- [OpenRouter model selection](../completed/openrouter-model-selection.md)
- [session context and compaction](../completed/context-management.md)
- [tool-enabled turn loop](../completed/tool-enabled-turn-loop.md)
- [browser Chat surface](../completed/browser-chat-surface.md)
- [Temporal architecture](../../../../server/src/platforms/temporal/docs/architecture.md)
- [Restate semantics](../../../../server/src/platforms/restate/docs/semantics.md)
- [LangGraph baseline notes](../../../../server/src/platforms/langgraph/docs/README.md)
- [Mastra semantics](../../../../server/src/platforms/mastra/docs/semantics.md)

The completed conformance plan already established the common workload and platform
boundaries. This plan verifies the integrated product flow and closes defects found by
real comparison. It must not replace platform-specific semantics with a common lowest
denominator.

## Source and implementation assumptions

The platform-specific APIs and local runtime versions must be rechecked before code
changes. The existing source audit and platform documents are the starting point, not
proof that an installed package has not changed.

The primary comparison uses these runnable variants:

| Platform | Variant | Local execution | Native state owner |
| --- | --- | --- | --- |
| Temporal | `baseline` | Temporal server and TypeScript worker | Temporal workflow history |
| Restate | `baseline` | Restate runtime and TypeScript service | Restate journal, durable state, and invocation |
| LangGraph | `baseline` | Python service with local SQLite checkpointing | LangGraph thread/checkpoint store |
| Mastra | `baseline` | Lab server process with the real Mastra Agent | Lab process and normalized evidence |

`mastra/workflow` is validated separately for native suspend/resume in the Mastra
completion plan. It is not mixed into the primary apples-to-apples baseline comparison.
If the Compare UI exposes it later, it must be labelled as a different execution
profile rather than presented as equivalent to the four baseline variants.

## Purpose

Prove that the Lab can run the same agent workload through Temporal, Restate,
LangGraph, and Mastra from the browser, then show the meaningful differences in
execution, context, tools, recovery, and evidence. The comparison is about harness
behaviour, not a benchmark or a contest for the shortest model response.

## Definition of done

After the Mastra completion plan is archived, a contributor can start the documented
native local stack, open any of the four platform Chat pages, select the same model and
workload, and run it. From Compare, the contributor can select at least two of the four
platforms and submit one shared task. Each platform receives an independent run ID,
session ID, native execution identity, and evidence directory.

```text
same workload and model
  → independent RunRequest per selected platform
  → native platform execution and tool/context handling
  → one evidence directory per run
  → side-by-side browser status and results
```

The finished phase must demonstrate:

- prompt-only execution on all four platforms;
- the bounded calculator tool path on all four platforms using the shared tool contract;
- a two-turn session on all four platforms with visible context-window usage;
- comparison runs that share input but never share session state or native execution;
- honest unavailable, failed, cancelled, stale, and reconciliation-required states;
- normalized evidence plus platform-native evidence for every completed run;
- native events and recovery details remaining visible behind progressive disclosure;
- deterministic automated coverage without an OpenRouter key;
- manual real-model acceptance with the selected OpenRouter model;
- no fake output, fake token counts, fake health, or silent provider substitution.

## Comparison contract

### Workload matrix

The same workload is used for each selected platform. The tests compare lifecycle and
evidence semantics, not exact natural-language output.

| Case | Input | Expected observation |
| --- | --- | --- |
| Prompt | Short response request with no tool requirement | One model execution and terminal result |
| Calculator | `Calculate 40 + 2 and explain the result.` | Validated calculator call, tool result, final response |
| Continuation | Two turns in one logical conversation | Second turn receives the first turn through the shared context contract |
| Dependency failure | Platform-specific service made unavailable before dispatch | Honest unavailable state with no fake run result |
| Cancellation | Cancel while the run is active where the platform supports it | Platform-specific cancellation or unknown outcome, never fabricated completion |

Automated tests use deterministic model fixtures that still cross the real platform
adapter and tool boundary. Manual acceptance uses the real selected OpenRouter model.
The plan must record the model identifier, context window, parameters, platform
versions, and local service versions for every manual comparison.

### Identity and isolation rules

- The Compare action creates one independent Lab run per platform.
- Every run gets its own `runId`, native execution identity, evidence directory, and
  context session. A shared logical comparison must never become a shared transcript.
- Add an optional validated `comparisonId` to the run manifest if the current API
  cannot correlate members safely. The server generates it once per Compare action;
  the individual `runId` remains the durable identity.
- Store the comparison identity in each `config.json` and expose it in safe run details.
- A platform failure does not cancel or rewrite another platform's result.
- Duplicate submission of one Compare member uses its own `clientTurnId` and must not
  create a second native execution.
- Compare results are partial by design. The UI reports each member independently.

### What comparison means

The comparison records:

- admission and dispatch time;
- model and usage data returned by the provider;
- context snapshot revision, token basis, remaining percentage, and compaction state;
- tool request, validation, execution, and result events;
- native status, retry count, cancellation, restart, and reconciliation behaviour;
- normalized terminal status and evidence completeness.

It does not rank platforms by response wording, claim identical durability, or claim
exactly-once delivery to a model provider or external tool.

## Scope

### 1. Shared comparison contract

- [ ] Verify the four baseline registrations and their real connectivity responses.
- [x] Define and validate the optional `comparisonId` correlation field, or record
      evidence that the existing request is sufficient without adding it.
- [x] Ensure the immutable manifest records the same task, model, tool limits, scenario,
      experiment, and comparison identity for every member.
- [x] Ensure each member receives a new session identity and run identity.
- [x] Reject malformed comparison IDs and mismatched member manifests.
- [x] Preserve platform-specific variant configuration inside each platform boundary.

### 2. Server and evidence integration

- [ ] Keep `RunEvidenceStore` as the sole writer for normalized `lab/runs/<run-id>/`
      records.
- [x] Persist comparison correlation only as safe manifest metadata; do not create a
      second mutable evidence writer or merge event streams into one run.
- [ ] Ensure each member writes `config.json`, `events.jsonl`, `context.json`,
      `trajectory.json`, `metrics.json`, and `result.json` when applicable.
- [ ] Retain `native/temporal.json`, `native/restate.json`, `native/langgraph.json`,
      or `native/mastra.json` without flattening platform-specific details.
- [ ] Verify event ordering and terminal-result cardinality independently per run.
- [x] Add a server-side comparison acceptance test that checks partial success,
      independent failures, duplicate admission, and stale inspection.

### 3. Platform acceptance

- [ ] Run the prompt case through Temporal, Restate, LangGraph, and Mastra.
- [ ] Run the calculator case through all four platform adapters.
- [ ] Run the two-turn context case through all four platforms with separate sessions.
- [ ] Verify each platform's native identity and native evidence shape.
- [ ] Verify cancellation and unavailable dependency behaviour using each platform's
      documented local profile.
- [ ] Fix only platform-local defects found by the acceptance matrix without moving SDK
      types or platform retry rules into common server code.
- [ ] Record known differences instead of making them disappear in normalization.

### 4. Browser Compare and Chat

- [ ] Make Compare submit the same workload and model to selected platforms.
- [ ] Show one result row per platform with independent status, output, error, and run ID.
- [ ] Show partial completion when one platform fails or is unavailable.
- [ ] Keep model selection, task, scenario, experiment, and tool settings consistent.
- [ ] Show context usage and tool activity for each Chat run.
- [ ] Link each result to its own run details and evidence files.
- [ ] Prevent polling races, duplicate assistant messages, duplicate React keys, and
      stale comparison rows after closing and reopening the modal.
- [ ] Verify desktop, tablet, and mobile layouts without overflow or hidden results.
- [ ] Keep platform-native details behind expandable run details rather than adding a
      comparison dashboard full of explanatory text.

### 5. Documentation and experiment record

- [ ] Update the platform index with this plan and its completion status.
- [ ] Update the Compare and Platform Chat documentation with the identity and failure
      rules that users can actually observe.
- [ ] Add or update a reproducible experiment under `lab/experiments/` describing the
      comparison hypothesis, workload, variables, controls, and evidence.
- [ ] Add a development playground walkthrough for running one comparison locally.
- [ ] Record exact local service commands, model configuration, observed results, and
      limitations.
- [ ] Record release decisions. The referenced canonical release-process file is absent
      in this checkout and must remain an explicit limitation.

## Explicitly out of scope

- AWS Step Functions, new platform adapters, and hosted platform deployment.
- Anesu, Studio, computer-native environments, browser automation, sandboxes, or VMs.
- Long-term memory, retrieval, observational memory, or a new compaction algorithm.
- Skills, plugins, MCP, OAuth, social connectors, gateways, cron, daemon supervision,
  and side-effecting external tools.
- Streaming-token comparison or a benchmark leaderboard.
- Automatic provider fallback, silent model substitution, or blind retry after an
  ambiguous billable model request.
- A shared agent loop that makes platform execution appear identical.

## Finished behaviour

### User-visible behaviour

On a platform Chat page, the user can run a real prompt, inspect the selected model,
context usage, tool activity, run status, and evidence. In Compare, the user selects
two or more of Temporal, Restate, LangGraph, and Mastra, then submits one task.

The results show one row per platform. Each row can be completed, failed, cancelled,
unavailable, or reconciliation-required without changing the other rows. The user can
open each run independently and see its native identity and evidence.

The UI never shows a successful assistant response when the provider outcome is unknown.
It never displays `0%` merely because token information is unavailable. It reports
unknown context quality when the selected model does not expose a trusted token basis.

### Ownership and boundaries

```text
CompareRunModal and PlatformChatPage
  → selection, submission, polling, row-level status, and links to run details

Lab server run service
  → request validation, comparison identity, dispatch, reconciliation, and normalized projection

Context capability
  → session identity, snapshots, compaction, token budget, and context projection

Tool capability
  → enabled names, schemas, validation, calculator execution, and call limits

server/src/platforms/<platform>
  → native SDK/runtime calls, native state, retries, cancellation, and native evidence

RunEvidenceStore
  → sole writer for normalized evidence under lab/runs/<run-id>/
```

The browser never imports a platform SDK or reads a platform database. Platform
adapters return normalized event intents and safe native references to the Lab server.
Platform directories do not import one another.

## State, persistence, and evidence

Each comparison member remains an ordinary Lab run:

```text
lab/runs/<run-id>/
  config.json                 # immutable task, model, selection, and comparison identity
  context.json                # latest server-owned context snapshot for this turn
  events.jsonl                # ordered normalized event projection
  trajectory.json             # normalized phases when the platform provides them
  metrics.json                # observed usage and lifecycle metrics
  result.json                 # one confirmed terminal result, if terminal
  logs/operations.jsonl       # safe lifecycle and reconciliation records
  native/<platform>.json      # bounded platform-specific reference and native summary
```

- [ ] `comparisonId` is opaque, bounded, and safe for filenames or JSON metadata.
- [ ] Each run has one immutable manifest and one terminal result at most.
- [ ] The server writes normalized evidence atomically and idempotently.
- [ ] Native evidence is redacted, bounded, versioned, and platform-specific.
- [ ] A suspended or unknown run does not receive a fabricated `result.json`.
- [ ] A comparison does not overwrite another member's context or result.
- [ ] Retention and cleanup instructions identify platform state separately from Lab runs.

## Failure, retry, and recovery semantics

- [ ] A failed connectivity preflight produces an unavailable comparison row and no
      fabricated run. If a run was already admitted, its evidence remains inspectable.
- [ ] Each platform retains its own retry policy and native status. The server does not
      retry a model request merely because a comparison member is slow.
- [ ] A lost dispatch acknowledgement is reconciled per member. It never becomes a
      successful result based only on the browser request returning.
- [ ] Cancellation is issued per run. One member's cancellation does not cancel peers.
- [ ] Server replacement reloads evidence per run and asks the native adapter for the
      current state. It does not adopt an in-memory run without native evidence.
- [ ] Duplicate Compare submission uses stable client turn IDs per member and does not
      create duplicate native executions.
- [ ] Duplicate and out-of-order events are deduplicated per run, never across runs.
- [ ] A partial comparison remains partial. The UI never converts it into an all-pass
      or all-fail result.
- [ ] Unknown external outcomes remain `reconciliation_required` or the platform's
      documented unknown state until observed.

## Security and configuration

- [ ] The OpenRouter key remains process environment-only and never enters comparison
      manifests, logs, browser payloads, native evidence, or result files.
- [ ] Comparison IDs, prompts, model IDs, and selection fields are bounded and validated.
- [ ] Tool capabilities remain deny-by-default and only enable the shared calculator.
- [ ] Local platform state paths remain explicit and outside committed evidence.
- [ ] Missing services and missing model configuration return actionable unavailable
      states without probing a paid provider call.
- [ ] Real-model manual runs use non-sensitive prompts and a reviewed model selection.

## Implementation checklist

### Phase 0: contract checkpoint

- [ ] Re-read the Mastra completion record and confirm all four baseline variants are
      runnable before starting this plan.
- [ ] Recheck installed platform package/runtime versions and local service commands.
- [x] Decide whether `comparisonId` is required, then commit the contract decision and
      tests before changing the Compare UI.
- [ ] Freeze the workload, model settings, tool limits, and context policy for the first
      acceptance matrix.

### Phase 1: server comparison support

- [x] Add the smallest manifest/API change needed for comparison correlation.
- [x] Preserve independent run IDs, sessions, native references, and evidence roots.
- [x] Add server tests for identical inputs, different run identities, partial success,
      duplicate requests, unavailable dependencies, and stale projections.
- [x] Add a deterministic comparison fixture that does not call OpenRouter.

### Phase 2: platform matrix

- [ ] Execute prompt, calculator, continuation, unavailable, cancellation, and restart
      checks through each of the four platform adapters.
- [ ] Fix only platform-local defects exposed by the matrix.
- [ ] Add missing native evidence or status mapping without removing useful native data.
- [ ] Record platform-specific observations and limitations in the relevant docs.

### Phase 3: browser surface

- [ ] Update Compare to carry the shared workload and comparison identity.
- [ ] Render independent result rows, run IDs, status, output, errors, and evidence links.
- [ ] Add deterministic browser tests for all-success, partial failure, unavailable
      platform, close/reopen, duplicate submission, and row isolation.
- [ ] Add live browser acceptance for the four platforms with a real OpenRouter model.
- [ ] Fix console, polling, duplicate-key, hydration, and layout issues found by tests.

### Phase 4: documentation and handoff

- [ ] Add the comparison experiment and local playground.
- [ ] Update platform and UI documentation with exact commands and observed behaviour.
- [ ] Record validation counts, manual results, known limitations, and release decisions.
- [ ] Move this plan to `completed/` only after every applicable item is checked.

## Parallel work and ownership

Parallel work begins only after Phase 0 is committed. The primary agent owns shared
contracts, server integration, browser integration, final acceptance, and plan archive.

| Workstream | Owned paths | Must not change | Handoff |
| --- | --- | --- | --- |
| Temporal matrix | Temporal tests/docs only | common server and web | native observations, failures, evidence |
| Restate matrix | Restate tests/docs only | common server and web | native observations, failures, evidence |
| LangGraph matrix | LangGraph tests/docs only | common server and web | service observations, failures, evidence |
| Mastra matrix | Mastra tests/docs only after Mastra plan closes | common server and web | baseline observations, limitations, evidence |
| Server comparison | `server/src/control-plane/**` and server comparison tests | platform-local runtime code | contract, API, evidence results |
| Browser acceptance | `apps/web/src/features/platforms/**` and browser tests | server contract and Anesu/Studio UI | UI results, screenshots, console findings |
| Experiment/playground | `lab/experiments/**`, `development/playground/**` | runtime and UI code | reproducible procedure and limitations |

No workstream may silently change another platform's retry, identity, or durability
semantics. Shared-file changes are integrated sequentially by the primary agent.

## Test coverage

### Unit and contract tests

- [ ] comparison ID validation and manifest propagation;
- [ ] identical workload with independent run/session/client-turn identities;
- [ ] comparison row status and partial-result projection;
- [ ] event and terminal-result isolation across runs;
- [ ] context projection and unknown-token handling;
- [ ] tool capability and calculator evidence consistency;
- [ ] redaction of keys, headers, prompts, and raw provider responses;
- [ ] duplicate admission, stale state, cancellation, and unknown outcomes.

### Platform integration tests

- [ ] Temporal prompt, calculator, continuation, cancellation, restart, and evidence;
- [ ] Restate prompt, calculator, continuation, cancellation, restart, and evidence;
- [ ] LangGraph prompt, calculator, continuation, service restart, and evidence;
- [ ] Mastra prompt, calculator, continuation, process-local recovery, and evidence;
- [ ] per-platform unavailable dependency and invalid configuration behaviour;
- [ ] no-Docker deterministic local profile for every platform that supports one.

### Browser acceptance tests

- [ ] each platform Chat runs a prompt and displays the actual output;
- [ ] each platform Chat shows model, tool activity, context usage, and evidence links;
- [ ] Compare submits the same task to at least two platforms;
- [ ] Compare keeps runs and context sessions independent;
- [ ] Compare renders partial success and unavailable states honestly;
- [ ] reopening or polling a comparison does not duplicate messages or rows;
- [ ] desktop, tablet, and mobile layouts remain usable;
- [ ] browser console has no React key, hydration, route, or polling-loop errors.

### Manual acceptance

- [ ] Start the local stack without Docker and verify service readiness.
- [ ] Select the same OpenRouter model on Temporal, Restate, LangGraph, and Mastra.
- [ ] Run the prompt and calculator cases from Chat.
- [ ] Run a second turn in each Chat session and inspect context continuity.
- [ ] Run a comparison with at least Temporal, Restate, LangGraph, and Mastra.
- [ ] Stop or misconfigure one platform service and verify only that member is unavailable.
- [ ] Inspect every comparison member's evidence and native reference.
- [ ] Confirm no key, authorization header, raw provider response, or unsafe prompt data
      was retained beyond the documented evidence policy.

## Required validation commands

```bash
# Server checks
pnpm --filter @agent-harness-lab/lab-server typecheck
pnpm --filter @agent-harness-lab/lab-server test

# Platform-focused checks
pnpm --filter @agent-harness-lab/lab-server test:temporal
pnpm --filter @agent-harness-lab/lab-server test:restate
pnpm --filter @agent-harness-lab/lab-server test:langgraph
pnpm --filter @agent-harness-lab/lab-server test:mastra

# Web checks
pnpm --filter @agent-harness-lab/web typecheck
pnpm --filter @agent-harness-lab/web build
node --test apps/web/tests/browser/platform-chat.browser.test.mjs

# Optional live browser matrix, with local services and OpenRouter configured
AGENTLAB_RUN_LIVE_PLATFORM_UI=1 \
AGENTLAB_LIVE_PLATFORM_IDS=temporal,restate,langgraph,mastra \
node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs

# Documentation and repository checks
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

The live matrix is optional for deterministic CI and requires the local platform
services plus `OPENROUTER_API_KEY`. Record skipped services and the reason. Do not make
Docker a prerequisite for a platform that already has a native local profile.

## Documentation and release impact

- Analytics: `not applicable`; this phase adds no product analytics.
- Structured logging: record comparison identity, member platform, lifecycle status,
  retry count, duration, and reconciliation outcome without prompts, outputs, headers,
  or secrets.
- Metrics: retain observed provider usage, context projection, tool counts, native
  retries, and durations. Do not invent missing values.
- Version identity: record platform package versions, runtime versions, model ID,
  context policy, and local service versions in the validation record.
- Migration: `not applicable` unless the comparison manifest changes require an additive
  schema version. Existing run evidence must remain readable.
- Rollout: local-only browser acceptance; no hosted deployment.
- Rollback: disable Compare correlation changes while retaining ordinary independent
  Chat runs and evidence.
- Security: validate comparison metadata, preserve secret boundaries, and keep tools
  deny-by-default.
- Known limitation: real OpenRouter output and usage are provider/model dependent and
  are not a fair quality benchmark across platforms.
- Release-process limitation: `docs/internal/operations/release-process.md` is absent
  from this checkout, so its canonical decisions cannot be verified here.

## Commit discipline

Use focused commits rather than one large comparison commit:

1. comparison contract, workload fixture, and server tests;
2. platform matrix tests and platform-local corrections;
3. Compare and Chat UI plus deterministic browser tests;
4. live acceptance record, experiment, playground, and documentation;
5. plan completion record and move to `completed/`.

Before each commit, inspect `git status`, stage only owned files, run the relevant
narrow checks, and preserve unrelated Anesu, Studio, lockfile, and playground changes.

## Completion gate

Before archiving this plan:

- [ ] Mastra completion plan is archived and all four baseline variants are runnable.
- [ ] The same deterministic workload passes through all four platforms.
- [ ] The same real model and task can be submitted through Chat and Compare.
- [ ] Comparison members have independent run IDs, sessions, native identities, and evidence.
- [ ] Partial success, unavailable services, cancellation, restart, and unknown outcomes
      are represented honestly.
- [ ] Context, tools, normalized events, and native details are inspectable.
- [ ] Browser tests pass without duplicate rows, duplicate messages, or console errors.
- [ ] Documentation, experiment, playground, validation results, and limitations are current.
- [ ] Each coherent section has a focused commit.
- [ ] No applicable checklist item remains unchecked.

## Completion record

Complete only when the plan is moved to `completed/`.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`<br>
**Commits:** `[commit hashes]`

### Validation

- `[command]` — `[result]`
- `[manual comparison]` — `[observed result]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

This plan records the first four-platform comparison phase. Later platform variants,
memory capabilities, external integrations, or hosted deployments require their own
plans and must not be silently added here.
