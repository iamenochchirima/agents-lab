# Computer Native first slice

This guide runs one local terminal turn and shows where its evidence goes.

## Install and test

From the repository root:

```bash
cd computer-native
npm install
npm run typecheck
npm test
```

The package uses Node's built-in `readline` interface. It does not require a terminal UI
framework. The default provider is the deterministic local provider, which does not use
the network.

## Run one turn

Run one non-interactive turn with an isolated state directory:

```bash
STATE_DIR="$(mktemp -d)"
npm run chat -- \
  --state-dir "$STATE_DIR" \
  --message "Explain durable execution in one sentence."
```

For an interactive session, omit `--message`:

```bash
npm run chat -- --state-dir "$STATE_DIR"
```

Type `exit` or `quit` to leave normally. Press Ctrl-C during a model request to cancel
that turn. The session ID is printed when the process starts. Resume it with:

```bash
npm run chat -- --state-dir "$STATE_DIR" --session <session-id>
```

## Exercise controlled outcomes

The deterministic provider is a local adapter for reproducible checks. Its controlled
outcomes are useful for learning the persistence rules:

```bash
npm run chat -- --state-dir "$STATE_DIR" --message "success"
npm run chat -- --state-dir "$STATE_DIR" --deterministic-behavior failure --message "failure"
npm run chat -- --state-dir "$STATE_DIR" --deterministic-behavior timeout --timeout-ms 25 --message "timeout"
```

Failure turns retain the user message and do not append an assistant message.

## Use OpenRouter

OpenRouter is the first real provider adapter. It is opt-in so a test or local learning
run never spends money or sends a prompt without an explicit choice. For repeated local
development, store the choice in the ignored `computer-native/.env` file:

```bash
cp .env.example .env
# Set these values in .env:
# COMPUTER_NATIVE_PROVIDER=openrouter
# OPENROUTER_MODEL=openrouter/free
# OPENROUTER_API_KEY=your-local-key
npm run chat -- --state-dir "$STATE_DIR"
```

The local `.env` file is not committed. Explicit environment variables and command-line
flags take precedence over it. The key is never included in the manifest, transcript,
events, result, terminal error, or browser-facing output. If the key or model is missing,
the command reports a configuration error before creating a model request.
