# Playground slice: Anesu terminal turn

## Question

What does the first real Anesu turn persist before, during, and after a model
request, read-only workspace tool round, or explicitly approved workspace mutation?

## What this runs

This walkthrough calls the production Anesu runtime. The deterministic local
provider supplies repeatable text, tool calls, and controlled outcomes. OpenRouter is not
used by the walkthrough.

## Run it

From the repository root:

```bash
cd anesu
pnpm install
pnpm run build
cd ..
node development/playground/anesu-terminal-turn/run.mjs
```

The walkthrough creates a temporary workspace and state directory, then runs a normal
answer, directory listing, file read, an approved `apply_patch`, an approved
`apply_patch_set`, rejected path escape, provider failure, and an interrupted model
round. It also runs harmless local process fixtures: one approved command, one denied
command, a non-zero exit, and a timeout. It prints the session directory to
inspect afterward.

## Observe

Inspect these files in the printed directory:

```text
sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/turn.json
  turns/<turn-id>/events.jsonl
  turns/<turn-id>/rounds.jsonl
  turns/<turn-id>/mutations/<mutation-id>.json
  turns/<turn-id>/executions/<execution-id>.json
  turns/<turn-id>/result.json
```

Successful turns have a user and assistant message. Tool turns also have ordered
`model_requested`, `model_completed`, `tool_requested`, and `tool_completed` evidence.
The rejected path is returned as a model-visible tool error; it never reads outside the
workspace. The interrupted turn is finalized on restart without replaying the model
request. The mutation record contains the exact bounded preview and approval/commit
status. The production runtime also supports approved whole-file writes, directory
creation, recoverable regular-file delete/restore, bounded directory-tree delete/restore,
exact-token quarantine purge, copy, and move. The batch example shows its member journal
and deliberately does not claim all-or-nothing filesystem atomicity.
Process fixtures use structured argv, no shell, a sanitized environment, bounded output,
and the same durable execution records used by the interactive TUI. The timeout result
is terminal only when child termination is confirmed; otherwise it is reported
ambiguous and never replayed.

## Change one thing

Change the deterministic response or requested tool path in `run.mjs`, then compare
round evidence and result status. To see the interactive path, run `pnpm run chat` with
`--workspace` and inspect `/status`, `/history`, and `/evidence`.

## Limits

This demonstrates bounded reads, approved single-file and batch writes, approved local
process execution, and their durable evidence. It does not establish multi-file
atomicity, shell execution, memory,
gateway delivery, or exactly-once provider behavior.
