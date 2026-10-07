# Lina Input architecture audit

Audit date: 2026-10-07. Repository revision inspected:
`e3e3b440400d2d9cc0fe2ecef52bb84cda7a7f22`.

This audit reviews the current Input responsibility map, its message walkthroughs,
and the maintained design decisions. It does not audit a working Lina runtime or
claim that decided nodes have been implemented. The [Input design](input-design.md)
explicitly makes that distinction at line 3. No agent, model, messaging adapter,
tool, or side-effecting recovery operation was executed.

## Scope and evidence

The principal evidence is:

- `docs/research/lina/input-design.md`, the agreement and proposal record.
- `apps/web/src/features/lina/inputBlock.ts`, the maintained node and connection preset.
- `apps/web/src/features/lina/executionPaths.ts`, the illustrative paths and route descriptions.
- `apps/web/src/features/lina/README.md`, the design workspace's boundaries and persistence behavior.
- The four [system studies](../system-explorers/) and their [dated source audits](../system-explorers/audits/README.md).

Line references below refer to the inspected revision. Prior source-audit counts
do not certify Lina or the subsequently expanded Hermes map. A source mapping
identifies a comparable responsibility; it does not establish identical order or
guarantees.

Focused primary-source checks used the exact pinned upstream revisions. Nearby
local Hermes and OpenClaw checkouts were at different revisions, so their current
files were not used as evidence for the pinned claims. The pinned OpenClaw
[dispatch preparation](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/auto-reply/reply/dispatch-from-config.prepare-context.ts#L325)
does check durable duplicate identity and pending-input reclaim around its
process-local claim. Pinned Hermes
[Telegram admission](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/plugins/platforms/telegram/update_admission.py#L206)
separates active owners from receipt recording. These support the bounded source
comparisons; neither proves Lina's proposed service-wide inbox contract.

The pinned OpenClaw
[steering specification](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue-steering.md#L19)
supports Lina's candidate first-executable-call rule and its distinction between
sequential tails and parallel batches. Newer upstream behavior should not be
silently substituted for that recorded candidate.

## Confirmed strengths

- The adapter/service boundary is explicit. Adapters supply transport facts;
  the service resolves identity and authority. Original content cannot grant
  permissions. See `input-design.md:30-49`.
- DM access, group access, history routing, administrative permission, and
  execution-control permission are separate decisions. Owner-managed identity
  linking does not automatically merge old histories. See `input-design.md:13-26`.
- Duplicate delivery and burst collection are distinct. Source identity is
  preserved, and text equality is not a duplicate key. See `input-design.md:92-109`.
- Required attachment originals precede accepted responsibility. Derived text
  remains separate, and attachment failure has a visible preacceptance branch.
  See `input-design.md:53-72,113-117` and `inputBlock.ts:469-483,607-609`.
- Acceptance, execution, and delivery have different meanings. A saved answer
  can retry delivery without repeating an agent turn. Unknown tool outcomes must
  enter reconciliation. See `input-design.md:111-148`.
- Controls and waiting answers bypass ordinary collection and queues. Exact
  prompt/turn targets prevent an answer from resolving newer work. See
  `input-design.md:74-90` and `inputBlock.ts:511-525`.
- The map contains activation/ignored branches, operation refusal, attachment and
  persistence failures, preacceptance claim recovery, queue drain, and distinct
  restart routes. These are real improvements over a success-only sketch.
- Walkthrough outcomes consistently stop at owned boundaries and state
  assumptions. They do not present the illustrative paths as run evidence.

The root task's structural check found 28 unique nodes, 50 unique edges and 24
walkthroughs, with no dangling endpoints, missing path nodes or absent adjacent
path edges. Structural validity does not establish complete behavioral coverage.
The root task also ran the current web documentation generation and both web
TypeScript projects successfully on 2026-10-07. The older source-audit note about
TS2366 is historical and was not reproduced by this check. Read-only observation
of `/studio/lina` showed the maintained design map and an unsaved browser draft;
the API reported revision 0 with no saved architecture document. No design was
saved or changed through the UI during the audit.
The predefined walkthroughs traverse 44 of the 50 graph edges. The remaining six
are selectable alternate routes: operation denial, the separate acceptance
receipt, return of a live/accepted/terminal receipt during claim recovery,
runtime owner-release notification, and reconciliation's safe-resume and status
handoffs. These counts describe the examples, not behavioral test coverage.
Denial and reconciliation examples would improve review; the acceptance receipt
is an independent consequence and need not be forced into a linear execution path.

## Findings in the represented design

These are documentation or diagram findings, not observed runtime failures.
P2 means resolve during architecture review; P3 means a small evidence or labeling
repair. Open implementation choices are listed separately below.

### P2: show rejection when stored-conversation access fails

`inputBlock.ts:141-143` requires authorization against the original conversation
before exposing an existing input's status. `input-design.md:211` and
`executionPaths.ts:180` repeat that check. However, the duplicate node's only
outgoing connection is the successful status handoff at `inputBlock.ts:570-573`.
The same issue applies to the stored-conversation access check in preacceptance
claim recovery at `inputBlock.ts:364`.

An account can retain chat access while losing access to the receipt's original
conversation after unlinking or a routing change. Passing current conversation
authorization does not settle that case. The graph needs a visible access-refused
outcome that does not disclose old status or reclaim the old claim. Add a focused
walkthrough for an admitted account that cannot access the original conversation.
The existing successful duplicate walkthrough does not exercise this branch.

### P2: reconcile agreement labels across the map and decision record

The original-conversation authorization check is a required rule in
`input-design.md:211`, but `inputBlock.ts:143` labels it Proposed. Exact turn
targeting appears in the agreed command table at `input-design.md:82`, while
`inputBlock.ts:241` labels protection against affecting a newer turn Proposed.

The broad node status cannot explain which individual obligations have been
agreed. Reconcile the wording and keep the unchosen mechanism separate from the
selected invariant. This repair should preserve genuine open choices such as
transaction boundaries and control execution behavior. Also check existing saved
documents: refreshing maintained notes alone must not leave an old status badge
that tells a different story from those notes.

### P3: repair two OpenClaw evidence paths

`inputBlock.ts:130` and `inputBlock.ts:368` refer to
`src/auto-reply/dispatch-from-config.prepare-context.ts:325`. The pinned file is
`src/auto-reply/reply/dispatch-from-config.prepare-context.ts:325`, as correctly
linked at `input-design.md:301`. The missing `reply/` prevents a reader from
following the node note to the cited owner. Correct both node references.

## Explicit open decisions and design obligations

These are not defects merely because the implementation is absent. They define
the next decisions needed before an executable Input implementation can make the
selected promises.

| Decision | Current evidence | What must be settled |
| --- | --- | --- |
| Receipt and claim ownership | `input-design.md:218-233`; `inputBlock.ts:126-129,364-367` | Unique claim key; owner identity; safe retirement and takeover; fenced writes so a retired preparation owner cannot later accept or dispatch. Elapsed time alone cannot prove safe ownership transfer. |
| Acceptance and execution handoff | `input-design.md:113-130`; `inputBlock.ts:182-199,281-283` | An accepted input must remain discoverable after a crash before dispatch. Record dispatch/admission progress and turn association so concurrent recovery cannot launch two turns for one input. Specify the transaction or recoverable handoff protocol. |
| Immediate controls and storage contention | `input-design.md:76-90`; `inputBlock.ts:185`; `executionPaths.ts:110-111` | Controls bypass ordinary queues but still traverse claim and acceptance. Decide persistence priority, target validation at application time, and the visible response when storage is unavailable or the active turn changes. Bypass does not itself establish bounded response time. |
| Batch identity, order, and destination | `input-design.md:99-106,134-146`; `inputBlock.ts:210-213` | Decide whether linked cross-channel messages can share a batch, which request gets each answer, and how ordering works across senders and conversations. The selected origin-delivery rule must remain true for every constituent input. Define maximum batch age/size and unfinished-batch recovery. |
| Queue ownership and progress | `inputBlock.ts:224-227,378-381`; `input-design.md:274-280` | Choose persistence, capacity, ordering, admission wakeups, failure blocking and Stop/Interrupt behavior. State how accepted work remains accounted for when a queue is full. A queue limit must not silently discard accepted responsibility. |
| Authorization changes | `input-design.md:23,122`; `inputBlock.ts:225,308-311` | Rechecking authorization is already required for recovered and draining work. Choose how revocation affects running work, pending controls, attachment preparation and delivery; define the refused terminal state for no-longer-eligible work. |
| Attachment lifecycle | `input-design.md:61-72`; `inputBlock.ts:169-172,353` | Storage custody, safe retrieval/validation limits, partial failure and orphan cleanup, provenance for derived content, and retention. Bound resource use before accepting responsibility. |
| Prompt resolution | `input-design.md:83-90`; `inputBlock.ts:252-255` | Prompt expiry, eligible approvers and atomic resolution. Concurrent approve/deny responses need one recorded resolution; a duplicate answer returns that result rather than repeating the protected action. |
| Transport acknowledgement | `executionPaths.ts:90`; `inputBlock.ts:339` | Distinguish provider protocol acknowledgement from Lina acceptance and later answer delivery. Specify retry and reconnect behavior per adapter, including transports without a usable source event ID. |

Claim takeover, conversation admission, dispatch recovery and delivery retry are
different ownership problems. One generic lease should not be assumed to solve
them all. Their chosen contracts can later justify shared machinery.

The existing laboratory Input module is a reuse boundary to review, not proof
that Lina Input exists. Lina accepts attachment-only channel messages and carries
sender, account, conversation and reply facts. A text-oriented reference normalizer
requires an explicit extension or adapter contract before it can serve that role.

## Experiment seams arising from this architecture

The map has enough internal responsibilities to support meaningful experiments
without replacing the whole Input block. First establish a common correctness
contract for each comparison.

- Burst collection can compare immediate dispatch, a fixed collection window
  and a bounded quiet window. Preserve message identity, destinations and
  attachment boundaries. Measure turns avoided, batch wait, end-to-end completion,
  and whether interruption/control response remains available.
- Receipt persistence can compare transactional claim/acceptance layouts or
  write batching under the same durable-acceptance promise. Measure acknowledgement
  latency, storage operations, duplicate suppression and crash-boundary recovery.
  Volatile acknowledgement is a different guarantee and needs separate labeling.
- Conversation admission can compare per-conversation scheduling and shared
  scheduling with fairness under the same ownership rule. Measure queue wait,
  throughput, tail latency and starvation across hot and quiet conversations.
- Attachment custody can compare bounded sequential and bounded concurrent
  acquisition. Keep validation, provenance and durable-original requirements
  fixed. Measure acceptance delay, peak resources and behavior under partial failure.
- Intent dispatch can compare explicit structured actions with deterministic
  text parsing on a fixed labeled workload. Measure classification correctness,
  latency and ambiguity. Unauthorized content must never obtain authority through
  classification, whatever implementation is faster.

Queue, Steer and Interrupt intentionally change user-visible execution behavior.
Their comparison measures policy trade-offs, including wasted work and response
time, rather than claiming equivalent answers or a universally faster mechanism.

## Limits and recommended sequence

This pass did not inspect every upstream caller, validate every source anchor,
run a browser acceptance suite, or exercise the unimplemented runtime. The
primary-source checks above are bounded checks of claims important to Input.
No performance improvement is established by this audit.

First reconcile the labels and refused duplicate route. Then decide the receipt,
acceptance and admission state transitions, including control priority and batch
destination rules. Use those selected contracts to define deterministic fault
workloads and correctness graders before comparing implementations. Record
architecture choices separately from experiment results; a selected policy is
not evidence that its implementation is reliable or fast.
