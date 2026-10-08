# Lina architecture revisit proposal

Status: current-block updates complete; remaining block development pending. Planning is required future work; Computer Use is deferred by user decision on 2026-10-08.
Reviewed 2026-10-08 against the working-tree design at
`53bc4a234f8c3cf4c2e7266de4a2e82973090028`. Existing uncommitted Lina and
unrelated platform/evaluation changes were preserved.

## Purpose and recommendation

Bring every Lina block to a consistent level of architectural detail after
the expanded Tools work. Preserve the existing loop and component boundaries.
Repair their handoffs, then develop the still-empty blocks in separate slices.

The original audit baseline had 79 nodes and 162 edges across Input, Turn Execution,
Context and Tools. The completed populated-block slice has 87 nodes and 201 edges;
Subagents now also has an empty reserved region. Their absence is distinct from a defect in an existing block.

The proposal adds eight nodes to populated blocks and specifies 35 candidate
nodes for the remaining blocks, including Subagents. If all are accepted, the
design has 122 nodes across 14 blocks. That is a proposal inventory, not a
recommendation to show or implement everything at once. Start with the eight
additions and the contract repairs, using collapsed block views and scoped
inspection to keep the graph usable.

This document is the integration authority. Supporting audits explain evidence,
per-node fields, examples and cases:

- [Input and Turn Execution](../../../../docs/research/lina/revisit-input-execution.md)
- [Context](../../../../docs/research/lina/revisit-context.md)
- [Tools](../../../../docs/research/lina/revisit-tools.md)
- [Remaining blocks and Subagents](../../../../docs/research/lina/revisit-planned-blocks.md)

The accompanying [graph change manifest](lina-cross-block-revisit.graph.json)
lists exact proposed IDs, node titles, cross-block route endpoints and changes
to existing arrows. It is review data, not a file loaded by Studio. The field
specifications in the audits are sufficient to write provisional graph contracts;
selected provider/storage implementations still require their own exact wire
schemas. Nothing here claims runtime interoperability or measured performance.

## Findings that change the existing design

1. Context loses catalog revision/schema/binding identity supplied by Tools.
   The catalog projection example also drops the registered search argument's
   `minLength: 1`. Preserve the schema or declare an explicit provider projection.
2. Producer-derived input unions validate separate incoming event shapes, but
   do not establish a coherently merged Context candidate. Source contributions
   need preparation correlation and staging.
3. Plugin load outputs include active contribution names despite the loaded
   contribution being inactive. Stage all contribution kinds until activation;
   registration cannot expose executable candidates early.
4. Tool waiting and cancellation have contracts in prose but no complete visible
   coordination paths. Reconciliation belongs to execution lifecycle, although
   its node currently sits in Input.
5. Playback follows a precomputed single route. It cannot yet show overlapping
   calls, sibling completion during a wait or controls changing active work.
6. Existing descriptions delegate to Safety, State, Model and Environment, but
   those blocks have no graph endpoints. Their responsibilities need explicit
   boundaries before the design can become a real implementation.

These are local audit findings. The upstream comparisons support the underlying
responsibilities, not these exact node names or one universal decomposition.

## Block-by-block changes

IDs in the node lists below have the indicated `lina-<block>-` prefix.
Supporting audits give their record fields and representative JSON.

| Block | Additions | Updates and boundary |
| --- | --- | --- |
| Input | None. Move existing `lina-input-reconcile` visually to Turn Execution, preserving its ID. | Typed channel/account readiness; scoped admission/control decisions; exact answer correlation; State-backed receipt/queue/checkpoint records; delivery gateway. Keep existing CLI, Telegram and WhatsApp variants. |
| Turn Execution | `wait`: Await external work. `cancel`: Cancel active work. | Delegate complete batches; retain sibling results through waits; separate tool errors from controller failure; bind Context revisions; record settlement failures and owner mismatches; reconciled results return to Tools publication. |
| Context | `scope`: Bind context scope. `observations`: Shape observations. | Update all ten existing nodes for agent/source scope, staged dependencies, instruction provenance, exact catalog, rich outcomes, generation checks and bounded reprepare. |
| Tools | `resource-read`: Read selected connector resources. `prompt-get`: Get selected connector prompt. `hooks`: Apply declared plugin hooks. `retry`: Decide bounded adapter retry. | Repair staged plugin activation and catalog fidelity. Add explicit Safety, Environment, State, wait and retry handoffs. Preserve all 29 current nodes and protected credential ownership. |
| Model Interface | `resolve`, `encode`, `invoke`, `normalize`. | Resolve settings/capabilities, encode the snapshot, own one provider attempt including streaming/cancellation, normalize terminal responses. Execution decides retries and continuation. |
| Safety and permissions | `policy`, `evaluate`, `approval`, `grants`, `authorize`. | Resolve rules, evaluate exact operations, correlate four-choice review, manage scoped grants and recheck live dispatch authority. See the completed dedicated Safety slice. |
| Execution Environment | `bind`, `run`, `release`. | Bind configured process/filesystem/network/browser resources; execute environment-backed work; release or retain owned resources. No implied sandbox guarantee. |
| Output and delivery | `prepare`, `record`, `send`, `reconcile`. | Destination formatting, recorded delivery intent, scoped send and acknowledgement handling. Input delivery becomes a gateway; unknown acknowledgement does not authorize resend. |
| State, persistence and recovery | `load`, `record`, `checkpoint`, `recover`. | Versioned reads/writes, coherent checkpoints and classified resume plans. Preserve unresolved effects and owner fencing. Store safe credential references, never credential material. |
| Observability | `record`, `project`, `export`. | Capture correlated events, show active/waiting operations and export inspectable simulated evidence. Observation does not decide execution. |
| Subagents, new region | `validate`, `prepare`, `launch`, `coordinate`, `return`. | Explicit spawn admission, isolated task packet, reused child harness, bounded coordination and returned results. Initial registered spawn tool joins the required child result. |
| Memory | `scope`, `query`, `retrieve`, `select`, `capture`, `extract`, `validate`, `resolve`, `commit`, `index`, `consolidate`, `forget`. | Implemented design slice superseding the original four-node sketch: scoped recall, source-backed candidates, reviewed versioned mutations, index visibility and tracked forgetting. Context retains the final model budget. |
| Computer Use, deferred | `bind`, `observe`, `act`. | Adapter-specific target, fresh observation and authorized action. Tools owns call accounting; Environment hosts resources. |
| Planning, required capability | `update`, `select`. | Explicit plan revisions and ready-step selection. Ordinary turns may bypass Planning. These nodes alone do not implement a graph workflow coordinator. |

The future blocks are new design work. Their compact nodes can expose substages
in inspector JSON without turning every field check into another canvas box.
Storage choice, retrieval algorithms and workflow coordinators remain open
implementation choices, with alternatives documented before runtime adoption.

## Integration decisions

### One execution path and explicit dependency edges

Distinguish graph arrows as `transition`, `request`, `return`, `contribution`,
`control` or `observation` in proposal metadata and the inspector. A catalog
contribution is not a command to jump directly into the middle of Context.
Observability subscriptions do not add a serial execution step.

For the initial repair, route catalog, activated-skill and skill-resource
contributions into Context load staging. Scope is bound before material is read
or included. Load produces one candidate with a generation vector; instructions,
history, task, tool definitions and observations then transform that candidate.
Versioned setup inventories can be coordinator dependencies without a turn ID;
load binds them to a specific preparation before use.

The manifest has exact route identities. Its proposed routes are illustrative
executable branches only after their owners exist. Do not add arrows that end in
empty regions or label them implemented. All unchanged current edges remain;
each explicit replaced/retargeted edge is migrated with a contract update.
Block grouping must use declared membership for the relocated reconciliation
node, rather than assuming its preserved `lina-input-` ID means Input ownership.

### Waiting and cancellation

Input verifies a responder and matches a pending prompt. The sole approval path
is Input prompt → Execution wait → Tools permissions → Safety approval.
Safety grants or denies the exact operation; Tools resumes admission.
There is no parallel Input-to-Safety route that could apply an answer twice.
Register the retained wait before delivering its prompt. Denied/evaluation-failed
decisions still return to the exact requester through authorization without
creating a grant. A wait's expiry affects its own operation; it does not stop
unrelated siblings.

Connection authorization completes through its verified callback owner. Once
a call wait exists, auth readiness goes to Execution wait, which resumes the
original request through resolution/validation/permission checks. Startup
readiness still goes to connection opening. Supported protocol input
continuations preserve the same logical operation and continuation identity.

Stop latches the turn state and prevents fresh launches. Execution signals the
active Model/Tools/child owners, then collects known outcomes or retains
reconciliation. Model invoke accepts a cancellation input; it does not start a
second request. Pause controls playback only. It never represents agent Stop.

### Persistence, effects and delivery

State writes return a correlated acknowledgement to the requesting owner. A
write is not automatically a checkpoint. Execution requests coherent checkpoints
and decides whether settlement/release is permitted under the selected profile.
Tools and Output request intent acknowledgement before effects when that profile
requires it. Model retries, safe tool retries and delivery retries have separate
attempt identities and policies.

Unknown effects preserve their original identities and successful siblings.
No checkpoint, cancellation request or operator acknowledgement converts an
unknown write into known success. Reconciliation requires actual effect evidence.
If later policy permits ownership transfer or abandonment, model it separately.

Execution completion and external delivery completion remain separate. Output
owns the send lifecycle and account-scoped receipts. Input delivery forwards
requests and accepts receipts using a direction discriminator, preventing a
receipt from becoming another send request.

### Children reuse the harness

The [dedicated Subagents research proposal](../../../../docs/research/lina/subagents-research.md)
now refines this earlier five-node sketch into eight responsibilities. It is
pending review, with no Subagents implementation change. Use its current-owner
audit when specifying the next slice.

A registered spawn tool enters Subagents. The parent supplies a task and selected
context; admission computes effective tool/memory/model/environment limits under
existing authority. The initial child has fresh history and explicit shared
namespace access. It uses the same Execution, Context, Model and Tools nodes
with its own agent/turn IDs. Inspecting a child selects that instance's trace;
it does not duplicate the whole canvas.

Child settlement returns to the Subagents coordinator rather than external user
delivery. Children release their own ownership before required parent work is
joined. Child-private history does not enter the parent automatically. Detached
agents, recursive delegation and transcript forks remain later choices.
The existing settlement-to-delivery and owner-release-to-queue arrows become
external/conversation-origin-only. Child refusal and preparation/launch failure
return a terminal spawn result even when no child instance was created.

### Scoped external context and extensions

Selected MCP resources/prompts are acquisition subrequests owned by Tools and
join the same preparation when complete. Context keeps their source roles and
trust; acquiring a prompt does not grant system-instruction authority. The
[resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
supports treating this as a distinct capability. Prompt-role evidence currently
uses the explicitly labeled legacy reference in the Context audit because the
current prompt page could not be retrieved.

Skill inventory, activation and resource loading stay separate, consistent with
the [Agent Skills specification](https://agentskills.io/specification).
Selected instructions carry precedence, activation ID and source revision.
Argument hooks run before final validation/digests; context hooks run after
observation shaping, then budget and validation. A recorded hook invocation runs
once per incoming candidate generation; reductions do not invoke it repeatedly.
Extensions cannot create grants by changing a context projection.

Context requests model capabilities through a metadata-only Model resolution
branch before budgeting its first round. That branch cannot invoke the provider.
Resource and prompt acquisition also have explicit Safety request/return paths.
Their auth waits resume the dependency owner, rather than Tools call resolution.
Output owns retained delivery-account waits after a turn finishes; those waits
return to the existing send attempt and do not create another agent turn.

## Contract specification for graph implementation

Use existing `{kind, payload}` producer outputs and
`{event, context}` consumer inputs. Every new node requires complete JSON Schema
2020-12 input/output variants and paired examples in the same collapsible,
syntax-colored inspector used today. Use exact predecessor payloads instead
of independently reconstructing consumer examples.

| Record | Required information |
| --- | --- |
| Execution identity | agent, turn, logical round, owner/fence revision; parent IDs only for children |
| Operation identity | operation/call ID, batch ID where applicable, attempt ID, owning node and original request reference |
| Binding | catalog/schema revision and digest, adapter/connection/account, readiness generation, policy/argument digest |
| Context candidate | preparation ID/revision, scoped history/source manifest, selected contributions, generation vector, model capability revision |
| Wait | wait ID/kind, owning operation/node, answer schema/private reference, eligible responder, expiry, continuation reference, retained siblings |
| Outcome | terminal versus progress, known status versus uncertain effect, safe content/artifact refs, original provider evidence, retry eligibility |
| Persistence | requested record/checkpoint, expected/current revision, deduplication identity, applied/conflict/failed/unknown acknowledgement |
| Trace | event ID/sequence, run/agent/operation correlation, source kind `design-simulation` versus real execution, fixture configuration/revision |

Fields apply to the operation kinds that own them; do not force a resource read
or output receipt into an artificial tool-call record. For each node, the
supporting audits list its concrete input and output fields, error branches and
example shapes. Wire encoding and provider credentials remain adapter-private.

In addition to schema validation, check semantic equality across handoffs. A
string type cannot prove that call IDs, argument digests, owner scopes or source
revisions match. These checks are part of graph contract verification.

## Simulation implementation

Replace the single-route fixture compiler with a deterministic event reducer.
Keep scenario configuration separate from simulation state. State holds active
operations, waits, settled results, pending effects, stop state and counters.
Both Next and Auto apply the same next fixture event. Auto pauses at a required
external-input event; the configured answer/callback resumes the retained work.
Manual graph following remains a viewing setting.

A simulation step can launch two calls before either completes. The graph shows
both operation identities at the same node or along concurrent branches, then
shows completion in the fixture's order. The model continues only after required
work joins. Displayed concurrency demonstrates the proposed model of execution,
not actual remote overlap or measured latency.

Run keeps one settings modal. Start with channel and the existing cases, then
progressively disclose tool batch, wait answer, cancellation point, source change
and child settings as their graph slices become available. No message text or
credentials are needed. In-run actions supply simulated answer/Stop events.

## Ordered implementation checklist

### 1. Repair the populated blocks

- [x] Fix catalog projection fidelity and plugin staging before extending examples.
- [x] Add Execution wait/cancel and relocate reconciliation with ID preserved.
- [x] Add Context scope/observations and all existing-node field updates.
- [x] Add Tools resource-read/prompt-get/hooks/retry and their waits/failures.
- [x] Route contributions through Context load; bound reprepare/reduction/retry separately.
- [x] Update Input binding, admission, prompt, queue, checkpoint and delivery contracts.
- [x] Preserve saved positions, user notes/status, custom nodes and custom edges.
- [x] Introduce deterministic active-work playback and retire the tool-summary bypass only after parity checks.
- [x] Verify every existing execution/context case still works in Auto and Next.

### 2. Make existing delegated boundaries visible

- [x] Add Model's four nodes with complete terminal/fragment/cancellation examples.
- [x] Add Safety's five researched nodes and exact operation-bound approval paths. See the [completed Safety checklist](../completed/lina-safety-permissions.md).
- [ ] Add Environment's three nodes with honest local/isolated profiles and lifecycle.
- [x] Add State's four nodes and requester-correlated write/checkpoint acknowledgements. See the [State slice](../completed/lina-state-persistence.md).
- [ ] Add Output's four nodes and make Input delivery a request/receipt gateway.
- [ ] Add Observability's three nodes alongside concurrent playback, not afterward.
- [ ] Extend graph simulation through these owners, including refusal/unavailable/unknown outcomes.

These are design slices. State and Environment need only explicit fixture
profiles initially; choosing a production backend is separate work.

### 3. Add delegation and memory

- [ ] Add a Subagents region and five nodes using isolated selected task packets.
- [ ] Register a spawn operation and join returned child results through Tools.
- [ ] Reuse the same harness graph with per-agent inspection and scoped controls.
- [x] Add Memory's twelve researched nodes, scoped recall, candidate admission, versioned correction and tracked forgetting. See the [Memory slice](../completed/lina-memory-block.md).
- [ ] Verify private/shared namespaces, child failure, cancellation and unknown effects.
- [x] Keep Memory retrieval/write strategies configurable inside these boundaries; the baseline is a design fixture, not a selected production backend.

### 4. Required planning and deferred branches

- [ ] Deferred: revisit Computer Use later, then choose actual adapter capabilities.
- [ ] Add required Planning capability for explicit plan state; simple turns may bypass plan creation.
- [ ] Research/specify a graph workflow coordinator separately before presenting it as an alternative execution strategy.

### 5. Verification and documentation

- [ ] Every graph node has contracts, readable purpose and paired examples.
- [ ] Every transition/request/return has declared producer output and matching consumer input.
- [ ] Schema examples validate; semantic tests check identity/revision/provenance across handoffs.
- [ ] Independent calls overlap; conflicts serialize; mixed outcomes preserve siblings.
- [ ] Wait approve/deny/expire/stale variants retain the same turn and operation.
- [ ] Stop prevents launch, joins active work and never invents rollback.
- [ ] Unknown write/send acknowledgement blocks unsafe replay; required persistence failure blocks clean settlement.
- [ ] Context revision changes cause bounded reprepare without counter resets.
- [ ] Children have isolated histories and explicit shared access; parent joins required work.
- [ ] Auto/Next yield equal semantic state for identical fixture events; Pause differs from Stop.
- [ ] Browser inspection verifies reachable paths, branch highlights, collapsible JSON and saved-layout migration.
- [ ] Update local README, node-contract guide, research implementation status and checklist indexes.

## Files and verification for the later implementation

Extend the four existing block modules and their contract modules. Introduce one
block module and focused contract module per accepted new area. Keep provider
adapters and actual persistence outside `apps/web/src/features/lina`; this UI
owns the design document and simulation.

Update `architectureDocument.ts`, `plannedBlocks.ts`, `LinaPage.tsx`,
`inputSimulation.ts`, `LinaSimulation.tsx` and their focused tests. Extract the
event reducer when concurrency justifies a separate module; do not introduce a
general workflow engine just to animate fixtures.

Start with the existing architecture/contracts/simulation tests:

```sh
pnpm --filter @agent-harness-lab/studio-api exec tsx --test \
  ../web/tests/linaArchitecture.test.ts \
  ../web/tests/linaContracts.test.ts \
  ../web/tests/linaToolsContracts.test.ts \
  ../web/tests/linaSimulation.test.ts
pnpm --filter @agent-harness-lab/web build
```

Add meaningful multi-operation and cross-record assertions. Use a standard
JSON Schema validator for all examples and inspect the live graph in both
playback modes. Those are implementation acceptance checks, not checks claimed
to have run for this document-only proposal.

## Proposal validation and limits

For this audit, the current graph inventory was loaded from the actual module;
all 14 block areas were reviewed; supporting JSON examples, local links and
the proposed manifest endpoints were checked. The original audit did not edit app or runtime files. The approved current-block
slice subsequently updated the graph and simulation, as recorded below. Empty-block
development remains a later slice.

This specifies graph responsibilities and baseline scripted cases. It does not
choose a production memory index, credential vault, isolation platform or full
provider wire schema. It does not claim exhaustive agent paths, durable
execution, actual concurrent adapters or performance improvements.

## Current-block implementation status

The approved first slice is complete: Input, Turn Execution, Context and Tools
now contain the eight additions, updated contracts and detailed event-based
simulation. Planning is required future work; Computer Use is deferred. The
remaining block checklists above remain pending. See the
[completed slice and validation](../completed/lina-current-block-revisit.md).

## Model Interface next-block authority

The [completed Model Interface plan](../completed/lina-model-interface.md) now refines the
earlier Model sketch with provider/agent source research, metadata preparation,
encoding fidelity, stream finalization, cancellation and shared auth paths. Use
the completed plan and its contract fixtures for the implemented Model slice. Its four nodes, connected playback and contracts are complete. Other remaining blocks retain their pending checklists.


## Safety slice authority

The [dedicated Safety implementation](../completed/lina-safety-permissions.md)
expands the earlier three-node proposal with policy resolution and grant management.
Five nodes, four review choices, JSON contracts and fixture playback are implemented.
Other remaining blocks stay pending. Fixture grant acknowledgments do not establish
live durable storage or production authorization guarantees.


## State slice authority

The [dedicated State implementation](../completed/lina-state-persistence.md)
retains four nodes with explicit owner commands, operation evidence, versioned
checkpoints and classified recovery. JSON contracts and deterministic playback
are implemented. The State slice brought the graph to 100 nodes and 313 edges. Storage is a fixture;
production backend durability and external effect guarantees remain unimplemented.
Other pending blocks keep their own checklists.


## Memory slice authority

The [dedicated Memory implementation](../completed/lina-memory-block.md)
supersedes the earlier four-node Memory sketch with twelve researched
responsibilities and 87 connections. Private-by-default namespaces, conservative
automatic candidate admission, parent-reviewed shared child contributions,
versioned correction, separate index readiness and immediate recall exclusion
with tracked deletion coverage are the accepted baseline. Recall, mutation,
maintenance and forgetting are branches, not an obligatory twelve-step chain.

The maintained architecture now has 112 nodes, 400 edges and 112 typed node
contracts. Memory supplies JSON schemas/examples and deterministic Auto/Next
playback. The still-pending Subagents checklist includes actual child execution;
Memory's child-access/publication contracts do not implement that runtime.
No live backend, embedding service, actual memory-model work, background daemon,
production erasure guarantee or measured retrieval advantage is established.
