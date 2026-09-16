# Computer Native memory

**Created:** 2026-09-16T09:18:07+02:00
**Last updated:** 2026-09-16T09:18:07+02:00
**Status:** Active
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

- [ ] Define typed memory records, scopes, provenance, trust, lifecycle, result, and
      error contracts in `computer-native/src/memory/`.
- [ ] Define the deep memory interface used by context construction, model-facing tools,
      persistence, and tests. Keep file and index adapters behind that seam.
- [ ] Add validated configuration for memory enablement, per-store character/byte
      budgets, maximum result count, maximum returned characters, daily-note retention,
      index deadlines, and mutation approval mode.
- [ ] Reject unknown scopes, malformed IDs, invalid dates, oversized content, and
      unsupported retention values before any file or index operation.
- [ ] Keep memory state under the configured state directory with owner-only defaults;
      do not use the workspace root as an implicit cross-project memory store.

### 2. Canonical storage and lifecycle

- [ ] Implement compact `USER.md` and `MEMORY.md` stores with Hermes-style bounded
      entries, duplicate detection, explicit add/replace/remove operations, and no
      silent truncation.
- [ ] Implement dated `daily/` notes with bounded append or replace behavior and a
      configured retention policy. Retention cleanup must be explicit, recorded, and
      recoverable where practical.
- [ ] Write through same-directory temporary files, flush before publication where the
      platform permits it, and atomically replace canonical files.
- [ ] Serialize read-modify-write operations across threads and processes with a lock
      beside the file. Re-read and revalidate the expected content hash before commit.
- [ ] Keep superseded and deleted records attributable long enough for evidence and
      recovery. Do not silently reuse a deleted ID for new content.
- [ ] Build and update the derived index only after canonical publication. Detect source
      hash or schema mismatch on startup and rebuild without deleting canonical memory.

### 3. Retrieval and context construction

- [ ] Add bounded `memory_search` for deterministic lexical search across enabled
      stores, with scope filters, source references, line ranges, scores, and snippets.
- [ ] Add bounded `memory_get` for an exact memory reference and optional line range.
      It must reject arbitrary paths, traversal, symlinks, and requests outside the
      selected profile/workspace scope.
- [ ] Rank exact terms and path/store matches deterministically, cap result count and
      returned characters, and report when results were truncated or the index is stale.
- [ ] Extend the context module to load a frozen, budgeted bootstrap snapshot of
      `USER.md` and compact `MEMORY.md` at session start. Record selected, omitted, and
      truncated sources in context evidence.
- [ ] Keep daily notes and old session material out of every prompt by default. The
      model must request them through bounded retrieval when needed.
- [ ] Add a typed pre-compaction memory-flush seam so a future context compaction path
      can offer one private, bounded save opportunity without exposing housekeeping
      messages as user conversation. The current slice must not invent compaction
      behavior that the context module does not own.
- [ ] Treat every returned memory body as untrusted data. Delimit it in model context
      and state explicitly that it cannot override system instructions, tool policy,
      approval decisions, or security rules.

### 4. Model-facing writes and deletion

- [ ] Add a `memory` tool with explicit `add`, `replace`, and `remove` actions, target
      store, bounded content, and required unique old-text or record identity for
      replacement/removal. Support one bounded batch for consolidation without
      claiming filesystem transactionality across files.
- [ ] Add an explicit `memory_forget` operation for exact record, source, session, or
      workspace-scoped deletion. It must provide a dry-run preview before a broad
      deletion and require a fresh approval for the applied deletion.
- [ ] Default interactive mutation mode to explicit approval. Non-interactive runs,
      unavailable approval, cancellation, malformed approval, and expired proposals
      fail closed and do not write.
- [ ] Bind approval to the exact operation identity, target scope, content hash,
      expected old hash, and resulting size. A late approval must not apply to a new
      proposal.
- [ ] Scan proposed content for credentials, private keys, invisible control content,
      and common instruction-injection or exfiltration patterns. Reject or stage
      suspicious content for review instead of silently storing it.
- [ ] Preserve provenance and trust when memory originates from browser pages, files,
      external integrations, or model summaries. Untrusted content cannot be promoted
      into bootstrap memory without explicit confirmation.
- [ ] Ensure memory writes never create tool permissions, alter approval policy, change
      the workspace root, or override higher-priority instructions.

### 5. Runtime, TUI, persistence, and telemetry

- [ ] Route memory operations through the existing tool registry and runtime. The CLI
      renderer must not write memory files or call the search adapter directly.
- [ ] Add factual TUI activity for memory search, bootstrap load, proposal, approval,
      commit, deletion, stale index, and failure states. Redact content and secrets in
      panels while showing enough identity and scope to review the operation.
- [ ] Add `/memory` status and bounded inspection output for store sizes, index health,
      pending proposals, and retention settings. Do not dump all memory by default.
- [ ] Persist immutable memory-operation records with operation ID, turn/session link,
      scope, source reference, content hash, approval decision, bounded outcome, and
      index status. Persist search records as references and query metadata, not raw
      memory bodies.
- [ ] Extend `/evidence` and turn evidence with memory references, context selection,
      redaction, and recovery outcomes while keeping credentials, full secrets, and
      unbounded page content out of durable records.
- [ ] On restart, close prepared or approved-but-uncommitted proposals as unavailable;
      reconcile committed canonical files against the derived index; mark an uncertain
      delete or index publication for inspection rather than replaying it.

### 6. Documentation and local acceptance

- [ ] Replace the placeholder memory README with the module interface, storage layout,
      scope rules, trust model, failure semantics, and adapter seam.
- [ ] Update Computer Native quick-start, configuration, context, persistence, security,
      tool, and TUI documentation with runnable memory examples and limitations.
- [ ] Add a local memory playground that uses the normal saved `.env` and `pnpm run
      chat`, with no external memory provider or API key beyond the configured model.
- [ ] Document the local reference comparison and the decisions that were not adopted:
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
  memory-actions/<operation-id>.json  # one immutable memory lifecycle record
  memory-searches/<search-id>.json   # bounded query and reference metadata
```

- [ ] Every memory operation has a unique ID, session/turn link, scope, input hash,
      approval state, terminal status, and bounded result.
- [ ] Canonical files are atomically published and the expected old hash is rechecked
      immediately before commit.
- [ ] Index updates record the source hash and schema identity. An index can be deleted
      and rebuilt from canonical files without losing memory.
- [ ] Evidence stores references, hashes, sizes, statuses, and redacted summaries, not
      full memory bodies or query text containing credentials.
- [ ] Retention settings cover canonical daily notes, derived index entries, pending
      proposals, and operation evidence separately.

## Failure, retry, and recovery semantics

- [ ] Search may retry only bounded read-only index-open or transient read failures. A
      stale or unavailable index returns a typed result and never silently returns an
      empty answer as if no memory existed.
- [ ] Canonical memory writes do not automatically retry after publication is uncertain.
      Startup compares source hashes and operation records, then reports reconciliation
      required when it cannot prove the result.
- [ ] Index publication may be repeated idempotently for the same canonical source hash.
      It must not rewrite canonical memory as part of repair.
- [ ] A cancelled or denied proposal never writes. Cancellation after canonical
      publication but before index publication produces a durable committed-memory,
      index-pending result and schedules bounded repair, not a second memory write.
- [ ] Concurrent writers serialize by scope/store lock. Duplicate operation IDs and
      stale expected hashes fail without overwriting newer memory.
- [ ] A restart never replays a model tool call. It reconciles records and derived index
      state, then exposes the result to the next session.
- [ ] Corrupt or partially written canonical files are quarantined or reported without
      replacing a valid file from an untrusted temporary path.
- [ ] The system reports `committed`, `denied`, `failed`, `cancelled`, `stale`, or
      `reconciliation_required` rather than claiming exactly-once behavior.

## Security and configuration

- [ ] Memory scope is derived from the admitted profile and workspace identity, never
      from a model-supplied arbitrary path or display name.
- [ ] Profile and workspace memory cannot be read across sessions with different scope
      identities. The first CLI profile remains `default`, but the record shape must
      already carry the profile and source identity.
- [ ] Canonical memory directories reject traversal, symlinks, special files, and
      reserved internal paths. Search and get use the same checks as writes.
- [ ] Secret scanning and redaction cover provider keys, authorization headers, cookies,
      private keys, passwords, and sensitive environment values before model display,
      evidence, or index insertion.
- [ ] Stored page text, file text, tool output, and model summaries keep a trust label.
      Untrusted content is data and cannot authorize a write, approve a tool, or alter
      security configuration.
- [ ] Character, byte, entry, result, query, line, retention, index, and operation-log
      limits are explicit, validated, and reported by `doctor` or `/memory`.
- [ ] Non-interactive execution has no mutation approval channel and fails closed for
      memory writes. Read-only retrieval remains bounded and scope-checked.
- [ ] Configuration and tests use safe fixtures. No API key, personal memory, or local
      state database enters the repository.

## Test coverage

### Unit tests

- [ ] Record/schema validation, stable IDs, scope and profile isolation, dates, hashes,
      limits, duplicate detection, supersession, and lifecycle transitions.
- [ ] Atomic file serialization, lock ordering, expected-hash checks, malformed UTF-8,
      newline handling, concurrent read-modify-write, and partial-write cleanup.
- [ ] Content screening and redaction for credentials, invisible Unicode, instruction
      injection, browser/file provenance, and safe model-visible output.
- [ ] Deterministic lexical ranking, exact references, line ranges, result bounds,
      stale-index status, source-hash invalidation, and index rebuild.
- [ ] Batch mutation validation, final-budget calculation, no silent truncation, and
      exact replacement/removal matching.

### Integration tests

- [ ] Real local memory stores and a real local derived index, without an embedding or
      hosted provider.
- [ ] End-to-end model-tool dispatch for remember, replace, search, get, and forget,
      including bounded tool results and TUI approval.
- [ ] Context bootstrap loads the correct frozen `USER.md`/`MEMORY.md` snapshot and
      records omitted/truncated sources without copying the transcript.
- [ ] Daily-note retrieval stays out of bootstrap context until explicitly searched.
- [ ] Denied, unavailable, expired, malformed, late, and cancelled approvals do not
      mutate memory.
- [ ] Crash/restart before approval, after approval, after canonical publication, and
      during index update produces the documented recovery status without replay.
- [ ] Duplicate operations, stale hashes, concurrent writers, index corruption, source
      edits, and rebuild preserve canonical memory and produce inspectable evidence.
- [ ] Cross-profile, cross-workspace, symlink, traversal, secret, and prompt-injection
      isolation cases fail closed.
- [ ] Evidence and telemetry contain operation references and bounded metadata without
      raw secrets or unbounded memory content.

### Manual acceptance checks

- [ ] Start `pnpm run chat`, save one user preference and one workspace fact, approve the
      writes, quit, start a new session, and retrieve both by meaning and exact term.
- [ ] Ask the agent to remember text that contains an instruction to ignore policy or a
      fake credential. Confirm it is rejected or staged and never enters bootstrap memory.
- [ ] Request a replacement and a forget operation. Confirm the approval panel shows the
      exact target/hash and the next session cannot retrieve the removed value.
- [ ] Run `/memory` and `/evidence`; confirm scope, counts, source references, statuses,
      and index health are visible without dumping sensitive content.
- [ ] Stop the process during approval and during an index update. Restart and verify no
      memory tool call is replayed and any uncertain state is reported.
- [ ] Scan the state directory and captured output for provider keys, authorization
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

- [ ] Every applicable scope, lifecycle, security, retrieval, context, evidence, and
      documentation checkbox is complete.
- [ ] The memory flow is real and inspectable through `pnpm run chat`, not a deterministic
      fake response or a mocked-only path.
- [ ] Memory survives a new session, remains bounded, and does not copy full transcripts
      into bootstrap context.
- [ ] Failure, cancellation, restart, stale-index, deletion, and cross-scope cases are
      implemented and tested.
- [ ] No secret, unsafe path, untrusted instruction, or unsupported capability is
      advertised or retained.
- [ ] Required validation commands and manual acceptance checks pass.
- [ ] Documentation matches the stored files, tools, approval semantics, and known
      limitations.

## Commit discipline and handoff

- [ ] Commit the plan and plan-index updates before implementation begins.
- [ ] Commit contracts and storage as a reviewable section, then retrieval/context,
      tool approval, persistence/TUI, and docs/tests as coherent sections.
- [ ] Run the narrow validation relevant to each section before committing it.
- [ ] Preserve unrelated `apps/`, `server/`, generated, and user changes in the dirty
      worktree.
- [ ] Record implementation commit hashes, validation results, manual observations, and
      known limitations before archiving this plan.
