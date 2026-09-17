# Anesu development rules

Anesu is an extraction-ready standalone project temporarily located in the
Agent Harness Lab workspace. It owns its CLI, gateway, cron scheduler, daemon
lifecycle, profiles, sessions, context construction, runtime, model adapters,
workspace, artifacts, tools, skills, plugins, external-service integrations, memory,
security policy, persistence, and telemetry.

Do not import Agent Harness Lab implementation modules from this directory. The only
future connection is a documented, versioned runner protocol. Keep local configuration,
tests, dependencies, and documentation here so the directory can move to its own
repository without architectural surgery.
