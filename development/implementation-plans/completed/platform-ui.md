# Platform UI implementation plan

**Created:** 2026-09-13T22:26:48+02:00
**Completed:** 2026-09-14T17:24:17+02:00
**Last updated:** 2026-09-15T00:03:51+02:00
**Status:** Completed

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

## Completion record

**Automated validation revalidated:** 2026-09-14T23:56:48+02:00
**Completion commits:** `8479508`

- `cd apps/web && npm run typecheck` — passed, including documentation-catalog generation.
- `cd apps/web && npm run build` — passed. Vite reported a large-chunk warning only; it
  was not a build failure.
- `git diff --check` — passed.

**Manual validation recorded:** direct navigation and refresh, active platform tabs,
narrow-screen layout, planned/unavailable states, and the comparison configuration flow
were reviewed interactively during the UI implementation. No scripted browser artifact
was retained for this early UI slice.

**Historical-scope note:** this plan records the platform taxonomy and UI state that
existed when it was completed. Current platform taxonomy is defined by the current
platform documentation and catalog; this archive is not retroactively rewritten.

## Known limitations

- No runner, model provider, or live run lifecycle is connected yet.
- Configuration choices are typed catalogue data, not server-validated execution inputs.
- The comparison modal configures an intended comparison but does not execute one.
- The build's large-chunk warning remains a follow-up performance concern, not a release
  blocker for this initial UI slice.

## Explicitly out of scope

- Connecting to a real runner or model provider.
- Provisioning Docker, VMs, browsers, or external infrastructure.
- Displaying fabricated run timelines, metrics, or health status.
