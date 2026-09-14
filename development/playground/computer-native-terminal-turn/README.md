# Playground slice: Computer Native terminal turn

## Question

What does the first real Computer Native turn persist before, during, and after a model
request? How does the session look after failure, timeout, cancellation, and restart?

## What this runs

This walkthrough calls the production Computer Native CLI and runtime. The deterministic
local provider supplies repeatable text and controlled outcomes. OpenRouter is not used
by the walkthrough.

## Run it

From the repository root:

```bash
cd computer-native
npm install
npm run build
cd ..
node development/playground/computer-native-terminal-turn/run.mjs
```

The walkthrough creates a temporary state directory and runs successful, failed,
timed-out, and cancelled turns. It prints the session directory to inspect afterward.

## Observe

Inspect these files in the printed directory:

```text
sessions/<session-id>/
  session.json
  transcript.jsonl
  turns/<turn-id>/turn.json
  turns/<turn-id>/events.jsonl
  turns/<turn-id>/result.json
```

The successful turn has a user and assistant message. Failure, timeout, and cancellation
have only the user message. Each turn has correlated event IDs and a terminal result.

## Change one thing

Change the deterministic response or delay in `run.mjs`, then compare event order and
result status. To see an interrupted turn, stop `npm run chat` after input but before the
response finishes, then resume the same session ID.

## Limits

This demonstrates the first text-only turn. It does not establish tool execution,
workspace access, memory, gateway delivery, or exactly-once provider behavior.
