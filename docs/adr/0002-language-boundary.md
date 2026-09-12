---
status: accepted
---

# Use Python for the laboratory core and TypeScript for native TypeScript platforms

Agent Harness Lab will use Python for the laboratory control plane, runner, scenarios,
experiments, and default implementations of platforms with strong Python support. The
React/Vite application will use TypeScript. Platforms that are TypeScript-native, such
as Mastra and the Vercel AI SDK, will be implemented in their native TypeScript and
Node.js runtime rather than rewritten in Python.

The repository will connect Python and TypeScript components through explicit process,
HTTP, or other wire contracts. JSON Schema remains the source of truth for shared run
records and telemetry; generated language-specific types must not replace those
schemas. Language and runtime versions must be recorded in each run when they can
affect the result.

## Considered options

- **Python everywhere:** rejected because it would require non-native reimplementations
  of TypeScript-first platforms and would prevent the lab from testing their actual
  runtime behaviour.
- **TypeScript everywhere:** rejected for the initial laboratory because Python has
  stronger fit with the surrounding agent ecosystem and the project already includes
  Python-oriented harness subjects.
- **Unrestricted polyglot development:** rejected because language and runtime costs
  would become an uncontrolled source of comparison noise.

## Consequences

The project owns two application toolchains. Cross-language contract tests, pinned
runtime versions, and separate measurements for process and orchestration overhead are
required. A platform may still receive an explicit implementation variant in another
language when language or runtime behaviour is the subject of an experiment.
