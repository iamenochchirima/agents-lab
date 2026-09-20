# Studio Context research runtime

**Created:** `2026-09-20T00:00:00+02:00`  
**Last updated:** `2026-09-20T15:57:53+02:00`
**Status:** Active — follows multi-turn Memory and measurement  
**Owner:** Agent Harness Lab maintainers

## Secondary implementation note

The next safe Context block can begin with a test-only boundary fixture before new
production strategies are added. It should combine instructions, old and recent
transcript messages, a grouped tool call/result, a retrieved Memory message with
provenance, and a deliberately tight budget. The current strategies should be tested
for deterministic ordering, tie-breaking, provenance preservation, and explicit
unknown/over-budget states. Group-aware sliding-window behaviour, summaries, source
class allocation, and provider-overflow recovery remain production work; the current
runtime must not silently claim those capabilities.

## Current implementation checkpoint

The first boundary-fixture block is now implemented in
`server/tests/studio/context-strategy.test.ts`. It exercises the existing
`full-history`, `sliding-window`, and `relevance-ranked` strategies against one
fixed fixture containing an instruction, transcript turns, a grouped tool call and
result, and retrieved Memory carrying untrusted provenance metadata. The tests verify
stable source order, deterministic relevance ties, metadata and group visibility,
exact budget pressure, and explicit unknown-token behaviour.

This block intentionally adds no new production strategy. The current strategies
remain message-based and do not yet guarantee atomic tool-group retention or a
source-class budget allocation; those are the next production slices.

## Start here

Read these before implementation:

- [`AGENTS.md`](../../../../AGENTS.md)
- [`CONTEXT.md`](../../../../CONTEXT.md)
- [`Studio implementation roadmap`](../README.md)
- [`Current Memory runtime plan`](studio-memory-runtime.md)
- [`Multi-turn Memory and measurement plan`](../completed/studio-memory-multiturn-measurement.md)
- [`Studio server module`](../../../../server/src/studio/README.md)
- [`Context and memory ecosystem research`](../../../../docs/research/context-engineering-ecosystem-2026.md)
- [`Shared context semantics`](../../../../server/src/capabilities/context/README.md)

## Dependency and purpose

This plan follows the multi-turn Memory and measurement slice. It treats Memory as a
fixed, inspectable input and varies only Context Management. The purpose is to make
the main Context engineering trade-offs executable under controlled conditions:
retention, ranking, compaction, summarization, budgeting, and pressure recovery.

This is not a claim that one Context strategy is universally best. Every result must
show what entered the model window, what was omitted or summarized, which budget
decision was made, and which controls were held constant.

## Definition of done

A caller can submit a Context comparison using the same fixed multi-turn scenario,
Memory policy, model adapter, tool fixture, token window, seed, and environment across
strategy slots. The only changed variable is the selected Context strategy and its
declared parameters.

The first research slice supports these executable strategy families:

1. full history baseline;
2. sliding-window retention;
3. relevance-ranked retention;
4. deterministic hierarchical or rolling summary compaction; and
5. explicit token-budget allocation across system, transcript, Memory, and tool
   sources.

Each trial produces:

- retained, omitted, grouped, and summarized source IDs;
- model-bound message order and provenance;
- token budget and pressure state before and after compaction;
- summary inputs and deterministic summary identity;
- Memory records considered and which Context chose to include;
- answer/source grades and fixture-derived retention metrics; and
- comparable per-strategy metrics and evidence.

## Research question

> Under the same Memory state, task sequence, model, tool outputs, and token window,
> how do different Context retention, compaction, and budget policies change source
> preservation, model-visible evidence, token use, and answer quality?

Context metrics are scenario-bound observations. A source-retention score is not a
general quality metric unless the scenario explicitly defines the relevant source set.

## Scope

- [ ] Preserve the current Context strategy contract and one-turn API behaviour.
- [ ] Add a versioned Context experiment contract for source groups, priority,
      summary eligibility, token contribution, and pressure triggers.
- [ ] Hold Memory fixed and make the Memory-to-Context boundary inspectable.
- [ ] Add deterministic compaction and hierarchical-summary baselines without
      claiming model-generated summary quality.
- [ ] Add explicit token-budget allocation across source classes.
- [ ] Add pressure scenarios for fitting, near-limit, over-limit, and provider-
      overflow recovery conditions.
- [ ] Add Context evidence and metrics for retained, omitted, summarized, and
      model-bound sources.
- [ ] Add deterministic grading and source-retention measurements with clear limits.
- [ ] Keep tool results, Memory records, transcript messages, and instructions
      distinguishable throughout packing and compaction.
- [ ] Document the strategy controls, fixture limitations, and inspection procedure.

## Explicitly out of scope

- Learned or model-generated summaries as a quality claim.
- A hosted vector retriever, embedding ranking, or provider-native context cache.
- Multimodal binary processing beyond bounded source metadata and fixture references.
- Changing Memory retrieval, write, consolidation, or retention policies.
- Tool selection, control-loop graphs, planning, safety, or model routing strategies.
- Parallel trials, leaderboard ranking, or automatic strategy selection in production.
- UI redesign. The API and evidence must be ready for a later frontend view.

## Experimental controls

Every slot in one Context comparison fixes:

- scenario ID, version, turn sequence, source fixtures, and grading question;
- Memory policy, namespace, seed, and resulting state;
- model provider, model, parameters, and deterministic seed;
- system/developer instructions and tool-result fixtures;
- context window, reserved output, safety margin, and token estimator;
- execution environment, failure injections, and side-effect policy; and
- strategy order and comparison lifecycle.

The fixed-control fingerprint must include source groups, Memory state identity, token
limits, and summary fixtures. It must exclude only the selected Context strategy and
its declared parameters.

## Context source model

Represent model candidates as typed source groups rather than an undifferentiated list:

| Source group | Examples | Default concerns |
| --- | --- | --- |
| instruction | system and developer messages | must not be silently discarded |
| active turn | current user request and immediate tool continuation | must remain coherent |
| transcript | earlier user/assistant turns | recency and relevance trade-off |
| Memory | semantic, episodic, procedural records | retrieved content remains untrusted |
| tool result | structured or verbose tool output | preserve useful fields and provenance |
| summary | deterministic compaction output | must expose source IDs and coverage |

Each source group must retain source IDs, trust classification, provenance, sequence,
and an estimated token contribution. Context may choose how to pack a source, but it
must not erase the distinction between source groups.

## Strategy baselines

### Full history

Keep all fitting sources in stable source order. When the case does not fit, return an
explicit over-budget decision rather than silently changing the strategy.

### Sliding window

Keep mandatory instructions and active-turn sources, then retain the newest complete
transcript/tool groups within the configured budget. Group boundaries must not split a
tool call and its result.

### Relevance ranked

Rank eligible source groups against the current task using a deterministic baseline,
then restore source order for model input. The evidence must show the score and tie
breaker. This remains a lexical fixture, not semantic retrieval.

### Deterministic compaction

When pressure crosses the configured threshold, replace eligible older groups with a
deterministic summary fixture identified by its source IDs, policy version, and hash.
The summary must preserve instruction and active-turn constraints and expose what it
does not cover.

### Token-budget allocation

Split the available input budget across source groups before selection. Record the
allocation, unused reserve, overflow decision, and whether one class consumed another
class's reserve. Allocation is an explicit policy decision, not an incidental sort.

## Scenario matrix

| Case | Fixed sources | Main observation |
| --- | --- | --- |
| Old important fact | long transcript plus fixed Memory preference | retention of an early relevant source |
| Conflicting instructions | system, user, and tool-result conflicts | instruction priority and trust preservation |
| Large tool output | verbose structured result with small relevant fields | grouping and field-preserving compaction |
| Strict budget | small window and output reserve | explicit pressure and omission decisions |
| Hierarchical history | several conversation phases | summary coverage at multiple levels |
| Memory plus transcript | retrieved Memory alongside recent messages | Context chooses model-visible representation |
| Provider overflow | first dispatch exceeds provider limit | one bounded changed-input recovery attempt |

## Evidence and metrics

Context evidence must include:

- strategy ID, version, parameters, and effective budget policy;
- source groups and their token estimates;
- retained, omitted, summarized, and model-bound IDs;
- ordering and grouping decisions;
- compaction trigger, summary identity, source coverage, and limitations;
- input token count, remaining budget, pressure, and count quality; and
- Memory IDs considered versus Memory IDs actually serialized as Context messages.

Metrics should include per-turn and aggregate values for source retention, required
source presence, omission by source class, summary count, input tokens, pressure
events, compaction attempts, overflow recovery, latency, model calls, and unavailable
values. Metrics must be derived from evidence and must not influence strategy output.

## Implementation checklist

### 1. Contracts and fixed controls

- [ ] Add versioned source-group and Context decision contracts.
- [ ] Add priority, grouping, summary eligibility, and token-contribution metadata.
- [ ] Extend fixed-control fingerprints with source and Memory fixtures.
- [ ] Preserve existing Context strategy IDs, parameters, and response projections.

### 2. Strategy implementations

- [ ] Harden full-history and sliding-window group boundaries.
- [ ] Harden relevance-ranked scores, ties, and deterministic source order.
- [ ] Implement the deterministic compaction baseline.
- [ ] Implement hierarchical/rolling summary fixtures with coverage metadata.
- [ ] Implement explicit token-budget allocation and reserve behaviour.
- [ ] Make over-budget and unknown-token outcomes explicit and inspectable.

### 3. Runtime and Memory boundary

- [ ] Run Context comparisons against a fixed Memory policy and namespace.
- [ ] Preserve Memory provenance, scope, revision, and untrusted classification.
- [ ] Ensure Context evidence records what it received and what it emitted to the
      model boundary.
- [ ] Add bounded provider-overflow recovery with one changed Context input.
- [ ] Keep Context failure from fabricating Memory or model evidence.

### 4. Evidence, metrics, and HTTP

- [ ] Add source-group, compaction, allocation, and pressure evidence.
- [ ] Add deterministic Context metrics and comparison summaries.
- [ ] Keep raw content bounded and use the existing evidence allowlist.
- [ ] Add catalog descriptors and request examples for each executable strategy.
- [ ] Preserve existing Context and Memory API compatibility.

### 5. Tests and documentation

- [ ] Add unit tests for grouping, ordering, ranking, allocation, compaction, and
      summary coverage.
- [ ] Add integration tests for every scenario in the matrix.
- [ ] Add tests proving Memory remains fixed while Context changes.
- [ ] Add over-budget, unknown-token, provider-overflow, cancellation, and restart
      tests.
- [ ] Add deterministic replay and evidence idempotency tests.
- [ ] Run the existing Context, Memory, and Platform Lab regression suites.
- [ ] Update `server/src/studio/README.md` and the contributor inspection procedure.
- [ ] Record observed results, interpretations, and limitations before archiving.

## Completion gate

Do not archive this plan until:

- [ ] At least three Context strategies run against the same fixed Memory state.
- [ ] Compaction and budget allocation produce inspectable, deterministic decisions.
- [ ] Source groups, trust, provenance, and tool-result boundaries survive packing.
- [ ] Context and Memory evidence remain separate.
- [ ] Pressure and overflow recovery are tested without fabricated success.
- [ ] Metrics identify their basis and do not make unsupported quality claims.
- [ ] Existing one-turn and multi-turn Memory comparisons remain compatible.
- [ ] Documentation, request examples, and known limitations match the implementation.

## Next plan

After this slice, Studio can move to Tool Use and Control/Orchestration comparisons:
selection, argument construction, retries, parallel dispatch, loops, graphs,
replanning, delegation, and termination under the same fixed Context and Memory
envelope.
