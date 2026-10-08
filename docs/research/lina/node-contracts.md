# Lina node contracts and reference examples

Every maintained Input, Turn Execution, Context, Tools and Model Interface node has a provisional contract in the
Lina inspector's **Contract** tab. Select an input path or an output outcome to
inspect an example. Expand **Input schema**, **Output schema**, or **State and
rules** for detail. Selecting a connection shows the output variants transferred
on that connection.

These are design contracts, not deployed agent interfaces. They use a small JSON
Schema vocabulary and can be displayed as standalone Draft 2020-12 schemas.
Examples are synthetic reference fixtures. Selecting an outcome does not execute
it, and the examples are independent of the current simulation's playback state.

## Event, context and outcomes

A node input has two parts:

- `event` is the exact producer output or an explicitly named external input.
- `context` contains dependencies loaded by the receiving node's owner, such as
  current grants, saved receipts, pending prompts or execution records.

Graph outputs have a `kind` discriminator and a typed `payload`. Each output
names its branch condition and associated connection IDs. Incoming schemas are
assembled from those producer variants, and their example events preserve the
producer's payload unchanged. Alternative coordinator snapshots illustrate
states such as idle, busy, revoked, checkpointed or awaiting reconciliation.

Multiple inputs are represented wherever responsibilities differ. CLI examples
include ordinary text, selected-conversation files, Queue, Steer, Interrupt,
Stop, prompt answers, commands and resubmission. WhatsApp examples distinguish
DM/group/media messages, output delivery observations and unsupported provider
events. Downstream nodes distinguish ordinary/control/prompt/command operations,
queue lifecycle signals, restart records, fresh versus resumed turns, model
responses/failures and success/error/denied/skipped/cancelled tool results.

An input arriving from a connection is not a copy of every shared state record.
The contract documents state reads and writes separately. IDs and references
stand for records owned elsewhere; neither a reference nor an example proves
that bytes, permissions or durable records exist.

## Telegram surfaces

The [Telegram Bot API](https://core.telegram.org/bots/api#update) distinguishes
message, channel-post, edit and callback updates. Chat types and topic identity
also affect interpretation. The new **Telegram event router** represents those
forms before common envelope normalization. Its projections preserve update ID,
message ID, topic/album identity and user versus chat-sender provenance.

Examples cover DMs, groups, supergroups with and without a topic, attachment-only
images/voice, album members, channel posts, edits, callbacks and anonymous group
senders. A channel sender is not fabricated as a person. A callback is actionable
only through a server-owned mapping that binds actor, prompt, turn and action.
Opaque callback data alone cannot authorize tool approval.

Channel-publisher authority, channel history/activation, edit handling and
inline-only callback destinations still need policy decisions. Those forms are
represented with explicit withheld outcomes. This is not a claim that Lina
already supports all Telegram events or that the projection is the wire schema.
The WhatsApp integration is likewise unselected: its examples define a proposed
adapter interface rather than one provider's request format.

## Gaps corrected during contract review

1. The shared envelope now describes structured actions, explicit conversation
   selection and retained original transport facts. Accepted records retain
   source/route and operation-authorization provenance.
2. Adapter, identity lookup and input-claim failures have explicit graph exits.
   A missing verified reply destination terminates locally; uncertainty about
   acceptance is not represented as a known rejection.
3. Safe checkpoint handoffs select Prepare, Controls or Settle directly. They
   preserve the recorded turn/round and bypass fresh Start initialization.
4. WhatsApp output delivery observations bypass ordinary input admission and
   require saved outbound-message correlation. Delivery does not rerun the agent.
5. Tool arguments and success values are tool-defined JSON, rather than being
   limited to the example calculator. Exact argument validation belongs to the
   selected tool registry.
6. Repeated-round examples retain tool results and counters. Provider retry
   retains the logical round; a corrected replacement call has its own call ID.

## Tool execution baseline clarification

The Execute tool batch contract requires bounded concurrent execution of
independent eligible calls. Dependent or conflicting operations retain their
required order. Results retain call IDs regardless of completion order, and
required started work settles before the next model round. Context publishes the
same versioned definitions that Tools resolves; visibility cannot grant permission.
The scheduling enum describes supported policy choices, not a sequential default.
Current reference examples and playback do not establish concurrent execution.

Validation, permissions, result matching, cancellation accounting and uncertain
effect handling are correctness requirements. Concurrency limits and scheduling
among eligible calls are policy comparisons. Tool discovery, granularity and
result representation are candidate experiments with task-dependent trade-offs.
Caching and retries require freshness and effect rules before any comparison.

## Precision and remaining limits

Schemas express structure, discriminators and local constraints. Rules express
cross-record checks such as matching a fence, comparing counters against a
configured limit, authorizing the original conversation, and pairing every tool
result with its requested call. Structural validation does not prove those
checks happen in a runtime. Producer-derived input unions prevent undocumented
payload renaming; their compatibility is defined by construction, not proof of
independently implemented consumers.

Example timeouts, limits and policy references illustrate configuration fields;
they are not all agreed defaults. Callback verification, channel-post/edit
policies, queue persistence, active cancellation, approval-wait resumption,
checkpoint safety and durable settlement remain proposed or deferred. Local
waiting outputs have no invented operational continuation. Empty future blocks
have no invented contracts.

The maintained registry is separate from the version-1 saved layout. Save and
Export retain their existing architecture-document format; they do not persist
or export this contract registry. Update contracts in code when revising the
design. Simulation still uses its existing deterministic fixtures and does not
execute these schemas. Model playback separately exposes its current synthetic
request, draft buffers and normalized outcome; these are reducer state, not the
selected inspector reference example or a real provider exchange.

## Files and validation

Definitions live beside the feature under
`apps/web/src/features/lina/contracts/`. `schema.ts` defines the limited schema
vocabulary, `shared.ts` defines reused handoff records, and the admission,
failure, input-execution and turn-execution files describe node responsibilities.
`nodeContracts.ts` assembles incoming variants from maintained edges.

To change a node, update its output definitions and branch conditions, input
context/examples, state rules and any affected connections. Keep distinct
semantics as separate variants, not optional fields that permit contradictory
states. The focused tests require every maintained node and connection to have
a contract and validate input/output examples, provenance and important
counter/operation distinctions.

```sh
pnpm --filter @agent-harness-lab/studio-api exec tsx --test ../web/tests/linaContracts.test.ts ../web/tests/linaArchitecture.test.ts ../web/tests/linaSimulation.test.ts
pnpm --filter @agent-harness-lab/web typecheck
```

Tests use a test-only checker for the explicitly supported schema vocabulary.
Independent standard JSON Schema validation and live inspector/playback checks
were also run during implementation. No production validator dependency was
introduced.


Implementation verification covered 40 nodes, all 89 maintained connections and
449 input/output reference examples using an independent JSON Schema validator.
The focused suite passed 45 tests. Live browser checks visited every node,
selected 226 example variants, expanded JSON schemas/rules, inspected the
WhatsApp receipt connection and completed Telegram correction playback in both
modes. TypeScript and the production build passed. These checks establish design
coverage and UI behavior, not real adapter, model or tool execution.

## Context block extension

The registry now also covers the ten Context nodes. These contracts distinguish
source records, staged model-visible projections, source/selection manifests,
estimated budget checks, pruning, request-local summary work and immutable
snapshot references. Reference examples include missing optional/required
sources, linked tool feedback, masked observations, retained protected groups,
summary failure/cancellation and invalid/oversized context.

Prepare round requests Context when its snapshot is absent or invalid, and
rechecks authority when the ready snapshot returns. Continued model-request
examples pair assistant calls with tool results. The earlier validation counts
above describe the original forty-node review; updated verification is recorded
in the [Context implementation checklist](../../../development/implementation-plans/studio/completed/lina-context-block.md).

These contracts remain reference fixtures; they do not perform retrieval,
summarization, token counting or provider execution. See the
[Context research](context-research.md) for the distinction between canonical
history and request projection, source studies and future experiment controls.

## Tools setup and credential contracts

The maintained Tools registry adds connection, credential, plugin, skill,
capability-registration and tool-call definitions. Startup/configuration, OAuth
callback references, connection observations, plugin lifecycle and skill requests
have explicit external inputs. Cross-block inputs still derive from their producer
outputs without field renaming.

Connection schemas distinguish local stdio, remote MCP HTTP and native adapters.
Credential schemas describe scoped references, validity metadata, private exchange
references and lifecycle acknowledgements. Secrets remain outside model-visible
node records. Authentication readiness does not grant operation permission.

Execution examples describe validation and permission outcomes, bounded parallel
scheduling, dispatch, joined results and uncertain-effect reconciliation. They
preserve original call/turn/round identities and distinguish catalog/schema/account
binding from a provider-safe model name. Registry and Context projections retain
catalog revisions; skills expose metadata, activated instructions and resources
as different payloads. Plugins expose declared contributions and lifecycle changes.

These are provisional JSON Schema contracts and reference examples, not executable
credential storage, transport conformance or runtime scheduling. Current scripted
simulation traverses the detailed Tools path with retained operations rather than
the original summary bypass. The [Tools checklist](../../../development/implementation-plans/studio/completed/lina-tools-nodes.md)
records the delivered graph scope and verification.

## Populated-block revisit (2026-10-08)

That review covered 87 nodes with 907 validated reference examples. The added
boundaries are Execution wait/cancel, Context scope/observations, and Tools
resource-read/prompt-get/hooks/retry. Reconciliation retains its stable ID and
moves to Execution. Contracts distinguish permission decisions from credential
readiness, exact binding/catalog generations, skill activation provenance, rich
results and preserved artifact references. Plugin load stages contributions;
activation publishes them. Hook mutations are checked before admission.

Behavioral checks cover parallel/ordered calls, mixed results, retained waits,
wrong-account responses, safe retries and uncertain writes. Auto/Next and Stop
use fixture events; these checks do not establish real adapter, storage or
provider guarantees. See the [completed checklist](../../../development/implementation-plans/studio/completed/lina-current-block-revisit.md).

## Model Interface extension

Four Model nodes extend the maintained registry to 91 nodes and 221 connections.
Producer-derived handoffs distinguish metadata-only capabilities, invocation
intent, faithful request encoding, stream progress, local settlement and normalized
outcomes. Call model delegates through the Model block; the direct model-to-decision
summary bypass is retired.

Model records include scoped binding and capability revisions, effective budget
settings, snapshot identity, original/projected tool-schema evidence and opaque
continuation references. JSON syntax checks do not grant tool permission or prove
registered schema validity. Complete unknown tool names remain resolvable requests
that Tools can reject; truncated/malformed calls cannot be dispatched.

Readiness unions distinguish Model work from tool batches and acquisitions. Stop
before launch invalidates the retained intent; an active attempt keeps separate
local-settlement and remote-status evidence. Usage records distinguish reported,
partial and unavailable observations, retain native accounting semantics and avoid
adding cumulative updates twice.

Reference examples cover protocol variants, interleaving, refusal/filtering, empty
content, unsupported requirements, binding/size changes, auth mismatch/expiry,
post-preview failures, HTTP 200 errors, cancellation and late/superseded events.
The fake protocol engine exposes current fixture state separately from these
inspector examples. It preserves actual retained sibling tool history; no prior
call/result group is fabricated for the first request.

These remain provisional design contracts and deterministic playback. Live SDKs,
credential backends, production capability/token checks and hosted-provider tools
are deferred. The [Model checklist](../../../development/implementation-plans/studio/completed/lina-model-interface.md)
records the completion gate and validation evidence for this slice.


## State contract extension

The State slice adds four provisional contracts and requester-specific variants
for all 61 connections. Sixteen tagged record families separate receipts, queue
custody, ownership, waits, grants/reservations, operation intent/result, Stop,
history, snapshots, deliveries, children and transaction evidence. A checkpoint
manifest carries exact record revisions and safe continuation references.

Commit, duplicate, conflict, failure and unknown outcomes remain explicit.
Lost-acknowledgment inspection retains the original transaction identity and
fingerprint. Recovery plans preserve work identity and return to Input recovery.
The contract registry validates 1,940 context/input/output examples across 100
nodes. These schemas describe a design model; they are not live backend formats.
See the [State checklist](../../../development/implementation-plans/studio/completed/lina-state-persistence.md).


## Memory contract extension

The Memory slice adds twelve provisional node contracts and typed handoffs for
87 relationships. Four namespaces carry explicit requester access. Recall queries,
selected evidence, captured sources, candidate proposals, reviewed mutation plans,
transaction receipts, index watermarks, maintenance jobs and cleanup coverage
remain distinct records. State requests describe the exact phase payload; a read
cannot carry an admitted mutation. Lost acknowledgments reuse the original
transaction identity and fingerprint before considering another write.

Contracts cover explicit search, conservative automatic candidates, auxiliary Model
purposes and budgets, parent-reviewed child publication, temporal corrections,
unresolved conflicts, cancellation and lineage-aware forgetting. Immediate recall
revocation differs from purge completion; pending work and caches cannot silently
resurrect revoked knowledge. Context selection differs from index visibility and
storage acknowledgment.

The Memory slice brought the graph to 112 nodes, 400 relationships and 112 contracts, with
2,422 context/input/output examples. These remain reference JSON schemas and
examples, distinct from current playback evidence and future runtime storage.
See the [Memory checklist](../../../development/implementation-plans/studio/completed/lina-memory-block.md).

## Subagents contract extension

Eight provisional contracts describe delegation validation, immutable task packets,
launch identity, coordination, join sets, cancellation, reconciliation and result
return. Every one of the 77 new relationships has a typed producer payload and
example. Child internal-origin turns carry agent/session/task/parent identity and
separate counters; main-only delivery and queue release remain distinct routes.

Requested worker profiles bind model/tool/skill/connector/account/Memory/environment
references under admitted authority. Fresh, selected and transcript-fork inputs
preserve source provenance and complete call/result groups without inheriting
credentials or opaque provider continuation. Persistent session follow-up has a
new task and serialized turn. Attached/detached ownership is independent of parent
waiting; detached work names a supervisor and closure policy.

Sixteen State request/reply pairs preserve original phase transactions for capacity,
packet/session reads, launch intent/inspection, lifecycle events, joins, cancellation,
recovery evidence and parent result delivery. Refusal and unknown startup cannot
become launch permission. Join expiry, cancellation signal and persisted intent
retain their precise limits; neither proves remote effect completion.

At the Subagents milestone, the registry had 120 contracts, 1,352 input examples and 1,300 output
examples across 477 graph relationships. The full contract suite validates these
JSON examples and producer coverage. Contracts remain reference design fixtures;
they are not runtime schemas validated against real child processes.


## Planning and task management contracts

Planning adds eight contracts and 66 relationships, bringing the maintained graph to
128 nodes and 543 relationships. Typed plan commands carry scope, expected revision,
original operation identity, task dependencies, attempt bindings and evidence
assessments. Producer-derived State, Context, Tools and Subagents handoffs preserve
the requesting owner. Plan review does not grant action permission.

The reference schemas describe richer runtime boundaries than the small deterministic
playback records. Authored workflow playback uses a fixed configured template; it is
not a generic graph compiler. See the [completed Planning checklist](../../../development/implementation-plans/studio/completed/lina-planning-block.md)
for verified behavior and limits.
