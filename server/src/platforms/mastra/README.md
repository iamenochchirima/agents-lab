# Mastra platform

Mastra is the TypeScript-native direct-agent baseline for the Lab. This implementation
constructs a real `@mastra/core` `Agent` and calls `Agent.generate()` once per Lab run.
The runner keeps Mastra-specific model wiring and lifecycle state behind the common
`PlatformRunner` seam.

The baseline intentionally has no Mastra memory, storage, tools, workflows, snapshots,
or external side effects. Its Lab evidence is durable after projection, but an
in-flight generation is process-local and cannot be adopted after a server restart.

The Platform UI selects an OpenRouter model from the shared server catalog. Mastra
uses that selection through its model router; fake models remain test fixtures.

## Layout

- `runner-adapter/mastra-runner.ts` — runner boundary and in-memory execution registry.
- `variants/baseline/agent.ts` — direct Mastra `Agent` construction.
- `variants/baseline/config/` — safe configuration and provider validation.
- `variants/baseline/models/` — deterministic fake model and OpenRouter model selection.
- `docs/` — local operation and failure semantics.
- `package.json` — platform-local `@mastra/core` pin; the root server package also
  pins the dependency for the composed runtime.

## Version facts

- `@mastra/core`: `1.66.0`.
- Node.js: `>=22.13.0` according to the package engine declaration.
- Current verified local runtime: Node.js `23.11.1`.

The shared server composes `MastraBaselineRunner` directly. The baseline remains
process-local by design: completed Lab evidence survives projection, but an in-flight
generation cannot be recovered after a server restart.

## References

- [Mastra project structure](https://mastra.ai/reference/project-structure)
- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)
- [Mastra OpenRouter gateway](https://mastra.ai/models/gateways/openrouter)
