# Modular agent Studio program

**Created:** `2026-09-25T00:48:15+02:00`

**Last updated:** `2026-09-25T02:54:44+02:00`

**Status:** Program plan

## Purpose

Studio will be a browser-accessible laboratory for learning how agent harnesses
work by developing their modules independently, assembling them into a complete
agent, and inspecting the evidence from real runs. The first implementation will
establish the repository structure and role-specific module interfaces, then prove
the package pattern with a narrow example. Later focused plans will implement the
other roles, connect a complete assembly, and add controlled alternatives.

This is an umbrella plan. It records the shared direction and sequence. Each
implementation stage must have its own bounded plan before that stage begins.

## Direction

- Group Studio-owned code under a top-level `studio/` directory. The protocol,
  kernel, and each module are separate workspace packages inside that product tree.
- Give Studio its own API host in `apps/studio-api/`.
- Keep the browser application in `apps/web/`. It communicates with Studio through
  a client-safe HTTP contract and never imports or runs module implementations.
- Keep the existing `server/` focused on the Platform Lab.
- Treat `server/src/studio/` as the previous implementation during the transition.
  New packages do not import it; a later plan decides how its routes and storage
  are migrated or retired.
- Start with one small, independently testable implementation per module area.
  Assemble those first versions before developing alternatives.
- Let each role define an interface suited to its work. Memory, Context, Control,
  tools, and Observability do not share one artificial `run(input) -> output`
  method.
- Treat filesystem, browser, and backend access as capabilities selected by an
  assembly, not as the organizing principle for all module packages. Sharing code
  with future agents such as Anesu or business agents is optional and should follow
  demonstrated reuse.
- Keep all modules in this monorepo at first. A package may move to a separate
  repository or process when its release, dependency, ownership, or isolation needs
  justify that change.

## Intended organization

```text
apps/
  web/                         # Studio browser experience
  studio-api/                  # Studio HTTP host and run-facing application

studio/
  agent-protocol/              # Shared run identity, cancellation, capabilities, events
  http-contract/               # JSON-safe browser/API wire schemas
  agent-kernel/                # Assembly, compatibility, and run lifecycle
  modules/
    input/
    context/
    planning/
    memory/
    tool-use/
    computer-use/
    control/
    execution-environment/
    output-actions/
    safety/
    model-interface/
    observability/
  assemblies/
    reference-agent/           # Versioned selection and configuration of modules
  experiments/                 # Procedures, controls, scenarios, interpretation

lab/runs/<run-id>/              # Generated, inspectable run evidence
```

Directories with `package.json` files are independent pnpm workspace packages within
the `studio/` product tree. The exact package names and exports are determined by the
first implementation plan. The role-specific interface belongs with its module package.
`agent-protocol` contains only concepts with genuinely shared meaning. HTTP request
and response schemas live in `http-contract`, remain safe to use from the browser,
and do not expose internal runtime types.

## Program stages

Stage 1, the package and interface foundation, is complete. Stage 2 does not yet
have an active focused implementation plan. The earlier configuration-only UI
preview plan remains separately listed in the Studio index and must be reconciled
before run-facing browser work. Later stages describe the sequence, not permission
to implement them all at once.

1. **Workspace architecture and module interfaces.** Establish package and app
   ownership, the shared protocol, twelve role-specific interfaces, and the package
   standard. Prove the standard with one narrow standalone example. Add the Studio
   API host shell and define the browser-to-API seam. See the
   [completed foundation plan](completed/studio-module-foundation.md).
2. **Standalone module baselines.** Implement one small, independently checked
   behavior for each role. Split this work into focused plans by module or related
   module group. Do not assemble them yet.
3. **Kernel and reference assembly.** Implement assembly loading, compatibility
   checks, module wiring, run lifecycle, cancellation, and a complete first agent
   cycle using the standalone implementations.
4. **Studio run API and browser inspection.** Expose assembly selection, run start
   and cancellation, status, events, and evidence through HTTP. Connect the existing
   web application without moving module code into the browser.
5. **Reproducibility and failure behavior.** Add controlled scenarios, durable run
   records, implementation/configuration provenance, and checks for failure,
   cancellation, restart, and side effects where they apply.
6. **Component alternatives and experiments.** Add alternative implementations and
   comparison procedures only after the first assembly exposes useful seams. Keep the
   changed variable and interpretation limits explicit.

Each stage will have its own implementation plan, acceptance checks, documentation,
and handoff. A stage may be split further if its implementation has independent
contracts or validation.

## Completion direction

The program is successful when a contributor can choose a versioned assembly,
run a documented scenario from the browser, and inspect how the selected modules
interacted. Each module can also be built and checked independently. The evidence
identifies the exact module versions and configurations used, while preserving
useful module-specific details.

Studio is a learning and comparison environment. Its initial implementations are
reference points, not production recommendations or claims that one harness design
is universally best.

## Decisions to make in focused plans

- The minimal inputs, outputs, state, configuration, lifecycle, capability
  requirements, errors, and evidence for each of the twelve role interfaces.
- Which small behavior each first implementation will support and which dependencies
  it needs.
- How assembly compatibility is represented and reported.
- Which run data is durable, where it is stored, and how incomplete runs appear.
- How the browser is served alongside the separate Studio API in development and
  deployment.
- When to retire or migrate the existing server-hosted Studio routes and storage.
- Which later component comparisons provide meaningful evidence.

Do not resolve these by silently broadening Stage 1. Record choices and open questions
in the relevant focused plan or decision record.

## Historical context

The [component assembly discovery note](../../../docs/planning/studio-assembly-discovery.md)
records the original direction. The completed Studio plans describe the existing
server-hosted implementation and remain useful as inspected prior work. They do not
constrain this program's package layout or runtime design. The existing server
ownership decision must be reconciled with this program before Studio API code is
implemented.
