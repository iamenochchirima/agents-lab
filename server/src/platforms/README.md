# Platform implementations

Each directory contains one durable-execution platform integration and the variants
built with that platform. Platform-specific agent definitions belong inside the variant
that constructs them.

Every real platform implementation gets its own plan copied from
[`development/implementation-plans/platforms/templates/platform-baseline.md`](../../../development/implementation-plans/platforms/templates/platform-baseline.md).
The plan names the files an agent owns, the local services it needs, the platform's
execution and durability semantics, its native evidence, and the exact tests that make
it runnable. A platform adapter may change common server code only after recording why
the existing runner seam cannot express a real platform requirement.

The initial implementation direction is deliberately mixed by platform. Python is the
default language for the laboratory and for platforms with strong Python support.
The platform list is intentionally practical for this phase. LangGraph and Mastra stay
in the durable-execution list because their checkpointing and workflow behaviour are
important to the experiments. We can introduce finer categories later if they help a
real comparison.

| Directory | Initial implementation direction | Role |
| --- | --- | --- |
| `temporal/` | TypeScript initially | Durable workflow execution; includes the initial OpenAI Agents SDK variant. |
| `restate/` | TypeScript initially | Durable application runtime and communication. |
| `langgraph/` | Python initially | Graph execution with checkpointed state. |
| `mastra/` | TypeScript initially | Agent and workflow execution. |
| `vercel-workflows/` | TypeScript initially | Vercel Workflow and AI SDK execution. |
| `inngest/` | TypeScript initially | Event-driven durable functions and workflows. |
| `trigger-dev/` | TypeScript initially | Durable background tasks and workflows. |
| `dbos/` | TypeScript initially | Database-backed durable execution. |
| `hatchet/` | TypeScript initially | Durable task orchestration. |
| `aws-step-functions/` | TypeScript initially | Managed durable state machines. |
| `compositions/` | Depends on the components | Combinations of platforms or architectural layers. |

The table describes the planned initial implementations, not a claim that other
language SDKs are unsupported. A platform may later receive an explicit variant in
another language when language/runtime behaviour is itself part of an experiment.

The OpenAI Agents SDK is not a platform directory. It begins as a Temporal variant and
can later appear in another platform only when that comparison is useful. A backend
platform variant declares its deployment profile and infrastructure requirements. Keep
platform-specific assumptions, agent definitions, dependencies, telemetry, and tests
local to the platform integration and its variants.

The server registry combines this planning catalog with the adapters actually composed
at startup. Adding a new platform directory does not make it runnable; its adapter must
implement the generic runner contract, be registered by the server bootstrap, and have
its own implementation plan and validation record.

## Model provider boundary

Production-facing Platform UI runs use an explicitly selected OpenRouter model. Each
platform keeps its OpenRouter request at the platform-native execution boundary so the
platform's own retries, workflow history, checkpoints, or task state remain observable.

Every baseline also retains a local `fake` adapter. It is an explicit deterministic test
fixture, not a production model and not a fallback. Tests use named fixtures to force
success, timeout, cancellation, retry, tool-call, or ambiguous-outcome behaviour that
cannot be reproduced reliably with a live provider. A missing key or failed OpenRouter
request is surfaced as an error.

## Current runnable baselines

The current server composition registers these baseline adapters. A registered adapter
is an implementation surface; its `checkConnection()` result still depends on the
required local service being available.

| Platform | Baseline boundary | Local dependency |
| --- | --- | --- |
| Temporal | TypeScript workflow and worker | Temporal server and worker |
| Restate | TypeScript durable workflow service | Restate server and registered service |
| LangGraph | Python graph service with SQLite checkpoints | LangGraph service |
| Mastra | Direct TypeScript agent call | Lab server process |
| Inngest | TypeScript event/function service | Inngest Dev Server and function service |
| Trigger.dev | TypeScript task and worker boundary | Trigger server and local task worker |
| DBOS | TypeScript workflow host | PostgreSQL and DBOS service |
| Hatchet | TypeScript task and worker boundary | Embedded Hatchet engine locally; remote Hatchet server and worker when selected |
| AWS Step Functions | Standard state machine and Activity worker | Step Functions Local or an AWS profile |
| Vercel Workflows | Local Workflow SDK service and model step | Workflow local World or a hosted Vercel profile |

The UI uses this distinction directly: a platform can be selectable while its run
control remains disabled until the server reports that its required dependency is
reachable.

The first cross-platform acceptance workload is the
[platform-agent-conformance scenario](../../../lab/scenarios/platform-agent-conformance/README.md).
It is shared at the request and evidence boundary, while each platform keeps its
native model/tool loop, state, retry, cancellation, and recovery semantics. The
priority local profile is Temporal, Restate, LangGraph, and Mastra; Temporal and
Restate use native local services, LangGraph uses its loopback Python service with
SQLite checkpoints, and Mastra runs directly in the Lab server process. Docker is
optional for this profile.

## Four-platform acceptance profile

The current browser acceptance profile uses Temporal, Restate, LangGraph, and Mastra.
The same workload and selected OpenRouter model can be submitted through each Chat
page or through Compare. Compare correlates member runs with `comparisonId`, while each
member keeps its own context session, client turn, native execution, lifecycle status,
and `lab/runs/<run-id>/` evidence.

The deterministic acceptance suite uses the same runner and tool boundaries with
provider-shaped fixtures, so it runs without an OpenRouter key. Real-model acceptance
is opt-in and must record the model identifier, package/runtime versions, local service
commands, run IDs, observed statuses, and evidence inspection. It must never retain an
API key, authorization header, raw provider response, or sensitive prompt.

The capability-specific matrix is also opt-in. With Temporal, Restate, LangGraph, Mastra,
and the shared local HTTP fixture running, use:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:platform-capability-matrix
```

It sends the same `local-safe` profile through all four native runner boundaries and fails
if a platform is unavailable, a connected tool does not execute, or event identity is not
unique. Set `AGENTLAB_LOCAL_FIXTURE_URL` when the fixture is not at its default loopback
endpoint. The command does not start a second fixture because external platform services
must use the same endpoint.

Run the native profile with:

```bash
temporal server start-dev --db-filiname /tmp/agent-harness-lab-temporal.db
./scripts/run_local_stack.sh
```

The profile is intentionally not a lowest-common-denominator durability claim. Native
workflow history, Restate journal/state, LangGraph checkpoints, and Mastra process or
LibSQL state remain inspectable in their platform-owned boundaries.

Every baseline variant has the same responsibility layout:

```text
composition/ context/ sessions/ runtime/ models/ state/
execution/ durability/ telemetry/ config/ tests/
```

`composition/` selects reusable capabilities from `server/src/capabilities/`. Do not copy skills,
OAuth connections, MCP definitions, plugin manifests, policies, or artifact definitions
into every platform. The selected platform owns execution, state, durability, and its
native telemetry behaviour.

When implementation starts, a harness variant may add an `agents/` directory for its
platform-specific agent definitions. Create it only when the first concrete agent
definition exists. Research, coding, transactional work, and other reusable workloads
remain scenarios rather than agent definitions.
