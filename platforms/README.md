# Platform implementations

Each directory contains one platform integration and the harness variants built with
that platform. Platform-specific agent definitions belong inside the harness variant
that constructs them.

The initial implementation direction is deliberately mixed by platform. Python is the
default language for the laboratory and for platforms with strong Python support.
Mastra and the Vercel AI SDK are TypeScript-native subjects, so their implementations
will use the Node.js and TypeScript runtime directly rather than being rewritten in
Python.

| Directory | Initial implementation direction | Role |
| --- | --- | --- |
| `openai-agents/` | Python by default | OpenAI Agents SDK primitives and runtime behaviour. |
| `langgraph/` | Python by default | Explicit graph and state-machine orchestration. |
| `temporal/` | Python by default | Durable workflow execution. |
| `restate/` | Python by default | Durable application runtime and communication. |
| `mastra/` | TypeScript-native | Mastra's TypeScript agent and workflow runtime. |
| `vercel-ai-sdk/` | TypeScript-native | Vercel's TypeScript AI application and agent primitives. |
| `compositions/` | Depends on the components | Combinations of platforms or architectural layers. |

The table describes the planned initial implementations, not a claim that other
language SDKs are unsupported. A platform may later receive an explicit variant in
another language when language/runtime behaviour is itself part of an experiment.

Some entries use one platform. Entries under compositions combine multiple platforms.
A backend platform variant declares its deployment profile and infrastructure
requirements. Keep platform-specific assumptions, agent definitions, dependencies,
telemetry, and tests local to the platform integration and its harness variants.

Computer Native is intentionally absent from this table. It is an extraction-ready
standalone project under [`computer-native/`](../computer-native/README.md), connected
to the Lab through [`integrations/computer-native/`](../integrations/computer-native/README.md).

When implementation starts, a harness variant may add an `agents/` directory for its
platform-specific agent definitions. Create it only when the first concrete agent
definition exists. Research, coding, transactional work, and other reusable workloads
remain scenarios rather than agent definitions.
