# Context retention experiment

## Hypothesis

When all six prior messages in `old-important-fact-v1` fit the pinned Context
budget, `deterministic-context-assembler@0.4.0` retains all six. The default
four-message setting of `fixed-recent-message-window@0.1.0` retains sequences 2–5
and records sequences 0–1 as omitted for `window`. This demonstrates the policies'
selection boundary; it does not show that Replay can retrieve the earlier
preference or answer the task correctly.

## Scenario and case

The versioned `context-stress` scenario owns a neutral fixed task and six ordered
synthetic messages. Sequence 0 states a preference for Mediterranean food in future
meal suggestions. Sequence 1 acknowledges it. Sequences 2–5 contain unrelated
gardening and desk-light details with brief acknowledgements. The task asks which
preference was stated for future meal suggestions. The API adapts the data into
Context materials and adds scenario provenance; neither the Context module nor the
HTTP contract owns the task wording.

## Variables and controls

The changed variable is the selected Context implementation:

1. `deterministic-context-assembler@0.4.0` applies the existing budget-fitted
   recent-history policy.
2. `fixed-recent-message-window@0.1.0` first selects the newest configured number
   of prior Context messages, then applies the same complete-message token budget
   and Memory rules.

The fixed window defaults to four prior messages and accepts values from 1 through
12. Both runs use the same task, source IDs, empty initial Memory state, Planning
behavior, deterministic Replay model and parameters, and non-Context reference
assembly choices. The pinned budget is 8,192 context-window tokens, 512 reserved
output tokens, 256 safety-margin tokens, and
`utf8-bytes-div4-estimate-v1`. Variants run serially with fresh Memory sessions and
`remember: false`.

## Procedure

The browser creates a UUID comparison ID and POSTs:

```json
{
  "apiVersion": "1",
  "comparisonId": "<UUID>",
  "caseId": "old-important-fact-v1",
  "maxRecentMessages": 4
}
```

The server resolves both Context choices from its static reference assembly
registry. It commits each run ID in the comparison manifest before creating that
run's standard artifacts. `GET /context-experiments/:comparisonId` reopens the
saved projection; the browser keeps the comparison ID in the URL so refresh and
direct navigation inspect evidence without starting another run.

## Recorded evidence

Each ordinary Studio run directory contains `config.json`, ordered
`events.jsonl`, and terminal `result.json`. The config records the run, comparison,
session, and turn IDs; its start timestamp; scenario and fixture versions;
experiment identity; full reference assembly; selected Context and Memory
configurations; empty Memory state; shared task and budget; deterministic Replay
identity and parameters; effective tool definitions and capabilities; local
deterministic environment; and explicit null seed and failure-injection fields.
Because the config is written before execution, its `finishedAt` is null. Each
terminal result records the actual completion timestamp. Turn evidence includes
exact Model Interface messages, included and omitted source IDs and reasons, token
count and estimate basis, model request and response, module evidence, and
Observability receipts.

The comparison manifest stores the request fingerprint, owning API instance ID,
fixed controls, strategy identities, run IDs, statuses, and timestamps. It contains
no arbitrary paths or credentials. The experiment writes no `metrics.json` and
produces no quality score.

## Retry, cancellation, and restart

The comparison UUID is a durable idempotency key. Identical concurrent POSTs join
one in-process operation; an identical POST after a terminal state returns the
saved projection. Reusing an ID with a different request returns a conflict. A
failed or interrupted attempt is not rerun under the same ID; start a new attempt
with a fresh UUID.

The API aborts the active variant after every attached POST caller disconnects.
Cancellation cannot undo run artifacts already written. A failed variant is
preserved and the other is attempted unless cancellation or unsafe persistence
prevents it. A missing or unreadable terminal result after an uncertain write is
`unknown` unless a valid `result.json` establishes the outcome.

If the API stops while the manifest is `running`, a later API instance inspects
only the known run result files. Two successful terminal results recover as
`completed`; one successful result and one missing terminal result recover as
`interrupted`; ambiguous or unreadable evidence remains `unknown`. Runs are never
resumed automatically. Only one API process may write a runs root at a time;
cross-process locking is outside this experiment.

## Interpretation limits

The observation is which supplied sources reached each model request under the
recorded implementation and controls. Replay emits deterministic request
diagnostics; it is not a live model, answer grader, or quality measure. The result
does not establish universal superiority of either Context policy. This procedure
uses no random sampling and injects no deliberate failures. Operational failures
and recovered states remain visible when they occur.
