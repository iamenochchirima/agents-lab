# Vercel Workflows baseline

The baseline is a bounded native model/tool workflow:

1. The service validates and durably reserves the Lab run ID.
2. `workflow` executes the durable orchestration function.
3. Native steps prepare common context and expose exact admitted tool schemas.
4. `executeModelStep` requests model text or tool calls. Capability steps validate,
   prepare reviews and dispatch through the shared host. Native hooks wait for
   approval, denial or renewal, and paired results feed the next model round.
   Deterministic fake responses remain available for tests.
5. The workflow returns normalized result, trajectory, metrics, and event intents.
6. The runner reads native Workflow status and preserves the native IDs in evidence.

The source is intentionally small so the Workflow boundary, step boundary, local
World, admission ledger, and failure semantics can be inspected independently.

Code map:

- `execution/workflow.ts` — deterministic orchestration and normalized result.
- `execution/model-step.ts` — the side-effecting model step and retry boundary.
- `execution/capability-steps.ts` — common context, host and progress I/O.
- `state/progress-store.ts` — durable in-progress inspection projection.
- `execution/bundle-builder.ts` — official standalone bundle and manifest build.
- `models/` — fake and OpenRouter model calls.
- `state/admission-store.ts` — durable Lab-side admission acknowledgement.
- `../../runner-adapter/` — shared Lab runner port adapter.

See [execution semantics](../../docs/semantics.md) for review delivery, retry,
unknown-effect and recovery boundaries.
