import type { LinaDocument } from './linaModel';

/** Source-study draft. Node status records design agreement, never runtime implementation. */
export const linaInputBlock: LinaDocument = {
  "version": 1,
  "nodes": [
    {
      "id": "lina-input-cli",
      "title": "CLI adapter",
      "area": "Input / Adapters",
      "status": "decided",
      "x": 80,
      "y": 120,
      "purpose": "- Receive submissions through an authenticated connection to the shared Lina service.\n- Preserve the terminal’s selected conversation and explicit control action.",
      "inputs": "- Terminal text, local file references, and submission identity.\n- Authenticated CLI account and selected conversation, if specified.",
      "outputs": "- Transport facts for the common input envelope.\n- Attachment retrieval references and a response route to the CLI connection.",
      "decisions": "- Agreed: CLI defaults to the personal conversation; each terminal can select another.\n- Open: authentication mechanism and reconnect protocol.",
      "references": "Hermes explorer: gw-ingress / CLIChatTuiMixin.chat\nOpenClaw explorer: channel-registry / ws\nPi: tui InteractiveMode; rpc runRpcMode. Waku: cli gateway.cli.main.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-whatsapp",
      "title": "WhatsApp adapter",
      "area": "Input / Adapters",
      "status": "decided",
      "x": 460,
      "y": 120,
      "purpose": "- Receive WhatsApp events and verify transport authenticity.\n- Preserve message identity and retrieve attachments using channel credentials.",
      "inputs": "- Adapter account, sender ID, chat ID, message ID, and available timestamps.\n- Text, attachment references, captions, and reply facts.",
      "outputs": "- Original transport facts for normalization.\n- Channel-specific attachment retrieval and reply routing references.",
      "decisions": "- Agreed: WhatsApp is an initial channel; approved linked DMs share personal history.\n- Open: integration choice, available media capabilities, and transport acknowledgement timing.",
      "references": "Hermes explorer: gw-adapters; gw-ingress\nOpenClaw explorer: channel-registry\nTransport-specific WhatsApp implementation must be selected.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-telegram",
      "title": "Telegram adapter",
      "area": "Input / Adapters",
      "status": "decided",
      "x": 840,
      "y": 120,
      "purpose": "- Receive Telegram events and preserve chat, topic, reply, mention, and album facts.\n- Retrieve attachments through the bot’s channel credentials.",
      "inputs": "- Bot account, update/message IDs, sender identity, and chat/topic IDs.\n- Text, media references, captions, reply anchors, and mention facts.",
      "outputs": "- Transport facts for normalization and duplicate detection.\n- Attachment retrieval references and the originating reply destination.",
      "decisions": "- Agreed: Telegram is an initial channel; group activation requires a mention or reply.\n- Open: transport acknowledgement timing and offline backlog policy.",
      "references": "Hermes explorer: gw-adapters; gw-ingress\nOpenClaw explorer: channel-registry\nTelegram UpdateAdmission runs in adapter ingress.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-envelope",
      "title": "Input envelope",
      "area": "Input / Preparation",
      "status": "proposed",
      "x": 460,
      "y": 340,
      "purpose": "- Validate the shared message structure without erasing channel-specific facts.\n- Assign Lina’s internal input ID and receipt time.",
      "inputs": "- Channel/account, source IDs, sender identity, and chat/topic facts.\n- Original text, ordered attachment references, and reply/mention metadata.",
      "outputs": "- A validated envelope with original content and source provenance.\n- A visible validation failure for malformed input.",
      "decisions": "- Agreed: attachment-only messages are valid; prepared model content stays separate.\n- Open: exact schema types and required fields per channel.",
      "references": "Hermes explorer: gw-ingress; MessageEvent at gateway/platforms/event.py:45\nOpenClaw explorer: inbound finalizeInboundContext at src/auto-reply/reply/inbound-context.ts:202\nPi: initial prepareInitialMessage; input-hooks. Waku: gateway events are not an identical common envelope.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-identity",
      "title": "Identity resolver",
      "area": "Input / Admission",
      "status": "decided",
      "x": 460,
      "y": 560,
      "purpose": "- Resolve channel identity or authenticated CLI account to a Lina person.\n- Record which verified identity link produced the resolution.",
      "inputs": "- Adapter account and authenticated sender evidence.\n- Owner-managed identity links and their current state.",
      "outputs": "- A resolved person ID and identity provenance.\n- An unresolved identity for the access/pairing branch.",
      "decisions": "- Agreed: only the owner manages links, with account-control verification.\n- Agreed: display names cannot establish identity; linking never merges old histories.\n- Open: verification-code expiry, retry limits, and delivery failures.",
      "references": "Hermes explorer: gw-admit; gateway/authz_mixin.py:629\nOpenClaw explorer: session-key buildAgentPeerSessionKey / identityLinks at src/routing/session-key.ts:206\nOwner-only identity linking is Lina policy.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-access",
      "title": "Access policy",
      "area": "Input / Admission",
      "status": "decided",
      "x": 460,
      "y": 780,
      "purpose": "- Check whether the sender can use Lina in this DM or group.\n- Keep source admission separate from permission for a particular operation.",
      "inputs": "- Resolved or unknown identity, adapter account, and DM/group scope.\n- Current chat grants, approved groups, and permitted group senders.",
      "outputs": "- An admitted source for activation checks.\n- A pairing or refusal route for unauthorized input.",
      "decisions": "- Agreed: DM approval and group approval are separate; group membership grants no private access.\n- Agreed: revocation blocks subsequent requests.\n- Open: effects of revocation on queued and running work.",
      "references": "Hermes explorer: gw-admit _hm_admit_event; gateway/run_inbound.py:205\nOpenClaw explorer: Messaging access is channel-specific. auth / operator / method-auth describe gateway clients, not messaging sender admission.\nNo equivalence between connection authentication and channel sender access.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-pairing",
      "title": "Pairing and refusal",
      "area": "Input / Admission",
      "status": "decided",
      "x": 80,
      "y": 780,
      "purpose": "- Offer pairing to unknown DM senders and wait for owner approval.\n- Refuse disallowed group traffic without agent execution.",
      "inputs": "- Unapproved sender evidence and source access refusal.\n- Owner approval/denial and pending pairing state, when applicable.",
      "outputs": "- A pairing challenge or explicit refusal.\n- Approved chat access after the owner completes pairing.",
      "decisions": "- Agreed: pairing or allowlisting grants chat access, not administrative authority.\n- Open: code expiry, retry limits, delivery failures, and refusal response policy.",
      "references": "Hermes explorer: gateway/authz_mixin.py; messaging docs pairing\nOpenClaw explorer: docs/channels/pairing.md; group access remains separate\nNo model execution for unauthorized input.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-conversation",
      "title": "Conversation router",
      "area": "Input / Admission",
      "status": "decided",
      "x": 460,
      "y": 1000,
      "purpose": "- Resolve the durable conversation from person, channel scope, or CLI selection.\n- Check access to that target before returning the route.",
      "inputs": "- Admitted person, DM/group/topic facts, and verified identity links.\n- Optional CLI conversation selection and existing conversation records.",
      "outputs": "- A conversation ID and its originating reply destination.\n- A route refusal when the person cannot access the selected conversation.",
      "decisions": "- Agreed: linked personal DMs share history; other people retain separate private histories.\n- Agreed: groups/topics stay separate; CLI defaults to personal history.\n- Open: conversation creation and explicit selection mechanics.",
      "references": "Hermes explorer: gw-session-route SessionStore.get_or_create_session at gateway/session.py:891\nOpenClaw explorer: route resolveAgentRoute; session-key; reply-session\nLina follows its documented personal/group routing agreements.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-claim",
      "title": "Input identity claim",
      "area": "Input / Admission",
      "status": "proposed",
      "x": 460,
      "y": 1220,
      "purpose": "- Atomically claim source identity before creating new work.\n- Look up an existing receipt when the same event arrives concurrently or again.",
      "inputs": "- Channel, adapter account, transport scope, and source event ID.\n- Resolved route and persisted input/admission records.",
      "outputs": "- A new claim for further admission, or an existing input receipt.\n- An incomplete claim for owner and custody recovery checks.",
      "decisions": "- Agreed: persist duplicate detection; identical text alone is not a duplicate.\n- Open: transaction boundaries, missing IDs, edits, and receipt retention.",
      "references": "Hermes explorer: No distinct explorer node. plugins/platforms/telegram/update_admission.py:233\nOpenClaw explorer: in-memory claimInboundDedupe at src/auto-reply/reply/inbound-dedupe.ts:80; durable pending reclaim at src/auto-reply/dispatch-from-config.prepare-context.ts:325\nLina service-wide claim is proposed; source scopes and persistence guarantees differ.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-duplicate",
      "title": "Existing input status",
      "area": "Input / Admission",
      "status": "decided",
      "x": 80,
      "y": 1220,
      "purpose": "- Return recorded status for a redelivered input.\n- Avoid creating another ordinary turn for the same source event.",
      "inputs": "- Existing input ID, stored original conversation, and recorded state.\n- Requester authorized for that original conversation and the response destination.",
      "outputs": "- A status response tied to the original input.\n- No additional execution admission for the duplicate.",
      "decisions": "- Agreed: lost acceptance acknowledgements recover existing status without another turn.\n- Proposed: authorize against the stored original conversation, not the current route.\n- Agreed: dedupe does not guarantee exactly-once tool effects.\n- Open: expired receipts and status format.",
      "references": "Hermes explorer: Telegram UpdateAdmission\nOpenClaw explorer: dedupe\nLina status-return response is selected policy; not a universal equivalent source node.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-intent",
      "title": "Intent and permission",
      "area": "Input / Dispatch",
      "status": "proposed",
      "x": 460,
      "y": 1440,
      "purpose": "- Classify ordinary input, commands, turn controls, and waiting answers.\n- Check permission for the requested operation before dispatch.",
      "inputs": "- Original content or structured action, actor, and conversation ID.\n- Target turn/prompt IDs and available operation permissions.",
      "outputs": "- An authorized operation with its explicit target.\n- A visible refusal for denied or invalid operations.",
      "decisions": "- Agreed: trusted groups share turn control; administrative actions stay restricted.\n- Agreed: steering requires compatible execution authority.\n- Open: exact permission grants and the compatibility check.",
      "references": "Hermes explorer: gw-command-busy _handle_message at gateway/run_inbound.py:1323\nOpenClaw explorer: directives / get-reply / choose-route\nPi: commands _tryExecuteExtensionCommand and input-hooks _runInputHandlers.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-custody",
      "title": "Attachment custody",
      "area": "Input / Preparation",
      "status": "decided",
      "x": 460,
      "y": 1660,
      "purpose": "- Retrieve required attachment bytes through the channel adapter.\n- Validate type/size and store originals with attachment IDs, order, and captions.",
      "inputs": "- Authorized input and source attachment references.\n- Adapter retrieval capability and configured storage/validation limits.",
      "outputs": "- Durable original references associated with the input.\n- A visible acquisition or unsupported-type failure.",
      "decisions": "- Agreed: images, voice, PDFs, and text/code first; video deferred.\n- Agreed: derived content references originals; this component stays inside Lina’s service.\n- Open: limits, retention, providers, and partial-failure acceptance.",
      "references": "Hermes explorer: gw-prepare plus adapter retrieval; gateway/run_inbound.py:51\nOpenClaw explorer: media stageRemoteInboundMediaIfNeeded; src/media/store.ts:486\nLina shared custody boundary is not an identical source-stage order.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-accept",
      "title": "Durable acceptance",
      "area": "Input / Persistence",
      "status": "decided",
      "x": 460,
      "y": 1880,
      "purpose": "- Persist Lina’s responsibility for the input before confirming acceptance.\n- Save resolved identity, conversation, operation, and required attachment custody.",
      "inputs": "- Authorized input, original destination, and durable attachment references.\n- Duplicate claim and current admission state.",
      "outputs": "- A durable accepted record and acceptance acknowledgement.\n- A persistence error instead of a false acceptance promise.",
      "decisions": "- Agreed: accepted does not mean started or completed; client disconnection does not cancel work.\n- Open: transaction boundaries and responsive persistence for immediate controls.\n- Lina guarantee: no universal equivalent acceptance stage is inferred for Hermes.",
      "references": "Hermes explorer: No universal equivalent. gw-active-marker is best-effort active-turn marking, not durable input acceptance.\nOpenClaw explorer: chat / chat-dispatch; chat-send-handler.ts:313,567,590\nLina durable acceptance is a design guarantee awaiting implementation.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-dispatch",
      "title": "Accepted-input dispatcher",
      "area": "Input / Dispatch",
      "status": "proposed",
      "x": 460,
      "y": 2100,
      "purpose": "- Select the handling branch from an accepted input’s operation.\n- Send controls and waiting answers outside ordinary batching and execution admission.",
      "inputs": "- Accepted input record, actor, conversation, and authorized operation.\n- Explicit turn/prompt target and originating reply route.",
      "outputs": "- Ordinary input to batching/admission, or a control/prompt/command request.\n- Branch outcome for status and reply delivery.",
      "decisions": "- Agreed: accepted ordinary input may wait before receiving a turn.\n- Proposed: one dispatcher boundary records these branch choices.\n- Open: dispatch recovery claims and branch failure-state transitions.",
      "references": "Hermes explorer: gw-command-busy; gw-active-claim\nOpenClaw explorer: choose-route / get-reply / chat-dispatch\nWaku: CLI and gateway invoke the harness; no identical durable accepted-input dispatcher.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-burst",
      "title": "Messaging burst collector",
      "area": "Input / Dispatch",
      "status": "decided",
      "x": 80,
      "y": 2380,
      "purpose": "- Collect eligible messaging text from the same sender and conversation.\n- Retain every original message ID, content, and arrival order in the batch.",
      "inputs": "- Accepted ordinary messages and configurable quiet-window settings.\n- Channel/account, sender, conversation, and source message identities.",
      "outputs": "- A single message or ordered batch for conversation admission.\n- The original input records referenced by that batch.",
      "decisions": "- Agreed: CLI, controls, and waiting answers bypass batching; albums use transport identity.\n- Open: delays, limits, unfinished-batch recovery, and exact membership.\n- Open: cross-channel batching and original reply destinations.",
      "references": "Hermes explorer: No distinct explorer node. BasePlatformAdapter debounce: gateway/platforms/base.py:3815\nOpenClaw explorer: Channel debounce; docs/concepts/messages.md:29\nBurst collection is distributed in both source systems.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-admission",
      "title": "Conversation admission",
      "area": "Input / Dispatch",
      "status": "proposed",
      "x": 80,
      "y": 2620,
      "purpose": "- Coordinate ordinary work against the conversation owner.\n- Apply the selected policy to ordinary input received while busy.",
      "inputs": "- An ordinary input/batch, conversation ID, and active-turn state.\n- Queue state, current authorization, and configured busy policy.",
      "outputs": "- Work for the conversation queue, execution, or the selected busy control.\n- Admission state and turn identity for execution.",
      "decisions": "- Proposed: one active ordinary turn per conversation.\n- Open: default busy policy, owner lease/checkpoints, queue limits, and ordering.\n- Open: failed or uncertain work blocking later turns.",
      "references": "Hermes explorer: gw-active-claim; gw-turn-lease; lease-admit\nOpenClaw explorer: reply-admission / queue / queue-drain / lanes\nPi: busy isStreaming / streamingBehavior; steer Agent.steer; followup Agent.followUp.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-control",
      "title": "Turn control",
      "area": "Input / Dispatch",
      "status": "decided",
      "x": 460,
      "y": 2380,
      "purpose": "- Queue input for the conversation without requiring an active turn ID.\n- Target the exact active turn for Steer, Interrupt, or Stop.",
      "inputs": "- Authorized action and conversation ID; exact turn ID for Steer, Interrupt, or Stop.\n- Optional guidance/replacement, active state, and execution authority.",
      "outputs": "- Control status, queued input, admitted guidance, or cancellation request.\n- Replacement admission only after safe owner release and reconciliation.",
      "decisions": "- Agreed: trusted groups share control; steering checks compatible authority.\n- Agreed: explicit controls bypass ordinary batching.\n- Proposed: stale controls cannot target a newer turn; ordinary busy policy is separate.\n- Open: cancellation ordering, tools/subagents, queue pausing, and steering boundaries.",
      "references": "Hermes explorer: gw-command-busy; gateway/run_busy.py:583,807\nOpenClaw explorer: get-reply / directives; commands-steer.ts; commands-session-abort.ts\nPi: steer / followup queues. Runtime semantics remain proposed for Lina.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-prompt",
      "title": "Pending-prompt resolver",
      "area": "Input / Dispatch",
      "status": "decided",
      "x": 840,
      "y": 2380,
      "purpose": "- Match an answer to one waiting approval or clarification.\n- Check prompt ownership, turn identity, and responder permission before resolution.",
      "inputs": "- Prompt ID, owning turn ID, responder identity, and answer.\n- Pending prompt state and the authorized response action.",
      "outputs": "- The answer delivered to its waiting work.\n- A visible refusal for stale, ambiguous, or unauthorized responses.",
      "decisions": "- Agreed: approvals use explicit controls or /approve <id>; plain yes grants no approval.\n- Agreed: unambiguous plain text can answer clarification questions.\n- Open: restricted-tool approvers and prompt expiry behavior.",
      "references": "Hermes explorer: BasePlatformAdapter active bypass at gateway/platforms/base.py:4081\nOpenClaw explorer: get-reply; docs/concepts/queue-steering.md:115\nExplicit Lina approval IDs and permission rules remain distinct from original source conveniences.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-command",
      "title": "Command handler",
      "area": "Input / Dispatch",
      "status": "decided",
      "x": 1220,
      "y": 2380,
      "purpose": "- Return status without launching a model turn.\n- Execute other authorized commands under their individual busy policies.",
      "inputs": "- Parsed command, actor permissions, and selected conversation.\n- Current service/turn state and command-specific arguments.",
      "outputs": "- A command result or validated operation for the owning component.\n- A visible rejection for unsafe changes during active work.",
      "decisions": "- Agreed: commands controlling waiting work bypass ordinary queues and batching.\n- Agreed: administrative changes require separate authority.\n- Open: reset, conversation switching, configuration, and command busy policies.",
      "references": "Hermes explorer: gw-command-busy; slash_access.py\nOpenClaw explorer: get-reply / directives; command-gates.ts\nPi commands extension dispatch. Command behavior is transport-specific.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-runtime",
      "title": "Execution handoff",
      "area": "Input / Boundary",
      "status": "proposed",
      "x": 80,
      "y": 2860,
      "purpose": "- Transfer admitted work to orchestration and context preparation.\n- Carry original input and attachment references into runtime-owned execution.",
      "inputs": "- Conversation/turn identity, execution authority, and ordered admitted inputs.\n- Replacement work after safe cancellation, where applicable.",
      "outputs": "- Runtime-owned work for model calls, tools, and subagents.\n- Recorded outcomes and owner-release lifecycle events for queue/recovery.",
      "decisions": "- Proposed: execution is an external boundary to this input block.\n- Agreed: derived content stays separate from originals before context consumption.\n- Open: owner leases, checkpoints, cancellation ordering, and handoff protocol.",
      "references": "Hermes explorer: gw-turn-lease / gw-prepare then AIAgent turn lifecycle\nOpenClaw explorer: reply-admission / lanes then embedded runtime\nPi prompt AgentSession.prompt; Waku Waku.respond. This is an external boundary.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-delivery",
      "title": "Reply delivery handoff",
      "area": "Input / Boundary",
      "status": "proposed",
      "x": 1600,
      "y": 2860,
      "purpose": "- Hand acknowledgements, refusals, command results, and saved answers to delivery.\n- Preserve the explicit originating destination with each output.",
      "inputs": "- Output record, adapter account, chat/topic, and reply anchor.\n- Authorized destination changes and known delivery state.",
      "outputs": "- Delivery status or a saved result available for authorized retrieval.\n- Retry or reconciliation work for failed or uncertain sends.",
      "decisions": "- Agreed: answer at the request’s origin; cross-channel steering does not silently move it.\n- Agreed: retry saved answers without rerunning the agent.\n- Open: retry budgets, reconciliation, and destination-change controls.",
      "references": "Hermes explorer: MessageEvent reply anchors; run_startup.py:313 delivery recovery\nOpenClaw explorer: OriginatingChannel/OriginatingTo; infra/outbound/delivery-queue-storage.ts\nExternal boundary. Do not model delivery success as execution success.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-recovery",
      "title": "Input recovery",
      "area": "Input / Persistence",
      "status": "proposed",
      "x": 1220,
      "y": 1880,
      "purpose": "- Read durable accepted inputs after restart without treating them as new events.\n- Recheck authorization and inspect recorded progress before restoring work.",
      "inputs": "- Persisted input/admission state, original route/authority, and execution records.\n- Known tool outcomes, uncertain operations, and saved answers.",
      "outputs": "- Unstarted accepted work, safe checkpoint resumes, or saved-answer delivery.\n- Uncertain execution routed to reconciliation before any further work.",
      "decisions": "- Agreed: recover safe work automatically; do not blindly repeat uncertain tools.\n- Agreed: saved-answer delivery does not rerun execution.\n- Open: checkpoint safety, owner leases, recovery claims, and reconciliation.",
      "references": "Hermes explorer: gateway/run_startup.py:313; interrupted-session recovery\nOpenClaw explorer: chat-send-handler.ts / durable state and outbound queue\nNo universal restart-safe inbox equivalent inferred from the explorer. Lina recovery details remain open.\n\nPinned snapshots: Hermes ddc0e659; OpenClaw e40ed06f; Pi a276dabe; Waku 24b4cbb6.\nLina agreement: docs/research/lina/input-design.md.\nThese are responsibility mappings, not identical execution order.",
      "experiments": ""
    },
    {
      "id": "lina-input-activation",
      "title": "Group activation gate",
      "area": "Input / Admission",
      "status": "decided",
      "x": 2100,
      "y": 780,
      "purpose": "- Check whether admitted group input addresses Lina.",
      "inputs": "- DM/CLI scope or group mention/reply facts.",
      "outputs": "- Activated input or an ignored group event.",
      "decisions": "- Agreed: DMs/CLI proceed; groups require a mention or reply.\n- Open: exact channel activation rules.",
      "references": "- Lina agreement: docs/research/lina/input-design.md, Group activation.",
      "experiments": ""
    },
    {
      "id": "lina-input-ignored",
      "title": "Ignored group input",
      "area": "Input / Admission",
      "status": "proposed",
      "x": 2520,
      "y": 780,
      "purpose": "- End handling for admitted group input that does not address Lina.",
      "inputs": "- Unaddressed group event after activation checks.",
      "outputs": "- Terminal ignored outcome without ordinary acceptance, execution, or reply.",
      "decisions": "- Proposed: explicit ignored state records this terminal branch.\n- Open: retention and transport acknowledgement.",
      "references": "- Lina agreement: docs/research/lina/input-design.md, Group activation.\n- State representation remains proposed.",
      "experiments": ""
    },
    {
      "id": "lina-input-failure",
      "title": "Input refusal or failure",
      "area": "Input / Admission",
      "status": "proposed",
      "x": 2520,
      "y": 1440,
      "purpose": "- Record a refusal or known preparation failure.\n- Preserve unknown acceptance or custody outcomes without declaring success or replaying work.",
      "inputs": "- Envelope, route, permission, custody, or acceptance failure.",
      "outputs": "- A safe refusal, failure, or acceptance-not-confirmed response for delivery.\n- Receipt state updated only when storage permits and the outcome is known.",
      "decisions": "- Proposed: failures use one visible outcome boundary.\n- Open: partial custody, unknown commits, cleanup, and retry policy.",
      "references": "- Lina agreement: docs/research/lina/input-design.md, acceptance and attachment failures.",
      "experiments": ""
    },
    {
      "id": "lina-input-claim-recovery",
      "title": "Preaccept claim recovery",
      "area": "Input / Persistence",
      "status": "proposed",
      "x": 2100,
      "y": 1220,
      "purpose": "- Inspect incomplete claims before retrying admission.\n- Recheck access to the stored original conversation, prior ownership, and custody or persistence outcomes.",
      "inputs": "- Claimed receipt, owner evidence, and prior admission progress.",
      "outputs": "- Safe reclaim, existing status, or a failure requiring investigation.",
      "decisions": "- Proposed: reclaim only when prior ownership and effects are known safe.\n- Open: claim leases, checkpoints, and retry/expiry rules.\n- Unknown custody must never trigger a blind retry.",
      "references": "- Study: OpenClaw src/auto-reply/dispatch-from-config.prepare-context.ts:325 has durable pending reclaim.\n- Lina claim scope and ownership remain proposed.",
      "experiments": ""
    },
    {
      "id": "lina-input-queue",
      "title": "Conversation queue",
      "area": "Input / Dispatch",
      "status": "proposed",
      "x": 2100,
      "y": 2620,
      "purpose": "- Preserve waiting inputs and drain after safe owner release.\n- Recheck admission before starting each queued turn.",
      "inputs": "- Ordinary busy Queue, explicit Queue, or unsupported steering fallback.\n- Owner-release/resume lifecycle events.",
      "outputs": "- Waiting work or the next input for conversation admission.",
      "decisions": "- Proposed: queue belongs to the conversation, not an active turn.\n- Open: persistence, limits, ordering, failure blocking, and Stop/resume policy.",
      "references": "- Study: Hermes lease-admit; OpenClaw queue / queue-drain.\n- Lina queue owner and drain protocol remain proposed.",
      "experiments": ""
    },
    {
      "id": "lina-input-reconcile",
      "title": "Execution reconciliation",
      "area": "Input / Boundary",
      "status": "proposed",
      "x": 2520,
      "y": 2100,
      "purpose": "- Inspect uncertain execution and side effects before further work.",
      "inputs": "- Execution records, unknown outcomes, and available operator decisions.",
      "outputs": "- Known safe follow-up/resume or recorded status requesting a decision.",
      "decisions": "- Agreed: uncertain tools must not be blindly repeated.\n- Proposed: runtime owns execution reconciliation beyond the input boundary.\n- Open: evidence, decision authority, checkpoints, and owner release.",
      "references": "- Lina agreement: docs/research/lina/input-design.md, recovery.\n- Exact reconciliation mechanism remains open.",
      "experiments": ""
    }
  ],
  "edges": [
    {
      "id": "lina-input-edge-0",
      "source": "lina-input-cli",
      "target": "lina-input-envelope",
      "label": "submission"
    },
    {
      "id": "lina-input-edge-1",
      "source": "lina-input-whatsapp",
      "target": "lina-input-envelope",
      "label": "event"
    },
    {
      "id": "lina-input-edge-2",
      "source": "lina-input-telegram",
      "target": "lina-input-envelope",
      "label": "event"
    },
    {
      "id": "lina-input-edge-3",
      "source": "lina-input-envelope",
      "target": "lina-input-identity",
      "label": "valid envelope"
    },
    {
      "id": "lina-input-edge-4",
      "source": "lina-input-identity",
      "target": "lina-input-access",
      "label": "identity evidence, including unknown"
    },
    {
      "id": "lina-input-edge-5",
      "source": "lina-input-access",
      "target": "lina-input-pairing",
      "label": "not admitted"
    },
    {
      "id": "lina-input-edge-6",
      "source": "lina-input-access",
      "target": "lina-input-activation",
      "label": "admitted"
    },
    {
      "id": "lina-input-edge-7",
      "source": "lina-input-conversation",
      "target": "lina-input-claim",
      "label": "authorized route"
    },
    {
      "id": "lina-input-edge-8",
      "source": "lina-input-claim",
      "target": "lina-input-duplicate",
      "label": "duplicate"
    },
    {
      "id": "lina-input-edge-9",
      "source": "lina-input-claim",
      "target": "lina-input-intent",
      "label": "new claim"
    },
    {
      "id": "lina-input-edge-10",
      "source": "lina-input-intent",
      "target": "lina-input-failure",
      "label": "operation denied"
    },
    {
      "id": "lina-input-edge-11",
      "source": "lina-input-intent",
      "target": "lina-input-custody",
      "label": "attachments required"
    },
    {
      "id": "lina-input-edge-12",
      "source": "lina-input-intent",
      "target": "lina-input-accept",
      "label": "no attachments"
    },
    {
      "id": "lina-input-edge-13",
      "source": "lina-input-custody",
      "target": "lina-input-accept",
      "label": "required custody secured"
    },
    {
      "id": "lina-input-edge-14",
      "source": "lina-input-accept",
      "target": "lina-input-dispatch",
      "label": "accepted"
    },
    {
      "id": "lina-input-edge-15",
      "source": "lina-input-accept",
      "target": "lina-input-delivery",
      "label": "acceptance receipt"
    },
    {
      "id": "lina-input-edge-16",
      "source": "lina-input-dispatch",
      "target": "lina-input-burst",
      "label": "ordinary input"
    },
    {
      "id": "lina-input-edge-17",
      "source": "lina-input-burst",
      "target": "lina-input-admission",
      "label": "single input or batch"
    },
    {
      "id": "lina-input-edge-18",
      "source": "lina-input-dispatch",
      "target": "lina-input-control",
      "label": "turn control"
    },
    {
      "id": "lina-input-edge-19",
      "source": "lina-input-dispatch",
      "target": "lina-input-prompt",
      "label": "waiting answer"
    },
    {
      "id": "lina-input-edge-20",
      "source": "lina-input-dispatch",
      "target": "lina-input-command",
      "label": "other command"
    },
    {
      "id": "lina-input-edge-21",
      "source": "lina-input-admission",
      "target": "lina-input-runtime",
      "label": "admitted execution"
    },
    {
      "id": "lina-input-edge-22",
      "source": "lina-input-admission",
      "target": "lina-input-control",
      "label": "ordinary busy policy: Steer / Interrupt"
    },
    {
      "id": "lina-input-edge-23",
      "source": "lina-input-control",
      "target": "lina-input-admission",
      "label": "replacement after safe owner release"
    },
    {
      "id": "lina-input-edge-24",
      "source": "lina-input-prompt",
      "target": "lina-input-delivery",
      "label": "resolution result"
    },
    {
      "id": "lina-input-edge-25",
      "source": "lina-input-command",
      "target": "lina-input-delivery",
      "label": "command result"
    },
    {
      "id": "lina-input-edge-26",
      "source": "lina-input-control",
      "target": "lina-input-delivery",
      "label": "control result"
    },
    {
      "id": "lina-input-edge-27",
      "source": "lina-input-pairing",
      "target": "lina-input-delivery",
      "label": "challenge / refusal"
    },
    {
      "id": "lina-input-edge-28",
      "source": "lina-input-duplicate",
      "target": "lina-input-delivery",
      "label": "existing status"
    },
    {
      "id": "lina-input-edge-29",
      "source": "lina-input-recovery",
      "target": "lina-input-dispatch",
      "label": "unstarted accepted input only"
    },
    {
      "id": "lina-input-edge-30",
      "source": "lina-input-activation",
      "target": "lina-input-conversation",
      "label": "DM/CLI or addressed group"
    },
    {
      "id": "lina-input-edge-31",
      "source": "lina-input-activation",
      "target": "lina-input-ignored",
      "label": "unaddressed group"
    },
    {
      "id": "lina-input-edge-32",
      "source": "lina-input-envelope",
      "target": "lina-input-failure",
      "label": "invalid envelope"
    },
    {
      "id": "lina-input-edge-33",
      "source": "lina-input-conversation",
      "target": "lina-input-failure",
      "label": "route refused / invalid selection"
    },
    {
      "id": "lina-input-edge-34",
      "source": "lina-input-custody",
      "target": "lina-input-failure",
      "label": "custody acquisition / validation failed"
    },
    {
      "id": "lina-input-edge-35",
      "source": "lina-input-accept",
      "target": "lina-input-failure",
      "label": "persistence failed / outcome unknown"
    },
    {
      "id": "lina-input-edge-36",
      "source": "lina-input-failure",
      "target": "lina-input-delivery",
      "label": "visible refusal / failure"
    },
    {
      "id": "lina-input-edge-37",
      "source": "lina-input-claim",
      "target": "lina-input-claim-recovery",
      "label": "incomplete / retryable claimed receipt"
    },
    {
      "id": "lina-input-edge-38",
      "source": "lina-input-claim-recovery",
      "target": "lina-input-intent",
      "label": "safe reclaim only"
    },
    {
      "id": "lina-input-edge-39",
      "source": "lina-input-claim-recovery",
      "target": "lina-input-duplicate",
      "label": "live owner / accepted / terminal receipt"
    },
    {
      "id": "lina-input-edge-40",
      "source": "lina-input-claim-recovery",
      "target": "lina-input-failure",
      "label": "unsafe / unknown custody; no blind retry"
    },
    {
      "id": "lina-input-edge-41",
      "source": "lina-input-admission",
      "target": "lina-input-queue",
      "label": "ordinary busy policy: Queue"
    },
    {
      "id": "lina-input-edge-42",
      "source": "lina-input-control",
      "target": "lina-input-queue",
      "label": "explicit Queue / unsupported Steer"
    },
    {
      "id": "lina-input-edge-43",
      "source": "lina-input-queue",
      "target": "lina-input-admission",
      "label": "owner release / resume; recheck admission"
    },
    {
      "id": "lina-input-edge-44",
      "source": "lina-input-runtime",
      "target": "lina-input-queue",
      "label": "lifecycle event: owner released"
    },
    {
      "id": "lina-input-edge-45",
      "source": "lina-input-recovery",
      "target": "lina-input-runtime",
      "label": "safe checkpoint resume"
    },
    {
      "id": "lina-input-edge-46",
      "source": "lina-input-recovery",
      "target": "lina-input-delivery",
      "label": "saved answer; no execution rerun"
    },
    {
      "id": "lina-input-edge-47",
      "source": "lina-input-recovery",
      "target": "lina-input-reconcile",
      "label": "uncertain execution / side effects"
    },
    {
      "id": "lina-input-edge-48",
      "source": "lina-input-reconcile",
      "target": "lina-input-runtime",
      "label": "known safe follow-up / resume only"
    },
    {
      "id": "lina-input-edge-49",
      "source": "lina-input-reconcile",
      "target": "lina-input-delivery",
      "label": "recorded status / decision needed"
    }
  ]
};
