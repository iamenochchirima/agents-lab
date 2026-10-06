# OpenClaw system explorer

This working research map supports the Studio system explorer at `/studio/openclaw`. It is a surface architecture for inspecting real owners and then developing individual nodes together. It is not an OpenClaw implementation, a benchmark, or recorded run evidence.

## Source and reproducibility

- Repository: [openclaw/openclaw](https://github.com/openclaw/openclaw).
- Analyzed commit: `e40ed06f23cb8bd939c9a6ff537eba7136074686`.
- Source inspection used a read-only checkout of the pinned commit. Paths are relative to that checkout.
- Teaching model: `apps/web/src/features/system-explorer/data/openclaw.ts`.
- Every node and relationship has a pinned file/line/symbol anchor. Studio resolves these against the recorded commit, rather than a moving default branch.
- 133 nodes, 16 responsibility regions, 136 relationships and six illustrative owner walkthroughs. These counts describe map coverage, not implementation completeness or measured behavior.

Source code, rather than earlier OpenClaw architecture descriptions, determines this map. This checkout owns an `embedded-agent-runner`, its own `AgentSession` feature layers and `packages/agent-core`, pluggable harnesses, and SQLite session/transcript state. An older Pi embedded runner or JSONL diagram would misrepresent this snapshot.

## Reading the map

Regions group responsibilities. A component names a code owner; a decision names actual branch logic; a store names authoritative or derived state; a state names retained lifecycle/queue facts; an external boundary marks a selected execution interface. Calls, data relationships, transitions and independently initiated/background work have different meanings. A connection is not automatically the next execution step.

The inspector retains the precise source, inputs, outputs, conditions and failure/ownership notes. The walkthrough controls visit selected owners with explicitly assumed outcomes. They do not execute OpenClaw, contact a provider, invoke a tool, or imply that all components are active simultaneously.

## Coverage and ownership

| Region | Responsibilities and important boundaries |
| --- | --- |
| Gateway lifecycle | Resource-host startup, kernel, WebSocket connections, authenticated method dispatch, chat-send and agent RPC entry points, plugin loading. Startup failure has owned cleanup. |
| Identity and policy | Authentication, signed device proof, operator access, method authorization, configuration, secrets and exact admitted run context. Identity proof and permissions are different facts. |
| Channel ingress and routing | Channel plugin contracts, binding/default route selection, scoped session keys, normalized inbound context, media staging and ingress deduplication. Individual provider adapters remain collapsed boundaries. |
| Reply preparation | Reply admission tickets, request gathering, ACP/plugin/ordinary route selection, directives, session initialization, queued follow-ups and prepared turn execution. Commands and handled takeover can end before ordinary model work. |
| Run orchestration | Embedded entry, exact session target, session/global lanes, prepared runtime leases, bounded retry/auth-profile failover, candidate fallback, current run registry and terminal settlement. Retry retains its admitted authority. |
| Harnesses and agent loop | Built-in OpenClaw attempt preparation, AgentSession prompting, agent-core model/tool loop, selected plugin harnesses including Codex, and subscription-auth CLI bridge. Alternative runtimes retain different semantics. |
| Prompt and replay | Workspace bootstrap files, allowed skills, capability-aware system prompt, provider transforms, history sanitization/validation/engine assembly, tool-result context guards, cache-TTL projection and provider stream. Raw model/finalization paths suppress normal contributors. |
| Sessions and durable state | SessionManager, SQLite transcript mutation, writer admission, tree appends, Gateway user-turn recorder, resident session-row projection, chat cancellation and recovery. Projection is derived; it is not transcript authority. |
| Context engines and compaction | Canonical context plugin slot, engine capabilities, default LegacyContextEngine, accepted-turn outbox, deferred maintenance, guarded compaction/summary, overflow recovery and conditional memory-flush policy. |
| Tools | Capability construction, layered policy, deferred tool discovery, batch admission, before-call middleware, native execution correlation and result redaction cache. Availability does not establish authorization. |
| Execution environments | Shell dispatch/approval, filesystem suite, workspace sandbox, browser plugin, connected node invocation, bundle MCP tools and channel message actions. External side-effect contracts stay owner-specific. |
| Subagents and ACP | sessions_spawn option/runtime branch, child plan, accepted launch, registry/completion and requester wake, ACP dispatch/control plane/acpx. Accepted child launch is separate from later completion. |
| Memory | Memory-core tools, visibility-aware keyword/vector search, index source and transcript synchronization; optional LanceDB storage and recall/capture. Indexing is not unconditional prompt injection. |
| Streaming and delivery | Embedded event projection, reply dispatcher, source completion facts and Gateway finalization. Suppressed, failed and deferred delivery are explicit possibilities. |
| Independent work producers | Cron scheduler and target/payload branches, main-session system events, isolated agent turns, command jobs, heartbeat cadence/wake/visibility and HTTP hook mapping/fan-out. A user message is not required for all work. |
| Observability and operations | Diagnostics, usage aggregation, reload generation, worker placement/turn admission and shutdown. Worker runtime uses guarded transcript/inference/live clients and proxies rather than calling the local embedded orchestrator universally. |

## Consequential source-specific distinctions

### Runtime selection

The built-in harness dispatches `runEmbeddedAttempt`. Selected plugin harnesses implement the `AgentHarness` interface and may own native transport. OpenAI routing can implicitly select Codex; plugin execution is not only an explicitly configured exception. Generic host compaction recovery is restricted when the harness owns transport.

The CLI bridge is a narrower subscription-auth path: it requires a caller-owned transcript target and nonempty named `toolsAllow` without wildcards. `message_tool_only`, disabled tools and raw model modes are excluded. It exposes granted loopback capabilities rather than an unrestricted tool surface.

ACP-bound conversations have a control-plane/backend path. They are not assigned the built-in OpenClaw `AgentSession` execution steps. ACP subagent options are constrained separately, including sandbox availability and incompatible fork/lightContext/collector options.

### Context ownership

Effective engine selection resolves `plugins.slots.contextEngine` using canonical plugin enablement/default slot policy. It is not represented as a per-session context-engine configuration selector. An absent slot or policy-disallowed plugin selects the default; an explicitly selected engine without a registration can retain its ID and fail during acquisition.

The default `LegacyContextEngine` ingests nothing, passes messages through assembly and delegates compaction. SessionManager already owns message persistence. Durable accepted-turn outbox work requires supported engine capabilities, a nondegraded logical lease and eligible durable target/admission or recorder. Some work is awaited before later context assembly; it is not all detached background work.

Prompt projection, cache-TTL pruning and transcript rewriting are separate operations. The map preserves their owners rather than treating every context change as compaction.

### Lifecycle and side effects

Current live run/operator authority accompanies provider calls, hooks and tool boundaries. Closed, aborted or replaced authority cannot be rescued by a valid token, stored approval or a retry. Native call correlation retains execution promises locally; it does not establish exactly-once arbitrary external effects.

Native `sessions_spawn` can return accepted identity before child completion. Registry owners later settle terminal facts and commit eligible requester wake work. The illustrative child walkthrough separates these phases.

Cron main-session `systemEvent`, isolated `agentTurn`, and command payloads select different paths. Heartbeat visibility/busy/schedule policy can skip a tick; permitted ticks use routed channel dispatch. HTTP hooks distinguish wake operations from mapped agent dispatch and bind token/scope/idempotency to the admitted work.

## Illustrative walkthroughs

1. **Gateway chat → built-in answer:** authenticated operator, durable session, ordinary route, built-in harness, legacy engine, final text without tools.
2. **Built-in tool batch and continuation:** allowed filesystem capability, admitted batch/hooks, successful operation, next provider turn produces final text.
3. **Built-in context overflow recovery:** generic recovery permitted, budget available, successful summary/persistence and post-compaction request.
4. **Native child acceptance and later completion:** admitted native spawn, accepted identity, parent continuation, later registry terminal fact and eligible requester wake.
5. **ACP-bound conversation:** enabled backend and admitted ACP session, separate backend execution and reply delivery.
6. **Cron main event → heartbeat:** valid main-session event and immediate wake, heartbeat skip policy permits work, routed reply processing.

These walkthroughs intentionally omit some intermediate adapters and cleanup visits. Repeated owner visits can represent continuation/return. Their descriptions state assumptions rather than fabricating provider/tool outcomes or run records.

## Limits and next work

This is a broad learning skeleton, not a claim to enumerate every module. Provider wire implementations; every channel adapter; native apps and Control UI internals; complete browser/MCP/ACP/Codex internals; all memory consolidation/dreaming phases; release/update/Doctor workflows; and every worker/storage transaction variant remain collapsed or outside this surface scope. The pinned source contains many more helper modules than the map.

The next node-by-node work should inspect the complete owner and callers, confirm its local state/authority invariants, expand internal branches only where they teach behavior, and add explicit cancellation/persistence/retry diagrams where needed. Refresh source anchors and metadata if the checkout changes. No real agent/model/tool execution was performed to produce this research.

## Audit corrections

The [item-level source audit](audits/openclaw.md) records every represented node,
relationship and path, with corrected claims and remaining limits. Authentication
invokes preliminary admission; selected-harness registration checks do not load
or activate plugins. Tool execution can overlap provider streaming and use
parallel groups; the post-turn checkpoint consumes their outcomes. Recovery
compaction dispatches to the selected engine, while legacy delegation reaches
direct session compaction. Delivery evidence and ACP hook takeover now point to
their actual owners. Collapsed durable recovery, provider and integration
internals remain explicitly marked for deeper review.
