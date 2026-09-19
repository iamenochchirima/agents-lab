# Restate session continuity and recovery

**Created:** 2026-09-19T20:38:46+02:00
**Last updated:** 2026-09-19T21:13:16+02:00
**Status:** Active
**Owner:** Primary platform implementation agent
**Platform:** `restate`
**Variant:** `baseline`

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

Make the Restate baseline a real multi-turn platform surface that survives service,
Lab-server, and Restate restarts. A contributor should be able to continue a browser
conversation, retry a lost HTTP response without creating a duplicate turn, inspect the
native Restate execution identity, and distinguish a completed result from an outcome
that is still unknown.

The slice answers this question:

> Can one Restate-backed Lab conversation preserve ordered context and honest recovery
> across normal retries and process failure without fabricating a result or silently
> executing the same turn twice?

## Definition of done

From a clean checkout with the native Restate server available, a contributor can run
the server, the Restate service, and the web app, open the Restate Chat page, and:

1. Start a new chat with a selected OpenRouter model.
2. Send a first prompt and see the actual model response, run status, tool events when
   enabled, and context-window usage.
3. Send a second prompt in the same chat and see the first turn included in the
   prepared context.
4. Refresh or restart the Lab server while the turn is running, then see the existing
   run reconcile from its retained Restate execution reference.
5. Restart the Restate service and observe Restate replay the unfinished durable step
   or expose a bounded, inspectable failure.
6. Retry the same browser request with the same `clientTurnId` and receive the existing
   turn instead of creating a second context message or second Lab run.
7. Start a new chat before changing a session-pinned model configuration.
8. Inspect the resulting evidence and confirm that provider credentials are absent.

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
- Restate Chat now has a browser acceptance case for two turns in one `sessionId`,
  with distinct turn keys and distinct workflow/run identities.
- The Restate workflow test confirms that a later turn prepares its model input from
  the settled user/assistant transcript of the earlier turn.
- The native, no-Docker Restate integration passed both the direct runner flow and the
  generic HTTP API flow, including context continuation, evidence projection, duplicate
  workflow submission, and cancellation.
- This does not complete the plan. Browser-refresh retry persistence, process-restart
  reconciliation, compaction recovery, provider ambiguity, and documentation remain.

The finished implementation is not complete until the flow works with the native local
Restate server and the real OpenRouter path when `OPENROUTER_API_KEY` is available. A
deterministic local model fixture may be used for crash and restart tests where a live
provider would make the test non-reproducible, but those tests must identify the fixture
as a test dependency.

## Scope

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
- [ ] Add an explicit context-overflow recovery path using the shared ContextService,
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
      or lost POST response. Browser-refresh persistence remains open.
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

- [ ] Start the pinned native Restate server with a temporary persistent data directory.
- [ ] Start and register the TypeScript Restate service on an isolated port.
- [x] Complete one deterministic model/tool run and inspect Restate-native status.
- [x] Complete two turns in one shared Lab session with separate Restate workflow keys.
- [ ] Stop and replace the service during an unfinished durable step; verify replay and
      final evidence.
- [ ] Stop and replace the Lab server while the native workflow remains active; verify
      the new server finds the retained execution reference.
- [ ] Stop and replace Restate using the same persistent data directory; verify the
      workflow is retained or the result is honestly classified as unavailable.
- [ ] Exercise the ambiguous submission path and verify no second workflow key is
      created.
- [ ] Exercise cancellation while a durable step is waiting.
- [ ] Exercise a deterministic provider timeout-after-dispatch fixture and inspect the
      unknown/recovery result and attempt telemetry.
- [ ] Run one live OpenRouter multi-turn acceptance when `OPENROUTER_API_KEY` is
      available. Record the model ID, response status, usage, and evidence paths, but
      never record the key.

### Browser acceptance checks

- [ ] Open `/platforms/restate/chat` from the platform tab and create a new chat.
- [ ] Send a real OpenRouter prompt and observe the assistant response in the browser.
- [ ] Send a second prompt and verify the conversation continues in the same session.
- [ ] Verify the context card shows a non-fabricated token window and percentage.
- [ ] Trigger or fixture a compaction case and verify the pressure/compaction state is
      visible without the page blinking or duplicating messages.
- [ ] Refresh during polling and verify the existing run is reused.
- [ ] Restart the Lab server during a run and verify the browser eventually shows the
      reconciled result or explicit recovery state.
- [ ] Change the model after a turn and verify the UI requires a new chat or gives a
      clear inline conflict.
- [ ] Click cancel and verify the button, status, and final transcript do not claim an
      outcome stronger than the native execution supports.
- [ ] Inspect the browser console for duplicate-key warnings, route errors, failed
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
