# Anesu workspace actions

**Created:** `2026-09-15T11:08:26+02:00`
**Last updated:** `2026-09-15T16:32:00+02:00`
**Status:** Completed
**Owner:** Anesu
**Completed:** `2026-09-15T16:32:00+02:00`

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [Anesu rules](../../../anesu/AGENTS.md)
- [Anesu ownership](../../../anesu/README.md)
- [Anesu source ownership](../../../anesu/src/README.md)
- [tools ownership](../../../anesu/src/tools/README.md)
- [workspace ownership](../../../anesu/src/workspace/README.md)
- [security ownership](../../../anesu/src/security/README.md)
- [turn lifecycle](../../../anesu/docs/turn-lifecycle.md)
- [implementation plan lifecycle](../README.md)
- [completed workspace inspection plan](../completed/anesu-reliable-terminal-and-workspace-inspection.md)
- [write-tool and approval comparison](../../../docs/research/write-tool-approval-comparison.md)

Primary external references:

- [OpenClaw `apply_patch` and tool policy](https://github.com/openclaw/openclaw/blob/main/docs/tools/exec.md)
- [OpenClaw permission requests](https://github.com/openclaw/openclaw/blob/main/docs/plugins/plugin-permission-requests.md)
- [Hermes write approval and pending store](https://github.com/NousResearch/hermes-agent/blob/main/tools/write_approval.py)
- [Hermes TUI guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/tui.md)
- [Hermes TUI implementation notes](https://github.com/NousResearch/hermes-agent/blob/main/ui-tui/README.md)
- [OpenClaw TUI guide](https://github.com/openclaw/openclaw/blob/main/docs/web/tui.md)

These references are design input, not implementation dependencies. Anesu
must remain standalone and must not import their code or Agent Harness Lab modules.

Preserve these existing decisions:

- The standalone Anesu directory owns its runtime, filesystem access,
  security, persistence, and terminal interface.
- The model adapter exposes normalized tool calls; provider-specific response shapes do
  not leak into the runtime or workspace modules.
- The current read-only tools remain available and continue to use the workspace and
  security modules.
- Tool selection is not authorization. A model tool call proposes work; the runtime and
  approval gate decide whether a side effect may occur.
- The runtime does not claim exactly-once model or filesystem execution.

## Purpose

Deliver the standalone Anesu workspace-action layer end to end. The completed
slice covers bounded inspection, single-file writes and patches, directory creation and
empty-directory deletion, regular-file copy and move, quarantine-backed file deletion and
restore, bounded quarantine inventory, and journaled multi-file patches. Every side effect
has an approval decision, a user-visible result, durable evidence, and recovery tests.

The implementation remains standalone. The model adapter, runtime, tools, security policy,
workspace, persistence, and TUI keep their existing boundaries. This plan records only
behaviour that is implemented and verified; later workspace features get their own plan.

The deterministic suite has 94 passing tests. A real OpenRouter model completed approved
`apply_patch` and `write_file` flows, and the manual checks also covered denial, stale
approval, unavailable approval, bounded evidence, and restart at the approval prompt.
The multi-file patch journal records partial outcomes and reconciliation state without
claiming all-or-nothing filesystem atomicity.

Latest validation snapshot: `npm run typecheck`, `npm test`, `npm run coverage`,
`npm run build`, and `git diff --check` pass. The suite has 94 passing tests; aggregate
coverage is 86.50% lines, 76.78% branches, and 81.86% functions. Coverage is a signal,
not the completion criterion; the operation matrix and manual lifecycle evidence remain
authoritative.

## Local file management coverage target

The local workspace capability is considered covered only when every core operation has a
real tool contract, explicit policy, user-visible result, durable evidence where it has a
side effect, and failure/recovery tests.

| Capability | Initial tool/interface | Side effect | Approval | Required safety/evidence |
| --- | --- | ---: | ---: | --- |
| List entries | `list_directory` | No | No | bounded, stable ordering, path policy |
| Read text | `read_file` | No | No | UTF-8, size/offset limits, safe output |
| Inspect metadata | `stat` | No | No | type, size, timestamps, mode, link count; no secret contents |
| Search paths/content | `search_files` | No | No | bounded matches, ignored/sensitive-path rules, cancellation |
| Create/replace one file | `write_file` | Yes | Yes | before/after hashes, preview, atomic commit |
| Surgical edit | `apply_patch` | Yes | Yes | exact context, bounded diff, stale rejection |
| Create directory | `mkdir` | Yes | Yes | approved parent, idempotency, path policy |
| Delete empty directory | `delete_directory` | Yes | Yes | explicit non-recursive semantics, empty-only preflight, stale recheck, restart reconciliation |
| Copy | `copy` | Yes | Yes | source hash, destination collision policy, staged commit |
| Move/rename | `move` | Yes | Yes | source hash, collision policy, same-filesystem semantics |
| Delete/restore | `delete` plus recovery record | Yes | Yes | quarantine/trash first, restore path, retention policy |
| Batch operations | prepared mutation set | Yes | Yes | journal, per-path hashes, crash reconciliation |

This slice covers the operations in the matrix. Other operating-system capabilities need
separate plans and security decisions.

## Mature-agent reference alignment

The operation matrix is grounded in mature agent implementations and their documented
runtime seams. We borrow patterns and verify them in Anesu; we do not import
their code or assume that a filename proves a guarantee.

### Primary implementation references

- **Hermes** is the main reference for file-tool breadth (`read_file`, `write_file`,
  `patch`, search), staged writes, exact pending payloads, reviewable diffs, and explicit
  approval outcomes. Its TUI is the main reference for a visible activity lane, blocking
  approval prompts, tool/status separation, and a strong startup/context surface.
- **OpenClaw** is the main reference for separating tool exposure/policy from the
  pre-execution approval decision, keeping `apply_patch` structured rather than treating
  shell execution as the file API, and handling approval requests as fail-closed runtime
  state. Its TUI is a secondary interaction reference for event-driven tool activity and
  status presentation.

### Secondary references

- **Waku** is useful for a small registry and visible reason/act/observe loop, but it is
  not the approval, transaction, or recovery authority for this design.
- **Claude Code**, including the supplied interface reference, informs visual hierarchy,
  prompt placement, status treatment, and the feeling of a focused coding console. It is
  not treated as evidence for file-operation semantics because only its user interface is
  in scope here, not a reviewed source implementation.

### Decisions this comparison must produce

- Which operations are read-only and can execute immediately.
- Which operations require a prepared preview and explicit approval.
- Which operations can be atomic for one path and which require a journal or recovery
  record.
- What the user sees before, during, and after each operation.
- What is persisted, what is redacted, and how an interrupted operation is reconciled.
- Which guarantees are actually tested rather than inherited from a reference product.

## Definition of done

From `anesu/`, this interactive flow works against a real configured model:

```bash
npm run chat
```

The user asks the agent to inspect or manage files inside the configured workspace. The
model emits a real read-only or mutation tool call. Anesu validates it, prepares
any side effect without writing first, shows the operation in the TUI, and waits for an
explicit approval when required.

- `y` applies the approved operation through its workspace commit path.
- `n` leaves the workspace unchanged and returns a model-visible denial result.
- A malformed, unsafe, stale, cancelled, timed-out, or failed mutation does not silently
  change the file.
- The turn directory contains inspectable mutation metadata and ordered approval/tool
  evidence without placing credentials or unbounded file contents in the transcript.
- Restart recovery reconciles an interrupted commit from recorded before/after hashes and
  never resends or silently replays an ambiguous mutation.

```text
model tool call
  → argument and workspace-policy validation
  → in-memory preparation and bounded preview
  → durable proposed mutation
  → explicit approval decision
  → expected-content recheck
  → operation-specific commit or journal
  → durable outcome and model-visible result
```

## Scope

- [x] Define the public interfaces and state transitions for a prepared workspace
      mutation, an approval request, an approval decision, and a mutation outcome.
- [x] Add a real `apply_patch` model-facing tool with a single `patch` string argument.
- [x] Add bounded read-only `stat`, `search_files`, and `list_quarantine` tools.
- [x] Add approval-gated `write_file`, `mkdir`, `delete_directory`, `delete`, `restore`,
      `copy`, and `move` tools with operation-specific previews and results.
- [x] Add the approval-gated `apply_patch_set` tool with a per-file journal and explicit
      partial-commit reconciliation semantics.
- [x] Implement a pure patch parser/application module that supports adding or updating
      one UTF-8 text file per call with exact context matching.
- [x] Extend workspace path policy for mutation targets, including new paths, existing
      regular files, parent-directory checks, and symlink rejection.
- [x] Prepare the complete change and diff in memory before any side effect.
- [x] Record the original content hash, proposed content hash, path, operation, and
      mutation identity before requesting approval.
- [x] Add an approval gate with explicit `allow-once` and `deny` decisions.
- [x] Make approval unavailable in non-interactive execution fail closed without writing.
- [x] Add TUI approval rendering with the affected path, operation, bounded diff, and
      clear default-deny behaviour.
- [x] Give the terminal a lively console presentation: branded header panel, factual
      available-tool list, model/session/workspace context, status ribbon, activity lane,
      grouped help, and a visually distinct composer prompt.
- [x] Keep the presentation grounded in runtime data. Do not display unavailable tools,
      fake usage, fake health, fake skills, or decorative run states that did not occur.
- [x] Rework the TUI input flow as needed so approval input is owned by the terminal
      application rather than competing with the active line iterator.
- [x] Recheck the original content hash immediately before commit and reject stale
      proposals without overwriting newer user changes.
- [x] Commit one approved file with a same-directory temporary file, flush, and atomic
      rename; preserve the existing file mode where applicable.
- [x] Persist mutation state and exact request data in a local, permission-restricted
      mutation record while keeping ordinary transcript and round evidence bounded.
- [x] Reconcile interrupted mutation records after restart using before/after hashes.
- [x] Keep the existing read-only tool loop, turn limits, cancellation, and evidence
      ordering intact.
- [x] Add deterministic integration coverage.
- [x] Complete one real-model manual acceptance check.
- [x] Update workspace, security, tools, lifecycle, quick-start, and development
      playground documentation to describe the real approval and recovery behaviour.

## Finished behaviour

### User-visible behaviour

The model-facing tools describe bounded workspace inspection and mutation operations.
Arguments are validated before any side effect. Read-only tools execute immediately;
mutation tools prepare a bounded preview and wait for explicit approval.

For a valid proposal, the TUI shows something equivalent to:

```text
Proposed workspace change
  update notes/today.md
  +2 lines  -1 line

<bounded unified diff>

Apply this change? [y/N]
```

The exact presentation may evolve with the TUI, but it identifies the operation and path,
shows enough context for an informed decision, defaults to deny, and never claims that a
change happened before the commit succeeds. Directory deletion is explicitly empty-only
and non-recursive. Regular-file deletion moves the file to quarantine and returns a
restore token.

The following outcomes are explicit:

- **Applied:** the file has the proposed content and the final tool result says so.
- **Denied:** the file is unchanged and the model receives a safe denial result.
- **Invalid:** the patch or target is rejected before approval and the model receives a
  diagnostic that explains how to correct it.
- **Stale:** the file changed after preparation; the file is unchanged by this mutation
  and the model must read it again before proposing another patch.
- **Cancelled or timed out:** no new content is committed unless the commit had already
  reached its atomic filesystem operation; recovery reconciles that case from hashes.
- **Failed:** the original file remains intact when the commit failure is known.
- **Reconciliation required:** the durable record does not prove the resulting file state;
  the runtime reports the ambiguity and never retries automatically.

Non-interactive commands do not receive implicit approval. They return an actionable
approval-unavailable result and leave the workspace unchanged.

### Terminal console presentation

The interactive terminal should feel like an agent console rather than a bare line reader.
Its first frame contains:

- a compact branded Anesu header;
- the selected provider/model, session, workspace, and evidence location;
- the actual registered tool names supplied by the application;
- a ready/status ribbon with factual state and elapsed time when a turn is active;
- a separate activity lane for waiting, tool start/completion, cancellation, and failure;
- a coloured `You`/`Agent` hierarchy and distinct composer prompt; and
- grouped help for session commands and input controls.

The renderer remains a local presentation module over the existing `readline` input path.
The first styling pass may use ANSI colour and box-drawing characters, but must retain a
clear non-colour/non-TTY fallback. It should borrow the information hierarchy visible in
Hermes and Claude-style agent consoles without copying their product-specific panels or
claiming capabilities that Anesu does not implement.

### Proposed interfaces and seams

Keep the external interfaces small and deep. The implementation may use internal seams
for tests, but the CLI must not learn patch parsing or filesystem commit rules.

```text
models/       → normalized model tool calls
runtime/      → bounded turn loop, approval pause, cancellation, and outcome mapping
tools/        → model-facing schemas, argument validation, and dispatch
security/     → mutation authorization, approval interface, path and resource policy
workspace/    → patch preparation, file reads, hashes, diff, and atomic commit
persistence/  → mutation records, turn evidence, and restart reconciliation
cli/          → approval prompt, diff rendering, and user decision input
```

The intended interfaces are conceptually:

```ts
interface ApprovalGate {
  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}

type ApprovalDecision = "allow-once" | "deny";

interface PreparedMutation {
  readonly mutationId: string;
  readonly path: string;
  readonly operation: "add" | "update";
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly diff: string;
  readonly proposedContent: string;
}
```

The final TypeScript shapes may differ, but these invariants must remain:

- Preparation returns data and performs no write.
- Approval receives the prepared operation, not an opaque prompt asking whether to trust
  the model.
- Commit accepts only a prepared operation whose expected before-state still matches.
- A prepared operation cannot be committed twice as a new side effect under the same
  mutation identity.
- Tests can exercise patch preparation and approval without invoking a real model or TUI.

### Ownership and boundaries

- `models/` emits the model's normalized `apply_patch` call; it does not decide whether
  the call is safe.
- `tools/` validates the tool schema and delegates workspace access; it does not resolve
  paths or call `fs` directly.
- `security/` owns the approval interface, workspace mutation policy, limits, and
  fail-closed decisions. It does not render terminal output.
- `workspace/` is the sole implementation allowed to write workspace files. It owns
  patch preparation, expected-content checks, and the atomic single-file commit.
- `runtime/` owns the in-flight operation and ensures approval happens between proposal
  and commit. It does not implement patch syntax.
- `persistence/` is the sole writer for mutation evidence and turn evidence. It does not
  decide whether a user approved a change.
- `cli/` owns the human approval interaction and displays facts supplied by the runtime;
  it does not infer success from terminal text or write files itself.

## State, persistence, and evidence

Extend the current turn layout without changing the ownership of existing records:

```text
<state-directory>/sessions/<session-id>/
  turns/<turn-id>/
    turn.json
    events.jsonl
    rounds.jsonl
    result.json
    mutations/<mutation-id>.json  # bounded state, request, and recovery record
```

The mutation record contains the mutation identity, session/turn/call identity, operation,
workspace-relative path, optional before/after hashes, optional quarantine/restore
references, line and byte counts, bounded preview, state, timestamps, decision, and
failure/reconciliation reason. It is local state with restrictive permissions, not
transcript content or model context, and it must not contain credentials or unbounded
file contents.

Mutation states are:

```text
proposed → approved → applying → committed
    ├──────────────→ denied
    ├──────────────→ failed

approved/applying → reconciled | reconciliation_required
```

The state transitions are monotonic. A duplicate approval after `committed` is not replayed
as a new mutation. An `approved` or `applying` mutation is reconciled after restart:

- content mutations compare the current content with the recorded before/after hashes;
- `mkdir` checks whether the target is absent, a directory, or another type;
- `delete_directory` checks whether the target is an empty directory and never retries
  removal after restart;
- `delete` checks whether the original file or recorded quarantine payload is present;
- `restore` checks whether the restore target or quarantine payload is present;
- `copy` checks the destination hash and source presence; `move` checks both source and
  destination state; and
- ambiguous or conflicting states become `reconciliation_required` and are never retried
  automatically.

Existing `rounds.jsonl` records remain bounded. Tool-requested and tool-completed payloads
include mutation identity, path, hashes, decision, state, and summary sizes, not full file
contents. Existing lifecycle events remain ordered and correlated to the turn.

Write order is explicit:

1. Validate and prepare the requested operation in memory.
2. Persist the proposed mutation and exact bounded preview.
3. Persist the approval decision.
4. Persist `applying` immediately before the atomic filesystem operation.
5. Commit the operation through the workspace writer.
6. Persist `committed` or a failure/reconciliation state.
7. Append the tool-completed round evidence and return the model-visible result.

The implementation must document the small crash window between the filesystem rename and
the final mutation-state write. Hash reconciliation is the recovery mechanism; automatic
replay is not.

## Failure, retry, and recovery semantics

- Patch parsing, path validation, context mismatch, size limits, and symlink rejection
  are deterministic failures. They are not retried automatically.
- Approval has a bounded timeout. Timeout, cancellation, missing TTY, malformed input,
  and unknown decisions fail closed and do not write.
- The user may approve only the prepared mutation shown. The runtime does not accept a
  second or modified patch under the first approval decision.
- A stale before-hash rejects the mutation. The runtime returns a model-visible stale
  result that instructs the model to read the current file again.
- A failed temporary write or flush leaves the existing file unchanged where the platform
  guarantees the failure occurred before rename; the mutation record reports failure.
- A crash after the filesystem operation but before the `committed` record is reconciled
  from hashes or source/quarantine state. If the
  result is unknown, the mutation is `reconciliation_required`; it is never silently
  replayed.
- Cancellation before commit leaves the approved mutation unapplied. Cancellation after
  the filesystem operation begins cannot undo it; the final state is reconciled and
  exposed.
- The runtime does not retry the model request after a mutation outcome. The model receives
  one explicit tool result and may decide what to do in a later bounded round.
- Duplicate model call IDs remain invalid. Mutation identity includes the turn and call
  identity so a duplicate approval cannot create a second commit.
- Restart recovery processes incomplete mutation records before the next interactive turn
  and reports any reconciliation-required state clearly.
- The implementation must describe file replacement as atomic for one file on the same
  filesystem where the platform supports the rename semantics; it must not claim a
  transaction across multiple files.

## Security and configuration

- Add and validate a maximum patch/request size and an approval timeout with conservative
  positive defaults.
- Reuse the configured workspace root as the authorization root; relative paths,
  traversal, absolute paths, and symlink targets are rejected for mutation.
- Require UTF-8 text and enforce the existing maximum file-size limit on existing and
  proposed content mutations. Deletion and restoration hash bounded bytes so binary files
  can be quarantined without exposing their contents.
- Require an existing parent directory. This slice does not let the model create directory
  trees implicitly.
- Reject directories, device files, sockets, and other non-regular targets for file
  content, delete, and restore operations. `mkdir` and `delete_directory` are the
  explicit directory operations.
- Preserve existing file mode during replacement where safe; use a documented default mode
  for newly created files.
- Do not place API keys, environment values, authorization headers, or unbounded file
  contents in tool results, transcripts, lifecycle events, or normal round evidence.
- Keep the exact bounded patch request in a permission-restricted local record only for
  mutation inspection and crash reconciliation.
- Approval is always required for every mutation tool; there is no configuration switch
  that silently turns a mutation into an unapproved write in this slice.
- If the workspace or approval dependency is unavailable, report an actionable failure
  and leave the file unchanged.

## Implementation checklist

### 1. Contracts and configuration

- [x] Add typed mutation, approval request, decision, outcome, and state records.
- [x] Define the tool schema and bounded patch/request limits.
- [x] Define approval timeout and safe default behaviour for interactive and non-interactive
      execution.
- [x] Define error codes for invalid patch, approval denied, approval unavailable, stale
      mutation, mutation failed, and reconciliation required.
- [x] Add contract tests for mutation serialization, redaction, restrictive record
      permissions, valid state transitions, and invalid terminal/identity transitions.

### 2. Pure patch implementation

- [x] Add a pure parser for the chosen patch format with explicit Add/Update operations.
- [x] Require exactly one file operation per call in this slice.
- [x] Apply hunks against the exact original content; reject missing or ambiguous context.
- [x] Preserve newline and UTF-8 rules intentionally and test them.
- [x] Produce a bounded unified diff and line/byte summary from the prepared content.
- [x] Reject unsupported delete, move, binary, absolute, traversal, duplicate, and
      multi-file operations with safe diagnostics at the parser, workspace, or tool
      boundary as appropriate.

### 3. Workspace and security implementation

- [x] Add a mutation-aware path resolver that handles existing and new targets without
      weakening read-path checks.
- [x] Reject symlink targets and unsafe parent paths for writes.
- [x] Read the original file, calculate a cryptographic content hash, and prepare the
      proposed content without writing.
- [x] Recheck the expected hash at commit time.
- [x] Implement same-directory temporary write, flush, and atomic rename for one file.
- [x] Preserve existing mode and apply the documented new-file mode.
- [x] Add an internal injectable commit seam for deterministic write/flush/rename failure
      tests without exposing a general filesystem abstraction to callers.
- [x] Add regular-file copy with staged destination creation, source-hash recheck, and
      no-overwrite collision handling.
- [x] Add regular-file move/rename with source-hash recheck, no-overwrite destination
      linking, source removal, and explicit ambiguous-state recovery semantics.
- [x] Add bounded multi-file patch preparation with complete preflight, a restricted
      transaction directory, per-member temporary paths, and hash-based reconciliation.

### 4. Persistence and recovery

- [x] Add mutation record storage under the owning turn directory.
- [x] Write proposed, decision, applying, and terminal states atomically.
- [x] Store exact bounded request data with restrictive permissions and safe retention.
- [x] Add ordered mutation evidence to the existing turn record without copying full file
      contents into normal evidence.
- [x] Add restart reconciliation based on before/after hashes, directory presence,
      delete/restore source-versus-quarantine state, and copy/move source-versus-
      destination state.
- [x] Ensure a completed mutation cannot be applied again after duplicate approval or
      application restart. Durable records reject terminal rewrites and commits recheck
      the prepared identity/hash or destination state before touching the workspace.

### 5. Runtime and tool integration

- [x] Add `apply_patch`, `apply_patch_set`, `write_file`, `mkdir`, `delete_directory`,
      `delete`, `restore`, `copy`, `move`, and `list_quarantine` to the model tool
      definitions and registry.
- [x] Keep read-only tool behaviour unchanged.
- [x] Prepare and persist the mutation after `tool_requested` but before approval.
- [x] Invoke the approval gate before the workspace commit.
- [x] Pass cancellation and timeout signals through preparation, approval, and commit.
- [x] Return bounded model-visible results for every mutation outcome.
- [x] Persist tool-completed evidence after the outcome is known.
- [x] Persist multi-file member paths, hashes, journal state, commit order, and temporary
      paths without claiming all-or-nothing filesystem atomicity.
- [x] Preserve the existing round limit and interrupted-turn behaviour.

### 6. TUI integration

- [x] Add a typed approval event from the runtime/application to the terminal UI.
- [x] Keep the console header, status ribbon, activity lane, and composer visually
      distinct while preserving the existing readline input contract.
- [x] Render actual tool names from the application/tool registry rather than duplicating
      a hard-coded capability list in the renderer.
- [x] Use a bounded bordered panel for factual session/model/workspace/evidence context.
- [x] Add status icons and restrained ANSI colour for ready, waiting, streaming, success,
      cancellation, and failure, with a clean non-colour fallback.
- [x] Group help into session and input controls and keep it synchronized with implemented
      commands only.
- [x] Render a bounded diff and factual mutation status without claiming success early.
- [x] Implement `y`/`n` parsing with default deny and clear invalid-input handling.
- [x] Ensure the approval prompt and normal composer cannot consume the same input line.
- [x] Make Ctrl-C during approval cancel the proposal without committing it.
- [x] Make non-interactive `runSingle` report approval unavailable rather than applying.
- [x] Add activity/status output for proposed, approved, applying, committed, denied,
      stale, and failed outcomes.

### 7. Documentation and learning material

- [x] Update tools, workspace, security, and turn-lifecycle documentation with the new
      ownership and state rules.
- [x] Update the quick-start guide with an explicit approval example and non-interactive
      limitation.
- [x] Add a development playground procedure that creates a disposable workspace, makes
      an approved change, denies another, and inspects mutation evidence.
- [x] Record the adopted Hermes/OpenClaw patterns and the scope boundaries for this slice.
- [x] Keep examples honest about one-file atomicity and the journaled multi-file
      operation, which does not claim all-or-nothing filesystem atomicity.

## Test coverage

### Unit tests

- [x] Valid Add and Update patches produce the expected content and diff.
- [x] Malformed syntax, missing context, ambiguous context, duplicate paths, unsupported
      operations, binary-looking content, and oversized input fail without a write.
- [x] Absolute paths, traversal, symlinks, missing parents, directories, and non-regular
      targets are rejected.
- [x] Existing-file and new-file hash/size/mode rules are enforced.
- [x] Approval decisions allow exactly the prepared mutation or deny it; malformed and
      missing decisions fail closed.
- [x] Mutation state transitions accept valid order and reject terminal rewrites.
- [x] Serialization, redaction, restrictive request-record permissions, and bounded diff
      output are verified.
- [x] Quarantine inventory returns bounded metadata and restore tokens without file
      contents, rejects unsafe recovery entries, and reports truncation.
- [x] Empty-directory deletion is approval-gated, non-recursive, root-protected, and
      stale-safe when an entry appears after preparation.

### Integration tests

- [x] A deterministic model proposes `apply_patch`; approval applies the expected file
      change and returns a second-round final response.
- [x] Denial leaves the file byte-for-byte unchanged and is visible to the model.
- [x] Missing TTY and unavailable approval leave the file
      unchanged.
- [x] A changed file is rejected as stale after preparation and before commit.
- [x] Temporary-write, flush, and rename failures produce safe failure records and do not
      report false success.
- [x] An approved mutation after a simulated crash before or after rename is
      reconciled without silent replay.
- [x] Duplicate approval and repeated recovery do not apply the mutation twice.
- [x] Tool-requested and tool-completed evidence remains ordered and correlated with the
      turn, call, and mutation identities.
- [x] Existing read-only tools, round limits, provider failures, and ordinary chat still
      pass unchanged.
- [x] Header and help rendering expose the actual model/session/workspace/tool context and
      remain readable with colour disabled.
- [x] A public turn lifecycle renders waiting, tool activity, assistant text, and terminal
      completion through the same TUI seam used by the interactive application.
- [x] A model-facing `delete_directory` flow persists its operation-specific risk and
      durable committed outcome; interrupted empty-directory deletion is reconciled
      without replay.

### Local file-management coverage matrix

Every row must have a passing contract test, policy/error tests, evidence assertions where
the operation has a side effect, and at least one restart or interruption test where the
operation can be left ambiguous. A high aggregate percentage cannot substitute for a
missing operation row.

| Operation | Contract and normal path | Safety/error coverage | Recovery/evidence coverage |
| --- | --- | --- | --- |
| `list_directory` | stable entries, ordering, bounds | traversal, symlink display, missing/non-directory path | repeatability and bounded output |
| `read_file` | UTF-8 content and metadata | invalid UTF-8, size/offset/output limits, traversal | cancellation and model-visible errors |
| `stat` | file/dir/link metadata | missing path, special files, hard-link count, path policy | bounded metadata evidence |
| `search_files` | path/content matches and limits | ignored/hidden/sensitive paths, invalid patterns, cancellation | bounded result evidence and timeout |
| `write_file` | create and replace with preview | stale hash, size/encoding, collision, sensitive target | atomic failure, duplicate approval, restart reconciliation |
| `apply_patch` | Add/Update and exact hunks | malformed/context/path/binary/multi-file rejection | approval, stale hash, atomic failure, restart reconciliation |
| `mkdir` | new directory and idempotent existing directory | parent/path/traversal/collision/symlink policy | interrupted creation and durable outcome |
| `delete_directory` | empty-directory deletion after approval | workspace-root protection, non-empty rejection, stale entry race, no recursive removal | interrupted deletion reconciliation and durable operation/risk evidence |
| `copy` | regular-file copy to an absent destination | source change, destination collision, limits, cross-device policy; directory targets rejected | staged-copy cleanup and restart evidence |
| `move`/`rename` | regular-file no-overwrite transfer | source change, destination collision, symlink/hard-link policy; directory and cross-device targets rejected | interruption before/after transfer and reconciliation |
| `delete`/restore | quarantine, inspect, restore | approval, source hash, protected/sensitive target, retention boundary | crash during quarantine and restore; no purge through the delete tool |
| multi-file set | prepare/preview/approve complete set | any invalid member invalidates whole set | journal, partial commit, duplicate approval, manual reconciliation |

The implementation must not mark a row complete because a neighbouring operation happens
to use the same helper. Shared modules still require operation-specific contract and failure
tests at the public tool seam.

### Manual acceptance checks

- [x] In a disposable workspace, run `npm run chat` with a real configured model and ask it
      to make a small file change; inspect the rendered diff, approve it, and verify the
      file and mutation record.
- [x] Repeat the flow and deny the change; verify the file and transcript contain no false
      claim of application. Verified with the real `cohere/north-mini-code:free` flow in
      `/tmp/anesu-manual-deny-YpkSYx/state`; the target was absent, the mutation
      record was `denied`, and the tool evidence carried `approval-denied`.
- [x] Modify the target file after the diff appears; approve the old proposal and verify
      the stale rejection leaves the newer content intact. Verified with the real free
      model in `/tmp/anesu-manual-deny-YpkSYx/stale-state`; the file remained
      `user changed while waiting` and the mutation record carried `mutation-stale`.
- [x] Stop the process at a documented approval/commit point, restart the same session,
      and inspect the reconciliation result. Verified with the real
      `cohere/north-mini-code:free` flow in
      `/tmp/anesu-restart-fixed-HJnrTX/state`: recovery reported the interrupted
      turn without retrying a model request, closed the undecided mutation as
      `denied`/`approval-unavailable`, and left `restart-note.txt` unchanged.
- [x] Run a non-interactive message that causes a mutation proposal and verify approval
      is required and no file changes. Verified with the real free model in
      `/tmp/anesu-manual-deny-YpkSYx/noninteractive-state-2`; the target was
      absent and the mutation evidence recorded `approval-unavailable`.
- [x] Inspect the evidence directory for bounded records and verify no API key or
      unbounded file content was retained in normal evidence. The denial and
      non-interactive evidence directories under `/tmp/anesu-manual-deny-YpkSYx/`
      passed the credential scan; round evidence remained bounded.

The approved real-model check was recorded under
`/tmp/anesu-manual-PeLev4/state4/sessions/session_b4cecc48f3b44b84b918a519a62fbdbf/`.
It used `cohere/north-mini-code:free` through the local ignored configuration and changed
only `note.md` after the TUI approval prompt. This temporary evidence is not a repository
artifact and contains no credential.

The approved `write_file` check was recorded under
`/tmp/anesu-manual-PeLev4/state6/sessions/session_f0a434656dd44609881c4125c9a88151/`.
It verified a replacement without a trailing newline and retained the newline change in
the bounded diff and mutation record.

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

Manual real-model checks require a local ignored `anesu/.env` with a valid
OpenRouter credential and selected model. The credential must not be printed, committed,
or copied into evidence. Deterministic tests must remain network-free.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every applicable implementation and test checkbox is complete.
- [x] A real model can propose a real file change and the user can approve or deny it in
      the standalone TUI.
- [x] The TUI presents a lively but factual console surface with visible context,
      activity, status, and composer hierarchy in both colour and non-colour modes.
- [x] Every row in the local file-management coverage matrix has passing contract,
      safety/error, evidence, and applicable recovery tests.
- [x] Coverage output is available from a documented repository command, but completion is
      decided by the operation matrix rather than by an aggregate percentage alone.
- [x] No filesystem write occurs before approval and expected-content revalidation.
- [x] Atomic single-file commit, stale rejection, failure reporting, cancellation, and
      restart reconciliation are implemented and tested.
- [x] The implementation does not claim multi-file atomicity or exactly-once behaviour.
- [x] Documentation and the development playground match the actual lifecycle.
- [x] Required validation commands pass and manual evidence is recorded.

## Commit discipline and handoff

- No new commits were created in this worktree because it already contained unrelated
  user changes. The changed files were reviewed in place and the required validation ran
  against the combined working tree.
- The completion record below records the validation and points future work to its own
  active plan. No commit hash is claimed.

## Completion record

**Completed:** `2026-09-15T16:32:00+02:00`
**Commits:** `Not created in this worktree; see commit-discipline note above.`

### Validation

- `npm run typecheck` — passed.
- `npm test` — 94 tests passed.
- `npm run coverage` — 94 tests passed; 86.50% lines, 76.78% branches, 81.86% functions.
- `npm run build` — passed.
- `git diff --check` — passed.
- Real-model checks — approved `apply_patch` and `write_file`, denial, stale approval,
  unavailable approval, bounded evidence, and restart recovery were verified with the
  configured free OpenRouter model.

### Known limitations

- The remaining category work is tracked in
  [`anesu-workspace-filesystem.md`](./anesu-workspace-filesystem.md).
- This plan does not claim all-or-nothing filesystem atomicity for multi-file patch sets
  or exactly-once model/provider execution.

### Historical-scope note

This plan records the completed workspace-action slice. The next plan may extend the
workspace action seam, but it must preserve the approval, persistence, and recovery
guarantees proved here unless a new decision record explicitly changes them.
