# Platform plan source audit

**Audit date:** 2026-09-15
**Scope:** Active implementation plans for Restate, LangGraph, Mastra, Inngest, Trigger.dev, DBOS, Hatchet, Vercel Workflows, and AWS Step Functions.
**Method:** First-party documentation and first-party source repositories only. Sources were checked on the audit date. This audit does not change any implementation plan.

## How to read this audit

- **Verified fact** means the current first-party source explicitly supports the statement.
- **Plan implication** means what the implementation plan must account for if it is to remain accurate.
- **Unresolved** means the plan or source review does not yet establish a decision needed for implementation.
- **Flag** means the current plan wording is stale, too broad, or likely to mislead an implementing agent.

The active plans are linked for traceability, but they are intentionally not edited here.

## Executive summary

| Platform | Audit result | Highest-priority finding |
| --- | --- | --- |
| [Restate](../../development/implementation-plans/active/restate-baseline.md) | Needs correction | The plan's Node 20+ floor conflicts with current TypeScript SDK guidance of Node 22+. |
| [LangGraph](../../development/implementation-plans/active/langgraph-baseline.md) | Mostly aligned | Local `langgraph dev` is in-memory and development-only; the custom SQLite service must not be presented as production-equivalent. |
| [Mastra](../../development/implementation-plans/active/mastra-baseline.md) | Aligned as a deliberately shallow baseline | `Agent.generate()` is valid for the direct baseline, but it is not Mastra workflow durability or snapshot recovery. |
| [Inngest](../../development/implementation-plans/active/inngest-baseline.md) | Mostly aligned | Local semantics are documented as representative, but exact SDK/version/readiness and 24-hour idempotency limits are not yet explicit. |
| [Trigger.dev](../../development/implementation-plans/active/trigger-dev-baseline.md) | Aligned with an important caveat | Local task execution still depends on a Trigger server and secret; it is not an offline local emulator. |
| [DBOS](../../development/implementation-plans/active/dbos-baseline.md) | Mostly aligned | Postgres is the real required dependency; DBOS does not require a separate orchestration server for the open-source local baseline. |
| [Hatchet](../../development/implementation-plans/active/hatchet-baseline.md) | Needs a local-runtime decision | Current Hatchet documentation has an embedded TypeScript mode that the plan does not account for. |
| [Vercel Workflows](../../development/implementation-plans/active/vercel-workflows-baseline.md) | Needs clarification | The official durable SDK is `workflow`; “Vercel Workflow/AI SDK” is not a precise implementation boundary. |
| [AWS Step Functions](../../development/implementation-plans/active/aws-step-functions-baseline.md) | Needs a workflow-type decision | Standard and Express have materially different identity, durability, cancellation, and delivery semantics. |

## Cross-plan findings

### Runtime and package pins

The plans are generally TypeScript/Node-oriented, with LangGraph as the Python-oriented exception. Several plans name a language but not an exact package, CLI, server, or image version. That is insufficient for reproducible implementation work. Every platform plan should pin the SDK and the local runtime dependency separately where they are released separately.

The source review found one directly stale runtime floor: Restate's current TypeScript documentation requires Node 22 or newer, while its active plan says Node 20+. The other plans should not be assumed current merely because their language choice is reasonable; their exact dependency pins still need to be recorded before implementation.

### Local readiness is not one thing

The platforms fall into different local shapes:

1. An in-process library with a database dependency: DBOS.
2. A local server or daemon that owns scheduling and execution: Inngest, Trigger.dev, Hatchet, and Restate.
3. A local development server whose persistence is deliberately limited: LangGraph.
4. A direct SDK call with optional framework durability: Mastra.
5. A local filesystem-backed workflow world versus a managed production backend: Vercel Workflows.
6. A cloud service or unsupported local emulator with materially different guarantees: AWS Step Functions.

“Runs locally” therefore cannot be used as a common readiness or equivalence claim. Each plan needs an explicit dependency list, startup command, readiness check, identity lookup, and shutdown rule.

### Model calls and unknown outcomes

None of the reviewed sources establishes exactly-once execution of an external model request merely because the surrounding workflow is durable. A model request can succeed while the caller loses the response. The plans correctly tend toward reconciliation and idempotency, but each implementation must state whether a model call is retried, replayed from a checkpoint, deduplicated, or marked unknown.

### What can be run in parallel

The platform implementations can be developed independently after each plan fixes its platform-specific decisions. Shared work should be limited to normalized Lab records and the runner boundary. The platform-specific code must retain native IDs, statuses, retry rules, cancellation rules, and telemetry rather than forcing them into one artificial execution model.

---

## Restate

**Plan:** [`restate-baseline.md`](../../development/implementation-plans/active/restate-baseline.md)
**Audit result:** Needs a runtime correction and a package/server compatibility check.

### Official runtime and SDK

**Verified fact:** The official TypeScript SDK is published as `@restatedev/restate-sdk`. Current TypeScript service documentation lists Node.js 22 or newer, with Bun and Deno also supported. The official SDK repository's current package source reports version `1.16.9` at the audit date.

**Plan implication:** The active plan's Node 20+ floor is stale against current official guidance. Its target `@restatedev/restate-sdk@1.17.0` and server image `1.7.10` must be checked as a compatible pair from official release information before implementation. The audit does not establish that pair.

### Local dependency and readiness

**Verified fact:** Restate documents a local server and Docker deployment path, plus service introspection. A local service is registered with the server and invoked through the server boundary.

**Plan implication:** The local profile should verify the actual server image, service port, ingress/admin readiness endpoint, and SDK/server compatibility before accepting a run. The plan's port values and readiness sequence are implementation details, not facts established by this audit.

**Unresolved:** The plan does not yet pin a first-party readiness probe and startup failure rule that an independent agent can use without guessing.

### Execution identity

**Verified fact:** Restate workflows are keyed by a workflow key. A workflow runs once per key, and the invocation ID is available through the Restate invocation identity. Resubmitting an already accepted workflow key is not equivalent to starting a second execution.

**Plan implication:** Mapping the Lab run ID to the workflow key is sound, but the implementation must preserve the Restate invocation ID and distinguish a duplicate accepted invocation from a new run.

### Durability, checkpoint, and state semantics

**Verified fact:** Restate records an execution log and replays a handler after failure or suspension. Nondeterministic or external work belongs in durable `ctx.run` steps; step results are persisted and reused during replay.

**Plan implication:** Model calls, tool calls, and other external effects need an explicit step boundary. The Lab evidence record must distinguish Restate replay from a fresh external call.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Restate errors are retryable by default unless configured otherwise; an unset retry policy can retry indefinitely. Retry policies can bound attempts and pauses. Cancellation is asynchronous and cooperative: the handler observes it while awaiting a Restate context action. Inactivity and abort timeouts also exist.

**Plan implication:** The plan's decision to bound retries is appropriate and must be explicit rather than inheriting the default. Cancellation should be recorded as requested, observed, and terminal—not represented as an immediate kill. A model/provider response lost after a successful provider call remains an unknown external outcome unless the provider request itself is idempotent.

### Local/production equivalence

**Verified fact:** The plan explicitly limits the baseline to local Restate and does not claim provider exactly-once execution.

**Assessment:** No overclaim is visible here. A local Restate server can validate Restate execution-log behaviour, but it does not by itself validate managed deployment, operational scaling, or provider-side idempotency.

**Sources, accessed 2026-09-15:**

- [TypeScript services](https://docs.restate.dev/develop/ts/services)
- [Durable steps](https://docs.restate.dev/develop/ts/durable-steps)
- [Error handling](https://docs.restate.dev/guides/error-handling)
- [Docker deployment](https://docs.restate.dev/server/deploy/docker)
- [Service introspection](https://docs.restate.dev/services/introspection)
- [Official TypeScript SDK source](https://github.com/restatedev/sdk-typescript)
- [SDK package source](https://github.com/restatedev/sdk-typescript/blob/main/package.json)

## LangGraph

**Plan:** [`langgraph-baseline.md`](../../development/implementation-plans/active/langgraph-baseline.md)
**Audit result:** Mostly aligned, with a clear development-only persistence boundary.

### Official runtime and SDK

**Verified fact:** The official local server documentation requires Python 3.11 or newer and uses `langgraph-cli[inmem]`. The current core source package reports LangGraph 1.2.10 and supports Python 3.10 or newer. The plan's Python 3.11+ choice is therefore compatible with the local server path.

**Plan implication:** The plan still needs exact locked versions for `langgraph`, checkpoint packages, and the CLI. A fresh agent should not infer them from the Python floor.

### Local dependency and readiness

**Verified fact:** `langgraph dev` starts a local API at `127.0.0.1:2024`, uses an in-memory server, and is intended for development and testing. The documentation says production use should use LangSmith Deployment with persistent storage. The local server also requires a LangSmith API key for the documented setup.

**Plan implication:** The plan is right to avoid treating `langgraph dev` as the Lab runtime. Its custom Python service plus SQLite is a Lab adapter, not the official Agent Server. Readiness must include the custom service and SQLite file, while any LangSmith key requirement must be either configured or explicitly excluded from the chosen direct-graph path.

### Execution identity

**Verified fact:** LangGraph execution metadata includes `thread_id`, `run_id`, `checkpoint_id`, and `task_id`; threads identify persisted state and checkpoints identify saved graph state.

**Plan implication:** A normalized Lab run ID must retain these native identifiers. A single “execution ID” would lose the distinction between a logical conversation, a run attempt, a checkpoint, and a node task.

### Durability, checkpoint, and state semantics

**Verified fact:** Checkpointers persist graph state per thread. `InMemorySaver` loses state on restart; SQLite is documented for local development and small projects, while Postgres is the production-oriented option. Checkpointing enables deterministic resume when external operations are isolated in tasks and made idempotent.

**Plan implication:** The plan's SQLite baseline is valid as a local learning slice, but it must state that it is not a production persistence profile. The custom service must not imply that it has Agent Server's complete persistence, scheduling, or deployment behaviour.

### Retries, cancellation, and unknown outcomes

**Verified fact:** LangGraph provides per-node retry policies and records retry/run/checkpoint/task context. Graceful shutdown drains at a superstep boundary and saves a resumable checkpoint. External API work must be isolated and idempotent for safe replay.

**Plan implication:** “Cancel” should mean cooperative drain/stop at a graph boundary unless the adapter proves stronger behaviour. The plan's unknown/reconciliation state is necessary for provider calls whose outcome is not known when the process stops.

### Local/production equivalence

**Assessment:** The plan does not overclaim if it continues to label the custom SQLite service as a local baseline and keeps hosted LangGraph/LangSmith out of scope. It would overclaim if it described SQLite plus a custom HTTP wrapper as equivalent to LangSmith Deployment.

**Sources, accessed 2026-09-15:**

- [Local server](https://docs.langchain.com/oss/python/langgraph/local-server)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Functional API and deterministic tasks](https://docs.langchain.com/oss/python/langgraph/functional-api)
- [LangGraph core package source](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/pyproject.toml)
- [SQLite checkpointer source](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py)
- [Postgres checkpointer package source](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/pyproject.toml)

## Mastra

**Plan:** [`mastra-baseline.md`](../../development/implementation-plans/active/mastra-baseline.md)
**Audit result:** Aligned as a direct, in-process agent baseline; it must not be described as Mastra workflow durability.

### Official runtime and SDK

**Verified fact:** Mastra's official agent API is in `@mastra/core`; agents expose `generate()` and `stream()`. Current Mastra release information lists `@mastra/core@1.66.0`. Mastra's current Node guidance requires Node 22.13.0 or newer; the plan's Node 22.18+ floor is conservative.

**Plan implication:** The target SDK version is supported by the current release source reviewed. The implementation should still lock the exact package and provider package versions in its own package manifest.

### Local dependency and readiness

**Verified fact:** A direct Mastra agent can run in the application process. Mastra Studio is an optional local interface, not a required execution service. The official project generator creates a normal Node/TypeScript project.

**Plan implication:** The direct baseline does not need a Mastra server or Studio readiness check. The Lab service and its model provider configuration are the readiness boundary.

### Execution identity

**Verified fact:** The direct `Agent.generate()` API is an agent call API, not a durable workflow-run service with a platform-owned execution identity.

**Plan implication:** The Lab must own the run and turn IDs for this baseline. Do not label the Lab run ID as a Mastra-native workflow ID. Trace or model-provider metadata should be retained only when actually returned.

### Durability, checkpoint, and state semantics

**Verified fact:** Mastra workflows support suspend/resume and snapshots; snapshots persist workflow state, step outputs, paths, suspended metadata, and retry-related information. Those semantics belong to Mastra workflows and storage, not to a bare direct `Agent.generate()` call.

**Plan implication:** The active plan is correct to exclude workflows, snapshots, memory storage, and crash recovery from the direct baseline. Its evidence files are Lab durability, not proof that the Mastra agent call is crash durable.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Mastra documents abort signals in tool execution contexts and workflow suspension/resumption. The direct agent call still needs an end-to-end cancellation test through the selected model provider. The reviewed sources do not establish exactly-once external model-call semantics for `generate()`.

**Plan implication:** Keep cancellation cooperative and provider-dependent until the actual call path is tested. Treat a lost provider response as unknown; do not silently retry a side-effecting or billable request without an idempotency policy.

**Unresolved:** The plan's fake-model injection and precise run-state mapping need a current Mastra API proof or a Lab-owned adapter contract. The official agent overview alone does not establish those details.

### Local/production equivalence

**Assessment:** The plan does not overclaim if it calls this an in-process direct-agent baseline. It would overclaim if “Mastra baseline” implied Mastra workflow snapshots, storage, memory, or production deployment semantics.

**Sources, accessed 2026-09-15:**

- [Agents overview](https://mastra.ai/docs/agents/overview)
- [Workflows overview](https://mastra.ai/docs/workflows/overview)
- [Workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)
- [Storage](https://mastra.ai/docs/storage)
- [Local project creation](https://mastra.ai/en/docs/local-dev/creating-a-new-project)
- [Node.js and package changes](https://mastra.ai/blog/changelog-2026-01-20)
- [Official release source](https://github.com/mastra-ai/mastra/releases)
- [Official core package source](https://github.com/mastra-ai/mastra/blob/main/packages/core/README.md)

## Inngest

**Plan:** [`inngest-baseline.md`](../../development/implementation-plans/active/inngest-baseline.md)
**Audit result:** Mostly aligned; local readiness and idempotency retention need to become concrete.

### Official runtime and SDK

**Verified fact:** Inngest's official JavaScript SDK is the TypeScript/Node integration used to define functions and serve an Inngest endpoint. The official source package reports `inngest` version 4.20.0 at the audit date.

**Plan implication:** The active plan needs an exact SDK pin. “TypeScript/Node” alone is not enough for a reproducible platform variant.

### Local dependency and readiness

**Verified fact:** The official Dev Server is an open-source local version. The documented flow runs `inngest dev -u http://localhost:3000/api/inngest`, exposes the local UI on port 8288, and supports Docker. The documentation describes the local server as using the same execution model, flow control, and observability concepts as the hosted service.

**Plan implication:** The local profile needs the Dev Server, the Lab function endpoint, the exact SDK/CLI versions, a readiness check for both endpoints, and an explicit shutdown/orphan rule. The current plan says these details will be documented later, so they remain implementation blockers for an independent agent.

### Execution identity

**Verified fact:** Inngest uses events to trigger functions, functions contain independently executed steps, and idempotency can be based on event IDs or function idempotency keys.

**Plan implication:** The Lab should retain the emitted event ID, function identity, and native run identifier returned by the Dev Server/API. A Lab run ID should be placed in the event and in the function-level idempotency key only after deciding which scope is intended.

**Flag:** Inngest's documented event-ID and function-idempotency retention is 24 hours. The plan must not treat the idempotency key as a permanent execution identity or long-term duplicate protection.

### Durability, checkpoint, and state semantics

**Verified fact:** Inngest persists function state outside the function process. Steps are independently retried and completed step results are reused. Side effects and external APIs belong inside `step.run()`.

**Plan implication:** A model call should be an explicit step and its replay/duplicate behaviour must be recorded. The Lab evidence store remains separate from Inngest's own state.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Inngest documents a default retry policy of four retries after the initial attempt, step-level retry behaviour, and cancellation at step/sleep/action boundaries. Duplicate events can trigger duplicate function runs unless idempotency is configured.

**Plan implication:** The plan's duplicate-event, retry, cancellation, and unknown-outcome tests are required. “Cancelled” should describe a boundary-observed cancellation, not an immediate process kill. A lost acknowledgement after an external call still needs reconciliation.

### Local/production equivalence

**Assessment:** The official documentation supports semantic similarity between the Dev Server and hosted execution, but that is not infrastructure or operational equivalence. The plan should preserve this distinction and not use local results as proof of hosted scaling, availability, or account-level delivery behaviour.

**Sources, accessed 2026-09-15:**

- [Local development](https://www.inngest.com/docs/local-development)
- [How functions are executed](https://www.inngest.com/docs/learn/how-functions-are-executed)
- [Inngest steps](https://www.inngest.com/docs/learn/inngest-steps)
- [Error handling](https://www.inngest.com/docs/guides/error-handling)
- [Function cancellation](https://www.inngest.com/docs/features/inngest-functions/cancellation)
- [Idempotency](https://www.inngest.com/docs/guides/handling-idempotency)
- [Official SDK package source](https://github.com/inngest/inngest-js/blob/main/packages/inngest/package.json)

## Trigger.dev

**Plan:** [`trigger-dev-baseline.md`](../../development/implementation-plans/active/trigger-dev-baseline.md)
**Audit result:** Aligned with a material local-server dependency that must be explicit.

### Official runtime and SDK

**Verified fact:** The official SDK is `@trigger.dev/sdk`; current official source reports version 4.5.14 and Node.js >=18.20.0. The docs recommend keeping the CLI and SDK on the same version line.

**Plan implication:** The active plan needs exact SDK and CLI pins rather than “pin later.” TypeScript/Node is the correct implementation family.

### Local dependency and readiness

**Verified fact:** `trigger.dev dev` runs task code locally, with each task in a separate Node process, but scheduling is still performed by the Trigger.dev server. The official docs explicitly state there is no offline development mode and that a secret key is required for the documented setup. Stopping the local dev server automatically cancels local runs.

**Plan implication:** The local profile is not a self-contained worker-only test. Readiness must cover the Trigger server, project/environment configuration, secret key, worker/task endpoint, and the local task process. A fresh agent must not replace the server with an in-memory mock while still calling the result “Trigger.dev local execution.”

### Execution identity

**Verified fact:** Trigger.dev exposes a unique run ID and unique attempt IDs. Tasks have unique task IDs, and idempotency keys have explicit scopes and TTL behaviour.

**Plan implication:** Normalize run ID and attempt ID separately. The Lab run ID can be the idempotency key only after selecting the intended scope. Default idempotency retention is 30 days, not infinite; failed runs clear the key while successful and cancelled runs retain it according to the documented rules.

### Durability, checkpoint, and state semantics

**Verified fact:** Trigger.dev runs expose queued, executing, waiting, completed, cancelled, failed, timed-out, crashed, system-failure, and expired states. Task execution is scheduled and controlled by the Trigger server, while task code runs in the local worker during local development.

**Plan implication:** The plan should preserve the distinction between task run state and individual attempt state. Local worker restart and server restart are different failure injections.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Tasks default to three total attempts unless configured otherwise. Cancellation uses task cancellation signals/hooks and cancelled runs do not retry. Local development automatically cancels runs when the dev server stops.

**Plan implication:** The plan's retry, timeout, cancellation, restart, lost-acknowledgement, and unknown-outcome cases are appropriate. The model-call boundary still needs an idempotency or reconciliation policy; Trigger run cancellation does not reverse an already completed external call.

### Local/production equivalence

**Assessment:** The plan is accurate only if “same local task build” is kept separate from “same scheduling/control infrastructure.” Trigger's own documentation says local task code uses the same build system while the server remains responsible for scheduling. This is not offline or full production equivalence.

**Sources, accessed 2026-09-15:**

- [CLI development commands](https://trigger.dev/docs/cli-dev-commands)
- [Manual setup](https://trigger.dev/docs/manual-setup)
- [How Trigger.dev works](https://trigger.dev/docs/how-it-works)
- [Tasks overview](https://trigger.dev/docs/tasks/overview)
- [Runs and attempts](https://trigger.dev/docs/runs)
- [Idempotency](https://trigger.dev/docs/idempotency)
- [Triggering and development TTL](https://trigger.dev/docs/triggering)
- [Official SDK package source](https://github.com/triggerdotdev/trigger.dev/blob/main/packages/trigger-sdk/package.json)

## DBOS

**Plan:** [`dbos-baseline.md`](../../development/implementation-plans/active/dbos-baseline.md)
**Audit result:** Mostly aligned; the plan should distinguish the DBOS library from its optional production control service.

### Official runtime and SDK

**Verified fact:** The official TypeScript SDK is `@dbos-inc/dbos-sdk`. Current DBOS documentation requires Node 20 or newer and PostgreSQL. The SDK cannot be treated as an ordinary bundled Vite/Webpack module because of its workflow registry.

**Plan implication:** The plan's TypeScript/Node choice is correct, but it needs an exact SDK pin and must keep DBOS workflow code outside the frontend bundling path.

### Local dependency and readiness

**Verified fact:** The open-source DBOS library requires PostgreSQL and can start it locally with `npx dbos postgres start`. DBOS launches inside the application process; it does not require a separate DBOS orchestration server for the local library baseline. DBOS Conductor is a separate service for distributed recovery, management, and operations.

**Plan implication:** The plan's local Postgres dependency is correct. Its HTTP control boundary is Lab-owned. Readiness should test Postgres schema availability and `DBOS.launch()` rather than inventing a DBOS server health endpoint.

### Execution identity

**Verified fact:** DBOS workflows have workflow IDs. An explicitly supplied workflow ID is globally unique and can act as an idempotency key; starting the same workflow ID does not create an independent second workflow.

**Plan implication:** Mapping the Lab run ID to an explicit DBOS workflow ID is appropriate, but the native workflow name, application version, and workflow ID must be preserved separately.

### Durability, checkpoint, and state semantics

**Verified fact:** DBOS stores workflow and step checkpoints in its system database and recovers after a process crash from the last completed step. Steps are at-least-once and completed steps are not re-executed after their checkpoint. DBOS transactions atomically commit application changes and a DBOS checkpoint.

**Plan implication:** A model call in an ordinary step is not automatically exactly-once. The plan should distinguish DBOS's transaction guarantee from the delivery guarantee of an external provider. Local PostgreSQL validates the core checkpoint path, not production HA.

### Retries, cancellation, and unknown outcomes

**Verified fact:** DBOS supports durable timeouts and sleeps. Cancellation preempts at the next step boundary. Workflow IDs can deduplicate workflow starts, but an external step can still have an unknown outcome if the process loses contact after the side effect.

**Plan implication:** The plan's restart, duplicate, timeout, cancellation, and unknown-outcome tests are correctly scoped. The implementation must record whether recovery resumed a completed step or re-entered an at-least-once step.

### Local/production equivalence

**Assessment:** The plan does not overclaim if it calls local Postgres the DBOS library baseline. It would overclaim if it treated the single application process plus Postgres as equivalent to DBOS Conductor's distributed recovery and operational management.

**Sources, accessed 2026-09-15:**

- [Add DBOS to a TypeScript app](https://docs.dbos.dev/typescript/integrating-dbos)
- [DBOS TypeScript programming guide](https://docs.dbos.dev/typescript/programming-guide)
- [DBOS quickstart](https://docs.dbos.dev/quickstart)
- [DBOS architecture](https://docs.dbos.dev/architecture)
- [DBOS client and workflow identity](https://docs.dbos.dev/typescript/reference/client)
- [DBOS testing and mocking](https://docs.dbos.dev/typescript/tutorials/testing)
- [Official TypeScript source](https://github.com/dbos-inc/dbos-transact-ts)

## Hatchet

**Plan:** [`hatchet-baseline.md`](../../development/implementation-plans/active/hatchet-baseline.md)
**Audit result:** The plan needs to choose between Hatchet embedded mode and the full local server/worker stack.

### Official runtime and SDK

**Verified fact:** Hatchet supports a TypeScript SDK and documents TypeScript clients, runs, cancellation, and embedded execution. The current TypeScript reference was updated in September 2026. The plan's TypeScript/Node family is appropriate, but the exact SDK/server versions are not pinned.

**Plan implication:** Version pinning must cover the SDK and whichever local runtime is chosen. “Hatchet server” is not a sufficient dependency description because the official embedded mode has a different dependency shape.

### Local dependency and readiness

**Verified fact:** Hatchet documents several local modes: embedded execution for local/CI without an account, a full Docker stack, Hatchet Lite, Docker Compose, and Kubernetes. The embedded TypeScript client starts a local sidecar with bundled Postgres by default and does not require an API token, Docker, or an external service.

**Flag:** The active plan assumes a required local Hatchet server and persistence profile. That is valid for the full-server variant but is too broad as a statement about Hatchet local development.

**Plan implication:** Select one mode for the baseline. If the goal is a small parallel implementation, embedded mode is the narrowest local dependency; if the goal is to study the full server/worker topology, keep the server profile and say explicitly that embedded mode is excluded.

### Execution identity

**Verified fact:** Hatchet durable task runs have run history and worker/attempt context. A durable task can survive worker failure and resume from a checkpoint.

**Plan implication:** Keep task/run/worker/attempt IDs as separate native fields. The plan must also identify whether the baseline uses an ordinary task or a durable task; their state and recovery claims are not interchangeable.

### Durability, checkpoint, and state semantics

**Verified fact:** Hatchet describes durable tasks and events as backed by a durable event log. Durable task execution resumes from the last checkpoint, while ordinary task execution is not automatically the same durability model.

**Unresolved:** The current plan says “Hatchet-backed prompt task” but does not make the durable-task versus ordinary-task selection explicit. This is a material implementation decision.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Hatchet cancellation is cooperative through a cancellation signal and graceful checks. The platform supports retries and task/run inspection; cancellation does not undo a completed external side effect.

**Plan implication:** Preserve the plan's retry, timeout, cancellation, restart, orphan, duplicate, and unknown-outcome tests. Add a test proving what happens when cancellation arrives while the worker is between a model call and its checkpoint.

### Local/production equivalence

**Assessment:** Embedded mode, Hatchet Lite, and the full self-hosted stack should not be treated as operationally equivalent. The durable task semantics may be comparable, but process topology, persistence, scheduling, and observability differ. The plan must name the chosen local mode in every result.

**Sources, accessed 2026-09-15:**

- [TypeScript reference](https://docs.hatchet.run/reference/typescript)
- [Running Hatchet locally](https://docs.hatchet.run/v1/running-locally)
- [Embedded Hatchet](https://docs.hatchet.run/v1/embedded)
- [Embedded TypeScript reference](https://docs.hatchet.run/reference/typescript/embedded)
- [Hatchet concepts](https://docs.hatchet.run/v1)
- [Cancellation](https://docs.hatchet.run/v1/advanced-tasks/cancellation)
- [Temporal-to-Hatchet durability comparison](https://docs.hatchet.run/v1/from-temporal-to-hatchet)
- [Official source repository](https://github.com/hatchet-dev/hatchet)

## Vercel Workflows

**Plan:** [`vercel-workflows-baseline.md`](../../development/implementation-plans/active/vercel-workflows-baseline.md)
**Audit result:** The durable SDK, local backend, and framework boundary need to be named precisely.

### Official runtime and SDK

**Verified fact:** The official durable workflow SDK is the `workflow` package. Its current source package reports `5.0.0-beta.51` at the audit date. The Vercel AI SDK is a separate model/tool SDK and is not the durable workflow engine itself.

**Flag:** The plan's phrase “Vercel Workflow/AI SDK boundary” conflates two different packages and responsibilities. An implementation agent could choose the wrong API if this remains unchanged.

**Plan implication:** Select `workflow` for durability and add AI SDK only if the model-call implementation needs it. Pin the exact package and the actual adapter used by this repository.

### Local dependency and readiness

**Verified fact:** The official workflow package includes a local world/backend. The documented local world stores JSON data on disk and uses an in-memory queue; it is the default for local Next development. The workflow repository also exposes integrations for several server/framework shapes, but the plan does not establish which one this Fastify server will use.

**Unresolved:** The plan needs an exact local package set, data directory, startup command, readiness signal, and Fastify integration proof. The current official getting-started guide is Next-oriented; package exports alone are not enough to prove the Lab adapter works.

### Execution identity

**Verified fact:** Workflow starts and inspection expose workflow execution state through the workflow SDK/tooling, but the reviewed plan does not map those native identifiers to the Lab run record.

**Plan implication:** Define the exact start response and native workflow/run identifier before implementation. Preserve the Lab run ID separately from the workflow identity and step IDs.

### Durability, checkpoint, and state semantics

**Verified fact:** `"use workflow"` code must be deterministic and resumable; `"use step"` is the boundary for external I/O. The local world uses filesystem JSON plus an in-memory queue. Vercel-managed production storage/queue/observability are different infrastructure, while self-hosting requires a different World such as a Postgres-backed implementation.

**Plan implication:** The local profile can validate workflow replay and step checkpointing, but it must record the local filesystem backend and queue limitations. A local JSON world is not production storage equivalence.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Official workflow documentation states that failed steps retry and that `FatalError` can stop retrying. The reviewed primary sources do not establish a complete, stable cancellation contract equivalent to the other platforms.

**Unresolved:** Cancellation API, cancellation persistence, native execution identity, and lost-acknowledgement behaviour must be verified from the exact SDK version selected. Do not put cancellation or provider exactly-once claims in the baseline until that verification exists.

### Local/production equivalence

**Assessment:** The plan is directionally correct to distinguish local and hosted profiles. It must be stronger: local `world-local` semantics can validate the workflow API and local persistence path, but cannot establish equivalence with Vercel-managed queues/storage or a custom production World.

**Sources, accessed 2026-09-15:**

- [Workflow v5 getting started](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/getting-started/next.mdx)
- [Workflow SDK README](https://github.com/vercel/workflow/blob/main/packages/workflow/README.md)
- [Local World README](https://github.com/vercel/workflow/blob/main/packages/world-local/README.md)
- [Workflow package source](https://github.com/vercel/workflow/blob/main/packages/workflow/package.json)
- [Workflow directives and deterministic execution](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/how-it-works/understanding-directives.mdx)
- [Vercel durable workflows overview](https://vercel.com/academy/build-ai-agent-harness/durable-workflows)

## AWS Step Functions

**Plan:** [`aws-step-functions-baseline.md`](../../development/implementation-plans/active/aws-step-functions-baseline.md)
**Audit result:** The plan must choose Standard or Express before implementation.

### Official runtime and SDK

**Verified fact:** The official JavaScript integration is AWS SDK for JavaScript v3, including the Step Functions client. The state machine itself is defined by Amazon States Language and executed by the managed Step Functions service or a local emulator.

**Plan implication:** TypeScript/Node is appropriate, but the plan needs an exact AWS SDK v3 package pin and an explicit state-machine type.

### Local dependency and readiness

**Verified fact:** AWS provides Step Functions Local, including a Docker image and port 8083, but AWS explicitly labels it unsupported and says it does not provide feature parity with the service. It is for local testing, not a production-equivalence claim.

**Flag:** The plan's “LocalStack or AWS local-development docs” wording is not a first-party source decision. LocalStack is a third-party emulator and cannot be treated as AWS verification. If the baseline uses LocalStack, the report and run evidence must label it as third-party emulation. If it uses AWS Step Functions Local, the unsupported/non-parity limitation must be prominent.

### Execution identity

**Verified fact:** `StartExecution` returns an execution ARN. Standard executions use execution names with idempotency behaviour while running; reusing a closed Standard name can produce `ExecutionAlreadyExists`. Express executions do not provide the same idempotency guarantee.

**Plan implication:** Preserve execution ARN, state-machine ARN, execution name, and workflow type. A Lab run ID can be the execution name only after enforcing AWS name length and character rules and deciding the retry/restart policy.

### Durability, checkpoint, and state semantics

**Verified fact:** Standard Workflows are durable and auditable for up to one year, with execution history retained for a documented period. Express Workflows are limited to five minutes and have materially different delivery and history semantics: asynchronous Express is at-least-once, synchronous Express is at-most-once, and Express does not retain the same Step Functions execution history.

**Flag:** The active plan currently leaves the workflow type open. This is not a cosmetic choice; it changes the meaning of identity, state visibility, retries, cancellation, and unknown outcomes.

### Retries, cancellation, and unknown outcomes

**Verified fact:** Retry and catch behaviour is defined in the state machine. `StopExecution` is supported for Standard executions and not supported for Express. Start responses and external service calls can still be interrupted, so an absent acknowledgement does not prove that the requested execution or downstream side effect did not occur.

**Plan implication:** The implementation must test Standard and Express separately or explicitly select one. Cancellation tests cannot be shared blindly. Reconciliation should use execution ARN/name and execution history/status where available.

### Local/production equivalence

**Assessment:** The plan is correct to say that LocalStack or local emulation is not proof of AWS managed guarantees, but the wording should be tightened around official versus third-party emulation. AWS itself says Step Functions Local is unsupported and non-parity. A local result can validate ASL wiring and adapter behaviour, not AWS availability, IAM, quota, regional service integration, or managed execution guarantees.

**Sources, accessed 2026-09-15:**

- [Choosing Standard or Express Workflows](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)
- [StartExecution API](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [StopExecution API](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StopExecution.html)
- [Step Functions Local](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html)
- [Execution details and history](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)
- [Error handling, retry, and catch](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Official AWS SDK for JavaScript source](https://github.com/aws/aws-sdk-js-v3)

## Required decisions before platform implementation

These are the smallest decisions an implementing agent needs before starting a platform plan. They are derived from the findings above; they do not replace the active plans.

1. Pin the SDK, CLI, server, image, and runtime versions independently for every platform.
2. Define local startup, readiness, shutdown, and orphan-process behaviour for every platform that uses a server or worker.
3. Preserve native execution identifiers alongside normalized Lab IDs.
4. Define the durable boundary around model calls and external side effects, including what happens after a lost response.
5. Define cancellation as the platform actually implements it: immediate, cooperative, boundary-based, or unsupported.
6. Record whether local persistence is in-memory, filesystem-backed, SQLite, Postgres-backed, or platform-managed.
7. Separate semantic similarity from production infrastructure equivalence in every run record and document.
8. Resolve the platform-specific blockers before parallel implementation: Restate Node floor; Hatchet embedded versus full stack; Vercel `workflow` versus AI SDK and adapter; AWS Standard versus Express; LangGraph SQLite/custom server limits; and the missing exact version/readiness details in the remaining plans.

## Audit boundary

This document is a source audit, not an implementation approval and not evidence that any platform has been integrated successfully. It records what the first-party sources establish as of 2026-09-15, what the active plans imply, and which decisions remain open. Existing implementation plans remain unchanged.
