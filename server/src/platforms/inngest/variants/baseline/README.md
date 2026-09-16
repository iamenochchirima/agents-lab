# Inngest baseline

The baseline accepts one prompt event and runs one selected OpenRouter model step
through the official Inngest TypeScript SDK. It covers event admission, durable step
replay, bounded retries, event cancellation, native status projection, and safe
reconciliation.

It deliberately does not include tools, memory, skills, OAuth connections, MCP,
plugins, multi-turn sessions, or external side effects. Those belong in later
variants and must not be inferred from this baseline.
