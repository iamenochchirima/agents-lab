# Mastra platform

Mastra is the TypeScript-native direct-agent baseline for the Lab. This implementation
constructs a real `@mastra/core` `Agent` and calls `Agent.generate()` once per Lab run.
The runner keeps Mastra-specific model wiring and lifecycle state behind the common
`PlatformRunner` seam.

The baseline uses the Lab's shared context session, snapshot, and budget capability;
it does not use Mastra Memory or Mastra Storage. The calculator is exposed through a
native Mastra tool backed by the shared deny-by-default tool registry. Lab evidence is
durable after projection, but an in-flight generation is process-local and cannot be
adopted after a server restart.

The Platform UI selects an OpenRouter model from the shared server catalog. Mastra
uses that selection through its model router; fake models remain test fixtures.

## Layout

- `runner-adapter/mastra-runner.ts` — runner boundary and in-memory execution registry.
- `variants/baseline/agent.ts` — direct Mastra `Agent` construction and the bounded
  calculator tool bridge.
- `variants/baseline/config/` — safe configuration and provider validation.
- `variants/baseline/models/` — deterministic fake fixtures and OpenRouter model selection.
- `runner-adapter/mastra-runner.ts` — shared context snapshot preparation, native
  `Agent.generate()` execution, and normalized lifecycle evidence.
- `docs/` — local operation and failure semantics.
- `package.json` — platform-local `@mastra/core` pin; the root server package also
  pins the dependency for the composed runtime.

## Version facts

- `@mastra/core`: `1.66.0`.
- Node.js: `>=22.13.0` according to the package engine declaration.
- Current verified local runtime: Node.js `23.11.1`.

The shared server composes `MastraBaselineRunner` directly. Context sessions and
snapshots are Lab-owned and filesystem-backed; Mastra does not own their persistence.
The baseline remains process-local by design: completed Lab evidence survives
projection, but an in-flight generation cannot be recovered after a server restart.

## References

- [Mastra project structure](https://mastra.ai/reference/project-structure)
- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)
- [Mastra OpenRouter gateway](https://mastra.ai/models/gateways/openrouter)
