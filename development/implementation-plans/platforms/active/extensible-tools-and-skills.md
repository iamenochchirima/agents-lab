# Extensible tools and skills implementation

Status: researching and implementing. Created 2026-10-08.

## Goal and scope

Real tool/skill packages can be added without changing native agent loops. Preserve
native Mastra, LangGraph, Temporal and Restate execution. Use Waku, Pi, Hermes and
primary tool/skill specifications as research references. Keep catalog discovery,
permissions, execution, context and evidence distinct. Add actual workspace and
skill resources plus configured MCP/HTTP integrations, not simulated tool results.

## Constraints

- Preserve unrelated Studio/Lina changes.
- Commit coherent slices with relevant documentation.
- Free models only for unattended acceptance; no paid fallback.
- Focused behaviour checks, one useful live task per native profile; avoid redundant
  full test runs. No arbitrary plugin code installation or implied permissions.
- Temporary plan outside docs; permanent cited research and usage notes in docs/code.

## Implementation checkpoints

- [x] Research Waku/Pi/Hermes and official MCP/Agent Skills, inspect runtime coupling.
- [ ] Freeze resolved descriptors with full schemas, versions/digests, routing identity,
      effective limits and declared known-error feedback policy at run admission.
- [ ] Add a trusted capability host and generic adapter. Native execution still owns
      calls, cancellation and durable steps; the host owns source implementations.
- [ ] Load declarative package contributions, configured MCP/HTTP sources and real
      SKILL.md metadata, instructions and referenced resources.
- [ ] Implement actual workspace list/read/search/write/patch operations with scoped
      roots and explicit write grants. Use separate task environments per comparison.
- [ ] Replace native per-tool declarations/registration/failure-name switches with
      generic projections, including Python JSON Schema validation.
- [ ] Show effective package/tools/skills in the existing capability selection flow.
- [ ] Prove adding a catalog contribution works without a runtime source change.
- [ ] Run focused admission/dispatch/policy/skill-resource checks, relevant builds and
      actual free-model multi-step execution on each available native profile.
- [ ] Update usage/architecture/research and record commits, evidence and limitations.

## Design and alternatives

The existing inline calculator and fixture routes remain compatible. Hosted
contributions cross an authenticated internal HTTP interface so Python and TS
native workers share implementations and configuration without importing each
other's code. Resolve declarations before durable execution; never rediscover tools
inside workflow replay. The host rechecks retained run grants and revision before
execution. It is infrastructure, not an agent loop or a model proxy.

Prefer the existing JSON Schema contracts. Add Ajv as a direct pinned dependency
already present transitively, because handwritten argument switches cannot validate
arbitrary discovered schemas. Keep model SDK projections native.

## Evidence and commits

Pending. Completion requires actual package execution, not only builds.
