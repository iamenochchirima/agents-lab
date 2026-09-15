# Mastra baseline local development

## Install the platform dependency

The baseline owns its Mastra dependency in the platform-local manifest:

```bash
npm install --prefix server/src/platforms/mastra
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

The common server's shared bootstrap and root package manifest are intentionally not
changed by this platform-owned slice. A separate integration change must add the
runner to the server registry and promote the platform dependency into the server
installation before the browser can submit `mastra/baseline` through HTTP.

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
