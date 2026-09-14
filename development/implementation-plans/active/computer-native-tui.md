# Computer Native terminal agent — implementation plan

**Created:** 2026-09-14T23:37:30+02:00
**Last updated:** 2026-09-15T00:13:11+02:00
**Status:** Active

## Start here

Before editing, read [repository rules](../../../AGENTS.md),
[Computer Native ownership](../../../computer-native/README.md), and the relevant
source-directory notes under [`computer-native/src/`](../../../computer-native/src/).
Keep all implementation inside `computer-native/` unless this plan explicitly calls for
a Lab documentation update.

For optional design inspiration—not code to copy—use the
[Hermes](../../../docs/research/harness-code-maps/hermes.md),
[OpenClaw](../../../docs/research/harness-code-maps/openclaw.md), and
[Waku](../../../docs/research/harness-code-maps/waku.md) maps. Each map pins its source
repository and local checkout. These references do not expand this slice's scope.

## Purpose

Build the first runnable Computer Native milestone: a local terminal agent that accepts
one user message, streams one model response, persists an inspectable session record,
and reports structured lifecycle events.

This is the initial local interface for Computer Native, comparable in role to a first
Codex CLI or Hermes terminal interface. It is intentionally a narrow, real agent turn
rather than a visual mock or a premature full agent product.

## Definition of done

The following command launches an interactive terminal session:

```bash
computer-native chat
```

A user can enter a message, see the selected model's response stream in the terminal,
and exit cleanly. The completed turn leaves durable local evidence that can be read
without the TUI:

```text
<state-directory>/sessions/<session-id>/
  transcript.jsonl
  turns/<turn-id>/
    events.jsonl
    result.json
```

The first release is complete only when the same turn lifecycle is exercised by unit
tests, integration tests using a deterministic fake model, and an opt-in manual test
against one real configured provider.

## Fixed scope

- [ ] Launch an interactive terminal user interface from the Computer Native package.
- [ ] Accept a message, submit it, and display a streamed assistant response.
- [ ] Create or resume one local session identified by a stable session ID.
- [ ] Persist ordered user and assistant messages in a transcript.
- [ ] Emit durable lifecycle events for the turn and model request.
- [ ] Support one configured model-provider adapter.
- [ ] Support a deterministic fake-model adapter for automated tests.
- [ ] Surface cancellation, timeout, configuration, and provider failures clearly.
- [ ] Exit cleanly without corrupting an in-progress transcript.

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
Computer Native · session 01J… · model <provider/model>

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

Only these Computer Native modules participate in this slice:

```text
computer-native/src/
├── cli/             # command entry point and terminal interface
├── runtime/         # one turn lifecycle and terminal state transitions
├── context/         # bounded initial instruction and user-prompt assembly
├── models/          # provider contract, real adapter, fake adapter, streaming
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

- [ ] Every turn has a unique turn ID and belongs to exactly one session ID.
- [ ] A user message is persisted before a model request starts.
- [ ] An assistant message is committed only after its stream completes successfully.
- [ ] A failed, timed-out, or cancelled model request creates a terminal event and result;
      it must not create a completed assistant message.
- [ ] Each terminal turn has its own `turns/<turn-id>/result.json`; a later turn must never
      overwrite a prior turn's outcome.
- [ ] Transcript message order matches turn order, including after restart.
- [ ] Event records have a stable schema, timestamp, session ID, and turn ID.
- [ ] Provider secrets and raw authorization headers never appear in terminal output,
      transcripts, events, errors, or result records.
- [ ] The fake model is deterministic and does not use the network.
- [ ] The real provider path is opt-in and fails with an actionable configuration error
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

- [ ] Add executable and development scripts to `computer-native/package.json`.
- [ ] Select and document the terminal UI dependency or native terminal approach before
      adding it; record why it is suitable for streaming, keyboard input, tests, and
      long-lived sessions.
- [ ] Define a typed, validated local configuration shape for state directory, provider,
      model, timeout, and session selection.
- [ ] Define safe defaults that never require a secret in a test run.
- [ ] Add `.env.example` only if environment variables are actually supported; do not
      commit credentials or local paths.

### 2. Domain contracts

- [ ] Define focused types for `SessionId`, `TurnId`, transcript messages, turn result,
      model request, streamed model event, and native telemetry event.
- [ ] Define the minimal context builder for the declared initial instruction and user
      prompt; keep later context sources out of this slice.
- [ ] Define the model-provider interface without leaking one provider's response shape
      into runtime or TUI code.
- [ ] Define a finite turn state model: idle, submitting, streaming, completed, failed,
      cancelled, interrupted.
- [ ] Document error and cancellation semantics on public types and modules.

### 3. Local session and evidence store

- [ ] Create a session when no session ID is supplied.
- [ ] Resume an existing valid session when its ID is supplied.
- [ ] Create a recoverable non-terminal turn record before persisting its user message.
- [ ] Persist transcript messages as append-only JSONL with deterministic serialization.
- [ ] Persist lifecycle events separately from transcript messages under the owning turn.
- [ ] Write `turns/<turn-id>/result.json` atomically after every terminal turn outcome.
- [ ] Detect malformed or interrupted local records and fail safely with a repairable,
      actionable error rather than silently overwriting evidence.

### 4. Turn runtime

- [ ] Admit one user message into the selected session.
- [ ] Persist the user message before model invocation.
- [ ] Emit `TurnStarted` and `ModelRequested` before streaming begins.
- [ ] Forward stream chunks to the caller without letting the TUI own provider state.
- [ ] Accumulate a successful complete response and commit it once.
- [ ] Emit `ModelCompleted` and `TurnCompleted` on success.
- [ ] Emit terminal failure or cancellation events and a failed/cancelled result when
      streaming does not complete.
- [ ] On startup, locate non-terminal turns and finalize them as `interrupted` without
      creating an assistant message or reissuing a model request.
- [ ] Enforce one configured timeout and one cancellation signal.

### 5. Model adapters

- [ ] Implement the deterministic fake model first for repeatable automated tests.
- [ ] Implement exactly one real provider adapter behind the same interface.
- [ ] Support streamed text only; defer tools, structured output, and provider fallback.
- [ ] Normalize provider failures into documented runtime error categories.
- [ ] Capture safe model metadata and token/usage information when the provider returns it.

### 6. Terminal interface

- [ ] Add `computer-native chat` as the initial command.
- [ ] Render session identity, selected model, user messages, streamed text, and final
      terminal status.
- [ ] Disable duplicate submission while a turn is active.
- [ ] Bind an interrupt to runtime cancellation and show the terminal outcome.
- [ ] Render configuration and persistence errors without a stack trace by default.
- [ ] Preserve a non-interactive path or test driver so automated tests do not require a
      real terminal emulator.
- [ ] Keep terminal components free of model-provider, persistence-format, and Lab logic.

### 7. Documentation and learning evidence

- [ ] Add a Computer Native quick-start document with install, configuration, launch,
      fake-model test, and real-provider manual-test commands.
- [ ] Document the session record layout and event meanings.
- [ ] Document the turn state model, persistence ordering, and known limitations.
- [ ] Add a dedicated `development/playground/` exercise that demonstrates a successful,
      failed, timed-out, and cancelled turn and explains what to inspect.
- [ ] Update Computer Native architecture docs and relevant `README.md` ownership notes.

## Automated tests

### Unit tests

- [ ] configuration validation and safe defaults
- [ ] session ID and turn ID generation
- [ ] turn-state transitions, including invalid transitions
- [ ] transcript serialization and ordered append behaviour
- [ ] event serialization and required correlation fields
- [ ] result-record success, failure, and cancellation shapes
- [ ] fake-model deterministic chunks and deterministic failures
- [ ] secret-redaction behaviour

### Integration tests

- [ ] successful fake-model turn produces the expected transcript, events, and result
- [ ] resumed session appends a second ordered turn correctly
- [ ] fake-model failure records the user message and failed result without an assistant
      message
- [ ] timeout records a timed-out result and leaves the transcript valid
- [ ] cancellation records a cancelled result and leaves the transcript valid
- [ ] crash after user-message persistence but before model invocation records an
      interrupted turn on restart without a model call
- [ ] crash after model-request dispatch records an interrupted/unknown-outcome turn on
      restart without a duplicate model call
- [ ] simulated write interruption is detected on next session load
- [ ] terminal command can run non-interactively against the fake model

### Manual acceptance checks

- [ ] launch the TUI and complete a fake-model turn
- [ ] restart the process and resume the same session
- [ ] interrupt a streaming fake-model turn
- [ ] inspect raw `transcript.jsonl` and one turn's `events.jsonl` and `result.json`
- [ ] run one real-provider turn using local credentials
- [ ] disconnect or invalidate credentials and verify the user sees an actionable failure
- [ ] inspect all saved evidence to confirm no secret is present

## Required validation commands

The implementation is not complete until the package supplies and runs these commands:

```bash
cd computer-native
npm run typecheck
npm test
npm run build
```

Run the narrow Computer Native checks first. Run the repository web typecheck after
documentation changes that affect the documentation catalogue:

```bash
cd apps/web
npm run typecheck
```

Also run:

```bash
git diff --check
```

## Completion gate

Before marking every item complete, verify all of the following:

- [ ] The TUI executes a real turn lifecycle rather than displaying simulated output.
- [ ] Fake-model tests cover normal completion, provider failure, timeout, cancellation,
      persistence/restart, and event/result evidence.
- [ ] The real provider remains optional and is never used by automated tests.
- [ ] Evidence records are inspectable and correlated by session and turn ID.
- [ ] The implementation has no tools, filesystem access, or external side effects.
- [ ] Documentation, examples, commands, and directory ownership match the code.
- [ ] All validation commands pass and their results are recorded in the handoff.

## Commit discipline and handoff

- [ ] Commit each coherent, validated implementation section rather than accumulating one
      large end-of-plan commit.
- [ ] Include the section's relevant tests and documentation in the same commit when they
      change together.
- [ ] Review `git status` and each diff; preserve unrelated user changes.
- [ ] Record changed files, validation results, and known limitations in the handoff.
- [ ] Add the completion timestamp and all implementation commit hashes, or their range,
      before archiving this plan.
