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
# Workflow variant local development

The Mastra platform runs without Docker. The direct baseline uses process-local
execution. The workflow variant additionally opens a file-backed LibSQL database for
native workflow snapshots.

```bash
./scripts/run_local_stack.sh
```

The workflow store defaults to `lab/mastra/mastra-workflows.db`. Override it with an
absolute `AGENTLAB_MASTRA_STORAGE_PATH` path when running restart exercises. The older
`AGENTLAB_MASTRA_WORKFLOW_STORAGE` name remains accepted for local compatibility. The
file is local runtime state and must not be committed.

To roll back the workflow variant without removing baseline support, set
`AGENTLAB_MASTRA_WORKFLOW_ENABLED=false`. The server then keeps `mastra/workflow`
visible as unavailable/planned and does not open the workflow database. Existing run
directories and workflow files are retained.

Both baseline and workflow runs use the Lab context session. When the shared context
budget is due, the adapter compacts older turns before dispatch and records the
compaction revision and safe budget in the run context evidence. This is separate from
Mastra Memory, which is not enabled in this profile.

To exercise the native approval boundary, select `Mastra workflow` in Chat and send a
prompt beginning with `[approval]`, for example:

```text
[approval] Prepare a short launch announcement.
```

The run enters `suspended`. Select **Approve and resume** in the run details. The
server resumes the same native workflow run; it does not submit a second Lab run.

For a replacement-runner exercise, stop the server while the workflow is suspended,
start the local stack again with the same storage path, reload the run URL, and resume
it. This validates local snapshot inspection. It does not simulate a distributed
production database or claim multi-process safety.

Required checks:

```bash
pnpm --filter @agent-harness-lab/lab-server typecheck
pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/mastra/mastra-api-probe.test.ts tests/platforms/mastra/mastra-workflow-runner.test.ts
pnpm --filter @agent-harness-lab/web typecheck
```
