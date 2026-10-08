# Native compaction acceptance (X05)

This bounded development experiment checks whether each baseline crosses an actual
context budget boundary, calls its summary adapter, retains source provenance and
sends the resulting summary to the next native model request. It uses a loopback
scripted OpenAI-compatible provider; it measures harness mechanics, not real-model
summary quality or reliability.

## Fixture and controls

Case `x05-compaction-v1` uses two turns in one fresh session. The first gives three
synthetic constraints (`colour=violet; batch=27; mode=read-only`) and harmless Cedar
padding. The second asks for those earlier constraints as an exact JSON object and
adds harmless Birch padding, without repeating the constraint values. The explicit
window is 12,000 tokens, with 4,096 reserved for output, 1,024 safety margin, a 20%
compaction threshold and two recent message groups. The character estimator uses
three characters per token plus message overhead; its accounting is estimated.

The first request must fit without compaction. The accumulated second request must
reach the normal preflight compaction boundary. The native summary operation gets
only selected historical messages and returns a short constraint summary. The
answer fixture returns the correct JSON only if the actual post-compaction request
contains those constraints. Missing context produces a measured failure.

No tools, external effects, arbitrary filesystem access or provider fault injections
are used. Internal run/session evidence storage is existing Lab infrastructure.
The model's semantic decisions are scripted controls; this must not be presented as
a free-model trial or evidence that a real model reliably preserves every constraint.

## Run

From the repository root after building the server:

```sh
pnpm --filter @agent-harness-lab/lab-server run build
AGENTLAB_TEMPORAL_ENDPOINT=127.0.0.1:17233 node server/dist/src/evals/compaction.js --platforms mastra,langgraph,temporal,restate
```

Choose only required baselines with `--platforms`. Temporal requires a running server
at the configured endpoint; the command creates its own unique task-queue worker.
LangGraph requires the installed `.local311` Python environment, overridable by
`AGENTLAB_LANGGRAPH_PYTHON`. Restate requires the installed platform-local
`restate-server` binary. The driver starts an isolated Restate server and SDK service,
and an isolated LangGraph service/state directory on dynamically selected loopback
ports. It preserves existing user services and restores any temporary provider
configuration in the invoking process. Unavailable infrastructure is retained as an
error; there is no external model endpoint or paid fallback.

## Grading and evidence

The six X05 assertions independently measure:

1. A retained preflight budget crossing and smaller safe post-compaction budget.
2. An actual summary adapter HTTP request whose output matches the saved summary.
3. Source message IDs, source revision and source text matching the summary request.
4. A later ordinary model request containing that exact summary and active task.
5. The old constraints occurring in the summary and post-compaction model request.
6. A final JSON object containing exactly the three expected keys and values.

The exact JSON answer check is separate from delivery assertions. It is deterministic
for this fixture; it is not a semantic language grader or a substitute for reviewing
arbitrary prose. Known passing and failing controls exercise source loss, request
loss and an incorrect answer without rerunning the native campaign.

Evidence is written under `lab/runs/.evals/compaction-<uuid>/`: the summary includes
source revision, timestamps, native deployments and frozen controls; each platform
has a complete evidence file with run IDs, canonical transcript, context snapshot,
provider request/response receipts and final output. Worker logs and receipts remain
available even on errors. Corresponding normal run artifacts stay under
`lab/runs/<run-id>/`. Provider headers and credentials are never recorded.

A separate `lab/runs/.review-proof/compaction-<uuid>/extensions.json` envelope exposes
versioned X05 reports to the shared extension projection. Reports retain paths to
source evidence. Prior invocations remain unchanged; every rerun gets a fresh identity.
One passing observation establishes this bounded native path, not all compaction
policies, windows, provider failures, active-skill combinations or live-model quality.
