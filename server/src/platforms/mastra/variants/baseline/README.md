# Mastra baseline harness variant

The baseline is a direct-agent call with Lab-owned context and a bounded native tool:

```text
Lab manifest → Lab context snapshot → Mastra Agent.generate() → Lab evidence projection
```

It uses Mastra's native TypeScript runtime and accepts either a deterministic local
fake model or an opt-in OpenRouter model. The calculator is registered with the shared
tool registry and exposed through Mastra's native tool interface. Context sessions,
snapshots, token budgets, and transcript continuation belong to the Lab; Mastra Memory,
Mastra Storage, workflows, and durable execution are not enabled in this variant.
The runner is process-local, so an in-flight generation is not recoverable after a
server restart.
