# Mastra baseline harness variant

The baseline is a single-turn, direct-agent call:

```text
Lab manifest → Mastra Agent → Agent.generate(prompt) → Lab evidence projection
```

It uses Mastra's native TypeScript runtime and accepts either a deterministic local
fake model or an opt-in OpenRouter model. No tools, memory, workflows, storage, or
durable execution are enabled. Those are separate variants so this first comparison
does not confuse a direct agent call with Mastra workflow durability.
