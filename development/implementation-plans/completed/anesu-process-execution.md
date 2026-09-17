# Anesu process execution

**Created:** 2026-09-15T16:45:31+02:00  
**Last updated:** 2026-09-15T17:48:00+02:00  
**Status:** Completed  
**Owner:** Anesu standalone runtime  
**Filename:** `anesu-process-execution.md`

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [Anesu rules](../../../anesu/AGENTS.md)
- [Anesu ownership](../../../anesu/README.md)
- [Anesu source ownership](../../../anesu/src/README.md)
- [tool ownership](../../../anesu/src/tools/README.md)
- [security ownership](../../../anesu/src/security/README.md)
- [workspace ownership](../../../anesu/src/workspace/README.md)
- [runtime ownership](../../../anesu/src/runtime/README.md)
- [persistence ownership](../../../anesu/src/persistence/README.md)
- [turn lifecycle](../../../anesu/docs/turn-lifecycle.md)
- [implementation plan lifecycle](../README.md)
- [completed workspace and filesystem capability](../completed/anesu-workspace-filesystem.md)

Reference maps reviewed for this plan:

- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md)
- [Hermes code map](../../../docs/research/harness-code-maps/hermes.md)

The reference implementations are design input, not dependencies. Anesu
remains standalone and must not import their code or Agent Harness Lab implementation
modules.

## Purpose

Add the first real local process capability to Anesu so the agent can run
bounded, non-interactive commands such as tests, builds, formatters, and repository
inspection commands after an explicit approval. The slice must make the command, working
directory, limits, approval decision, process outcome, and evidence inspectable. It must
also make the security limit clear: a workspace root controls the starting directory and
path policy, but does not turn an ordinary host process into an OS sandbox.

This is the next slice after the completed workspace and filesystem capability. It is a
process-execution slice, not the implementation of the later browser, memory, skills,
plugins, or external-integration categories.

## Definition of done

From `anesu/`, this real local flow works with the existing configured
provider:

```bash
pnpm run chat
```

The normal command uses the workspace and evidence paths from `.env` or their safe local
defaults. Extra `--workspace`, `--state-dir`, and `--message` flags remain available for
isolated checks, but they are not part of the daily path.

The model proposes a `run_command` call using a structured executable and argument list.
The terminal shows the exact command preview, workspace-relative working directory,
sanitized environment profile, and resource limits. The user approves once. Computer
Native resolves and rechecks the executable, starts the actual local child process, streams
bounded activity, and returns stdout, stderr, exit status, signal, duration, and truncation
information to the model. The turn and process evidence can be inspected afterward.

If approval is denied, the command is invalid, the working directory is outside the
workspace, a limit is exceeded, the process is cancelled, or the process exits non-zero,
the user receives a typed actionable result and no false success is reported.

```text
model tool call
  → tool schema and argument validation
  → workspace/security preflight
  → exact approval request
  → executable identity recheck
  → real local process
  → bounded stdout/stderr and exit outcome
  → model-visible result, TUI activity, and durable evidence
```

## Scope

- [x] Add one model-facing `run_command` tool with a small structured interface:
      executable, argument array, optional workspace-relative `cwd`, and optional bounded
      timeout override. Do not accept an opaque shell script as the first interface.
- [x] Add a deep process-execution interface and a local process adapter backed by
      Node's child-process primitives. The adapter must execute the exact argv without an
      implicit shell, shell interpolation, or command rewriting.
- [x] Make every command explicitly approval-gated in this standalone terminal slice.
      Approval must bind the exact executable identity, argv, cwd, environment profile,
      and limits that will be launched.
- [x] Resolve the default cwd to the configured workspace root and validate requested
      cwd values through the existing workspace/security policy. Reject traversal,
      absolute model paths, symlink escapes, missing directories, and non-directories.
- [x] Use a minimal sanitized child environment. Never pass the model's arbitrary
      environment map, provider credentials, or the parent process's complete environment
      to a child process.
- [x] Enforce maximum argument count/bytes, process duration, output bytes, and one
      foreground process per tool call. Make all limits configurable with safe defaults
      and visible in the approval request.
- [x] Capture stdout and stderr separately, preserve their bounded ordering metadata where
      practical, redact known secrets before model display/evidence, and mark truncation.
- [x] Handle successful exit, non-zero exit, signal termination, spawn failure, timeout,
      output-limit termination, cancellation, and ambiguous process state as distinct
      outcomes.
- [x] Integrate process approval and lifecycle events with the existing runtime, TUI,
      tool registry, persistence, telemetry, and model/tool loop without moving process
      orchestration into the terminal renderer.
- [x] Persist a pre-launch execution record and terminal execution result. A restart must
      reconcile an incomplete process record without automatically rerunning the command.
- [x] Add deterministic tests using real local child processes and a manual acceptance
      path using the configured real model. The deterministic provider remains the test
      default and never uses the network.
- [x] Document the command contract, approval semantics, environment restrictions,
      resource limits, non-sandbox guarantee, recovery behaviour, and runnable examples.

## Explicitly out of scope

- Browser interaction, memory, skills, plugins, external integrations, gateway routing,
  scheduled work, subagents, and platform-runner integration.
- Background process sessions, daemon supervision, process polling, process logs after
  the turn ends, and server lifecycle management.
- Interactive stdin, PTYs, terminal resize negotiation, password prompts, sudo/elevation,
  and commands that require an interactive terminal.
- Remote, container, SSH, sandbox-service, or platform-specific execution adapters. The
  first adapter is the local host process adapter only.
- Shell grammar such as pipelines, redirection, command substitution, heredocs, and
  implicit `cd`. Use structured argv and the approved cwd; a later shell-language slice
  may define a separate higher-risk interface.
- Automatic command retries, automatic approval, durable allow-always grants, and claims
  of exactly-once process execution.
- OS-level sandboxing, network isolation, filesystem virtualization, or a guarantee that
  a command cannot access paths outside the workspace after it starts. The approval view
  must state this limitation instead of implying isolation.
- Automatic replay after a crash or lost acknowledgement. A process may have completed
  after the parent lost its acknowledgement; the result is recorded as ambiguous when it
  cannot be established safely.

## Reference alignment and design decisions

The reference review informs the seam and guarantees, not the scope of this project.

| Reference | Pattern adopted | Anesu decision |
| --- | --- | --- |
| OpenClaw exec approval and tool-policy paths | Policy, approval, execution preparation, and process launch are separate; approval binds the execution context and fails closed when the approval surface is unavailable. | Keep `tools/`, `security/`, approval handling, and the process adapter separate. Recheck the resolved executable, argv, cwd, and limits after approval and immediately before launch. A terminal approval is authorization for one exact call, not a sandbox. |
| OpenClaw host-exec documentation | Host execution policy, working directory, executable identity, and output/result handling have different responsibilities. | Record the effective execution host as `local`, expose the cwd and exact argv in the approval view, and never imply that workspace containment constrains process side effects. |
| Hermes turn phases and terminal guards | Turn admission, tool dispatch, environment policy, pre-execution guards, bounded execution, and result transformation are distinct phases. | Keep process execution behind a deep interface and use typed preflight/result phases. Do not put command policy or child-process lifecycle inside the TUI or model provider. |
| Hermes terminal environments | Execution backends are adapters and their isolation guarantees vary. | Implement only the local adapter now, name its guarantee precisely, and leave a real seam for a future container/remote adapter without pretending one exists. |

Important non-adoptions:

- Do not copy either project's broad command syntax, background process product, remote
  environment catalog, or policy configuration surface into this slice.
- Do not use regex heuristics as the primary security boundary. Structured argv,
  explicit approval, executable identity checks, environment minimization, and resource
  limits are the authoritative controls here. Any warning heuristic is advisory only.
- Do not reuse the workspace mutation record for a process. A process has different
  lifecycle and ambiguity semantics; it gets a typed execution record while sharing the
  common approval admission path where that is genuinely useful.

## Finished behaviour

### User-visible behaviour

- The actual registered tool list contains `run_command` only when process execution is
  enabled by configuration. It must not advertise shell, background, PTY, or remote tools
  that are not implemented.
- A tool activity row shows a safe command preview, relative cwd, and `awaiting approval`,
  `running`, `completed`, `failed`, `timed out`, `cancelled`, or `ambiguous` status.
- Approval shows the exact argv, resolved executable path, cwd, environment profile name,
  timeout, output cap, and the warning that local process execution is not a sandbox.
- A denied or unavailable approval starts no child process and returns a model-visible
  denial without claiming that the command ran.
- A completed command returns bounded stdout and stderr, exit code or terminating signal,
  duration, and whether output was truncated. Non-zero exit is an observed command result,
  not a successful command.
- A timeout or output-limit breach terminates the process group when the platform allows
  it, waits only for the configured termination grace period, and reports whether
  termination was confirmed. If it cannot be confirmed, the result is `ambiguous`.
- Ctrl-C cancels the active approval or process. A late approval cannot start a process
  after cancellation.
- Non-interactive execution and `--message` have no approval callback, so process calls
  fail closed rather than waiting forever or running without review.

### Ownership and boundaries

```text
tools/            → model-facing schema, argument validation, dispatch, safe result shape
security/         → process policy, cwd authorization, env/secret rules, limits, redaction
workspace/        → workspace-root path resolution and directory validation
process/          → process interface, local adapter, spawn, capture, termination, identity
runtime/          → turn deadline, approval pause, cancellation, tool-round lifecycle
persistence/      → execution records, atomic state transitions, recovery/reconciliation
telemetry/        → ordered lifecycle events and diagnostic metadata
cli/              → approval prompt, factual activity/status rendering, user cancellation
models/           → provider transport and normalized model/tool-call events only
```

Use a deep process module with one small external interface. The runtime and tests should
depend on that interface, while the local child-process implementation remains an adapter.
The interface includes the invariants that matter to callers: argv is exact, cwd has
already passed authorization, the environment is a named sanitized profile, output is
bounded, cancellation is best effort with an explicit outcome, and no retry occurs after
an ambiguous launch.

Approval should share only the common admission/decision lifecycle already justified by
workspace mutations: request, wait with a deadline, allow once/deny/unavailable, and late
decision rejection. Keep process-specific request fields and workspace-mutation previews
typed and distinct; do not flatten their risk or result semantics into a generic string.

- `tools/` is the sole model-facing action surface.
- `security/` is the sole owner of whether a proposed process context is authorized.
- `process/` is the sole owner of child-process handles and termination attempts.
- `persistence/` is the sole writer of durable execution records and execution evidence.
- `runtime/` owns the in-flight process deadline and does not retry it automatically.
- `cli/` may render and answer approval, but cannot call `spawn`, resolve executables, or
  write evidence directly.
- No process implementation imports Agent Harness Lab control-plane code.

## State, persistence, and evidence

Extend each turn with process-specific records while preserving the existing round and
mutation record ownership:

```text
<state-directory>/sessions/<session-id>/
  session.json                          # existing session record
  turns/<turn-id>/
    turn.json                            # existing turn state
    events.jsonl                         # lifecycle and process event references
    rounds.jsonl                         # model/tool round evidence
    executions/<execution-id>.json       # one atomic process lifecycle record
    result.json                           # existing terminal turn result
```

An execution record contains only safe bounded data:

- execution ID, call ID, session ID, turn ID, schema version, and timestamps;
- exact argv in a redacted/display-safe form plus a stable argv hash;
- resolved executable path and identity binding sufficient to detect replacement;
- workspace-relative cwd and cwd identity/hash where needed;
- environment profile name and safe environment-key list, never environment values;
- configured limits and approval identity/decision;
- `prepared`, `approved`, `running`, `completed`, `failed`, `cancelled`, or `ambiguous`
  state;
- bounded stdout/stderr, byte counts, truncation flags, exit code, signal, and termination
  confirmation;
- typed failure category and safe diagnostic.

Write order and recovery rules:

- Persist `prepared` before requesting approval or starting a child.
- Persist the approval decision before launch. Approval is not proof that launch occurred.
- Persist `running` with the child identity before treating output or exit events as final.
- Persist one terminal execution state atomically. A different terminal rewrite is an
  error; duplicate identical completion is safe to inspect.
- `rounds.jsonl` records that the tool was requested and completed, while the execution
  record owns process-specific detail. Raw provider headers, API keys, complete ambient
  environments, and unbounded output never enter either record.
- On restart, a `prepared` record without approval becomes unavailable/denied. An
  approved record without a launch identity remains not-launched. A `running` record is
  reconciled by checking the recorded process identity when the platform supports it;
  otherwise it becomes `ambiguous`. No record causes an automatic rerun.
- If a process can be safely identified as still running, recovery may make one bounded
  termination attempt according to the stored execution identity. If identity cannot be
  confirmed, recovery must not kill an unrelated reused PID.
- Metrics include process count, duration, output bytes, exit/signal outcome, timeout,
  cancellation, and ambiguity counts. They do not claim exactly-once execution.

## Failure, retry, and recovery semantics

- Invalid argv, NUL bytes, unsupported fields, limit violations, cwd failures, and
  executable-resolution failures are rejected before approval and before spawn.
- Missing approval, approval denial, approval timeout, turn cancellation while waiting,
  and process-policy denial are distinct non-execution outcomes.
- A changed executable identity, cwd identity, argv, environment profile, or limit after
  approval invalidates the approval and prevents launch.
- A successful spawn followed by exit code `0` is `completed`. A successful spawn with a
  non-zero exit code is also a completed observation with `ok: false`; the model may use
  the result to decide what to do next.
- A signal, spawn error, timeout, output-limit termination, and cancellation have distinct
  typed outcomes. A tool result must say whether the child was started.
- A timeout or output-limit breach makes one termination attempt and waits for a bounded
  grace period. It never starts a replacement automatically.
- Cancellation is propagated to the child. If the child ignores termination or its final
  state cannot be confirmed, report `ambiguous` and preserve that fact in evidence.
- A crash after launch is an ambiguous side-effect boundary. Restart never reruns the
  command, even if the command is normally safe or idempotent.
- Duplicate or out-of-order execution transitions are rejected. Duplicate terminal
  observations are accepted only when their immutable identity and result match.
- A process result is returned to the model as bounded observation data; it is not
  interpreted as a successful mutation or converted into an assistant success message.

## Security and configuration

- Add configuration for process mode (`deny` or approval-required local execution),
  maximum process duration, termination grace period, argument count/bytes, stdout/stderr
  bytes, and maximum process calls per turn. The safe default is approval-required only
  when the interactive approval surface exists; all other surfaces fail closed.
- Resolve `cwd` only relative to the configured workspace root. Reject traversal,
  absolute model paths, symlink escapes, non-directories, and reserved internal paths.
- Resolve the executable through the configured child `PATH`, record its real path and
  identity, and recheck it immediately before launch. Do not execute a different binary
  merely because `PATH` changed while approval was pending.
- Spawn with direct argv and `shell: false`. Do not accept model-provided shell text,
  shell flags, arbitrary environment assignments, stdin data, or privilege-elevation
  requests in this slice.
- Build a minimal child environment from an explicit allowlist needed for ordinary local
  commands. Exclude provider keys, credentials, tokens, passwords, private keys, proxy
  secrets, and arbitrary parent-process variables. Record only the profile name and keys.
- Redact known configured secret values, bearer tokens, and sensitive command/output
  patterns before terminal display, model result, event payload, and durable evidence.
  Secret redaction is defense in depth; it is not a replacement for environment
  minimization.
- Enforce output and time limits while the process is running. Never buffer unbounded
  output in memory, event records, or the model context.
- Make the approval warning explicit: a local command can access the host filesystem,
  network, credentials available through files, and other processes according to OS
  permissions. Anesu does not claim a sandbox until a separately implemented
  isolation adapter exists.
- Document that approval reduces accidental execution risk but is not a complete
  authorization boundary for every consequence of an approved host command.

## Implementation checklist

### 1. Contracts and configuration

- [x] Define `ProcessRequest`, `ProcessApprovalRequest`, `ProcessExecutionRecord`,
      `ProcessResult`, typed process states, and typed failure categories.
- [x] Define structured `run_command` arguments and schema validation. Reject empty
      executable names, NUL/control bytes, unsupported fields, oversized args, and
      unsupported stdin/shell/background fields.
- [x] Define the process interface and local adapter contract, including exact argv,
      sanitized environment profile, cwd identity, output limits, cancellation, and
      termination confirmation.
- [x] Add config parsing, safe defaults, validation, and safe configuration summaries.
- [x] Decide whether the existing mutation approval callback is widened through a small
      typed approval seam or adapted at the application layer; preserve operation-specific
      request fields either way.

### 2. Security and process implementation

- [x] Add security-owned cwd authorization, executable resolution/binding, environment
      construction, command preview redaction, and process limits.
- [x] Implement the local process adapter with direct argv spawn, separate stdout/stderr,
      bounded streaming capture, process-group termination where supported, and a bounded
      termination grace period.
- [x] Implement result classification for spawn errors, exit codes, signals, timeout,
      output limit, cancellation, and ambiguous termination.
- [x] Add immutable execution-record transitions and persistence/reconciliation helpers.
- [x] Keep child-process handles private to the process module and ensure all paths close
      listeners and release handles on every terminal outcome.

### 3. Runtime, tool, and TUI integration

- [x] Register `run_command` with an accurate model-facing description that explains the
      structured argv contract and non-interactive limitation.
- [x] Route every call through security preflight, exact approval, process execution, and
      bounded result serialization. Unknown and malformed calls fail without spawning.
- [x] Pause the model/turn deadline while waiting for interactive approval consistently
      with the existing mutation flow, then apply the execution deadline after launch.
- [x] Emit typed process activity events for approval, start, output progress, completion,
      timeout, cancellation, and ambiguity.
- [x] Render factual command activity and approval details in the terminal without adding
      fake tool state, fake output, or a shell prompt that the implementation does not
      provide.
- [x] Add model-visible process results to the bounded tool loop and preserve ordinary
      chat behaviour when no process tool call occurs.

### 4. Documentation and learning material

- [x] Update Anesu, tools, security, runtime, persistence, and workspace notes
      with the process interface and ownership map.
- [x] Document structured argv examples for `npm test`, `git status`, and a project-local
      script, including approval and output-limit behaviour.
- [x] Document the non-sandbox guarantee, sanitized environment, no-shell/no-PTY scope,
      cancellation semantics, and ambiguous restart outcome.
- [x] Add a playground procedure that runs a real harmless local command, denies one
      command, observes a non-zero exit, triggers a timeout, and inspects execution
      evidence without using a real credential or destructive target.

## Test coverage

### Unit tests

- [x] validate structured argv, control/NUL bytes, argument count/size, timeout, output,
      cwd, and configuration limits
- [x] resolve cwd containment, symlink behaviour, reserved paths, and executable identity
      binding/recheck
- [x] build the sanitized environment and verify secret/provider variables are absent
- [x] redact sensitive command previews, stdout/stderr, and error text
- [x] capture separate stdout/stderr with exact byte counts, truncation, and ordering
- [x] map exit code, signal, spawn error, timeout, output limit, cancellation, and
      ambiguous termination to stable result categories
- [x] enforce immutable execution-record transitions, duplicate terminal handling, and
      redacted serialization
- [x] verify approval request identity, late approval rejection, denial, timeout, and
      unavailable approval

### Integration tests

- [x] deterministic model requests `run_command` for a real harmless local script and the
      model receives the actual bounded result
- [x] successful command returns exit code `0`, stdout, stderr, duration, and evidence
- [x] non-zero command exit is observed as a failed command result without falsely failing
      the enclosing model/tool loop
- [x] approval denial and non-interactive execution prove no child process started by
      checking an external marker file
- [x] cwd traversal, absolute/outside cwd, symlink cwd, invalid executable, and reserved
      path requests are rejected before spawn
- [x] a changed executable or request after approval invalidates the approval before launch
- [x] timeout and output-limit tests terminate the child, bound evidence, and report
      termination confirmation accurately
- [x] Ctrl-C cancels both pending approval and a running child without a final assistant
      success message
- [x] secret environment variables are not inherited and known secret output is redacted
- [x] restart before launch, during launch, and after a process result produces correct
      reconciliation without automatic replay
- [x] duplicate/out-of-order execution records and events are rejected or safely
      de-duplicated according to the documented identity rules
- [x] TUI activity shows only actual approval/start/output/completion events and remains
      usable for ordinary chat

### Manual acceptance checks

- [x] In a throwaway workspace, ask the real configured free OpenRouter model to run a
      harmless `node -e` command using structured argv, approve it, and verify the real
      output and completed execution record.
- [x] Ask the configured model to run `git status --short` from a throwaway workspace,
      approve it, and verify the command identity and typed ambiguous timeout outcome
      when the configured one-second process limit was exceeded.
- [x] Deny a proposed command in the playground and confirm no child process started.
- [x] Run a harmless command that exits non-zero and verify the agent reports the exit
      status instead of claiming success.
- [x] Run harmless timeout and output-limit fixtures and verify termination, bounded
      output, and typed results.
- [x] Inspect execution records, round evidence, and lifecycle events; verify no
      provider key, complete environment, or unbounded output is present.

## Required validation commands

```bash
cd anesu
pnpm run typecheck
pnpm test
pnpm run coverage
git diff --check
```

Manual real-provider checks require a local ignored `.env` with a valid development
provider configuration. They are not a substitute for deterministic tests and must use a
throwaway workspace, harmless commands, and no credentials in command arguments or test
fixtures.

## Completion gate

Before moving this plan to `completed/`, verify:

- [x] Every scope checkbox is complete, with no deferred item hidden as implemented.
- [x] The end-to-end flow launches a real local process through the approved structured
      interface and produces inspectable evidence.
- [x] Approval, cwd, executable binding, environment minimization, output limits, timeout,
      cancellation, and non-sandbox disclosure are implemented and tested.
- [x] Restart and ambiguous-process semantics are implemented and tested without replay.
- [x] The TUI and model-visible results describe only actual execution outcomes.
- [x] Documentation and playground instructions match the implementation.
- [x] All required validation commands pass and the known limitations are recorded.

## Commit discipline and handoff

- [x] Divide implementation into reviewable sections such as contracts/configuration,
      process/security adapter, runtime/persistence integration, TUI, and documentation.
- [x] Run the narrow validation relevant to each coherent section before committing it.
- [x] Review `git status` and each diff; preserve unrelated user changes in the shared
      worktree.
- [x] Record changed files, validation results, manual observations, and known limitations
      in the completion record.
- [x] Record that no implementation commit was created because the shared worktree was
      already dirty; the changed files remain available for the user to review and commit
      as a focused range.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `2026-09-15T17:48:00+02:00`  
**Commits:** `None; implementation remains uncommitted in the shared dirty worktree.`

### Validation

- `pnpm run typecheck` — passed.
- `pnpm test` — passed; 119 tests.
- `pnpm run coverage` — passed; 87.19% line coverage and 76.23% branch coverage.
- `git diff --check` — passed.
- `node development/playground/anesu-terminal-turn/run.mjs` — passed; approved,
  denied, non-zero, timeout, and durable evidence fixtures completed.
- Real configured OpenRouter check — passed for harmless `node` argv; a real `git status`
  check produced the expected typed `process-ambiguous` result under a one-second limit.

### Known limitations

- Local execution is not an OS sandbox. Approved commands may access host resources
  available to the executable.
- Shell grammar, PTY/stdin interaction, background processes, remote/container adapters,
  and stronger OS isolation remain separate follow-on slices.
- The shared worktree was not committed by this implementation pass so unrelated user
  changes remain untouched.

### Historical-scope note

This plan records the first local foreground process slice. Later plans may add shell
syntax, background/PTY lifecycle, or isolated execution adapters without changing the
guarantees recorded here.
