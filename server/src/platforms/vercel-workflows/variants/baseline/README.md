# Vercel Workflows baseline

The baseline is one prompt workflow:

1. The service validates and durably reserves the Lab run ID.
2. `workflow` executes the durable orchestration function.
3. `executeModelStep` performs the selected OpenRouter request; deterministic fake
   responses remain available for tests.
4. The workflow returns normalized result, trajectory, metrics, and event intents.
5. The runner reads native Workflow status and preserves the native IDs in evidence.

The source is intentionally small so the Workflow boundary, step boundary, local
World, admission ledger, and failure semantics can be inspected independently.

Code map:

- `execution/workflow.ts` — deterministic orchestration and normalized result.
- `execution/model-step.ts` — the side-effecting model step and retry boundary.
- `execution/bundle-builder.ts` — official standalone bundle and manifest build.
- `models/` — fake and OpenRouter model calls.
- `state/admission-store.ts` — durable Lab-side admission acknowledgement.
- `../../runner-adapter/` — shared Lab runner port adapter.
