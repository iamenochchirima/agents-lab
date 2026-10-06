# Waku Agent system explorer — source study

This study supports the Studio Waku surface map. It describes a source snapshot,
not a measured execution, benchmark or production-readiness assessment. Open the
**Waku Agent** explorer in Studio to inspect source-linked nodes and connections.
The six traces assume outcomes so that a learner can follow a branch; they do not
invoke Waku, providers, external tools or evaluation suites.

## Snapshot and evidence

- Repository: [ShenSeanChen/waku-agent](https://github.com/ShenSeanChen/waku-agent).
- Commit: `24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01`.
- Local checkout was clean when inspected.
- Source map: `apps/web/src/features/system-explorer/data/waku.ts`.
- 124 nodes, 191 relationships, 14 regions and six illustrative traces.
- Source anchors identify real definitions; edge anchors identify caller, reader,
  writer or topology declaration. A topology declaration describes a relationship
  the engine executes, rather than claiming a node function calls its successor.

Code takes precedence over README/architecture statements when they disagree.
Only source files, public repository documentation and package configuration were
read. Runtime home directories, private configuration and credentials were not
read. No source-repository edits, provider calls, subprocess delegation or evals
were performed.

## Coverage plan

| Region | Included owners and relationships |
| --- | --- |
| Entry points and gateways | Main dispatcher; CLI; HTTP/SSE dashboard; Telegram, Discord, WhatsApp; voice transcription/speech; per-gateway runner and reply delivery; gateway supervisor; external-cron briefing entry |
| Assembly and configuration | Settings/home precedence; Waku construction; state.db migrations; model client; Memory; tool registration; Session; MCP cleanup |
| Browser session lifecycle | Locked shared singleton; recent session identifier selection; idle rotation; new/switch/history actions; explicit transcript hydration; integration-triggered rebuild |
| Turn orchestration | `respond`, composed observers, optional triage switch, ordinary full turn and graph fallback |
| Working memory | Editable SOUL.md; local clock/model identity; gated facts/episodes; keyword-matched skills; configured transcript window |
| Memory retrieval and stores | Retrieval judge; FTS5 default facts; optional Supabase/Mem0/Zep/LangMem; SQLite or Notion episodes; optional Jev slot filtering; procedural skill installation/export |
| Model/tool loop | Stream capability choice; text deltas; nonstreaming fallback; appended assistant blocks; tool-use decision; sequential execution/results; repeated iteration; natural completion and iteration cap |
| Providers | TOML registry; default model pair and endpoint/credential rules; Anthropic SDK; OpenAI wire conversion and specific parameter fallback |
| Tools and side effects | Schemas/dispatch; local event deduplication, SQLite/ICS and optional calendar mirrors; note facts; draft message outbox; web search; optional Apple/GitHub; memory administration; persona/skill writing; explicit experimental stubs |
| MCP and delegation | Bridge startup, transport selection, namespaced calls; Waku Memory sender; opt-in pi coding subprocess, events/deadline/cost; scratch workspace artifacts and autorun |
| Persistence/consolidation | Completed exchange records and tool-history summary; chat_log commit; cross-session unconsolidated batch; small-model extraction; optional keep gate; fact/episode writes; remote pending-send behavior; markdown mirror |
| Optional graph execution | Dependency waves, parallel disjoint writes and limits; triage classify/calendar fan-out and gather barrier; quick versus unchanged full loop; explicit slash workflow; gather four scans, synthesis barrier and propose/quiet router |
| Operations/evaluation | JSONL traces; event-derived usage; optional OTel; dashboard store/evidence reads; integration and settings changes; separate compare/memory/judgment arenas; developer release gate |
| Hosted deployment | Separately licensed gateway identity/policy, launcher/spawner Docker runtime, tenant forwarding, stock dashboard, platform admission/metering/upstream and ledger |

The map separates a code component, a conditional decision, an execution state,
a store and an external dependency. Several states link to one owner function:
`run_loop`, for example, owns both tool detection and result appending. Splitting
those states teaches behavior without inventing extra implementation modules.

## Defaults that change the shape

[Settings](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/config.py#L130)
selects Anthropic unless configured otherwise. Provider registry resolves the
specific full/small model pair. The default loop has ten iterations, an 8192 output
token ceiling and twelve prior exchanges in its prompt window. Memory retrieves
up to four facts plus up to three episodes when the judge selects retrieval;
consolidation is due after six new exchanges across chat sessions.

Default semantic and episodic stores are SQLite. Graph workflow routing,
experimental tools, Apple tools/calendar mirrors, Google write-through and
model-accessible GitHub are opt-in. MCP tools require home/mcp.json and the MCP
extra. Jev retrieval/write filtering is opt-in. Web search defaults to
DuckDuckGo HTML and can use configured Tavily. `send_message` drafts to a local
outbox; gateway reply delivery is a separate integration capability.

Every full turn rebuilds its prompt and request-local messages, but the Waku,
Memory, registry and Session objects can live across many turns. Do not interpret
"ephemeral run" as constructing the entire harness for every incoming message.

## Ordering and failures worth inspecting together

### Ordinary turn

[Waku.respond](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/app.py#L46)
starts the tracer and optionally invokes triage. Otherwise `_run_full_turn`
constructs prompt/history and calls `run_loop`. Completed reply and tool activity
are added to session history and committed to chat_log. Consolidation and file
export happen before `respond` returns; trace end then records completion.

**Documentation discrepancy:** architecture prose calls consolidation
asynchronous, but this snapshot calls `maybe_consolidate` synchronously inside
`respond`. The map follows the invocation in code. Reply text may already have
streamed, but terminal completion still waits for post-loop work.

### Context and memory are separate controls

The default twelve-turn window is bounded transcript selection, not token-aware
compression. A positive `history_turns` sets this bound; zero is not validated and
Python `[-0:]` includes all available history. No generic summary compactor, model-context overflow recovery or
request admission budget is implemented in this plain loop. Retrieval judge
failure chooses retrieval using original message; a later store search failure
is not given the same broad catch by `gated_retrieve`. Skill matching happens
independently of the retrieval verdict.

With a remote fact backend, explicit `save_note` still inserts into local SQLite,
and `export_markdown` reads local SQLite facts/episodes. The map therefore does
not claim every adapter’s content is automatically mirrored in local markdown.

### Streaming is not general retry or cancellation

[run_loop](https://github.com/ShenSeanChen/waku-agent/blob/24b4cbb6d065e2cf31ca1ec0832918a1d1c08b01/waku/loop/agent.py#L59)
rethrows provider 4xx streaming errors. Other streaming exceptions fall back to
one create call. OpenAI compatibility separately retries when an error names the
max-token parameter. These are distinct from any retry behavior of the SDK.

A dashboard SSE client disconnect is caught when writing events; it does not
cancel the provider call, tool operation or turn. Do not interpret the browser
closing as cancellation. Provider failure can terminate the turn before a
completed exchange is committed; tool side effects already performed survive.

### Tools have different side-effect contracts

`ToolRegistry.execute` surfaces unknown-tool or callable exceptions as strings.
It does not implement centralized permission approval, argument schema
validation or a sandbox. Persona instructions such as asking before creating a
skill are instructions, not an enforced approval state machine.

Calendar creates commit a local event before appending ICS and attempting
configured external mirrors. Title/start deduplication prevents common repeated
bookings; it does not establish atomic multi-store commit. The loop executes a
provider’s requested tools sequentially. The prompt’s "at most once" instruction
is not a registry-enforced call counter.

Experimental `delegate_task` is implemented through external pi. Explicit cwd
works in the user project; omitted cwd creates a scratch workspace and may autorun
its selected generated entrypoint after delegation. This is not presented as a
general safety sandbox. `run_command`, `browse_web` and `schedule_task` are
coming-soon skeletons. Brief scheduling uses system cron; there is no implemented
internal heartbeat or cron scheduler to draw as an active component.

### Graphs genuinely branch and join

Triage’s classifier and local ICS read run in the same dependency wave. A barrier
waits for both before code chooses `quick_reply` or `full_agent`. The quick path
uses the small model without full memory/skill/system prompt or tool schemas.
The full path invokes the identical `_run_full_turn` used with graphs disabled.
An exception or missing graph answer triggers ordinary full-turn fallback;
this does not promise rollback of prior effects.

Gather has four parallel scans whose prefixed state keys are disjoint. Scan
wrappers return fallback data after failures, letting synthesis join complete.
One synthesis model call has no tools. Counts, not model prose, select a local
outbox draft or quiet completion. The engine catches node errors into state but
parallel output-key collisions raise `GraphStateCollision`; visits and total
steps are bounded. It is a deterministic workflow engine around the same loop,
not a claim of independently conversing peer agents.

### Persistence is completed-turn history, not durable execution

Full working-message mutations are request-local. `Session.add_exchange` stores
a reply plus compact tools-used record for later turns; it does not journal a
resumable instruction pointer after each action. Graph state also lives in the
in-memory run. Traces retain evidence, not a durable replay scheduler.

**Browser limitation:** `get_agent` and `rebuild` restore/preserve conversation
identifiers but do not invoke `Session.switch` to load prior transcript. Explicit
session switching does hydrate recent history. The UI can show persisted rows
without those rows automatically being present in a freshly built agent’s prompt.

Consolidation API failure or an unparseable summary leaves chat rows unconsolidated;
truncation alone is not checked. Stores commit independently: a later store error
can leave facts committed before chat rows are marked, permitting duplicates on
a later batch. Consolidation/export exceptions can prevent normal reply return
and trace completion after exchange persistence. Connected Waku Memory
sends are tracked as pending only for the SQLite fact store. A failed remote
send retains local facts and stops further sends that batch; pending retries
happen when a later batch is due. Other fact backends do not record that retry
state. These are explicit best-effort semantics, not exactly-once delivery.

### Evidence has limits

Runtime loop usage arrives through `llm` observer events; pi JSON usage is
appended separately. Direct small-model retrieval/triage/consolidation calls do
not emit those same `run_loop` events. The usage ledger is therefore not claimed
to measure every API call. Evaluation and arenas are explicit operator/developer
activities; the release gate is not a runtime approval checkpoint.

## Hosted boundary and source-document drift

`hosted/` contains implemented gateway, spawner and model-metering services even
though docs/status.md still says hosted code does not exist. The map follows the
present source. Tenant containers execute stock local dashboard/harness code;
operator identity, provisioning, quota, admission and billing surround it.
Tenant `usage.jsonl` and operator `ledger.db` have distinct owners and purposes.

Hosted code is **Elastic License 2.0**, excluded from wheel/sdist. The local
`waku/` code has its own package licensing; Waku brand/design assets have separate
restrictions. This explorer is a newly authored code study. It copies no Waku
brand assets, design-system styles or implementation into the laboratory.
Hosted network topology, firewall enforcement, backup operations and individual
quota/auth control internals are collapsed. Their presence is not evidence that
a particular deployed service is healthy or secure.

## Illustrative traces

1. **Browser reply, memory skipped:** graph off, gate skip, text response,
   consolidation not due.
2. **Tool round, local calendar:** retrieve facts, valid nonduplicate event,
   next model iteration answers.
3. **Optional triage quick branch:** parallel classifier/calendar complete,
   quick reply chosen and normal exchange finalization follows.
4. **Due batch, remote remember failure:** local durable memory retained while
   remote sync remains pending.
5. **Gather parallel proposal:** independent scans join, nonzero counts select a
   local markdown proposal.
6. **Experimental pi delegation:** opt-in schema, JSON-mode external specialist,
   usage/artifact preservation and parent tool-result continuation.

A trace’s serialized inspection steps do not assert an order between nodes that
execute concurrently. Outcomes such as retrieval decisions and successful tool
writes are assumed, not observations.

## Validation and limits

Graph generation checked unique node IDs, relationship endpoints and resolvable
source definitions for all anchors. Relationship meanings were reviewed against
caller bodies, topology builders, prompt construction and persistence ordering.
The graph is a surface study intended for subsequent node-by-node exploration.

Collapsed areas include each provider adapter’s full wire/block conversion,
every Apple/GitHub/API argument, MCP OAuth flow internals, full dashboard browser
rendering, scoring algorithms and individual eval fixtures. These exclusions
avoid implying that every function or external system is fully modeled.
No Waku runtime, eval suite or live-provider behavior was executed to validate
source-derived claims.

## Audit corrections

The [semantic audit ledger](audits/waku.md) reconciles every represented item.
Settings toggles write environment configuration but do not rebuild the current
agent. Eligible integration changes invoke rebuild and rollback on failure.
Graph-builder dependencies are execution transitions; constructors and pure
binders do not imply a network request. The calendar read combines local events
and optional Google events; Apple calendar is a separate optional tool.
