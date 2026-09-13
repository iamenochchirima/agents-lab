# Reference harness code maps

These notes map existing agent harness codebases to Agent Harness Lab's 32
responsibilities. They are reading guides, not benchmark results and not platform
implementations. Their purpose is to make the code behind a capability easy to find
before we design our own implementation.

## How to use a map

Read a map in this order:

1. Start with the mental model and turn path.
2. Open the directory map when you need to find the code's owner.
3. Use the capability table to answer a precise question, such as "where does
   this project build context?"
4. Follow the listed function or file in the checked-out source tree.

Each note pins a repository URL, commit, local checkout, and review date. The
paths are relative to that repository's root. A later source revision may move
the code or change its behaviour.

The table labels mean:

- **Present**: the reviewed source contains an identifiable implementation.
- **Partial**: relevant code exists, but it does not establish the complete
  laboratory responsibility.
- **Not found**: this review did not find an implementation. It is not proof
  that no code exists elsewhere in the repository.
- **Out of scope**: the project intentionally delegates or does not attempt it.

## The maps

- [Hermes](hermes.md): a large Python-first personal-agent system with multiple
  interfaces, tool environments, memory providers, plugins, and subagents.
- [Waku](waku.md): a compact Python agent designed to make the loop, memory,
  evaluation, and tracing readable.
- [OpenClaw](openclaw.md): a TypeScript agent system with an embedded runtime,
  session/workspace contracts, tool policy, and optional native harness plugins.

## Important reading rule

Do not treat a filename as evidence of a guarantee. For example, a file named
`retry`, `durable`, or `memory` tells us where to inspect. The implementation,
tests, and failure behaviour decide what the project actually guarantees.

## Relationship to Agent Harness Lab

These documents use the same capability vocabulary as the coverage page so we
can compare design choices. They do not change the coverage status of any Agent
Harness Lab platform or harness variant. A capability in a reference project
becomes a lab claim only after we implement and verify it ourselves.
