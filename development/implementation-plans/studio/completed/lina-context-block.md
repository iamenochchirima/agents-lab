# Lina Context block and connected simulation

## Purpose and scope

Extend Lina's design graph and scripted execution from Input and Turn Execution
into the researched Context responsibilities. Expose model-visible context
assembly, budget checks, reduction and preparation failures as inspectable
nodes. Preserve manual and automatic playback and the existing JSON contract
inspector. This is a design simulation, not a real agent context service.

Design evidence: [Context research](../../../../docs/research/lina/context-research.md),
[Hermes/OpenClaw](../../../../docs/research/lina/context-hermes-openclaw.md),
[Pi/Waku](../../../../docs/research/lina/context-pi-waku.md).

## Decisions

- Ten proposed Context nodes with eight on the ordinary path and conditional
  pruning/compaction branches.
- Prepare round requests context when no valid snapshot exists and rechecks
  launch authority when the snapshot returns. No second Input admission.
- A new logical round builds a new context snapshot; a provider retry reuses its
  snapshot without reexecuting tools or resetting counters.
- Selection and reduction preserve canonical source references. Request-local
  fixture summaries do not claim memory writes or durable compaction.
- Failed compaction, protected content that cannot fit, and invalid context
  settle failed and release without a main-model attempt. This initial failure
  policy is explicit; alternative recovery policies remain future experiments.
- Context case and execution case are separate modal settings. Reduction affects
  the first preparation; subsequent rounds use the fits-budget fixture.
- Future children can use the same Context contracts with their own IDs, source
  references and tools. Child execution is outside this change.

## Implementation checklist

### Graph and compatibility

- [x] Add Load context sources, Build instructions, Select conversation history,
  Add task context, Prepare tool context, Check context budget, Prune context,
  Compact history, Validate model context and Publish context snapshot.
- [x] Connect Prepare round to Context and publication back to the launch check.
- [x] Add reduction loops and explicit terminal preparation-failure connections.
- [x] Replace the empty Context region with its real block; retain Memory's number.
- [x] Upgrade saved designs without resetting positions, status, experiments or
  custom components/connections; position new Context nodes without collisions.
- [x] Include Context in block dragging, component navigation and graph inspection.

### Contracts and examples

- [x] Define provisional JSON input/output schemas and examples for all new nodes.
- [x] Distinguish coordinator dependencies from model-visible context.
- [x] Retain agent/turn/round identity, counters, source revisions and original refs.
- [x] Describe instructions, selected message groups, tool schemas/results,
  task evidence, budget estimates, selection manifests and immutable snapshots.
- [x] Represent pruning, summaries, summary failure/cancellation, unavailable
  required sources and invalid/oversized context explicitly.
- [x] Correct continued model-request examples to include assistant calls paired
  with retained tool results.

### Simulation

- [x] Add a Context case setting to the Run modal.
- [x] Traverse Context for new rounds in both automatic and Next playback.
- [x] Reuse snapshot for provider retries and preserve case on Reset.
- [x] Simulate ready, prune, compact, failed compaction, too-large and invalid paths.
- [x] Keep preparation/reduction counts and summary/budget details labeled fixtures.
- [x] Block missing nodes/connections instead of skipping them.

### Validation and documentation

- [x] Focused architecture, contract and simulation tests pass.
- [x] Examples validate with a standard JSON Schema validator.
- [x] TypeScript and production build pass.
- [x] Live browser checks verify all ten inspectors and manual/automatic paths.
- [x] Documentation matches final behavior and verification evidence is recorded.

## Validation evidence

- 163 focused tests pass: 8 architecture upgrade/boundary tests, 19 contract
  tests and 136 simulation tests. The matrix covers all three channels, seven
  execution cases and six Context cases in both playback modes.
- Standard Draft 2020-12 JSON Schema validation passes for 521 input/output
  examples across all 50 maintained nodes and 106 connections.
- TypeScript checks and production build pass. The existing bundle-size advisory
  remains; no dependency was added.
- Live browser checks pass for all ten Context inspectors, nested schemas, six
  manual Context paths, and automatic two-round compaction playback. No browser
  errors observed.
- Live group dragging moves all ten Context nodes together while the other
  forty nodes remain unchanged. Verification uses an isolated browser session;
  it does not save to the user's design database.
- Local documentation links, illustrative JSON and diff formatting were checked.

The integration audit improved examples to preserve tool-feedback and reduced
projections through budget checking, validation and publication. Added ordinary
assistant text and media-reference forms, and an explicit fitting-but-orphaned
tool result that must fail relationship validation. Snapshot readiness remains
separate from model launch permission.

## Limits

Simulation cases and contract examples are synthetic. There is no real retrieval,
provider counting/caching, memory write, model summarizer, child-agent execution,
or benchmark result. Reference contracts are not enforcement at a runtime
boundary, and inspector examples are independent of current playback state.
Advanced context policy configuration and failure recovery are documented
variation points, not operational controls.
