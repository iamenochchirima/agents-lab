# Parallel platform implementation coordination

**Created:** 2026-09-15T10:35:00+02:00
**Last updated:** 2026-09-15T14:59:11+02:00
**Status:** Active
**Owner:** Primary implementation agent

## Purpose

This coordination plan defines how the next platform plans can be assigned to
different agents at the same time without competing over the server bootstrap,
package manifests, UI catalog, or another platform's files.

The completed [server platform foundation](../completed/server-platform-foundation.md)
is the shared contract. The next agents implement platform-owned runners and runtime
services behind that contract. They do not redesign the common server while working
on an individual platform.

Before assigning implementation work, read the [first-party source audit](../../../docs/research/platform-plan-source-audit.md).
It records which current platform facts are verified, which local profiles are
development-only, and which platform-specific decisions must be settled before an
agent writes code.

## Plans in this batch

| Platform | Plan | Initial runtime shape | Recommended wave |
| --- | --- | --- | --- |
| Restate | [Restate baseline](restate-baseline.md) | TypeScript platform service + HTTP runner adapter | 1 |
| LangGraph | [LangGraph baseline](langgraph-baseline.md) | Python graph service + TypeScript HTTP runner adapter | 1 |
| Mastra | [Mastra baseline](mastra-baseline.md) | TypeScript platform service + HTTP runner adapter | 1 |
| Inngest | [Inngest baseline](inngest-baseline.md) | TypeScript function service + local dev server | 2 |
| Trigger.dev | [Trigger.dev baseline](trigger-dev-baseline.md) | TypeScript task service + local dev server | 2 |
| DBOS | [DBOS baseline](dbos-baseline.md) | TypeScript service + local Postgres | 2 |
| Hatchet | [Hatchet baseline](hatchet-baseline.md) | TypeScript worker/service + local Hatchet server | 2 |
| Vercel Workflows | [Vercel Workflows baseline](vercel-workflows-baseline.md) | TypeScript service + Vercel local/deployment profile | 3 |
| AWS Step Functions | [AWS Step Functions baseline](aws-step-functions-baseline.md) | Explicitly skipped in this implementation wave | — |

Temporal is already implemented and is not reopened by this batch. OpenAI Agents
SDK remains a variant under a platform, not an additional platform plan.

The [first-party source audit](../../../docs/research/platform-plan-source-audit.md)
is the review record for all nine plans. It is not implementation evidence.

## Current execution state

The current implementation wave is running in three isolated worktrees:

| Wave | Platforms | State |
| --- | --- | --- |
| 1 | Restate, LangGraph, Mastra | Integrated; remaining acceptance records are tracked in each plan |
| 2 | Inngest, Trigger.dev, DBOS | Integrated; Inngest and DBOS have local acceptance evidence, while Trigger.dev still needs a real local server profile |
| 3 | Hatchet, Vercel Workflows | Platform-local implementations and shared registration are integrated; local service acceptance and hosted profiles remain tracked in each plan. AWS is intentionally excluded from this wave. |

Only one platform agent owns a platform directory at a time. The primary agent
does not begin shared bootstrap or UI integration for this wave until its three
platform-local handoffs have been reviewed.

## Parallel-safe ownership rule

Each platform agent owns only:

```text
server/src/platforms/<platform>/
server/tests/platforms/<platform>/
server/integration-tests/<platform>-baseline.test.ts
development/playground/<platform>-baseline/
docs or README files inside server/src/platforms/<platform>/
```

If a platform needs its own runtime process, its package manifest and lockfile live
inside that platform directory. The platform service must expose a narrow local HTTP
or process boundary so the root `server/package.json` does not become a dependency
merge point.

Platform agents must not edit these shared files:

```text
server/src/control-plane/**
server/src/control-plane/bootstrap/server.ts
server/package.json
server/package-lock.json
scripts/run_local_stack.sh
apps/web/src/features/platforms/**
docs/navigation.json
```

The primary agent owns the integration handoff for those files. A platform agent may
submit a small, explicit integration patch after its platform-only commit is reviewed,
but it must not mix that patch into its platform implementation commit.

## Worktree and commit protocol

Every assigned implementation uses its own worktree. The coordinator should create
one worktree per platform branch and never ask two agents to edit the same worktree:

```text
../agents-lab-restate
../agents-lab-langgraph
../agents-lab-mastra
...
```

Each agent produces focused commits in this order:

1. Platform-owned runtime and adapter.
2. Platform-owned tests and local readiness checks.
3. Platform documentation and playground walkthrough.
4. Handoff note listing any required primary-agent integration changes.

The primary agent cherry-picks or merges those commits one platform at a time, adds
the registry/bootstrap integration, runs the shared suite, and records the result in
the platform plan. No agent marks a platform runnable merely because its branch builds.

## Shared integration handoff

The primary agent performs these changes after reviewing a platform handoff:

- register the adapter in `server/src/control-plane/bootstrap/server.ts`;
- add only root-level scripts or environment forwarding that cannot live inside the
  platform directory;
- update the platform catalog and UI only when the runner is genuinely runnable;
- add the platform to local-stack startup only when its dependency has a deterministic
  readiness check;
- run the complete server, platform, and web checks;
- update documentation navigation only after the document exists and its links resolve.

If a platform requires a common contract change, stop the parallel merge and create a
separate contract decision record. The platform plan must not silently alter shared
semantics.

## Recommended execution order

Wave 1 should start first and may run concurrently:

- Restate teaches durable service/object execution and idempotent calls.
- LangGraph teaches checkpointed graph execution and a cross-language boundary.
- Mastra teaches a TypeScript agent/workflow runtime with its own state model.

Wave 2 can then run concurrently after the first integration boundary is proven:

- Inngest, Trigger.dev, and DBOS add distinct durable backend models,
  but their local service processes and infrastructure can compete for resources.

Wave 3 should remain separate because deployment constraints dominate local semantics:

- Vercel Workflows requires a Vercel-oriented local/deployed profile.
- AWS Step Functions is intentionally not assigned in this implementation wave. Its
  existing files and plan remain untouched until a separate AWS decision is made.

The non-AWS plans can be assigned in parallel now. The actual local infrastructure runs
should be scheduled so ports, containers, databases, and cloud credentials do not overlap.

## Batch completion gate

- [ ] Every non-AWS platform has a plan with exclusive ownership and a concrete runtime shape.
- [ ] Every plan links the generic runner contract and completed foundation.
- [ ] No plan requires a platform agent to edit shared bootstrap or root dependency files.
- [ ] Each platform plan defines local readiness, evidence, retries, cancellation,
      restart, unknown outcomes, and exact tests.
- [ ] Wave 1 is implemented and integrated before Wave 2 is started.
- [ ] Platform-specific behaviour remains visible in native evidence and documentation.
- [x] The UI shows a platform as runnable only after the primary integration handoff passes.

## Known limits

- This document coordinates implementation; it does not claim that all listed
  platforms are locally equivalent or equally easy to run.
- Some platforms require a hosted or emulated dependency. Their plans must distinguish
  local development evidence from hosted production evidence.
- Separate worktrees prevent source collisions, but they do not prevent resource
  collisions. Local ports, containers, databases, and credentials still need allocation.
