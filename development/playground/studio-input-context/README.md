# Studio Input and Context playground

## Question

How does a text request and retrieved Memory candidates become model messages,
and which sources does Context leave out when the token budget is small?

## What this runs

The walkthrough uses the public Input normalizer, the existing in-memory Memory
implementation, and the public Context assembler. A small local adapter maps
Input and Memory results into Context-owned materials. The token counter is a
deterministic local estimate. No model, API host, browser, database, or kernel is
started.

## Run it

From the repository root:

```sh
pnpm --filter @agent-harness-lab/studio-input-context-playground start
```

The command builds the four workspace dependencies before running the script.

## Observe

The output prints the normalized task, the ordered model messages, the token
count and basis, the source IDs that Context included or omitted, and a ledger
with provenance and trust for every source. With the checked-in fixtures, the
short fact is included and the longer episode is omitted for `budget`; the
estimated count is 163 using `utf8-bytes-divided-by-four-v1`. Stable fixtures and
a deterministic counter make the result repeatable. This estimate is useful for
the demonstration only and is not a provider token count.

## Change one thing

Increase `contextWindowTokens` to admit more of the long candidate. Change the
query to see how Memory's retrieval rank changes the order in which Context
considers records.

## Limits

This walkthrough demonstrates the Input, Memory, and Context exchanges only. It
does not call a model, execute tools, test a complete agent run, or establish
token counts for any provider tokenizer. The conversion code belongs to this
walkthrough; a later kernel implementation must own and validate the production
mapping.
