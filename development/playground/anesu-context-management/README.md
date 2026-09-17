# Anesu context-management walkthrough

This walkthrough answers one question: what did Anesu actually select for the model
request, and what happened when the context was bounded?

It uses the standalone Anesu TUI and the stored local development configuration. It does
not require copying an API key into a command. The deterministic provider is sufficient
for the inspection path; use the configured OpenRouter provider when checking real model
behaviour.

## Setup

If the local provider has not been configured yet, do the one-time setup described in the
[provider-acceptance walkthrough](../anesu-provider-acceptance/README.md). Then run:

```bash
cd /home/enoch/aworkspace/agents/agents-lab/anesu
pnpm run chat
```

## Walkthrough

Type these messages in the TUI:

1. `/context` — before the first turn, Anesu should report that no prepared snapshot
   exists.
2. `List the files in the workspace without changing anything.` — this gives the model a
   normal prompt and a read-only tool opportunity.
3. `/context` — inspect the prepared snapshot. Confirm the source order, selected and
   omitted resources, request/input byte counts, token-estimate basis, pressure, and
   snapshot ID. Raw workspace and memory bodies should not be printed.
4. `/history` — confirm the canonical transcript remains the user-visible conversation;
   context selection and compaction do not rewrite it.
5. `/evidence` — note the session evidence directory, then inspect the owning turn's
   `context.json` and `events.jsonl` if you want the durable form. The events should show
   `ContextPrepared` before `ModelRequested`. If a later tool request was compacted,
   `ContextRoundCompacted` identifies the omitted complete tool rounds.

For a real-provider check, repeat the same flow with `ANESU_PROVIDER=openrouter` and the
stored `OPENROUTER_MODEL`. The provider/model shown in `/models`, `/status`, the context
snapshot, and model evidence must agree. A deterministic response is not evidence of a
real-provider request.

## Bounded-context check

To deliberately exercise transcript compaction, temporarily set a small positive
`ANESU_MAX_MODEL_REQUEST_BYTES` in the ignored `anesu/.env`, restart the chat, and submit
several ordinary prompts with enough text to cross the bound. Then use `/context` and
inspect the turn evidence:

- the current prompt and newest eligible transcript turns remain;
- older complete transcript turns are represented by a bounded deterministic summary with
  escaped role, turn, and content snippets;
- an oversized request is rejected before provider transport rather than sent unchanged;
- the canonical transcript remains intact.

Restore the normal request limit in `.env` after the check. Do not commit `.env` or any
session evidence.

## Security observations

Put a harmless instruction in a temporary workspace `SOUL.md` or `AGENTS.md` asking the
model to bypass approval, then ask for an approval-gated operation. The file may be
selected as workspace context, but the operation must still require the existing approval
channel. Remove the temporary file afterward.

Context evidence should contain source IDs, hashes, bounds, and decisions—not provider
keys, arbitrary environment variables, or unbounded raw resource content.

This is a development inspection walkthrough, not a benchmark or proof that every model
family has the same context window or tokenizer.
