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

## First runnable slice

The first slice is a local terminal turn. It uses Node's standard readline interface,
so there is no terminal UI dependency to install. The deterministic local provider is
the default for repeatable development and tests. OpenRouter is available as the first
real provider through the same model contract.

```bash
cd computer-native
npm install
npm test
npm run chat -- --message "Explain durable execution in one sentence."
```

The command creates a new session unless `--session <session-id>` is supplied. Set
`--state-dir <path>` when the evidence should live somewhere other than the default
`~/.agent-harness-lab/computer-native`.

To use OpenRouter, export `OPENROUTER_API_KEY`, set `OPENROUTER_MODEL`, and select the
provider explicitly:

```bash
export OPENROUTER_API_KEY="your-local-key"
export OPENROUTER_MODEL="your-model-id"
npm run chat -- --provider openrouter
```

The key is read only from the process environment. It is not written to session records.
See [`docs/quick-start.md`](docs/quick-start.md) and
[`docs/turn-lifecycle.md`](docs/turn-lifecycle.md) for the evidence layout and recovery
rules.
