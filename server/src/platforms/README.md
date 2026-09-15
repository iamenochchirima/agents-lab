# Platform implementations

Each directory contains one durable-execution platform integration and the variants
built with that platform. Platform-specific agent definitions belong inside the variant
that constructs them.

Every real platform implementation gets its own plan copied from
[`development/implementation-plans/templates/platform-baseline.md`](../../../development/implementation-plans/templates/platform-baseline.md).
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

Every baseline variant has the same responsibility layout:

```text
composition/ context/ sessions/ runtime/ models/ state/
execution/ durability/ telemetry/ config/ tests/
```

`composition/` selects reusable capabilities from `server/src/capabilities/`. Do not copy skills,
OAuth connections, MCP definitions, plugin manifests, policies, or artifact definitions
into every platform. The selected platform owns execution, state, durability, and its
native telemetry behaviour.

Computer Native is intentionally absent from this table. It is an extraction-ready
standalone project under [`computer-native/`](../computer-native/README.md), connected
to the Lab through [`integrations/computer-native/`](../integrations/computer-native/README.md).

When implementation starts, a harness variant may add an `agents/` directory for its
platform-specific agent definitions. Create it only when the first concrete agent
definition exists. Research, coding, transactional work, and other reusable workloads
remain scenarios rather than agent definitions.
