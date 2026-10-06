# Lina input architecture

Status: agreed architecture, not implemented Lina capabilities. Updated 2026-10-06.

## Agreed decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Execution | A shared Lina service owns agent execution, conversation state, queues, steering, and cancellation. The CLI connects as a client. | CLI and messaging channels reach the same running system. This follows OpenClaw's gateway-backed approach. |
| Adapters | Start with CLI, WhatsApp, and Telegram adapters. Share an internal message contract. Each adapter handles its transport's requirements. | Channel support can grow without rebuilding the execution loop. Both studied systems separate transport handling from execution. |
| Groups | Share history within a group. Give threads and topics separate conversations where supported. | Members can continue each other's requests. This follows OpenClaw's group model and Hermes's shared-thread default. |
| Group activation | Require a mention or reply to activate Lina. | Lina responds when addressed. Exact channel-specific activation rules remain open. |
| Audience | Serve the owner and explicitly approved people. | The design assumes a trusted owner and approved participants. It does not establish isolation for unrelated customers. |
| DM access | Require owner-approved pairing or an explicit allowlist. Do not execute an unknown sender's request before approval. | Both systems use pairing and allowlists for admission. |
| Personal conversation | Automatically route the owner's linked WhatsApp and Telegram DMs to one personal conversation. | The owner can change channels without selecting the conversation each time. |
| Other approved people | Give each approved person a separate DM history. Link channel identities explicitly before sharing that person's history across channels. | Several people can use the same agent without merging their private conversations. OpenClaw supports this through per-peer routing and identity links. |
| Identity-link management | Only the owner can create or remove links through an authenticated owner interface. Verify control of each added channel account with a short-lived code sent through that channel. | Linking grants access to an existing person's conversation. Chat approval alone does not grant link-management authority. |
| Existing histories | Preserve existing histories when linking accounts. Explicitly select the conversation that future messages use. Do not merge histories automatically. | Proof that accounts belong to one person does not establish that their histories should merge. |
| Unlinking | Remove access obtained through the shared identity. Explicitly show whether the account retains independent chat approval. | Identity links and chat admission are separate grants. |
| Group access | Approve the group and its permitted senders separately from DM access. | Private approval does not grant group access. This follows OpenClaw's explicit separation. |
| CLI identity | Authenticate the CLI connection as the owner's account. | Local execution alone does not establish authority at the service. |
| CLI conversations | Open the owner's personal conversation by default. Support creating separate task conversations and selecting existing authorized conversations. Each terminal stays attached to its selected conversation. | The default preserves messaging continuity. Separate conversations keep focused tasks out of personal DM history. Multiple terminals targeting one conversation follow the same busy-input rules. |
| Revocation | Reject subsequent requests from a revoked identity. | Approval is reversible. Treatment of already-running work remains open. |
| Approval scope | Approval grants chat access. Define administrative and execution-control permissions separately. | Chat admission does not settle tool approvals, configuration access, or control of another person's work. |
| Busy input | Expose Queue, Steer, and Interrupt, plus Stop. | The labels are agreed. Detailed behavior remains proposed below. |
| Shared group control | In explicitly approved, trusted groups, authorized participants can Queue, Steer, Interrupt, and Stop shared work, subject to operation permissions. Steering requires compatible execution authority. Administrative actions remain separately restricted. | The group collaborates on shared work. Original-requester status alone does not restrict cancellation. |

## Agreed message contract

Adapters report transport facts. The service resolves identity, authorization,
conversation routing, and execution admission.

| Information | Owner | Purpose |
| --- | --- | --- |
| Channel and adapter account | Adapter | Identify the receiving CLI connection, Telegram bot, or WhatsApp account. |
| Source event and message IDs, when available | Adapter | Preserve delivery identity for duplicate detection and reply references. |
| Sender's channel identity | Adapter | Supply identity evidence for service authorization. |
| Chat type, chat ID, and thread or topic ID | Adapter | Distinguish DMs, groups, and topics. Thread and topic IDs apply where supported. |
| Content | Adapter | Preserve text and attachment references. Attachment-only messages are valid. |
| Reply and mention facts | Adapter | Support quoted context and group activation. |
| Source timestamp and transport metadata, when available | Adapter | Preserve useful channel details. |
| Internal input ID and receipt time | Service | Track each received input. |
| Resolved person and conversation IDs | Service | Apply identity links and conversation routing. |
| Turn ID, when execution is admitted | Service | Identify the admitted execution. |

Preserve original content separately from prepared model input. Transcription,
sender labels, and added history do not overwrite what arrived. The service
establishes permissions. Message content and arbitrary transport metadata cannot
grant owner status or execution authority.

Exact schema types remain open. The agreed attachment and command rules follow.

## Agreed attachments

Support images, voice notes, PDFs, and text or code files first. Defer video
processing. Channel support depends on the selected integration, including the
WhatsApp adapter.

| Responsibility | Owner |
| --- | --- |
| Receive attachments and retrieve bytes using channel credentials | Channel adapter |
| Validate file type and size, store the original, and assign an attachment ID | Shared attachment component inside the Lina service |
| Transcribe audio and extract document content | Configured processing components |
| Select content for model input | Context-building system |

Preserve originals separately from transcripts and extracted content. Derived
content references its source attachment. Preserve attachment order and captions.
Report unsupported types and processing failures visibly. Lina must not claim
to have read content that processing could not produce.

The attachment component does not require a separately deployed service. Limits,
retention, processing providers, and failure behavior still need specification.

## Agreed commands and answers

Control requests and answers to waiting work bypass the ordinary conversation
queue. They still require authorization.

| Input | Handling |
| --- | --- |
| Status | Answer immediately without starting an agent turn. |
| Queue, Steer, Interrupt, Stop | Route to the service's authorized turn-control handler. Detailed execution rules remain proposed. |
| Approval or denial | Require an explicit approval control or `/approve <id>` or `/deny <id>`. Check permission and resolve the specific pending approval. A plain yes or no does not grant approval. |
| Clarification answer | Deliver to the specific waiting question. Accept plain text when the target is unambiguous. |
| Ordinary message | Apply the conversation's busy-input policy. |
| Configuration or conversation-changing command | Define an explicit busy policy for each command. Reject unsafe changes visibly. |

Answers retain the prompt ID, owning turn ID, and responding person's identity.
A late answer must not resolve a newer operation. Command-specific permissions
and the detailed busy policies remain open.

## Agreed duplicates and bursts

Duplicate delivery repeats one source event. Burst batching combines distinct
messages for execution while preserving their identities.

| Area | Rule |
| --- | --- |
| Duplicate identity | Use channel, adapter account, transport scope, and source event ID. Do not deduplicate by text. |
| Duplicate admission | Persist input identity and admission state. Redelivery refers to the existing input rather than creating another turn. |
| Text bursts | Use configurable short batching on messaging channels, scoped to the same sender and conversation. Disable batching for CLI submissions. |
| Message preservation | Retain every message's ID, content, and order within a batch. |
| Controls and waiting answers | Dispatch outside ordinary batching after authorization. |
| Albums | Group attachments by transport-provided album identity where available. Timing alone does not establish album membership. |

Exact batching delays and receipt retention remain configurable decisions.
Missing source IDs, edits, and expired receipts need explicit adapter rules.
Duplicate detection does not guarantee that tool side effects happen only once.
Crash recovery and uncertain operations remain open.

## Agreed acceptance and recovery

Accepted means Lina has durably recorded responsibility for the input. It does
not mean execution has started or succeeded. Before confirming acceptance, save
the input, resolved identity and conversation, requested operation, required
attachment custody, and admission state. Report a persistence failure instead of
confirming acceptance.

| Situation | Recovery rule |
| --- | --- |
| Client disconnects after acceptance | Continue work. Expose status on reconnection. |
| Accepted input has not started before restart | Restore ordering, recheck authorization, and execute eligible input. |
| Execution was interrupted | Inspect recorded progress and tool outcomes before resuming safely recoverable work. |
| A tool's outcome is uncertain | Reconcile the outcome or request a decision. Do not blindly repeat the operation. |
| Answer exists but delivery failed | Retry delivery of the saved answer under the delivery policy. Do not rerun the agent. |
| Acceptance confirmation was lost | A resend with the same source identity returns the existing input's status. |

Recover unstarted inputs and safely recoverable execution automatically. Surface
uncertain side effects for intervention. Exact checkpoints, reconciliation
mechanisms, and delivery policy remain open.

## Agreed reply destination and delivery

Persist the request's originating channel, adapter account, chat, thread or topic,
and reply anchor with the work. Deliver the answer to that origin. Shared
conversation history does not imply delivery to every linked channel.

| Situation | Rule |
| --- | --- |
| Messaging request | Reply through its originating adapter to its chat and thread or topic. Group replies must not expose private history. |
| CLI disconnects | Save the result for authorized retrieval on reconnection. |
| Known temporary delivery failure | Retry the saved answer with bounded backoff. Do not rerun the agent. |
| Permanently unavailable destination | Mark delivery failed. Keep the result available through an authorized interface. |
| Uncertain send outcome | Reconcile where possible. Do not silently resend as though nothing arrived. |
| Requested destination change | Require an explicit request and access checks. Do not switch channels automatically on failure. |
| Cross-channel steering | Confirm steering on its incoming channel. Keep the original final-answer destination unless explicitly changed. |

Exact retry budgets, reconciliation support, and destination-change controls remain open.

## Proposed execution behavior

These rules are draft proposals. Only the control names are agreed.

### Operation rules

| Operation | Behavior |
| --- | --- |
| Queue | Leave the active turn unchanged. Preserve each message in arrival order and start it as a later turn. |
| Steer | Add guidance to the active turn at a supported execution boundary. If steering is unavailable, queue the message and notify the user. |
| Interrupt | Request cancellation of the active turn. Start the replacement message as a new turn after the previous owner releases the conversation and state is reconciled. |
| Stop | Request the same cancellation without submitting a replacement message. |

Queue does not change the current model request, tools, or subagents.

### Steering boundaries

The proposal adopts OpenClaw's built-in runtime rules.

| Current activity | Proposed behavior |
| --- | --- |
| Model request | Retain guidance without canceling the request. Apply it at the next supported boundary. |
| Sequential tools | Allow the first executable call to start. Let a running call finish, then skip the unstarted remainder when guidance is pending. |
| Parallel tools | Let the batch settle. Do not skip calls for steering. |
| Tool results complete | Append guidance after the results, before the next model decision. |
| Compaction | Retain guidance until a valid compaction boundary. |
| Subagents | Guide the parent. Forward guidance to children only through an explicit operation. This policy remains open. |

Skipped tool calls receive synthetic results that state they did not execute.
Steering messages retain separate identities. Consumed guidance must not replay
as a queued turn. Accepting guidance does not mean the model has consumed it.

### Cancellation rules

Interrupt and Stop prevent further launches and request cancellation of active
model requests and tools through their supported mechanisms. Record completed,
canceled, and uncertain outcomes. Do not publish an incomplete compaction summary.

Cancellation cannot undo completed side effects. A tool can finish despite a
cancellation request. A timeout does not prove that work stopped or that a
replacement turn can safely use the same resources.

Target Steer, Interrupt, and Stop at a specific active turn ID. A stale request
must not silently affect a newer turn. Status requests, approval responses, and
clarification answers remain accessible while work runs.

## Input block in Studio

The first architecture block is available at `/studio/lina`. It contains 22
documented nodes and 30 design connections. It is a proposed responsibility map,
not an executable workflow or a claim that source agents use the same ordering.

| Part | Nodes |
| --- | --- |
| Entry | CLI, WhatsApp, Telegram adapters; input envelope |
| Admission | Identity resolver, access policy, pairing/refusal, conversation router, input identity claim, existing-input status |
| Preparation and persistence | Intent/permission, attachment custody, durable acceptance, input recovery |
| Dispatch | Accepted-input dispatcher, messaging burst collector, conversation admission, turn control, pending-prompt resolver, command handler |
| External boundaries | Execution handoff, reply-delivery handoff |

Each node's Study notes name corresponding Hermes and OpenClaw explorer nodes
and source owners. Pi and Waku supply supplementary entry/runtime comparisons.
Mappings identify shared responsibilities, not identical components. Lina's
durable acceptance and service-wide persistent duplicate claim have no universal
equivalent inferred from either source explorer.

Controls and prompt answers bypass burst collection and ordinary execution
admission. Attachment-free input bypasses custody. Invalid or unauthorized input
does not enter execution. Recovery restores eligible accepted work after current
authorization and outcome checks.

Decided is a design status, not implementation status. Node boundaries and edge
ordering remain reviewable, especially duplicate claims, attachment failures,
immediate control persistence, and conversation ownership.

## Decisions still open

- Identity-verification code expiry, retry limits, and delivery failures.
- The CLI authentication mechanism.
- Restricted-tool approvers, exact operation permissions, and the execution-authority compatibility check.
- The effect of revocation on running and queued work.
- Attachment limits, retention, processing providers, failure behavior, and WhatsApp integration.
- Batching delays, receipt retention, and handling of missing source IDs, edits, and expired receipts.
- Exact message schema types, command-specific busy policies, recovery checkpoints, reconciliation mechanisms, delivery retry budgets, and destination-change controls.

The requester-or-owner-only cancellation proposal was rejected in favor of shared
control in approved, trusted groups. Shared conversation access does not grant
administrative authority or permission to borrow another participant's tool access.

- The default option for ordinary input.
- Whether to adopt OpenClaw's first-executable-call steering rule.
- Whether to cancel turn-owned children and preserve explicitly detached work.
- Whether Stop pauses queued messages until the user resumes them.
- Whether Interrupt runs the replacement first and pauses older queued messages.
- Queue behavior after execution failure, including how uncertain work blocks later turns.
- Cancellation timeouts and treatment of partial model output.

## Source basis

The comparisons use pinned repository snapshots:

Delivery rules draw on Hermes's [reply anchors](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/platforms/event.py#L58)
and [delivery recovery](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/website/docs/user-guide/messaging/index.md#L292),
and OpenClaw's [originating destination](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/auto-reply/templating.ts#L415)
and [durable delivery recovery](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/retry.md#L98).
Keeping the original destination after cross-channel steering is Lina's selected rule.

Acceptance and recovery draw on OpenClaw's [acknowledgement boundary](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/gateway/server-methods/chat-send-handler.ts#L567)
and [disconnection behavior](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue.md#L54),
and Hermes's [completed-answer recovery](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/run_startup.py#L313).
Durable acceptance is Lina's selected contract, not a universal guarantee of
either reference system.

Duplicate and burst policies draw on Hermes's [persisted Telegram receipts](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/plugins/platforms/telegram/update_admission.py#L1)
and [text debounce](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/platforms/base.py#L3815),
and OpenClaw's [inbound deduplication and batching](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/messages.md#L29).
Service-wide persistent duplicate admission is Lina's selected design, not a
universal guarantee of either reference system.

Attachment responsibilities follow Hermes's [adapter download and caching](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/run_inbound.py#L51)
and [gateway transcription](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/run_inbound.py#L2062),
and OpenClaw's [validated media store](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/media/store.ts#L486)
and [shared media processing](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/media-understanding/apply.ts#L130).
Deferring video is Lina's selected scope, not a limitation inferred from these systems.

Command routing follows Hermes's [busy dispatch](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/platforms/base.py#L4081)
and OpenClaw's [control-command handling](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/messages.md#L53)
and [pending-question ownership](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue-steering.md#L115).
Lina requires explicit approvals instead of Hermes's contextual plain-text shortcut.

The message contract follows Hermes's [MessageEvent](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/platforms/event.py#L45)
and [SessionSource](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/session.py#L66),
and OpenClaw's [MsgContext](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/src/auto-reply/templating.ts#L117).

OpenClaw's [DM routing and identity links](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/session.md#L44)
support per-person continuity across channels. Lina uses this configurable model
to keep different people's private conversations separate.

- Hermes: [gateway access documentation](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/website/docs/user-guide/messaging/index.md#L352), [authorization code](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/authz_mixin.py#L629), and [session routing](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/session.py#L682).
- OpenClaw: [CLI execution modes](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/cli/agent.md), [group access](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/channels/groups.md#L386), [pairing](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/channels/pairing.md), and [gateway trust boundary](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/gateway/operator-scopes.md#L10).

OpenClaw separates follow-up, steering, and interruption. Its built-in steering
preserves running calls and pairs skipped sequential calls with synthetic results.
See the pinned [steering contract](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue-steering.md)
and [queue modes](https://github.com/openclaw/openclaw/blob/e40ed06f23cb8bd939c9a6ff537eba7136074686/docs/concepts/queue.md).

Hermes steering waits for tool-batch completion. Its separate redirect can cancel
a model request within the same turn or request tool yield. The gateway falls back
to queueing during active subagents or compression. See pinned
[interrupt control](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/agent/interrupt_control.py#L250)
and [busy-input handling](https://github.com/NousResearch/hermes-agent/blob/ddc0e65958b326a89f6c440c76c812d31ac27e2a/gateway/run_busy.py#L583).

Lina's proposed Interrupt ends the turn. It does not adopt Hermes's same-turn
redirect semantics.
