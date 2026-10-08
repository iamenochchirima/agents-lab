# Output and delivery in Hermes and OpenClaw

Reviewed 2026-10-08 for Lina's Reply / Delivery block. This document records source observations and proposes design boundaries. It does not establish that Lina already implements these mechanisms.

## Evidence and version boundary

| System | Inspected local source | Immutable source pin |
| --- | --- | --- |
| Hermes | `/home/enoch/aworkspace/agents/hermes-agent` | `0e21933114c911075782d5744cee5403996d38ae` |
| OpenClaw | `/home/enoch/aworkspace/agents/openclaw` | `912685f442286233fbbd40762482d98598299497` |

The pins come from each local checkout's HEAD metadata. OpenClaw's local Git object store cannot resolve HEAD as an object, so metadata alone was insufficient evidence. Twenty-three cited implementation files were compared byte for byte against immutable GitHub raw URLs; they matched. Hermes notification code was checked against the local Git object at the named commit after remote fetch returned HTTP 429. Official documentation was separately browsed on the review date and can describe newer behavior. These pins differ from the newer Subagents study; do not silently merge their implementations into one version. No upstream tests, live channel sends, crash experiments, or read-receipt experiments were run.

The starting topics, final response, streaming, formatting, artifacts and delivery failures, cover the ordinary reply path but are insufficient for a whole delivery block. Both systems have output producers other than a model's final message, mutable previews, route authority, silent outcomes and delivery ownership beyond the agent loop. The proposal below preserves those capabilities without asserting that every transport supports every operation.

## Hermes observations

### Finalization and visible delivery are separate

`run_turn_runner.py` supplies the authoritative `final_response` to the streaming consumer after postprocessing. An interrupted run's diagnostic final response must not replace a partial answer already on screen. Tool-result media tags may be appended after the model finishes, scoped to the current turn and deduplicated against history. Text generation completion therefore does not prove that the final text or attachments have reached the destination. [Turn finalization][h-runner]

`run_turn.py` reconciles confirmed streamed content with the final response. It suppresses the ordinary final send only when final delivery is confirmed, handles transformed content through edits, and treats stale multi-message splits differently from a single editable preview. Streamed text still requires attachment delivery and sometimes a separate footer. A newly generated error remains deliverable even if earlier answer text streamed. [Final routing][h-turn]

`GatewayStreamConsumer` crosses the synchronous worker / asynchronous adapter boundary using a delta queue. It buffers and rate-limits send/edit updates; commentary, tool progress, flush barriers, approval boundaries and authoritative final text have distinct queue events. Transport choices include edits, native drafts where supported, and native streams. Draft animation itself is not the final send. A run-current callback stops stale consumers after `/new` or `/stop`; that check cannot retract an already accepted platform operation. [Stream consumer][h-stream]

### Adapter contracts, formatting and media

`SendResult` carries success, primary message ID, ordered continuation IDs, raw adapter evidence, classified errors, retryability and `retry_after`. For split output, the primary ID can be the last chunk. Partial-overflow evidence controls continuation handling. The base retry helper attempts only an undelivered remainder when an adapter can resume a partial split, rather than blindly repeating the visible head. Formatting failure and rate limiting have different fallback rules. Adapter media handling extracts explicit media tags and files, and can send voice, images, documents or other supported media. Those are adapter capabilities, not a guarantee shared by all channels. [Adapter contract and retry/media implementation][h-base]

The delivery router supports explicit platform/chat/thread targets, configured home channels, original conversation and local file output. It reports unknown platforms as errors, preserves thread metadata, selects a live native or authenticated Relay transport, records per-target outcomes and skips known permanently unreachable chats. Multi-target fanout is sequential in this router, and its result is a map of independent target results. It is not an atomic group send. Oversized cron output can be saved in full while a non-chunking adapter receives a bounded rendering. [Delivery router][h-router]

The moving messaging documentation describes negotiated Relay capabilities and platform differences. It also describes intentional silence as a delivery decision with an assistant turn retained in history. This is evidence for separate `suppressed` and `delivered` outcomes, rather than interpreting no visible text as an empty failed generation. [Official messaging documentation][h-doc]

### Recovery and unknown acknowledgements

The final response ledger records a pending obligation before sending, `attempting` immediately before the send await, `delivered` only on successful adapter result, and `failed` for rejection. A crash during `attempting` leaves an ambiguous outcome because the platform may have accepted the message. Recovery can resend with a visible duplicate warning. The implementation explicitly chooses honest at-least-once recovery rather than claiming exactly-once delivery. The ledger is best effort: ledger errors must not block the original send, so this mechanism cannot establish unconditional durability. [Ledger lifecycle][h-ledger]

The ledger caps attempts at three and freshness at 24 hours, with bounded row retention. Flood recovery preserves the platform's wait deadline and warns that earlier chunks may already have arrived. Other runtime failures back off while reserving a final budgeted opportunity for boot recovery; permanently dead targets are excluded. Chat, thread and adapter profile remain part of the obligation. Recovery sends the stored answer rather than rerunning the agent's side effects. These limits are Hermes implementation policy, not proposed universal Lina defaults. [Ledger retry policy][h-ledger]

Process, update and delegation notifications have separate code paths. Notification text marks machine provenance when it enters model context, so an internal event is not mistaken for a human instruction. Durable delegation completion has claim, defer, release and acknowledge operations separate from the eventual visible reply. A queued child result does not prove parent consumption or outbound delivery. [Notifications][h-notify]

### Interactive prompt boundaries

Hermes closes or flushes a native stream before approval or clarification. Clarification can reopen a stream after the answer; approval can degrade to ordinary send. Delivery callbacks, prompt settlement and stream rearming are coordinated in the turn runner. Lina should model the output of a prompt and the pending input obligation separately. Showing the question is not authorization to continue. [Prompt and stream boundary][h-runner]

## OpenClaw observations

### Preview, block and final delivery

The current official streaming guide distinguishes completed block messages from mutable previews. It documents channel-specific final promotion, cleanup and error/media fallback, and explains that progress can appear inside a preview. This guide is moving evidence, not a claim that every behavior exists at the older local source pin. [Official streaming guide][o-doc]

At the inspected pin, `draft-stream-loop.ts` keeps the newest pending update, runs only one send/edit at a time and throttles subsequent updates. It exposes separate flush, stop, reset and wait-for-in-flight operations. `draft-stream-controls.ts` distinguishes flushing final text, clearing a preview and sealing a preview whose final send or deletion belongs to another owner. It ignores late deltas and avoids clearing a replacement preview ID while deletion of an earlier ID is in flight. [Draft update loop][o-loop], [Draft lifecycle][o-controls]

`agent-runner-payloads.ts` drops final payloads only when block streaming succeeded and was not aborted. It also filters duplicate final text/media against message-tool sends with destination, account and originating-thread context. A transcript/UI mirror is deliberately not outbound evidence. A tool's requested send, an internal mirror and confirmed delivery to the reply target must remain distinguishable. [Final payload assembly][o-payloads]

The reply dispatcher tracks queued payload delivery outcomes, normalization/suppression, cancellation, retries and fallback delivery. A fallback is attached for delivery only when the primary is proven unsent. An enqueue or accepted dispatch has a different meaning from final delivery settlement. [Reply dispatcher][o-dispatch]

### Durable delivery custody and attachment retention

The outbound queue facade normalizes reply facts, prepares the payload batch, admits stable intent ownership and transfers custody to execution. A replayed stable intent can reuse a pending or completed owner instead of creating a second send. Producer/platform leases identify the exact owner and can contribute an abort signal. The durable queue is therefore more than a timer around a network call. [Queue admission][o-queue]

SQLite queue records preserve prepared payloads, channel/target/account/thread, formatting, identity, reply facts, session context, send attempt identity and recovery state. `required` versus `best_effort` queue policy and reconciliation requirements are explicit contract fields. Retaining prepared output avoids re-running stateful output modifiers on recovery. The queue storage and completion owners remain separate from provider inference. [Queue contract][o-types], [Queue storage][o-storage]

Local media can be copied into queue-owned storage before retry, because a producer's temporary file may disappear. SQLite retention is visible before publication, and the artifact is published from a partial name before queue payloads refer to it. The normal media loader still governs source access. Sensitive-media payloads explicitly return a non-durable result rather than silently persisting them. Remote and data sources are not copied by this spool; a retained remote URL alone cannot promise that remote bytes stay available. [Media custody][o-spool]

### Unknown send state and partial outcomes

Recovery distinguishes a never-dispatched request from a crash after platform send started. It asks the adapter for `sent`, `not_sent` or `unresolved` evidence. An adapter must explicitly advertise reconciliation capability. A reconciled sent request is acknowledged without retransmission. Proven not-sent evidence permits replay only for the corresponding pre-send state. Post-send evidence prevents full replay even if a later reconciliation reports not sent. Missing reconciliation does not become permission to retry blindly. [Recovery state machine][o-recovery], [Adapter reconciliation][o-reconcile]

Recovery preserves unknown state for partial sends, separates per-source-payload terminal outcomes, and uses bounded retries/backoff for eligible failures. Exhausted or permanent failures have terminal handling. Cancellation and ownership loss can stop future work; external requests already committed cannot be undone by an abort signal. These are source branches, not measured guarantees under all adapter failures. [Recovery state machine][o-recovery]

Durable completion supports both conversation operations and pending final deliveries. Settlement checks exact session and intent identity, returning stale when the owner was retired. Its states include prepared, queued, delivered, suppressed, rejected, unknown and stale. This makes turn settlement, output obligation settlement and session lifecycle different concerns. [Completion owner][o-completion]

### Routes, audiences and prompts

Bound completion routing resolves active conversation bindings using channel, account and requester context. Missing or ambiguous requester context can fail closed. The announcement origin resolver strips stale thread metadata when target context changes. Delayed output cannot safely choose a destination by copying whichever thread ID happens to remain in session state. [Bound router][o-bound], [Announcement origin][o-origin]

Outbound policy guards send, reply, attachments, edits, deletion, polls, pinning and thread/topic operations. Cross-context forwarding markers apply to new visible content, not every mutation. Policy belongs before visible effects and must consider audience and operation type. A channel's optional actions should remain visible as capabilities rather than being reduced to plain text delivery. [Outbound policy][o-policy]

Approval forwarding renders typed pending/resolved/expired prompts with request identity, allowed decisions and expiry. A prompt is an interactive control output with a settlement lifecycle. Its renderable content does not make it a final assistant answer or a generic progress update. [Approval rendering][o-approvals]

Child completion extraction detects waiting states and formats child findings. The announcement origin and binding owners decide where completion goes. Scheduled delivery separately normalizes quiet/control tokens, applies best-effort policy, retains completion identity and can wait for descendant output before deciding which text is final. Internal child completion, parent continuation, external announcement and scheduled delivery are distinct paths. [Child output][o-child], [Announcement origin][o-origin], [Scheduled delivery policy][o-cron]

## Completeness audit for Lina

The following is a proposed design classification, inferred from the source mechanisms above. Baseline means a semantic distinction the block must represent even if a particular run does not enable the behavior. Capability means an optional implementation feature with honest support/fallback reporting. Experiment means a reproducible case needed before making a reliability claim.

| Concern | Required baseline | Optional capability | Experiment that would establish behavior |
| --- | --- | --- | --- |
| Output producers and audiences | Identify final, progress, prompt, error/refusal, tool send, scheduled notice and internal child result; record intended audience | Heartbeats, process notices, child announcements, multi-recipient fanout | Child completes after parent reset; schedule and interactive turn target the same chat |
| Completion and quiet finish | Separate execution terminal state from delivery terminal state; represent intentional suppression | Channel-specific silence tokens, visible failure card, error notice | Successful no-reply, refusal, model failure after visible progress, media-only final |
| Destination and authority | Bind session incarnation, channel/account/chat/thread/reply target and route authority | Thread creation/rebinding, cross-context forwarding, multiple targets | Thread deleted or rebound during generation; route changes during retry; ambiguous binding |
| Mutable output | Keep output/message/revision identity and distinguish preview from confirmed final | Edit, delete, redact, promote preview, fresh final, append completed blocks | Late delta after stop; delete racing replacement; final edit fails after remote commit |
| Disclosure and policy | Decide permitted audience/content before exposing it; retain reason for suppression/rejection | Reasoning visibility, safe progress summaries, cross-context markers, sensitive media handling | Hidden reasoning leaks through preview; denied attachment; policy changes before send |
| Rendering and parts | Preserve canonical content separately from channel rendering; record ordered parts and per-part results | Markdown dialects, rich interactive cards, voice/media/documents, polls, adapter limits | Escaping increases chunk count; code fence split; middle chunk fails; media fails after text |
| Duplicate prevention | Use actual target-specific send evidence; separate mirror/history from delivery | Tool-final dedupe, stable intent reuse, final promotion | Tool sends to another thread; same text in two intentional messages; streamed final times out |
| Interactive prompts | Correlate prompt delivery, expiry, allowed responders and resolved/cancelled input | Native approval/clarify cards and plain-text fallback | Question delivered but answer arrives after expiry; stale approval buttons clicked |
| Durable obligations | Retain accepted final/prompt/notice obligations under declared custody policy | SQLite/file queue, attachment spool, retention, replay hooks | Crash before enqueue, after enqueue, before send, after remote commit, during local settlement |
| Retry and ambiguity | Classify proven rejection, proven unsent, partial, unknown and delivered; cancellation does not undo effects | Server wait handling, reconciliation, warned duplicate recovery, terminal manual inspection | Lost acknowledgement; 429 after first chunk; adapter outage/reconnect; owner lease lost |
| Receipts and evidence | Separate local acceptance, durable admission, transport send result and suppression | Remote delivery/read receipts where the transport supplies them | Platform accepts but recipient is unavailable; receipt absent or arrives out of order |

No node cap follows from this table. A useful graph can expose these responsibilities through clear ownership and progressively reveal detailed records. Counting boxes is not a completeness measure.

## Proposed architectural boundary and trade-offs

Execution owns the canonical terminal result and events. Reply / Delivery owns audience selection, output policy, rendering, mutable message lifecycle, durable outward obligations and receipts. State / Persistence provides durable custody and owner fencing. Safety owns authorization decisions. Input owns prompt answers and expiry correlation. Subagents own internal child results and parent continuations. Planning owns schedules and notification intent. Tool-initiated sends enter the same delivery evidence model even when the Tools block initiated the effect.

A proposed delivery envelope should retain origin kind, execution and session incarnation, logical output identity, audience/route authorization, canonical content or artifact references, rendered revision/parts, related prompt or child result, expiry, and suppression policy. Each recipient needs its own obligation and each part needs ordered attempt/result evidence. A logical answer may have several outward effects. Conversely, several preview revisions can culminate in one final obligation.

Hermes and OpenClaw expose a real choice for ambiguous acknowledgements. Hermes favors recovery with a duplicate warning; pinned OpenClaw favors adapter reconciliation and refuses blind replay. Lina should record the chosen per-channel recovery policy and its consequence. Neither policy should be disguised as universal exactly-once delivery. The common baseline is explicit uncertainty, preserved intent and inspectable evidence. Channel-specific reconciliation or remote idempotency can strengthen particular cases.

Progress can be disposable and coalesced, while a final result or approval prompt can create a durable obligation. This is a policy choice, not a claim that all notices need identical persistence. Fanout should settle independently per target; a partial group outcome must not trigger retransmission to recipients already confirmed. Revoking an audience or retiring a session must fence further sends without rewriting the historical fact that earlier parts escaped.

Generic transport receipt names should stop at what the adapter actually proves. `success` plus a platform message ID often establishes platform acceptance, not recipient delivery or reading. Rich remote receipts belong in adapter-specific evidence with an explicit confidence/meaning field. The inspected mechanisms do not justify universal read receipts.

## Limits and follow-up evidence

This study establishes source-level mechanisms, not a framework winner. It does not compare latency, actual failure frequency, user comprehension, platform rate limits or the reliability of every channel adapter. Upstream test names and code branches are useful leads, but their presence is not a passing test result.

Before Lina claims durable or duplicate-safe delivery, run the experiments in the audit with deterministic failure injection, safe fake targets and recorded adapter evidence. Preserve canonical output, rendered parts, route/policy decisions, custody transitions, send attempt IDs, remote receipts and terminal uncertainty in run artifacts. Compare the same failure timing and adapter contract across implementations. Newer official documentation should be checked against a refreshed source pin before implementing a feature missing from the inspected version.

## Sources

[h-runner]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/run_turn_runner.py
[h-turn]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/run_turn.py
[h-stream]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/stream_consumer.py
[h-base]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/platforms/base.py
[h-router]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/delivery.py
[h-doc]: https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
[h-ledger]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/delivery_ledger.py
[h-notify]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/gateway/run_notifications.py
[o-doc]: https://docs.openclaw.ai/concepts/streaming
[o-loop]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/channels/draft-stream-loop.ts
[o-controls]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/channels/draft-stream-controls.ts
[o-payloads]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/auto-reply/reply/agent-runner-payloads.ts
[o-dispatch]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/auto-reply/reply/reply-dispatcher.ts
[o-queue]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/deliver-queue.ts
[o-types]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-queue-types.ts
[o-storage]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-queue-storage.ts
[o-spool]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-queue-media-spool.ts
[o-recovery]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-queue-recovery.ts
[o-reconcile]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-queue-reconciliation.ts
[o-completion]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/delivery-completion.ts
[o-bound]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/bound-delivery-router.ts
[o-origin]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/subagents/announce/subagent-announce-origin.ts
[o-policy]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/outbound/outbound-policy.ts
[o-approvals]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/infra/exec-approval-forwarder.messages.ts
[o-child]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/subagents/announce/subagent-announce-output.ts
[o-cron]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/cron/isolated-agent/delivery-dispatch-policy.ts
