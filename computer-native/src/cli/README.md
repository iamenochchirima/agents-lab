# CLI

Owns the local terminal interface: command parsing, interactive input, rendering, and
exit behaviour. The CLI adapts a person’s request into the same admission path used by
the gateway and cron scheduler; it must not contain a second agent loop.

The first runnable slice uses Node's standard `readline` interface. It supports
`computer-native chat` for interactive input and `--message` for a non-interactive test
driver. The CLI displays model output and lifecycle outcomes, but the runtime owns
model calls and persistence.
