# Restate baseline — end-to-end platform completion

**Created:** 2026-09-19T20:38:46+02:00
**Last updated:** 2026-09-19T23:25:00+02:00
**Status:** Active
**Owner:** Primary platform implementation agent
**Platform:** `restate`
**Variant:** `baseline`

This is one major implementation goal, not another short vertical slice. The sections
below divide the work into reviewable implementation blocks and focused commits, but
the plan remains active until the complete Restate baseline is runnable, observable,
recoverable, documented, and accepted through the browser and native integration
checks. Do not move to another platform because one block is finished.

## Start here

Read these before changing code:

- [Repository working rules](../../../../AGENTS.md)
- [Documentation rules](../../../../docs/contributing/documentation.md)
- [Platform plan index](../README.md)
- [Restate platform implementation](../../../../server/src/platforms/restate/README.md)
- [Restate baseline plan](../completed/restate-baseline.md)
- [Shared server foundation](../completed/server-platform-foundation.md)
- [Shared context and compaction plan](../completed/context-management.md)
- [Durable tool-loop plan](../completed/tool-enabled-turn-loop.md)
- [Browser Chat surface plan](../completed/browser-chat-surface.md)
- [Cross-platform conformance plan](../completed/platform-agent-conformance.md)
- [Platform source audit](../../../../docs/research/platform-plan-source-audit.md)
- [Restate source and repository audit](../../../../docs/research/restate-baseline-source-audit.md)

Official Restate references to re-check before implementation:

- [TypeScript services](https://docs.restate.dev/develop/ts/services)
- [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Error handling](https://docs.restate.dev/guides/error-handling)
- [TypeScript SDK clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)
- [Service introspection](https://docs.restate.dev/services/introspection)
- [Server configuration](https://docs.restate.dev/references/server-config)
- [Local installation](https://docs.restate.dev/installation)

This plan preserves the following existing decisions:

- The common `PlatformRunner` contract remains the server boundary. Restate SDK types,
  invocation statuses, journal details, and deployment details stay under
  `server/src/platforms/restate/`.
- The common `ContextSessionStore` remains the canonical Lab session and transcript
  record. Restate owns durable execution of a turn; it does not become a second,
  competing transcript database in this slice.
- The common `RunEvidenceStore` remains the only writer of normalized Lab evidence.
  The Restate service must never write `lab/runs/` directly.
- The native Restate server path is the required local path. Docker may remain an
  optional profile, but Docker is not a prerequisite for implementation or acceptance.
- OpenRouter is the production model path. Fake models are permitted only as explicit,
  deterministic test and failure-injection fixtures. They must not be the default
  runtime path or appear as a successful real-model result.
- Anesu, Studio, computer-native execution, memory, MCP, OAuth, plugins, social
  connectors, and other platform implementations are outside this plan.

## Research basis and important design decision

The current Restate TypeScript documentation requires Node.js 22 or newer. Restate
services expose workflows, virtual objects, and basic services. Workflows run once per
workflow key, while additional workflow handlers have different interaction semantics.
Restate records an execution log and replays non-deterministic work only when it is
inside a durable `ctx.run` step. Restate retries errors by default, cancellation is
observed asynchronously, and the introspection API exposes invocation status, retry
count, journal records, service deployment state, and persisted service state.

The current repository baseline is pinned around Restate server `1.7.10` and the
TypeScript SDK `1.17.0`; the implementing agent must verify that pair against the
current official compatibility guidance before changing either pin.

This plan deliberately does **not** introduce a Restate Virtual Object session model.
The current Lab runner is run-oriented: `start`, `inspect`, and `cancel` operate on one
run and one retained execution reference. For this slice:

```text
one chat turn
  -> one Lab run
  -> one Restate Workflow keyed by agentlab:<runId>
  -> one shared ContextSessionStore turn in the session transcript
```

Multiple turns continue through the same `sessionId`, with a new `runId` and a stable
`clientTurnId` for each turn. This lets the Lab compare Restate with the other platform
adapters without forcing a platform-specific long-lived session API into the common
runner. A future Restate-native Virtual Object experiment may be valuable, but it is a
separate plan with a separate question about keyed concurrency and workflow interaction.

## Purpose

Finish the Restate baseline as a complete platform implementation in the Lab. A contributor
should be able to start the native local runtime without Docker, select a real OpenRouter
model in the browser, run a tool-capable multi-turn conversation, inspect context pressure
and evidence, cancel work, and recover honestly after duplicate requests, service failure,
Lab-server replacement, or Restate restart.

This plan answers the larger platform question:

> Can the Lab present a Restate-backed agent as a real, inspectable platform—model and tool
> execution, context management, durable lifecycle, recovery, evidence, and browser UX—
> without confusing Restate durability with exactly-once external provider execution?

The existing session-continuity slice is the foundation already in the repository. It is not
the completion target. The completion target is the full path below:

```text
native Restate runtime
  -> registered TypeScript service
  -> Lab runner and run admission
  -> durable model/tool turn
  -> context preparation, compaction, and settlement
  -> normalized events, trajectory, metrics, result, and native reference
  -> browser chat, context meter, run details, retry/cancel/recovery states
```

## Definition of done

From a clean checkout with the native Restate server available, a contributor can run the
server, the Restate service, and the web app using the no-Docker local path, open the Restate
Chat page, and:

1. Start a new chat with a selected OpenRouter model and a valid session configuration.
2. Send a first prompt and see the actual model response, run status, tool events when
   enabled, token usage, and cost metadata when the provider returns it.
3. Send additional prompts in the same chat and see the settled transcript, context
   window, pressure state, and compaction behaviour evolve.
4. Execute deterministic tool calls through the same durable lifecycle and inspect the
   paired tool-call/tool-result events in the browser and evidence.
5. Exercise retryable failures, cancellation, provider timeout-after-dispatch, and
   malformed responses without claiming a stronger outcome than the implementation knows.
6. Refresh or replace the Lab server while a turn is running, then reconcile the existing
   run from its retained Restate execution reference.
7. Replace the Restate service and restart the native Restate server with its persistent
   data directory, then observe replay, completion, or an explicit recovery-required
   state.
8. Retry the same browser request with the same `clientTurnId` and receive the existing
   turn instead of creating a second context message, run, or visible assistant result.
9. Start a new chat before changing a session-pinned model or execution configuration.
10. Inspect the resulting evidence and confirm that provider credentials, hidden prompts,
    and unbounded native payloads are absent.

The plan is complete only when these behaviours are covered by meaningful tests and the
documentation explains the local commands, platform boundaries, failure semantics, and
known local-only limitations.

## End-to-end implementation blocks

All blocks are part of this one Restate completion goal. Finish them in order unless a
dependency makes a small reordering necessary. A block is not complete when its happy path
works; its exit criteria include failure behaviour, evidence, tests, and documentation
updates relevant to that block.

### Block A — runtime, contracts, and local operations

- Pin and verify the Node, Restate TypeScript SDK, native Restate server, and service
  versions as a compatible local profile.
- Make the no-Docker launcher start and stop the Lab server, worker/service, web app, and
  native Restate dependency with deterministic ports, temporary data directories, readiness
  checks, and cleanup. Docker remains optional.
- Finalize manifest, native-reference, session, turn, and configuration-conflict schemas.
- Define migration behaviour for existing baseline references and preserve unrelated
  platform runners.
- Exit criteria: a clean local startup and shutdown works twice in a row; unavailable
  Restate produces a useful readiness error; all identity and configuration tests pass.

### Block B — real durable agent execution

- Complete the Restate workflow around the real OpenRouter model path, with fake models only
  behind explicit deterministic test/failure fixtures.
- Put model calls, tool calls, and other non-deterministic work behind named durable steps.
- Preserve model selection, request metadata, tool-call pairing, cancellation signals, and
  normalized event ordering through replay and repeated inspection.
- Bound provider retries and classify pre-dispatch failure, response failure, timeout after
  dispatch, abort, malformed response, and terminal provider errors.
- Exit criteria: a real browser turn and deterministic tool turn complete through Restate;
  workflow tests prove replay does not repeat a completed journaled step; provider outcome
  classifications are visible in evidence.

### Block C — context window, compaction, and multi-turn continuity

- Use the shared ContextService as the only context admission and settlement boundary.
- Carry the selected model's context-window metadata through preparation, compaction,
  workflow input, evidence, and the browser context panel.
- Implement a bounded provider-overflow recovery path: prepare/compact once, retry the
  model operation only when the outcome is known to be safe, and emit explicit recovery
  evidence. Never silently retry an ambiguous billable request.
- Verify transcript ordering, context projection, compaction count, remaining percentage,
  and unknown token states across normal turns, duplicate admission, replay, and restart.
- Exit criteria: a deterministic pressure fixture reaches compaction without corrupting the
  transcript; browser and server tests show the same context state; recovery is bounded.

### Block D — lifecycle, recovery, and idempotency

- Reconcile by retained invocation ID first and workflow key second through the Restate
  adapter; keep native status and Lab status distinct.
- Cover accepted, already-accepted, ambiguous submission, backing-off, suspended,
  completed, cancelled, failed, killed, missing, and unavailable observations.
- Test process replacement at each important window: before submission acknowledgement,
  after Restate acceptance, during a durable step, after provider dispatch, before result
  projection, and after terminal projection.
- Make duplicate HTTP admission, duplicate Restate submission, duplicate event projection,
  repeated settlement, and repeated polling safe and inspectable.
- Exit criteria: service replacement, Lab-server replacement, and Restate restart each have
  deterministic tests using isolated native data; unresolved provider outcomes become
  `reconciliation_required` rather than fabricated success.

### Block E — evidence and observability

- Ensure the common server remains the only writer of `lab/runs/`.
- Produce and validate `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
  `result.json`, `logs/`, and `artifacts/` where applicable, plus a safe Restate-native
  reference and context record.
- Record native workflow key, invocation ID, status, retry count, journal/replay facts,
  request and turn IDs, timings, usage/cost, tool events, compaction, cancellation, and
  recovery classification without secrets.
- Make terminal writes idempotent and define the ordering for event, trajectory, metric,
  result, and context settlement writes. Exercise crash windows around each write.
- Exit criteria: evidence can explain a normal run and a recovered/unknown run without
  reading private logs; duplicate projection does not alter the final record.

### Block F — browser product surface

- Finish Restate Chat as the single end-to-end inspection surface: new chat, prompt, model
  picker, run status, tool events, context meter, compacting state, run details, cancel,
  retry, and recovery-required actions.
- Keep platform-specific native details progressively disclosed and keep copy concise.
- Prevent duplicate messages, duplicate keys, polling loops, blinking controls, stale
  status overwrites, and route/health errors after terminal completion or refresh.
- Verify real model execution and all recovery states at desktop, tablet, and narrow widths.
- Exit criteria: browser acceptance covers normal two-turn use, refresh, duplicate POST,
  cancellation, context pressure, server replacement, and explicit provider ambiguity.

### Block G — documentation, validation, and handoff

- Update the Restate README, architecture, local-development, and semantics docs together
  with the implementation; add a concise playground walkthrough only for hands-on learning.
- Record exact commands, versions, evidence paths, optional prerequisites, observed results,
  interpretation, and known limitations.
- Run the full validation matrix and review the complete diff for secrets, generated state,
  accidental shared-platform changes, and stale plan references.
- Archive this plan only after every applicable checkbox and completion gate is satisfied.
- Exit criteria: a fresh contributor can reproduce the native run and recovery exercise;
  this plan moves to `platforms/completed/`; only then should the next platform plan start.

```text
browser chat
  -> POST /api/runs with sessionId + clientTurnId
  -> ContextSessionStore admission
  -> Lab manifest and execution reference
  -> Restate Workflow and durable model/tool steps
  -> runner inspection and normalized evidence projection
  -> context settlement and browser context meter
```

## Progress record

**2026-09-19T21:13:16+02:00 — first vertical slice verified**

- The browser keeps a stable `clientTurnId` for a failed POST and exposes an inline
  retry that reuses that key. The browser acceptance fixture confirms no duplicate
  visible assistant message or React key warning.
- A pending session turn is retained in browser `sessionStorage` until the server
  acknowledges a run. Refreshing after a lost POST restores the request and offers the
  same-key retry without automatically resubmitting it.
- Restate Chat now has a browser acceptance case for two turns in one `sessionId`,
  with distinct turn keys and distinct workflow/run identities.
- The Restate workflow test confirms that a later turn prepares its model input from
  the settled user/assistant transcript of the earlier turn.
- The native, no-Docker Restate integration passed both the direct runner flow and the
  generic HTTP API flow, including context continuation, evidence projection, duplicate
  workflow submission, and cancellation.
- This does not complete the plan. Runtime/profile hardening, real durable tool/model
  coverage, process-restart reconciliation, compaction recovery, provider ambiguity,
  evidence completeness, browser recovery states, and documentation remain.

The finished implementation is not complete until the flow works with the native local
Restate server and the real OpenRouter path when `OPENROUTER_API_KEY` is available. A
deterministic local model fixture may be used for crash and restart tests where a live
provider would make the test non-reproducible, but those tests must identify the fixture
as a test dependency.

**2026-09-19T21:56:20+02:00 — context-overflow recovery block implemented**

- The Restate OpenRouter adapter now classifies provider-declared context-length failures
  without retaining the provider error body or credentials.
- The workflow performs one bounded `provider_overflow` compaction and retries the changed
  request input. It records `ContextOverflowDetected`, `ContextRecoveryStarted`,
  `ContextRecoveryPrepared`, `ModelRetryScheduled`, and `ContextRecoveryFailed` where
  applicable.
- The deterministic `fake-context-overflow` fixture and Restate workflow tests verify that
  the recovery snapshot contains a compaction summary and that the retry succeeds.
- Focused validation passed: `pnpm --filter @agent-harness-lab/lab-server run test:restate`
  (41 passed, 3 environment-gated integration tests skipped).

**2026-09-19T22:14:00+02:00 — native reconciliation and failure projection extended**

- The native integration now covers a provider outcome that remains ambiguous after
  dispatch. Restate returns a terminal workflow result with the original
  `outcome_unknown` classification, and the workflow does not schedule a retry.
- The generic HTTP projection is polled again after terminal completion to verify that
  duplicate inspection does not append duplicate normalized events.
- A native Lab-server replacement test now runs a delayed, context-capable turn with an
  explicit model window, closes the first server, and reconciles the retained Restate
  execution through a new server instance.
- Context-budget validation failures from a durable context action now retain a bounded
  `CONTEXT_PREPARATION_FAILED` classification instead of being reported as model retry
  exhaustion. Provider credentials and raw provider payloads remain excluded.
- Native validation passed: `AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 pnpm
  --filter @agent-harness-lab/lab-server run test:restate` (`44 passed, 1 skipped`).

**2026-09-19T22:26:00+02:00 — browser recovery state made inspectable**

- Restate Chat now opens the run details section automatically for
  `reconciliation_required` runs and gives the user an explicit `New chat` recovery
  action instead of presenting the result as an ordinary failed answer.
- Restate native workflow key, invocation ID, native status, retry count, and last
  observation are available under a collapsed Native execution section for normal
  runs and recovery states.
- Browser acceptance now covers recovery-required rendering, the native details fields,
  and clearing the unresolved run through the explicit new-chat action.
- Validation passed: `node --test apps/web/tests/browser/platform-chat.browser.test.mjs`
  (`5 passed`).

**2026-09-19T22:30:00+02:00 — Docker-free native restart exercise added**

- Added an opt-in native integration test that allocates isolated ingress, Admin API,
  service, message-fabric, and persistent-data locations. It replaces the service while
  a `fake-delay` workflow is active, then replaces both the service and Restate server
  and verifies that the retained workflow completes from the same native execution.
- The first run exposed the default internal message-fabric port collision with the
  developer's existing Restate process. The exercise now sets Restate's supported
  `RESTATE_BIND_PORT` for the isolated node rather than requiring Docker or stopping
  the user's local stack.
- Validation passed: `AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 pnpm
  --filter @agent-harness-lab/lab-server run test:restate` (`42 passed, 4 skipped`).
- The local-development guide now documents the restart exercise, its deterministic
  fixture, temporary-data cleanup, and the boundary between workflow replay and
  external-provider ambiguity.

**2026-09-19T22:45:00+02:00 — live model acceptance and terminal native status corrected**

- The live browser runner smoke completed a real Restate/OpenRouter run with
  `cohere/north-mini-code:free`; the result was `completed`, usage was recorded as
  87 input and 79 output tokens, and the context projection reported 97% remaining.
  The run evidence contained `config.json`, `context.json`, `events.jsonl`,
  `trajectory.json`, `metrics.json`, `result.json`, and `native/restate.json`; a
  secret-shaped scan found no provider key or authorization value.
- That live run exposed a stale native reference: the Lab result was terminal while
  the persisted Restate reference still said `running`. The runner now refreshes the
  native invocation status from the Admin API whenever a terminal workflow output is
  available, while preserving the terminal result if Admin introspection is briefly
  unavailable. A focused unit test covers the completed-status projection.
- Validation passed after the correction: the Restate suite reported `45 passed, 1
  skipped` (the optional Docker profile), and the targeted live browser runner reported
  `1 passed` for Restate.

**2026-09-19T23:00:00+02:00 — real two-turn browser Chat acceptance added**

- Added an opt-in live browser test for `/platforms/restate/chat`. It selects the real
  OpenRouter model, sends two prompts through the same browser session, waits for two
  completed assistant messages, and verifies that the model becomes session-pinned.
- The acceptance rendered a real context projection of `145 / 256k tokens` and `97%`
  remaining after the second turn. The two runs shared one session but had distinct
  turn/workflow identities; both native references were `completed`.
- Browser console errors remained empty. The test is explicitly opt-in with
  `AGENTLAB_RUN_LIVE_RESTATE_CHAT_UI=1` and does not run in CI without a deliberate
  local OpenRouter configuration.

**2026-09-19T23:10:00+02:00 — broad regression validation passed**

- The full Lab server suite passed with `265 passed, 2 skipped, 0 failed`. The skips
  are optional native integrations for other platforms and are unrelated to Restate.
- The Restate browser fixture suite passed `5/5`; web typecheck and production build
  passed with only the existing large-chunk warning; and `git diff --check` passed.
- The Restate-specific native suite remains green at `45 passed, 1 skipped`, and the
  opt-in live Restate Chat suite remains green at `1 passed` for the two-turn session.
- The plan remains active. Before archiving, the remaining gates are the final
  documentation/rollback record, remaining recovery-state browser checks, and explicit
  recording of the missing repository release-process document.

**2026-09-19T23:25:00+02:00 — browser context-pressure acceptance added**

- Added a deterministic Restate Chat fixture for a compacted session projection. The
  browser now verifies `92% used`, `7% left`, `Compaction due`, one compaction revision,
  and the rendered `Context Compaction Started` / `Context Compacted` timeline entries.
- The acceptance passed with no browser console errors. This closes the browser
  context-pressure gate without pretending that a fixture is a live provider overflow.

## Scope

- [ ] Complete the Restate baseline end to end; session continuity is a foundation, not
  the stopping point for this plan.
- [ ] Verify the native no-Docker runtime profile, service registration, readiness,
  isolated persistent data, shutdown, and repeatable local operations.
- [ ] Complete the real OpenRouter model and deterministic tool execution path with named
  durable steps, bounded retries, cancellation, and provider-outcome classification.
- [ ] Define and enforce the Restate session/turn identity rules on top of the current
  run-oriented runner contract.
- [ ] Make repeated turns in one `sessionId` use the previous settled transcript and
  the shared context-compaction policy.
- [ ] Make the Restate runner recover a retained run after a Lab-server or service
  replacement, including unknown submission outcomes.
- [ ] Make duplicate HTTP requests and duplicate Restate submissions observable and
  idempotent at the Lab projection boundary.
- [ ] Define and test provider-call retry and ambiguous-outcome semantics. Do not claim
  exactly-once OpenRouter execution.
- [ ] Make cancellation, restart, retry, and stale projection states honest in the
  server and browser surface.
- [ ] Show session identity, turn continuity, native Restate status, and context-window
  usage in the existing Restate Chat page without adding a noisy second dashboard.
- [ ] Produce complete normalized and Restate-native evidence, including trajectory and
  metrics, with idempotent terminal writes and no secrets.
- [ ] Add focused unit tests, native Restate integration tests, browser acceptance
  checks, docs, and a runnable recovery walkthrough.
- [ ] Record validation results, limitations, and focused implementation commits before
  moving this plan to `platforms/completed/`.

## Explicitly out of scope

- A Restate Virtual Object or long-lived workflow interaction API for chat sessions.
- Restate Cloud, multi-node deployment, Kubernetes, production authentication, or
  remote ingress.
- Docker as a required dependency. The optional Docker profile may receive only the
  documentation or test changes necessary to keep it accurate.
- A new generic multi-turn runner interface. If the current interface blocks a required
  behaviour, stop and record the smallest proposed contract change before editing it.
- Changes to Temporal, LangGraph, Mastra, Anesu, Studio, or unrelated platform runners.
- New tools, MCP servers, OAuth connectors, plugins, memory retrieval, subagents,
  browser automation, social integrations, or computer-native environments.
- Streaming token delivery. The UI may poll the existing run projection and event list.
- Exactly-once execution or billing semantics for an external model provider.
- Silent automatic retry of an OpenRouter request after an ambiguous timeout.

## Finished behaviour

### User-visible behaviour

- `New chat` creates a new session identity and clears the previous run list.
- A chat session has a pinned platform, variant, model, system instruction, and context
  policy. Changing one of those values after a turn has been admitted starts a new chat
  or is rejected inline. It must not mutate the configuration of an existing session.
- Each submitted turn has a stable browser-generated `clientTurnId`. Retrying the same
  request reuses that key and returns the existing run projection.
- A second prompt in the same session includes settled user and assistant messages from
  earlier turns, subject to the shared context budget and compaction policy.
- The right-side context panel shows used tokens, context-window limit, remaining
  percentage, pressure, and compaction count when the server has a known context
  projection. Unknown token counts are shown as unknown, not as zero.
- The run surface distinguishes `queued`, `running`, `completed`, `failed`,
  `cancelled`, and `reconciliation_required`. A stale projection says that the latest
  platform state could not be reached; it does not invent a terminal answer.
- Native Restate status, retry count, workflow key, invocation ID, and last-modified
  observation are available through the existing run details/evidence path. Native
  details remain progressively disclosed rather than occupying the main chat.
- If the model call may have succeeded but the result is unknown, the user sees an
  explicit recovery-required state and a retry action that creates a new, intentional
  turn. The UI must not silently resubmit the same provider call.
- If Restate or its service is unavailable, the platform page says so and keeps the
  last known run state. It must not show a successful assistant message from a fixture.

### Ownership and boundaries

```text
Browser chat state
  -> owns the active session ID, client turn IDs, selected configuration, and polling.

RunService + ContextSessionStore
  -> owns Lab run admission, session transcript, context snapshots, compaction,
     context-turn settlement, and normalized evidence projection.

Restate runner adapter
  -> owns workflow submission, native identity lookup, status translation, cancellation,
     ambiguous-submission reconciliation, and Restate-specific native evidence.

Restate Workflow service
  -> owns durable model/tool step ordering, platform event intents, workflow-local
     execution, and the terminal result for one run.

Restate server
  -> owns the execution log, replay, workflow routing, server-level retries, and
     invocation lifecycle.

OpenRouter adapter
  -> owns one provider request and response classification. It never owns session
     persistence or Lab evidence.
```

State explicitly in code and documentation:

- `ContextSessionStore` is the sole writer of session transcript and turn records.
- `RunEvidenceStore` is the sole writer of `lab/runs/<run-id>/` normalized records.
- The Restate service may emit event intents in its workflow result, but it does not
  append those events to disk.
- The runner is allowed to retain safe native identity, but the common server does not
  interpret the `native` object.
- Provider credentials are read by the service process only. They never enter workflow
  input, the manifest, native references, event payloads, errors, or logs.
- Restate SDK imports remain under `server/src/platforms/restate/`.

## Session, turn, and identity rules

These rules are implementation requirements, not UI suggestions.

| Identity | Scope | Stable across | Owner |
| --- | --- | --- | --- |
| `sessionId` | Browser conversation and shared context | turns, Lab-server restart | browser plus `ContextSessionStore` |
| `clientTurnId` | One user submission intent | lost HTTP response and client retry | browser, validated by server |
| `runId` | One Lab execution and evidence directory | polling and Lab-server restart | Lab server |
| Restate workflow key | One native Restate workflow execution | runner replacement and inspection | Restate runner |
| Restate invocation ID | One accepted native invocation | polling and native reconciliation | Restate |
| context snapshot ID | Prepared model input for one turn | model step replay and evidence inspection | ContextService |

Required invariants:

- One `(sessionId, clientTurnId)` pair maps to at most one `runId`.
- A retry with the same key and a different prompt is rejected as a conflict.
- A session cannot admit a second active turn until the prior turn is terminal or an
  explicit recovery path resolves it.
- A Restate workflow key is derived from `runId`, never from `sessionId`. Two turns in
  one session must never collide at the Restate workflow identity layer.
- A provider request attempt is identified by `(runId, turnId, round, attempt)` and is
  retained in native-safe telemetry. A provider request ID is retained when supplied.
- A missing provider response is not equivalent to a provider failure before dispatch.

## State, persistence, and evidence

### Existing durable roots

```text
lab/runs/<run-id>/
  config.json                 # RunEvidenceStore, immutable manifest
  events.jsonl                # RunEvidenceStore, normalized ordered events
  trajectory.json             # RunEvidenceStore, terminal trajectory
  metrics.json                # RunEvidenceStore, terminal metrics
  result.json                 # RunEvidenceStore, terminal or recovery result
  context.json                # RunEvidenceStore, prepared snapshot for this run
  native/restate.json         # RunEvidenceStore, redacted Restate execution reference

lab/sessions/<session-id>/
  session.json                # ContextSessionStore, session configuration/revision
  transcript.jsonl            # ContextSessionStore, ordered user/assistant/tool context
  turns.jsonl                 # ContextSessionStore, turn admission and settlement
  context-revisions.jsonl     # ContextSessionStore, compaction/revision records
  snapshots/<snapshot-id>.json # ContextSessionStore, prepared context snapshots
```

The implementation must keep these ownership rules and add no second session database
inside the Restate service.

### Restate native reference

Extend the existing versioned native reference only if a field is required by recovery.
The safe reference must retain, at minimum:

```json
{
  "schemaVersion": 1,
  "serviceName": "AgentLabRestateBaseline",
  "handlerName": "run",
  "workflowKey": "agentlab:<run-id>",
  "invocationId": "<restate-id-or-null>",
  "submissionOutcome": "accepted|already_accepted|unknown",
  "nativeStatus": "pending|ready|running|backing-off|suspended|completed|...",
  "retryCount": 0,
  "lastModifiedAt": "<timestamp-or-null>",
  "unknownSince": "<timestamp-or-omitted>",
  "errorCode": "<safe-classification-or-omitted>"
}
```

Do not retain request headers, authorization values, raw provider responses, prompts,
tool arguments, or arbitrary Restate SQL output in `native/restate.json`.

### Write order and crash windows

The plan must test and document these write boundaries:

1. Admit the context turn and persist the user message.
2. Create the immutable Lab manifest and `RunCreated` event.
3. Submit the Restate workflow using the deterministic run-derived key.
4. Persist the native execution reference before trusting the dispatch as recoverable.
5. Reconcile native event intents, result, trajectory, metrics, and context snapshot.
6. Settle the context turn with the final assistant output or failure.

For every boundary, define what the next `getRun`, duplicate POST, or operator recovery
does. A crash must not produce a second assistant transcript entry, leave a successful
run without a native identity silently, or turn a temporary outage into a fabricated
failure.

## Failure, retry, and recovery semantics

### Submission and acknowledgement

- A confirmed Restate acceptance is retained even if the immediate inspection fails.
- A lost acknowledgement is reconciled by workflow key and, when available, invocation
  ID. The runner must not submit a new workflow with a new key while the original key
  could still be active.
- If neither the invocation nor a retained native record can be found, the Lab result is
  `reconciliation_required`, with a safe code and a recovery instruction. It is not
  `completed` and not a fabricated provider failure.
- Duplicate submission of an already accepted workflow is represented as
  `already_accepted` and continues inspection of the original execution.

### Restate retries and model requests

- Restate handler retries are bounded by the platform configuration and are visible in
  native inspection. Do not inherit an unbounded default accidentally.
- Every non-deterministic model or tool operation is inside a named `ctx.run` step.
  Step names are deterministic for the run, turn, round, and attempt.
- A replayed completed step consumes its journaled result and must not call OpenRouter
  again.
- A crash while an external request is in flight can duplicate that request if Restate
  has not journaled its result. This is an unavoidable ambiguity for a provider without
  a usable idempotency contract. Record it explicitly and do not call it exactly once.
- Retry automatically only when the adapter can classify the failure as pre-dispatch or
  as a bounded, configured retryable provider response. A timeout after dispatch must
  carry `requestSent: true` and produce an unknown/recovery path rather than silently
  repeating a billable request.
- Model attempt counts, provider request IDs, retryable classification, and unknown
  outcome are included in normalized metrics/events without secrets.
- Tool execution follows the existing tool-loop policy. Tool calls are not duplicated
  by a browser retry after the run has already been admitted.

### Context and compaction recovery

- Context admission happens once per stable client turn key.
- Context preparation uses the persisted turn and a deterministic snapshot ID. A
  replayed Restate context step reads the same snapshot when it has already been
  journaled.
- Preflight compaction uses the shared policy and records its trigger, source revision,
  retained message IDs, summary message ID, before/after budgets, and model/tokenizer
  basis.
- A provider context-overflow response may trigger one changed-input recovery attempt
  through the existing shared compaction flow. The plan must bound this path and prevent
  a compaction loop.
- A crash after user-message admission but before model completion leaves the turn
  recoverable. The next inspection or duplicate request must either complete that run,
  expose an explicit recovery state, or settle it as a failure according to the native
  outcome. It must not admit a new turn merely because the browser refreshed.

### Cancellation

- The UI records cancellation requested separately from cancellation observed.
- The runner sends cancellation to the native invocation and polls until Restate reports
  a terminal cancellation or another terminal outcome.
- A cancellation while the provider request is in flight must not report that the
  provider definitely did not receive the request.
- Context settlement for a cancelled turn is idempotent and clears the active turn only
  after the Lab has a terminal cancellation record.

### Restart and orphan handling

Test and document all of these separately:

1. Lab server restarts while Restate is still running.
2. Restate service process restarts while a workflow is active.
3. Restate server restarts with its persistent local data directory intact.
4. Lab server stops after context admission but before dispatch.
5. Lab server stops after Restate accepts the workflow but before writing the native
   reference.
6. The service stops after a provider request is sent but before its durable step result
   is journaled.
7. A session has an active turn whose run record is missing or whose native execution
   is gone.

For an orphaned active context turn, choose and implement one explicit rule: reconcile
the retained run by its run ID, or mark the turn failed/recovery-required with a safe
operator-visible reason. Never clear it merely because it is old, and never admit a
new turn over it without recording the decision.

## Security and configuration

- Verify Node.js 22+ and pin the exact compatible Restate SDK and native server versions
  in the platform-owned package/config documentation. Do not use floating `latest`.
- Keep `OPENROUTER_API_KEY` in the service process environment. The Lab server may
  validate that the selected provider is configured but must not copy the key into a
  request or manifest.
- Validate session IDs, client turn IDs, run IDs, workflow keys, model IDs, numeric
  limits, URLs, retry counts, and timeouts before creating work.
- Keep Restate ingress and Admin URLs loopback-only in the native local profile unless
  the operator explicitly overrides them.
- Bound prompt, model output, tool output, event message, and native error sizes before
  writing evidence or logs.
- Escape or parameterize introspection queries safely. Do not construct SQL from an
  unvalidated workflow key or invocation ID.
- Redact credentials and authorization-shaped values from error messages and test
  snapshots.
- When a required dependency is unavailable, report degraded readiness and a useful
  command. Do not automatically start Docker or claim that a planned dependency is
  healthy.

## Implementation checklist

### 1. Contracts and configuration

- [ ] Re-read the current Restate SDK and server documentation and record the exact
      compatible Node, SDK, and server versions in the Restate platform docs.
- [ ] Document the `sessionId`, `clientTurnId`, `runId`, workflow-key, invocation-ID,
      and context-snapshot identity rules in platform contracts.
- [ ] Add validation for incompatible session configuration changes, including model,
      platform, variant, system instruction, and context policy.
- [ ] Define the safe native reference fields and migration behaviour for existing
      `schemaVersion: 1` references.
- [ ] Define bounded Restate handler and `ctx.run` retry values, provider retry classes,
      timeout values, and the unknown-outcome state in configuration.
- [ ] Ensure all new fields have stable JSON shapes and are included in the immutable
      manifest only when they are safe and reproducible.

### 2. Restate workflow and model boundary

- [ ] Make each external model and tool operation a deterministic, named durable step.
- [ ] Ensure replay of a journaled step does not call the provider a second time.
- [ ] Preserve the selected OpenRouter model and context-window metadata through every
      turn and every recovery path.
- [ ] Bound provider retry attempts and classify `requestSent` accurately for response,
      timeout, abort, HTTP, and malformed-response failures.
- [x] Add an explicit context-overflow recovery path using the shared ContextService,
      with one bounded compaction/retry cycle and evidence for the changed snapshot.
- [ ] Keep fake model behaviour isolated to deterministic tests and failure fixtures.
- [ ] Preserve tool-call pairing, tool limits, cancellation signals, and tool event
      ordering across replay and repeated inspection.

### 3. Runner, reconciliation, and evidence

- [ ] Make start with the same workflow key safe for accepted, already-accepted, and
      ambiguous submissions.
- [ ] Reconcile by retained invocation ID first and workflow key second, using the
      introspection API only behind the Restate adapter.
- [ ] Map all observed native statuses, including pending, ready, running,
      backing-off, suspended, completed, cancelled, failed, killed, and missing.
- [ ] Persist refreshed native status, retry count, last-modified time, and invocation
      identity after inspection.
- [ ] Make event projection idempotent for duplicate or replayed event intents and
      explicit when native event order cannot be proven.
- [ ] Write result, trajectory, metrics, context snapshot, and context settlement in a
      safe terminal order. Test failure in each write step.
- [ ] Make recovery-required outcomes durable and retryable through inspection without
      overwriting a later authoritative result.
- [ ] Verify the current common server API does not need a generic contract change. If
      one is unavoidable, stop implementation at the boundary and write an ADR or
      focused contract plan before changing shared code.

### 4. Browser chat surface

- [x] Persist the active `sessionId` for the current chat and generate a new
      `clientTurnId` for each send.
- [x] Reuse the same `clientTurnId` when the browser retries a request after a failed
      or lost POST response, including after a browser refresh.
- [x] Ensure `New chat` clears the active run list and creates a fresh session instead
      of reusing a session with incompatible configuration.
- [x] Pin the session model/configuration after the first admitted turn, or visibly
      require `New chat` before changing it. Do not leave the current “session already
      exists with different configuration” failure as an unexplained raw error.
- [x] Render the context meter from the server projection and show used tokens,
      context-window size, remaining percentage, pressure, and compaction count.
- [x] Keep polling stable after terminal completion. Do not append duplicate assistant
      messages or reuse a non-unique React key when the same run is re-observed.
- [ ] Show stale, unavailable, retrying, cancelled, and recovery-required states with
      concise inline UI. Do not use browser-native dialogs.
- [ ] Keep native Restate details behind the existing progressive disclosure path.
- [ ] Verify desktop, tablet, and narrow browser widths for the chat, context panel,
      model selector, error state, and run details.

### 5. Local operations and scripts

- [ ] Verify the native Restate server startup, persistent data directory, Admin API
      readiness, service registration, and service readiness sequence.
- [ ] Update the Restate local-development guide with the no-Docker path first.
- [ ] Document the optional Docker profile separately without making it a prerequisite.
- [ ] Add a deterministic restart procedure that uses an isolated temporary data
      directory and ports, so recovery exercises do not destroy the contributor’s
      normal local stack.
- [ ] Document how to inspect invocation status, retry count, workflow key, journal,
      and service registration through Restate’s supported CLI or Admin API.
- [ ] Document how to stop a failed process and how to tell an unavailable dependency
      from an unresolved execution outcome.

### 6. Documentation and learning material

- [ ] Update `server/src/platforms/restate/README.md` with the new session and recovery
      semantics.
- [ ] Update Restate architecture and semantics docs with ownership, write order,
      replay, retry, cancellation, unknown outcomes, and the deliberate non-use of
      Virtual Objects in this slice.
- [ ] Add a runnable recovery walkthrough under `development/playground/` only if it
      is clearly a hands-on implementation inspection and not a test, scenario, or
      experiment.
- [x] Link this active plan from the platform plan index and keep the completed baseline
      plan unchanged as the historical foundation.
- [ ] Record observed results separately from interpretation and list the local-only
      limitations plainly.

## Test coverage

### Unit tests

- [ ] Session configuration is accepted when identical and rejected when model,
      platform, variant, system instruction, or policy differs.
- [ ] Duplicate `(sessionId, clientTurnId)` admission returns the original turn and
      rejects a changed prompt.
- [ ] Run-derived workflow keys differ for two turns in one session and remain stable
      for repeated inspection.
- [ ] Native reference parsing rejects malformed versions, workflow keys, IDs, URLs,
      and unsafe values.
- [ ] Native status mapping covers queued, running, backing-off, suspended, completed,
      failed, cancelled, and missing executions.
- [ ] Accepted, already-accepted, pre-dispatch rejection, and ambiguous submission
      outcomes map to the correct Lab state.
- [ ] Provider response classifications distinguish pre-dispatch failure, retryable
      response, timeout after dispatch, cancellation, malformed response, and terminal
      provider error.
- [ ] Durable step names are deterministic and distinct across rounds and attempts.
- [ ] Context snapshot and compaction evidence remains stable across replay.
- [ ] Event intents are idempotently projected and duplicate source sequences are not
      rendered twice.
- [ ] Secret-shaped values are absent from native references, errors, events, and test
      snapshots.

### Server integration tests

- [ ] Two sequential runs with one session preserve the first turn in the second model
      request and advance the context projection.
- [ ] Concurrent duplicate POST requests with one `clientTurnId` produce one run and
      one user message.
- [ ] A second different turn submitted while the first is active is rejected with a
      useful session-busy response.
- [ ] A request after a terminal failure can intentionally create a new turn without
      mutating the failed turn.
- [ ] A Lab-server replacement reconciles an active Restate execution from the saved
      native reference.
- [ ] A missing reference or missing native execution becomes
      `reconciliation_required`, not a fabricated success.
- [ ] Context settlement is idempotent after repeated polling and repeated terminal
      inspection.
- [ ] Failure before dispatch, after accepted dispatch, before result projection, and
      after result projection leaves inspectable evidence.
- [ ] Cancellation records request and observed terminal state separately.

### Native Restate integration tests

The native test profile must run without Docker when the Restate binary and local
dependencies are installed. Tests that require an optional container or real provider
must be explicitly skipped with the prerequisite in the test output, never silently
reported as passed.

- [x] Start the pinned native Restate server with a temporary persistent data directory.
- [x] Start and register the TypeScript Restate service on an isolated port.
- [x] Complete one deterministic model/tool run and inspect Restate-native status.
- [x] Complete two turns in one shared Lab session with separate Restate workflow keys.
- [x] Stop and replace the service during an unfinished durable step; verify replay and
      final evidence.
- [x] Stop and replace the Lab server while the native workflow remains active; verify
      the new server finds the retained execution reference.
- [x] Stop and replace Restate using the same persistent data directory; verify the
      workflow is retained or the result is honestly classified as unavailable.
- [x] Exercise the ambiguous submission path and verify no second workflow key is
      created.
- [x] Exercise cancellation while a durable step is waiting.
- [ ] Exercise a deterministic provider timeout-after-dispatch fixture and inspect the
      unknown/recovery result and attempt telemetry.
- [x] Run one live OpenRouter multi-turn acceptance when `OPENROUTER_API_KEY` is
      available. Record the model ID, response status, usage, and evidence paths, but
      never record the key. The opt-in live Chat test recorded two completed turns
      using `cohere/north-mini-code:free` and preserved the key only in the ignored
      local process environment.

### Browser acceptance checks

- [x] Open `/platforms/restate/chat` from the platform tab and create a new chat.
- [x] Send a real OpenRouter prompt and observe the assistant response in the browser.
- [x] Send a second prompt and verify the conversation continues in the same session.
- [x] Verify the context card shows a non-fabricated token window and percentage.
- [x] Trigger or fixture a compaction case and verify the pressure/compaction state is
      visible without the page blinking or duplicating messages.
- [ ] Refresh during polling and verify the existing run is reused.
- [ ] Restart the Lab server during a run and verify the browser eventually shows the
      reconciled result or explicit recovery state.
- [ ] Change the model after a turn and verify the UI requires a new chat or gives a
      clear inline conflict.
- [ ] Click cancel and verify the button, status, and final transcript do not claim an
      outcome stronger than the native execution supports.
- [x] Inspect the browser console for duplicate-key warnings, route errors, failed
      health probes, and unhandled polling exceptions.
- [ ] Check narrow and wide layouts manually.

## Required validation commands

Run the narrow checks after each coherent code section, then the full set before
archiving the plan:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server exec tsx --test \
  tests/context/session-store.test.ts \
  tests/control-plane/run-service.test.ts \
  tests/platforms/restate/models.test.ts \
  tests/platforms/restate/runner.test.ts \
  tests/platforms/restate/workflow.test.ts

pnpm --filter @agent-harness-lab/lab-server run test:restate
pnpm --filter @agent-harness-lab/lab-server test
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
git diff --check
```

Native acceptance commands must be recorded with the exact binary and SDK versions:

```bash
./scripts/run_local_stack.sh restate-server
./scripts/run_local_stack.sh restate
AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run test:restate
```

The exact script arguments may change if the current launcher exposes a more precise
isolated recovery profile. Update this plan and the local guide when they do. A real
OpenRouter acceptance requires `OPENROUTER_API_KEY` in the service environment and is
not a substitute for deterministic native restart tests.

Expected unavailable profiles must be recorded explicitly:

- Docker-backed tests: not required for completion; report unavailable if Docker is not
  installed.
- Live OpenRouter acceptance: optional in CI and required only when a safe local key is
  intentionally supplied for manual validation.
- Restate Cloud or remote deployment: not part of this plan.

## Documentation, release, and operational completeness

- [ ] Check for the repository release-process document before implementation. It is
      not present in this checkout today, so record that absence in the handoff and
      keep the documentation, logging, metrics, version, migration, rollout, and
      rollback decisions below explicit.
- [ ] Documentation update: required. The session/recovery contract, local commands,
      failure semantics, and evidence shape change.
- [ ] Analytics: not applicable. This Lab slice does not add product analytics.
- [ ] Structured logs: required only for safe recovery classifications, request IDs,
      native status, and timing. Do not log prompts or credentials by default.
- [ ] Metrics: required in run evidence for model calls, retries, tool calls, duration,
      and unknown/recovery outcomes. No external metrics service is required.
- [ ] Version/release identity: retain the server version and platform dependency pins
      in each manifest and record the exact local runtime versions in validation notes.
- [ ] Migration: required for any native reference or session schema change. Existing
      baseline runs must remain readable.
- [ ] Rollback: document how to disable `restate/baseline` or revert only the Restate
      commits while preserving existing run evidence and other platform runners.

## Completion gate

Before moving this plan to `platforms/completed/`, verify:

- [ ] Every applicable implementation and test checkbox is complete.
- [ ] The browser can execute and continue a real Restate-backed conversation.
- [ ] The native no-Docker path has passed, or every blocked prerequisite is recorded
      with a reproducible command and an explicit limitation.
- [ ] Session identity, duplicate turns, configuration conflicts, context usage, and
      compaction are visible and tested.
- [ ] Restate service, Lab server, and persistent Restate restarts have a tested outcome.
- [ ] Provider retry and ambiguous-outcome semantics are explicit and no exactly-once
      claim is present.
- [ ] Evidence contains the expected normalized and native files without secrets.
- [ ] Documentation and manual walkthroughs match the final implementation.
- [ ] Validation results and known limitations are recorded in the completion section.

## Commit discipline and handoff

Use focused commits instead of one final dump. A reasonable sequence is:

1. `feat(restate): define session continuity and recovery contracts`
   - Restate-owned contracts, config, identity rules, and unit tests.
2. `feat(restate): harden durable turn and provider recovery`
   - Workflow step boundaries, provider classifications, compaction recovery, and
     workflow tests.
3. `feat(restate): reconcile native executions and evidence`
   - Runner inspection, duplicate submission, restart handling, native evidence, and
     server integration tests.
4. `feat(web): make Restate chat sessions recoverable`
   - Session/client-turn UI state, context display, configuration conflict handling,
     polling stability, and browser checks.
5. `docs(restate): document session recovery and local acceptance`
   - Platform docs, local recovery walkthrough, plan validation record, and limitations.

Before each commit:

- [ ] Review `git status` and preserve unrelated Anesu, Studio, lockfile, and playground
      changes.
- [ ] Run the narrow checks for the changed section.
- [ ] Inspect the complete diff and confirm no secrets or generated artifacts are staged.
- [ ] Keep shared control-plane changes separate from Restate implementation changes.
- [ ] Record the commit hash in the handoff.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` - `[passed/failed and concise result]`
- `[manual browser check]` - `[what was observed]`
- `[native restart exercise]` - `[what was observed]`

### Known limitations

- `[deliberate local-only limitation or follow-up]`

### Historical-scope note

This plan records the run-oriented Restate session design at completion time. A future
Restate Virtual Object or long-lived workflow interaction implementation should have its
own plan and must not silently rewrite the semantics recorded here.
