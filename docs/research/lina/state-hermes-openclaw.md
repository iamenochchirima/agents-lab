# State, persistence and recovery in Hermes and OpenClaw

Reviewed 2026-10-08. This is source research for Lina's design graph, not an implementation or a measured durability guarantee. Both agents retain execution-related state. Their actual recovery mechanisms differ, and neither should be summarized as universally replaying every interrupted tool call.

## Evidence boundary

The source study uses official repository snapshots already selected in the Safety research. Relevant files were downloaded again from immutable raw URLs and inspected; temporary source directories from earlier work contain extracted files rather than complete Git checkouts.

| Agent | Inspected source pin | Evidence |
| --- | --- | --- |
| Hermes | `dde8800ed91c6e128064a17d5db914d74622594b` | State facade/schema, routing persistence, active-turn markers, recovery prompt, delivery ledger and asynchronous delegation ledger |
| OpenClaw | `d94fe35027e7f04c3220bfb7794097e01460b4e5` | Restart classifier/checkpoint, recovery prompt, approval uncertainty readback, delivery claims and subagent lifecycle persistence |

Live official documentation was accessed separately on 2026-10-08. It may describe newer behavior than these pins. Official remote HEADs during the study were Hermes `99a45ecc17cc51c0488ec3b8ccf7eaf483f7203d` and OpenClaw `de4ba759b988a6c1ad4a2b4f185c713c3b3f4136`. Those HEADs were discovered, not fully inspected. No database corruption, crash, restart, platform delivery or upstream test suite was executed.

## Hermes

### Stores and ownership

The pinned schema stores sessions, provider configuration, full messages and tool references, gateway routing, conversation generations, compression locks, session-turn leases and asynchronous delegation rows. The message schema includes effect disposition, but that column alone does not establish a general transactional effect journal. Profile selection determines the physical state database. [Schema][h-schema], [state facade][h-state]

Routing uses `state.db` as its primary store and can maintain a legacy `sessions.json` mirror. A serialized save path and routing generations prevent an older snapshot from overwriting newer fast updates. If SQLite commits and the mirror fails, the primary success remains success. Some inspected failure paths fall back to JSONL or JSON routing storage; Lina should expose such a degraded guarantee rather than silently equating it with the primary store. [Routing persistence][h-persistence]

The live storage guide describes SQLite WAL, profile isolation, active versus archived compaction generations, accepted-input ownership markers and lazily created delivery obligations. Its explicit warning is useful: these ownership checks do not establish universal exactly-once delivery or content deduplication. [Current storage guide][h-storage-doc]

### Restoring a turn

`mark_turn_active` persists an opaque ownership token before publishing it in memory. `clear_turn_active` checks that token, so stale unwind cannot clear a newer turn. Unclean-start recovery promotes fresh active markers into `resume_pending`; explicit suspended sessions are not rearmed. Resume markers have freshness limits. This is actual execution lifecycle recovery, beyond loading an old conversation. [Turn lifecycle][h-lifecycle]

The recovery note varies by adapter. With new human input it prioritizes that input and tells the model not to reexecute unfinished historical calls. Interactive automatic restore reports restoration and asks what to do next. Non-interactive adapters instead continue the task from the first step without a recorded result. These are prompt instructions, not proof that the missing-result operation had no effect. Lina must retain an explicit unknown-effect branch rather than copy that instruction as an execution guarantee. [Recovery note and preparation][h-run]

### Owed replies and children

The gateway delivery ledger records `pending` before send, `attempting` before awaiting the platform, and `delivered` only after success. Startup claims dead-owner work atomically using PID and process-start evidence. An ambiguous send can be retried with a visible duplicate warning. Attempts and retention are bounded. The module explicitly calls this at-least-once and best-effort: ledger errors do not block sending. It is a concrete outbox design, but it cannot promise every successful send has a durable receipt. [Delivery ledger][h-delivery]

Asynchronous delegation persists task, origin and owner information. If an owner dies, already recorded child results remain available while unfinished children become `unknown`. Recovery attaches transcript and working-tree hints; it does not establish that an unrecorded child action failed. Completion replay requires origin ownership and a delivery claim, with age and attempt limits. [Delegation ledger][h-delegation], [forensic recovery hints][h-hints]

The live storage-recovery guide concerns database integrity and operational recovery. It requires stopped writers for replacement, inspection before recovery, backup and row verification. This is separate from agent-turn continuation. [Storage recovery guide][h-recovery-doc]

## OpenClaw

### Conversation storage and current admission

The current session guide puts runtime session rows and transcripts in a per-agent SQLite database. Archived transcripts remain files; legacy `sessions.json` and JSONL are migration inputs, not the live canonical store. Doctor migration is explicit and startup refuses readiness when migration is required. Session-start, user-interaction and bookkeeping timestamps have separate meanings. [Current session guide][o-session-doc]

Current restart documentation describes one admission transaction for eligible ordinary text turns that commits input, outcome reset and recovery custody before acknowledging started execution. Other turn types retain specialized paths. Startup reconstructs eligible interrupted work with bounded attempts and retained authority; cancellation is terminal. These are current documented mechanisms, not assertions about every historical OpenClaw revision. [Current restart guide][o-restart-doc]

### Recovery decision, not arbitrary replay

The pinned recovery classifier inspects the meaningful transcript tail, tool-call/result boundaries, delivery evidence, hook state and Code Mode checkpoint identity. A dangling operation outside an audited replay-safe classification requires restricted restart-safe tools. Explicit Full Access can retain normal tools for inspection; this does not turn a missing result into success. Code Mode reconstruction needs a matching replay-safe checkpoint in the current turn, not a checkpoint borrowed from an older turn. [Resume policy][o-policy]

The recovery prompt explicitly treats interrupted, aborted or missing tool results as unknown and asks the agent to verify effects before repeating actions. Continuation lets the model decide again; it does not blindly execute the original call. [Recovery prompt][o-prompt]

The checkpoint module handles concrete terminal delivery reconciliation, including matching a successful delivery and inserting an idempotent tool result. It is not a snapshot of arbitrary process memory or proof of universal deterministic replay. [Checkpoint reconciliation][o-checkpoint]

### Approval, delivery and child writes

Approval uncertainty readback binds recovery to the original physical database, runtime epoch, approval ID, kind and creation time. It reads the durable winner instead of repeating a verdict or deciding an unresolved row. Failed readback preserves uncertainty. [Approval write recovery][o-approval]

Delivery queue transitions run in immediate SQLite transactions and compare the exact producer or send-attempt owner. Leases, recorded send starts and reconciliation identity prevent unrelated workers from promoting or settling another send. The operation's external outcome remains a separate question from SQL ownership. [Delivery claims][o-delivery]

Subagent lifecycle changes assert the current run owner and original state-write context, mutate the durable row, then publish the acknowledged row. A private draft is not published ownership. This is the relevant basis for future Lina child completion and cancellation handling. [Subagent lifecycle persistence][o-children]

The current session guide also separates storage maintenance from turn recovery: bounded retention, archive discovery and WAL-checkpoint deferral can postpone cleanup. A SQLite WAL checkpoint is a database maintenance operation; an execution checkpoint is a resumable application position. They should not share an ambiguous graph label. [Current session guide][o-session-doc]

## Implications for Lina's proposed nodes

These recommendations are Lina design choices informed by the inspected mechanisms. Neither upstream implements precisely this four-node graph.

| Proposed node | Implementable responsibility | Important branches |
| --- | --- | --- |
| Load state | Resolve owner and physical namespace; return versioned conversation, grant, operation, wait or delivery records | Found, absent, unreadable, incompatible schema, archived/tombstoned |
| Record state | Commit a named transition with stable mutation identity and expected revision/owner; publish only its receipt | Saved, already saved, conflict/stale owner, rejected, failed before commit, commit outcome unknown |
| Create execution checkpoint | Retain coherent references to completed siblings, pending operations/waits, cancellation, delivery and runtime/config revisions | Created, conflict, unsupported recovery boundary, persistence unknown |
| Recover execution | Claim recovery ownership; classify records; return a recovery plan to each original owner | Resume, reattach wait, reconcile effect, retry known-unstarted work, deliver retained reply, terminal/cancelled, incompatible, requires review |

Four nodes can express the storage mechanics, but their contracts must explicitly include claim acquisition/renewal/release and conditional writes. A dedicated **Claim execution ownership** node is justified if contention, owner loss and parallel recovery need to be visible independently in simulation. This is not an extra generic storage CRUD node. It represents who is allowed to act after restart.

An outbox is also essential to the architecture. State records and claims it; Input delivery owns sending and platform acknowledgment. Recovery must distinguish execution completion from final reply delivery. Do not duplicate the delivery loop inside State.

Safety owns grant semantics and live permission revalidation. State owns durability receipts and uncertain-write readback. Recovering an old approval or grant must not silently waive the current Safety gate. Session grants and pending waits need explicit restart lifetimes; do not infer those from conversation history retention.

Tools retains responsibility for effect reconciliation and safe retries. State supplies the last recorded intent, dispatch identity and result. A saved checkpoint is not sufficient evidence that a launched external write can be repeated.

Future orchestration owns child assignment, context and lifecycle. State must retain parent/child generation, task/result records and owed completion claims now in its record types, without adding a fake running orchestration implementation.

## Cases the graph should make inspectable

- Resume a retained conversation while showing that no active execution exists.
- Persist input and active ownership, crash before launch, then resume known-unstarted work.
- Launch a write, lose its result, then route to Tools reconciliation instead of replay.
- Complete one parallel sibling and leave another uncertain; preserve both outcomes.
- Receive a storage acknowledgment too late or lose it; look up the same mutation without inventing success.
- Let an old worker finish after replacement; reject its stale owner/revision.
- Restore a pending approval and recheck expiry, responder scope and current policy.
- Finish the turn but lose delivery acknowledgment; retain delivery custody and expose duplicate risk according to the chosen channel policy.
- Persist Stop, restart, and keep the operation terminal.
- Detect incompatible schema or corrupted/unreadable state; block recovery rather than treat it as an empty new session.
- Preserve known child results and mark unfinished child effects unknown.

The simulation can use deterministic fixtures for these paths. It must label modeled durability separately from a real backing database, and must not claim exactly-once external effects.

[h-schema]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/hermes_state_common.py
[h-state]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/hermes_state.py
[h-persistence]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/gateway/session_persistence.py
[h-lifecycle]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/gateway/session_lifecycle.py
[h-run]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/gateway/run.py
[h-delivery]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/gateway/delivery_ledger.py
[h-delegation]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/tools/async_delegation.py
[h-hints]: https://github.com/NousResearch/hermes-agent/blob/dde8800ed91c6e128064a17d5db914d74622594b/tools/async_delegation_recovery_hints.py
[h-storage-doc]: https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage/
[h-recovery-doc]: https://hermes-agent.nousresearch.com/docs/user-guide/session-storage-recovery/
[o-session-doc]: https://docs.openclaw.ai/concepts/session
[o-restart-doc]: https://docs.openclaw.ai/gateway/restart-recovery
[o-policy]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/agents/main-session-recovery/main-session-restart-recovery-resume-policy.ts
[o-prompt]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/agents/restart-recovery-prompt.ts
[o-checkpoint]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/agents/main-session-recovery/main-session-restart-recovery-checkpoint.ts
[o-approval]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/gateway/exec-approval-recovery.ts
[o-delivery]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/infra/delivery-queue-sqlite-claim.kernel.ts
[o-children]: https://github.com/openclaw/openclaw/blob/d94fe35027e7f04c3220bfb7794097e01460b4e5/src/agents/subagents/registry/subagent-registry-lifecycle-persistence.ts
