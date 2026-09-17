# Anesu terminal agent — implementation plan

**Created:** 2026-09-14T23:37:30+02:00
**Last updated:** 2026-09-15T00:54:57+02:00
**Status:** Completed
**Completed:** 2026-09-15T00:54:57+02:00

## Start here

Before editing, read [repository rules](../../../AGENTS.md),
[Anesu ownership](../../../anesu/README.md), and the relevant
source-directory notes under [`anesu/src/`](../../../anesu/src/).
Keep all implementation inside `anesu/` unless this plan explicitly calls for
a Lab documentation update.

For optional design inspiration—not code to copy—use the
[Hermes](../../../docs/research/harness-code-maps/hermes.md),
[OpenClaw](../../../docs/research/harness-code-maps/openclaw.md), and
[Waku](../../../docs/research/harness-code-maps/waku.md) maps. Each map pins its source
repository and local checkout. These references do not expand this slice's scope.

## Purpose

Build the first runnable Anesu milestone: a local terminal agent that accepts
one user message, streams one model response, persists an inspectable session record,
and reports structured lifecycle events.

This is the initial local interface for Anesu, comparable in role to a first
Codex CLI or Hermes terminal interface. It is intentionally a narrow, real agent turn
rather than a visual mock or a premature full agent product.

## Definition of done

The following command launches an interactive terminal session:

```bash
anesu chat
```

A user can enter a message, see the selected model's response stream in the terminal,
and exit cleanly. The completed turn leaves durable local evidence that can be read
without the TUI:

```text
<state-directory>/sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/
    turn.json
    events.jsonl
    result.json
```

The first release is complete only when the same turn lifecycle is exercised by unit
tests, integration tests using a deterministic local provider, and an opt-in manual test
against the configured OpenRouter provider.

## Fixed scope

- [x] Launch an interactive terminal user interface from the Anesu package.
- [x] Accept a message, submit it, and display a streamed assistant response.
- [x] Create or resume one local session identified by a stable session ID.
- [x] Persist ordered user and assistant messages in a transcript.
- [x] Emit durable lifecycle events for the turn and model request.
- [x] Support one configured real model-provider adapter through OpenRouter.
- [x] Support a deterministic local model adapter for automated tests and reproducible local runs.
- [x] Surface cancellation, timeout, configuration, and provider failures clearly.
- [x] Exit cleanly without corrupting an in-progress transcript.

## Explicitly out of scope

The first terminal agent does **not** include:

- tools, filesystem access, shell execution, browser automation, or workspace rules
- `SOUL.md`, `AGENTS.md`, skills, plugins, memory retrieval, or context compaction
- OAuth, MCP, social-media connections, or other integrations
- gateway channels, cron, daemon supervision, subagents, or durable workflow replay
- writes to an external system or any autonomous side effect
- an Agent Harness Lab runner-protocol integration

These are later slices. Do not add partial versions merely to make the terminal screen
look more sophisticated.

## Finished user experience

```text
Anesu · session 01J… · model <provider/model>

You
Explain durable execution in plain language.

Agent
Durable execution records progress so a process can recover …

Ready for your next message.
```

The terminal must also make failure state unambiguous:

```text
Model request failed: provider timeout after 30 seconds.
The message was recorded. No assistant response was committed.
```

The interface must never claim that a response, event, or persisted record exists when
the underlying operation failed.

## Architectural boundaries

Only these Anesu modules participate in this slice:

```text
anesu/src/
├── cli/             # command entry point and terminal interface
├── runtime/         # one turn lifecycle and terminal state transitions
├── context/         # bounded initial instruction and user-prompt assembly
├── models/          # provider contract, real adapter, deterministic local adapter, streaming
├── sessions/        # session identity and ordered transcript semantics
├── persistence/     # atomic local record storage and recovery on restart
├── telemetry/       # native lifecycle events and redacted diagnostics
├── artifacts/       # final turn result record
└── config/          # explicit local configuration and provider selection
```

`cli/` renders state and forwards user intent. It must not call a model or write a
transcript directly. `runtime/` owns the turn state machine. `context/` assembles only
the declared initial instruction and user prompt for this slice; it does not implement
skills, memory, workspace context, or compaction yet. `models/` owns transport and
provider-specific streaming. `persistence/` owns atomic durable writes. No module may
depend on Agent Harness Lab implementation code.

## Invariants

- [x] Every turn has a unique turn ID and belongs to exactly one session ID.
- [x] A user message is persisted before a model request starts.
- [x] An assistant message is committed only after its stream completes successfully.
- [x] A failed, timed-out, or cancelled model request creates a terminal event and result;
      it must not create a completed assistant message.
- [x] Each terminal turn has its own `turns/<turn-id>/result.json`; a later turn must never
      overwrite a prior turn's outcome.
- [x] Transcript message order matches turn order, including after restart.
- [x] Event records have a stable schema, timestamp, session ID, and turn ID.
- [x] Provider secrets and raw authorization headers never appear in terminal output,
      transcripts, events, errors, or result records.
- [x] The deterministic local provider is repeatable and does not use the network.
- [x] The real provider path is opt-in and fails with an actionable configuration error
      when credentials are unavailable.

### Crash recovery rule

After the user message is persisted, a turn is never silently discarded. On session load,
any non-terminal turn becomes `interrupted` and receives its own terminal result/event.
The runtime must not automatically resend a model request: a crash after request dispatch
can leave the provider outcome unknown and a retry could duplicate cost or output. The
user may explicitly submit a new turn after inspecting the interrupted one.

Persistence creates a turn record with its ID and non-terminal state before appending the
user message. On load, an admitted turn without a terminal result is recoverable as
`interrupted`. If the turn record exists but its user message is missing, loading fails
with a repairable incomplete-record error rather than inventing a message.

## Implementation checklist

### 1. Package and local configuration

- [x] Add executable and development scripts to `anesu/package.json`.
- [x] Select and document the terminal UI dependency or native terminal approach before
      adding it; record why it is suitable for streaming, keyboard input, tests, and
      long-lived sessions.
- [x] Define a typed, validated local configuration shape for state directory, provider,
      model, timeout, session selection, and the OpenRouter credential source.
- [x] Define safe defaults that never require a secret in a test run.
- [x] Add `.env.example` only if environment variables are actually supported; do not
      commit credentials or local paths.

### 2. Domain contracts

- [x] Define focused types for `SessionId`, `TurnId`, transcript messages, turn result,
      model request, streamed model event, and native telemetry event.
- [x] Define the minimal context builder for the declared initial instruction and user
      prompt; keep later context sources out of this slice.
- [x] Define the model-provider interface without leaking one provider's response shape
      into runtime or TUI code.
- [x] Define a finite turn state model: idle, submitting, streaming, completed, failed,
      cancelled, interrupted.
- [x] Document error and cancellation semantics on public types and modules.

### 3. Local session and evidence store

- [x] Create a session when no session ID is supplied.
- [x] Resume an existing valid session when its ID is supplied.
- [x] Create a recoverable non-terminal turn record before persisting its user message.
- [x] Persist transcript messages as append-only JSONL with deterministic serialization.
- [x] Persist lifecycle events separately from transcript messages under the owning turn.
- [x] Write `turns/<turn-id>/result.json` atomically after every terminal turn outcome.
- [x] Detect malformed or interrupted local records and fail safely with a repairable,
      actionable error rather than silently overwriting evidence.

### 4. Turn runtime

- [x] Admit one user message into the selected session.
- [x] Persist the user message before model invocation.
- [x] Emit `TurnStarted` and `ModelRequested` before streaming begins.
- [x] Forward stream chunks to the caller without letting the TUI own provider state.
- [x] Accumulate a successful complete response and commit it once.
- [x] Emit `ModelCompleted` and `TurnCompleted` on success.
- [x] Emit terminal failure or cancellation events and a failed/cancelled result when
      streaming does not complete.
- [x] On startup, locate non-terminal turns and finalize them as `interrupted` without
      creating an assistant message or reissuing a model request.
- [x] Enforce one configured timeout and one cancellation signal.

### 5. Model adapters

- [x] Implement the deterministic local provider first for repeatable automated tests.
- [x] Implement exactly one real provider adapter, OpenRouter, behind the same interface.
- [x] Support streamed text only; defer tools, structured output, and provider fallback.
- [x] Normalize provider failures into documented runtime error categories.
- [x] Capture safe model metadata and token/usage information when the provider returns it.

### 6. Terminal interface

- [x] Add `anesu chat` as the initial command.
- [x] Render session identity, selected model, user messages, streamed text, and final
      terminal status.
- [x] Disable duplicate submission while a turn is active.
- [x] Bind an interrupt to runtime cancellation and show the terminal outcome.
- [x] Render configuration and persistence errors without a stack trace by default.
- [x] Preserve a non-interactive path or test driver so automated tests do not require a
      real terminal emulator.
- [x] Keep terminal components free of model-provider, persistence-format, and Lab logic.

### 7. Documentation and learning evidence

- [x] Add an Anesu quick-start document with install, configuration, launch,
      deterministic-provider test, and real-provider manual-test commands.
- [x] Document the session record layout and event meanings.
- [x] Document the turn state model, persistence ordering, and known limitations.
- [x] Add a dedicated `development/playground/` exercise that demonstrates a successful,
      failed, timed-out, and cancelled turn and explains what to inspect.
- [x] Update Anesu architecture docs and relevant `README.md` ownership notes.

## Automated tests

### Unit tests

- [x] configuration validation and safe defaults
- [x] session ID and turn ID generation
- [x] turn-state transitions, including invalid transitions
- [x] transcript serialization and ordered append behaviour
- [x] event serialization and required correlation fields
- [x] result-record success, failure, and cancellation shapes
- [x] deterministic-provider chunks and deterministic failures
- [x] secret-redaction behaviour

### Integration tests

- [x] successful deterministic-provider turn produces the expected transcript, events, and result
- [x] resumed session appends a second ordered turn correctly
- [x] deterministic-provider failure records the user message and failed result without an assistant
      message
- [x] timeout records a timed-out result and leaves the transcript valid
- [x] cancellation records a cancelled result and leaves the transcript valid
- [x] crash after user-message persistence but before model invocation records an
      interrupted turn on restart without a model call
- [x] crash after model-request dispatch records an interrupted/unknown-outcome turn on
      restart without a duplicate model call
- [x] simulated write interruption is detected on next session load
- [x] terminal command can run non-interactively against the deterministic local provider

### Manual acceptance checks

- [x] launch the TUI and complete a deterministic-provider turn
- [x] restart the process and resume the same session
- [x] interrupt a streaming deterministic-provider turn
- [x] inspect raw `transcript.jsonl` and one turn's `events.jsonl` and `result.json`
- [x] run one OpenRouter turn using local credentials
- [x] disconnect or invalidate credentials and verify the user sees an actionable failure
- [x] inspect all saved evidence to confirm no secret is present

The successful OpenRouter check used the free `openrouter/free` model. It completed a
real streamed turn with session `session_7be8ccea650a4b88b3216a2317fd840c` and turn
`turn_68333852da2b489c89aa2e7714a289d7`. The saved evidence contained the expected
user/assistant transcript, lifecycle events, completed result, and usage metadata, with
no credential or authorization field present.

## Required validation commands

The implementation is not complete until the package supplies and runs these commands:

```bash
cd anesu
npm run typecheck
npm test
npm run build
```

Run the narrow Anesu checks first. Run the repository web typecheck after
documentation changes that affect the documentation catalogue:

```bash
cd apps/web
npm run typecheck
```

Also run:

```bash
git diff --check
```

## Current handoff

Implemented the initial Anesu slice in `anesu/`, including the
readline terminal command, runtime lifecycle, deterministic local provider, OpenRouter
adapter, local JSON/JSONL evidence store, restart recovery, redaction, tests, quick-start
documentation, and the dedicated playground exercise. The documentation catalogue was
updated for the two new Anesu guides.

Validation recorded for this slice:

- `cd anesu && npm run typecheck` — passed.
- `cd anesu && npm test` — passed; 15 tests.
- `cd anesu && npm run build` — passed.
- `npm --prefix apps/web run typecheck` — passed.
- `git diff --check` — passed.
- Playground success, provider failure, timeout, and cancellation runs — passed.
- Interactive deterministic run, session resume, and Ctrl-C cancellation — passed.
- Invalid OpenRouter credential run — produced an actionable 401/provider failure with
  no credential in terminal output or saved evidence.
- Valid OpenRouter run with `openrouter/free` — completed; evidence was inspected and
  the supplied credential was absent from all saved records.

Implementation commits: `fd08ad9` (`feat(compute-native): implement initial terminal turn slice`)
and `ab238e6` (`docs(compute-native): record initial slice handoff`).

Known limitations remain those declared in the fixed scope: no tools, workspace access,
skills, memory, plugins, gateway channels, or Lab runner integration.

## Completion gate

Before marking every item complete, verify all of the following:

- [x] The TUI executes a real turn lifecycle rather than displaying simulated output.
- [x] Deterministic-provider tests cover normal completion, provider failure, timeout, cancellation,
      persistence/restart, and event/result evidence.
- [x] The real provider remains optional and is never used by automated tests.
- [x] Evidence records are inspectable and correlated by session and turn ID.
- [x] The implementation has no tools, filesystem access, or external side effects.
- [x] Documentation, examples, commands, and directory ownership match the code.
- [x] All validation commands pass and their results are recorded in the handoff.

## Commit discipline and handoff

- [x] Commit each coherent, validated implementation section rather than accumulating one
      large end-of-plan commit.
- [x] Include the section's relevant tests and documentation in the same commit when they
      change together.
- [x] Review `git status` and each diff; preserve unrelated user changes.
- [x] Record changed files, validation results, and known limitations in the handoff.
- [x] Add the completion timestamp and all implementation commit hashes, or their range,
      before archiving this plan.

## Completion record

Completed `2026-09-15T00:54:57+02:00`. The implementation and handoff commits are
`fd08ad9` and `ab238e6`; the plan is archived under `completed/`.
