# Computer Native

Computer Native is a standalone, computer-native agent harness built from the ground
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

The active browser slice adds an isolated local Chromium capability behind the same tool
loop. It exposes browser session lifecycle, navigation, bounded snapshots with element
references, waits/screenshots, approval-gated click/type/press actions, and controlled
upload/download artifacts. Browser URLs are checked for unsafe schemes, credentials,
private targets, metadata addresses, and unsafe redirects.
The browser adapter is Playwright-backed, but Playwright is not exposed to the model.
Timeouts, cancellation, and browser crashes have distinct outcomes; a crashed session
is quarantined and cleaned rather than reused. Personal browser profiles, remote browser
providers, arbitrary JavaScript, and page-dialog decisions remain later slices in the
active implementation plan.

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
`COMPUTER_NATIVE_MEMORY_EVIDENCE_RETENTION_DAYS` and
`COMPUTER_NATIVE_MEMORY_EVIDENCE_MAX_ENTRIES` when needed. Prepared deletion evidence
is retained, and maintenance fails closed rather than discarding evidence when the
configured bound is too small.

```bash
cd computer-native
pnpm install
pnpm test
pnpm run chat
```

The command creates a new session unless `--session <session-id>` is supplied. Set
`--state-dir <path>` when the evidence should live somewhere other than the default
`~/.agent-harness-lab/computer-native`.

The interactive terminal opens as a compact agent console: a branded context panel shows
the session, model, workspace, evidence location, and actual registered tools; the status
ribbon and activity lane show factual turn/tool state; and the composer has a distinct
prompt. Type `/help` for commands and `/memory` for bounded memory status. Workspace,
process, browser, and memory changes use the same review panel with explicit approve,
deny, details, and cancel choices; approval defaults to the safe deny selection. A line
ending in `\\` continues into a multiline prompt. Ctrl-C cancels an active turn or
approval, clears a draft before a second idle Ctrl-C exits, and exits cleanly when the
composer is empty; Ctrl-D, `/quit`, and `/exit` remain explicit exit paths. The default
workspace is the current directory; set `--workspace <path>` or
`COMPUTER_NATIVE_WORKSPACE_ROOT` to change it.

For repeated local development, copy `.env.example` to `.env`, set the provider, model,
and key, then run the normal command. The `.env` file is ignored by git and loaded
automatically:

```bash
cp .env.example .env
# Edit .env:
# COMPUTER_NATIVE_PROVIDER=openrouter
# OPENROUTER_MODEL=cohere/north-mini-code:free
# OPENROUTER_API_KEY=your-local-key
# COMPUTER_NATIVE_PROCESS_MODE=approval
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
[Computer Native provider acceptance playground](../development/playground/computer-native-provider-acceptance/README.md).
