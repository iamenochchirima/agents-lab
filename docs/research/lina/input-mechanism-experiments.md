# Lina Input mechanism alternatives and experiment candidates

Research date: 2026-10-07. Status: source research and proposed experiments;
no measurements, runtime implementation, or changes to agreed Lina decisions.

## Finding

Input has meaningful variation points. Its costs include attachment acquisition,
durable recording, contention, batching delays, and scheduling under load.
These can affect responsiveness, resource use, and avoided downstream work even
when envelope validation itself is cheap. How much they matter for Lina remains
a question for measurement.

The twelve harness areas organize responsibilities. The experiment boundary can
be one mechanism inside Input, with a small explicit contract rather than a
replacement of the entire block. The current [Input design](input-design.md)
already exposes those boundaries in its claim, custody, acceptance, collection,
dispatch, admission, and waiting nodes. The map in
[`inputBlock.ts`](../../../apps/web/src/features/lina/inputBlock.ts) describes
architecture rather than an executing intake service.

Two comparisons must be distinguished:

- **Implementation comparison:** different implementations satisfy the same
  externally observable contract. Example: serial versus bounded concurrent
  acquisition of independent attachments, retaining identical output order.
- **Policy comparison:** alternatives deliberately change timing, grouping,
  fairness, or user-visible behavior. Example: a fixed collection window versus
  a quiet window. Both can be useful, but performance alone cannot select the
  policy without evaluating its behavior.

## Source evidence

The following bounded facts were inspected directly. Pinned agent sources are
the revisions used by the existing repository studies, not claims about today's
latest releases. Official documentation is mutable and was consulted on the
research date; a runnable experiment should also record actual library versions.

| Source | Inspected fact and limitation |
| --- | --- |
| [OpenClaw messages, `e40ed06f23cb8bd939c9a6ff537eba7136074686`](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/messages.md) | Documents configurable quiet-window batching, immediate control bypass, and channel-specific behavior. Collection is a heuristic, not proof that all parts of a request have arrived. This is a pinned contract document; this research did not execute every adapter. |
| [OpenClaw command queue, same revision](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue.md) | Documents session-key serialization combined with global capacity limits, and bounded synchronous preparation slices that yield to the event loop. These are separate scheduling mechanisms. Its busy modes change execution semantics, not just performance. |
| [Hermes Telegram admission, `ddc0e65958b326a89f6c440c76c812d31ac27e2a`](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/plugins/platforms/telegram/update_admission.py) | Code records completed IDs, coalesces receipt writes, and performs file persistence off the event loop. It explicitly disclaims cross-process coordination and exactly-once effects. This scoped dedupe implementation does not establish Lina's proposed atomic durable acceptance guarantee. |
| [Telegram Bot API](https://core.telegram.org/bots/api#getting-updates) | Polling and webhooks are alternatives. A polling offset above an update ID confirms that update; webhook delivery concurrency is configurable. Update IDs help distinguish redelivery and ordering, but edits are distinct update events. These transport facts require adapter-specific handling. |
| [SQLite WAL](https://www.sqlite.org/wal.html) | Readers and a writer can coexist, but there is still one writer. Checkpoint placement affects commit tails. This is a storage mechanism candidate, not a reason to select SQLite for Lina without measuring its workload. |
| [SQLite synchronous settings](https://www.sqlite.org/pragma.html#pragma_synchronous) | In WAL mode, `NORMAL` can lose committed transactions after power loss; `FULL` adds commit synchronization. A faster setting with weaker survival guarantees is a different contract. |
| [SQLite conflict handling](https://www.sqlite.org/lang_conflict.html) | Unique constraints and conflict outcomes provide primitives for atomic identity handling. `REPLACE` deletes the conflicting row; it is unsuitable for preserving an existing input receipt unchanged. |
| [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE) | `SKIP LOCKED` avoids waiting on locked rows and is described as useful for queue-like tables, while yielding an inconsistent view. It does not automatically preserve conversation FIFO or provide execution ownership. No PostgreSQL dependency is proposed here. |
| [Node streams](https://nodejs.org/api/stream.html#buffering) | Streams expose backpressure and bounded mapping concurrency. `highWaterMark` is a threshold rather than a strict memory limit. These primitives illustrate implementable resource controls; the runtime and library choice remain open. |
| [Python asyncio queues](https://docs.python.org/3/library/asyncio-queue.html) | A positive `maxsize` makes producers wait when full; FIFO and priority queues are provided. These are in-memory primitives, not persistence or restart recovery. |

The alternatives and hypotheses below are our inferences from these mechanisms
and Lina's requirements. They are not observed speedups in the reference agents.

## Candidate variation points

### 1. Ordinary-message collection

**Boundary:** accepted ordinary inputs → ordered batch membership and release.

Compare a fixed window from the first message against a quiet window that resets
on arrivals but has an absolute maximum wait and explicit count/byte caps. Both
preserve each input ID, sender, content, destination, and order. CLI submissions,
explicit controls, and waiting answers retain their existing bypass rules.
Collection must not merge incompatible senders, authorities, conversations, or
reply destinations. Transport album identity remains separate from timing.

**Hypothesis:** a bounded quiet window collects more fragmented requests, while a
fixed window limits additional delay during sustained traffic. This is a policy
tradeoff. Evaluate complete synthetic intent groups, unintended group merges,
added waiting time, and batch count. Batch count estimates execution demand;
it does not establish actual model cost or task quality.

**Scenario:** three fragments separated by short pauses; independent requests
near a boundary; continuous same-sender chatter; two linked channels; restart
while a batch is pending. Make the order definition and recovery deadline rules
explicit before evaluating.

### 2. Attachment custody and derivation

**Boundary:** authorized attachment references → durable original references.

Compare serial acquisition with a bounded worker pool for independent files.
Commit output association in original order despite out-of-order completion.
Apply per-input and service-wide byte, file-count, and concurrency limits. Keep
credential scope, validation, partial failures, and the acceptance contract fixed.

**Hypothesis:** overlapping independent I/O reduces time until all originals are
in custody when the resource permits overlap. It can also increase contention
and peak memory. Measure custody latency, bytes buffered, provider calls, and
failure visibility using local files and a deterministic fake download server.
Use real storage for the performance phase.

Eager versus deferred transcription/extraction is a second experiment, owned by
the configured processing boundary. The agreed preaccept requirement concerns
required original custody; it does not require every derivation before acceptance.
Lazy derivation may avoid unused work but adds latency when content is needed.
It changes preparation timing and cannot be assessed using only acceptance time.

### 3. Conversation scheduling and ownership

**Boundary:** eligible accepted work → exclusive execution admission.

A globally serial scheduler is an intentionally restrictive baseline. Compare it
with FIFO per conversation and a bounded global capacity across independent
conversations. This can satisfy the same per-conversation ownership contract
only when cross-conversation resource conflicts are also controlled. It does
not permit concurrent owners of one shared history.

Within the latter design, compare ready-conversation FIFO with round-robin
selection. Fairness is a policy choice. Avoid short-job-first as the initial
candidate: genuine turn duration is not known at admission, and rearranging work
within one conversation changes semantics.

**Hypothesis:** independent conversations need not wait behind unrelated work;
fair selection may reduce quiet users' queue tails under a noisy conversation.
Use fixed-duration fake execution, one hot conversation, and several quiet ones.
Measure wait time by conversation, admitted throughput, starvation, resource
caps, and concurrent-owner violations. Recheck authorization at admission and
include identity revocation while queued.

If a later design adds several processes, database row claiming is a separate
variation point. Skipping locked work must not skip the head of a conversation
and admit a later turn. Worker ownership and fencing still need explicit rules.

### 4. Durable claim and acceptance recording

**Boundary:** source identity and prepared input → one durable input record and
an acknowledgement permitted only after its acceptance commit succeeds.

Compare individual durable commits with a bounded single-writer group that
commits several inputs in one transaction, then acknowledges each committed
input. Hold storage engine, synchronization, schema, retention, and crash model
constant. Atomic uniqueness is authoritative; a cache may accelerate status
lookup but cannot replace the constraint or current authorization checks.

Grouping introduces failure coupling: one invalid record or constraint conflict
must not silently fail unrelated members or acknowledge rows rolled back with
the group. Specify duplicate outcomes, transaction rollback, per-input failure
reporting, and whether savepoints isolate eligible records before benchmarking.

**Hypothesis:** grouping may reduce synchronization overhead at higher arrival
rates while introducing collection delay. Measure commit/ack latency, inputs
per commit, lock contention, duplicates, and restart recovery. At owner-scale
traffic it may add delay without useful benefit.

Storage errors must not produce acceptance. Inject failures before commit,
after commit before acknowledgement, and during concurrent redelivery. Include
attachment references in the recovery checks: a database commit cannot by itself
make separately stored bytes durable. Process-kill tests do not establish
survival of power loss or a lying storage device.

### 5. Control dispatch responsiveness

**Boundary:** authenticated and authorized explicit control/waiting answer →
durable dispatch and a target-specific handler outcome.

Compare one shared bounded preparation executor with a reserved lane for
attachment-free controls and prompt answers, plus cooperative yielding during
ordinary preparation. Both variants preserve authorization, durable acceptance,
exact turn/prompt targets, and stale-target rejection. Reserve capacity at the
actual shared bottleneck; a dispatcher priority flag alone cannot unblock
synchronous validation, file work, or persistence already occupying the loop.

**Hypothesis:** a reserved lane improves Stop/status/approval latency during
ordinary intake bursts without starving ordinary input. Use fake execution and
slow attachment acquisition, then flood controls as well as ordinary input.
Measure receipt-to-handler latency, event-loop lag, refusal correctness, and
ordinary-input starvation. A fast Stop acknowledgement does not prove that a
running tool has canceled; measure that separately at the runtime boundary.

### 6. Intake backpressure

**Boundary:** transport deliveries → bounded in-flight preparation and visible
acceptance/refusal status.

Compare bounded worker pools and queue capacities under a fixed overload
policy. Unbounded intake can serve as a diagnostic baseline but is not a
deployable design for Lina. Apply both count and byte budgets; one giant file
cannot be represented safely by a message-count limit alone.

**Hypothesis:** explicit backpressure stabilizes memory and control responsiveness
when arrival rate exceeds service capacity. It cannot increase capacity beyond
the bottleneck. Measure sustainable accepted rate, redelivery amplification,
memory, queued age, and control latency.

Transport acknowledgement and Lina acceptance need separate events. With
polling, advancing an offset past an unrecorded update can abandon it. A
webhook response can stop redelivery before Lina acceptance; that is permissible
only if a documented durable handoff owns subsequent recovery. Until that
handoff and original-custody rule are specified, vary worker bounds using a
local transport simulator rather than claiming production adapter correctness.

## Recommended sequence

These are architecture questions to resolve before wiring experiments into the
Studio map. The current preset nodes have empty experiment fields; this report
does not imply approval of a policy or register an executable capability.

1. **Collection policy lab:** smallest policy comparison. Virtual-clock traces
   and an expected grouping oracle settle the open release deadline and grouping
   rules without an LLM or database. Correct control bypass comes before latency.
2. **Attachment custody lab:** a small comparison of implementations producing
   the same ordered originals; first settle partial-failure acceptance and byte
   limits. Faults must preserve the acceptance promise before measuring overlap.
3. **Admission and control lab:** several conversations, noisy intake, bounded
   capacity, and explicit controls. First settle ownership, conversation order,
   and control persistence; then measure fairness and responsiveness.
4. **Acceptance lab:** settle durability and attachment transaction assumptions,
   then measure individual versus grouped commits and fault recovery. Use
   production-like disk tests only after the lifecycle oracle passes.

This ordering prioritizes inspectable mechanisms, not a universal winner. If
typical Lina traffic is a few text messages from one owner, storage grouping and
advanced fairness may have little practical value. Media, bursts, restarts, and
controls are more plausible sources of visible differences.

## Evidence contract for each lab

Record algorithm/configuration, implementation revision, seeded trace, source
IDs, actors/permissions, conversation and destination, byte sizes, injected
failures, monotonic stage times, and the storage/runtime/hardware environment.
Emit raw events and derived summaries separately in the repository's standard
run layout. Keep receipt, custody complete, commit, acceptance acknowledgement,
batch release, admission, control handled, and completion times distinct.

First use deterministic functional simulation to verify identity, preservation,
ordering, permissions, target safety, bounded resources, and recovery. Then use
repeated real runs for latency and resource measurements, with warmup,
randomized variant order, identical workloads, sample counts, and percentile
distributions. A simulated duration explains scheduler behavior; it is not a
benchmark of the real service. Define acceptable behavior and workload-specific
latency targets before selecting a variant.

None of these experiments measures model reasoning quality. Downstream task
quality, realized token cost, and actual cancellation require later integration
experiments with their own controls. Input results support architecture choices
within their measured scope.
