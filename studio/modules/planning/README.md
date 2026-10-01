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

## Initial implementation: single-step response planner

`createSingleStepResponsePlanner` creates a deterministic baseline with identity
`single-step-response-planner@0.1.0`. For any valid task, it proposes one
`respond` step. It does not interpret task meaning, choose tools, assess whether
the task is complete, or decide whether the agent should continue. Control must
decide whether and how to execute the proposal.

The implementation validates the supplied scope, task, context messages,
observations, and optional previous plan. It does not use their semantic content
to change its fixed proposal. Evidence lists distinct source IDs from context
messages followed by observation source IDs. A previous plan is validated but
does not alter this baseline's proposal. The deterministic plan ID is a stable
non-cryptographic hash scoped to the supplied run and input; it is not a security
token or a globally unique identifier.

`maxSteps` must permit the one required step. `maxDescriptionBytes` applies to
each generated summary, step description, and completion condition, measured in
UTF-8 bytes. If those fixed strings do not fit, the planner throws
`PlanningError` with `PLAN_LIMIT_EXCEEDED`. Invalid input throws
`INVALID_PLANNING_INPUT`. Cancellation before or after proposal construction
throws an `AbortError`; callers discard the proposal. The implementation has no
durable state or external effects. Its output is a contract baseline, not
evidence of planning quality.
