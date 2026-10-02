# Modular agent Studio program

**Created:** `2026-09-25T00:48:15+02:00`

**Last updated:** `2026-09-26T00:00:00+02:00`

**Status:** Program plan

## Purpose

Studio will be a browser-accessible laboratory for learning how agent harnesses
work by developing their modules independently, assembling them into a complete
agent, and inspecting the evidence from real runs. The first implementation
establishes the repository structure and role-specific module interfaces. The first
standalone implementation for each role is now connected through one fixed reference
assembly. Later focused plans will review those seams, expand run inspection where
needed, and add controlled alternatives.

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
  with future independently owned harnesses or business agents is optional and should follow
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

Stage 1, the package and interface foundation, and Stage 2, the first standalone
module baselines, are complete. Stage 2 began with the
[Input and Context baseline slice](completed/studio-input-context-baselines.md).
The completed [chat test slice](completed/studio-chat-test-slice.md) pulls a small
fixed integration forward: it adds minimal Control and deterministic Replay
baselines so Input, Memory, and Context can be exercised through the browser. Its
completed [tool round-trip follow-up](completed/studio-tool-roundtrip.md) adds one
bounded Tool Use, Safety, and Execution Environment exchange. These are deliberate
early integration steps, not the general run system. The existing static Components
preview remains separately scoped. The completed
[kernel and reference assembly plan](completed/studio-kernel-reference-assembly.md)
connects all twelve initial implementations through one fixed deterministic cycle,
with local text, calculator, and controlled-computer scenarios plus saved run
evidence. It is a reference assembly, not a general plugin loader or production run
manager.

1. **Workspace architecture and module interfaces.** Establish package and app
   ownership, the shared protocol, twelve role-specific interfaces, and the package
   standard. Prove the standard with one narrow standalone example. Add the Studio
   API host shell and define the browser-to-API seam. See the
   [completed foundation plan](completed/studio-module-foundation.md).
2. **Standalone module baselines.** Implement one small, independently checked
   behavior for each role. Split this work into focused plans by module or related
   module group. The first slice, [Input and Context](completed/studio-input-context-baselines.md),
   is complete. A minimal Control and Replay implementation is pulled forward by the
   completed [chat test slice](completed/studio-chat-test-slice.md) to exercise an
   integrated path. The completed [remaining role baselines plan](completed/studio-remaining-module-baselines.md)
   adds Planning, Computer Use, Output Actions, and Observability.
3. **Kernel and reference assembly.** Complete. The fixed kernel composition
   validates the twelve-component descriptor, owns run lifecycle and cancellation,
   and preserves role-specific contracts. Alternatives still need separate evidence
   that they conform and compose correctly.
4. **Studio run API and browser inspection.** The browser chats only with the Studio
   API, which exposes the reference assembly and returns a safe run projection. The
   first slice persists config, events, and results together. A general run manager,
   live status stream, and broader evidence inspection remain later focused work.
5. **Reproducibility and failure behavior.** The first controlled text, calculator,
   and computer fixtures record implementation/configuration provenance and terminal
   evidence. Run records are local; process restart clears chat and Memory, and an
   abrupt process failure can leave an incomplete run. Broader restart, recovery,
   and remote-storage work needs its own plan.
6. **Component alternatives and experiments.** Add alternative implementations and
   comparison procedures only after the first assembly exposes useful seams. Keep the
   changed variable and interpretation limits explicit.

Each stage has its own implementation plan, acceptance checks, documentation, and
handoff. The next planning step is to review the reference assembly's module seams
and run evidence, then choose a bounded plan for the highest-value follow-up before
adding variations.

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

- How to broaden assembly compatibility beyond the first fixed reference descriptor.
- Which additional run data is needed for broader comparisons, and how incomplete
  runs should be inspected after a process restart.
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
constrain this program's package layout or runtime design. The ownership decision is
implemented: the Studio API lives in `apps/studio-api/`, the browser remains in
`apps/web/`, and the existing `server/` continues to serve the Platform Lab.
