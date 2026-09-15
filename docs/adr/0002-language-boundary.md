---
status: accepted
---

# Use TypeScript for the laboratory core and platform-native languages for variants

Agent Harness Lab will use TypeScript for the laboratory server, runner, CLI,
local-development services, and the Computer Native Lab integration. The React/Vite application
uses the same TypeScript workspace. Scenarios and experiments are language-neutral
definitions wherever practical, rather than being owned by the server language.

Each platform variant uses its most representative supported language. The initial
TypeScript variants are OpenAI Agents SDK, Temporal, Restate,
Mastra, and Vercel AI SDK. LangGraph begins with a Python variant. A second language
variant is added only when its SDK/runtime differences are themselves the subject of an
experiment; it is not created merely to duplicate an implementation.

Python variants connect to the TypeScript laboratory through explicit process, HTTP, or
other wire contracts. JSON Schema remains the source of truth for shared run records
and telemetry; generated language-specific types must not replace those schemas.
Language and runtime versions must be recorded in each run when they can affect the
result.

## Considered options

- **Python everywhere:** rejected because it would require non-native reimplementations
  of TypeScript-first platforms and would prevent the lab from testing their actual
  runtime behaviour.
- **Python for the laboratory core:** rejected because it would split the initial
                    server, CLI, and UI across toolchains without improving the first platform
  comparisons. Python remains the native choice for platform variants where it is the
  most faithful implementation, beginning with LangGraph.
- **Unrestricted polyglot development:** rejected because language and runtime costs
  would become an uncontrolled source of comparison noise.

## Consequences

The project initially owns a TypeScript application toolchain and introduces a Python
toolchain only with the first Python-native platform variant. Cross-language contract
tests, pinned runtime versions, and separate measurements for process and orchestration
overhead are then required. A platform may receive another language variant when
language or runtime behaviour is the subject of an experiment.
