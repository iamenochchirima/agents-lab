# Mastra agent runtime and durable workflows

**Created:** `2026-09-20T11:34:37+02:00`<br>
**Last updated:** `2026-09-20T11:34:37+02:00`<br>
**Status:** Active<br>
**Owner:** Primary platform implementation agent<br>
**Platform:** `mastra`<br>
**Variants:** `baseline` and `workflow`

This is the next major platform implementation after the completed Restate and
LangGraph execution waves. It expands the existing Mastra direct-agent baseline and
adds one native Mastra workflow profile. It does not redesign the common server or
implement Mastra Studio.

## Start here

Read these before changing code:

- [`repository rules`](../../../../AGENTS.md)
- [`documentation guide`](../../../../docs/contributing/documentation.md)
- [`implementation-plan lifecycle`](../../../README.md)
- [`server ownership`](../../../../server/README.md)
- [`server architecture`](../../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../../server/src/platforms/README.md)
- [`runner interfaces`](../../../../server/src/control-plane/ports/README.md)
- [`server platform foundation`](../completed/server-platform-foundation.md)
- [`completed Mastra baseline`](../completed/mastra-baseline.md)
- [`completed Restate recovery plan`](../completed/restate-session-continuity-and-recovery.md)
- [`completed LangGraph recovery plan`](../completed/langgraph-agent-execution-and-recovery.md)
- [`shared context and compaction`](../completed/context-management.md)
- [`shared browser Chat surface`](../completed/browser-chat-surface.md)
- [`Mastra platform README`](../../../../server/src/platforms/mastra/README.md)
- [`Mastra execution semantics`](../../../../server/src/platforms/mastra/docs/semantics.md)
- [`first-party platform source audit`](../../../../docs/research/platform-plan-source-audit.md)

Existing Anesu, Studio, lockfile, and playground changes are unrelated work. Preserve
them and stage only files owned by this plan.

## First-party source verification

The following official sources were checked on `2026-09-20T11:34:37+02:00`. The exact
SDK and package versions must be rechecked from package metadata before dependency
changes are committed; the current local baseline is `@mastra/core@1.66.0` on
Node.js `>=22.13.0`.

- [Mastra agents](https://mastra.ai/docs/agents/overview) — `Agent.generate()` returns
  a completed response with steps, tool calls/results, and usage; `Agent.stream()`
  exposes incremental text and full event output. Agents registered on a `Mastra`
  instance receive shared services such as storage and logging.
- [Mastra tools](https://mastra.ai/docs/agents/tools) — tools use typed input/output
  schemas and an `execute` function with an abort signal. Tool results can have a
  smaller model-facing representation than the application-facing result.
- [Mastra streaming](https://mastra.ai/docs/guides/streaming) — agent and workflow
  streams expose typed lifecycle, step, tool, and result events that can be retained
  as native evidence.
- [Mastra workflows](https://mastra.ai/docs/workflows/overview) — workflows use
  `createStep`, `createWorkflow`, schemas, explicit composition, and support
  suspension, resumption, and streaming.
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots) —
  suspended workflow state includes step state, outputs, paths, retry information,
  and metadata, and is persisted through configured storage.
- [Mastra storage](https://mastra.ai/docs/storage) — storage owns domains including
  memory and workflows; file-backed LibSQL is the documented local path without a
  separate database server, while multi-process production should use a managed
  database.
- [Mastra tools and human approval](https://mastra.ai/docs/agents/tools) — tool
  approval, suspend, resume, and tool lifecycle events must be verified against the
  installed package before implementation because they are version-sensitive.
- [Mastra durable agents](https://mastra.ai/blog/introducing-durable-agents) —
  `createDurableAgent()` uses cache and pub/sub for resumable streams, while
  `createEventedAgent()` is intended for work that outlives the request. These are
  evaluated but are not automatically adopted for the no-Docker local profile.
- [Mastra OpenRouter gateway](https://mastra.ai/models/gateways/openrouter) — the
  selected model and secret boundary must follow the current gateway contract.
- [Mastra official release source](https://github.com/mastra-ai/mastra/releases) and
  [`@mastra/core` source](https://github.com/mastra-ai/mastra/tree/main/packages/core)
  — package versions, runtime requirements, and API changes.

### Source conclusions and unresolved checks

- The existing direct `Agent.generate()` path is a valid Mastra baseline, but it is
  not workflow durability, storage-backed memory, or crash recovery.
- The new local workflow profile will use Mastra's native workflow and storage APIs,
  with a file-backed LibSQL database. This avoids Docker while preserving the actual
  snapshot and resume boundary.
- The Lab-owned context snapshot remains the canonical comparable prompt projection.
  Mastra Memory is not silently enabled alongside it because two independent message
  histories would make context usage and compaction ambiguous.
- Mastra Memory, semantic recall, working memory, and observational memory are
  deferred until a separate memory ownership decision is made. This plan may add the
  storage boundary needed by workflows, but it must not claim that workflow storage
  is agent memory.
- `createDurableAgent()` and its cache/pub-sub requirements remain a documented
  alternative. They are out of scope unless the implementation proves that a local
  no-Docker cache and event boundary can be configured without weakening recovery
  semantics.
- Before implementation, verify the installed package exports, workflow run APIs,
  storage adapters, suspend/resume signatures, stream event types, and OpenRouter
  model configuration with a small compile-time probe. Record any version-driven
  adjustment in this plan before changing the architecture.

## Purpose

Make Mastra a serious, inspectable platform profile rather than only a direct
process-local `Agent.generate()` call. A contributor should be able to select Mastra
in the browser, run a real or deterministic model through a native agent, execute a
bounded tool loop, continue a session with the shared context meter, and run a native
Mastra workflow whose state can be inspected and resumed after a process restart.

The plan deliberately keeps two behaviours visible instead of collapsing them:

1. `mastra/baseline` remains the direct in-process agent comparison. It shows what
   Mastra's agent API does without claiming durable execution.
2. `mastra/workflow` uses Mastra's workflow engine and file-backed storage for a
   bounded multi-step workflow, including a deterministic suspend/resume path.

This gives the Lab a useful comparison between a direct agent call and Mastra-native
workflow state without pretending either profile is equivalent to Temporal or to a
distributed production deployment.

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | `mastra` |
| Existing variant | `baseline` |
| New variant | `workflow` |
| Language/runtime | TypeScript on Node.js `>=22.13.0`; use the repository's supported Node runtime after verification |
| Current core version | `@mastra/core@1.66.0`; revalidate before dependency changes |
| Direct execution | Registered Mastra `Agent`, `generate()` and `stream()` |
| Workflow execution | Registered Mastra `createWorkflow()`/`createStep()` run with native storage |
| Local storage | File-backed LibSQL, absolute path controlled by configuration |
| Comparable context | Lab-owned session snapshot and compaction service |
| Native workflow state | Mastra-owned workflow snapshots and step state |
| Native memory | Deferred; no duplicate Mastra Memory history in this plan |
| External model | OpenRouter through the existing real-model boundary when configured |
| Local infrastructure | Lab server and a local file; no Temporal, Restate, Docker, Redis, or Postgres required |
| Production claim | Local single-process storage profile only; managed multi-process storage is future work |

## Definition of done

From a clean checkout without Docker:

1. Start the Lab server and web application with the normal local stack command.
2. Open the Mastra platform Chat surface.
3. Select `Mastra baseline` or `Mastra workflow` and a real OpenRouter model, or use
   the deterministic fixture in automated tests.
4. Send two turns in one session and observe the shared context-window usage,
   model/tool events, and native Mastra details.
5. For the workflow variant, run the deterministic approval scenario, observe the
   workflow enter `suspended`, restart the server, inspect the retained native run,
   resume it with the approved input, and observe a terminal result.
6. Inspect the retained run directory after the server exits. It must contain safe
   normalized evidence and a versioned Mastra native summary.

```text
browser/API request
  -> common run admission and session/turn identity
  -> Mastra runner adapter
  -> registered Mastra Agent or native Workflow
  -> OpenRouter/fake model and bounded Lab tools
  -> direct response or LibSQL-backed workflow snapshot
  -> normalized Lab evidence + native/mastra.json
  -> Chat status, context meter, tool events, and workflow details
```

The completed implementation must be able to:

- [ ] accept `mastra/baseline` and `mastra/workflow` through the generic run request;
- [ ] reject an unknown Mastra variant honestly;
- [ ] execute a real registered Mastra Agent, not a fake HTTP response;
- [ ] stream or consume native agent/workflow events without duplicate projection;
- [ ] execute the shared calculator through Mastra's typed native tool boundary;
- [ ] continue two turns using one Lab session and show actual context usage;
- [ ] persist workflow step state and a suspend payload in the configured local store;
- [ ] resume the same workflow after a process restart without starting a duplicate run;
- [ ] distinguish direct process loss from workflow state that is recoverable from storage;
- [ ] map provider failures, cancellation, timeout, duplicate admission, and unknown
      post-dispatch outcomes without fabricating success;
- [ ] write normalized `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
      `result.json`, and safe `native/mastra.json` evidence;
- [ ] show baseline/workflow status, context usage, tool activity, suspension, resume,
      failure, and unavailable-storage states in the browser;
- [ ] document exact local commands, version assumptions, limitations, and validation.

## Scope

### Existing `baseline` conformance

- Complete the direct agent boundary around a registered Mastra instance.
- Consume the shared context snapshot and compaction metadata without creating a
  second transcript source.
- Use `Agent.stream()` where it gives useful native lifecycle evidence; keep the
  generic browser projection stable and do not require browser SSE for this wave.
- Keep the shared deny-by-default calculator tool and bounded tool rounds/calls.
- Preserve the real OpenRouter path and the deterministic provider fixtures.
- Retain the current honest process-local recovery semantics.

### New `workflow` variant

- Add a platform-owned workflow definition with typed input/output schemas.
- Include a model step and a bounded tool step using the same safe tool registry.
- Include one deterministic approval/suspension path that can be resumed with
  explicit input. Do not make every normal prompt suspend.
- Configure native workflow storage through an absolute file-backed LibSQL path.
- Persist native run identity, snapshot status, step status, suspend metadata, and
  resume outcome in safe native evidence.
- Add a Mastra runner adapter that starts, inspects, cancels, and resumes workflow
  executions while preserving the generic runner boundary.
- Define how a suspended workflow is represented through the current run model. If a
  real resume operation cannot fit the existing seam, add the smallest optional
  platform capability with tests for all existing runners; do not overload `cancel`
  or silently create a new run.

### Shared server and browser integration

- Register `mastra/workflow` with an honest runnable status only after its local
  storage path and tests pass.
- Extend server manifests only where the platform-specific configuration requires it;
  keep common fields provider-neutral.
- Add variant selection to the existing platform UI without introducing a Mastra-only
  page that duplicates the Chat surface.
- Show suspension/resume controls only when the inspected native state supports them.
- Keep native details behind progressive disclosure; do not add a large documentation
  panel to the main Chat layout.

### Documentation and learning material

- Update the Mastra README and semantics guide with both variants and their limits.
- Add a local-development guide for the file-backed storage path and restart test.
- Add a focused `development/playground/mastra-agent-workflows/` walkthrough showing
  one direct turn, one tool turn, one suspended workflow, and one resumed workflow.
- Update the platform index, architecture ownership documentation if boundaries change,
  and this plan's validation record.

## Explicitly out of scope

- Mastra Studio as a required UI or runtime dependency.
- `createDurableAgent()` with Redis/Upstash cache and pub/sub.
- Mastra Temporal integration; Temporal remains its own platform profile.
- Mastra Memory, semantic recall, working memory, observational memory, vector stores,
  or automatic memory consolidation.
- MCP servers, OAuth, social connectors, channels, plugins, skills, browser access,
  filesystem/computer environments, or external side effects.
- Multi-agent networks, subagents, voice, evals, scheduled workflows, and time travel.
- Postgres, Redis, Kubernetes, autoscaling, multi-process file storage, or Docker as
  required local infrastructure.
- Exactly-once provider calls or exactly-once external tool effects.
- Changes to Restate, Temporal, LangGraph, Anesu, Studio, or the generic contract
  without a concrete Mastra incompatibility and an explicit boundary review.

## Architecture and ownership

### Boundary map

```text
server/src/control-plane/
  common request admission, manifests, lifecycle, context, evidence, and API projection

server/src/platforms/mastra/
  Mastra instance, baseline agent, workflow definition, storage configuration,
  native event mapping, recovery, runner adapters, and platform docs

server/src/platforms/mastra/variants/baseline/
  direct Agent, model boundary, typed tools, and process-local lifecycle

server/src/platforms/mastra/variants/workflow/
  createStep/createWorkflow definitions, workflow input/output, suspend/resume,
  native workflow lifecycle, and storage-aware configuration

apps/web/src/features/platforms/
  shared Chat, variant configuration, context meter, status, and native detail projection

lab/runs/<run-id>/
  config.json, events.jsonl, trajectory.json, metrics.json, result.json,
  native/mastra.json, logs/, and artifacts/

lab/platforms/mastra/
  local LibSQL file or configured path; never committed to source control
```

Ownership rules:

- Mastra SDK types, workflow objects, storage adapters, and native event payloads stay
  inside `server/src/platforms/mastra/`.
- The Mastra adapter owns the platform-to-common translation. Common server modules
  do not import Mastra types.
- The Lab context service remains the source of truth for comparable session turns,
  compaction revisions, context-window projection, and turn admission.
- Mastra workflow storage owns only native workflow state and snapshots. It is not the
  Lab evidence store and not a substitute for the shared context service.
- The common evidence store remains the sole writer of normalized run evidence.
- The browser calls the Lab server only; it never calls Mastra storage or the Mastra
  runtime directly.
- Prompts, provider headers, secrets, raw responses, arbitrary workflow state, and
  unsanitized suspend payloads must not cross the safe native evidence boundary.

### Files allowed to change

| Workstream | Owned paths | Must not change without boundary review |
| --- | --- | --- |
| Mastra runtime | `server/src/platforms/mastra/**` | other platforms and common contracts |
| Platform registration | `server/src/control-plane/bootstrap/`, platform registry, manifests | unrelated runner behaviour |
| Server tests | `server/tests/platforms/mastra/**`, `server/integration-tests/mastra-*.test.ts` | production code from tests |
| Local operation | `scripts/run_local_stack.sh`, `scripts/README.md` only when required | Docker startup and unrelated launch semantics |
| Browser acceptance | `apps/web/src/features/platforms/**`, `apps/web/tests/browser/**` only where required | Anesu, Studio, and unrelated platform UI |
| Documentation | `server/src/platforms/mastra/docs/**`, `server/src/platforms/mastra/README.md`, `development/playground/mastra-agent-workflows/**`, this plan, platform index/nav | runtime code |

If a shared file must change, record the reason, alternatives, compatibility impact,
and the validation for unaffected platforms before editing it.

## Local dependencies and configuration

### Required local services

| Dependency | Required for | Start command | Readiness | Unavailable behaviour |
| --- | --- | --- | --- | --- |
| Lab server | all profiles | `./scripts/run_local_stack.sh server` or normal stack | `GET /health` and selected platform health | UI shows Mastra unavailable; no fabricated run |
| File-backed LibSQL | `mastra/workflow` | opened by the Mastra runtime | schema/store initialization and a write/read probe | workflow profile is unavailable with actionable error |
| OpenRouter | real-model runs only | configured by `OPENROUTER_API_KEY` | provider configuration check; no paid probe | real run is rejected before dispatch when key is absent |

No Temporal, Restate, Docker, Redis, or Postgres process is required for this plan.

Configuration rules:

- `AGENTLAB_MASTRA_STORAGE_PATH` selects an absolute local LibSQL file and defaults
  under an ignored `lab/platforms/mastra/` directory.
- Relative storage paths are rejected or resolved once at startup and recorded as an
  absolute redacted-safe path label, never as a machine-specific full path in evidence.
- `AGENTLAB_MASTRA_WORKFLOW_ENABLED` controls whether the workflow variant is
  registered; disabled means the UI reports it as unavailable, not completed.
- The model manifest contains only provider/model identifiers and context-window
  metadata. `OPENROUTER_API_KEY` is read by the runtime process and never enters
  manifests, native references, logs, or evidence.
- Workflow input, output, state, and suspend metadata have bounded serialized sizes.
- Tool names, tool arguments, step IDs, and variant IDs are allowlisted before use.
- Native storage files are ignored, scoped to the platform, and never staged.

## Runner contract and optional resume seam

The existing `PlatformRunner` supports validate, check, start, inspect, cancel, and
close. The baseline uses that seam unchanged.

The workflow variant needs a real resume operation. The implementation must choose one
of these paths at the design checkpoint, then record the reason:

1. Add an optional `resume` capability to the runner port and a generic
   `POST /api/runs/:runId/resume` route. Existing runners remain unchanged and return
   a clear unsupported response.
2. If the current API already has a safe platform capability mechanism, use that seam
   without adding a second route.

It must not resume by calling `start()` again, reuse `cancel()`, or submit a second
   Lab run with a different run ID. A resume request must identify the existing Lab run,
   native workflow run, suspended step, and canonical resume payload.

### Operations

| Operation | Owner | Inputs | Output | Failure/unknown behaviour |
| --- | --- | --- | --- | --- |
| Validate | Mastra config | manifest and selected variant | valid/reason | reject unsupported variant, model, storage, or limits |
| Check availability | Mastra runner | runtime/config | readiness | report missing storage/key without fake success |
| Start baseline | baseline runner | manifest | `mastra:<runId>` | pre-dispatch failure or post-dispatch unknown |
| Start workflow | workflow runner | manifest | native workflow reference | lost acknowledgement reconciles by deterministic native identity |
| Inspect | runner | opaque reference | status, events, result, native state | stale or unknown projection is explicit |
| Cancel | runner/native workflow | reference and reason | accepted/already terminal | cancellation race remains observable |
| Resume | workflow runner | reference, step, bounded input | same native run reference | duplicate resume is idempotent; invalid/stale input fails |

### Execution references

Baseline native reference:

```json
{
  "platform": "mastra",
  "variant": "baseline",
  "executionId": "mastra:<lab-run-id>",
  "native": {
    "operation": "agent.generate",
    "mastraVersion": "1.66.0",
    "processScoped": true,
    "storageMode": "lab-context-only"
  }
}
```

Workflow native reference:

```json
{
  "platform": "mastra",
  "variant": "workflow",
  "executionId": "mastra-workflow:<lab-run-id>",
  "native": {
    "workflowId": "agentlab-mastra-baseline",
    "nativeRunId": "<mastra-run-id>",
    "stepId": "<safe-step-id>",
    "nativeStatus": "running|suspended|completed|failed|cancelled",
    "storageMode": "file-libsql",
    "storageSchemaVersion": 1,
    "submissionOutcome": "confirmed|unknown",
    "resumeSupported": true
  }
}
```

Rules:

- `nativeRunId` is not the Lab `runId`; both are retained and never conflated.
- The workflow identity is deterministic enough to reconcile a lost start response,
  but a visible checkpoint alone does not prove provider completion.
- Native references contain IDs, statuses, timestamps, bounded counts, and versions;
  they exclude secrets, prompts, headers, raw model responses, and unrestricted state.
- If a process-local baseline disappears, the result is reconciliation-required.
- If a workflow snapshot and native run status are recoverable from the same storage,
  the replacement runner may inspect and resume only after identity and input checks.

## Execution, durability, and state semantics

### Baseline lifecycle

```text
admitted → queued → running → model/tool events → completed|failed|cancelled|unknown
```

- Lab admission owns the run ID, session ID, turn ID, client turn ID, and immutable
  manifest.
- Mastra owns the direct Agent call and tool/model lifecycle within the process.
- The context service persists the turn and snapshot before model dispatch.
- The evidence store writes normalized events and terminal records after inspection.
- A provider request sent before a timeout or lost acknowledgement is never silently
  retried; its outcome is `reconciliation_required` or `outcome_unknown`.

### Workflow lifecycle

```text
admitted → native-started → step-running →
  completed|failed|cancelled|suspended →
  resume-requested → step-running → completed|failed|cancelled|unknown
```

- Mastra storage persists workflow snapshots at the native workflow boundary.
- The Lab evidence store persists the normalized projection separately.
- `suspended` remains a native workflow status and is not mislabeled as completed.
  If the generic run model cannot expose it directly, the run remains `running` with
  explicit `nativeStatus: suspended` and a resume capability.
- A duplicate start with the same Lab run ID and canonical manifest returns the same
  native reference. A different manifest for the same ID is a conflict.
- A duplicate resume for an already resumed/terminal run returns the existing native
  status and does not start another workflow execution.
- Resume payloads are schema-validated, bounded, and recorded as safe metadata only.
- A process replacement must reopen the same storage path and inspect the existing
  native run before deciding whether it is resumable, terminal, or unknown.
- An orphaned or mismatched native run is retained for diagnosis and never adopted.
- Native event ordering comes from Mastra stream/workflow sequence where available;
  the adapter assigns a monotonic source sequence for events without one.
- The common evidence store remains the deduplicating projection boundary.

### Retry, cancellation, and side effects

- Baseline model retries remain disabled unless the provider boundary proves a
  pre-dispatch retry. Post-dispatch ambiguity is not retried automatically.
- Workflow step retries are bounded and recorded with step ID, attempt, and reason.
  A step with an external side effect must be idempotent or remain out of scope.
- Cancellation is cooperative. A cancellation request accepted by Mastra is not the
  same as a terminal cancelled result until inspection confirms it.
- Cancellation racing with a model or tool call records the observed winner. It never
  claims that an already-dispatched provider call was undone.
- A timeout before provider dispatch can be failed safely; a timeout after dispatch is
  unknown unless Mastra/provider evidence proves otherwise.
- Workflow restart recovery is limited to persisted native state. It is not an
  exactly-once guarantee for an in-flight model or external operation.

## Native evidence and normalized records

The common server owns normalized records. Mastra owns a safe native summary at:

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  context.json
  result.json
  logs/operations.jsonl
  native/mastra.json
```

Native evidence schema `mastra.native.v2` must include:

- platform/variant and Mastra/core package version;
- operation (`agent.generate`, `agent.stream`, or `workflow.run`);
- Lab run/session/turn identity references;
- native workflow/run/step IDs when present;
- storage mode and schema version;
- observed native status, event count, step count, tool count, attempt count, and
  suspension/resume metadata;
- provider/model identifiers without credentials;
- submission outcome, reconciliation status, and observed timestamps;
- a bounded list of safe native event summaries.

Evidence rules:

- The adapter returns evidence intents; it does not write `lab/runs/` directly.
- Writes are atomic, path-scoped, and safe against traversal and duplicate terminal
  results.
- `result.json` is written once per Lab run after a confirmed terminal result. A
  suspended workflow does not overwrite the result with a fake terminal record.
- Multi-turn sessions have one run directory per turn and one shared context session;
  no turn overwrites another turn's result.
- Native event payloads are redacted before persistence. Prompts, full outputs, raw
  provider responses, auth headers, API keys, and unrestricted workflow state are not
  retained in native evidence.
- Framework-specific details needed for diagnosis stay in bounded native summaries;
  normalized events retain only comparable lifecycle meaning.

## Implementation checklist

### 1. Contract and source checkpoint

- [ ] Recheck the official Mastra docs, package exports, package versions, and Node
      engine against the installed dependency before changing runtime code.
- [ ] Add a compile-time/API probe for `Agent.stream`, workflow creation/run,
      LibSQL storage, suspend/resume, and native event types.
- [ ] Confirm whether an optional generic resume capability is required and record the
      compatibility impact on Temporal, Restate, LangGraph, and the other runners.
- [ ] Confirm the exact Lab-to-Mastra identity mapping and duplicate admission rules.
- [ ] Confirm the Lab context snapshot remains canonical and document why Mastra
      Memory is not enabled in this wave.
- [ ] Commit the stable contract/configuration checkpoint before parallel work begins.

### 2. Baseline agent completion

- [ ] Register the agent through a Mastra instance so shared runtime services are
      available without leaking Mastra objects into common code.
- [ ] Preserve the real OpenRouter model selection and secret boundary.
- [ ] Use `generate()`/`stream()` deliberately and map native step/tool/usage events.
- [ ] Validate model output, usage, finish reason, tool calls, and empty/aborted output.
- [ ] Preserve shared context snapshots, compaction revisions, and context meter data.
- [ ] Exercise a two-turn conversation with the same session and separate run IDs.
- [ ] Keep process replacement honest: completed evidence survives, in-flight direct
      work is not adopted.

### 3. Native workflow variant

- [ ] Add `variants/workflow/` with typed `createStep` and `createWorkflow` definitions.
- [ ] Add a bounded model step using the selected provider and shared tool registry.
- [ ] Add a deterministic approval/suspend step with a bounded resume schema.
- [ ] Configure `Mastra` with an absolute file-backed `LibSQLStore` path.
- [ ] Add startup schema/readiness and storage corruption/unavailable diagnostics.
- [ ] Implement start, inspect, cancel, and resume through a platform-owned adapter.
- [ ] Reconcile native run IDs and snapshots after a server process replacement.
- [ ] Reject mismatched, stale, duplicate, oversized, or malformed resume requests.
- [ ] Register `mastra/workflow` only after offline and local integration checks pass.

### 4. Shared server and UI

- [ ] Add workflow variant metadata to server registration and the platform catalog.
- [ ] Keep baseline and workflow configuration visibly distinct but compact.
- [ ] Add a workflow status projection for suspended, resumable, resumed, and unknown.
- [ ] Add a custom application dialog/form for resume input; never use browser prompts.
- [ ] Show context-window usage, model, tool activity, and native workflow details in
      progressive disclosure without adding verbose explanatory cards.
- [ ] Verify Compare runs use independent run IDs and do not share workflow state.
- [ ] Verify unavailable storage and missing OpenRouter configuration are honest in UI.

### 5. Evidence and operations

- [ ] Implement and version `mastra.native.v2` evidence validation/redaction.
- [ ] Preserve native event summaries and normalized event ordering across inspection.
- [ ] Record safe structured operation logs, retry counts, status, and durations.
- [ ] Add storage retention and cleanup guidance for local workflow state and Lab runs.
- [ ] Add a rollback switch that disables `mastra/workflow` without removing existing
      evidence or breaking `mastra/baseline`.

### 6. Documentation and playground

- [ ] Update `server/src/platforms/mastra/README.md` with the two-variant architecture.
- [ ] Update `docs/semantics.md` with identity, storage, retry, cancellation, resume,
      and unknown-outcome rules.
- [ ] Update `docs/local-development.md` with no-Docker commands and storage paths.
- [ ] Add `development/playground/mastra-agent-workflows/README.md` and runnable
      inspection steps.
- [ ] Update platform indexes and documentation navigation.
- [ ] Record release decisions, validation results, manual acceptance, and known
      limitations in this plan before archiving it.

## Test coverage

### Unit tests

- [ ] package/version/runtime probe and feature availability
- [ ] baseline/workflow variant identity and registration
- [ ] configuration validation, absolute storage path, limits, and redaction
- [ ] model factory and OpenRouter request boundary
- [ ] native agent stream/event mapping and usage normalization
- [ ] typed tool input/output, abort signal, tool failure, timeout, and call limits
- [ ] workflow step schemas, transitions, state, suspend payload, and resume payload
- [ ] deterministic native IDs and duplicate start/resume semantics
- [ ] cancellation, timeout, provider failure, pre-dispatch retry, and post-dispatch unknown outcome
- [ ] native evidence schema, safe paths, atomic writes, and terminal-result cardinality
- [ ] event ordering, duplicate events, stale inspection, and bounded native state

### Integration tests

- [ ] generic server API accepts `mastra/baseline` and `mastra/workflow`
- [ ] unknown variants and unavailable storage are rejected clearly
- [ ] real local Mastra baseline completes with deterministic model and calculator tool
- [ ] real local workflow completes through native `createWorkflow` execution
- [ ] workflow suspends, persists a snapshot, and exposes resumable native state
- [ ] workflow resumes from the same native run after a fresh runner process opens the
      same LibSQL file
- [ ] duplicate start and duplicate resume do not create a second native execution
- [ ] cancellation during baseline generation and workflow execution is honest
- [ ] server replacement produces completion, resumable state, or reconciliation-required
      according to observed native storage—not according to a fabricated assumption
- [ ] normalized and native evidence survive after the runtime exits
- [ ] Compare runs remain independent

### Browser acceptance

- [ ] Mastra baseline Chat sends two turns with a real selected model and shows context usage.
- [ ] Mastra workflow Chat selects the workflow variant and displays native step/tool events.
- [ ] Deterministic approval flow shows a compact resume action and returns to the same run.
- [ ] Failed, cancelled, unavailable, and unknown states render without duplicate messages,
      blinking polling, or fake assistant output.
- [ ] Model picker search displays the full selected model name and does not expose secrets.
- [ ] Desktop, tablet, and mobile layouts remain usable without document overflow.
- [ ] Browser console has no React key, hydration, fetch-loop, or route errors.

### Manual acceptance

- [ ] Start the normal local stack without Docker.
- [ ] Run one real OpenRouter baseline turn and inspect usage/evidence.
- [ ] Run a second baseline turn in the same Chat session and verify context continuity.
- [ ] Run the deterministic workflow approval scenario and inspect the native snapshot.
- [ ] Stop/restart the server, reload the browser, inspect the same workflow, and resume it.
- [ ] Inspect every retained evidence file and confirm credentials and raw provider
      headers are absent.
- [ ] Stop or misconfigure the storage path and confirm the UI reports unavailable
      workflow infrastructure without claiming completion.

## Required validation commands

```bash
# Platform unit and adapter tests
pnpm --filter @agent-harness-lab/lab-server exec tsx --test \
  tests/platforms/mastra/mastra-runner.test.ts \
  tests/platforms/mastra/mastra-workflow.test.ts

# Mastra local integration
pnpm --filter @agent-harness-lab/lab-server exec tsx --test \
  integration-tests/mastra-baseline.test.ts \
  integration-tests/mastra-workflow.test.ts

# Shared server checks
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server test

# Web checks
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
node --test apps/web/tests/browser/platform-chat.browser.test.mjs

# Local process and documentation checks
bash -n scripts/run_local_stack.sh
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

Optional real-model and destructive process-replacement checks must be explicitly
enabled and must record the model, timestamp, run IDs, and cleanup result. They must
never be required for the deterministic offline suite.

## Documentation and release impact

The repository guide references `docs/internal/operations/release-process.md`, but that
file is absent in this checkout. Record that absence as a limitation rather than
inventing a release policy.

### Documentation checklist

- [ ] Mastra README and local guides match the commands, package versions, storage path,
      variant names, and failure behaviour.
- [ ] Architecture/ownership documentation is updated if the optional resume seam or
      storage boundary changes common server responsibilities.
- [ ] UI/API documentation names only capabilities actually registered as runnable.
- [ ] Official upstream links and access timestamps are retained in the platform docs.
- [ ] Playground instructions are separate from tests, scenarios, experiments, and
      published product docs.

### Release record

- Analytics: `not applicable` — this platform wave adds no product analytics.
- Structured logging: required for safe lifecycle operations, native status, retry
  count, storage mode, and reconciliation outcome; prompts, outputs, headers, and
  secrets are excluded.
- Metrics/telemetry: retain observed model usage, step/tool counts, durations, and
  workflow status; do not synthesize cost or latency when the provider does not report it.
- Version/release identity: pin and record Mastra packages, Node runtime, native
  evidence schema, and workflow storage schema.
- Migration/compatibility: additive native evidence; existing baseline evidence remains
  readable; workflow storage migration must be versioned before schema changes.
- Rollout: local-only, feature-gated `mastra/workflow` registration first; baseline
  remains independently runnable.
- Rollback: disable workflow registration and preserve existing run/evidence files;
  do not delete storage automatically.
- Security: review storage permissions, resume payload validation, tool allowlists,
  secret redaction, and path traversal before completion.
- Known limitations: file-backed LibSQL is a single-process local profile; no exactly-once
  provider or external side-effect guarantee; Mastra Memory and durable-agent cache are
  deliberately deferred.

## Commit boundaries

Use focused commits. Do not combine the entire Mastra wave into one commit:

1. **Mastra contract and package/runtime checkpoint**
   - variant IDs, config, package/API probe, optional resume seam if required
   - validation: package probe, typecheck, focused contract tests
2. **Baseline agent conformance**
   - registered Agent, streaming/tool event mapping, shared context, real model path
   - validation: baseline unit/integration tests and server typecheck
3. **Native workflow and LibSQL storage**
   - workflow definition, storage, suspend/resume, native lifecycle adapter
   - validation: workflow unit tests and local integration tests
4. **Recovery, evidence, and shared server integration**
   - replacement inspection, reconciliation, native evidence v2, operation logs
   - validation: restart/recovery tests, full server tests, diff check
5. **Browser acceptance and documentation**
   - UI variant/resume flow, playground, platform docs, navigation, release record
   - validation: browser suite, web typecheck/build, docs generation, manual acceptance

Before each commit:

- [ ] inspect `git status` and preserve unrelated Anesu/Studio changes;
- [ ] inspect the exact staged diff and exclude secrets, local databases, generated state,
      screenshots, and temporary logs;
- [ ] run the narrow validation for the section;
- [ ] update the plan when the contract or scope changes;
- [ ] record the commit hash in the eventual completion record.

## Parallel-agent handoffs

Parallel work may begin only after the contract checkpoint and first implementation
commit are stable. The primary agent owns shared server changes, integration, conflict
resolution, final review, and release decisions.

| Workstream | Agent-owned paths | Must not change | Handoff |
| --- | --- | --- | --- |
| Baseline conformance | `server/src/platforms/mastra/variants/baseline/**`, baseline tests | workflow variant, common contracts | event mapping, tests, limitations |
| Workflow/storage | `server/src/platforms/mastra/variants/workflow/**`, workflow tests | baseline runtime, UI | storage path, native IDs, recovery semantics |
| Adapter/recovery | `server/src/platforms/mastra/runner-adapter/**`, platform registration tests | other platforms | runner operations, reconciliation, evidence |
| Browser acceptance | `apps/web/src/features/platforms/**`, Mastra browser tests | server contract and Anesu/Studio UI | UI flow, screenshots/manual results, errors |
| Docs/playground | Mastra docs and `development/playground/mastra-agent-workflows/**` | runtime code | commands, links, known gaps |

Handoffs must include exact files, tests and results, assumptions, unresolved issues,
evidence impact, and known limitations. No workstream may add another platform under
this plan.

## Completion gate

Before moving this plan to `completed/`:

- [ ] Both Mastra variants are honestly registered and their unavailable states are real.
- [ ] Baseline and workflow flows work from the documented no-Docker local setup.
- [ ] Two-turn context continuity and context-window usage are visible in Chat.
- [ ] Native workflow storage, suspension, resume, cancellation, restart, and duplicate
      semantics are tested and documented.
- [ ] Normalized and native evidence are inspectable, versioned, bounded, and redacted.
- [ ] Provider ambiguity is never hidden behind fake success or blind retry.
- [ ] UI/API controls expose only implemented capabilities.
- [ ] Documentation, playground, release decisions, validation results, and limitations
      are current.
- [ ] Each coherent implementation section has a focused commit.
- [ ] No applicable checklist item remains unchecked.

## Completion record

Complete only when the plan is archived.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`<br>
**Commits:** `[commit hashes]`

### Validation

- `[command]` — `[result]`
- `[manual acceptance]` — `[result]`

### Known limitations

- `[limitation]`
