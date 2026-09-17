---
status: accepted
---

# Keep Anesu extraction-ready and separate from Lab implementation modules

Anesu is a compute-native agent harness developed from the ground up to
study agent loops, workspaces, tools, skills, memory, sandboxing, and recovery. It has
enough independent runtime, security, and release concerns to remain a standalone
project rather than an implementation directory inside `server/src/platforms/` or the Lab backend.
It is temporarily located at the repository root so it can be developed alongside the
Lab before later extraction to its own repository.

The Lab-side integration boundary remains under `server/src/integrations/anesu/`. It
will eventually submit a versioned run request and collect normalized events, artifacts,
results, and native diagnostics. The top-level `anesu/` project owns its
internal runtime and can operate without the Lab.

Computer environments are owned by Anesu in the initial model: local
workspace process, sandboxed container, and VM/remote computer. Browser automation is
a tool capability within a computer environment. Backend-oriented platforms instead
declare server deployments and required services.

## Considered options

- **Keep a `server/src/platforms/standalone/` implementation in the Lab:** rejected because it
  would make the Lab own and constrain a complete harness that should be independently
  usable and studied.
- **Use the same environment selector for every platform:** rejected because a
  computer workspace is a property of Anesu, whereas the durability-platform
  implementations are primarily studied as backend deployments.
- **Delay an integration boundary until the external repository exists:** rejected
  because the boundary is needed now to prevent accidental architectural coupling.

## Consequences

The Lab does not have a `harnesses/` implementation directory and its server and
platform directories do not carry Anesu runtime code. The future extracted
repository must provide a documented, versioned runner integration before it can
participate in Lab runs. Comparisons retain shared workload, model, and experiment
settings while each implementation keeps its own computer environment or backend profile.
