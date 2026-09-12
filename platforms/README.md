# Platform implementations

Each directory contains a platform implementation used by an Agent Harness Lab harness.

The initial implementation direction is deliberately mixed by platform. Python is the
default language for the laboratory and for platforms with strong Python support.
Mastra and the Vercel AI SDK are TypeScript-native subjects, so their implementations
will use the Node.js and TypeScript runtime directly rather than being rewritten in
Python.

| Directory | Initial implementation direction | Role |
| --- | --- | --- |
| `standalone/` | Project-owned runtime | An independently controlled agent runtime and execution loop. |
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
A platform can be paired with any compatible environment. Keep platform-specific
assumptions, dependencies, telemetry, and tests local to the platform implementation.
