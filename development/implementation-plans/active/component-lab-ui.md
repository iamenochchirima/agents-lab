# Component Lab UI foundation

**Created:** `2026-09-16T11:00:00+02:00`  
**Last updated:** `2026-09-16T11:52:01+02:00`  
**Status:** Active  
**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [`repository rules`](../../../AGENTS.md)
- [`Component Lab proposal`](../../../docs/planning/component-lab.md)
- [`implementation plan lifecycle`](../README.md)
- [`Platform UI`](../completed/platform-ui.md)
- [`session context and compaction`](../completed/context-management.md)
- [`Anesu memory`](../completed/anesu-memory.md)
- [`browser chat surface`](../completed/browser-chat-surface.md)
- [`web app ownership`](../../../apps/web/src/README.md)
- [`route ownership`](../../../apps/web/src/routes/README.md)

This plan adds a visual workspace for focused harness-component experiments. It does
not replace the Platform Lab or make the current platform runner, comparison flow, or
execution contracts depend on Component Lab.

## Purpose

Give contributors a concrete UI in which to browse the eleven harness areas, inspect
the strategies and cases that will eventually be executable, and agree on the first
focused experiment shape before adding a component runner or persistence.

The first implementation is intentionally an honest configuration and alignment
surface. It may show planned strategies and expected evidence, but it must not invent
run results, metrics, infrastructure health, or completed implementations.

## Definition of done

From the browser, a contributor can:

1. Open a new top-level `Component Lab` navigation item at `/components`.
2. See all eleven harness areas with a short responsibility statement, current status,
   and next useful action.
3. Open the Context Management workspace at
   `/components/context-management` and see the first strategy catalog, including full
   history, sliding window, relevance-ranked retention, hierarchical summary, and
   token-budget allocation as separately described choices.
4. Select a context strategy and a predefined case such as long conversation,
   conflicting instructions, large tool output, old important fact, or strict token
   budget. Selection is local UI state only.
5. Inspect which parts of a future experiment are fixed and which part changes:
   case fixture, task, model/configuration, source inputs, budget, and grading controls
   remain fixed while the context strategy is the changed variable.
6. Set up two or more comparison slots and see the selected strategies and shared
   controls. The primary action clearly says execution is not implemented in this
   slice and remains unavailable.
7. Navigate back to the existing Platform Lab and use its current runner, chat, and
   comparison routes without changed behaviour.

The visible flow is:

```text
Component Lab → area catalog → Context Management
              → strategy + case selection → fixed experiment envelope
              → comparison preview → execution unavailable, no fabricated result
```

## Scope

- [x] Add a stable `/components` route and a `Component Lab` item to the main sidebar.
- [x] Add a feature-local catalog for all eleven component areas, with stable IDs,
      concise descriptions, status, ownership note, and a link to the relevant plan
      or design document when one exists.
- [x] Add a Component Lab entrance workspace that makes the difference between a
      planned, designing, implemented, and verified component visible without implying
      that an area navigation item is an executable implementation.
- [x] Add an area detail route for the selected component. Unimplemented areas may use
      a truthful planned-state view; they must not display fake controls that suggest
      they already run.
- [x] Build the first detailed Context Management workspace with strategy, case, and
      comparison-preview panels.
- [x] Represent the experiment envelope in the UI: fixed conditions, changed variable,
      expected evidence, and interpretation limits.
- [x] Keep all selections and preview configuration in React/browser memory. Do not add
      persistence, API calls, model calls, or a new server contract in this slice.
- [x] Keep the layout usable on desktop and narrow screens, with progressive disclosure
      for strategy details and configuration notes.
- [x] Add focused UI documentation and update the implementation-plan indexes so the
      new active slice is discoverable.

## Explicitly out of scope

- Changing the existing Platform Lab navigation semantics, platform registry, runner,
  Platform Chat surface, Compare flow, run API, model picker, or run evidence schema.
- Implementing context packing, ranking, summarization, token accounting, memory,
  planning, tool calling, orchestration, safety, or any other runtime component.
- Starting a generic component-experiment backend, worker, execution sandbox, or
  component-specific run record.
- Persisting user-created cases, strategies, observations, comparison history, or
  configuration in local storage or the server.
- Displaying sample result values, benchmark scores, completion claims, service health,
  or telemetry that has not come from a real run.
- Reusing platform identity as component identity. A platform may host a future
  component implementation, but the two remain separate concepts in the UI model.

## Finished behaviour

### User-visible behaviour

The `/components` page has a clear page heading, a short explanation of the lab's
purpose, and an eleven-item area catalog. Each area shows:

- name and one-sentence responsibility;
- status such as `Planned`, `Designing`, or `UI preview`;
- the next action or implementation note;
- a link to documentation when the source exists.

The Context Management detail view has:

- a small explanation of what context management changes and what it does not prove;
- strategy choices with descriptions, parameters, inputs, outputs, and limitations;
- predefined cases with the task, fixture summary, and intended observation;
- a fixed-versus-changed envelope panel;
- a comparison setup with two or more strategy slots;
- an evidence preview describing future retained, removed, summarized, and budget
  records, without presenting those records as observed results;
- an unavailable execution state that explains the next implementation slice.

The page should make the distinction between “configured for inspection” and “ran”
obvious. A browser refresh may clear selections because this slice has no persistence.

### Ownership and boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| `apps/web/src/features/component-lab/` | Component area/strategy/case catalogs, local preview state, and Component Lab views | Server execution, platform registry, or authoritative run evidence |
| `apps/web/src/routes/` | Stable `/components` and `/components/:areaId` route definitions | Component strategy semantics or platform route behaviour |
| `apps/web/src/app/navigation/` | The sidebar entry and its active-state link | Component availability or execution status |
| `docs/planning/component-lab.md` | Product vocabulary, intended comparison model, and open questions | Runtime contracts or claims about implementation status |
| Existing Platform features | Platform runs, chat sessions, model selection, and comparisons | Component Lab state |
| `server/` and `anesu/` | Existing execution and standalone harness contracts | New UI-only Component Lab state in this slice |

The feature should use a small local interface rather than prematurely generalizing
the existing coverage catalog. A shared abstraction becomes justified only when the
same component descriptors are consumed by a real runner or another independent UI.

## Initial catalog

The first catalog records these areas using stable IDs:

| ID | Area | First UI status | First useful detail |
| --- | --- | --- | --- |
| `input-perception` | Input and perception | Planned | Normalize raw input and parse the task before planning |
| `context-management` | Context management | Designing | Select, rank, compact, and budget context for a turn |
| `planning-reasoning` | Planning and reasoning | Planned | Compare interleaved, plan-first, and graph-oriented planning |
| `memory` | Memory | Planned | Study working, episodic, semantic, and procedural memory separately |
| `tool-use` | Tool use | Planned | Select, validate, dispatch, normalize, and recover from tool calls |
| `control-orchestration` | Control and orchestration | Planned | Compare loops, state machines, graphs, and delegation |
| `execution-environment` | Execution environment | Planned | Inspect isolation, permissions, and resource limits |
| `output-actions` | Output and actions | Planned | Separate proposed actions, verification, commit, and rendering |
| `safety-guardrails` | Safety and guardrails | Planned | Inspect filtering, anomaly detection, and confirmation gates |
| `model-interface` | Model interface | Planned | Compare routing, prompt formatting, retries, and instrumentation |
| `observability` | Observability | Planned | Inspect traces, metrics, artifacts, and safe diagnostic records |

`context-management` is the only detailed workspace in this slice. The other areas
may link to the proposal and show the next implementation note, but their cards must
not pretend that strategies are runnable.

## Context workspace contract

Keep the first UI contract local to the feature until an executable component runner
exists. The model should be explicit enough to make the future seam clear:

```ts
type ComponentLabStatus = "planned" | "designing" | "ui-preview" | "implemented" | "verified" | "blocked";

interface ComponentAreaDescriptor {
  id: string;
  name: string;
  summary: string;
  status: ComponentLabStatus;
  nextAction: string;
  document?: { label: string; documentId: string };
}

interface ComponentStrategyDescriptor {
  id: string;
  name: string;
  summary: string;
  parameters: readonly string[];
  inputs: readonly string[];
  outputs: readonly string[];
  limitations: readonly string[];
}

interface ComponentCaseDescriptor {
  id: string;
  name: string;
  task: string;
  fixtureSummary: string;
  intendedObservation: string;
  controls: readonly string[];
}
```

The Context workspace should expose these first strategies:

- full history;
- sliding window;
- relevance-ranked retention;
- hierarchical summary;
- token-budget allocation.

The catalog describes them; it does not claim that any strategy is implemented. Each
strategy must state whether its future output would include retained source IDs,
omitted source IDs, summary records, token estimates, and warnings.

The comparison preview keeps these controls fixed:

- case fixture and task;
- selected model and model parameters, when model selection is later connected;
- source message set and tool-result fixture;
- context-window and reserved-output assumptions;
- grading method and interpretation limits.

Only the context strategy and its explicit parameters vary between comparison slots.

## State, persistence, and evidence

- Catalog definitions are static, typed source data in the web feature.
- Area selection may be represented by the URL; strategy, case, and comparison choices
  are transient browser state.
- No preview selection is a run, and no preview should create a `lab/runs/<run-id>/`
  record.
- No component result, metric, trace, context snapshot, or memory record is created
  until a later execution plan defines its evidence contract.
- The UI must leave room for framework-specific evidence and normalized evidence to
  coexist when execution is eventually added.

## Failure, retry, and recovery semantics

- An unknown area ID uses the existing not-found route behaviour.
- A missing or malformed static catalog entry should fail development validation or
  render a clear unavailable state; it must not silently become an executable card.
- The UI makes no network requests in this slice, so there is no retry or external
  acknowledgement path to implement.
- Refreshing the page clears transient preview state and is documented as expected.
- Lazy route loading continues to use the existing route error boundary.

## Security and configuration

- This slice contains static instructional content and local selections only.
- No provider credentials, prompts, files, tool results, or user data are sent anywhere.
- Do not add a browser-side model key, server endpoint, persistence key, or environment
  setting for the preview.
- Future editable cases must pass through a separate validation, persistence, and
  evidence decision before they are added to this feature.

## Implementation checklist

### 1. Contracts and catalog

- [x] Add feature-local types for areas, statuses, strategies, cases, and preview
      configuration.
- [x] Add the eleven-area catalog and validate unique IDs and document references.
- [x] Add the initial Context strategy and case catalogs from the Component Lab proposal.

### 2. Core UI

- [x] Build the `/components` entrance workspace with honest status presentation and
      responsive area navigation.
- [x] Build the shared area detail shell and truthful planned-state view.
- [x] Build the Context Management workspace and local selection state.
- [x] Build fixed-envelope, comparison-preview, and execution-unavailable panels.

### 3. Integration and user surface

- [x] Add `appPaths.components` and the two Component Lab route definitions.
- [x] Add the sidebar entry without changing existing item destinations or platform
      route matching.
- [x] Link the Component Lab proposal and any available implementation plan from the
      relevant UI surfaces.
- [x] Add feature-local README notes for ownership, route names, and the no-execution
      boundary.

### 4. Documentation and learning

- [x] Add this plan to the active-plan indexes.
- [x] Update the curated docs navigation only if the plan becomes part of the visible
      Initial development reading path.
- [ ] Record the final UI decisions, unresolved naming questions, and next executable
      slice in the completion record before archiving this plan.

## Test coverage

### Unit or model checks

- [ ] Validate that all eleven area IDs are unique and every required label/status is
      present.
- [ ] Validate that Context strategies and cases have unique IDs and non-empty
      descriptions, controls, and limitation text.
- [ ] Verify the preview model does not expose an execution-ready state or fabricate
      result/metric fields.

### UI checks

- [ ] Verify `/components`, direct `/components/context-management`, and an unknown
      area route render the expected states.
- [ ] Verify strategy/case selection, comparison-slot changes, reset behaviour, and
      disabled execution messaging.
- [ ] Verify keyboard navigation and narrow-screen layout for the catalog and detail
      panels.
- [ ] Verify existing Platform runner, Chat, and Compare navigation still resolves.

### Manual acceptance

- [ ] Open Component Lab from the sidebar and identify all eleven areas without
      confusing it with Platform coverage.
- [ ] Open Context Management, choose a strategy and case, and see the fixed-versus-
      changed explanation update without any network request.
- [ ] Add at least two comparison slots and confirm the UI makes no claim that a run
      or benchmark result exists.
- [ ] Refresh the page and confirm transient selections clear without affecting any
      Platform Lab state.

## Required validation commands

- `pnpm --filter @agent-harness-lab/web run generate:docs`
- `pnpm --filter @agent-harness-lab/web run typecheck`
- `pnpm --filter @agent-harness-lab/web run build`
- `git diff --check`

Run the narrowest relevant UI checks first. If a pre-existing web failure prevents
validation, record the exact failure and keep it separate from Component Lab changes.

## Validation performed to date

- `pnpm --filter @agent-harness-lab/web run typecheck` — the documentation catalog
  generated successfully, then the existing `src/features/platforms/chatState.test.ts`
  failed because the web `tsconfig` does not include Node test types.
- `pnpm exec tsc --noEmit --pretty false --types vite/client,node` — passed for the
  current web source, including the Component Lab files.
- `pnpm exec vite build` — passed; Vite emitted the repository's existing large-chunk
  warning.
- `GET http://localhost:5174/components` from the local Vite server — returned HTTP 200.
- Browser click-through — not run because no browser surface was available in the
  current environment.

## Completion gate

- [ ] The Component Lab is reachable from the main navigation at `/components`.
- [ ] All eleven areas are visible with truthful status and ownership language.
- [ ] Context Management has a usable strategy/case/comparison preview.
- [ ] Execution remains clearly unavailable and no fabricated evidence is shown.
- [ ] Existing Platform routes and implementation plans remain behaviourally unchanged.
- [ ] Documentation, tests, validation results, and known limitations are recorded.

## Commit discipline and handoff

- [ ] Keep catalog/types, UI views, route/navigation integration, and documentation
      changes reviewable as coherent sections.
- [ ] Inspect `git status` and the exact diff before each commit; preserve unrelated
      platform, model, chat, and Anesu work already present in the worktree.
- [ ] The next plan should implement one executable Context strategy behind the future
      component-runner seam, using the fixed experiment envelope defined here.

## Completion record

Fill this section only when the completion gate is satisfied.

### Completed

- `[timestamp]` — `[what was delivered]`

### Commits

- `[commit hash]` — `[focused section]`

### Validation

- `[command or manual check]` — `[passed/failed and concise result]`

### Known limitations

- `[deliberate limitation or follow-up]`
