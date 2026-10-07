# Lina node contracts and reference examples

Every maintained Input and Turn Execution node has a provisional contract in the
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
execute these schemas or show live per-step payloads.

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
