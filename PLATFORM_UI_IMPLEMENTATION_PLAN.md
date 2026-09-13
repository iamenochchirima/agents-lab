# Platform UI implementation plan

## Purpose

Make `/platforms` the primary workspace for understanding and configuring each agent
platform. Keep the interface clean, operational, and honest about what is not yet
implemented.

## Scope

- [ ] Replace the generic Platforms placeholder with a platform workspace.
- [ ] Add platform tabs for Standalone, Temporal, Restate, LangGraph, OpenAI Agents
  SDK, Mastra, and Vercel AI SDK.
- [ ] Give every platform a stable route: `/platforms/:platformId`.
- [ ] Add concise platform overview details: execution model, durability model, current
  status, supported environments, and required infrastructure.
- [ ] Add platform sub-routes: Overview, Run, Environments, Infrastructure, Variants,
  Runs, and Implementation map.

## Run configuration

- [ ] Add a platform-specific Run page.
- [ ] Support a canonical scenario or an exploratory custom task.
- [ ] Select a platform variant, environment profile, model configuration, and optional
  experiment.
- [ ] Keep shared configuration distinct from platform-specific configuration.
- [ ] Validate and explain incompatible choices in the interface.
- [ ] Show an honest unavailable execution state until a real runner exists.

## Environments and infrastructure

- [ ] Add environment catalogue and environment-detail routes.
- [ ] Model initial profiles: sandboxed container workspace, local persistent workspace,
  API-native service environment, browser environment, and remote computer or VM.
- [ ] Show each profile's isolation, workspace, network, resource, lifecycle, and
  compatibility facts concisely.
- [ ] Distinguish environment requirements from platform infrastructure requirements.
- [ ] Add Temporal infrastructure details without inventing runtime health data.

## Comparison

- [ ] Add a global Compare route.
- [ ] Select multiple platforms and a common scenario, environment, model settings, and
  optional experiment.
- [ ] Show compatibility checks before a comparison can run.
- [ ] Preserve platform-specific configuration rather than flattening meaningful
  differences.

## Implementation boundaries

- [ ] Organize platform, environment, and comparison features into focused route,
  catalog, and component modules.
- [ ] Use typed catalogue data as the initial UI source; do not duplicate platform facts
  across page components.
- [ ] Keep the future execution API behind feature boundaries; do not add mock runs,
  fake metrics, or simulated infrastructure controls.
- [ ] Keep Docs as its existing separate layout and link to relevant documentation where
  useful.

## Validation

- [ ] Run documentation-catalog generation after documentation changes.
- [ ] Run `npm run typecheck` from `apps/web`.
- [ ] Run the production build after route or styling changes.
- [ ] Manually verify direct navigation, refresh, active platform tabs, narrow-screen
  behavior, unavailable states, and the comparison compatibility flow.

## Explicitly out of scope

- Connecting to a real runner or model provider.
- Provisioning Docker, VMs, browsers, or external infrastructure.
- Displaying fabricated run timelines, metrics, or health status.
