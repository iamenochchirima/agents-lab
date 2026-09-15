# Computer Native next standalone slice — reliable turns, terminal interface, and workspace inspection

**Created:** 2026-09-15T09:02:04+02:00
**Last updated:** 2026-09-15T09:37:12+02:00
**Status:** Active
**Working filename:** `computer-native-next.md`

The final descriptive filename will be chosen after the implementation settles. Renaming
this plan and updating every index link is an explicit completion task; the temporary
name must not be treated as the finished design decision.

## Start here

Read:

- [repository rules](../../../AGENTS.md)
- [Computer Native rules](../../../computer-native/AGENTS.md)
- [Computer Native ownership](../../../computer-native/README.md)
- [Computer Native source ownership](../../../computer-native/src/README.md)
- [turn lifecycle](../../../computer-native/docs/turn-lifecycle.md)
- [implementation plan lifecycle](../README.md)
- [TUI reference comparison](../../../docs/research/tui-reference-comparison.md)

Reference maps reviewed for this plan:

- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md)
- [Hermes code map](../../../docs/research/harness-code-maps/hermes.md)
- [Waku code map](../../../docs/research/harness-code-maps/waku.md)

These references are design input, not implementation dependencies. Computer Native
must remain standalone and must not import their code or Agent Harness Lab modules.

## Purpose

Make the standalone Computer Native terminal dependable with a real model, give it a
proper terminal interface, and then give it its first useful computer capability: a
bounded, read-only workspace inspection loop. This slice should establish the
turn/tool/security seams that later write, shell, browser, memory, and skill capabilities
can use without making those later capabilities partial.

The reference review is one design checkpoint within this implementation phase. It is not
the phase's deliverable and does not expand the scope into reproducing any of the three
products.

## Definition of done

From `computer-native/`, this flow works with the local ignored development configuration:

```bash
npm run chat
```

A contributor can submit a prompt, receive either a streamed real-model answer or a
bounded actionable provider error, and ask the agent to inspect files inside the configured
workspace. A tool-using turn produces inspectable ordered evidence, and a path outside the
workspace is rejected without reading it.

```text
terminal prompt
  → terminal application/composer
  → bounded turn runtime
  → model response or read-only tool call
  → workspace/security check
  → tool result or actionable failure
  → streamed transcript/activity view
  → final response and durable turn evidence
```

## Scope

- [ ] Make provider waits observable and bounded, including first-token, total-turn,
      cancellation, rate-limit, empty-stream, and upstream-error outcomes.
- [ ] Replace the bare line-reader presentation with a small stateful terminal application:
      transcript viewport, composer, status surface, and factual session/model/evidence
      context.
- [ ] Add multiline input, input history, slash-command completion for implemented
      commands, clean resize/redraw behaviour, Ctrl-C cancellation, and Ctrl-D exit.
- [ ] Add a typed workspace root and security-owned path-resolution policy.
- [ ] Add a model-facing tool seam with two read-only tools: `list_directory` and
      `read_file`.
- [ ] Extend the runtime to execute a bounded model/tool loop and persist each tool round.
- [ ] Keep the terminal interface usable for ordinary chat and make tool activity visible.
- [ ] Add deterministic local tool-loop coverage and one real-provider manual acceptance
      check using the configured local model.
- [ ] Record the reference alignment decisions and limitations in the implementation
      documentation without copying upstream product structure wholesale.

## Explicitly out of scope

- Lab runner protocols, control-plane adapters, Platform UI, gateway integration, or any
  other Agent Harness Lab connection.
- File writes, patches, deletion, shell execution, subprocesses, browser automation, MCP,
  external integrations, or consequential side effects.
- Skills, plugins, profiles, long-term memory, subagents, cron, daemon supervision, and
  multi-session routing.
- Automatic provider fallback or silent model substitution. A selected provider/model
  must remain visible in the session and failure evidence.
- Reproducing OpenClaw, Hermes, or Waku's complete product/runtime feature sets.
- Gateway-backed or multi-client TUI behaviour, remote reconnection, session switching,
  model pickers, approvals, subagent panels, mouse workflows, and other product-scale
  overlays. The first TUI slice must expose only Computer Native capabilities that exist.

## Reference alignment checkpoint

The following conclusions are the bounded design input for this slice.

| Reference | Direct implementation pattern reviewed | Decision for Computer Native |
| --- | --- | --- |
| [OpenClaw map](../../../docs/research/harness-code-maps/openclaw.md) — `src/agents/embedded-agent-runner/run-loop.ts`, `src/agents/agent-tools.execution-preparer.ts`, and harness selection | Preparation, executor selection, attempt/recovery loop, tool policy, approval, and execution are distinct responsibilities. | Keep `runtime/` as the turn orchestrator, keep provider transport in `models/`, and put workspace/tool authorization behind `security/` and `tools/`. Do not collapse all of those into the CLI or one generic loop module. |
| [Hermes map](../../../docs/research/harness-code-maps/hermes.md) — `agent/turn_facade.py` and `agent/turn_tool_round.py` | Turn admission and tool rounds have explicit phases; tool-call messages are persisted before side effects, and the loop has bounded interruption/recovery paths. | Persist tool-round evidence before executing each read-only tool, give each call an ID and round number, and never silently replay an incomplete model request after restart. |
| [Waku map](../../../docs/research/harness-code-maps/waku.md) — `waku/loop/agent.py` and `waku/tools/registry.py` | A small visible composition root drives a bounded reason/act/observe loop through a simple registry; observers receive model/tool events. | Start with a small internal registry and an observer/event path. Keep the interface deep enough that the CLI does not know provider or filesystem details. |
| [TUI comparison](../../../docs/research/tui-reference-comparison.md) — Hermes `ui-tui/` and OpenClaw `src/tui/` | Both treat the terminal as a stateful application: transcript viewport, composer, live status, streaming updates, activity surfaces, and explicit interruption/command flows. | Build a smaller Computer Native terminal application around typed runtime events. Borrow the interaction shape, not upstream product scope. Never render fake tools, usage, health, or capabilities. |

Preserve these project-specific decisions:

- Computer Native owns its own runtime, persistence, security, and workspace modules.
- The model adapter exposes normalized events; provider-specific response shapes do not
  leak into the runtime or terminal interface.
- The deterministic local provider remains available for tests and never uses the network.
- Tool calls are not proof of authorization; the security/workspace policy decides whether
  a call may execute.

## Finished behaviour

### User-visible behaviour

The terminal opens as a small stateful application rather than a bare prompt. Its header
identifies the selected provider/model, session, workspace, and evidence location. The
transcript keeps user and assistant turns visually distinct, and the composer supports
multiline input and input history. `/help`, `/status`, `/history`, `/evidence`, `/clear`,
and `/quit` are visible commands; command completion must not advertise commands that do
not exist.

While a request is waiting for the first model event it displays a clear waiting state.
Streaming text updates the active assistant turn. The status surface shows only factual
state such as waiting, streaming, completed, cancelled, failed, elapsed time, and safe
usage supplied by the runtime/provider. A stalled or rejected provider request ends with
an actionable message naming the selected provider/model and failure category, without
exposing credentials.

For a tool-using request, the terminal shows concise activity such as the tool name and
safe path in a separate activity area, then shows the final response in the transcript.
It never prints raw authorization material, full sensitive environment values, an
unbounded tool result, or a tool/status entry for a capability that did not execute.

### Ownership and boundaries

```text
cli/          → terminal application state, input/composer, rendering, cancellation intent,
               command dispatch, and process exit only
runtime/      → turn admission, model/tool rounds, budgets, terminal outcomes
models/       → provider transport and normalized model/tool-call events
context/      → bounded instruction, history, tool definitions, and user prompt assembly
tools/        → tool definitions, argument validation, and dispatch
workspace/    → workspace root, path resolution, file metadata, and bounded reads
security/     → authorization, path policy, size limits, and redaction decisions
persistence/  → transcript, turn state, round evidence, and atomic result records
telemetry/    → ordered lifecycle and diagnostic events
```

- `persistence/` is the sole writer for durable turn and round evidence.
- `runtime/` owns in-flight model/tool execution and is the only owner of the round budget.
- `tools/` cannot bypass `workspace/` or `security/` to access the filesystem.
- `cli/` cannot construct provider requests, resolve paths, or write evidence directly.
- `cli/` consumes typed runtime/application events; it does not implement the model/tool
  loop or infer lifecycle state from terminal text.
- No module in `computer-native/` imports Agent Harness Lab implementation code.

## State, persistence, and evidence

Extend the existing session layout without changing the ownership of current records:

```text
<state-directory>/sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/
    turn.json
    events.jsonl
    rounds.jsonl       # ordered model/tool round evidence, redacted
    result.json
```

- [ ] Every model/tool call has a stable call ID, round number, session ID, and turn ID.
- [ ] A round is recorded before its tool execution begins; tool completion is appended
      after the tool returns or is cancelled.
- [ ] `rounds.jsonl` contains normalized request/response/tool metadata, not raw secrets or
      provider authorization headers. Provider-specific diagnostics remain separately safe.
- [ ] Final transcript assistant content is committed only after a complete final response.
- [ ] A terminal result is written atomically and cannot be overwritten by a later round.
- [ ] A crash during a model/tool round becomes `interrupted` on restart without silently
      resending the ambiguous model request.
- [ ] Oversized, malformed, or out-of-order round records fail with a repairable diagnostic.
- [ ] Metrics include model request count, tool-call count, round count, duration, and safe
      usage values; cost remains `null` when the provider does not supply it.

## Failure, retry, and recovery semantics

- [ ] Provider requests have an explicit first-event deadline and total-turn deadline.
- [ ] A provider HTTP failure, rate limit, empty stream, stream termination failure, and
      timeout map to distinct safe error categories.
- [ ] No automatic provider fallback or model substitution occurs in this slice.
- [ ] Read-only tools are individually bounded by argument, output-size, and execution
      limits; an invalid tool call returns a model-visible error and consumes the round.
- [ ] The maximum number of model/tool rounds is explicit and terminal when exhausted.
- [ ] Cancellation aborts the active model request or tool, writes a terminal cancellation
      result, and does not append a final assistant message.
- [ ] A crash after a model request or tool dispatch is treated as an ambiguous outcome;
      restart records `interrupted` and does not automatically replay it.
- [ ] Duplicate tool-call IDs and duplicate terminal events are rejected or de-duplicated
      by explicit record identity.
- [ ] Read-only filesystem operations are safe to repeat, but the runtime does not claim
      exactly-once execution for model requests.

## Security and configuration

- [ ] Load provider/model settings from the ignored local `.env` for development while
      preserving explicit process variables and command-line overrides.
- [ ] Add a workspace-root setting and CLI option with a safe, documented default.
- [ ] Resolve paths relative to the workspace root, reject traversal, and define symlink
      behaviour before exposing either read-only tool.
- [ ] Enforce maximum file size, directory-entry count, output bytes, and tool duration.
- [ ] Keep API keys out of terminal output, transcript, events, rounds, result records, and
      error bodies; verify with a saved-evidence secret scan.
- [ ] Document that a workspace root is an authorization boundary, not automatically a
      process sandbox.

## Implementation checklist

### 1. Reference alignment and design record

- [ ] Re-read the pinned OpenClaw, Hermes, and Waku maps and the cited source anchors.
- [ ] Record the three adopted patterns and the explicit non-adoptions in the plan handoff.
- [ ] Define the public seams for runtime, model stream, tool registry, workspace, and
      security before adding concrete tools.
- [ ] Rename this plan to its final descriptive filename and update the plan/navigation
      indexes before archiving it.

### 2. Provider reliability

- [ ] Add first-event/first-token timeout and clear waiting-state rendering.
- [ ] Normalize empty response, incomplete stream, rate-limit, upstream timeout, and
      cancellation outcomes.
- [ ] Add a bounded `computer-native doctor` or equivalent provider-check command that
      reports selected model and safe connectivity/result diagnostics.
- [ ] Keep the pinned local development model configurable without changing deterministic
      test defaults.

### 3. Workspace and read-only tools

- [ ] Add typed workspace configuration and a deep path-resolution/read interface.
- [ ] Implement `list_directory` with bounded depth/entries and stable ordering.
- [ ] Implement `read_file` with bounded bytes, text decoding rules, and safe metadata.
- [ ] Add tool schemas, argument validation, unknown-tool handling, and model-visible errors.
- [ ] Route every filesystem access through workspace and security modules.

### 4. Bounded model/tool runtime

- [ ] Extend the normalized model stream contract to represent text, tool calls, usage, and
      completed/error outcomes without exposing OpenRouter response types.
- [ ] Build a bounded reason/act/observe loop with an explicit maximum round count.
- [ ] Persist round evidence before tool execution and append tool results afterward.
- [ ] Stream ordinary text and concise tool progress to the CLI without moving orchestration
      into terminal code.
- [ ] Apply one cancellation and timeout policy across model and tool execution.

### 5. Terminal application interface

- [ ] Define a small typed event/view-model seam for turn lifecycle, streamed assistant
      text, tool activity, notices, and terminal outcomes.
- [ ] Render a transcript viewport with distinct user/assistant/system/activity rows and
      bounded history so long sessions remain usable.
- [ ] Add a multiline composer with input history, slash-command completion, and explicit
      key handling for submit, cancel, clear, and exit.
- [ ] Add a factual header/status surface for provider/model, session, workspace, current
      turn state, elapsed time, and evidence location.
- [ ] Support terminal resize/redraw and a readable non-TTY fallback without requiring a
      terminal UI framework in automated tests.
- [ ] Keep tool activity, waiting state, and provider failures visible without moving
      orchestration, authorization, or persistence into the terminal module.

### 6. Documentation and learning material

- [ ] Document provider diagnostics, local model configuration, and the difference between
      a model timeout and a tool failure.
- [ ] Document workspace-root, path, symlink, and output-size rules with runnable examples.
- [ ] Update ownership notes for `workspace/`, `tools/`, `security/`, and `runtime/`.
- [ ] Add a playground exercise showing a real answer, a directory listing, a file read,
      a rejected path escape, a provider failure, and an interrupted round.

## Test coverage

### Unit tests

- [ ] local environment precedence and provider/model validation
- [ ] first-event timeout, total timeout, cancellation, and safe provider error categories
- [ ] empty/incomplete stream and rate-limit response handling
- [ ] workspace root containment, traversal, symlink, size, and encoding rules
- [ ] tool schema validation, unknown tools, stable listing order, and bounded output
- [ ] round state transitions, call identity, event ordering, and redaction
- [ ] maximum-round termination and no-final-assistant failure shapes
- [ ] command parsing, completion filtering, view-model state transitions, and bounded
      transcript rendering

### Integration tests

- [ ] deterministic model answer completes without tools
- [ ] deterministic model requests `list_directory`, receives a result, and then answers
- [ ] deterministic model requests `read_file`, receives bounded content, and then answers
- [ ] provider failure, empty stream, first-event timeout, and cancellation leave valid evidence
- [ ] path escape and oversized read are rejected without touching files outside the workspace
- [ ] restart during a model/tool round records an interrupted turn without replay
- [ ] terminal command uses the configured real provider and does not fall back silently
- [ ] pseudo-terminal interaction covers startup, multiline submit, streamed response,
      `/help`, `/status`, `/history`, `/evidence`, `/clear`, Ctrl-C cancellation, and
      Ctrl-D exit without leaking secrets or inventing unavailable capabilities

### Manual acceptance checks

- [ ] run `npm run chat` with the local real-provider configuration and receive a response
- [ ] ask the agent to list a known workspace directory and inspect the tool evidence
- [ ] ask the agent to read a known small file and inspect the bounded result
- [ ] attempt a path outside the workspace and verify an explicit rejection
- [ ] interrupt a slow provider/tool request and verify the terminal outcome
- [ ] run the TUI in a pseudo-terminal, resize it, submit a multiline prompt, inspect
      the status/activity surfaces, and verify clean exit
- [ ] inspect `events.jsonl`, `rounds.jsonl`, transcript, and result for correlation and
      absence of secrets

## Required validation commands

```bash
cd computer-native
npm run typecheck
npm test
npm run build
npm run chat -- --help
git diff --check
```

The real-provider manual check requires the local ignored `.env` and a currently available
configured model. Automated tests must remain deterministic and must not depend on that
credential or on network availability.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] Every applicable implementation and test checkbox is complete.
- [ ] The real-model path either responds or fails clearly within the documented deadlines.
- [ ] The read-only workspace tools are bounded, secure, observable, and independently
      testable through their public seams.
- [ ] The terminal is useful for repeated real-model interaction without requiring a
      second interface, while remaining a presentation adapter over runtime events.
- [ ] Restart, cancellation, duplicate, and ambiguous-outcome behaviour is documented and
      tested.
- [ ] Documentation, examples, and the final renamed plan match the implementation.
- [ ] Required validation commands pass and the handoff records their results.

## Commit discipline and handoff

- [ ] Commit provider reliability, workspace/security, runtime/tool-loop, and documentation
      sections as coherent validated changes.
- [ ] Include tests and documentation with the section they verify.
- [ ] Review `git status` and each diff; preserve unrelated UI/server changes.
- [ ] Record the reference alignment decisions, validation results, changed files, and
      known limitations in the handoff.
- [ ] Record the final plan filename, completion timestamp, and implementation commit range.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Final filename:** `[chosen descriptive filename]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[result]`
- `[manual check]` — `[result]`

### Known limitations

- File writes, shell execution, browser automation, memory, skills, plugins, and Lab
  integration remain later standalone slices.
