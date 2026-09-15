# CLI

Owns the local terminal interface: command parsing, interactive input, rendering, and
exit behaviour. The CLI adapts a person’s request into the same admission path used by
the gateway and cron scheduler; it must not contain a second agent loop.

The terminal interface uses Node's standard `readline` interface and a local renderer. It
supports `computer-native chat` for interactive input and `--message` for a non-interactive
test driver. Interactive sessions show provider/model/session/workspace/evidence context,
streaming output, actual tool activity, slash commands (`/help`, `/status`, `/history`,
`/evidence`, `/clear`, `/quit`), multiline continuation with a trailing `\\`, input
history, and cancellation. The CLI displays application events but the runtime owns model
calls, tools, security, and persistence.

The renderer must not invent tool activity, usage, health, or capability state. When a
feature is not implemented by the runtime, it is not presented as available.

`computer-native doctor` is a separate bounded connectivity check. It reports the
selected provider, model, workspace validation, and a short safe result without opening
a session or writing transcript evidence.
