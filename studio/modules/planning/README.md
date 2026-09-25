# Planning module

This package defines a proposal interface for planning and reasoning. A planner
receives the task, model-visible context, current observations, and optionally a
previous plan. It returns explicit proposed steps and completion criteria. It does
not execute tools, computer actions, or decide whether the overall agent loop should
continue; those responsibilities belong to other modules.

`Planner.propose` is asynchronous and receives an `AbortSignal`. Cancellation before
completion rejects with an `AbortError` or a classified `PlanningError`; callers
must discard an incomplete proposal. Planning has no required durable state in v0.
Implementations that persist plans must document their scope and restart behavior.
Evidence includes source IDs considered, not private model reasoning.

Use `parsePlanningConfig` before construction. Defaults are exported; unknown
settings and out-of-range or non-integer values are rejected.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxSteps` | 12 | 1–1,000 |
| `maxDescriptionBytes` | 4,096 | 1–1,000,000 |
| `maxAssumptions` | 20 | 0–1,000 |

```sh
pnpm --filter @agent-harness-lab/module-planning typecheck
pnpm --filter @agent-harness-lab/module-planning test
```

This package defines the interface and configuration contract; it does not yet
include a planning algorithm.
