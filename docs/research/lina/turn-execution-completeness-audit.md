# Lina Turn Execution: essential loop coverage audit

Reviewed 2026-10-07. This is a source-based design audit with proposed graph repairs, not a runtime
implementation or an agreed policy change. It evaluates the current nine-node graph and its
three scripted simulation routes against the four pinned source studies.
The upstream sources were read directly; upstream tests and real model/tool
runs were not executed in this audit.

## Finding

The lifecycle skeleton is appropriate: admitted ownership, preparation, model,
decision, tool batch, control boundary, recovery, settlement and release. Its
separation of Context/Models/Tools from the execution controller is useful.
Before this audit's repairs it was not an essential-path-complete design. Some
node descriptions mentioned behavior that the arrows and scripts could not
express. The graph contracts have since been amended as recorded below; the
simulator still intentionally covers only three ordinary fixtures.

The distinction matters: a three-case initial simulator can be complete for its
implementation plan while the architecture it illustrates still has unresolved
contracts. Adding every upstream product feature would not repair that mismatch.
The useful correction is exposing missing decisions and failure exits.

## Graph corrections inspected after the audit

The amended `executionBlock.ts` retains nine nodes and adds explicit edges for
no-tool continuation, prelaunch pending controls, context-pressure recovery,
preparation failure/exhaustion,
fatal or stopped tool batch, uncertain effects and unresolved settlement.
The release edge is now conditional on release-ready state and required work
being resolved. Node contracts describe prelaunch permission checks, response
classification, incomplete-argument rejection, call-ID-paired outcomes, skipped
unstarted work, preserving settled results across recovery and distinct terminal
reasons. Controls preserve the next-action intent, waits retain their owning
operation and denial/expiry produce explicit outcomes. Unresolved work retains
or transfers fenced ownership to reconciliation, also reflected in the Input
reconciliation contract. These are design contracts, not implemented runtime
guarantees.

This addresses the main baseline graph omissions without moving Tools/Context
internals into the controller. Specific context-overflow recovery policies,
visible wait/resume transitions and a concrete settlement/reconciliation ownership
protocol remain future detail. In particular, an arrow to reconciliation must
eventually specify who retains or fences authority and where execution resumes;
the arrow alone is not a restart protocol. The generic control checkpoint's
next-action contract is now documented; the three existing scripted paths do not
exercise arbitrary checkpoints, stops or resumed waiting operations.

The scripts remain direct answer, successful tool round and model retry. Extra
arrows are inspectable architecture coverage, not claims that all these branches
can currently be played. Automatic/Manual verification belongs to the primary
implementation's validation record, not this static audit.

## Baseline evidence before this audit's repairs

- [Execution nodes and contracts](../../../apps/web/src/features/lina/executionBlock.ts)
  define nine nodes. `Decide next action` names continuation, but its original
  outgoing edges distinguish tools, answer, recovery and terminal failure, not
  a separate no-tool continuation.
- [Scripted traversal](../../../apps/web/src/features/lina/inputSimulation.ts)
  supplies direct answer, one successful tool batch and one successful provider
  retry. Playback stores visits, edge IDs, position and
  viewer status. It does not carry semantic turn outcome, tool-call results,
  attempt count, budget or pending controls.
- The original `Execute tool batch` describes failures and uncertainty, but its only
  execution exit is `settled tool outcomes` to controls. Preparation only exits to model, and settlement only exits to release.
- Controls are reached after tools or candidate answer. Retry goes straight
  back to preparation. The text allows active cancellation, but no graph
  prelaunch guard represents stop/authority loss before model or tools.
- All three scripts terminate at Release. This proves the ordinary release path
  only; it cannot establish cancellation, exhaustion or settlement-error rules.

## Essentials to make explicit now

These are proposed corrections to the design model. They need not all become
separate nodes, nor require a durable runtime implementation.

| Gap | Smallest useful correction | Why it matters |
| --- | --- | --- |
| No-tool continuation | Distinct decision edge through the control checkpoint back to Prepare round | Text and no tools need not mean finished. |
| Response validity | Classify complete, partial/truncated, malformed, failed and cancelled outcomes before authorizing calls | Salvaged arguments can parse while remaining incomplete. |
| Launch guards | Check stop, authority and budget immediately before fresh model/tool work; show stop → settlement | Guidance checkpoints and cancellation signalling are different; a post-batch checkpoint alone cannot prevent launch. |
| Continuation limits | State separate round and retry limits; show exhausted → settlement | Retries and loop iterations have different accounting. Limits remain a Lina policy choice. |
| Tool outcome contract | Carry a call ID and one outcome for each admitted call, including error, denied/skipped and unknown | A model-visible tool error can continue the loop; infrastructure failure or uncertain effects require different handling. |
| Preparation failure | Add recoverable context overflow to recovery; nonrecoverable preparation error to settlement | Errors can occur before any provider request, so model failure is not the only entry to recovery. |
| Tool boundary failure | Separate model-visible error results from fatal tool/persistence/ownership failure exits | A successful batch is not the only route back to the controller. |
| Safe recovery | Say which request/transcript resumes, check retry eligibility, preserve settled results and forbid blind tool replay | Retrying a provider request must not recreate side effects. |
| Wait/resume boundary | Mark wait reason and owning work; matched reply resumes that work, denied/expired/cancelled waits have outcomes | The Input answer connection currently points to a generic checkpoint without an explicit waiting owner. |
| Settlement gate | Define required-work/outcome recording gate, failed-settlement handling and release rule | An answer is a candidate outcome; failed persistence must not silently look like a clean release. |

Tool results, waits and semantic outcomes can initially be synthetic fixtures.
The viewer's Automatic/Manual pacing must remain separate from actual execution
waiting and cancellation. Pause is not Stop. Completion of a failed fixture can
mean playback completed while the simulated turn outcome is failed.

## Primary-source checks

### Continuation and malformed responses

Pi explicitly permits finish policy to request one context-only continuation
after natural tool/follow-up work is exhausted. It also rejects every tool call
in a length-truncated assistant response because argument salvage can produce
valid-looking incomplete objects. This is a stronger boundary than simply
checking JSON parsing. See [Pi continuation precedence](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L280-L320)
and [truncated-call rejection](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L255-L278).

OpenClaw continues when a provider says more work is required or `endTurn` is
false, independently of a normal final-answer branch. Its code distinguishes
provider failure, fatal batch failure and explicit stop/termination. See
[OpenClaw cycle evaluation](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/packages/agent-core/src/agent-loop.ts#L295-L427).

Waku supplies the simpler baseline: no tools returns text; iteration exhaustion
returns a limit message. It does not prove that all no-tool text is semantically
complete. See [Waku loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L81-L138).

### Tool results and effect boundaries

Hermes retains emitted mixed-batch calls and creates matched error results for
invalid calls, then stages the assistant call row before effect execution.
Configured canonical-write failure prevents launch. This is not a claim that
every Hermes configuration provides persistence. See
[Hermes intent and pairing](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/turn_tool_round.py#L107-L180).

Pi converts validation/execution failures into result messages keyed by call ID.
It prepares calls serially, joins parallel execution and publishes results in
call order. Lina's first tool contract should preserve IDs and results without
prematurely selecting a concurrency implementation. See
[Pi scheduling and result publication](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L508-L659)
and [result identity](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts#L922-L935).

### Limits, recovery and settlement

Hermes checks iterations and shared iteration budget before another cycle,
allows preflight return/break/continue and normalizes responses before selecting
tool or text handling. This illustrates why preparation, provider attempts and
response classification need distinct paths. See
[Hermes main cycle](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/conversation_loop.py#L1636-L1687).

OpenClaw's recovery admission distinguishes replay-safe attempts from continuing
recorded, proven-settled tool results. The code explicitly warns that recorded
results alone do not prove settled side effects. See
[OpenClaw recovery eligibility](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/agents/embedded-agent-runner/run/attempt-recovery.ts#L123-L204).

Pi's low-level end is followed by possible session retry, compaction and
before-settle continuation. Hermes records persistence cleanup errors instead
of dropping already-produced text. Neither supplies a universal Lina release
policy: they establish that cleanup/settlement failures must be represented
separately from answer production. See
[Pi settlement owner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts#L1775-L1865)
and [Hermes guarded persistence](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/turn_finalizer.py#L604-L628).

## Keep within later component studies

These mechanisms matter but are not missing Turn Execution nodes by themselves:

- Tool schemas, approval surfaces, concurrency, dependency barriers, per-tool
  cancellation and idempotency belong in Tools and Permissions. Execution needs
  their admission/result/join contracts.
- Token selection, compression algorithm and memory retrieval belong in
  Context/Memory. Execution needs preparation-failure and refresh/retry paths.
- Provider streaming/protocol repair and transport retry belong in Models.
  Execution needs complete/failed/partial response classifications and effect
  eligibility, particularly before adopting streamed early tool launch.
- Database durability, checkpoints, leases and crash reconciliation belong in
  State/Persistence and the existing Input recovery boundary. Execution needs
  recording and ownership contracts without pretending transcript save implies
  safe replay.
- Graph orchestration and child-agent coordination can compose loops. A future
  fork/join owner should preserve branch identity and budgets; a graph engine is
  not essential to finish the ordinary baseline loop.
- Adaptive models, speculative tools, memory review hooks and product-specific
  recovery exceptions are optional experiments, not baseline requirements.

## Proposed follow-up coverage

Retain the three existing routes and progressively add deterministic fixtures:

1. Explicit no-tool continuation before an answer.
2. Tool error returned to the model and corrected without infrastructure retry.
3. Truncated tool request rejected without launching work.
4. Non-retryable model failure and exhausted round/retry budget.
5. Stop before launch, plus stop during a tool with an honest unknown outcome.
6. Approval wait with matched answer, denial and expiry.
7. Context overflow followed by refresh while retaining settled tool results.
8. Required settlement write failure with an explicit recovery/release outcome.

This is coverage for a learning/design simulation, not a demand to implement
production durability or exhaustively reproduce the four agents. No speed,
quality or reliability improvement has been measured. The main conclusion is
that the graph now exposes essential control and outcome contracts. Detailed
component policies and additional simulated outcomes still need design work.

## Validation of the graph repairs

- Primary implementer reran 15 focused architecture/progression checks; all
  passed for the existing nine channel/case combinations and saved-design refresh.
- Web TypeScript compilation and docs generation passed; `git diff --check` passed.
- Live browser inspection verified the new continuation, tool-uncertainty and
  unresolved-settlement connections. The existing manual tool-round simulation
  still completed at Release turn, with no browser page errors.
- These checks prove graph integration and existing playback behavior. They do
  not execute the newly documented budget, approval, cancellation or recovery
  policies. Those remain proposed runtime contracts and future simulation cases.

## Implemented simulation follow-up

Turn Execution now includes **Check execution limits** and **Handle tool outcomes**.
The Run modal supports a configurable logical-round limit and seven deterministic
cases. Known correctable tool errors return to the model; the correction fixture
then issues a new successful tool call. Terminal model/tool failures settle failed.
Explicit continuation reaches the round gate, which stops before an extra model
call and settles exhausted. Provider retry retains its logical round and consumes
an additional attempt, with one retry in the fixture.

This is a chosen simulation policy for studying the architecture. It does not
execute tools or implement runtime enforcement. Uncertain external effects,
interactive waits, cancellation, partial/parallel batches, retry exhaustion,
context recovery and durable settlement still need dedicated simulations.
