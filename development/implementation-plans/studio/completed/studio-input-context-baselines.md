# Studio Input and Context baselines

**Created:** `2026-09-25T11:29:36+02:00`

**Last updated:** `2026-09-25T12:08:28+02:00`

**Status:** Complete

## Purpose

Build one small implementation of Input and one of Context. A text request and
ranked candidates from the existing in-memory Memory implementation should lead
to ordered model messages, with a record of which sources Context included or
omitted. Each implementation must run its checks without Studio's API, browser,
kernel, or the other module packages.

This is the first focused slice of [Stage 2](../modular-agent-studio.md). The
[foundation plan](studio-module-foundation.md) established the package
interfaces; this plan puts behavior behind two of them. The full agent cycle comes
after the remaining baseline modules have implementations.

## Read before implementation

- [Repository rules](../../../../AGENTS.md) and
  [documentation guide](../../../../docs/contributing/documentation.md)
- [Input contract](../../../../studio/modules/input/src/contract.ts) and
  [Input package guide](../../../../studio/modules/input/README.md)
- [Context contract](../../../../studio/modules/context/src/contract.ts) and
  [Context package guide](../../../../studio/modules/context/README.md)
- [Memory contract](../../../../studio/modules/memory/src/contract.ts) and
  [Studio ownership and proposed flow](../../../../studio/README.md)

## What to build

### Input

Add one deterministic `InputNormalizer` implementation inside
`studio/modules/input/`. It validates the raw text, host-supplied source ID,
kind, trust, RFC 3339 receipt time, UTF-8 size, attachment count, and attachment
reference fields. It returns the text unchanged as the task and a text part, with
stable part IDs and the original source and trust label. Attachment references may
pass through as metadata; the module must not open or fetch them. Empty or
malformed input and limit violations return the documented typed error. The
implementation owns no state or external effects.

### Context

Add one deterministic `ContextAssembler` implementation inside
`studio/modules/context/`. Its first supported inputs are a current text task,
trusted instructions, and Memory candidates mapped into `ContextMaterial`. It
returns the exact ordered `ModelMessage` list and a source ledger. This
implementation does not summarize text or persist a session summary.

The current `ContextAssemblyInput.task` is a string. Revise it to a Context-owned,
provenance-bearing task shape so Input's source ID and trust can reach the model
message and evidence. The expected shape is a `ContextMaterial` with `kind: "task"`
and `role: "user"`. Keep the conversion from `NormalizedInput` outside both
packages. Document the public contract change and version it under the package's
pre-1.0 rule.

Use these initial selection rules:

- Any supplied trusted instructions and the current task are mandatory. If they
  cannot fit the configured message or input-token budget, return
  `BUDGET_EXHAUSTED`.
- Select optional Memory candidates in retrieval-rank order. Use stable source
  IDs to break ties. Emit selected Memory messages before the current task.
- Treat Memory as source-labeled data in user-role messages. Never convert an
  untrusted record into a system or developer instruction. Reject invalid
  role/trust combinations and duplicate source IDs.
- Count the complete message list with the injected `ContextTokenCounter`. The
  available input budget is the context window minus reserved output and safety
  margin. Require a finite numeric count with `exact` or `estimated` quality and
  retain its basis in the result. If the counter cannot provide that, return a
  typed `TOKEN_COUNT_UNAVAILABLE` error after adding it to the Context contract.
- Apply `maxSourceBytes` to each material and `maxMessages` to the result. Account
  for every supplied source in `includedSourceIds` or `omissions`, with a reason.
  An oversized Memory source is `invalid-source`; a valid source that does not
  fit is `budget`. Invalid required material fails the assembly.
- Nonempty `turns` or `toolResults` inputs are unsupported in this first slice and
  must fail explicitly. Later baseline and assembly plans must settle conversation
  and structured tool-result exchanges before using them in a run.

Both modules must give the same result for the same inputs and injected counter.
Context checks cancellation before work and before returning; it must not return a
partial message list. Neither module calls a model or stores durable state.

## Show the module exchange

Add a small development-only workspace package at
`development/playground/studio-input-context/`. It should use only public package
exports to normalize one text request, recall two records from the existing Memory
implementation, map their record IDs, provenance, trust, and rank to Context-owned
material, and assemble messages with a named deterministic token counter. Keep the
mapping local to the walkthrough. The later kernel plan will own the production
mapping. Show both an included Memory record and a record omitted by the budget,
then print the messages and source ledger. Document the exact command and expected
output. The walkthrough is for inspection; it is not a scenario, experiment, run
record, or complete agent assembly. Add only this package to the pnpm workspace;
its module dependencies are workspace packages, and it adds no runtime dependency.

Input and Context package tests must remain independent. Their tests use fixtures
at their own public interfaces and do not import another module's private files.

## Acceptance

- [x] Input checks valid text, empty/malformed input, UTF-8 byte limits, source
      metadata, attachment references, and deterministic output through its public
      export.
- [x] Context checks message order, task provenance, trusted instruction handling,
      untrusted Memory treatment, source accounting, budget pressure, size limits,
      unknown token counts, invalid input, and cancellation through its public
      export.
- [x] Both implementations have explicit IDs and versions, documented config,
      state lifetime, errors, and retry behavior in their package READMEs.
- [x] The walkthrough runs with the existing Memory implementation and displays
      exact messages plus inclusion and omission evidence.
- [x] Input and Context build and pass their checks independently. Neither imports
      another role package, Studio's API, or the old server implementation.
- [x] The changed Context contract and unresolved conversation, tool-result, or
      tokenizer assumptions are recorded for later baseline and assembly plans.

## Validation and handoff

Verified from the repository root:

```sh
pnpm install --offline --frozen-lockfile
pnpm --filter @agent-harness-lab/module-input typecheck
pnpm --filter @agent-harness-lab/module-input test
pnpm --filter @agent-harness-lab/module-context typecheck
pnpm --filter @agent-harness-lab/module-context test
pnpm --filter @agent-harness-lab/studio-input-context-playground start
pnpm --filter @agent-harness-lab/web generate:docs
git diff --check
```

All commands passed. Input's seven behavior/configuration tests passed. Context's
configuration and deterministic assembler test files passed. The playground
printed three ordered messages (instruction, included Memory fact, current task),
included-source IDs, one budget omission for the longer Memory episode, and a
source ledger retaining provenance and trust. Its stable example estimate was 163
using `utf8-bytes-divided-by-four-v1`. The documentation generator reported 76
documents. A local link audit of the seven changed Markdown files passed.

## Handoff and limits

- This slice is not a complete agent run: it calls no model and executes no tools.
- The playground owns the temporary Input/Memory-to-Context mapping. A later
  kernel plan must define and validate the production adapter.
- Context currently rejects nonempty conversation turns and structured tool
  results. Later module and assembly plans must settle their ordering and message
  representation before using them in a run.
- Token counting is injected. The playground's named byte-based estimate is not a
  provider tokenizer; a model integration must supply a tokenizer appropriate to
  the selected model and retain its basis.
- The existing Memory implementation is process-local and is used here only to
  demonstrate retrieval and provenance exchange.

The first Stage 2 baseline slice is complete. Focused plans for the remaining
module roles should provide one small implementation each before a later plan
assembles them through the kernel. Kernel wiring, a live model, browser run
controls, experiments, and alternative strategies remain out of scope here.
