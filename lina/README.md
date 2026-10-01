# Lina

Lina is a standalone, compute-native agent harness built from the ground
up. It is temporarily developed inside the Agent Harness Lab workspace, but it must be
runnable, documented, and testable independently so it can later move to its own
repository.

It owns the agent loop, workspace, filesystem and shell tools, skills, plugins,
external-service integrations, memory, security policy, persistence, telemetry,
messaging gateway, scheduled work, and service lifecycle. Agent Harness Lab interacts
with it only through a future versioned runner protocol.

The gateway, cron scheduler, plugin system, and daemon are intentional product
boundaries, not incidental utilities. They will be implemented incrementally; their
presence in the source layout records the direction without pretending the capability
already exists.

## Current runnable slice

The current slice is a standalone terminal agent with a small stateful terminal
interface. It uses Node's standard readline interface, so there is no terminal UI
dependency to install. The deterministic local provider is the default when no local
development configuration is present. OpenRouter is available as the first real
provider through the same model contract. The agent can inspect files through bounded
workspace tools and can propose one-file `apply_patch`, complete `write_file`,
one-directory `mkdir`, empty-only non-recursive `delete_directory`, bounded quarantine
inspection, recoverable `delete`/`restore`, bounded recoverable
`delete_directory_tree`/`restore_directory`, or exact-token `purge_quarantine` changes
that require interactive approval; regular-file `copy` and `move`/rename are also
approval-gated and refuse destination replacement. A bounded `apply_patch_set` can
prepare several file patches under one approval and records partial outcomes for
reconciliation rather than claiming multi-file atomicity. When process mode is
`approval`, `run_command` can execute one exact, non-interactive local executable and
argument list after approval, with a sanitized environment, workspace-relative cwd,
bounded output/time, no shell interpretation, and durable execution evidence. The
workspace is not an operating-system sandbox, so the approval panel states that an
approved command may access other host resources.

The active browser slice adds an isolated Chrome/Edge capability behind the same tool
loop. It exposes Cua-owned browser session lifecycle, navigation, bounded semantic
snapshots with opaque element references, waits, approval-gated click/type/press and
controlled uploads. Browser URLs are checked for unsafe schemes, credentials, private
targets, metadata addresses, and unsafe redirects. Screenshots, native select controls,
and downloads remain unavailable in this bounded slice. Attaching to an already-open
personal browser is currently unavailable on Linux: the pinned Cua route requires an
exact trusted PID and window ID, but this profile has no supported least-privilege way to
discover and supply that target. Setting `LINA_COMPUTER_EXISTING_PROFILE=true` alone
does not make attachment usable; keep it disabled until Cua or a trusted host provides
the exact target without broad desktop enumeration. Isolated browser sessions remain the
supported path.
For websites, the conversation model uses the typed `browser_*` tools directly: it sees
each Cua result and chooses whether to inspect, navigate, interact, or answer. The separate
`computer` tool is for native desktop applications and uses Jev over current Cua candidates.
An isolated browser session remains open across turns for the same site. Starting a separate
task on another site replaces it with a new session scoped to that site's origin. Within an
approved public-web task, a model-supplied HTTPS destination is URL-validated and opened in a
fresh Cua session scoped to the origins already encountered plus that destination; old
references are discarded and the immutable manifest is not widened. This path has focused
test and pinned-manifest evidence, but live continuation from an off-origin link or redirect
is not yet proven and may be refused by Cua.
The browser adapter is backed by a bounded Cua browser runtime; Cua owns the browser
process, exact window/tab binding, semantic snapshots, input delivery, origin scope,
and cleanup.
Timeouts, cancellation, and browser crashes have distinct outcomes; a crashed session
is quarantined and cleaned rather than reused. Personal browser profiles, remote browser
providers, and arbitrary JavaScript remain later slices in the active implementation
plan. Page-owned dialogs are handled through their explicit approval path, subject to
the current Cua host's background-input limitations.

The computer tool is the first computer-use slice. It is opt-in and accepts a natural
language goal; users do not need to name the tool, provider, fixture, or strategy.
`LINA_COMPUTER_SURFACE=auto` routes URL/page requests to the managed browser and
desktop/window/native-input requests to the isolated Ubuntu/X11 environment when that
profile is enabled. Surface-neutral requests use the configured profile preference or
return a concise ambiguity result instead of silently choosing a host.
`LINA_COMPUTER_STRATEGY=typesafe` uses the accessibility-backed TypeSafe/Jev path over
bounded Cua candidates. Traditional vision, compare mode, and automatic fallback are
retired from production admission; their isolated strategy tests remain for regression
coverage only. The production path shares approval, execution, freshness, post-action
verification, cancellation, and restart recovery.
The TUI uses one arrow-key/Enter approval menu across tools. For an eligible
isolated browser or native task, choose the default approval for this task,
allow the displayed matching task scope for this conversation, or deny. A
conversation permission survives `/resume` for that conversation only; use
`/permissions` to inspect it and `/permissions revoke <id>` to remove it.
Personal browser profiles, mixed browser/native tasks, uploads, and tasks
without a stable match do not offer that reusable choice. A browser task
permission covers routine links and scrolling, not form typing, button clicks,
select controls, uploads, or page dialogs: those actions still prompt
separately. Changing the approved app, browser policy, input route, action
classes, or task limits also requires a new approval.
An open-only computer request can open one user-requested public URL through the
managed browser policy and return a fresh-snapshot `opened` result without forcing a
local fixture action. An explicit Ubuntu/X11 profile connects the native path to the
installed CUA Driver SDK with a visible agent cursor; it never silently attaches to the
operator's personal display.

The native environment foundation is now kept separately in
[`src/computer/`](src/computer/README.md). Lina pins CUA Driver's TypeScript SDK and
has a fake-host-tested Ubuntu/X11 adapter with named sessions, the visible CUA agent
cursor, bounded observations, and stale/duplicate-click protection. It can be
selected explicitly in normal chat with the Ubuntu/X11 environment setting; the
default remains the visible browser profile. The current native slice supports
TypeSafe/Jev accessibility actions over the exact CUA window and element tokens.
Production tasks share TUI approval, bounded multi-step re-observation, durable
run-level evidence, and restart recovery without replay. A disposable Xephyr/Xvfb
launcher is included. Optional
native screenshots can be retained as bounded managed artifacts with
`LINA_COMPUTER_ARTIFACTS_ENABLED=true`; raw provider bodies, arbitrary-application
goal verification, and OCR/visual segmentation remain separate work.
The current code-owned native launch catalog covers Notes, Calendar, Clocks, Calculator,
and Settings. Notes, Calendar opening, and Settings opening are live-proven in the
disposable Ubuntu/X11 lane. Calculator has a tested task compiler and verifier, but its
latest live Cua launch returned a process that exited before the next usable observation,
so Calculator support remains unverified. Clocks is retained as an honest matrix
case but is currently unavailable through Cua's direct Linux launch identity because its
DBus-activatable service outlives the PID returned by `launch_app`; Files and Terminal
are not exposed until Cua provides an equivalent activation contract.

The current memory slice adds durable, inspectable user, workspace, and dated daily
notes under the state directory. `memory_search` and `memory_get` are bounded read-only
tools; `memory` and `memory_forget` show an approval panel before changing canonical
Markdown. Memory is advisory context, not an authorization source, and only compact
user/workspace entries are loaded into a new turn by default. The SQLite file beside the
Markdown is a rebuildable index, not the source of truth. Node 23 currently reports the
standard-library SQLite experimental warning; the index adapter is isolated so that
runtime decision can be revisited without changing the tool or context contracts.
The memory tool also supports a bounded same-scope consolidation batch; its approval
and append-only evidence cover the complete proposal, while canonical publication does
not claim cross-file atomicity.
Memory evidence journals are repaired only for an unterminated final line during open,
and completed entries are compacted after interrupted-turn recovery on normal CLI
startup. Retention defaults to 30 days and 10,000 entries per journal; configure
`LINA_MEMORY_EVIDENCE_RETENTION_DAYS` and
`LINA_MEMORY_EVIDENCE_MAX_ENTRIES` when needed. Prepared deletion evidence
is retained, and maintenance fails closed rather than discarding evidence when the
configured bound is too small.

```bash
cd lina
pnpm install
pnpm test
pnpm run chat
```

The command creates a new session unless `--session <session-id>` is supplied. Set
`--state-dir <path>` when the evidence should live somewhere other than the default
`~/.agent-harness-lab/lina`.

### Moving from Anesu

Use `LINA_*` for configuration. Lina still reads an `ANESU_*` setting when the matching
`LINA_*` setting is absent, so an existing local `.env` keeps working while you update
it. The new default state directory is `~/.agent-harness-lab/lina`. If only the old
`~/.agent-harness-lab/anesu` directory exists, Lina continues using it in place. It does
not copy, rename, or delete session data. Set `LINA_STATE_DIR` to choose another location.

The hidden `.anesu-trash` and `.anesu-transactions` workspace directories remain reserved
because saved recovery records refer to those paths. Lina continues to read and protect
them; new project and command names use Lina. New browser profiles use `.lina-browser`.
Any old `.anesu-browser` profile folders are left untouched and are not attached
automatically.

The interactive terminal opens as a compact agent console: a branded context panel shows
the session, model, workspace, evidence location, and actual registered tools; the status
ribbon and activity lane show factual turn/tool state; and the composer has a distinct
prompt. Type `/help` for commands, `/new` to start a conversation, `/resume` to choose a
recent one, `/resume <session-id>` to resume an exact ID, `/memory` for bounded memory
status, `/computer` to inspect computer readiness without starting CUA, and `/permissions`
to inspect saved process permissions. Use `/permissions revoke <permission-id>` to revoke
one. Workspace,
process, browser, and memory changes use a review panel with approve, deny, details, and
cancel choices; the narrowest available approval is visibly selected by default. A line
ending in `\\` continues into a multiline prompt. Ctrl-C cancels an active turn or
approval, clears a draft before a second idle Ctrl-C exits, and exits cleanly when the
composer is empty; Ctrl-D, `/quit`, and `/exit` remain explicit exit paths. The default
workspace is the current directory; set `--workspace <path>` or
`LINA_WORKSPACE_ROOT` to change it.

An isolated browser remains available to later prompts in the same live conversation.
Starting `/new` or switching with `/resume` closes that conversation's live browser;
browser state is not restored after Lina exits and starts again. The browser also has a
configured maximum lifetime of 30 minutes by default, measured from session start rather
than reset after activity.

`run_command` approvals can be saved for the current conversation or local profile only
when the exact prepared request has a stable identity. A saved process permission matches
the command and arguments, working directory, sanitized environment, limits, and current
executable identity; it is not a command-prefix or shell-wide rule. Arguments redacted as
sensitive cannot be saved. Use `/permissions` and `/permissions revoke <permission-id>`
to inspect and revoke these grants. Other tools continue to expose only the approval scopes
they can enforce; saved process permissions do not authorize browser, workspace, memory,
or computer actions.

For repeated local development, copy `.env.example` to `.env`, set the provider, model,
and key, then run the normal command. The `.env` file is ignored by git and loaded
automatically. `LINA_PROVIDER` takes precedence; the older
`COMPUTER_NATIVE_PROVIDER` name is still accepted as a local development compatibility
alias so a rename cannot silently select the deterministic provider:

```bash
cp .env.example .env
# Edit .env:
# LINA_PROVIDER=openrouter
# OPENROUTER_MODEL=cohere/north-mini-code:free
# OPENROUTER_API_KEY=your-local-key
# LINA_PROCESS_MODE=approval
pnpm run chat
```

Use `pnpm run start doctor` to test the configured provider/model without creating a
chat session. The check is bounded by the configured first-event and total-request
deadlines and reports only safe diagnostics.

Explicit environment variables override `.env`, and command-line flags override both.
The key is never written to session records.
See [`docs/quick-start.md`](docs/quick-start.md) and
[`docs/turn-lifecycle.md`](docs/turn-lifecycle.md) for the evidence layout and recovery
rules.

For a short real-provider check using the stored local development environment, see the
[Lina provider acceptance playground](../development/playground/lina-provider-acceptance/README.md).
