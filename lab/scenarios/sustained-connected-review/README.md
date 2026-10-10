# Sustained connected collection review

This scenario asks one native run to compare six fictional release records with a separate HTTP reference, load an enabled review skill, propose four owner corrections, and verify each action decision. Three corrections are approved; Pine is denied. Dates, dependencies, blocked status, correct records and other namespaces must remain unchanged. The existing staged connected-tools baseline remains a separate control.

The hypothesis is that a native platform can retain the original task and exact pending call during a 65-second approval wait and an owned service/worker replacement, then continue the same run to a verified result. This measures a local retained wait and controlled restart, not days of operation or exactly-once external effects. Model failures and unknown outcomes remain failures in the saved report.

From `server`, start `pnpm dev:connected-fixture` (restart an already owned fixture to discover the collection tools). Its default address is `http://127.0.0.1:19196`; it stores disposable namespaces beneath `lab/runs/.connected-fixture`.

Start an isolated control plane with `AGENTLAB_API_PORT=4322`, `AGENTLAB_CAPABILITY_HOST_URL=http://127.0.0.1:4322`, `AGENTLAB_CAPABILITY_PACKAGES=<absolute-repo>/lab/scenarios/sustained-connected-review/packages.json`, `AGENTLAB_CAPABILITY_STATE_ROOT=lab/runs/.sustained-connected-proof/management`, and `AGENTLAB_CONNECTED_CAPABILITIES_ENABLED=true`. Use a fresh isolated management root: changing the seed path does not replace already retained package/profile records. The seed makes the collection MCP source, separate release-reference HTTP source and local skill available through `connected-agent`. The relative skill root resolves against `packages.json`.

Give the control plane and native workers the same absolute run/context roots and host endpoint; follow the platform setup guide and preserve unrelated services. Then run the observer from `server`:

```sh
pnpm eval:connected -- --api http://127.0.0.1:4322 --platforms langgraph --scenario ../lab/scenarios/sustained-connected-review/scenario.json --restart-hook /absolute/path/to/owned-native-restart.mjs
```

The model must pass the existing free-model catalog policy. The observer lets the model choose tools and order; it issues decisions only for exact declared record/owner pairs within its generated disposable namespace. It rejects extra mutation arguments and repeated proposals for a record. The fixture serializes corrections within each namespace, checks revisions and persists an effect ledger. There is no external account integration.

The restart module must export `restartOwnedNative(input)`. Input contains `api`, `platform`, `runId`, the native `executionReference`, `action` (`requestId`, `revision`, `toolCallId`) and `waitStartedAt`. The module may replace only a process owned by this acceptance run, retaining its durable storage. It returns matching `platform`, `runId`, `requestId`, `revision`, `toolCallId`, distinct positive `oldPid`/`newPid`, `storageRetained: true`, nonempty `owner`/`storagePath`, and ordered ISO `startedAt`/`completedAt`. The observer contains no process discovery or kill implementation. A hook declaration is evidence supplied by the test owner; independent process logs remain necessary to substantiate the replacement.

Saved evidence under `lab/runs/.connected-proof/` includes the original native execution/review/call identities before and after the wait, hook evidence, elapsed wait, decisions with independently read state, final state and effect count, native events, versions, free-model price observation, manifest-bound receipt checks and criteria. Receipt fingerprints bind the source reads and mutations to this run's catalog, turn, call, arguments and round. The skill must retain untrusted/no-authority metadata and appear in a later provider request. The original user task must appear in a later model request after the first review decision. All records must be read before a mutation; every approved or denied proposal needs a fresh record read afterward. The report must cover all six records.

A passing result does not establish fault tolerance for a crash inside an unacknowledged external mutation. Such a result requires reconciliation and a separate failure-injection experiment. Compaction events and retained summaries remain visible in native run events when the context policy triggers them; this scenario does not force a summary by manufacturing history.

## Owned five-platform local stack

After building the server and installing the locked native dependencies, run from
the repository root (Temporal's existing local server must be available at 7233):

```sh
pnpm --filter @agent-harness-lab/lab-server build
node server/src/evals/sustained-stack.mjs
```

The launcher starts an isolated API at 4324 and a frontend at 5174, with a fictional
provider at 19197. It uses a separate Temporal queue, Restate server and deployment
(8081/9071/19522 and handler 29081), LangGraph SQLite service at 22025, Vercel local
World at 9095 and Mastra's retained session state in the isolated API. Existing
listeners cause startup rejection; the launcher never stops them or force-registers
a deployment in the normal Restate server. The default Python executable is the
locked LangGraph `.local311/bin/python`; override `AGENTLAB_LANGGRAPH_PYTHON` for
another installed compatible environment.

Storage and private logs live under ignored `lab/runs/.sustained-proof/`; set
`AGENTLAB_SUSTAINED_STACK_ROOT` consistently on the launcher and observer to change
it. The launcher rewrites the scenario's fixture address and makes its skill root
absolute. It loads provider settings from ignored `server/.env` without printing
credentials. Starting services issues no model request; the observer's existing
free-model admission policy remains required. From another terminal:

```sh
cd server
AGENTLAB_RUN_ROOT="$PWD/../lab/runs/.sustained-proof/runs" \
  pnpm eval:connected -- --api http://127.0.0.1:4324 --platforms temporal --scenario ../lab/runs/.sustained-proof/scenario.json --restart-hook ../server/src/evals/sustained-stack.mjs
```

Run one platform at a time, changing `--platforms` to `restate`, `langgraph`,
`mastra` or `vercel-workflows`. The restart hook authenticates to a loopback
controller owned by this launcher. That controller accepts only the recorded
pending review/native identity, kills only its tracked child process group, starts
the same command with the same storage and verifies the original pending review
after replacement. Mastra replaces the owned API process; the other four replace
their owned worker/service. Restate's isolated server stays alive. PID replacement
and retained native/review identities are recorded per run alongside service logs.
The original Temporal backend is shared, so its durability comes from the local
Temporal server, not the filesystem path reported for the Lab evidence.

Use Ctrl-C in the launcher's terminal to stop its children while retaining evidence.
No listener lookup or arbitrary PID replacement is supported. A hung start or
failed replacement fails the acceptance run; successful service startup alone is
not acceptance evidence. This fixture does not run indefinitely in the background
or establish guarantees for an unacknowledged external effect.

If observation aborts before a stage reaches its normal grading boundary (for
example, an unexpected proposal), the observer marks the stage failed and retains
an `*-abort.json` record. It requests cancellation once, then independently reads
the native run and fixture state even if that request fails. The record separates
cancellation errors, native status and provider-read errors; available native
snapshots are also saved in the usual stage artifact. These are immediate
observations after the cancellation attempt. A running snapshot does not establish
termination, and an observed terminal state does not roll back prior effects.
Original cohort reports are not rewritten by this change.
