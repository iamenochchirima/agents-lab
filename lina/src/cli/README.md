# CLI

Owns the local terminal interface: command parsing, interactive input, rendering, and
exit behaviour. The CLI adapts a person’s request into the same admission path used by
the gateway and cron scheduler; it must not contain a second agent loop.

The terminal interface uses Node's standard `readline` interface and a local renderer. It
supports `lina chat` for interactive input and `--message` for a non-interactive
test driver. Interactive sessions present a compact agent-console layout: a branded header
panel, provider/model/session/workspace/evidence context, the actual registered tool names,
a ready or active status ribbon, streaming output, a separate tool activity lane, grouped
help, and a visually distinct composer prompt. Slash commands include `/new`, `/resume`,
`/permissions`, `/help`, `/status`, `/models`, `/history`, `/skills`, `/evidence`, `/clear`,
and `/quit`; `/models` is a read-only view
of the configured provider choices and capabilities. `/status` includes the latest context
revision, pressure, and request budget. `/context` shows the last prepared
context snapshot, source decisions, byte accounting, estimated tokens, pressure, and
compaction without printing raw source bodies. `/skills` shows the current bounded,
workspace-local skill catalog; the model can load a listed skill by exact ID through
`read_skill`. Multiline continuation uses a trailing `\\`, input history is provided by
`readline`, and Ctrl-C cancels an active turn. The CLI
displays application events but the runtime owns model calls, tools, security, and
persistence. In an interactive TTY, proposed `apply_patch`, `apply_patch_set`, `write_file`,
`mkdir`, `delete`, `restore`, `copy`, `move`, and `rename` operations show a bounded review
panel with named approve, deny, inspect, and cancel choices. Unsupported input fails closed.
Non-interactive runs have no approval channel
and therefore do not perform workspace mutations.

On a TTY, approval choices are a vertical picker: the first available choice is visibly
selected, Up/Down moves focus, and Enter confirms only that selected choice. Escape or
Ctrl+C cancels; `v` reveals the additional review details. The picker does not approve on
single-letter shortcuts, so ordinary typed characters cannot accidentally grant access.
Raw-key approval panels temporarily transfer TTY input ownership away from readline and
restore it after the decision. Non-TTY approval uses an explicit line-input fallback. A
denied process is recorded once as a terminal non-started outcome.

`/new` creates a separate durable conversation. `/resume` opens a recent-conversation
picker; `/resume <session-id>` requires an exact ID and never guesses from a prefix.
Switching is refused while a turn is active. The destination must open successfully
before the current conversation is replaced, and switching closes the outgoing
conversation's live browser. `/permissions` currently lists saved process grants only:
exact-request grants scoped to this conversation or the local profile. Other tool domains
do not inherit them.

Structured TUI panels use the output stream's reported terminal width when it is available,
clamped to a readable range; approval panels use the same width as the surrounding session
panels. Existing scrollback is not repainted on resize, and the interface remains a
readline-style renderer rather than an alternate-screen viewport.

Every approval panel exposes the stable prepared-operation identity and effective approval
lifetime. Workspace mutations use their mutation ID, local processes show the execution ID
and argv hash, browser actions show the action ID and action hash, and memory operations
show their operation and call IDs. Ctrl-C is safe to repeat: the first press requests
cancellation and later presses do not create duplicate cancellation activity or terminal
evidence.

The activity lane also distinguishes a normal failure from an interrupted turn, a
partial/uncertain filesystem mutation, and an outcome-unknown process or browser action.
Those labels are observations, not claims that the external side effect was rolled back.
An ambiguous browser action remains visible in its action record and activity line; it
does not override the model turn's separate terminal status after the model continues from
fresh page evidence.

Unexpected runtime or persistence errors are rendered as a bounded failed-turn state
instead of silently closing the interactive composer. The loop remains available for a
subsequent prompt; programmatic `runSingle`/`runTurn` callers still receive the original
error after it has been rendered.

Live terminal output applies the configured provider secret and the shared bounded
credential-shape redaction before writing model text, activity summaries, status, and
approval context. The stream keeps possible secret prefixes across provider chunks so a
credential split across chunks is still redacted. This is a known-secret and recognized-
shape boundary; it is not a promise to discover arbitrary secrets in untrusted text.

Mixed durable-memory batches are rendered as one terminal activity line with their bounded
member count; the renderer does not pretend that the batch is a cross-file transaction.

The current browser slice uses a separate browser approval panel for click, type, key,
pointer, dialog, scroll, and upload actions. Downloads are not exposed because the
installed public Cua TypeScript SDK cannot carry the trusted host approval they require.
It shows the browser session, tab, document/reference,
exact action hash, optional path/byte limit, and the warning that page content is
untrusted. The browser renderer reports session, tab, snapshot, navigation, wait,
artifact, approval, and action outcomes; it never calls the Cua browser adapter directly.
Non-interactive runs have no browser approval channel and therefore fail closed for
interaction actions.

The browser is owned by the live conversation, not the individual model turn, so it is
available to follow-up prompts in that conversation. `/new`, a successful `/resume`
switch, `browser_close`, application exit, and the configured maximum session lifetime
clean it up. The default lifetime is 30 minutes from browser-session start; activity does
not extend it. Restarting Lina restores the transcript but not the live browser.
Within a conversation, same-origin follow-up tasks reuse the active session. A new task
for another site replaces it with an isolated session bound to that task's origin. During
an approved public-web task, a model-supplied HTTPS destination is validated and opened in
a fresh Cua session scoped to origins already encountered plus that destination. The old
references are discarded and the immutable manifest is not widened. The handoff has focused
test and pinned-manifest evidence; live off-origin link and redirect continuation remains
unproven and a Cua refusal is reported honestly.

The `/computer` inspection panel also shows the code-owned native application catalog
when the Ubuntu/X11 profile is enabled. This is an admission catalog, not a claim that
every listed application has a verified mutation route; live support and unavailable
matrix cells remain reported by the task result and documentation.

When process mode is `approval`, `run_command` uses a separate review panel that shows
the exact executable, JSON-quoted argument vector, cwd, sanitized environment profile,
limits, and the warning that the workspace is not an OS sandbox. It defaults to approving
only this invocation. When the prepared request can be matched without saving an argument
redacted as sensitive, the user may also approve it for this conversation or always allow
this exact request in the local profile. That matcher includes the command and argument
hash, cwd identity, sanitized environment, limits, and executable file identity; it is not
a prefix rule. `/permissions` lists those process grants and `/permissions revoke <id>`
removes one. Other tool domains do not inherit them. Process activity reports the grant
source when present, pid, termination, the bounded terminal outcome, and a concise
sanitized stdout/stderr summary when output exists. `--process-mode deny` or
`LINA_PROCESS_MODE=deny` removes the process tool from the model tool list.

The renderer must not invent tool activity, usage, health, or capability state. When a
feature is not implemented by the runtime, it is not presented as available.

`lina doctor` is a separate bounded connectivity check. It reports the
selected provider, model, workspace validation, and a short safe result without opening
a session or writing transcript evidence.
