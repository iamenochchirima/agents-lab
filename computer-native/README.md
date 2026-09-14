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
