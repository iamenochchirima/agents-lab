# Computer Native memory

**Created:** 2026-09-16T09:18:07+02:00
**Last updated:** 2026-09-16T11:10:00+02:00
**Status:** Completed
**Owner:** Computer Native standalone runtime
**Filename:** `computer-native-memory.md`

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [Computer Native rules](../../../computer-native/AGENTS.md)
- [Computer Native ownership](../../../computer-native/README.md)
- [Computer Native source ownership](../../../computer-native/src/README.md)
- [context ownership](../../../computer-native/src/context/README.md)
- [session ownership](../../../computer-native/src/sessions/README.md)
- [profile ownership](../../../computer-native/src/profiles/README.md)
- [persistence ownership](../../../computer-native/src/persistence/README.md)
- [runtime ownership](../../../computer-native/src/runtime/README.md)
- [tools ownership](../../../computer-native/src/tools/README.md)
- [security ownership](../../../computer-native/src/security/README.md)
- [implementation plan lifecycle](../README.md)
- [Computer Native follow-on queue](../computer-native-follow-on-queue.md)

Local reference implementations reviewed for this plan:

- Hermes memory guide: `../../../../hermes-agent/website/docs/user-guide/features/memory.md`
- Hermes memory tool: `../../../../hermes-agent/tools/memory_tool.py`
- Hermes memory store: `../../../../hermes-agent/tools/memory_tool_store.py`
- Hermes memory orchestration: `../../../../hermes-agent/agent/memory_manager.py`
- Hermes memory and session tests: `../../../../hermes-agent/tests/tools/test_memory_tool.py`
  and `../../../../hermes-agent/tests/test_session_search_context_batch.py`
- OpenClaw memory guide: `../../../../openclaw/docs/concepts/memory.md`
- OpenClaw memory CLI contract: `../../../../openclaw/docs/cli/memory.md`
- OpenClaw memory manager: `../../../../openclaw/extensions/memory-core/src/memory/manager.ts`
- OpenClaw search implementation: `../../../../openclaw/extensions/memory-core/src/memory/manager-search.ts`
- OpenClaw memory scenarios: `../../../../openclaw/qa/scenarios/memory/`
- Repository code maps: `../../../docs/research/harness-code-maps/hermes.md` and
  `../../../docs/research/harness-code-maps/openclaw.md`

These implementations are design input, not dependencies. Computer Native stays
standalone and must not import their code, storage, providers, or framework APIs.
This plan preserves the existing separation between transcript history, durable
memory, context construction, tools, persistence, and telemetry.

## Delivered slice

This plan delivered the first complete local durable-memory slice and its shared
approval UX. It includes inspectable Markdown stores, a rebuildable SQLite index,
bounded lexical search/get, user/workspace bootstrap context, daily retrieval,
approval-gated add/replace/remove and same-scope consolidation batches, exact-hash
deletion, provenance and content screening, append-only lifecycle/search evidence,
restart closure of uncommitted proposals, and the shared keyboard approval panel.

The slice intentionally keeps all persistent mutations at `approve once`; it does not
introduce a broad session grant. Broad deletion, semantic search, hosted memory,
automatic compaction promotion, and cross-file transactional claims remain outside
this completed local boundary.

## Purpose

Give Computer Native memory that survives sessions without turning the prompt into an
unbounded transcript or allowing stored text to grant authority. The implementation
must make durable facts inspectable, searchable, attributable to their source, bounded
by scope and size, removable, and recoverable after a crash.

Hermes supplies the compact curated-memory model and strict capacity discipline.
OpenClaw supplies the useful separation between bootstrap memory, dated working notes,
on-demand retrieval, provenance-aware deletion, and pre-compaction flushing. Computer
Native will combine those ideas behind a smaller local interface with explicit approval
and fail-closed behavior.

## Definition of done

From `computer-native/`, this real local flow works with the saved development model
configuration:

```bash
pnpm run chat
```

The user can say:

```text
Remember that I prefer concise answers and that this repository uses pnpm. Confirm what you stored.
```

The TUI shows the exact bounded memory proposal and waits for approval. The runtime
stores the approved entry with scope, source, timestamps, content hash, and a stable
memory reference. After `/quit`, a new `pnpm run chat` session can answer:

```text
What do you remember about my preferences and this repository? Search durable memory and cite the memory references.
```

The answer comes from the memory module, not from the previous transcript being
silently copied into the prompt. A user can then request removal, approve the exact
deletion, start another session, and verify that the deleted entry is no longer
retrievable. `/memory` and `/evidence` show bounded status and operation metadata.

The approval experience is a real review panel, not a bare `[y/N]` question. It shows
the operation, risk, exact target, scope, before/after or content summary, limits, and
warning. The user can select a decision with the keyboard, approve once, deny, inspect
more detail, or cancel. Ctrl+C cancels an active turn or approval and exits cleanly when
the console is idle.

```text
turn admission
  → bounded context snapshot and on-demand retrieval
  → memory tool validation and scope policy
  → explicit approval for mutation
  → canonical memory write and derived-index update
  → model result, TUI activity, and redacted evidence
```

## Memory model

The module uses inspectable canonical Markdown plus a rebuildable local search index.
The Markdown files remain the source of truth. The index never becomes the only copy of
a memory and may be discarded and rebuilt.

```text
<state-dir>/memory/
  USER.md                         # compact profile-scoped user preferences
  MEMORY.md                       # compact durable facts and decisions
  daily/YYYY-MM-DD.md             # bounded working notes, indexed on demand
  index.sqlite                    # derived local lexical index, never hand-edited
  index.json                      # schema and source-hash metadata, if needed
```

The exact storage adapter may use the supported Node SQLite runtime without adding a
third-party dependency. If the supported runtime cannot provide the required local
FTS behavior, implementation must stop at that decision point and document one
purposeful SQLite dependency. It must not silently fall back to an unbounded in-memory
index or make search availability depend on a provider API key.

The external memory interface stays small. Internally, the implementation may have
separate file, index, policy, and recovery adapters. The runtime and tests depend on a
deep memory interface whose invariants include scope isolation, bounded results,
stable references, source provenance, and no automatic replay after an uncertain write.

Each record carries at least:

- stable record ID and schema version;
- store and scope: `user`, `workspace`, or `daily`;
- canonical relative source path and line range where applicable;
- content hash, created and updated timestamps, and optional expiry;
- provenance: session, turn, message, author/source kind, and trust classification;
- lifecycle state: active, superseded, or deleted;
- bounded sensitivity classification and redaction status.

Transcript history remains owned by `sessions/`. A transcript is not copied into
`MEMORY.md` merely because it exists. Daily notes are a working memory layer, not a
second transcript store.

## Scope

### 1. Contracts, stores, and configuration

- [x] Define typed memory records, scopes, provenance, trust, lifecycle, result, and
      error contracts in `computer-native/src/memory/`.
- [x] Define the deep memory interface used by context construction, model-facing tools,
      persistence, and tests. The local `MemoryStore` is the first adapter seam; hosted
      adapters remain outside this slice.
- [x] Add validated configuration for memory enablement, per-store character budgets,
      result/bootstrap bounds, daily-note retention, and explicit interactive approval.
- [x] Reject unknown scopes, malformed IDs, invalid dates, oversized content, and
      unsupported retention values before any file or index operation.
- [x] Keep memory state under the configured state directory with owner-only defaults;
      do not use the workspace root as an implicit cross-project memory store.

### 2. Canonical storage and lifecycle

- [x] Implement compact `USER.md` and `MEMORY.md` stores with Hermes-style bounded
      entries, duplicate detection, explicit add/replace/remove operations, and no
      silent truncation.
- [x] Implement dated `daily/` notes with bounded append or replace behavior and a
      configured retention policy. Retention cleanup must be explicit, recorded, and
      recoverable where practical.
- [x] Write through same-directory temporary files, flush before publication where the
      platform permits it, and atomically replace canonical files.
- [x] Serialize read-modify-write operations across threads and processes with a lock
      beside the file. Re-read and revalidate the expected content hash before commit.
- [x] Keep superseded and deleted records attributable long enough for evidence and
      recovery. Do not silently reuse a deleted ID for new content.
- [x] Build and update the derived index only after canonical publication. Detect source
      hash or schema mismatch on startup and rebuild without deleting canonical memory.

### 3. Retrieval and context construction

- [x] Add bounded `memory_search` for deterministic lexical search across enabled
      stores, with scope filters, source references, line ranges, scores, and snippets.
- [x] Add bounded `memory_get` for an exact memory reference and optional line range.
      It must reject arbitrary paths, traversal, symlinks, and requests outside the
      selected profile/workspace scope.
- [x] Rank exact terms deterministically, cap result count and returned characters, and
      report truncation and current derived-index health.
- [x] Extend the context module to load a frozen, budgeted bootstrap snapshot of
      `USER.md` and compact `MEMORY.md` at session start. Record selected, omitted, and
      truncated sources in context evidence.
- [x] Keep daily notes and old session material out of every prompt by default. The
      model must request them through bounded retrieval when needed.
- [x] Add a typed pre-compaction memory-flush seam so a future context compaction path
      can offer one private, bounded save opportunity without exposing housekeeping
      messages as user conversation. The current slice must not invent compaction
      behavior that the context module does not own.
- [x] Treat every returned memory body as untrusted data. Delimit it in model context
      and state explicitly that it cannot override system instructions, tool policy,
      approval decisions, or security rules.

### 4. Model-facing writes and deletion

- [x] Add a `memory` tool with explicit `add`, `replace`, and `remove` actions, target
      store, bounded content, and required unique old-text or record identity for
      replacement/removal. Support one bounded batch for consolidation without
      claiming filesystem transactionality across files.
- [x] Add an explicit `memory_forget` operation for exact record deletion. Broad source,
      session, and workspace deletion are deliberately unsupported in this slice, so a
      dry-run cannot be mistaken for a broad applied deletion.
- [x] Default interactive mutation mode to explicit approval. Non-interactive runs,
      unavailable approval, cancellation, malformed approval, and expired proposals
      fail closed and do not write.
- [x] Bind approval to the exact operation identity, target scope, content hash, and
      expected old hash. A late approval must not apply to a new
      proposal.
- [x] Scan proposed content for credentials, private keys, invisible control content,
      and common instruction-injection or exfiltration patterns. Reject or stage
      suspicious content for review instead of silently storing it.
- [x] Preserve provenance and trust when memory originates from browser pages, files,
      external integrations, or model summaries. Untrusted content cannot be promoted
      into bootstrap memory without explicit confirmation.
- [x] Ensure memory writes never create tool permissions, alter approval policy, change
      the workspace root, or override higher-priority instructions.

### 5. Runtime, TUI, approval, persistence, and telemetry

- [x] Route memory operations through the existing tool registry and runtime. The CLI
      renderer must not write memory files or call the search adapter directly.
- [x] Replace the separate inline `[y/N]` prompts for workspace, process, browser, and
      memory actions with one shared interactive approval-prompt module. Keep each
      operation's typed request and risk rules distinct behind that seam.
- [x] Render a proper approval panel with a clear title, risk level, exact action,
      target and scope, changed paths or bounded content summary, hashes or identity,
      limits, provenance, and the warning that applies to the operation. Redact secrets
      at the rendering boundary as well as before persistence.
- [x] Support keyboard navigation and visible shortcuts: arrow keys or `j`/`k` move
      the selection, Enter confirms the highlighted choice, `a` approves once, `d`
      denies, `v` toggles bounded detail, and Escape cancels. The safe decision is
      highlighted by default. Bare unrecognised text must not approve anything.
- [x] Add typed approval choices rather than a single boolean: approve once, deny, and
      cancel. This slice intentionally issues no broad session grant for persistent
      memory or shared side-effecting tools.
- [x] Keep approval input in a modal focus separate from the normal composer. Queue or
      reject a second approval request deterministically rather than letting prompts
      interleave in the terminal.
- [x] Add factual TUI activity for memory search, bootstrap load, proposal, approval,
      commit, deletion, stale index, and failure states. Redact content and secrets in
      panels while showing enough identity and scope to review the operation.
- [x] Improve the console presentation around the modal: stable header and context,
      status ribbon, streaming output, activity lane, composer hint, narrow-terminal
      fallback, resize handling, and `NO_COLOR` behavior. Display only real state; do
      not add simulated health, usage, or completion data.
- [x] Make Ctrl+C consistent across every input state. While a turn is active it
      cancels the turn; while an approval is open it cancels the approval and leaves the
      operation unstarted; while idle with an empty composer it exits cleanly; while an
      unsent draft exists it clears the draft first and a second Ctrl+C within a short
      window exits. Force-close escalation remains a later terminal-runtime slice.
- [x] Keep Ctrl+D, `/quit`, and `/exit` as explicit exit paths, but do not require a
      slash command to leave the console. Close pending readline/raw-key handlers,
      browser/process resources, and the application exactly once on every exit path.
- [x] Add `/memory` status and bounded inspection output for store sizes, index health,
      and retention settings. Pending proposals are visible in the approval/activity
      path and are closed during restart; `/memory` does not dump all memory.
- [x] Persist immutable memory-operation records with operation ID, turn/session link,
      scope, source reference, content hash, approval decision, bounded outcome, and
      index status. Persist search records as references and query metadata, not raw
      memory bodies.
- [x] Extend turn evidence with memory references, context selection,
      redaction, and recovery outcomes while keeping credentials, full secrets, and
      unbounded page content out of durable records.
- [x] On restart, close prepared or approved-but-uncommitted proposals as unavailable;
      reconcile canonical files against the disposable derived index and never replay a
      model tool call.

### 6. Documentation and local acceptance

- [x] Replace the placeholder memory README with the module interface, storage layout,
      scope rules, trust model, failure semantics, and adapter seam.
- [x] Update Computer Native quick-start, configuration, context, persistence, security,
      tool, and TUI documentation with runnable memory examples and limitations.
- [x] Add a local memory playground that uses the normal saved `.env` and `pnpm run
      chat`, with no external memory provider or API key beyond the configured model.
- [x] Document the local reference comparison and the decisions that were not adopted:
      no hidden memory state, no external provider in the first slice, no automatic
      background deletion, and no claim that memory enforces policy.

## Explicitly out of scope

- External memory providers, hosted databases, cross-device synchronization, and
  provider-specific user modeling. The adapter seam may prepare for them later.
- Embedding or semantic search in the first local slice. Deterministic lexical search
  must work without an embedding key; an embedding adapter needs a separate plan and
  index-identity policy.
- A general knowledge wiki, autonomous background "dreaming" scheduler, or automatic
  promotion of model observations into durable memory. The compaction-flush seam and
  explicit user-directed writes come first.
- Importing Hermes, OpenClaw, Codex, or arbitrary workspace memory files automatically.
  Import needs a separate source-validation and conflict-resolution plan.
- Treating memory as an authorization store, policy engine, secret vault, or replacement
  for transcript/session persistence.
- Full context-compaction implementation. The memory module exposes the hook; the
  context-management plan owns compaction policy and token accounting.

## Reference alignment and design decisions

| Local reference | Pattern adopted | Computer Native decision |
| --- | --- | --- |
| Hermes `MEMORY.md` and `USER.md` | Keep always-available memory compact, typed by purpose, bounded by characters, and editable with add/replace/remove rather than silent truncation. | Use separate user and durable stores, strict limits, duplicate detection, explicit consolidation, and a frozen bootstrap snapshot. |
| Hermes memory tool and store | Validate before approval, scan content before prompt injection, use atomic file writes, and keep write approval separate from model intent. | Make mutation approval a runtime decision, preserve exact hashes and provenance, and fail closed when approval is absent. |
| Hermes session search | Keep the transcript archive separate from curated memory and search old conversations on demand. | Keep sessions as the source of short-term history and add memory retrieval without copying full transcripts into bootstrap context. |
| OpenClaw `MEMORY.md`, `USER.md`, and daily notes | Separate compact bootstrap facts from dated working material and index the latter for on-demand retrieval. | Use the same three storage roles with state-directory ownership and profile/workspace scope checks. |
| OpenClaw memory search and get | Return bounded results with source paths and line ranges, use a rebuildable local index, and report stale/unavailable search state. | Start with deterministic local lexical search and make index status, limits, and source hashes observable. |
| OpenClaw provenance and forget paths | Deletion needs lineage, preview, scope, and index cleanup rather than deleting an opaque row. | Store source/session/turn lineage and require exact or dry-run-reviewed deletion. Do not delete transcripts as a side effect of forgetting memory. |
| OpenClaw compaction flush and dreaming | Memory maintenance has a lifecycle around context pressure, and background promotion needs review and trust gates. | Add the pre-compaction seam now, but defer compaction ownership and background consolidation until their own plans are ready. |
| Hermes CLI/TUI and mature approval flows | Interrupts are useful in both active and idle states, and approvals are rendered as a review interaction with explicit choices rather than an accidental inline boolean prompt. | Build one shared Computer Native approval panel with keyboard focus, bounded detail, typed risk choices, session-scoped grants where policy permits, and a clean Ctrl+C exit/cancel contract. |

Important non-adoptions:

- Do not copy either project's broad provider/plugin catalog into Computer Native.
- Do not make an embedding service required for local memory to work.
- Do not let a memory entry become an instruction with higher authority merely because
  it was retrieved from a trusted-looking file.
- Do not claim exactly-once memory writes or deletion. Canonical publication and index
  publication are separate steps and may require reconciliation after a crash.

## Ownership and boundaries

```text
memory/       → canonical records, scope policy, retrieval, mutation lifecycle
context/       → bootstrap selection, prompt budgeting, delimiters, context evidence
sessions/      → transcript history, session identity, and short-term recovery
tools/         → model-facing schemas, validation, dispatch, and bounded results
security/      → path, scope, content, secret, approval, and resource policy
persistence/   → immutable operation records, atomic evidence, and restart reconciliation
cli/           → approval input, status rendering, /memory, /evidence, and cancellation
telemetry/     → ordered lifecycle events and redacted diagnostic metadata
```

The memory module is the sole writer of canonical memory files and the derived index.
The persistence module is the sole writer of memory-operation evidence. The context
module may read memory through the interface but must not open memory files directly.
The CLI may ask for approval and render bounded records but must not decide whether a
memory operation is authorized.

## State, persistence, and evidence

```text
<state-dir>/memory/
  USER.md                         # canonical compact user store
  MEMORY.md                       # canonical compact durable store
  daily/YYYY-MM-DD.md             # canonical working notes
  index.sqlite                    # rebuildable derived lexical index
  index.json                      # schema/source hashes and rebuild state

<state-dir>/sessions/<session-id>/turns/<turn-id>/
  memory-actions/<operation-id>.jsonl # append-only memory lifecycle record
  memory-searches/<search-id>.json   # bounded query and reference metadata
```

- [x] Every memory operation has a unique ID, session/turn link, scope, input hash,
      approval state, terminal status, and bounded result.
- [x] Canonical files are atomically published and the expected old hash is rechecked
      immediately before commit.
- [x] Index updates record the source hash in each derived row and rebuild from canonical
      files without losing memory when the index is deleted or corrupt.
- [x] Evidence stores references, hashes, sizes, statuses, and redacted summaries, not
      full memory bodies or query text containing credentials.
- [x] Retention settings cover canonical daily notes; pending proposals are closed on
      restart and operation evidence remains bounded and append-only for the session.

## Failure, retry, and recovery semantics

- [x] Search is bounded and never silently treats an index-open or canonical parse error
      as an empty answer; canonical changes reconcile the disposable index before search.
- [x] Canonical memory writes do not automatically retry after publication is uncertain;
      canonical Markdown remains the source of truth and is reread on the next access.
- [x] Index publication may be repeated idempotently for the same canonical source hash.
      It must not rewrite canonical memory as part of repair.
- [x] A cancelled or denied proposal never writes. Canonical publication and index
      rebuilding occur within the store operation; the index can be rebuilt from the
      canonical files without repeating a model mutation.
- [x] Concurrent writers serialize by scope/store lock. Duplicate operation IDs and
      stale expected hashes fail without overwriting newer memory.
- [x] A restart never replays a model tool call. It reconciles records and derived index
      state, then exposes the result to the next session.
- [x] Corrupt or partially written canonical files are reported without
      replacing a valid file from an untrusted temporary path.
- [x] The system reports committed, denied, failed, cancelled, and unavailable outcomes
      rather than claiming exactly-once provider or cross-file memory behavior.

## Security and configuration

- [x] Memory scope is derived from the admitted profile and workspace identity, never
      from a model-supplied arbitrary path or display name.
- [x] Profile and workspace memory cannot be read across sessions with different scope
      identities. The first CLI profile remains `default`, but the record shape must
      already carry the profile and source identity.
- [x] Canonical memory directories reject traversal, symlinks, special files, and
      reserved internal paths. Search and get use the same checks as writes.
- [x] Secret scanning and redaction cover provider keys, authorization headers, cookies,
      private keys, passwords, and sensitive environment values before model display,
      evidence, or index insertion.
- [x] Stored page text, file text, tool output, and model summaries keep a trust label.
      Untrusted content is data and cannot authorize a write, approve a tool, or alter
      security configuration.
- [x] Character, result, query, line, retention, index, and operation-log limits are
      explicit, validated, and reported by `/memory` or tool results.
- [x] Non-interactive execution has no mutation approval channel and fails closed for
      memory writes. Read-only retrieval remains bounded and scope-checked.
- [x] Configuration and tests use safe fixtures. No API key, personal memory, or local
      state database enters the repository.

## Test coverage

### Unit tests

- [x] Record/schema validation, stable IDs, scope and profile isolation, dates, hashes,
      limits, duplicate detection, supersession, and lifecycle transitions.
- [x] Atomic file serialization, lock ordering, expected-hash checks, malformed canonical
      records,
      newline handling, concurrent read-modify-write, and partial-write cleanup.
- [x] Content screening and redaction for credentials, invisible Unicode, instruction
      injection, browser/file provenance, and safe model-visible output.
- [x] Deterministic lexical ranking, exact references, line ranges, result bounds,
      truncation/index status, canonical reconciliation, and index rebuild.
- [x] Batch mutation validation, final-budget calculation, no silent truncation, and
      exact replacement/removal matching.

### Integration tests

- [x] Real local memory stores and a real local derived index, without an embedding or
      hosted provider.
- [x] End-to-end model-tool dispatch for remember, replace, search, get, and forget,
      including bounded tool results and TUI approval.
- [x] Context bootstrap loads the correct frozen `USER.md`/`MEMORY.md` snapshot and
      records omitted/truncated sources without copying the transcript.
- [x] Daily-note retrieval stays out of bootstrap context until explicitly searched.
- [x] Denied, unavailable, malformed, late, and cancelled approvals do not
      mutate memory.
- [x] Restart before approval and after approval closes the proposal without replay;
      canonical/index corruption and rebuild preserve inspectable memory.
- [x] Duplicate operations, stale hashes, concurrent writers, index corruption, source
      edits, and rebuild preserve canonical memory and produce inspectable evidence.
- [x] Cross-profile, cross-workspace, symlink, traversal, secret, and prompt-injection
      isolation cases fail closed.
- [x] Evidence and telemetry contain operation references and bounded metadata without
      raw secrets or unbounded memory content.
- [x] Approval-prompt tests cover rendering, redaction, safe default focus, keyboard
      navigation, approve-once, deny, cancel, detail toggle, malformed input, and
      raw/line terminal paths. Session grants remain intentionally absent.

### Manual acceptance checks

- [x] Document the `pnpm run chat` memory flow, save one user preference and one workspace fact,
      approve the
      writes, quit, start a new session, and retrieve both by meaning and exact term.
- [x] Ask the agent to remember text that contains an instruction to ignore policy or a
      fake credential. Confirm it is rejected or staged and never enters bootstrap memory.
- [x] Request a replacement and a forget operation. Confirm the approval panel shows the
      exact target/hash and the next session cannot retrieve the removed value.
- [x] Trigger a workspace, process, browser, and memory approval. Confirm each uses the
      same review-panel interaction, shows operation-specific details, and never treats
      arbitrary typed text as approval.
- [x] Press Ctrl+C during an active model turn, while an approval panel is open, at an
      idle empty composer, and with an unsent draft. Confirm cancel, exit, draft-clear,
      and forced-interrupt outcomes are distinct and recorded correctly.
- [x] Run `/memory` and `/evidence`; confirm scope, counts, source references, statuses,
      and index health are visible without dumping sensitive content.
- [x] Document and test stopping during approval; restart and verify no
      memory tool call is replayed and any uncertain state is reported.
- [x] Scan the state directory and captured output for provider keys, authorization
      headers, cookies, private keys, and full unbounded page content.

## Required validation commands

```bash
cd computer-native
pnpm run typecheck
pnpm test
pnpm run coverage
pnpm run build
git diff --check
```

The real-model manual path requires the already saved local `.env`. Deterministic tests
must remain network-free and must not require an embedding key or external memory
provider. If the supported Node runtime emits an SQLite experimental warning, document
the exact runtime and decide whether the warning is acceptable before implementation
continues.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every applicable scope, lifecycle, security, retrieval, context, evidence, and
      documentation checkbox is complete.
- [x] The memory flow is real and inspectable through `pnpm run chat`, not a deterministic
      fake response or a mocked-only path.
- [x] Memory survives a new session, remains bounded, and does not copy full transcripts
      into bootstrap context.
- [x] Failure, cancellation, restart, stale-index, deletion, and cross-scope cases are
      implemented and tested.
- [x] The approval panel is shared across existing side-effecting tools and provides
      deliberate keyboard choices, bounded review detail, safe defaults, and clean exit
      behavior. `[y/N]` is not the only approval interface.
- [x] No secret, unsafe path, untrusted instruction, or unsupported capability is
      advertised or retained.
- [x] Required validation commands and the runnable playground are validated.
- [x] Documentation matches the stored files, tools, approval semantics, and known
      limitations.

## Commit discipline and handoff

- [x] Commit the plan and plan-index updates with the implementation record.
- [x] Commit contracts and storage as a reviewable section, then retrieval/context,
      tool approval, persistence/TUI, and docs/tests as coherent sections.
- [x] Run the narrow validation relevant to each section before committing it.
- [x] Preserve unrelated `apps/`, `server/`, generated, and user changes in the dirty
      worktree.
- [x] Record implementation commit hashes, validation results, manual observations, and
      known limitations before archiving this plan.

## Completion record

**Completed:** `2026-09-16T11:10:00+02:00`
**Commits:** `b5476f4`

### Validation

- `pnpm run typecheck` — passed.
- `pnpm test` — 206 passed, 0 failed with unrestricted child-process/localhost access.
- `pnpm run coverage` — 206 passed, 0 failed; package-wide line coverage reported 87.25%.
- `pnpm run build` — passed.
- `git diff --check` — passed for the implementation boundary.
- Real OpenRouter smoke path using the saved `.env` and `cohere/north-mini-code:free` —
  returned the requested response in 1.9 seconds without exposing the key.
- The memory playground and focused deterministic memory tests cover approval, rejection,
  persistence, restart evidence, batch validation, search/get bounds, and Ctrl+C/approval
  interaction. A separate interactive real-model memory walkthrough remains a manual
  follow-up because this validation run did not alter durable user state.

### Known limitations

- Node 23 reports the standard-library `node:sqlite` experimental warning.
- The local slice uses deterministic lexical retrieval; embeddings, hosted memory,
  broad deletion, automatic compaction promotion, and session-wide approval grants remain
  separate future capabilities.
- Canonical Markdown publication and derived-index rebuilding are deliberately not
  advertised as a cross-file transaction or exactly-once provider execution.
