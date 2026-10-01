# Lina first slice

This guide runs one local terminal turn and shows where its evidence goes.

## Install and test

From the repository root, install the workspace once:

```bash
pnpm install
pnpm --filter @agent-harness-lab/lina run typecheck
pnpm --filter @agent-harness-lab/lina test
pnpm --filter @agent-harness-lab/lina coverage
```

The package uses Node's built-in `readline` interface and a local terminal renderer. It
does not require a terminal UI framework. The default provider is the deterministic local
provider, which does not use the network.

## Run one turn

For the normal interactive path, use the saved local configuration:

```bash
cd lina
pnpm run chat
```

Type a normal prompt such as:

```text
Say hello in one sentence, then tell me which model is serving this turn.
```

Type `/help` to see commands. Use `/status`, `/context`, `/history`, `/memory`, and
`/evidence` to inspect the session. `/context` shows the latest bounded model-input
snapshot, source decisions, byte accounting, token-estimate quality, and compaction
without dumping raw source content. A line ending in `\\` continues into a multiline prompt. Type
`/quit` to leave normally. Press Ctrl-C during a model request or approval to cancel it;
when the composer is idle, the first Ctrl-C clears a draft and the next exits. Ctrl-D
also exits. Resume the session with:

```bash
pnpm run chat --session <session-id>
```

With browser use enabled, search naturally, for example: `Search the web for the latest
Ubuntu LTS release and summarize the official Ubuntu result.` Lina opens the configured
search engine in its isolated browser and reads results through Cua. Bing is the default;
set `LINA_BROWSER_SEARCH_PROVIDER=duckduckgo` or `google` to use another provider. In an
interactive chat, the isolated browser stays available for follow-up prompts in the same
conversation and closes when Lina exits.

The workspace tools are bounded and accept workspace-relative paths only. `stat` reports
metadata without reading contents, and `search_files` performs bounded literal searches
while skipping hidden, generated, sensitive, symbolic-link, oversized, and binary files.
`write_file` previews a complete one-file replacement or creation and uses the same
approval gate as `apply_patch`; `mkdir` previews one directory creation, requires its
parent to exist, and treats an existing directory as a no-op. Paths outside the
configured workspace, oversized files, and non-UTF-8 files are rejected by direct
reads; `delete` quarantines one regular file and returns a restore token, while
`restore` uses that token without overwriting an existing path. `delete_directory_tree`
is the separate recursive operation: it preflights a bounded tree, rejects links and
special files, moves the tree to quarantine, and returns a token for
`restore_directory`. `purge_quarantine` permanently removes one exact token and is
irreversible. In an interactive TTY, side-effecting tools show a shared review panel with
risk, exact target, and bounded preview. Its first action is highlighted on open; use the
Up/Down arrows to move and Enter to confirm. Escape or Ctrl+C cancels, while `v` reveals
additional details. Typing a letter cannot approve an action. Non-TTY input uses an
explicit line prompt; non-interactive commands without an approval channel fail closed.
`copy` and `move` likewise require approval, operate on regular files, reject an existing
destination, and recheck the source hash before the operation. `apply_patch_set` reviews
2–16 file patches together, caps the aggregate resulting content at
`LINA_MAX_PATCH_SET_BYTES` (256 KiB by default), and journals each member with
a workspace-local temporary path; it does not claim all-or-nothing filesystem atomicity.

Durable memory is stored under the configured state directory, never implicitly in the
workspace:

```text
<state-dir>/memory/USER.md
<state-dir>/memory/MEMORY.md
<state-dir>/memory/daily/YYYY-MM-DD.md
<state-dir>/memory/index.sqlite       # rebuildable lookup index
```

Ask the real model for example operations such as:

```text
Remember that I prefer concise answers and that this repository uses pnpm. Confirm what you stored.
What do you remember about my preferences and this repository? Search durable memory and cite the memory references.
Forget the repository preference after showing me the exact entry and asking for approval.
```

`memory_search` and `memory_get` are bounded and read-only. `memory` and
`memory_forget` require the same approval panel as file, process, and browser changes.
The `memory` tool can also submit one bounded same-scope consolidation batch of up to
eight add, replace, or remove operations. The panel reviews the complete batch; the
filesystem publication is deliberately not described as a cross-file transaction.
Entries are screened for credentials, invisible control text, and common instruction
injection patterns; rejected content is not written. User and workspace memory are
loaded as a small advisory snapshot at turn start, while daily notes are retrieved only
when explicitly searched. Use `/memory` for counts and index/canonical locations; it
does not print every stored entry.
Memory deletion and batch-publication journals are maintained on CLI startup after
interrupted-turn recovery. Only a truncated final JSONL line is repaired automatically;
other malformed evidence stops startup for deliberate repair. Completed evidence older
than 30 days is removed and duplicate identities are compacted, with a default bound of
10,000 entries per journal. Set `LINA_MEMORY_EVIDENCE_RETENTION_DAYS` or
`LINA_MEMORY_EVIDENCE_MAX_ENTRIES` in `.env` to change those bounds; prepared
deletion evidence is retained and maintenance fails closed if the safe retained set is
larger than the configured bound.

When `LINA_PROCESS_MODE=approval` (the development default), the model also
has `run_command`. It accepts an executable and exact `args` array, not a shell command
string. In an interactive TTY, Lina shows the executable, argument vector,
working directory, environment profile, and limits before showing the same approval
panel. The
runner ignores stdin, uses `shell: false`, bounds output and duration, and records the
execution under the turn evidence. The workspace is a starting directory, not a host
sandbox; use `LINA_PROCESS_MODE=deny` to remove the capability entirely.

For a direct smoke test, ask the agent to run `node` with args
`["-e", "process.stdout.write('ok')"]`. Approve it in the TUI and inspect
`turns/<turn-id>/executions/<execution-id>.json`. Non-interactive runs have no approval
channel and therefore do not start local processes.

Other structured examples are:

```text
run_command(command="pnpm", args=["test"])
run_command(command="git", args=["status", "--short"])
run_command(command="node", args=["scripts/check.mjs"], cwd="scripts")
```

Each call is approved separately. These examples pass no shell string: pipelines,
redirection, command substitution, and background operators are not interpreted.

The active browser slice is also available from the same standalone TUI. By default it
uses a Cua-owned isolated Chrome or Edge profile and does not attach to the user's
personal browser. Cua owns browser preparation, exact native-window/tab binding, semantic
snapshots, typed input, origin scope, and cleanup. The current model-facing tools are
`browser_start`, `browser_open`, `browser_tabs`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_press`, `browser_wait`, `browser_upload`, and `browser_close`.
Open only allowed HTTP/HTTPS targets. Take a fresh snapshot before an interaction, then
approve click, type, and key actions when the TUI presents the exact session, tab,
reference, and action hash. Downloads, screenshots, and native select controls remain
unavailable in this bounded slice. Attaching to an already-open Chrome or Edge profile
is currently unavailable on Linux: the pinned Cua runtime requires an exact trusted
process and window identity, but this profile has no supported least-privilege
target-discovery path. The `LINA_COMPUTER_EXISTING_PROFILE=true` opt-in does not resolve
that limitation. Use the isolated profile for now; existing-profile access must remain
disabled until a trusted, app-scoped target source is available.
Snapshots are bounded and page content is explicitly bracketed as untrusted data.
Upload sources must be regular files inside the configured
workspace. The browser slice does not yet expose arbitrary JavaScript or remote browser
providers. Personal-profile attachment is unavailable until the trusted target source
described above is implemented.
Browser sessions are limited to eight tabs by
default; change the bound with
`LINA_BROWSER_MAX_TABS`. Chromium receives only a small runtime/display
environment allowlist and does not inherit provider keys or arbitrary parent variables.
Sessions expire after 30 minutes by default; change that bound with
`LINA_BROWSER_SESSION_TIMEOUT_MS`. Expiry closes the managed browser and
rejects later browser work rather than allowing an unbounded session to remain active.
Read-only tab listing and snapshots retry one transient adapter failure by default,
within the browser action timeout; change `LINA_BROWSER_READ_RETRY_COUNT` to
adjust or disable that bound. Browser tool calls use a dedicated 30-second timeout
by default, rather than being cut off by the shorter generic tool deadline; adjust
it with `LINA_BROWSER_ACTION_TIMEOUT_MS`.
Cua owns the isolated browser profile and removes it when the Cua session ends.
Lina does not create a second browser profile, screenshot artifact, or download
artifact lifecycle. Startup may still remove bounded orphaned state left by older
runs. Downloads and screenshots remain unavailable until the installed Cua TypeScript
surface exposes the required trusted contracts.

Browser action evidence is stored under the turn directory in
`browser-actions/<action-id>.json`; lifecycle events are in `events.jsonl`. Prepared or
approved actions are not replayed after restart, and an action that was running at
shutdown is recorded as ambiguous. Managed browser profiles are removed when the
application closes normally. A browser timeout is reported separately from a
cancellation; a browser crash quarantines the session and still permits cleanup. The
Page dialogs are explicit approval points. In the TUI, use `a` to accept an alert or
confirmation, `d` to dismiss it, or `a:<text>` to accept a prompt with text. The
original browser action is still reported ambiguous because the page may have changed
around the dialog. Without an approval channel, the dialog is dismissed only to unblock
the browser and the outcome remains ambiguous. Ctrl-C during an already-started browser
action requests termination; the managed adapter closes the affected tab and reports
whether the underlying action settled. The result remains ambiguous because the external
side effect may already have happened, and uncertain browser actions are never replayed.

For a deterministic local browser check, ask the agent to start the browser and open a
local HTTP fixture or development server. The default local development allowlist is
`127.0.0.1,localhost`; change it with
`LINA_BROWSER_ALLOWED_LOCAL_HOSTS` when needed. Unsafe schemes, embedded
credentials, private targets, metadata addresses, and unsafe redirects are rejected
before the browser receives navigation.

For the complete real-model browser walkthrough, start the repository fixture server
and follow the approval prompts in the
[Lina browser playground](../../development/playground/lina-browser-turn/README.md):

```bash
node development/playground/lina-browser-turn/serve.mjs
cd lina
pnpm run chat
```

## Exercise controlled outcomes

The deterministic provider is a local adapter for reproducible checks. Its controlled
outcomes are useful for learning the persistence rules:

```bash
pnpm run chat --message "success"
pnpm run chat --deterministic-behavior failure --message "failure"
pnpm run chat --deterministic-behavior timeout --timeout-ms 25 --message "timeout"
```

Failure turns retain the user message and do not append an assistant message.

## Use OpenRouter

OpenRouter is the first real provider adapter. It is opt-in so a test or local learning
run never spends money or sends a prompt without an explicit choice. For repeated local
development, store the choice in the ignored `lina/.env` file. `LINA_PROVIDER` takes
precedence; `COMPUTER_NATIVE_PROVIDER` remains accepted as a compatibility alias for
older local development files:

```bash
cp .env.example .env
# Set these values in .env:
# LINA_PROVIDER=openrouter
# OPENROUTER_MODEL=cohere/north-mini-code:free
# OPENROUTER_API_KEY=your-local-key
pnpm run chat
```

Check the configured provider without creating a chat session or writing turn evidence:

```bash
pnpm run start doctor
```

The diagnostic uses the configured provider/model and the same bounded first-event and
total-request deadlines as a turn. A failed result names the safe category (for example
`rate-limit`, `provider-incomplete`, or `first-event-timeout`) without printing the API key.

Before the first provider event, transient provider failures may be retried within the
configured limits. Set `LINA_MODEL_RETRY_ATTEMPTS` and
`LINA_MODEL_RETRY_BACKOFF_MS` in `.env` to adjust that policy. A failure after
text or a tool call has been emitted is not retried because replay could duplicate output
or obscure a side effect. Retry attempts are recorded in the turn evidence and shown in
the TUI.

Model payloads are bounded separately from tool output. The default request limit is
512 KiB (`LINA_MAX_MODEL_REQUEST_BYTES`) and the default streamed response
limit is 256 KiB (`LINA_MAX_MODEL_OUTPUT_BYTES`). A request above its limit is
rejected before transport; output above its limit fails the turn without persisting a
partial assistant message. Lower or raise these limits in `.env` for controlled local
tests, but keep them positive integers.

The local `.env` file is not committed. Explicit environment variables and command-line
flags take precedence over it. The key is never included in the manifest, transcript,
events, result, terminal error, or browser-facing output. If the key or model is missing,
the command reports a configuration error before creating a model request.
