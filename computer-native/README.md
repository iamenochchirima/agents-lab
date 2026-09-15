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
provider through the same model contract. The agent can inspect files through bounded,
read-only workspace tools.

```bash
cd computer-native
npm install
npm test
npm run chat -- --message "Explain durable execution in one sentence."
```

The command creates a new session unless `--session <session-id>` is supplied. Set
`--state-dir <path>` when the evidence should live somewhere other than the default
`~/.agent-harness-lab/computer-native`.

The interactive terminal shows the session, model, workspace, and evidence location.
Type `/help` for commands. A line ending in `\\` continues into a multiline prompt;
Ctrl-C cancels an active turn and Ctrl-D exits. The default workspace is the current
directory; set `--workspace <path>` or `COMPUTER_NATIVE_WORKSPACE_ROOT` to change it.

For repeated local development, copy `.env.example` to `.env`, set the provider, model,
and key, then run the normal command. The `.env` file is ignored by git and loaded
automatically:

```bash
cp .env.example .env
# Edit .env:
# COMPUTER_NATIVE_PROVIDER=openrouter
# OPENROUTER_MODEL=cohere/north-mini-code:free
# OPENROUTER_API_KEY=your-local-key
npm run chat
```

Use `npm run start -- doctor` to test the configured provider/model without creating a
chat session. The check is bounded by the configured first-event and total-request
deadlines and reports only safe diagnostics.

Explicit environment variables override `.env`, and command-line flags override both.
The key is never written to session records.
See [`docs/quick-start.md`](docs/quick-start.md) and
[`docs/turn-lifecycle.md`](docs/turn-lifecycle.md) for the evidence layout and recovery
rules.
