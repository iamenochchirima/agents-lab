# Computer Use module

This package defines an interface for observing an interactive computer, carrying
out a proposed action through an injected `ComputerEnvironmentCapability`, and
reporting a verification result. The environment owns the browser or desktop and
its permissions; Computer Use owns interaction and verification behavior. The
environment receipt distinguishes unknown outcomes because an interrupted action
may have taken effect.

The initial implementation is `createScopedComputerUse`, with identity
`scoped-computer-use@0.2.0`. It exposes `requiredCapabilities()` so the kernel can
check and request environment operations before opening a session. The controlled
fixture requires `computer@1.0.0` (kind `computer`) with `observe` and `click`
operations. It uses an injected
`ComputerEnvironmentCapability` to capture a before observation, perform one
supplied action, capture the resulting state when possible, and call an injected
verifier. It does not choose actions or approve them. The caller must run Safety
before calling `act`.

The package contains no browser or desktop driver. Tests use a controlled
in-memory environment; a host must provide and permission that capability. An
action timeout, a rejected environment call after dispatch, or cancellation
after dispatch produces an `unknown` receipt because the action may have taken
effect. The module does not retry actions. It can attempt a post-action
observation after a timeout, but it skips that observation after caller
cancellation. Verification reports `not-verified` when it lacks a post-action
observation.

`maxActionsPerTurn` counts dispatched action attempts by run and turn ID,
including failed or uncertain dispatches. A failed pre-action observation does
not consume the quota. If no turn ID is supplied, the quota covers that run.
The counters live in the module instance, so the host should construct it for a
run and discard it at run end. The instance keeps one small counter for each
turn it has seen, so a very long run can accumulate entries. Counters do not
survive process restart. The observation byte limit covers the serialized
observation envelope. `actionTimeoutMs` limits how long this wrapper waits for
both observations and actions. An observation timeout reports the environment
as unavailable. An action timeout does not prove that the external operation
stopped.

Invalid inputs, unavailable observations, oversized observations, and exceeded
action limits throw `ComputerUseError` with a specific code. An invalid or
throwing verifier is represented as failed verification evidence rather than
discarding the action receipt.

Use `parseComputerUseConfig` before construction. Defaults are exported, and the
parser rejects unsupported fields, invalid types, and values outside bounds.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxActionsPerTurn` | 20 | 1–10,000 |
| `maxObservationBytes` | 2,000,000 | 1–100,000,000 |
| `actionTimeoutMs` | 30,000 | 1–3,600,000 |

```sh
pnpm --filter @agent-harness-lab/module-computer-use typecheck
pnpm --filter @agent-harness-lab/module-computer-use test
```
