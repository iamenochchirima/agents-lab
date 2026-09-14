# Platform UI implementation plan

## Purpose

Make `/platforms` the primary workspace for understanding and configuring each agent
platform. Keep the interface clean, operational, and honest about what is not yet
implemented.

## Scope

- [x] Replace the generic Platforms placeholder with a platform workspace.
- [x] Add platform tabs for Computer Native, Temporal, Restate, LangGraph, OpenAI Agents
  SDK, Mastra, and Vercel AI SDK.
- [x] Give every platform a stable route: `/platforms/:platformId`.
- [x] Make each platform route a focused task-and-run surface rather than an
  architecture dashboard.
- [x] Keep platform details available as compact run choices instead of persistent
  overview cards and sub-navigation.

## Run configuration

- [x] Add a platform-specific task surface with a custom prompt and scenario selector.
- [x] Support a canonical scenario or an exploratory custom task.
- [x] Select a platform variant, environment profile, model configuration, and optional
  experiment.
- [x] Keep shared configuration distinct from platform-specific configuration.
- [x] Validate and explain incompatible choices in the interface.
- [x] Show an honest unavailable execution state until a real runner exists.

## Environments and infrastructure

- [x] Add environment catalogue and environment-detail routes.
- [x] Model Computer Native's initial profiles: local workspace process, sandboxed
  container, and VM / remote computer.
- [x] Show each profile's isolation, workspace, network, resource, lifecycle, and
  compatibility facts concisely.
- [x] Distinguish environment requirements from platform infrastructure requirements.
- [x] Add Temporal infrastructure details without inventing runtime health data.

## Comparison

- [x] Add an in-context Compare modal from the platform runner.
- [x] Select multiple platforms and a common scenario, environment, model settings, and
  optional experiment in that modal.
- [x] Keep comparison execution unavailable until compatible runners exist.
- [x] Preserve platform-specific configuration rather than flattening meaningful
  differences.

## Implementation boundaries

- [x] Organize platform, environment, and comparison features into focused route,
  catalog, and component modules.
- [x] Use typed catalogue data as the initial UI source; do not duplicate platform facts
  across page components.
- [x] Keep the future execution API behind feature boundaries; do not add mock runs,
  fake metrics, or simulated infrastructure controls.
- [x] Keep Docs as its existing separate layout and link to relevant documentation where
  useful.

## Validation

- [x] Run documentation-catalog generation after documentation changes.
- [x] Run `npm run typecheck` from `apps/web`.
- [x] Run the production build after route or styling changes.
- [x] Manually verify direct navigation, refresh, active platform tabs, narrow-screen
  behavior, unavailable states, and the comparison compatibility flow.

## Explicitly out of scope

- Connecting to a real runner or model provider.
- Provisioning Docker, VMs, browsers, or external infrastructure.
- Displaying fabricated run timelines, metrics, or health status.
