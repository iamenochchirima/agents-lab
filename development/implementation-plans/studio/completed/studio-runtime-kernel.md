# Studio foundation kernel

**Created:** `2026-09-19T00:00:00+02:00`  
**Last updated:** `2026-09-19T23:42:44+02:00`  
**Status:** Completed  
**Completed:** `2026-09-19T23:42:44+02:00`  
**Owner:** Agent Harness Lab maintainers

## Start here

Read these before changing code:

- [`AGENTS.md`](../../../../AGENTS.md)
- [`CONTEXT.md`](../../../../CONTEXT.md)
- [`Studio implementation roadmap`](../README.md)
- [`Keep Studio as a server module`](../../../../docs/adr/0004-keep-studio-as-server-module.md)
- [`Studio backend foundation`](../active/studio-backend.md)
- [`Studio server module`](../../../../server/src/studio/README.md)
- [`Context and memory ecosystem research`](../../../../docs/research/context-engineering-ecosystem-2026.md)

## Purpose

Implement the concrete backend kernel that Studio will use for component
experiments. This is one bounded implementation goal, not the full Studio product.

The kernel must execute one complete, controlled agent turn through explicit slots
for the twelve harness areas. Each slot gets a small baseline adapter so the
runtime is a real composition rather than a Context-only demo. Context Management
is the first slot with meaningful strategy variants. Memory gets a narrow baseline
contract and adapter so its relationship with Context is visible without beginning
the full Memory research program.

Studio remains a module family inside the existing Lab server. It does not replace
the Platform Lab, Anesu, or the existing platform run lifecycle.

## Definition of done

The current Studio Context comparison still works through the existing
`/api/studio/comparisons` API, but each trial executes through a neutral
`HarnessRuntime` with the following path:

```text
input
  -> memory read
  -> context assembly
  -> planning
  -> control loop
  -> model
  -> tool/computer capability
  -> safety gate
  -> output
  -> memory write
  -> canonical events and evidence
```

The completed kernel will provide:

- all twelve component slots with explicit baseline adapters;
- Full History, Sliding Window, and Relevance Ranked Context strategies;
- a fixture Memory adapter with read/write evidence;
- deterministic replay execution;
- one minimal live model-provider adapter behind the model interface;
- canonical turn events and an inspectable trajectory;
- existing idempotency, cancellation, failure injection, and recovery behaviour;
- tests proving the composition and fixed-versus-changed experiment rule.

This plan does not implement advanced strategies for every slot, model routing,
provider fallback, arbitrary plugins, production computer control, or the complete
Memory subsystem. Those belong to later plans listed in the Studio roadmap.

## Scope and ownership

Owned by this plan:

```text
server/src/studio/runtime/**
server/src/studio/domain/**             # only kernel contracts and lifecycle additions
server/src/studio/application/**        # comparison-to-runtime integration
server/src/studio/adapters/**           # baseline slot and model adapters
server/src/studio/strategies/**          # existing Context strategies and contracts
server/tests/studio/**
server/src/studio/README.md
development/implementation-plans/studio/active/studio-runtime-kernel.md
```

The existing Platform Lab control plane, platform modules, Anesu, and the Studio
UI remain outside this change. Existing user changes in those areas must not be
staged or rewritten.

## Kernel architecture

The comparison remains the experiment-level parent. The runtime executes one trial
with one complete harness composition.

```text
StudioComparisonService
  -> builds fixed experiment envelope
  -> selects one registered strategy
  -> calls HarnessRuntime for the trial
  -> publishes comparison and trial evidence
```

The runtime owns ordering, cancellation, limits, component lifecycle, and event
emission. Adapters own their local behaviour. Adapters return observations to the
runtime and do not write arbitrary files or call unrelated global services.

The kernel uses typed slots rather than one generic component interface:

```ts
interface HarnessRuntime {
  execute(input: HarnessTurnInput): Promise<HarnessTurnResult>;
}

interface MemoryStore {
  read(input: MemoryReadInput): Promise<MemoryReadResult>;
  write(input: MemoryWriteInput): Promise<MemoryWriteResult>;
}

interface ContextAssembler {
  assemble(input: ContextAssemblyInput): ContextAssemblyResult;
}

interface ModelAdapter {
  complete(input: ModelInput): Promise<ModelResult>;
}
```

The complete interfaces include ordering, limits, failure behaviour, and evidence
requirements. They are not just TypeScript method lists.

## Component slot matrix

The first adapter is intentionally small. It exists to make the slot executable and
observable, not to represent the final research space.

| Component area | Kernel adapter | What is deliberately deferred |
| --- | --- | --- |
| Input / perception | Canonical task and source normalizer | Multimodal and external payload families |
| Context management | Existing three deterministic strategies through `ContextAssembler` | Summarization, caching, multimodal packing |
| Planning / reasoning | Single-step deterministic planner | Tree search, reflection, replanning |
| Memory | Scoped fixture store with read/write evidence | Semantic retrieval, consolidation policies, durable long-term memory |
| Tool use | Fixture registry, schema validation, sequential dispatcher | External tools, parallel dispatch, provider-specific tool search |
| Computer use | Explicit capability-disabled adapter | Browser or native computer execution |
| Control / orchestration | One bounded sequential turn loop | Graphs, delegation, multi-agent routing |
| Execution environment | Deterministic contained profile | Real filesystem, network, process, and resource profiles |
| Output / actions | Response collector and side-effect classification | Irreversible production actions |
| Safety / guardrails | Trust labels, schema checks, and a fail-closed risk gate | Full adversarial and policy evaluation suite |
| Model interface | Replay adapter plus one minimal live provider adapter | Routing, fallback, batching, provider-specific optimizations |
| Observability | Canonical event writer and metrics collector | Distributed tracing and external telemetry backends |

The disabled Computer Use adapter is honest. It records that the capability is not
available in the deterministic profile; it does not pretend to have performed a
computer action.

## Implementation checklist

### 1. Kernel contracts and lifecycle

- [x] Add `HarnessTurnInput`, `HarnessTurnResult`, component observations, and
      canonical event types under `server/src/studio/runtime/`.
- [x] Define the input passed between slots and the state that may be updated after
      each slot.
- [x] Define legal turn lifecycle states and cancellation behaviour.
- [x] Define the fixed-control fingerprint used to prove that comparison trials
      differ only in the declared Context strategy.
- [x] Document the ownership rule: Context may consume Memory results, but neither
      slot owns the other's persistence or evidence.

### 2. Baseline component adapters

- [x] Add the canonical input normalizer.
- [x] Add the fixture Memory read/write adapter and its evidence shape.
- [x] Adapt the existing Context strategies to the `ContextAssembler` slot.
- [x] Add the deterministic single-step planner.
- [x] Add the fixture tool registry and sequential dispatcher.
- [x] Add the explicit Computer Use unavailable adapter.
- [x] Add the bounded control-loop adapter.
- [x] Add the deterministic execution-environment profile.
- [x] Add the output collector and side-effect classification.
- [x] Add the fail-closed safety gate.
- [x] Keep the existing replay model as the deterministic `ModelAdapter`.
- [x] Add the canonical observability adapter used by every slot.

### 3. Runtime integration

- [x] Implement `HarnessRuntime` as the only coordinator of one trial turn.
- [x] Refactor `StudioComparisonService` so it prepares the comparison and delegates
      trial execution to `HarnessRuntime`.
- [x] Preserve the current `/api/studio/comparisons` request and response contract.
- [x] Preserve sequential trial execution and the existing comparison lifecycle.
- [x] Emit canonical events for input normalization, memory read, context assembly,
      planning, model request/response, tool dispatch, safety decision, output, memory
      write, turn completion, and trial completion.
- [x] Ensure an unsupported slot or disabled capability is recorded, not skipped
      silently.

### 4. Model interface

- [x] Move the replay model behind the typed `ModelAdapter` contract.
- [x] Remove expected-answer grading logic from the model adapter.
- [x] Keep grading in a separate fixture grader or comparison result step.
- [x] Add one minimal live provider adapter using the server's existing provider
      configuration conventions.
- [x] Record provider name, model ID, request identity when available, usage, latency,
      and unavailable values as `null`.
- [x] Bound live-provider attempts to one request, timeout, response size, and request
      size. Provider cost remains `null` when the response does not report it.
- [x] Keep live-provider execution opt-in. Replay remains the default deterministic
      profile for tests.

### 5. Evidence, failure, and recovery

- [x] Preserve the current Studio evidence root and safe projections.
- [x] Add the canonical turn events to `events.jsonl` without breaking existing event
      readers.
- [x] Record each adapter's version and effective configuration in trial evidence.
- [x] Test failure before the first slot, between slots, during model execution, and
      during evidence publication.
- [x] Test cancellation before and during a turn.
- [x] Keep incomplete work as failed or `recovery_required`; never fabricate a missing
      adapter result.
- [x] Keep idempotency and duplicate-event protection intact.

### 6. Documentation and cleanup

- [x] Update `server/src/studio/README.md` with the kernel flow and adapter matrix.
- [x] Document replay versus live-provider limitations.
- [x] Document the fixed-versus-changed rule for Context comparisons.
- [x] Add a short note explaining that Memory is only a baseline adapter in this plan.
- [x] Record validation results and known limitations here before completion.

## Tests

### Contract and unit tests

- [x] Validate a complete harness composition with all twelve slots present.
- [x] Reject a composition with a missing required slot and verify the effective
      slot evidence is unique.
- [x] Validate turn lifecycle transitions and cancellation.
- [x] Verify each baseline adapter returns a bounded, typed result.
- [x] Verify the unavailable Computer Use adapter never reports a successful action.
- [x] Verify Context evidence and Memory evidence remain separate.
- [x] Verify the replay model does not grade the task.
- [x] Verify fixed-control fingerprints remain equal across Context variants.

### Integration tests

- [x] Run the current two-strategy Context comparison through `HarnessRuntime`.
- [x] Verify the complete canonical event sequence for one trial.
- [x] Verify all twelve slots appear in the effective trial composition.
- [x] Verify existing HTTP responses and evidence paths remain compatible.
- [x] Verify deterministic replay produces the same normalized result for the same
      scenario, strategy, and seed.
- [x] Verify live-provider configuration is opt-in and rejects missing limits or
      credentials before dispatch.
- [x] Verify failure injection, cancellation, idempotency, and recovery behaviour.
- [x] Verify existing Platform Lab endpoints remain unchanged.

### Required validation commands

```bash
pnpm --dir server run typecheck
pnpm --dir server run build
pnpm --dir server run test -- --test-name-pattern Studio
pnpm --dir apps/web run typecheck
git diff --check
```

## Completion gate

This plan is complete when:

- one Studio Context comparison executes through `HarnessRuntime`;
- all twelve component slots have explicit baseline adapters;
- the current Context strategies remain executable;
- the replay model and one opt-in live provider satisfy the model interface;
- canonical turn events and evidence are inspectable;
- failure, cancellation, idempotency, and recovery tests pass;
- the current Studio API and Platform Lab behaviour remain compatible;
- the documentation describes the implemented kernel without claiming advanced
  component strategies.

## Next plan after completion

The next active plan should implement Memory properly as its own research slice:

1. working, episodic, semantic, and procedural memory scopes;
2. retrieval, writing, update, deduplication, and consolidation policies;
3. session restart and persistence experiments;
4. Context-versus-Memory controls and evidence;
5. scenarios that test updates, conflicts, forgetting, and retrieval misses.

The broader Studio roadmap remains in the Studio plan index. It is not part of this
kernel's completion gate.

## Completion record

**Commits:** `e96272e`

### Validation

- `pnpm run typecheck` from `server/` — passed.
- `pnpm run build` from `server/` — passed.
- `node --test dist/tests/studio/*.test.js` from `server/` — passed, 26 tests.
- `pnpm run test` from `server/` — passed, 278 tests, 2 skipped.
- `git diff --check` — passed for the Studio implementation and documentation files.

### Known limitations

- The live OpenRouter adapter is opt-in through `createStudioModule` dependency
  injection. The catalog remains deterministic replay until a separate environment
  selection contract is implemented.
- Memory is a scoped fixture adapter. Persistent semantic retrieval and consolidation
  remain the next Studio plan.
- Computer Use is explicitly unavailable in the deterministic kernel profile.
