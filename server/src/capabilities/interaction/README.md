# Task input and clarification

`TaskInteractionStore` records instructions and matched question replies in each
run's private `interaction/state.json`. One API process owns mutations; native
workers only use authenticated short HTTP boundaries. Inputs are atomically
published before native delivery. Delivery means a wake notification was accepted,
not that the model read it.

`accept` uses a client input ID and content digest. Repeating the same ID returns
its original record; changing that payload fails. The supplied `before` callback
runs under the input lock to validate the run and invalidate undispatched proposals.
Native delivery occurs after that lock is released. Terminal inputs are rejected
by the run service, and retained pending inputs/questions close without a new task.

`consume(runId, turnId, boundaryId)` selects ordered steering and records its exact
set. Retrying that boundary returns that same set after restart, while a new
boundary only receives newer input. Consuming steering cancels pending questions
in that turn so an old clarification cannot silently survive changed instructions.
`answer` consumes only a reply matched to its retained question. Questions have
stable run/tool-call identities and do not grant approval or tool access.

`ask_user` is a normal admitted declaration with a native suspension contract.
A native loop publishes its question, waits using its platform's primitives, then
reads the matched answer through the host. The ordinary tool host fallback fails
closed. Human waiting does not hold an HTTP request or start a connected tool
operation deadline. Absolute admitted task deadlines still apply.

Native loops fetch steering before model and tool decisions. The final shared
external dispatch gate rejects any newly accepted unconsumed steering. Already
dispatched effects cannot be undone. Input acceptance and dispatch reservation
share the API owner's per-run lock. This provides local ordering, not a distributed
lease or an exactly-once external-effect guarantee.

Limits are 256 inputs and 128 questions per run, and 16 KiB of text per input or
question. Live instructions remain user content and must be protected during
context compaction. Retained evidence and completed conversation transcripts are
not erased by later cancellation or memory forgetting.

Focused validation:

```sh
pnpm --dir server run build
node --test server/dist/tests/interaction/store.test.js
```
