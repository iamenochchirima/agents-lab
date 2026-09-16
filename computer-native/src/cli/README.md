# CLI

Owns the local terminal interface: command parsing, interactive input, rendering, and
exit behaviour. The CLI adapts a person’s request into the same admission path used by
the gateway and cron scheduler; it must not contain a second agent loop.

The terminal interface uses Node's standard `readline` interface and a local renderer. It
supports `computer-native chat` for interactive input and `--message` for a non-interactive
test driver. Interactive sessions present a compact agent-console layout: a branded header
panel, provider/model/session/workspace/evidence context, the actual registered tool names,
a ready or active status ribbon, streaming output, a separate tool activity lane, grouped
help, and a visually distinct composer prompt. Slash commands are `/help`, `/status`,
`/models`, `/history`, `/evidence`, `/clear`, and `/quit`; `/models` is a read-only view
of the configured provider choices and capabilities. Multiline continuation uses a
trailing `\\`, input history is provided by `readline`, and Ctrl-C cancels an active turn. The CLI
displays application events but the runtime owns model calls, tools, security, and
persistence. In an interactive TTY, proposed `apply_patch`, `apply_patch_set`, `write_file`,
`mkdir`, `delete`, `restore`, `copy`, `move`, and `rename` operations show a bounded review
panel with named approve, deny, inspect, and cancel choices. Unsupported input fails closed.
Non-interactive runs have no approval channel
and therefore do not perform workspace mutations.

Every approval panel exposes the stable prepared-operation identity and effective approval
lifetime. Workspace mutations use their mutation ID, local processes show the execution ID
and argv hash, browser actions show the action ID and action hash, and memory operations
show their operation and call IDs. Ctrl-C is safe to repeat: the first press requests
cancellation and later presses do not create duplicate cancellation activity or terminal
evidence.

The activity lane also distinguishes a normal failure from an interrupted turn, a
partial/uncertain filesystem mutation, and an outcome-unknown process or browser action.
Those labels are observations, not claims that the external side effect was rolled back.

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
upload, and download actions. It shows the browser session, tab, document/reference,
exact action hash, optional path/byte limit, and the warning that page content is
untrusted. The browser renderer reports session, tab, snapshot, navigation, wait,
artifact, approval, and action outcomes; it never calls the Playwright adapter directly.
Non-interactive runs have no browser approval channel and therefore fail closed for
interaction actions.

When process mode is `approval`, `run_command` uses a separate review panel that shows
the exact executable, JSON-quoted argument vector, cwd, sanitized environment profile,
limits, and the warning that the workspace is not an OS sandbox. The panel must be
approved once per command; process activity then reports approval, pid, termination,
and the bounded terminal outcome. `--process-mode deny` or
`COMPUTER_NATIVE_PROCESS_MODE=deny` removes the process tool from the model tool list.

The renderer must not invent tool activity, usage, health, or capability state. When a
feature is not implemented by the runtime, it is not presented as available.

`computer-native doctor` is a separate bounded connectivity check. It reports the
selected provider, model, workspace validation, and a short safe result without opening
a session or writing transcript evidence.
