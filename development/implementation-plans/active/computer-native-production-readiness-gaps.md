# Computer Native production-readiness gaps

**Created:** 2026-09-16T12:00:00+02:00
**Last updated:** 2026-09-16T22:48:42+02:00
**Status:** Active
**Owner:** Computer Native standalone product

## Purpose

This document is the source of truth for what remains before Computer Native can be
called a mature, production-ready product. It is deliberately broader than any one
implementation slice. Each workstream below must get its own focused plan before code
changes begin.

The completed plans in this directory mean that a bounded slice was implemented and
verified. They do not mean that the whole Computer Native product is mature. The honest
current status is:

> Computer Native has real local foundations for model turns, workspace actions,
> foreground process execution, managed browser interaction, memory, approvals, and a
> standalone terminal interface. It is not production-ready yet.

Passing the current test suite proves useful local behaviour. It does not prove safe
operation under hostile input, process crashes, long-running work, provider failure,
concurrent users, upgrades, or real deployment conditions.

## Scope and terminology

This register covers the standalone Computer Native product. It does not require the
main Agent Harness Lab UI to be integrated before the standalone product can become
production-ready. The main UI still has a separate integration gap, recorded below,
because the wider Lab cannot claim a complete product experience while that boundary is
unfinished.

Use these terms consistently:

| Term | Meaning |
| --- | --- |
| Slice-complete | The bounded behaviour promised by one plan is implemented, tested, documented, and archived. |
| Integrated | The behaviour works through the shared runtime, TUI, persistence, approvals, and public contracts without a parallel special path. |
| Hardened | Security, failure, restart, cancellation, concurrency, and resource-limit tests pass for the intended deployment profile. |
| Operational | Operators have observability, migration, backup, recovery, release, and support procedures. |
| Production-ready | The required product scope is integrated, hardened, operational, documented, and accepted against the gates in this document. |

An item marked “later” or “out of scope” in a completed slice is still a product gap if
the product is expected to provide that capability. It is not evidence that the gap has
been solved.

## Current baseline

The following evidence establishes the current local foundation, not production
readiness:

- `pnpm test`: 321 tests passed.
- `pnpm run coverage`: 321 tests passed, with 89.21% line coverage, 78.20% branch
  coverage, and 85.01% function coverage in the latest successful run. Node's experimental
  coverage runner can vary slightly between runs; one earlier run was discarded because
  instrumentation caused timing-sensitive browser and admission tests to fail.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed.
- `git diff --check`: passed for the validated changes.
- Persistence acknowledgement fault injection now covers durable terminal-result and
  terminal-event writes plus process, workspace mutation, browser action, and memory
  action records. Reopening and recovering twice produces no duplicate terminal
  evidence and never replays the operation.
- Recovery reconstructs missing terminal lifecycle events from durable process, browser,
  memory, and workspace records; workspace “not applied” outcomes use a distinct
  reconciliation event.
- Real child-process crash tests now prove that losing acknowledgement after the
  process's completed record does not replay a completed side effect, and that a still
  running detached child is terminated during restart recovery without replay. The
  running record remains `ambiguous` and records whether termination was confirmed.
- A real approved process side-effect test proves that losing acknowledgement after the
  command and terminal record complete does not replay the command on recovery; the
  missing lifecycle event is repaired before an already durable turn-terminal event.
- A launch-record acknowledgement failure after spawn now terminates the child before
  the failure returns to the runtime.
- A diagnostic interruption before the durable running process record also terminates
  the spawned child; a process is left for restart reconciliation only after its running
  record is durable.
- Linux process records carry an executable/start-token identity, and recovery refuses
  to signal a PID whose current identity does not match the persisted record.
- Persisted process records are now schema- and ownership-validated before writes,
  transitions, or recovery reconciliation. Invalid limits, state/decision values,
  outcome fields, running timestamps, or PIDs fail closed without interpreting the
  process record or advancing the interrupted turn.
- Model requests are rejected before provider transport when their serialized size
  exceeds `COMPUTER_NATIVE_MAX_MODEL_REQUEST_BYTES`; streamed response text and tool-call
  fields are bounded by `COMPUTER_NATIVE_MAX_MODEL_OUTPUT_BYTES` and fail without a
  partial assistant transcript. The OpenRouter adapter applies the response bound while
  reading the provider stream.
- Process, browser, and memory lifecycle events now enforce identity-scoped ordering and
  reject skipped phases or post-terminal events. Recovery-only direct terminal evidence
  is accepted only with an explicit `recovered: true` marker.
- Normal denied or unavailable process, workspace, and memory approvals now emit a
  terminal lifecycle outcome instead of leaving only an approval event.
- Diagnostic runtime checkpoints now stop turns at model, approval, tool, and terminal
  boundaries without converting the stop into a normal failure; recovery tests prove
  that a stopped approved process is not launched, a running child is reconciled, and
  completed filesystem, browser, memory, and multi-file side effects are not replayed.
- Approved memory `add` and `replace` mutations whose canonical write succeeded before
  their action-record acknowledgement was lost are reconciled from source-path,
  record-identity where applicable, provenance, and content-hash evidence without replay;
  repeated recovery leaves one entry and one terminal event. Memory `remove` now uses
  hash-only deletion evidence, and mixed `batch` actions persist a member manifest and
  reconcile add/replace/remove members without replay. Direct memory-store write-fault
  injection now covers canonical and deletion-evidence writes. Cross-file daily batches
  persist before/after canonical-file hashes and recover all-before, all-after, and mixed
  publication states without replay; they do not claim rollback or cross-file atomicity.
- Memory action histories now validate operation-local state transitions and immutable
  identity before append and during recovery. They reject skipped approval boundaries,
  identity drift, and conflicting duplicate outcomes; reconciliation may attach the newly
  found record ID only for an approved `add` action. This is an evidence-integrity guard,
  not a generic transaction or exactly-once execution layer.
- Browser screenshot and download targets now hold lock-backed ownership leases while
  adapter writes are in flight. Bounded cleanup retains live in-flight artifacts and
  only reclaims old incomplete artifacts after stale-owner checks; finalization and
  discard release the lease. A denied or unavailable download approval also discards its
  preallocated target, so a non-started browser action does not leak a live lease.
- Browser screenshot and download turns now persist bounded per-turn artifact metadata
  before emitting `BrowserArtifactCreated`. Restart recovery repairs that event from the
  per-turn record after an acknowledgement loss and does not recreate the browser file;
  an interruption before the per-turn checkpoint can still leave an orphan for bounded
  artifact cleanup, so external artifact creation is not claimed to be transactional.
- Bounded browser cleanup also recognizes and removes expired atomic-writer temporary
  metadata files under the artifact lease and entry bound. This covers handled publication
  failures and cleanup of known temp-file shapes, but is not a hard-kill proof.
- Managed local browser profiles now hold lock-backed ownership leases for the browser
  session lifetime. Startup cleanup retains old profiles with live owners and reclaims
  only stale profiles; the generic session manager keeps leasing optional for other
  backends.
- Browser upload approvals now bind a source file identity (device/inode/mode, size,
  modification time, and SHA-256) using a bounded no-follow descriptor read, and
  recheck it immediately before adapter dispatch; changed, growing, or unavailable
  sources fail closed without an upload.
- Managed Playwright element references now carry bounded adapter-side markup identity
  and are rechecked immediately before side-effecting actions; same-document DOM
  replacement fails as `stale-reference` rather than acting through an ordinal locator.
- A real OpenRouter smoke test produced a model response through the Computer Native
  runner. The deterministic provider remains useful for repeatable tests.
- Built-in provider adapters now expose capability metadata. The factory validates
  namespaced provider/model selection before admission, and the OpenRouter adapter
  records bounded request identity, latency, and response usage when available.
- The built-in registry exposes credential-free provider summaries and the TUI `/models`
  view shows the explicit active selection without automatic fallback. Runtime evidence
  also retains observed request/output bytes and effective configured limits.
- OpenRouter context-limit responses, HTTP and streamed refusals, incomplete streams,
  and pre-output versus post-output disconnects now have bounded classifications. The
  runtime does not retry context/refusal outcomes and does not retry a disconnect after
  partial output.
- New turns carry a stable correlation ID through TUI events, model requests, lifecycle
  and round evidence, terminal results, and action records. Older records use a turn-ID
  compatibility fallback, while explicit cross-turn correlation mismatches fail closed.
- Model request, attempt completion, retry, and completion evidence is idempotent for an
  identical repeated payload and rejects conflicting duplicates by stable identity.
- Memory search evidence is now immutable by `searchId`; identical acknowledgement retries
  are no-ops and conflicting result sets or query identity cannot overwrite it.
- Restart recovery reconstructs a missing `MemorySearched` event from durable search
  evidence before recording the interrupted turn; repeated recovery remains idempotent.
- One-shot action lifecycle evidence is also idempotent by action identity; repeatable
  workspace progress observations remain preserved as separate events.
- Durable lifecycle history rejects unknown types, broken sequence numbers, and
  cross-session/turn records. Terminal results and persisted action records are checked
  against their admitted owner before they can be written or adopted during recovery.
- Repeated terminal turn evidence now compares the redacted payload: identical retries
  are idempotent, while conflicting terminal payloads fail closed.
- Terminal commits validate the requested turn-state transition before writing
  `result.json`; an invalid terminal transition leaves the durable state and terminal
  result evidence unchanged.
- Missing and malformed terminal results are now distinguished; an existing malformed
  `result.json` fails closed during direct writes and restart recovery instead of being
  overwritten.
- Restart recovery checks existing terminal-event status, assistant identity, and error
  payload against the durable result before advancing the turn state.
- Direct writes and restart recovery also reject a terminal `turn.json` state that does
  not match the status in `result.json`, leaving the existing state unchanged.
- Turn state is now published to the live store only after `turn.json` replacement
  returns, preserving a retryable in-memory view across acknowledgement loss.
- Shared JSONL evidence reads now fail closed on internal or extra blank records, and
  empty journal replacements no longer emit a misleading blank record.
- Transcript messages are validated against session ownership and stable message IDs;
  identical acknowledgement retries do not duplicate conversation evidence, while
  conflicting message reuse fails closed.
- `TurnStarted` provider/model metadata is checked against the admitted turn when
  present, preventing a durable lifecycle record from claiming a different selection.
- A pre-cancelled turn does not invoke the provider or emit a model-request claim, and
  cancellation during model retry backoff cannot dispatch a later attempt.
- Session ownership locks now persist a Linux executable/start-time identity alongside
  the PID. Reused-PID locks are reclaimed only when the identity mismatches; unverified
  or permission-denied live owners remain locked, and invalid PIDs are never probed as
  process groups. This hardens session ownership but does not establish durable job
  leases or full cross-platform process identity.
- `runTurn` now owns one foreground execution slot per session. It rejects concurrent
  provider dispatch, refuses to admit around a durable `submitting`/`streaming` turn,
  and shares the execution lock with restart recovery. This is not queueing, durable
  worker leasing, or a multi-turn scheduler.
- The boundary matrix now includes real runtime interruption tests before a workspace
  applying record, after a committed workspace record acknowledgement, before a browser
  start record, and after browser completion evidence. These tests prove no filesystem or
  browser side effect is replayed and that recovery-only lifecycle evidence is singular.
  They do not constitute complete coverage of every durable write or host-side boundary.

The missing evidence is more important than the line-coverage number. We still need
failure-injection, long-running, concurrency, security, cross-platform, upgrade,
provider, browser-profile, and operational acceptance evidence.

### At-a-glance status

| Area | Current level | What still blocks production readiness |
| --- | --- | --- |
| Runtime and turns | Bounded local foundation with normalized lifecycle evidence, durable-record acknowledgement recovery, and terminal-event reconstruction across current action families | Full per-boundary crash matrix, durable lifecycle unification, concurrency, and replay semantics |
| TUI and approvals | Useful standalone interface | Full-screen workflow, richer navigation, reviewable approvals, accessibility, and recovery UX |
| Models and providers | Real OpenRouter path, provider registry, explicit model validation, capability metadata, bounded request/response/usage evidence, deterministic tests, and one local real-provider acceptance profile | Broader malformed-response fixtures, fallback policy, cost accounting, and credential-expiry operations |
| Workspace and filesystem | Broad local capability with journaled multi-file patch recovery | Transaction guarantees beyond `apply_patch_set`, races, large inputs, and isolation decision |
| Process execution | Bounded foreground local commands with approval, limits, durable-record validation, launch-failure cleanup, and restart cleanup for the detached foreground process group | Full process crash matrix, cross-platform process-tree proof, PTY/background jobs, resource/network isolation, and shell policy |
| Browser | Managed local Chromium capability | Profile/auth boundaries, crash recovery, artifact policy, browser lifecycle, and side-effect handling |
| Memory | Durable Markdown, local lexical retrieval, and bounded evidence maintenance | Mature retrieval, promotion, privacy, deletion, migration, backup/restore, and real-model acceptance |
| Skills and plugins | Planned boundaries only | Trust, manifests, permissions, isolation, lifecycle, and evidence |
| External integrations | Not implemented as a product layer | Credentials, retries, idempotency, webhooks, queues, and connector recovery |
| Durable jobs and delegation | Foreground turns only | Scheduling, leases, restart recovery, budgets, child-agent policy, and operator controls |
| Security and operations | Local policy and redaction controls | Threat model, OS/network isolation, auth, observability, backup, restore, release, and runbooks |
| Wider Lab integration | Separate UI integration is incomplete | Versioned runner API, shared events, reconnect, ownership, and non-terminal approvals |

## Maturity ladder

Every Computer Native area moves through the same ladder:

1. Planned: the boundary and acceptance criteria are written.
2. Slice-complete: the first bounded implementation is real and tested.
3. Integrated: the implementation works through the shared product lifecycle.
4. Hardened: the intended threat, failure, and load cases are tested and pass.
5. Operational: deployment, observability, migration, recovery, and support are ready.
6. Production-ready: the release gate passes and no required capability is being hidden
   behind a deferred-scope note.

The current completed plans are mostly level 2. Some shared paths have pieces of level
3. The product as a whole is not past level 2.

## Remaining product gaps

### 1. Runtime and turn lifecycle

Current state: the runtime can execute bounded local turns, dispatch implemented tools,
persist session evidence, and recover some incomplete local state.

Remaining work:

- Define the public turn, tool-call, approval, cancellation, and result contracts for
  long-lived use.
- Make admission, execution, persistence, cancellation, and finalisation explicit state
  transitions with durable identities.
- Define retry policy per operation. Do not retry side effects unless the operation has a
  documented idempotency key or a safe reconciliation path.
- Handle process restart during model requests, tool execution, approval, artifact
  writing, and final evidence writes.
- Bound concurrency, memory, output, request size, tool rounds, and total turn duration.
- Handle duplicate and out-of-order events without corrupting the session record.
- Support clean interruption from the terminal and from a future API client.
- Preserve provider-native diagnostics and normalized lifecycle evidence together.
- Add deterministic replay and an explicit “outcome unknown” state for ambiguous
  failures.

Exit evidence:

- State-machine and contract tests cover normal completion, cancellation, timeout,
  retry, crash, duplicate event, out-of-order event, and restart recovery paths.
- A fault-injection test can stop the process at each persistence and side-effect
  boundary and reconcile the result on restart.
- Current evidence covers acknowledgement loss after durable terminal-result, terminal-
  event, process, workspace-mutation, browser-action, and memory-action writes. Direct and
  runtime tests now also cover before/after memory canonical Markdown publication and
  deletion-evidence append boundaries. This is still narrower than the required full
  persistence/side-effect matrix because it does not stop before every write or at every
  underlying side-effect boundary.
- Current evidence also covers reconstruction of one missing terminal lifecycle event per
  action family. It does not yet prove reconstruction after a process-level crash at
  every write boundary or across all future action types.
- Current event-order evidence covers process, browser, and memory action lifecycles,
  including identity omission, skipped phases, post-terminal writes, and direct
  recovered-terminal reconstruction. Persisted model/tool round evidence also rejects
  unknown phases, invalid round starts, skipped round transitions, and tool completions
  whose call identity does not match their request. An identical retry of the immediately
  latest round record is now a no-op after acknowledgement loss; conflicting or later
  duplicate evidence still fails closed. Model request, attempt-completion, and retry
  evidence also requires exact attempt identity and a successful latest attempt before
  model completion. Memory-search evidence also rejects conflicting reuse of a `searchId`
  rather than silently replacing the recorded result set, and recovery repairs a missing
  `MemorySearched` event without replaying the search. It does not yet cover every
  persistence and underlying side-effect boundary.
- Current diagnostic-stop evidence covers model dispatch/response, terminal result/event
  writes, process approval before launch, process execution while running, workspace
  applying and committed-record boundaries, browser start and completion-record
  boundaries, memory canonical publication and deletion-evidence append boundaries,
  completed filesystem/browser/memory side effects, and a committed multi-file member
  boundary. It does not yet cover every individual persistence write or every possible
  host-side side-effect boundary.
- Current process crash evidence covers a completed-side-effect acknowledgement loss,
  a crash after a running record becomes durable, and an in-process launch-record
  acknowledgement failure. It does not yet cover every pre-write crash point,
  cross-platform process identity/process-group behaviour, or the complete host-level
  process-isolation story.
- Session locking now has Linux reused-PID and malformed-PID evidence, but it does not
  yet cover cross-platform identity, network filesystems, lock renewal, or durable turn
  leases. A session lock prevents competing application owners; it does not yet define
  concurrent turn scheduling inside a future long-running worker.
- Runtime admission now has direct evidence for concurrent provider non-dispatch,
  recovery exclusion while a turn is active, and re-admission only after recovery
  closes an orphaned turn. It does not yet cover queued work, fairness, durable worker
  leases, or deterministic replay.
- The runner reports at-most-once or at-least-once behaviour precisely. It does not claim
  exactly-once execution without proof.

### 2. TUI and approval experience

Current state: the standalone TUI has a useful transcript, model responses, activity
messages, approval handling, and Ctrl+C behaviour. It is still a small readline-style
interface rather than a mature terminal application.

Remaining work:

- Move to a deliberate alternate-screen/full-screen layout with a stable header,
  transcript viewport, composer, status line, and approval panel.
- Add scrolling, transcript search, multiline editing, history, paste handling, and
  visible streaming/progress states.
- Add command discovery and a command palette for help, model/session changes, memory,
  browser, process, workspace, diagnostics, and quit actions.
- Make approvals reviewable. Show the exact action, resolved target, scope, risk,
  limits, expiry, and the choices available. Keep approval bound to the exact prepared
  operation.
- Support keyboard navigation, focus indicators, resize, narrow terminals, `NO_COLOR`,
  screen-reader-friendly labels where the terminal permits them, and clean redraw after
  cancellation.
- Show unavailable capabilities honestly. Do not render fake tools, fake health, fake
  usage, or fake run data.
- Make errors actionable without leaking provider keys, cookies, command secrets, or
  memory content.
- Add session switching, transcript persistence, and a clear way to inspect artifacts
  and evidence.

Exit evidence:

- Manual acceptance covers idle Ctrl+C, active cancellation, approval accept/reject,
  resize, scrollback, long output, model failure, browser failure, process failure, and
  restart.
- TUI tests exercise the same typed runtime events used by the runner. They do not pass
  only because a separate mock renderer looks correct.

### 3. Model and provider layer

Current state: the real OpenRouter path works, a deterministic provider supports tests,
and local configuration can supply a default provider and model.

Remaining work:

- Extend fixtures for malformed response shapes, usage anomalies, and provider-native
  diagnostics without persisting unbounded response bodies.
- Decide whether product fallback is required beyond the current explicit no-fallback
  policy; if fallback is added, persist the decision and surface it in the TUI.
- Provide documented credential rotation and recovery when a local key is rotated,
  missing, or expired; rejected credentials now have a typed `provider-auth` outcome.
- [x] Normalize provider-reported input/output/total token usage into turn metrics and
  bounded evidence when supplied; missing usage is not estimated.
- Add cost accounting once the provider contract and pricing source are explicit. Cost
  remains `null` until that source and its versioning/retention rules are defined.
- [x] Add provider contract tests with deterministic local fixtures and complete a small
  real-provider acceptance profile. The acceptance uses a local key and never depends on
  a committed credential.

Delivered in the current foundation increment, but not yet sufficient for production:

- A built-in provider registry with capability metadata and explicit provider/model
  validation before admission.
- A read-only `/models` TUI view showing configured choices and declared capabilities;
  provider selection remains explicit at session start.
- Bounded request identifier and latency evidence on successful model attempts.
- Context-limit and refusal classifications, plus pre/post-output disconnect handling.
- Rejected-credential and malformed stream-shape contract fixtures for these cases.
- Observed request/output bytes, effective configured limits, provider latency, and
  provider-reported token usage are retained in bounded attempt/round/turn evidence;
  provider cost is deliberately not claimed.
- A documented acceptance run succeeded through the TUI with the configured OpenRouter
  model, including `/models`, an exact-response prompt, a read-only workspace listing,
  `/status`, one visible pre-output retry, and evidence inspection without a key.

Exit evidence:

- At least one real provider and the deterministic provider pass the same public contract
  tests.
- Provider failures have bounded, observable behaviour and do not hang a turn.
- The model chosen for a run is visible in evidence, and the product never silently
  falls back to a deterministic or fake response.

### 4. Workspace and local filesystem

Current state: the strongest local area. It has approval-gated reads and mutations,
separate writes, patch journaling, quarantine-backed deletion and restore, bounded
directory handling, policy checks, restart reconciliation, detailed records, and
normalized workspace lifecycle events in the turn evidence stream.

The current hardening increment also makes regular-file, search, mutation, copy, and
tree-manifest reads descriptor-backed and limit-enforced during consumption. A file that
grows after the initial metadata check cannot bypass the configured cap; changed-size
reads fail closed. Regular-file copy commits also stream into a temporary destination
while hashing and checking the approved source identity. Recovery manifests are capped
before JSON parsing and read through no-follow descriptors.

Remaining work:

- Extend the now-defined journal semantics beyond `apply_patch_set` if future operations
  need multi-file transactions. The current patch-set boundary reports partial or
  uncertain completion as `reconciliation-required`, preserves member hashes, and does
  not claim rollback or cross-file atomicity.
- Decide and document symlink, hard-link, device-file, socket, special-file, and mount
  behaviour. Fail closed for unsupported types.
- The first aggregate mutation limits are now implemented: directory-tree operations use
  entry/byte/depth bounds and multi-file patch sets enforce and record the configured
  `COMPUTER_NATIVE_MAX_PATCH_SET_BYTES` resulting-content cap before approval and commit.
  Tree operations also expose their observed total and effective byte ceiling in approval
  evidence. Remaining work is limited to any newly introduced multi-file operation, plus
  an OS-level immutable snapshot/file-handle contract; text reads and patch preparation
  still materialize bounded content where their contracts require it.
- Add race handling for changed files, concurrent writers, locks, and stale approvals.
- Add dry-run, diff/preview, restore, and reconciliation commands that remain useful
  after a crash.
- Define cross-platform behaviour for permissions, case sensitivity, path encoding,
  hidden files, and filesystem errors.
- Add an actual OS/container sandbox if the product promise requires containment. The
  current workspace root is a policy boundary, not an OS-level process sandbox.
- Add retention, export, and secure cleanup rules for quarantine and mutation journals.

Exit evidence:

- All required file operations have contract, integration, race, crash, recovery, and
  security tests.
- Multi-file failure tests show exactly what changed and how the user recovers.
- The documentation states the real filesystem guarantee for each supported platform.

### 5. Process and shell execution

Current state: approval-gated, bounded local foreground execution with exact argv,
working-directory policy, sanitized environment, timeout, output limits, cancellation,
and lifecycle evidence.

Remaining work:

- Add interactive stdin and PTY support, including resize and terminal signal handling,
  only if interactive commands are part of the product contract.
- Add managed background jobs with durable IDs, status polling, output logs, cancellation,
  cleanup, orphan detection, and restart recovery.
- Treat shell-language execution as a separate high-risk capability. Define quoting,
  expansion, pipelines, redirection, command substitution, and approval semantics before
  exposing it.
- Add container, remote, or other isolated execution adapters if the product needs more
  than local host execution.
- Enforce OS-level resource limits and network egress policy. A terminal approval alone
  is not a sandbox.
- Define executable identity, PATH policy, environment injection, secret handling, and
  privilege escalation rules.
- Add session-scoped grants only when their scope, expiry, revocation, and audit trail
  are explicit.
- Test retries, ambiguous termination, orphaned children, process-tree cleanup, and
  hostile output.

Exit evidence:

- The product clearly labels local host execution and its limits.
- Interactive, background, shell, and isolated execution are either implemented with
  the stated guarantees or explicitly excluded from the production product definition.
- Tests prove child cleanup after timeout, cancellation, launch acknowledgement failure,
  crash, and restart. Resource enforcement and cross-platform process-tree guarantees
  remain open.

### 6. Browser interaction

Current state: a managed local Chromium/Playwright capability with bounded snapshots,
navigation and interaction tools, approvals, dialog handling, artifacts, cancellation,
recovery, and local fixture acceptance.

Remaining work:

- Define supported browser backends and profiles. If personal Chrome/CDP, remote browser
  providers, extensions, or persistent profiles are needed, implement them as explicit
  adapters with different trust and lifecycle guarantees.
- Define authentication and credential boundaries. Do not make cookies, local storage,
  saved passwords, OAuth tokens, or CAPTCHA handling implicit.
- Add explicit policy for JavaScript evaluation, downloads, uploads, frames, popups,
  request interception, private addresses, localhost, and network egress.
- Bound page text, accessibility snapshots, screenshots, downloads, uploads, and artifact
  retention.
- Handle browser crashes, stale element references, navigation races, modal dialogs,
  disconnected sessions, duplicate submissions, and unknown outcomes after a network
  failure.
- Complete the browser artifact/profile crash matrix, including lock corruption,
  hard-kill data/metadata/temp-file states, and recovery across process restarts.
  Per-turn artifact-event recovery and bounded temp-file cleanup are now covered, but
  lock corruption, orphan cleanup after a pre-checkpoint stop, and profile/authentication
  policy remain incomplete.
- Pin and manage browser versions, launch flags, permissions, and cleanup.
- Add human-in-the-loop paths for CAPTCHA, MFA, payment, destructive submission, and
  other actions the agent must not silently complete.
- Define whether general search and extraction are part of browser interaction or belong
  to a separate external-integration capability.

Exit evidence:

- Real local-fixture tests cover navigation, interaction, downloads, dialogs, crash,
  cancellation, and ambiguous submission outcomes.
- Each supported profile documents its data access and isolation guarantee.
- No browser test relies on a developer's personal profile or undeclared credentials.

### 7. Memory and context lifecycle

Current state: bounded Markdown stores, a rebuildable local lexical index, explicit
approval-gated add/replace/remove operations, provenance, retention checks, operation-
specific recovery at canonical and deletion-evidence write boundaries, bounded deletion
and batch-evidence maintenance, operation-local action-history transition validation, and
a shared approval/cancellation path.

Remaining work:

- Add versioned migration procedures, operator repair tooling, and backup/restore rules
  for the deletion-evidence ledger and batch publication journals. The current local
  implementation repairs only a truncated final JSONL line, rejects other malformed
  records, deduplicates stable identities, expires completed entries, retains prepared
  deletion evidence, and fails closed when a safe retained set exceeds its bound.
- Replace the experimental `node:sqlite` dependency path with a supported persistence
  profile, or document and accept the runtime/version requirement for production.
- Add session and transcript search without mixing short-term history into compact
  bootstrap memory by accident.
- Add the retrieval quality needed by the product. This may include full-text search,
  hybrid ranking, semantic embeddings, or a hosted index, but each option needs a clear
  privacy and reproducibility decision.
- Implement the context-pressure lifecycle: pre-compaction flush, bounded summaries,
  dated notes, reviewable promotion, and recovery after interruption.
- Add explicit consolidation and forgetting workflows. Automatic promotion must have
  provenance, confidence, conflict handling, retention, and user review rules.
- Support scoped deletion previews, broad deletion, export, import, and index
  reconciliation without deleting unrelated transcripts.
- Define privacy boundaries for user, profile, workspace, session, and shared memory.
- Add migration tests for schema changes, partial index rebuilds, corrupted records, and
  interrupted writes.
- Add real-model acceptance tests that verify the model actually receives and uses the
  intended retrieved memory, while keeping the fixture deterministic enough to inspect.

Exit evidence:

- A restart or index rebuild cannot silently lose canonical memory or expose another
  scope.
- Retrieval, promotion, conflict, deletion, and retention behaviour are observable in
  evidence and covered by tests.
- The product has a documented privacy/export/delete story before memory is called
  production-ready.

### 8. Skills and plugins

Current state: the repository contains planned boundaries and documentation directories,
but Computer Native does not yet have a production skill or plugin system.

Remaining work:

- Define discovery, manifests, versions, compatibility, dependencies, and installation
  rules.
- Define trust policy, signing or verification, source provenance, review status, and
  rollback for third-party code and instructions.
- Separate skill instructions from executable plugin code. Treat both as untrusted input
  until their policy says otherwise.
- Define capability grants, approval requirements, secret access, filesystem scope,
  network scope, process scope, and resource limits.
- Isolate plugin failures, timeouts, crashes, malformed results, and dependency conflicts
  from the core agent.
- Record skill and plugin versions, inputs, outputs, approvals, and side effects in
  evidence.
- Add upgrade, downgrade, disable, uninstall, cache, and quarantine behaviour.

Exit evidence:

- A malicious, broken, incompatible, or unavailable extension cannot silently obtain
  broader access than its declared grant.
- Plugin and skill execution has deterministic lifecycle, timeout, cancellation, and
  audit tests.

### 9. External integrations and gateway behaviour

Current state: no production external-integration layer has been completed for Computer
Native.

Remaining work:

- Define connector contracts for outbound APIs, inbound webhooks, callbacks, and event
  sources.
- Implement credential storage, OAuth/token refresh, rotation, redaction, and scoped
  access. Development `.env` convenience must not become the production secret store.
- Define request timeouts, rate limits, retries, idempotency keys, pagination, response
  bounds, and partial failure handling for each connector.
- Authenticate and validate inbound events. Treat webhook bodies, email, documents, and
  remote content as untrusted instructions and data.
- Persist request and delivery state so an acknowledged or ambiguous operation can be
  reconciled rather than duplicated blindly.
- Add queue/backpressure behaviour, dead-letter handling, replay controls, and operator
  visibility.
- Keep connector-specific semantics and diagnostics. Do not flatten every service into a
  lowest-common-denominator tool result.

Exit evidence:

- Each connector has a threat model, contract tests, failure-injection tests, idempotency
  tests, and an operator recovery procedure.
- Secrets, tokens, inbound content, and provider responses meet the documented retention
  and redaction policy.

### 10. Durable jobs, scheduling, and delegated work

Current state: Computer Native is primarily a bounded foreground turn runner. Durable
background jobs, cron, scheduled work, and child-agent delegation are not complete
product capabilities.

Remaining work:

- Define durable job records, ownership, leases, attempts, heartbeats, deadlines, and
  cancellation.
- Add scheduler persistence, timezone and missed-run rules, deduplication, concurrency
  limits, and operator pause/resume controls.
- Define child-agent permissions, budgets, depth, tool grants, result contracts, and
  failure propagation before allowing delegation.
- Reconcile jobs after host, worker, provider, or external-service restart.
- Keep scheduled and delegated work visible in the same evidence model as foreground
  work.

Exit evidence:

- Crash, duplicate delivery, missed schedule, timeout, cancellation, and worker-restart
  tests pass without hidden duplicate side effects.
- Operators can find, stop, retry, and inspect every durable job.

### 11. Product integration boundary

Current state: the standalone Computer Native TUI is the current product surface. The
main Agent Harness Lab UI does not yet consume a complete Computer Native session,
approval, artifact, memory, browser, or process stream.

Remaining work for the wider Lab product:

- Define a versioned runner API and event schema shared by TUI and main UI clients.
- Stream turns, tool calls, approvals, progress, artifacts, errors, and final outcomes
  without creating a second runtime implementation.
- Make model, workspace, memory, browser, and process configuration visible through one
  explicit session configuration boundary.
- Preserve platform-specific evidence while exposing normalized lifecycle events.
- Define authentication, session ownership, access control, reconnect, and stale-client
  behaviour for a non-terminal client.

This work is a separate integration phase. It is not a reason to pretend the standalone
agent is already mature, and it must not duplicate the standalone runtime.

### 12. Security, privacy, and operations

Current state: the slices have local policy checks, approvals, redaction, bounded
outputs, and security tests. Those are useful controls, but they do not amount to a
complete production security or operations posture.

Remaining work:

- Write a threat model covering prompt injection, malicious files, hostile web content,
  command execution, credential theft, supply-chain compromise, data exfiltration, and
  denial of service.
- Define the trust boundary between model output, tool preparation, approval, execution,
  persistence, and external services.
- Add OS/container isolation, network egress control, and least-privilege execution for
  the deployment profile that claims production readiness.
- Establish secret management, rotation, redaction, retention, export, deletion, and
  incident-response procedures.
- Add authentication, authorization, tenancy/profile isolation, and audit policy if the
  product serves more than one trusted local user.
- Add structured logs, metrics, traces, health checks, and alerts for
  stuck work, provider failures, approval backlog, resource exhaustion, and persistence
  errors.
- Define backup, restore, migration, rollback, data-loss, and disaster-recovery targets.
- Pin dependencies, scan them, generate an SBOM, review licenses, and define release
  signing and provenance.

Exit evidence:

- The intended deployment has a reviewed threat model and tested controls.
- Operators can detect, stop, inspect, recover, and report a failed or suspicious run.
- A restore drill and upgrade/rollback drill have succeeded on representative state.

## Cross-cutting test and release gate

The approximately 88.86% current line coverage is a baseline metric, not the completion gate. Before
calling the product production-ready, the test programme must include the following:

### Contract and unit tests

- Public schemas, configuration validation, approval binding, redaction, path and URL
  policy, resource limits, and error classification.
- Normal completion, invalid input, cancellation, timeout, retry, and cleanup.
- Serialization and migration compatibility for every durable record.

### Integration tests

- Real local filesystem, process, browser, memory, and model-provider paths.
- TUI and API clients consuming the same runtime events.
- Provider and browser fixtures that fail deterministically and expose ambiguous outcomes.
- Evidence records, artifacts, logs, and redaction after each operation.

### Failure and recovery tests

- Crash before and after persistence.
- Crash before and after a side effect.
- Lost acknowledgement, duplicate request, retry, timeout, and out-of-order event.
- Worker restart, provider disconnect, browser crash, orphaned child, interrupted write,
  and corrupted index.
- Cancellation in idle, approval, model, tool, and cleanup states.

### Security tests

- Prompt injection in files, web pages, memory, skills, plugins, and integration payloads.
- Path traversal, symlink escape, private-network access, malicious downloads, hostile
  command output, secret leakage, oversized inputs, and resource exhaustion.
- Permission escalation, stale approval reuse, cross-scope memory access, and audit-log
  tampering.

### Load and compatibility tests

- Long-running sessions, concurrent sessions, large files, large outputs, many memory
  records, many browser tabs, and provider rate limits.
- Supported Node and OS versions, terminal sizes, locale/encoding cases, and clean
  environments without developer-specific state.
- Upgrade, downgrade, migration, backup, restore, and rollback.

### Manual acceptance

- A contributor can install dependencies with `pnpm`, configure a provider once for local
  development, run the TUI, use real model responses, approve safe and risky actions,
  cancel with Ctrl+C, restart after interruption, and inspect the resulting evidence.
- The manual flow does not require a developer to start hidden browser, server, or worker
  processes unless the documented profile explicitly requires them.
- The interface makes unavailable capabilities visible instead of simulating them.

## Production-ready definition

Computer Native may be called production-ready only when all of these statements are
true for a named deployment profile:

- Required product capabilities are implemented end to end. Deferred items are either
  outside the declared product contract or have their own completed plan.
- The runtime, TUI, model layer, tools, persistence, and evidence use one documented set
  of contracts.
- Every side effect has a clear approval, authorization, idempotency, cancellation,
  retry, recovery, and audit rule.
- The declared filesystem, process, browser, memory, skill, plugin, and integration
  guarantees are enforced by tests, not only by prompts or documentation.
- Secrets and private data have defined storage, redaction, retention, deletion, and
  export behaviour.
- Fault-injection, security, concurrency, load, cross-platform, migration, backup, and
  restore evidence exists for the deployment profile.
- Operators have logs, metrics, traces, health checks, alerts, runbooks, and a rollback
  path.
- The real-provider and real-side-effect acceptance flow succeeds without deterministic,
  fake, or hidden fallback behaviour.
- Documentation explains setup, configuration, limitations, failure recovery, and the
  exact guarantees. No completed plan is used to imply guarantees it explicitly deferred.

If one of these statements is false, the release status is “development” or “preview”,
not production-ready.

## Recommended implementation order

This register is comprehensive. It is not a request to implement every item in one
slice. The order below keeps later work from being built on weak contracts:

1. Harden the shared runtime, event contracts, persistence, cancellation, observability,
   and security threat model.
2. Finish the TUI and approval experience, then harden model/provider behaviour.
3. Decide the production execution profile and complete process isolation, PTY, and
   background-job requirements that profile needs.
4. Complete the filesystem transaction and large-input guarantees.
5. Complete browser profiles, authentication boundaries, artifacts, and crash recovery.
6. Bring memory to its full retrieval, compaction, provenance, privacy, and migration
   contract.
7. Add skills and plugins with trust, permissions, isolation, and lifecycle controls.
8. Add external integrations, gateway behaviour, scheduling, and delegated work.
9. Integrate the main Lab UI and run the release, backup, restore, and operational drills.

Each step must have an active implementation plan with a narrow scope, tests, security
and recovery semantics, documentation, and a completion gate. The next component can
start before the whole product is mature, but the product status must remain honest.

## References and adopted practice

These local references informed the boundaries and evidence requirements:

- [Computer Native completed plans](../completed/README.md)
- [Hermes code map](../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md)
- [TUI reference comparison](../../../docs/research/tui-reference-comparison.md)
- [Computer Native memory plan](../completed/computer-native-memory.md)
- [Computer Native process plan](../completed/computer-native-process-execution.md)
- [Computer Native browser plan](../completed/computer-native-browser-interaction.md)
- [Computer Native filesystem plan](../completed/computer-native-workspace-filesystem.md)

Hermes and OpenClaw are references for mature patterns such as explicit tool policy,
reviewable approvals, bounded outputs, durable memory roles, session evidence, and
operator-oriented terminal workflows. They are not a substitute for implementing and
testing the same guarantees in this repository.

## Completion gate for this register

This document remains active until the product has a named production profile and every
applicable gap has either:

- a completed implementation plan with validation evidence and no unresolved required
  behaviour, or
- a documented decision that the capability is outside the product contract.

At that point, create a completion record here with the release profile, validation
results, known limitations, and links to every completed workstream. Do not move this
document to `completed/` merely because the next slice is ready to start.
