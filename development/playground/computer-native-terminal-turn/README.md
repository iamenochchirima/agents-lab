# Playground slice: Computer Native terminal turn

## Question

What does the first real Computer Native turn persist before, during, and after a model
request or read-only workspace tool round?

## What this runs

This walkthrough calls the production Computer Native runtime. The deterministic local
provider supplies repeatable text, tool calls, and controlled outcomes. OpenRouter is not
used by the walkthrough.

## Run it

From the repository root:

```bash
cd computer-native
npm install
npm run build
cd ..
node development/playground/computer-native-terminal-turn/run.mjs
```

The walkthrough creates a temporary workspace and state directory, then runs a normal
answer, directory listing, file read, rejected path escape, provider failure, and an
interrupted model round. It prints the session directory to inspect afterward.

## Observe

Inspect these files in the printed directory:

```text
sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/turn.json
  turns/<turn-id>/events.jsonl
  turns/<turn-id>/rounds.jsonl
  turns/<turn-id>/result.json
```

Successful turns have a user and assistant message. Tool turns also have ordered
`model_requested`, `model_completed`, `tool_requested`, and `tool_completed` evidence.
The rejected path is returned as a model-visible tool error; it never reads outside the
workspace. The interrupted turn is finalized on restart without replaying the model
request.

## Change one thing

Change the deterministic response or requested tool path in `run.mjs`, then compare
round evidence and result status. To see the interactive path, run `npm run chat` with
`--workspace` and inspect `/status`, `/history`, and `/evidence`.

## Limits

This demonstrates only the bounded read-only tool slice. It does not establish file
writes, shell execution, memory, gateway delivery, or exactly-once provider behavior.
