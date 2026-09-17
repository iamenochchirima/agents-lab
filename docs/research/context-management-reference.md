# Context management reference review

**Status:** Research note supporting the context-management implementation plan.
**Reviewed:** 2026-09-15
**Local repositories:**

- Hermes: `/home/enoch/aworkspace/agents/hermes-agent`
- OpenClaw: `/home/enoch/aworkspace/agents/openclaw`
- Waku: `/home/enoch/aworkspace/agents/waku-agent`

This note describes implementation patterns found in the checked-out repositories and
the existing Lab code maps. It is design input, not a claim that any reference harness
provides exactly-once model execution, lossless summarisation, or a universal context
budget guarantee.

## The central distinction

The three projects do not treat “the transcript” and “the context sent to the model” as
the same object:

```text
canonical session record
        │
        ├── history selection, resource loading, pruning, compaction
        │
        └── request-local model context
```

That distinction is the most important design lesson for Agent Harness Lab. A compacted
request must not silently rewrite or destroy the canonical session record. The runtime
must retain enough provenance to explain what the model saw, what was omitted, what was
summarised, and how much budget remained.

## Hermes

Hermes is the strongest reference for a phase-oriented context pipeline. The relevant
implementation is distributed across the turn modules rather than concentrated in one
large “context” class.

### Observed flow

1. `agent/turn_context.py::build_turn_context` hydrates the session, stages the user
   message, refreshes tools, starts memory work, and records turn-local context state.
2. `agent/turn_request_assembly.py::assemble_api_request` creates a request-only copy of
   the transcript and applies context selection, sanitisation, image eviction, cache
   planning, and pressure measurement.
3. `agent/conversation_loop.py` bounds model/tool iterations and decides whether the
   next request is a continuation, a tool round, a recovery, or a terminal response.
4. `agent/context_compressor.py`, `conversation_compression.py`, and
   `agent/turn_context_compaction.py` handle preflight and overflow compaction. The
   reviewed map identifies pruning of old tool results, summaries of selected history,
   locking/timeouts, and provider-specific recovery paths.
5. Session persistence and the finalizer retain the canonical result and trajectory
   after the request-local representation has been used.

The practical rule is: compact before a provider call when pressure predicts that the
request is unsafe, and also have a bounded recovery path when a provider still reports a
context overflow. A failed or timed-out compaction must not turn into unbounded retries.

### Useful boundaries

- The system prompt and identity/instruction prefix are treated as a stable part of the
  conversation. Cache-aware changes to that prefix are handled deliberately.
- Tool results can be pruned or summarised in the request copy without deleting the
  original tool records from the session.
- Context engines are replaceable, but the loop owns the decision to accept, retry, or
  fail a request after context preparation.
- Session persistence, turn leases, and context compression are related but distinct;
  session persistence does not by itself establish durable replay of every model/tool
  action.

### Start here

- Local source map: [`Hermes code map`](harness-code-maps/hermes.md)
- `agent/turn_context.py`
- `agent/turn_request_assembly.py`
- `agent/conversation_loop.py`
- `agent/context_compressor.py`
- `agent/conversation_compression.py`
- `agent/turn_context_compaction.py`
- `agent/session_persistence.py`
- `hermes_state.py`

The map links the relevant [agent loop](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/agent-loop.md), [prompt assembly](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/prompt-assembly.md), and [context compression and caching](https://github.com/NousResearch/hermes-agent/blob/b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a/website/docs/developer-guide/context-compression-and-caching.md) documentation.

## OpenClaw

OpenClaw provides the clearest separation between preparing a turn and selecting the
low-level executor. That matters for context because the context policy belongs to the
prepared turn, while an embedded harness or native harness may execute it differently.

### Observed flow

1. Channels, CLI, gateway, or cron resolve the agent, session, workspace, model,
   credentials, and tool policy.
2. `src/agents/harness/selection-decision.ts` chooses the built-in embedded runtime or
   a registered native harness.
3. The embedded path uses `run-orchestrator.ts`, `run-entry.ts`, and `run-loop.ts` to
   manage logical-turn admission, model candidates, runtime preparation, retries,
   compaction recovery, tool-loop protection, permissions, cancellation, settlement,
   and terminal resolution.
4. `embedded-agent-runner/history.ts`, `compact.ts`, compaction helpers, session
   resources, and `packages/agent-core/` provide the history/context seam.
5. The session transcript and active-run/delivery evidence are settled separately from
   the request execution result.

OpenClaw also seeds and injects `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and
`BOOTSTRAP.md` under explicit configuration and character budgets. These files are not
interchangeable: identity, workspace rules, user directives, and one-time bootstrap
instructions have different lifecycles. Any Lab context builder that later supports
these sources should record their source and precedence rather than flattening them
into an unexplained string.

### Useful boundaries

- The embedded/native choice is made after the turn has been prepared. Context state
  should therefore be a serializable input and an explicit result, not a hidden global
  in the executor.
- Compaction and overflow recovery are distinct from ordinary retries. A context
  overflow should trigger at most a bounded context-recovery attempt, then become an
  explicit failure if the reduced request is still unsafe.
- Workspaces and injected resources have character/budget limits. A file being present
  in a workspace does not mean its full contents belong in every request.
- Sessions, active-run projections, delivery evidence, and executor results have
  separate ownership.

### Start here

- Local source map: [`OpenClaw code map`](harness-code-maps/openclaw.md)
- `docs/agent-runtime-architecture.md`
- `src/agents/harness/selection-decision.ts`
- `src/agents/embedded-agent-runner/run-orchestrator.ts`
- `src/agents/embedded-agent-runner/run-entry.ts`
- `src/agents/embedded-agent-runner/run-loop.ts`
- `src/agents/embedded-agent-runner/history.ts`
- `src/agents/embedded-agent-runner/compact.ts`
- `packages/agent-core/`
- `src/agents/sessions/`

The map links OpenClaw's [sessions, compaction, and streaming](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/config-agents/heartbeat-compaction-and-streaming.md), [workspace/bootstrap](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/gateway/config-agents/workspace-and-bootstrap.md), and [runtime ownership](https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/docs/plugins/sdk-agent-harness/core-ownership.md) documentation.

## Waku

Waku is the most readable control implementation, but its context strategy is simpler
and should not be described as full compaction.

### Observed flow

1. `Waku.__init__` composes settings, SQLite state, the model client, memory, tools,
   the session, and tracing.
2. `Waku.respond()` calls `Session.build_system()`, which loads `SOUL.md`, local time,
   model facts, gated memory retrieval, and matching skills.
3. `_run_full_turn()` selects a bounded recent history window and adds the new user
   message before entering `waku/loop/agent.py::run_loop`.
4. The loop mutates its working message list for tool calls and results, then returns a
   result.
5. `respond()` commits the completed exchange to SQLite, performs memory consolidation,
   updates the generated `MEMORY.md` view, and closes the JSONL trace.

Waku's fixed `history_turns` window is a useful first safety bound, but it is not a
summary-based compaction protocol. It does not establish how to preserve old facts,
tool-call relationships, compaction provenance, or a retry after a provider overflow.

### Useful boundaries

- The durable chat log and the in-process history tail are separate.
- System context is assembled conditionally; memory retrieval is gated instead of
  always injecting every stored fact.
- `SOUL.md` is identity context. Skills are conditional procedural context. Long-term
  memory is a separate retrieval/consolidation subsystem.
- Tracing records the turn independently from the model's working message list.

### Start here

- Local source map: [`Waku code map`](harness-code-maps/waku.md)
- `waku/app.py`
- `waku/runtime/session.py`
- `waku/loop/agent.py`
- `waku/memory/retrieval_gate.py`
- `waku/memory/consolidation.py`
- `waku/ops/tracing.py`
- `waku/db.py`

The map links Waku's [architecture overview](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/docs/architecture.md) and [memory backends playbook](https://github.com/ShenSeanChen/waku-agent/blob/4a615acd9dff66015c74b96a9a11e92963fbeb35/docs/memory-backends-playbook.md).

## Design conclusions for the Lab

### What belongs in the context subsystem

- Session transcript selection and request-local message construction.
- Ordered context sources with explicit provenance and precedence.
- Model context-window metadata and reserved output budget.
- Token counting with an explicit exact/estimated status.
- A pressure policy that decides when to compact before a provider request.
- Compaction records: input revision, retained messages, summary reference, token counts,
  reason, timestamp, and outcome.
- Context snapshots that the UI and evidence layer can inspect without exposing
  credentials or raw provider headers.

### What does not belong there

- Long-term memory storage, embedding, retrieval, or consolidation policy.
- Provider credentials or model transport.
- Temporal workflow history, Restate replay logs, or LangGraph checkpoints. Those are
  platform durability mechanisms; they may store a reference to context state but are
  not the context policy themselves.
- Tool authorization and side-effect execution. Tool descriptions/results are context
  inputs, while tool policy remains an execution/security concern.

### Required production invariants

1. The canonical session transcript is append-only or versioned; compaction produces a
   new request representation and never silently deletes source history.
2. A request cannot exceed `contextWindow - reservedOutput - safetyMargin`. The meter
   exposes the numbers used for this decision, not only a rounded percentage.
3. Token accounting identifies whether counts are exact or estimated and records the
   tokenizer/model basis. An estimate must not be presented as an exact provider count.
4. Compaction is bounded, idempotent for the same session revision and policy, and
   fails closed when it cannot produce a valid message sequence.
5. System/developer identity instructions and the current user turn are never removed
   by ordinary history compaction. Assistant/tool-call/tool-result relationships are
   compacted as coherent units.
6. A provider context-overflow response may cause one bounded reassembly/compaction
   attempt. It must not blindly repeat a model request with the same oversized input.
7. The UI reads the latest server context projection. It does not estimate remaining
   context from rendered text or previous token usage in the browser.
8. Platform adapters preserve the same semantic records while retaining their own
   persistence, replay, retry, and cancellation behaviour.

## Evidence boundary

The detailed platform code maps remain the primary local reading guides:

- [`Hermes code map`](harness-code-maps/hermes.md)
- [`OpenClaw code map`](harness-code-maps/openclaw.md)
- [`Waku code map`](harness-code-maps/waku.md)

Those maps pin the reviewed repository commits and dates. A later implementation must
re-check upstream sources before copying a behaviour, because filenames and contracts
can change.
