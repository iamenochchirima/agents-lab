---
status: accepted
---

# Keep Computer Native extraction-ready and separate from Lab implementation modules

Computer Native is a computer-native agent harness developed from the ground up to
study agent loops, workspaces, tools, skills, memory, sandboxing, and recovery. It has
enough independent runtime, security, and release concerns to remain a standalone
project rather than an implementation directory inside `platforms/` or the Lab server.
It is temporarily located at the repository root so it can be developed alongside the
Lab before later extraction to its own repository.

The Lab-side integration boundary remains under `integrations/computer-native/`. It
will eventually submit a versioned run request and collect normalized events, artifacts,
results, and native diagnostics. The top-level `computer-native/` project owns its
internal runtime and can operate without the Lab.

Computer environments are owned by Computer Native in the initial model: local
workspace process, sandboxed container, and VM/remote computer. Browser automation is
a tool capability within a computer environment. Backend-oriented platforms instead
declare backend deployment profiles and required services.

## Considered options

- **Keep a `platforms/standalone/` implementation in the Lab:** rejected because it
  would make the Lab own and constrain a complete harness that should be independently
  usable and studied.
- **Use the same environment selector for every platform:** rejected because a
  computer workspace is a property of Computer Native, whereas Temporal, Restate,
  LangGraph, and SDK implementations are primarily studied as backend deployments.
- **Delay an integration boundary until the external repository exists:** rejected
  because the boundary is needed now to prevent accidental architectural coupling.

## Consequences

The Lab does not have a `harnesses/` implementation directory and its server and
platform directories do not carry Computer Native runtime code. The future extracted
repository must provide a documented, versioned runner integration before it can
participate in Lab runs. Comparisons retain shared workload, model, and experiment
settings while each implementation keeps its own computer environment or backend profile.
