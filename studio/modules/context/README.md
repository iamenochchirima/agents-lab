# Context module

Context selects model-visible material for one request. It owns the neutral
`ContextMaterial` shape so the kernel can adapt Input and Memory results without
making this package depend on either module. This package does not call a model,
write Memory, summarize conversation history, or persist state.

## Implementations

`createContextAssembler(config, dependencies)` and
`createFixedRecentMessageWindowAssembler(config, dependencies)` return a
`ContextAssembler` with `assemble(input, signal)`. Both are stateless: each call
creates a fresh ordered message list and source ledger. Retrying with the same
input, configuration, and token counter yields the same result. Cancellation
before or during assembly throws `AbortError`; callers never receive a partial
result.

The deterministic baseline has identity
`deterministic-context-assembler@0.4.0`. It first retains the most recent
contiguous suffix of prior turns that fits the token budget and `maxMessages`; an
older turn is omitted after the first turn that cannot fit.

The fixed-window implementation has identity
`fixed-recent-message-window@0.1.0`. It first selects the newest configured number
of prior Context messages, then keeps that selection in chronological model order
and applies the same token budget and Memory rules as the baseline. A source outside
the selected window is recorded in both `omissions` and `sourceLedger` with reason
`window`. Sources inside the window can still be omitted for `budget` or
`invalid-source`. The window counts individual prior messages, not user/assistant
conversation turns.

The supported inputs are:

- Trusted `instruction` material with a `system` or `developer` role.
- One provenance-bearing `task` material with a `user` role.
- Earlier `turn` materials with a `user` or `assistant` role. Their `sequence`
  orders them chronologically and source ID breaks ties.
- `memory` candidates with a `user` role. `sequence` is their retrieval rank;
  lower ranks are considered first, and source ID breaks rank ties.
- An optional `planningProposal` with a `user` role and `untrusted` trust label.
  If supplied, it is required model-visible advisory data, placed after the
  current task and before tool exchanges. It is never promoted to an instruction.
- `toolExchanges` pair one structured assistant call message with exactly one
  tool result for each call ID. Calls retain their normalized arguments; results
  retain the matching `toolCallId` and tool name.

Instructions and turns are ordered by sequence then source ID. Instructions, the
current task, any supplied Planning proposal, and tool exchanges are mandatory.
The deterministic baseline retains the most recent contiguous suffix of prior turns
that fits both the token budget and `maxMessages`. The fixed-window strategy first
limits the eligible turn list by `maxRecentMessages`, then uses that same fitting
and ordering logic within the selected range. Required tool exchanges are
never budget-omitted because dropping either side would break call/result
association; if the required exchange does not fit, Context fails the assembly.
Memory candidates are then selected greedily in retrieval-rank order without
evicting retained turns, Planning, or tool exchanges. Model order is instructions,
selected Memory, retained turns, the current task, Planning if supplied, then
complete tool exchanges ordered by the assistant call's sequence. This keeps the
task and advisory proposal before tool calls and their correlated results on a
continuation request.
Every supplied source appears in `sourceLedger`, with its trust and provenance
plus an included or omitted disposition. `includedSourceIds` follows model message
order; `omissions` gives each omitted source and its reason.

Task, Memory, and Planning content is kept in a JSON user-message envelope
containing the source ID, trust, provenance, kind, and content. This keeps source
and trust visible in the message and evidence while keeping those values in the
user role. Memory and Planning are never promoted to a system or developer
instruction. Trusted instructions are passed through as their own system or
developer messages.
Context trusts the caller's trust classification; the kernel must source it from
the relevant Input or Memory provenance and enforce its own access policy.

The injected `ContextTokenCounter` counts each complete proposed message list.
Its count must be finite and non-negative, with a non-empty basis and `exact` or
`estimated` quality. The caller configures that counter for the tokenizer named
in the budget. Available input tokens equal context window minus reserved output
tokens and the safety margin. If required material does not fit, assembly fails
with `BUDGET_EXHAUSTED`. A valid Memory candidate that does not fit, or exceeds
`maxMessages`, is recorded as a `budget` omission. Oversized Memory content is
recorded as `invalid-source`; oversized required material fails the assembly.
Missing, unknown, invalid, or throwing token counts fail with
`TOKEN_COUNT_UNAVAILABLE`.

Each tool result must match exactly one assistant call by call ID and tool name.
Unmatched, duplicate, or malformed call/result pairs fail with
`INVALID_CONTEXT_INPUT`. Invalid source IDs, duplicate source IDs, malformed
provenance, mismatched trust labels, and invalid role/trust combinations also
fail with `INVALID_CONTEXT_INPUT`.

## Configuration

Use `parseContextConfig` before construction. Unknown settings, non-integers, and
values outside these bounds are rejected.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxMessages` | 200 | 1–100,000 |
| `maxSourceBytes` | 2,000,000 | 1–100,000,000 |
| `minAvailableInputTokens` | 1 | 0–1,000,000 |

`parseFixedRecentMessageWindowConfig` accepts the same three settings plus
`maxRecentMessages`, which defaults to four and must be an integer from 1 through
12. The number applies to prior Context messages individually. Both parsers reject
unknown settings.

```ts
import {
  createFixedRecentMessageWindowAssembler,
  parseFixedRecentMessageWindowConfig,
} from "@agent-harness-lab/module-context";

const fixedWindow = createFixedRecentMessageWindowAssembler(
  parseFixedRecentMessageWindowConfig({ maxRecentMessages: 4 }),
  { tokenCounter },
);
```

The `ContextAssemblyInput.task` contract changed from plain text to a
`ContextMaterial` (`kind: "task"`, `role: "user"`) in package version `0.2.0`.
Bounded turn support was added in package version `0.3.0`; package version `0.4.0`
added structured `toolExchanges`; package version `0.5.0` added the optional,
required-if-present `planningProposal`. Package version `0.6.0` adds the `window`
omission reason and fixed-window implementation. The baseline implementation remains
`deterministic-context-assembler@0.4.0`; the alternative is
`fixed-recent-message-window@0.1.0`. Under the Studio pre-1.0 rule, breaking public
contract changes increment the minor version.

## Example

```ts
import { createRunId } from "@agent-harness-lab/agent-protocol";
import {
  createContextAssembler,
  parseContextConfig,
  type ContextTokenCounter,
} from "@agent-harness-lab/module-context";

const tokenCounter: ContextTokenCounter = {
  count(messages) {
    const bytes = messages.reduce((sum, message) => sum + new TextEncoder().encode(JSON.stringify(message)).length, 0);
    return {
      value: bytes,
      basis: "utf8-bytes-v1 (demonstration estimate)",
      quality: "estimated",
    };
  },
};
const context = createContextAssembler(parseContextConfig(), { tokenCounter });
const result = await context.assemble({
  scope: { runId: createRunId("run-1") },
  instructions: [{
    sourceId: "policy-1", kind: "instruction", role: "system", content: "Follow the task.",
    sequence: 0, trust: "trusted", provenance: { sourceKind: "studio-policy" },
  }],
  task: {
    sourceId: "input-1", kind: "task", role: "user", content: "Summarize the report.",
    sequence: 0, trust: "untrusted", provenance: { sourceKind: "user-request" },
  },
  planningProposal: {
    sourceId: "planning-1", kind: "planning", role: "user",
    content: "Advisory proposal: summarize the report.", sequence: 0,
    trust: "untrusted", provenance: { sourceKind: "planning-module" },
  },
  turns: [],
  memoryCandidates: [],
  toolExchanges: [],
  budget: { contextWindowTokens: 10_000, reservedOutputTokens: 1_000, safetyMarginTokens: 100, tokenizer: "utf8-bytes-v1" },
}, new AbortController().signal);
```

The byte-based example counter is only a deterministic stand-in, not a token
tokenizer. Real assemblies must use a counter appropriate to the selected model
and record its basis with the result.

## Checks

```sh
pnpm --filter @agent-harness-lab/module-context typecheck
pnpm --filter @agent-harness-lab/module-context test
```
