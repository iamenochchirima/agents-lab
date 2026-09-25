# Computer Use module

This package defines an interface for observing an interactive computer, carrying
out a proposed action through an injected `ComputerEnvironmentCapability`, and
reporting a verification result. The environment owns the browser or desktop and
its permissions; Computer Use owns interaction and verification behavior. The
environment receipt distinguishes unknown outcomes because an interrupted action
may have taken effect.

The contract does not imply that a browser or desktop implementation is available.
No concrete environment or Computer Use implementation is included here. An
assembly must provide the capability explicitly; without it, this module is
unavailable. Safety approval remains a caller responsibility before `act`. The
module receives cancellation signals for observation and action, but cancellation
after an external action begins may leave its outcome unknown.

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
