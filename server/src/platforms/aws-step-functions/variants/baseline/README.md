# AWS Step Functions baseline

The baseline starts one Standard state-machine execution per Lab run. The state machine
dispatches a single Activity task to a worker, which executes either the deterministic
fake model or the optional OpenRouter adapter. Step Functions applies the retry and
timeout policy around that Activity.

The output envelope contains the common result, trajectory, and metrics for a successful
Activity. Native execution history remains separate and is mapped to normalized event
intents by the platform service.

## Boundaries

- `execution/` — ASL definition and execution-input construction.
- `models/` — fake and OpenRouter model calls.
- `runtime/` — Activity worker lifecycle.
- `state/` — native execution/history projection.
- `config/` — variant-facing configuration contract.
- focused tests live in `server/tests/platforms/aws-step-functions/`; the opt-in
  emulator test lives in `server/integration-tests/`.
