# Mastra baseline local development

## Install the dependencies

The baseline keeps a platform-local manifest for isolated study, while the composed Lab
server installs the same pinned dependency at the server boundary:

```bash
pnpm install
```

The package pin is `@mastra/core@1.66.0`. Mastra currently declares Node.js
`>=22.13.0`; check `node --version` before running the baseline.

## Run the focused checks

From the `server/` directory:

```bash
node --import tsx --test \
  tests/platforms/mastra/mastra-runner.test.ts \
  integration-tests/mastra-baseline.test.ts
```

The tests use a deterministic local language model that implements the AI SDK model
surface consumed by Mastra. They still construct a real Mastra `Agent` and execute
`Agent.generate()`; they do not replace the agent lifecycle with a mock.

The shared bootstrap registers `mastra/baseline` alongside the other first-wave
platforms. Start the API with `./scripts/run_local_stack.sh server`; no Temporal
server is required for a deterministic Mastra run.

## Optional OpenRouter run

Mastra's model router uses the `openrouter/<provider>/<model>` form and reads
`OPENROUTER_API_KEY` from the environment. For example:

```bash
export OPENROUTER_API_KEY='...'
```

The Lab manifest should carry only the provider and model identifier. The key must not
be placed in a manifest, execution reference, event payload, log, or result file. The
baseline performs configuration validation only; `checkConnection()` does not make a
paid provider call.

## Evidence inspection

The common server writes the normalized projection when the runner is integrated:

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/mastra.json
```

`native/mastra.json` contains safe Mastra identity and model facts. It does not contain
the prompt, provider headers, API keys, or raw provider responses.

## First-party references

- [Mastra project structure](https://mastra.ai/reference/project-structure)
- [Mastra agents and `generate()`](https://mastra.ai/docs/agents/overview)
- [Mastra OpenRouter gateway](https://mastra.ai/models/gateways/openrouter)
