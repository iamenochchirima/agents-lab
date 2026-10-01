# Lina context management

**Created:** 2026-09-17T16:03:59+02:00
**Last updated:** 2026-09-17T21:51:42+02:00
**Status:** Completed
**Owner:** Lina standalone product
**Completed:** 2026-09-17T21:51:42+02:00

## Start here

Read these before changing code:

- [repository rules](../../../../AGENTS.md)
- [Lina rules](../../../../lina/AGENTS.md)
- [context ownership](../../../../lina/src/context/README.md)
- [runtime ownership](../../../../lina/src/runtime/README.md)
- [persistence ownership](../../../../lina/src/persistence/README.md)
- [security ownership](../../../../lina/src/security/README.md)
- [skills ownership](../../../../lina/src/skills/README.md)
- [memory ownership](../../../../lina/src/memory/README.md)
- [Lina package commands](../../../../lina/package.json)
- [documentation rules](../../../../docs/contributing/documentation.md)

Reference maps reviewed for this plan:

- [Hermes code map](../../../../docs/research/harness-code-maps/hermes.md)
- [OpenClaw code map](../../../../docs/research/harness-code-maps/openclaw.md)
- [platform context-management plan](../../platforms/completed/context-management.md)

The reference implementations are design input, not dependencies. Hermes and OpenClaw
both keep resource loading, history, budgeting, and compaction close to turn execution.
Lina should adopt those responsibilities without copying their product-specific
prompt files, provider fallbacks, or plugin model.

## Purpose

Build the first complete Context Management module for standalone Lina. It will produce
the exact bounded model input for each turn, explain where every instruction or message
came from, preserve a stable snapshot across retries and tool rounds, and compact older
conversation material before a request becomes unsafe.

Context is not a string helper. It is the module that decides which instructions,
workspace resources, skills, memory, history, and tool descriptions the model may see.
Security policy, approval decisions, and the runtime's action rules remain authoritative
outside model-provided context.

## Current implementation status

The first vertical slice is now implemented in the working tree:

- `ContextManager.prepare` assembles the system instruction, root workspace resources,
  compact skill summaries, bounded memory, transcript history, prompt, and tools in a
  deterministic order.
- Resource metadata records identity, trust, hash, byte counts, and omission or
  truncation reasons. Workspace reads still go through the existing workspace policy.
- Older transcript messages compact into a labelled deterministic summary when the
  request exceeds its configured byte limit. Complete older transcript-turn groups are
  compacted into bounded escaped role/turn/content snippets marked as untrusted data;
  the current prompt and two newest transcript turns remain.
- The bounded history selector admits complete recent persisted turns, so a message
  count limit cannot leave an orphaned user or assistant message.
- Credential-shaped workspace, skill, and memory content is redacted before provider
  assembly. Context evidence remains content-free, and its token field is explicitly a
  conservative UTF-8 estimate rather than a provider-token claim.
- `context.json` and optional `compaction.json` publish bounded evidence before the
  provider. Identical snapshot publication is idempotent and raw source bodies are not
  written to evidence.
- Runtime retries and tool rounds reuse the prepared context prefix. `/context` exposes
  the latest snapshot and its source and budget decisions.
- Later model requests compact only complete older runtime tool exchanges when their
      serialized request exceeds the configured bound. The request-local projection emits
      `ContextRoundCompacted` evidence and never rewrites canonical turn records.
- A pre-output provider context-window rejection now triggers at most one deterministic
      request-local recovery revision. Optional context sources are omitted without
      rereading them; the successor snapshot is archived with a predecessor link. A
      second rejection is terminal `provider-context` and never retries the same request.
- `ContextPrepared`, `ContextCompacted`, and `ContextPressure` lifecycle events are
  ordered and idempotent by snapshot identity; round projections additionally use their
  round identity. Pre-provider cancellation is terminalized without publishing a model
  request.
- Compaction is request-local and bounded by a dedicated deadline. Async compactors
  receive cancellation, and cancellation or deadline expiry happens before snapshot
  publication.
- Snapshot reads and writes check the admitted turn's session, provider, and model
  identity before accepting or projecting evidence.
- Each snapshot now carries canonical, recomputable source and compaction revision digests;
  persistence validates those digests, source references, message ordering, and
  compaction shape before accepting evidence. Restart recovery validates a durable
  context snapshot before classifying an interrupted turn; it never replays the
  provider request. Snapshot publication retries recover both staged predecessor
  archives and companion compaction evidence after an acknowledgement is lost.
- When the serialized request remains over its configured byte limit after history
  compaction, deterministic source admission omits optional groups in the documented
  priority order (memory, skills, `AGENTS.md`, `USER.md`, `IDENTITY.md`, `SOUL.md`).
  Each omission is recorded as `request-budget`; the system instruction, current
  prompt, registered tool definitions, and selected transcript groups are preserved.
- A request that fits only after this lossy source-admission step is marked
  `pressure: "compaction_due"`, so durable lifecycle evidence and `/context` expose
  the adaptation instead of reporting a misleading normal-pressure result.
- Compaction records now include the observed serialized request bytes before and after
      the adaptation, and `ContextCompacted` plus `/context` expose that transition.
- Raw-key approval panels now transfer TTY ownership away from readline while a decision
      is active, so approval keys cannot contaminate the next composer prompt. A denied
      process produces one terminal non-started lifecycle observation rather than a
      conflicting duplicate completion event.

Focused verification currently present in `lina/tests/context-management.test.ts`:

- source precedence, trust/provenance, deterministic ordering, and bounded resources;
- explicit untrusted workspace-data labelling and preservation of the runtime-owned tool
  definition contract;
- end-to-end proof that untrusted workspace instructions cannot start a process without
  the existing approval channel;
- end-to-end proof that untrusted workspace instructions cannot change the configured
  process output limit after the normal approval channel allows the command;
- the actual OpenRouter adapter receiving the same prepared messages and tool contract
  as the deterministic adapter, with only provider wire mapping differing;
- UTF-8 byte-based token estimate metadata and unknown provider-window reporting;
- deterministic transcript compaction with bounded untrusted role/turn/content snippets,
  summary-byte admission, invalid-adapter rejection, and
  removed/retained message evidence;
- redacted provider input, idempotent snapshot publication, and model identity checks;
- redacted configured instruction, workspace, skill, memory, transcript, and prompt
  input, with content-free persisted evidence;
- publication before provider invocation, retry prefix reuse, symlink rejection, and
  invalid-UTF-8 omission;
- ordered, idempotent context lifecycle events, injected token-counter metadata, and
  cancellation before provider transport;
- complete-group runtime tool-round projection and its bounded lifecycle evidence.
- preflight and provider-overflow compaction budget transitions, persisted validation,
  durable event propagation, and bounded TUI rendering.
- cancellation-aware compaction and a bounded compaction deadline;
- provider-overflow recovery, successor snapshot publication, and bounded revision-chain
  evidence.
- snapshot publication acknowledgement-loss recovery at the predecessor-archive and
  active-snapshot boundaries, including canonical digest validation after restart.
- bounded live TUI activity for context preparation, compaction, and pressure outcomes.
- runtime cancellation during compaction, proving the turn is terminalized without a
  provider request or partially published snapshot.
- bounded workspace resource-read cancellation during context preparation, proving the
  runtime stops before provider transport or snapshot publication.
- skill discovery cancellation, proving traversal and bounded `SKILL.md` reads propagate
  cancellation instead of silently classifying the interrupted skill as skipped.
- new-turn resource refresh, proving a changed workspace resource produces a new
  snapshot and source revision while retries continue to reuse their original one.
- complete persisted transcript-turn history selection under the message bound, proving
  the newest exchange is not split into an orphaned user or assistant message.
- source admission under a bounded total request, proving lower-priority optional
  sources are omitted with evidence while the system, prompt, tool contract, and
  higher-priority workspace identity sources remain available.
- runtime source-admission pressure, proving the final request can fit after an
  optional omission while the snapshot and durable `ContextPressure` event still
  report `compaction_due`.
- live raw-TTY approval denial, proving a workspace instruction cannot start a process,
  the composer remains usable after the decision, and the durable process evidence has
  exactly one terminal completion with no start or output.
- denied-process lifecycle idempotency, proving the normal tool completion callback does
  not append a second terminal `ProcessCompleted` event after the approval boundary.

The first-slice implementation requirements are now implemented and tested. Persisted
transcript-turn grouping, request-local complete assistant/tool grouping, one
provider-overflow recovery revision, both first-slice snapshot-publication
acknowledgement boundaries, and the owning-turn retention policy are included. Semantic
summaries, provider-specific tokenizer implementations, runtime-level compaction
failure injection, and broader race/load/chaos coverage remain later maturity work
recorded in the production-readiness gap register; they are not silently being counted
as complete for this slice.

## Definition of done (completion target)

The following describes the target for closing this plan. It is the acceptance target
for this first operational slice; later maturity work remains outside this plan and is
tracked in the production-readiness gap register.

From `lina/`, a contributor can place workspace resources such as `SOUL.md`,
`IDENTITY.md`, `USER.md`, and `AGENTS.md` in a test workspace, then run:

```bash
pnpm run chat
```

The first model request contains a deterministic, labelled context assembled from the
configured system instruction, supported workspace resources, the compact skill
catalog, bounded memory, prior transcript, current prompt, and the registered tool
definitions. The user can type `/context` to inspect the source list, selected byte and
token estimates, omitted sources, and compaction status without seeing unredacted
context content in the terminal.

If the context is near its configured limit, the runtime compacts eligible older
conversation groups before sending the request. The compaction record and final context
snapshot are persisted with the turn. A provider retry and each tool round reuse that
snapshot. A restart never silently rebuilds or resends an interrupted provider request.

```text
turn admission
  → resource resolution and precedence
  → bounded context assembly
  → durable context snapshot
  → model attempt and tool rounds
  → context evidence and TUI projection
```

The completion gate is satisfied only when a real provider turn and deterministic tests
use the same context interface. A fixed slice of recent messages, an unlabelled prompt
prefix, or a client-calculated token percentage does not satisfy this plan.

## Scope

### Context contract and source model

- [x] Define a versioned context interface for a prepared turn, context snapshot,
      source metadata, budget, omissions, and compaction records.
- [x] Give each source a stable kind, identity, trust label, content hash, byte count,
      selection status, and reason when omitted. Keep source metadata separate from
      model message content.
- [x] Define the supported first resource set: built-in system instruction,
      workspace `SOUL.md`, `IDENTITY.md`, `USER.md`, and `AGENTS.md`, compact skill
      summaries, bounded user/workspace memory, transcript history, current prompt, and
      registered tool definitions.
- [x] Define first-slice grouping rules so messages from one persisted transcript turn
      are not separated during compaction, and keep later assistant/tool exchanges
      together in request-local round projections.
- [x] Keep the interface small. Callers ask the Context Management module to prepare a
      turn and inspect its latest projection; they do not assemble prompt strings.

### Resource discovery and precedence

- [x] Add a workspace resource resolver that reads only approved relative resource
      paths through the existing workspace policy. Reject traversal, outside paths,
      symlinked resources, and invalid UTF-8; bound files above the per-source limit
      and record them as `truncated` rather than silently sending their full content.
- [x] Establish and document precedence. The built-in system instruction and security
      rules are authoritative. Workspace identity and operating guidance, skills,
      memory, history, and user content are labelled data or procedure and cannot
      change tool permission, approval, isolation, or runtime policy.
- [x] Load each supported resource class at the correct lifecycle point and preserve
      the source path, hash, and bounded content length in the snapshot metadata.
- [x] Include a compact skill catalog by default. Load complete skill text only after
      the model requests an exact skill ID through the existing read-only tool.
- [x] Keep memory retrieval behind the Memory module. Context selects bounded records;
      it does not search, mutate, consolidate, or reinterpret memory itself.
- [x] Make resource ordering deterministic and keep the stable system prefix unchanged
      during a session unless the context policy explicitly records a new revision.

### Budgeting and assembly

- [x] Add a context budget policy with source-specific limits, total request limits,
      reserved output space, recent-message limits, and a clear unknown-window state.
- [x] Add a token-counter seam. Use a model-specific tokenizer only when its basis is
      known. Otherwise report a conservative estimate and its quality instead of
      presenting invented precision.
- [x] Assemble labelled sections with explicit delimiters and provenance. Prevent
      resource text from being confused with system policy or tool authority.
- [x] Select sources in deterministic priority order. Record every omission, truncation,
      or budget decision instead of silently dropping content.
- [x] Admit the complete serialized request against the total byte limit after history
      compaction. Omit only optional source groups in the documented fixed priority
      order, preserve required system/prompt/tool messages, and record each omission
      with `reason: "request-budget"`.
- [x] Preserve the current prompt and required system/tool contract messages whenever
      the request can fit. Fail before provider transport when it cannot.
- [x] Report `compaction_due` when request-budget source omission was required, even
      when the final serialized request is below the byte limit.
- [x] Keep model request byte accounting and context token estimates separate. The
      snapshot records serialized request bytes, message-input bytes, and the estimate
      independently; provider-specific context-window admission remains open.

### Snapshots, compaction, and lifecycle

- [x] Prepare one immutable context snapshot before the first provider attempt. Retries
      and later tool rounds use the same snapshot identity and resource revision.
- [x] Add deterministic preflight compaction for eligible old persisted transcript
      turns. Keep system instructions, the active user turn, and the two newest
      transcript turns intact. Later runtime assistant/tool-call/result exchanges are
      compacted request-locally as complete groups; canonical turn evidence is unchanged.
- [x] Record what first-slice compaction removed, summarized, or retained, including
      message and transcript-group IDs, and persist the observed request bytes before
      and after the adaptation.
- [x] Use an explicit compaction adapter seam so a later model-based summarizer can be
      added without changing turn callers. This slice must ship with one bounded,
      deterministic implementation.
- [x] Treat provider overflow as a typed context-pressure outcome. Permit one bounded
      recovery preparation when policy allows it, then fail clearly instead of retrying
      an unchanged oversized request.
- [x] Ensure cancellation observed during context preparation stops before provider
      transport; cancellation after transport follows the existing runtime/provider
      semantics. Mid-read cancellation remains bounded to the existing workspace
      operation semantics.

### Persistence, evidence, and recovery

- [x] Persist the context snapshot and compaction record under the owning session/turn,
      with one writer and atomic publication before the provider request.
- [x] Persist redacted model-visible context evidence with source identities, hashes,
      selected content bounds, message ordering, budget, and compaction revision.
- [x] Never persist provider credentials, arbitrary environment data, or unbounded raw
      resource contents. Preserve hashes and bounded redacted projections for inspection.
- [x] Validate snapshot ownership, session/turn identity, model identity, message
      ordering, source references, source hashes, and per-snapshot source/compaction
      revision digests before reuse.
- [x] Maintain a prior-revision chain across successive recovery snapshots. The active
      snapshot links to and archives its immediate predecessor; only one recovery
      revision is permitted in this slice.
- [x] On acknowledgement loss or restart, recover the durable snapshot and classify the
      turn without replaying the provider request. The first slice accepts a staged
      predecessor archive or an already-replaced active snapshot, repairs missing
      companion compaction evidence on an identical retry, and validates the chain when
      reopened. A new user turn receives a new snapshot.
- [x] Make identical snapshot publication retries idempotent and reject conflicting
      reuse of a snapshot identity.

### Runtime, provider, and TUI integration

- [x] Route every standalone Lina model request through the Context Management module.
      Remove prompt construction from the runtime turn loop once the new interface is
      connected.
- [x] Keep tool execution, approvals, process/browser actions, and memory mutations
      behind their existing modules. Context may describe these capabilities but never
      authorizes them.
- [x] Add `/context` to the TUI. Show the active snapshot, source counts, budget,
      pressure, compaction, and omission reasons. Do not print raw instruction or
      memory content by default.
- [x] Render context preparation, compaction, and context-pressure outcomes through
      typed durable runtime events without inventing token accuracy or provider state.
      The TUI also projects these events as bounded live activity. Later round
      projections use `ContextRoundCompacted` with snapshot and round identity.
- [x] Keep the existing `/skills`, `/memory`, `/status`, and model views consistent with
      the context projection.

## Explicitly out of scope

- Remote resource downloads, model-generated resource installation, skill script
  execution, dynamic tool registration, or plugin loading.
- Semantic skill activation, automatic skill ranking, or loading every skill body into
  every request.
- New memory search, memory storage, consolidation, or promotion algorithms.
- Provider-specific fallback selection, multi-model arbitration, or a claim of exact
  token counts when the provider window is unknown.
- Full-screen terminal redesign, alternate-screen rendering, remote sessions, and the
  future Agent Harness Lab UI integration.
- OS sandboxing, network egress controls, or authentication changes. Context must obey
  those policies, not implement them.
- Exhaustive chaos, load, race, cross-platform, and long-running operational tests.
  The focused core checks below are required now; the broader maturity matrix remains
  in the Lina production-readiness gap register.

## Finished behaviour

### User-visible behaviour

On a normal turn, the model receives the same ordered context that the runtime records
for that turn. Workspace resources and memory are visibly labelled as untrusted data or
procedure. A resource cannot instruct the model to bypass approval, alter a security
limit, execute a skill file, or claim an action that the runtime did not perform.

When context pressure occurs, the TUI reports whether the runtime retained, compacted,
or rejected the request. `/context` reports source names, hashes, sizes, budget quality,
compaction revision, and omission reasons. It does not expose raw secrets or dump all
prompt contents into the terminal.

### Ownership and boundaries

```text
Context Management module  → resource selection, precedence, budgeting, assembly,
                             snapshots, compaction, and context projections
Workspace and Memory modules → safe resource reads and bounded memory retrieval
Runtime                      → turn admission, provider attempts, tool rounds, and events
Persistence                  → atomic snapshot/evidence publication and validation
Security and approvals       → authority, path policy, redaction, and side-effect gates
TUI                          → human-readable inspection of typed context state
```

The Context Management module is the sole writer for context snapshot and compaction
records. The runtime owns in-flight provider attempts. Workspace and Memory remain the
sole writers for their own data. No resource loader may call a provider, execute a tool,
or make an approval decision.

## State, persistence, and evidence

Use the owning turn directory already used by Lina sessions:

```text
<session-directory>/turns/<turn-id>/
  context.json          # immutable prepared snapshot and bounded projection metadata
  compaction.json       # optional compaction record and source revisions
  events.jsonl          # normalized context-prepared/compacted/pressure events
```

- [x] Each snapshot has a unique identity, owning session/turn, model, source hashes,
      message ordering, budget, and creation time.
- [x] Snapshot publication completes before the first provider request.
- [x] Snapshot retries with identical content are no-ops; conflicting identity reuse
      fails closed.
- [x] Source content is represented in evidence by content-free bounded metadata and a
      content hash. Secrets and unbounded file contents are excluded.
- [x] Retention follows the owning session/turn evidence lifetime. Context evidence is
      inspectable without granting access to the original workspace files, and the
      context module does not independently purge or silently delete snapshots. The
      first slice has no public session-evidence deletion operation; any future deletion
      must be owned by persistence and operate on a complete evidence boundary.
- [x] Context-specific events retain native details while fitting the normalized
      lifecycle event model. The events are durable and idempotent, and the TUI projects
      their bounded live activity without printing raw context.

## Failure, retry, and recovery semantics

- [x] Resource discovery failure for the required system instruction fails the turn
      before provider transport with a typed context error. The supported workspace
      resources are optional in this slice and are omitted only with an omission record.
- [x] Invalid, oversized, or symlinked optional resources are omitted with a bounded
      reason. A malformed resource never becomes executable instruction or policy.
- [x] Provider retries reuse the same context snapshot and do not reread changed files
      or memory records during the same turn.
- [x] Compaction runs before provider transport and has a dedicated bounded
      operation/deadline. The default synchronous compactor is deterministic; custom
      async compactors receive cancellation and cannot publish a snapshot after
      cancellation or deadline expiry.
- [x] A provider overflow is not retried unchanged. The runtime prepares the one
      permitted recovery snapshot or returns a typed context-pressure failure.
- [x] Cancellation before snapshot publication prevents provider transport. Workspace
      and skill resource reads also stop cooperatively between bounded I/O operations;
      later cancellation uses the existing model/tool side-effect rules.
- [x] Restart does not replay an interrupted provider request. Durable context evidence
      is validated before recovery classifies the turn and preserves the exact prior
      request projection.
- [x] Duplicate, foreign, or conflicting snapshots are rejected at the current
      session/turn/provider/model boundary. The prior-revision chain and first-slice
      acknowledgement-loss recovery are validated; broader crash/race testing remains
      open.
- [x] No context behavior is described as exactly once. Snapshot publication is
      idempotent for identical records; provider execution keeps its existing semantics.

## Security and configuration

- [x] Validate positive source, total-context, reserved-output, and history limits at
      context-manager construction with safe local defaults. The first slice also has
      a bounded five-second compaction deadline; a separately configurable compaction
      budget remains open.
- [x] Read resources only through the workspace policy. Reject absolute paths,
      traversal, symlink targets, invalid UTF-8, and files beyond configured limits.
- [x] Treat workspace resources, skills, memory, transcript content, and tool results as
      untrusted model input. Delimit and label them so they cannot override system
      policy or approval requirements.
- [x] Keep credentials out of context sources, snapshots, TUI output, and evidence.
      Apply the existing known-secret and credential-shape redaction before provider
      assembly and at persistence and terminal boundaries. Child-process environment
      handling remains owned by the process/security modules.
- [x] Keep model/tool schemas in the runtime-owned tool registry. Context text cannot
      add a tool or broaden its arguments.
- [x] Document behaviour when a provider reports no usable context window. The runtime
      uses bounded transport checks and records `contextWindowTokens: null` rather than
      fabricating a remaining percentage.
- [x] Document local setup and the real-provider prerequisite in the provider-acceptance
      and context-management playgrounds. The deterministic provider remains an explicit
      test adapter, not a silent fallback.

## Implementation checklist

### 1. Contracts and configuration

- [x] Add context source, budget, snapshot, compaction, omission, and projection types.
- [x] Add validated context limits without duplicating existing model/tool limits.
- [x] Define first-slice context-specific lifecycle events and persistence validation
      rules, including acknowledgement-loss recovery at snapshot publication boundaries.

### 2. Core implementation

- [x] Replace the current prompt builder with a deep Context Management module whose
      caller provides session/turn inputs and receives one prepared snapshot.
- [x] Implement resource resolution, source precedence, labels, hashes, and bounded
      deterministic assembly.
- [x] Implement token estimation, byte admission, grouped persisted-history selection,
      one deterministic preflight compaction path, and complete runtime tool-round
      grouping for later request projections.
- [x] Implement immutable snapshot publication, idempotent reuse, a prior-revision
      archive chain, canonical revision digests, and first-slice restart
      acknowledgement-loss/identity/shape checks.

### 3. Integration and user surface

- [x] Connect runtime model attempts and tool rounds to the prepared snapshot.
- [x] Connect existing memory bootstrap and Skills catalog selection through the new
      context interface.
- [x] Add `/context`, typed durable context events, honest context-pressure messages,
      and bounded live context activity in the TUI.
- [x] Add a short standalone context-management walkthrough under
      `development/playground/lina-context-management/`.

### 4. Documentation and learning material

- [x] Update `lina/src/context/README.md` with source classes, precedence, budgets,
      snapshots, compaction, and known limits.
- [x] Update runtime, persistence, security, memory/skills boundary notes, and CLI
      documentation where their context ownership or commands change.
- [x] Add an architecture note or diagram showing source resolution, snapshot
      publication, provider attempts, and compaction ownership.
- [x] Keep the follow-on queue and production-readiness gap register accurate.

## Test coverage

### Unit and contract tests

- [x] Validate source identities, trust labels, hashes, bounded sizes, and omission
      reasons.
- [x] Verify precedence and delimiters across system, identity, workspace, skill,
      memory, history, and user sources.
- [x] Verify deterministic ordering and stable system-prefix behavior.
- [x] Verify token estimate quality, byte limits, reserved output, unknown-window
      handling, and explicit context-pressure errors.
- [x] Verify grouped persisted-history and runtime tool-round selection preserve
      required messages and record what was removed. Semantic summarization remains
      open.
- [x] Reject traversal, absolute paths, symlinks, and invalid UTF-8; bound and classify
      oversized resources; and reject malformed snapshot data, foreign identities,
      conflicting snapshot identities, and mismatched source/compaction revision digests,
      including after staged or active publication acknowledgement loss.
- [x] Verify untrusted resource text remains explicitly labelled and cannot change the
      runtime-owned tool definitions or bypass process approval.
- [x] Verify untrusted resource text cannot change security limits or other runtime
      authority through end-to-end model/tool attempts.
- [x] Verify redaction excludes credentials from snapshots, evidence, errors, and TUI
      projections.
- [x] Verify a persisted context snapshot remains available after reopening its owning
      session; no context-only cleanup runs behind the caller's back.

### Integration tests

- [x] A deterministic model and the real provider adapter receive the same prepared
      context contract, with provider-specific transport differences kept in adapters.
- [x] A real model turn includes workspace resources, compact skill metadata, bounded
      memory, transcript history, current prompt, and registered tools in the declared
      order.
- [x] A model tool round reuses the turn snapshot, does not reread changed resources,
      and compacts only complete older runtime exchanges when required.
- [x] Context pressure compacts eligible history or fails before provider transport with
      a typed result.
- [x] `/context` reports the actual snapshot and budget projection without raw content.
- [x] A resumed session uses canonical transcript state and creates a new snapshot for
      the new turn.

### Failure-injection and recovery tests

- [x] Inject snapshot publication acknowledgement loss at predecessor-archive and active
      snapshot publication boundaries. Verify identical retry is idempotent, missing
      companion compaction evidence is repaired, and the reopened chain validates.
- [x] Interrupt before provider send and after snapshot publication; verify no provider
      replay occurs during recovery.
- [x] Interrupt during bounded compaction and verify the turn reports an honest cancelled
      outcome without a provider request or partially published snapshot.
- [x] Exercise provider overflow recovery once and reject an unchanged repeated
      overflow.
- [x] Add an end-to-end cancellation test while resource preparation is in flight. The
      workspace and skill reads check cancellation at bounded I/O boundaries, and the
      runtime test verifies no provider request or context snapshot is published.

### Manual acceptance checks

- [x] In a throwaway workspace containing each supported resource file, run `pnpm run
      chat` with the configured real provider and ask the model to summarize which
      instructions and skills it received.
- [x] Use `/context` and verify the source list, hashes, sizes, budget quality, and
      omission/compaction state match the model request evidence.
- [x] Change a resource after one turn, start a second turn, and verify only the second
      snapshot reflects the change.
- [x] Create an oversized or malformed resource and verify it is omitted or rejected
      according to its required/optional classification.
- [x] Place an instruction in a workspace resource asking to bypass approval. Verify
      the model cannot perform an approval-gated action without the existing approval.
- [x] Inspect session evidence and verify provider keys, raw secrets, and unbounded
      resource contents are absent.

## Required validation commands

```bash
cd lina
pnpm run typecheck
pnpm run build
node --test --test-concurrency=1 dist/tests/context*.test.js
node --test --test-concurrency=1 dist/tests/lina.test.js dist/tests/skills.test.js
pnpm test
git diff --check
```

The real-provider manual check requires the stored local Lina development
configuration. Deterministic fixtures must cover the same context contract without
silently standing in for the real provider. Exhaustive load, race, cross-platform, and
chaos checks remain later production reinforcement.

## Validation status for the current slice

Completed on 2026-09-17:

- `pnpm run typecheck` — passed.
- `pnpm run build` — passed.
- `node --test --test-concurrency=1 dist/tests/context-management.test.js` — 36 passed.
- `node --test --test-concurrency=1 dist/tests/context-management.test.js dist/tests/lina.test.js` — 220 passed.
- `pnpm test` — 395 passed, 0 failed.
- `git diff --check` — passed.

The latest verification also asserts that provider-overflow compaction's observed
before/after request bytes are identical in the persisted snapshot and its durable
`ContextCompacted` event. The TUI projection test verifies the same transition remains
visible as one bounded budget row.

These results verify the current first context slice, bounded total-request source
admission, a fresh resumed-session snapshot,
one bounded provider-overflow recovery revision, request-local runtime-round projection,
per-snapshot revision validation, live context activity, and snapshot publication
acknowledgement-loss recovery, plus runtime cancellation during workspace resource
reading and compaction before provider transport or snapshot publication. A real-provider
acceptance run also completed against the stored OpenRouter configuration using
`cohere/north-mini-code:free`: one turn loaded
all four workspace resources, compact skill metadata, bounded memory, the current
prompt, and registered tools; a resumed turn additionally included transcript history.
The run completed successfully, used the real `openrouter` provider, and its evidence
contained no provider key material. The focused runtime test also verifies that a new
turn rereads changed workspace resources while retry requests keep the original
prepared context. The first-slice acceptance checks are complete. Semantic
summarization, provider-specific tokenizer implementations, runtime-level compaction
failure injection, and broader maturity tests are explicitly later work in the
production-readiness gap register, not missing acceptance checks for this completed
first-slice validation.

Manual acceptance completed against throwaway workspaces on 2026-09-17 using the
stored OpenRouter development configuration. The real model confirmed receipt of all
four workspace resources; an edited `SOUL.md` was visible on the resumed turn;
interactive `/context` showed the latest snapshot, source hashes, byte accounting,
and omission state; and a bounded evidence scan found no provider-key or bearer-token
patterns. A deterministic CLI run then recorded an oversized `SOUL.md` as bounded
`truncated` content and invalid-UTF-8 `USER.md` as `unreadable` omission. Finally, the
real model was given a workspace instruction asking it to bypass approval: the TUI
showed the structured process review, denial left the process unstarted, the next
composer prompt remained clean, `/quit` worked, and durable evidence contained one
`ProcessCompleted` with `process-approval-denied` and no `ProcessStarted`.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every applicable scope and implementation checkbox is complete.
- [x] The model request is assembled by the Context Management module and has a durable
      snapshot identity.
- [x] Source precedence, trust labels, limits, omissions, and compaction are explicit
      in the context contract and evidence.
- [x] Retries, tool rounds, cancellation, provider overflow, and restart recovery obey
      the snapshot semantics.
- [x] `/context` exposes factual, bounded state without raw secret leakage.
- [x] Focused unit, integration, recovery, security, and manual acceptance checks pass.
- [x] Documentation, examples, queue status, and production gap register match reality.

## Commit discipline and handoff

- [ ] Commit the context contract and source policy separately from runtime integration
      where practical.
- [ ] Keep persistence/recovery changes with their context evidence tests.
- [ ] Keep TUI changes with `/context` rendering tests and documentation.
- [x] Review `git status` and each diff before committing. Preserve unrelated work.
- [x] Record exact validation commands, manual observations, changed files, commit
      hashes, and known limitations before archiving the plan.

## Completion record

**Completed:** `2026-09-17T21:51:42+02:00`
**Commits:** None created; the implementation remains in the shared working tree because
no commit was requested in this task.

The commit-specific checklist above remains unchecked deliberately. The shared worktree
contains unrelated user changes, so this slice was verified and archived without
creating a commit that could capture work outside its boundary.

### Validation

- `pnpm run typecheck` — passed.
- `pnpm run build` — passed.
- `pnpm test` — 395 passed, 0 failed.
- `git diff --check` — passed.
- Real-provider manual acceptance — passed with the stored OpenRouter configuration;
  `/context`, resource refresh, bounded/malformed resource handling, approval denial,
  clean composer recovery, and evidence redaction were observed.

### Known limitations

- The first slice uses deterministic transcript compaction and conservative UTF-8 token
  estimates; semantic summaries and provider-specific tokenizers remain future work.
- Context evidence follows the owning session/turn lifetime. There is no public
  session-evidence deletion or independent context purge command yet.
- Broader race, load, cross-platform, chaos, and operational testing remains in the
  production-readiness gap register.
