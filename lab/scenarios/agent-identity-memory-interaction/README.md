# Identity, memory and interactive task acceptance

This scenario observes general backend agents on Temporal, Restate, LangGraph,
Mastra and Vercel Workflows. It uses the shared identity, memory and tool catalog.
Connected actions target only the existing disposable fictional collection provider.
It is functional coverage, not a model-quality benchmark or a platform ranking.

For each target platform, a separate chat on the preceding platform explicitly
saves a unique fictional reporting preference. A fresh target chat uses the same
isolated comparison namespace, recalls that preference, inspects Cedar and asks
who should own it. The observer replies Morgan. After holding the initial proposal
for at least five seconds, it sends a correction to Casey without approving the
old proposal. Only a fresh exact Cedar/Casey action is approved. The agent must
verify the saved state. The observer independently reads the entire collection.

Prompts are recorded in the report before the first call. If the seed model asks to confirm the exact fictional
preference, the observer reconfirms that original request once and retains the
question, matched reply identity, content and consumption evidence. Unrelated or
repeated seed questions fail rather than receiving arbitrary scripted answers.
This reply grants no tool capability or connected action permission.

They ask for outcomes,
clarification and an explicit memory save. They do not prescribe a complete tool
call sequence or fabricate model decisions. No automated action is authorized
outside the credential-free loopback fictional provider and exact disposable
namespace. Unexpected task questions or proposals stop the observation with retained
failure and cancellation evidence.

Run from the repository root after starting an owned isolated stack configured
with the sustained-connected collection packages and the new shared capabilities:

```sh
AGENTLAB_RUN_ROOT=lab/runs/.sustained-proof/runs \
  node server/dist/src/evals/identity-memory-interaction.js \
  --api http://127.0.0.1:4324 \
  --platforms temporal,restate,langgraph,mastra,vercel-workflows \
  --model nvidia/nemotron-3-ultra-550b-a55b:free \
  --out lab/runs/.identity-memory-proof
```

`AGENTLAB_IDENTITY_FIXTURE_URL` defaults to `http://127.0.0.1:19197`.
The configured control plane must resolve `connected-agent` to collection tools,
shared memory tools and `ask_user`. Each native service must retain model request
observations using the existing live-eval configuration. The model catalog is
fetched freshly and every billing dimension must be zero. The experiment is
`agent-capabilities-live`, which enforces 2048 output tokens, zero-price provider
ceilings and no fallback. Missing or paid routing fails the assessment.

Each invocation creates a new report directory. Original failures are retained;
there is no automatic continuation or repeated trial to obtain a nicer result.
The report contains exact identity revision, memory namespace, prompt controls,
seed/task run IDs, input acknowledgements, original and replacement approvals,
provider state and per-criterion verdicts. Each full run export includes its
recorded manifest and original capability receipts. Actual model requests remain
in the native evidence, with the matched memory source and version.

The grader checks fingerprints against the call arguments in observed model
requests, rather than accepting a tool's name or final prose. It requires consumed
clarification and steering, cancelled original review, a distinct approved review,
exactly one verified effect and unchanged unrelated records and constraints.

This driver does not replace focused correction/forget tests, browser interaction
checks or owned worker-replacement evidence. Those are separate required checks
for the implementation plan. It makes no hosted or multi-hour durability claim.
