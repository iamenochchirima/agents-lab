# Anesu workspace and filesystem capability

**Created:** `2026-09-15T16:34:52+02:00`
**Last updated:** `2026-09-15T16:34:52+02:00`
**Status:** Complete
**Owner:** Anesu

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [Anesu rules](../../../anesu/AGENTS.md)
- [Anesu ownership](../../../anesu/README.md)
- [tools ownership](../../../anesu/src/tools/README.md)
- [workspace ownership](../../../anesu/src/workspace/README.md)
- [security ownership](../../../anesu/src/security/README.md)
- [turn lifecycle](../../../anesu/docs/turn-lifecycle.md)
- [implementation plan lifecycle](../README.md)
- [completed workspace-actions slice](./anesu-workspace-actions.md)
- [write-tool and approval comparison](../../../docs/research/write-tool-approval-comparison.md)

Primary external references:

- [OpenClaw tool policy and `apply_patch`](https://github.com/openclaw/openclaw/blob/main/docs/tools/exec.md)
- [OpenClaw permission requests](https://github.com/openclaw/openclaw/blob/main/docs/plugins/plugin-permission-requests.md)
- [Hermes write approval and pending store](https://github.com/NousResearch/hermes-agent/blob/main/tools/write_approval.py)
- [Hermes TUI guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/tui.md)

These references are design input, not dependencies. Anesu remains standalone
and must not import Hermes, OpenClaw, or Agent Harness Lab runtime code.

## Component boundary

This plan covers the **Anesu workspace and filesystem capability**. It is the
local-computer boundary that lets the standalone agent inspect and change files under one
configured workspace root. It includes workspace policy, model-facing tools, approval,
filesystem commits, quarantine, persistence, recovery, TUI presentation, and tests.

It does not cover the rest of the harness. Shell and process execution, browser control,
memory, skills, plugins, external integrations, subagents, and remote workspaces need
separate plans.

## Purpose

Finish one complete, security-reviewed local workspace capability. A contributor should
be able to inspect files, make approved single-file and multi-file changes, manage
directories, copy and move regular files, recover deleted content, and understand what
happened after denial, cancellation, stale state, failure, or restart.

The destructive lifecycle is implemented as a separate, bounded path from the existing
empty-only `delete_directory`: directory-tree deletion, manifest-backed restoration, and
exact-token permanent quarantine cleanup. The empty-only operation remains unchanged.

## Definition of done

From `anesu/`, the following standalone flow works with the configured model:

```bash
npm run chat
```

The agent can use the read-only tools immediately. For a mutation, it prepares a bounded
operation-specific preview, persists the proposal, waits for explicit approval, rechecks
the expected state, commits through the workspace module, persists the outcome, and
returns a bounded model-visible result. A restart reconciles incomplete records without
silently replaying an ambiguous filesystem operation.

The complete category is finished when all eight layers below have passing contract,
security, recovery, evidence, TUI, documentation, and manual acceptance checks.

```text
model tool call
  → tool validation and workspace policy
  → read-only execution or in-memory mutation preparation
  → bounded preview and durable proposal
  → explicit approval when a side effect is requested
  → expected-state revalidation
  → workspace commit or journal
  → durable outcome, evidence, and model-visible result
```

## Eight implementation layers

### 1. Workspace inspection

- [x] `list_directory` returns stable, bounded entries and hides internal recovery data.
- [x] `read_file` reads bounded UTF-8 text without escaping the workspace.
- [x] `stat` returns bounded type, size, timestamps, mode, and link-count metadata.
- [x] `search_files` supports bounded literal content and relative name-pattern search,
      cancellation, and hidden/generated/sensitive/symlink/binary skip rules.
- [x] `list_quarantine` exposes bounded recovery metadata and restore tokens without
      returning quarantined content or enabling purge.
- [x] Inspection tools reject traversal, unsafe symlink paths, invalid input, oversized
      requests, and unbounded output.

### 2. Single-file mutations

- [x] `write_file` prepares a complete creation or replacement with a bounded diff,
      before/after hashes, size checks, and mode handling.
- [x] `apply_patch` supports one exact Add or Update operation with deterministic context
      matching, UTF-8 rules, bounded diffs, and stale-content rejection.
- [x] Preparation performs no write before approval.
- [x] Approved content commits through a same-directory temporary file, flush, and atomic
      rename where the platform provides those semantics.
- [x] Commit failures preserve known original content and produce typed failure evidence.
- [x] Unsupported delete, move, binary, traversal, absolute, duplicate, and multi-file
      patch forms fail at the appropriate parser, workspace, or tool boundary.

### 3. Directory operations

- [x] `mkdir` creates one directory only when its parent already exists.
- [x] Existing directories are explicit idempotent results, not hidden mutations.
- [x] `delete_directory` deletes only an existing empty directory after approval.
- [x] Empty-directory deletion rejects the workspace root, non-empty directories, and
      races where an entry appears after preparation.
- [x] Add bounded recursive tree preflight with entry, byte, and depth limits.
- [x] Add `delete_directory_tree` as a separate operation that stages a tree in
      quarantine. It must never turn the existing empty-only operation into recursive
      deletion.
- [x] Add `restore_directory` using an exact recovery token and an absent destination.

### 4. Regular-file lifecycle

- [x] `delete` moves one regular file into workspace-local quarantine after approval.
- [x] `restore` uses the returned token, verifies the recorded hash, and refuses to
      overwrite an existing path.
- [x] `copy` uses source hashes, an absent destination, staged output, and no replacement.
- [x] `move` uses source hashes, an absent destination, same-filesystem checks, and a
      destination-link-before-source-unlink sequence.
- [x] Cross-device moves are rejected before approval and checked again before commit.
- [x] Extend quarantine metadata to identify directory-tree entries as well as files.
- [x] Add `purge_quarantine` for one exact token after a separate explicit approval.
- [x] Make purge fail closed for altered manifests, invalid tokens, bulk arguments, and
      partial or ambiguous filesystem outcomes.

### 5. Multi-file changes

- [x] `apply_patch_set` validates every member before the first commit.
- [x] One approval covers the complete path set and aggregate bounded preview.
- [x] The journal stores member hashes, commit order, staged temporary paths, and state.
- [x] Partial commits, interruption before the first member, interruption after all
      members, duplicate application, and external conflicts are tested.
- [x] The implementation does not claim all-or-nothing filesystem atomicity.
- [x] Keep the new directory-tree operations separate from the multi-file patch journal;
      a tree rename or purge must not be represented as a file patch set.

### 6. Security, reliability, and recovery

- [x] The workspace root is an authorization boundary for every workspace tool.
- [x] Traversal, absolute paths, unsafe ancestors, reserved internal paths, and unsafe
      symlink targets are rejected.
- [x] File, directory, search, output, patch, tool-duration, and model-round limits are
      explicit and validated.
- [x] Every mutation has an operation-specific risk classification and bounded preview.
- [x] Approval is a runtime authorization boundary, not a prompt instruction or model
      tool. Missing, malformed, denied, cancelled, and timed-out approval fail closed.
- [x] Mutation records use monotonic states: proposed, approved, applying, committed,
      denied, failed, reconciled, or reconciliation_required.
- [x] Durable mutation identity, request fields, risk, hashes, and previews are immutable
      after recording.
- [x] Restart recovery handles content hashes, directory presence, quarantine state,
      restore state, copy/move source and destination state, and patch-set journals.
- [x] The runtime does not claim exactly-once model or filesystem execution.
- [x] Add tree manifests that use `lstat`, reject symlinks and special files, and record
      enough bounded metadata to detect changes before directory quarantine or restore.
- [x] Add conservative tree entry, aggregate-byte, and depth limits to configuration.
- [x] Reconcile directory-tree source-versus-quarantine state and restore
      target-versus-payload state without automatic replay.
- [x] Reconcile interrupted purge as either a proved completion or
      `reconciliation_required`; never retry partial permanent deletion automatically.

### 7. Runtime, model, and TUI integration

- [x] The model adapter exposes normalized tool calls without provider-specific shapes in
      runtime or workspace modules.
- [x] The registry owns schemas, argument validation, dispatch, and bounded results.
- [x] The runtime persists proposal, approval, applying, progress, failure, and commit
      evidence in order.
- [x] The TUI has a factual header, session/model/workspace context, activity lane,
      status ribbon, composer, grouped help, and approval prompt.
- [x] Approval input is separate from normal composer input, defaults to deny, and handles
      Ctrl-C cancellation.
- [x] TUI output never claims a mutation succeeded before the workspace commit succeeds.
- [x] Add model-facing `delete_directory_tree`, `restore_directory`, and
      `purge_quarantine` definitions with explicit warnings and risks.
- [x] Add directory-tree previews with target, entry count, byte count, manifest identity,
      token, quarantine consequence, and no file-content dump.
- [x] Add an irreversible-purge warning that is visible in the approval panel and result.

### 8. Tests, documentation, and reproducibility

- [x] Deterministic tests cover normal completion, invalid inputs, approval outcomes,
      stale state, cancellation, timeout, failure, restart, evidence, and reproducibility
      for the implemented operations.
- [x] Real-model manual checks cover approved `apply_patch` and `write_file`, denial,
      stale approval, unavailable approval, bounded evidence, and restart recovery.
- [x] Workspace, security, tools, lifecycle, quick-start, playground, and TUI docs match
      the implemented behaviour.
- [x] Coverage is available through a documented command and the operation matrix is the
      completion authority.
- [x] Add unit tests for tree manifests, limits, symlink and special-file rejection,
      manifest drift, token validation, and purge state transitions.
- [x] Add integration tests for tree deletion, restore, purge, denial, stale state,
      cancellation, restart, partial purge, and ambiguous outcomes.
- [x] Add real-model manual checks for tree deletion, directory restoration, and purge,
      including inspection of bounded records and quarantine inventory.
- [x] Update all category documentation and the development playground with the final
      directory-tree and purge lifecycle.

## Operation matrix

Every row must have a contract test, policy/error tests, bounded evidence assertions, and
restart or interruption coverage where the operation can become ambiguous.

| Operation | Side effect | Approval | Required evidence and recovery |
| --- | ---: | ---: | --- |
| `list_directory` | No | No | bounded stable listing and path-policy errors |
| `read_file` | No | No | UTF-8/size/output errors and cancellation |
| `stat` | No | No | bounded metadata and symlink handling |
| `search_files` | No | No | bounded matches, ignored paths, cancellation |
| `list_quarantine` | No | No | metadata-only output, token validation, truncation |
| `write_file` | Yes | Yes | hashes, atomic commit, stale and restart checks |
| `apply_patch` | Yes | Yes | exact diff, context, stale and atomic failure checks |
| `mkdir` | Yes | Yes | parent policy, idempotency, restart presence check |
| `delete_directory` | Yes | Yes | empty-only, non-recursive, stale entry check, restart check |
| `delete` / `restore` | Yes | Yes | quarantine token, hash, collision, crash reconciliation |
| `copy` | Yes | Yes | source hash, destination collision, staged cleanup, recovery |
| `move` | Yes | Yes | source hash, same-filesystem check, interruption recovery |
| `apply_patch_set` | Yes | Yes | complete preflight, journal, partial recovery, no atomicity claim |
| `delete_directory_tree` | Yes | Yes | bounded manifest, quarantine rename, source/payload reconciliation |
| `restore_directory` | Yes | Yes | token, manifest, absent target, payload/target reconciliation |
| `purge_quarantine` | Yes | Yes | exact token, irreversible warning, no automatic replay |

## Reference alignment

Hermes and OpenClaw are the primary design references for this category.

- OpenClaw's permission-request boundary supports the decision to keep approval after
  tool selection but before execution. Tool policy also supports treating the complete
  mutation surface as a security concern rather than assuming that disabling one tool
  makes shell execution safe.
- Hermes's staged write and pending-store pattern supports retaining the exact prepared
  operation, making approval state inspectable, and separating proposal from execution.
- Both references support keeping tool schemas, policy, approval, execution, and TUI
  presentation as separate responsibilities.
- Anesu will not copy their broad product surfaces or claim guarantees that its
  tests do not establish. Waku remains a secondary reference for a small registry and
  visible tool loop, not the mutation-safety authority.

The source findings are recorded in the
[write-tool and approval comparison](../../../docs/research/write-tool-approval-comparison.md)
and the Hermes/OpenClaw code maps in `docs/research/harness-code-maps/`.

## State, persistence, and evidence

Mutation records remain under the owning turn:

```text
<state-directory>/sessions/<session-id>/turns/<turn-id>/
  turn.json
  events.jsonl
  rounds.jsonl
  mutations/<mutation-id>.json
```

Records include operation, risk, call and mutation identity, canonical paths, bounded
preview, hashes or manifest identity where relevant, approval decision, lifecycle state,
bytes or entry counts, and failure/reconciliation reason. They do not include API keys,
authorization headers, or unbounded file contents. Persistence writes records atomically
and rejects terminal rewrites or identity changes.

## Security requirements

- Mutations never write before approval and expected-state revalidation.
- The model cannot choose an arbitrary purge path. Purge accepts only an exact token
  issued by Anesu.
- Workspace policy rejects traversal, absolute paths, reserved paths, unsafe ancestors,
  symlink escapes, and special files according to the operation contract.
- Directory-tree preflight does not follow links and does not silently skip entries that
  would make the operation unsafe.
- Resource limits prevent unbounded traversal, manifests, previews, tool results, and
  model rounds.
- The quarantine root and mutation records use restrictive permissions and reject
  symlinked control files.
- Errors are actionable but do not expose secrets or unbounded filesystem contents.

## Failure, retry, and recovery requirements

- Read-only inspection can be repeated within its limits. Mutation commits are not
  automatically retried after ambiguous outcomes.
- Denial, timeout, cancellation before commit, invalid input, stale state, and policy
  rejection leave the workspace unchanged.
- A known commit failure is recorded as failed. A state that cannot prove the result is
  recorded as reconciliation_required.
- Duplicate call IDs, mutation IDs, approvals, and terminal records cannot create a second
  side effect.
- Multi-file patch sets and directory-tree/purge operations use their own recovery records;
  they are not forced into a false common atomicity guarantee.

## Delivered implementation order

1. Added tree limits, manifest types, and security preflight.
2. Implemented directory-tree quarantine by same-filesystem rename.
3. Implemented directory restoration and quarantine inventory updates.
4. Implemented exact-token purge with explicit irreversible approval.
5. Added persistence and restart reconciliation for all three operations.
6. Added tool schemas, runtime results, TUI warnings, and documentation.
7. Added deterministic, integration, failure-injection, restart, and real-model coverage.
8. Ran the full validation set and archived this plan after every matrix row passed.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] All eight layers are complete and every operation matrix row passes.
- [x] Tree deletion, restoration, and purge work through the real standalone model/TUI
      path, not only through internal helpers.
- [x] Security tests cover path policy, limits, links, special files, token substitution,
      and reserved internal data.
- [x] Failure, cancellation, stale, duplicate, restart, partial, and ambiguous states are
      tested without silent replay.
- [x] Evidence is bounded, redacted, permission-restricted, and inspectable.
- [x] Documentation, examples, and the playground match the implementation.
- [x] Required validation commands and manual evidence pass.

## Required validation commands

```bash
cd anesu
npm run typecheck
npm test
npm run coverage
npm run build
cd ..
git diff --check
```

Manual real-model checks use the ignored local `.env` configuration. Credentials must not
be printed, committed, or copied into evidence.

## Commit discipline and handoff

- [x] Keep contracts, workspace/security, runtime/tool/TUI, and documentation changes in
      reviewable sections.
- [x] Run narrow validation before each commit.
- [x] Review status and diffs while preserving unrelated worktree changes.
- [x] Record changed files, validation, known limitations, and commit hashes at handoff.

## Completion record

Complete this section only when archiving the plan.

**Completed:** 2026-09-15T16:34:52+02:00
**Commits:** No commit created; changes remain in the shared worktree for review.

### Validation

- `npm run typecheck` — passed.
- `npm test` — passed, 99/99 tests.
- `npm run coverage` — passed, 99/99 tests; 86.49% lines, 76.13% branches, 80.00% functions.
- `npm run build` — passed.
- `git diff --check` — passed.
- `npm run start -- doctor` — passed against the configured OpenRouter free model; provider reachable and returned `OK`.
- Real-model standalone flow — passed: `delete_directory_tree`, `restore_directory`, and
  exact-token `purge_quarantine`; verified source removal, restoration, and quarantine
  entry removal. No credential value was printed or persisted in evidence.

### Known limitations

- Regular-file `copy` and `move` remain regular-file-only; directory copy and move are a
  later capability.
- Directory-tree manifests are bounded by configured entry, byte, and depth limits.
- Permanent purge is never automatic and partial outcomes require explicit reconciliation.
