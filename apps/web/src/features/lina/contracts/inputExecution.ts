import { choice, count, fixed, flag, inputEdges, executionEdges, list, nullable, object, output, replaceField, sample, text, type Payload, type ContractDefinition } from './schema';
import { toolResult as importedResult, accepted, admitted, attachmentAccepted, attachmentRouted, authority, checkpoint, claim, control, custody, destination, failure, limits, operationAuthorization, ordinaryOperation, queueOperation, stopOperation, promptOperation, commandOperation, outputRecord, promptAnswer, released, turn, turnState, uncertainty, work } from './shared';

const acceptedWith = (operationValue: Payload) => replaceField(accepted, 'operation', operationValue);
const reply = (category: string, message: string) => replaceField(replaceField(outputRecord, 'category', fixed(category)), 'text', text(message));
const failedAt = (stage: string) => replaceField(failure, 'stage', fixed(stage));
const store = object({ dependency: fixed('accepted-input-store'), available: flag(true) });
const activeOwner = nullable(object({ turn, state: choice(['active', 'waiting', 'cancelling', 'settling', 'reconciling']) }));
const actorPermissions = object({ personId: text('person-demo'), canControl: flag(true), canAdminister: flag(false) });
const preparedInput = object({ record: attachmentRouted, claim, operation: ordinaryOperation, operationAuthorization, originals: list(custody, [custody.example], 1) });
const restoredState = replaceField(turnState, 'limits', replaceField(replaceField(limits, 'roundsStarted', count(1)), 'attempts', count(1)));
const resume = (at: 'prepare' | 'controls' | 'settle') => object({
  checkpoint: replaceField(checkpoint, 'nextStep', fixed(at)),
  restoredState, resumeAt: fixed(at), nextIntent: fixed(at === 'settle' ? 'finish' : 'continue'),
  terminalReason: at === 'settle' ? text('answer_complete') : sample(nullable(text('answer_complete')), null),
});
const queueEntry = object({ entryId: text('queue-001'), work, enqueuedAt: text('2026-10-07T10:00:02Z') });

const admissionContext = object({ activeOwner: sample(activeOwner, null), busyPolicy: choice(['queue', 'steer', 'interrupt']), queuedCount: count(0), authorizationCurrent: flag(true), ownerCoordinator: text('conversation-owner-coordinator') });
const controlContext = object({ activeOwner, actorPermissions, compatibleAuthority: flag(true), supportsSteering: flag(true), pendingReplacement: sample(nullable(work), null), releaseObserved: sample(nullable(released), null), reconciliationResolved: flag(true) });
const promptContext = object({ pendingPrompt: nullable(object({ promptId: text('prompt-001'), turn, operationId: text('call-001'), kind: choice(['approval', 'clarification']), expiresAt: nullable(text('2026-10-07T10:05:00Z')), allowedResponderIds: list(text('person-demo')) })), responderPermissionsCurrent: flag(true), coordinator: text('owning-execution-coordinator') });
const runtimeContext = object({ executionCoordinator: text('turn-execution-coordinator'), authorityValid: flag(true), resumeEntries: list(choice(['prepare', 'controls', 'settle'])), executionRecord: sample(nullable(object({ checkpoint, state: turnState, nextIntent: choice(['continue', 'finish', 'stop']), terminalReason: nullable(text('answer_complete')) })), null) });
const outboundCorrelation = object({ outputId: text('output-001'), providerMessageId: text('provider-message-001'), accountId: text('account-demo'), destination: replaceField(destination, 'channel', fixed('whatsapp')) });
const deliveryContext = object({ outboundCorrelation: sample(nullable(outboundCorrelation), null), adapter: object({ accountId: text('account-demo'), capabilityRef: text('delivery-adapter:demo') }), outputStore: text('saved-output-store'), priorSend: sample(nullable(object({ outputId: text('output-001'), state: choice(['pending', 'sent', 'failed', 'unknown']), transportReceipt: nullable(text('transport-receipt-001')) })), null), destinationChangeAuthorized: flag(false) });
const recoveryContext = object({ storedInput: accepted, phase: choice(['unstarted', 'checkpointed', 'answer-saved', 'uncertain']), storedCheckpoint: sample(nullable(checkpoint), null), savedAnswer: sample(nullable(outputRecord), null), uncertainOperation: sample(nullable(uncertainty), null), currentAuthorization: flag(true), recoveryAuthority: sample(nullable(authority), null) });
const queueContext = object({ entries: list(queueEntry, []), activeOwner: sample(activeOwner, null), paused: flag(false), blockedByUncertainty: flag(false), maxEntries: nullable(count(100)), queueStore: text('conversation-queue-store') });
const reconcileContext = object({ evidenceStore: text('execution-evidence-store'), retainedAuthority: authority, operatorDecision: sample(nullable(object({ actorId: text('operator-demo'), authorized: flag(true), decision: choice(['resume-safe', 'record-failed', 'wait']) })), null), candidateCheckpoint: sample(nullable(checkpoint), null) });

/** Proposed local contracts. External stores and coordinators are dependencies, not implemented services. */
export const inputExecutionContracts: ContractDefinition[] = [
  {
    nodeId: 'lina-input-custody',
    context: object({ adapterRetrieval: object({ accountId: text('account-demo'), capabilityRef: text('adapter-retrieval:demo') }), originalStore: object({ storeRef: text('original-store:demo'), available: flag(true) }), permittedMedia: list(choice(['image', 'audio', 'pdf', 'text', 'code'])), maxAttachmentBytes: count(10485760) }),
    contextSource: 'Channel account retrieval capability and proposed attachment-custody configuration. Limits are illustrative, not agreed defaults.',
    reads: ['Ordered source attachment references and captions', 'Adapter bytes and custody metadata by attachment identity'],
    writes: ['Original bytes and immutable attachment metadata before acceptance'],
    rules: ['Validate allowed media and configured size before promising custody.', 'Preserve original attachment identity, ordering and captions; derived content remains separate.', 'Unknown or partial acquisition is not proof of durable custody. Partial-failure and cleanup policy remain open.'],
    outputs: [
      output('input.custody.secured', 'Originals secured', preparedInput, inputEdges(13), 'Every required original is durably retrievable.'),
      output('input.custody.failed', 'Custody failed or uncertain', failedAt('custody'), inputEdges(34), 'Retrieval, validation or storage failed, or its outcome cannot be established.'),
    ],
  },
  {
    nodeId: 'lina-input-accept', context: object({ store, receiptState: choice(['claimed', 'accepted', 'unknown']), currentFence: count(1) }),
    contextSource: 'Accepted-input store, current claim ownership and receipt record.',
    reads: ['Authorized operation, original route, claim authority and required custody references', 'Previously accepted record for the same claim'],
    writes: ['Durable accepted record and receipt state before an acceptance acknowledgement'],
    rules: ['Acceptance records responsibility, not turn start or successful completion.', 'Emit acceptance acknowledgement only after a known durable commit.', 'Do not treat an unknown commit as a new input or cancel accepted work on client disconnect.', 'Atomicity between claim, originals, accepted record and receipt remains a proposed persistence contract.'],
    outputs: [
      output('input.accept.committed', 'Accepted text input', accepted, inputEdges(14), 'Commit is known durable; dispatcher may handle the recorded operation.'),
      output('input.accept.attachment', 'Accepted attachment input', attachmentAccepted, inputEdges(14), 'Required original custody and accepted input are known durable.'),
      output('input.accept.receipt', 'Acceptance receipt', reply('receipt', 'Accepted for processing.'), inputEdges(15), 'Known durable acceptance permits a receipt at the original destination.'),
      output('input.accept.failed', 'Acceptance not confirmed', failedAt('acceptance'), inputEdges(35), 'Persistence failed or commit outcome is unknown; never promise acceptance.'),
    ],
  },
  {
    nodeId: 'lina-input-dispatch', context: object({ store, dispatchClaim: nullable(text('dispatch-claim-001')), busyPolicy: choice(['queue', 'steer', 'interrupt']) }),
    contextSource: 'Recorded accepted operation and service dispatch/busy-policy configuration.',
    reads: ['Durable accepted input and its authorized operation'], writes: ['Proposed branch progress record under a dispatch claim'],
    rules: ['Select the operation already authorized and persisted; do not reinterpret it as ordinary text.', 'Controls, commands and waiting answers bypass ordinary burst collection.', 'Dispatch failure/reclaim semantics are unresolved; retain the accepted record rather than inventing a successful branch.'],
    outputs: [
      output('input.dispatch.ordinary', 'Ordinary input', acceptedWith(ordinaryOperation), inputEdges(16), 'Authorized operation is ordinary.'),
      output('input.dispatch.queue', 'Queue request', acceptedWith(queueOperation), inputEdges(18), 'Authorized operation is explicit Queue.'),
      output('input.dispatch.steer', 'Steer request', acceptedWith(object({ kind: fixed('steer'), targetTurnId: text('turn-001'), guidance: text('Use the updated constraints') })), inputEdges(18), 'Authorized operation is Steer targeting the active turn.'),
      output('input.dispatch.interrupt', 'Interrupt request', acceptedWith(object({ kind: fixed('interrupt'), targetTurnId: text('turn-001'), guidance: text('Replace the task with this request') })), inputEdges(18), 'Authorized operation is Interrupt targeting the active turn.'),
      output('input.dispatch.stop', 'Stop request', acceptedWith(stopOperation), inputEdges(18), 'Authorized operation is Stop targeting the active turn without replacement.'),
      output('input.dispatch.prompt', 'Waiting answer request', acceptedWith(promptOperation), inputEdges(19), 'Authorized operation targets a pending prompt.'),
      output('input.dispatch.command', 'Command request', acceptedWith(commandOperation), inputEdges(20), 'Authorized operation is a service command.'),
      output('input.dispatch.pending', 'Dispatch pending', object({ inputId: text('input-001'), reason: text('dispatch-store-unavailable'), retryAuthorityRequired: fixed(true) }), [], 'Dispatch cannot safely commit or invoke a branch. Recovery/claim detail is not connected yet.'),
    ],
  },
  {
    nodeId: 'lina-input-burst', context: object({ quietWindowMs: count(500), maxBatchInputs: count(5), pending: list(accepted, []), busyPolicy: choice(['queue', 'steer', 'interrupt']) }),
    contextSource: 'Proposed burst policy and same-sender/conversation pending collection. Example values are not decided defaults.',
    reads: ['Source channel/account, sender, conversation, original message identities and arrival order'], writes: ['Pending eligible burst membership until flush'],
    rules: ['CLI passes through immediately; controls and waiting answers never enter this collector.', 'Only eligible messaging text shares a burst; albums retain transport identity.', 'Retain every original record and destination. Cross-channel batching and unfinished-batch recovery remain open.'],
    outputs: [
      output('input.burst.ready', 'Ordered work ready', work, inputEdges(17), 'CLI passthrough or the configured messaging flush condition is met.'),
      output('input.burst.waiting', 'Collecting burst', object({ conversationId: text('conversation-demo'), pendingInputIds: list(text('input-001')), flushAfter: text('2026-10-07T10:00:02Z') }), [], 'Eligible messaging input is still inside its quiet window.'),
    ],
  },
  {
    nodeId: 'lina-input-admission', context: admissionContext,
    contextExamples: [
      { label: 'Idle conversation permits fresh admission', value: admissionContext },
      { label: 'Active owner selects busy Queue policy', value: replaceField(admissionContext, 'activeOwner', activeOwner) },
      { label: 'Active owner selects busy Steer policy', value: replaceField(replaceField(admissionContext, 'activeOwner', activeOwner), 'busyPolicy', fixed('steer')) },
      { label: 'Authorization revoked withholds admission', value: replaceField(admissionContext, 'authorizationCurrent', fixed(false)) },
    ],
    contextSource: 'Conversation service owner state, queue view, configured busy policy and current authorization.',
    reads: ['Ordered accepted work and current owner/fence', 'Current route authorization and blocking uncertain work'], writes: ['Proposed admitted turn identity and execution authority, or busy branch decision'],
    rules: ['Proposed one active ordinary turn per conversation; do not grant a competing owner.', 'Allocate turn identity at fresh admission only; accepted inputs already have input identity.', 'Recheck authority when queued work returns. Uncertain prior work may withhold admission.', 'Ordinary busy policy does not replace explicit control permission checks.'],
    outputs: [
      output('input.admission.granted', 'Fresh turn admitted', admitted, inputEdges(21), 'Authorization and ownership permit starting this work.'),
      output('input.admission.busy-control', 'Busy control selected', object({ work: replaceField(work, 'busyPolicy', choice(['steer', 'interrupt'])), targetTurnId: text('turn-001'), action: choice(['steer', 'interrupt']) }), inputEdges(22), 'Busy policy selects Steer or Interrupt; exact-target authorization must still be checked.'),
      output('input.admission.queued', 'Busy work queued', work, inputEdges(41), 'Busy policy selects Queue.'),
      output('input.admission.blocked', 'Admission withheld', object({ conversationId: text('conversation-demo'), inputIds: list(text('input-001')), reason: choice(['authority-revoked', 'uncertain-owner', 'prior-work-unresolved']) }), [], 'Current authority or unresolved ownership prevents admission; no fresh turn is created.'),
    ],
  },
  {
    nodeId: 'lina-input-control', context: controlContext,
    contextExamples: [
      { label: 'Stale target must not control successor turn', value: replaceField(controlContext, 'activeOwner', object({ turn: replaceField(turn, 'turnId', text('turn-002')), state: fixed('active') })) },
      { label: 'Unsupported steering uses only selected fallback', value: replaceField(controlContext, 'supportsSteering', fixed(false)) },
      { label: 'Interrupt replacement waits for safe release', value: replaceField(replaceField(replaceField(controlContext, 'activeOwner', object({ turn, state: fixed('cancelling') })), 'pendingReplacement', work), 'reconciliationResolved', fixed(false)) },
    ],
    contextSource: 'Exact active-turn coordinator, actor authority, steering capability and retained replacement state.',
    reads: ['Accepted explicit control or selected busy policy', 'Target turn identity and matching owner authority'], writes: ['Admitted guidance/stop intent, retained replacement or queue entry, and control status'],
    rules: ['Queue targets a conversation and needs no active turn identity.', 'Steer, Interrupt and Stop target the exact active turn; stale targets never silently target a successor.', 'Compatible authority is required for steering; cancellation can be signalled before checkpoint consumption.', 'Interrupt replacement waits for safe owner release and reconciliation; Stop does not create replacement work.', 'Cancellation does not undo completed external effects. Interactive controls are deferred.'],
    outputs: [
      output('input.control.steer', 'Active-turn guidance', replaceField(control, 'action', fixed('steer')), executionEdges('turn-control'), 'Exact target and compatible authority match; steering guidance is admitted.'),
      output('input.control.interrupt', 'Interrupt active turn', replaceField(control, 'action', fixed('interrupt')), executionEdges('turn-control'), 'Exact target and authority match; cancellation precedes any replacement admission.'),
      output('input.control.stop', 'Stop active turn', replaceField(replaceField(control, 'action', fixed('stop')), 'guidance', fixed(null)), executionEdges('turn-control'), 'Exact target and authority match; stop intent creates no replacement.'),
      output('input.control.replacement', 'Replacement ready for admission', work, inputEdges(23), 'Interrupt replacement is retained and safe owner release/reconciliation have completed.'),
      output('input.control.status', 'Control accepted', reply('control', 'Control request recorded for the targeted turn.'), inputEdges(26), 'An admitted or queued control has a visible status at its origin.'),
      output('input.control.refused', 'Control refused', reply('refusal', 'The control target is stale or you do not have permission.'), inputEdges(26), 'The target is stale or authority is incompatible; no active-turn control is emitted.'),
      output('input.control.queue', 'Conversation queue request', work, inputEdges(42), 'Explicit Queue or the selected unsupported-Steer fallback queues work without starting it.'),
      output('input.control.waiting', 'Await safe replacement admission', object({ targetTurnId: text('turn-001'), replacement: work, awaiting: choice(['owner-release', 'reconciliation']) }), [], 'Interrupt cancellation was requested but replacement cannot start safely yet.'),
    ],
  },
  {
    nodeId: 'lina-input-prompt', context: promptContext,
    contextExamples: [
      { label: 'Stale or missing prompt refuses resolution', value: replaceField(promptContext, 'pendingPrompt', fixed(null)) },
      { label: 'Responder permission denied leaves waiting work unchanged', value: replaceField(promptContext, 'responderPermissionsCurrent', fixed(false)) },
    ],
    contextSource: 'Pending-prompt registry and current responder/operation permission state.',
    reads: ['Prompt, owning turn, responder identity, explicit answer and expiry state'], writes: ['Proposed matched resolution and response status, retaining operation identity'],
    rules: ['Approval requires explicit approval identity/action; plain yes never grants approval.', 'Unambiguous ordinary text may answer a clarification only.', 'Reject stale, ambiguous or unauthorized answers. Expiry policy remains open.', 'Resolve owning waiting work rather than starting a new turn.'],
    outputs: [
      output('input.prompt.matched', 'Matched waiting answer', promptAnswer, executionEdges('prompt-answer'), 'One active prompt, owning turn and permitted responder match.'),
      output('input.prompt.status', 'Resolution accepted', reply('control', 'Prompt answer accepted for the owning operation.'), inputEdges(24), 'The answer matches a live prompt and authorized responder.'),
      output('input.prompt.refused', 'Resolution refused', reply('refusal', 'The prompt answer is stale, ambiguous or unauthorized.'), inputEdges(24), 'No authorized live prompt can accept this response; waiting work is unchanged.'),
    ],
  },
  {
    nodeId: 'lina-input-command', context: object({ actorPermissions, activeOwner, handlers: list(choice(['status', 'reset', 'configure'])), serviceAvailable: flag(true) }),
    contextSource: 'Service command registry, selected conversation state and separate administrative authority.',
    reads: ['Parsed authorized command and command-specific arguments', 'Current owner/busy state'], writes: ['Only the owning command component may change its settings or conversation state'],
    rules: ['Status does not launch a model turn.', 'Check each mutating command\'s authority and busy policy before invoking its owner.', 'Unsafe active-work changes receive a visible rejection; reset/configuration policies remain open.'],
    outputs: [
      output('input.command.result', 'Command result', reply('command', 'Conversation status is available.'), inputEdges(25), 'The authorized command completed.'),
      output('input.command.refused', 'Command refused', reply('refusal', 'This command cannot change the conversation while work is active.'), inputEdges(25), 'Authority or command-specific busy policy refuses the change.'),
      output('input.command.failed', 'Command failed', reply('status', 'The command could not complete; its state needs inspection.'), inputEdges(25), 'The owning command handler failed or reported an unknown outcome.'),
    ],
  },
  {
    nodeId: 'lina-input-runtime', context: runtimeContext,
    contextExamples: [
      { label: 'Known-safe preparation resume restores current round', value: replaceField(runtimeContext, 'executionRecord', object({ checkpoint, state: restoredState, nextIntent: fixed('continue'), terminalReason: fixed(null) })) },
    ],
    contextSource: 'Execution boundary coordinator and current admitted/resumed ownership authority.',
    reads: ['Fresh admitted work or explicitly safe checkpoint selected by recovery', 'Execution records reconstruct existing round, settled results, limits and pending intent before safe resume'], writes: ['Proposed handoff progress only; no second admission or turn identity'],
    rules: ['Fresh admission consumes the existing turn and authority at Start turn.', 'Original attachment references remain distinct from derived content.', 'A recovered checkpoint must not go through fresh initialization. Reconstruct current state from execution records and select only its explicitly safe nextStep.', 'Unknown handoff acknowledgement does not authorize starting another owner.'],
    outputs: [
      output('input.runtime.fresh', 'Fresh execution handoff', admitted, executionEdges('handoff'), 'Input is newly admitted work with valid execution authority.'),
      output('input.runtime.resume-prepare', 'Resume existing round preparation', resume('prepare'), executionEdges('resume-prepare'), 'Known-safe checkpoint nextStep is prepare; reconstruct existing turn/round state without Start turn.'),
      output('input.runtime.resume-controls', 'Resume control checkpoint', resume('controls'), executionEdges('resume-controls'), 'Known-safe checkpoint nextStep is controls; restore pending intent and settled results without fresh admission.'),
      output('input.runtime.resume-settle', 'Resume settlement', resume('settle'), executionEdges('resume-settle'), 'Known-safe checkpoint nextStep is settle; restore terminal reason and required work without model replay.'),
      output('input.runtime.blocked', 'Execution handoff withheld', object({ turnId: text('turn-001'), reason: choice(['authority-invalid', 'handoff-unknown']) }), [], 'Authority is invalid or ownership transfer cannot be established.'),
    ],
  },
  {
    nodeId: 'lina-input-delivery', context: deliveryContext,
    contextExamples: [
      { label: 'Known failed send permits policy-selected saved-output retry', value: replaceField(deliveryContext, 'priorSend', object({ outputId: text('output-001'), state: fixed('failed'), transportReceipt: fixed(null) })) },
      { label: 'Unknown send outcome requires delivery reconciliation', value: replaceField(deliveryContext, 'priorSend', object({ outputId: text('output-001'), state: fixed('unknown'), transportReceipt: fixed(null) })) },
      { label: 'Authenticated delivery observation still needs saved outbound correlation', value: replaceField(deliveryContext, 'outboundCorrelation', outboundCorrelation) },
    ],
    contextSource: 'Origin-channel delivery adapter, saved-output store and recorded send/retrieval status.',
    reads: ['Saved output and explicit original destination', 'Known transport receipt and authorized destination changes', 'Authenticated adapter status observation and saved account/provider-message-to-output correlation'], writes: ['Proposed delivery attempts, receipts and uncertainty status', 'Correlated transport-status observations; never new input acceptance or agent execution'],
    rules: ['Send to the originating destination unless an explicit authorized change is recorded.', 'Retry saved output without rerunning agent execution.', 'Unknown send acknowledgement requires delivery reconciliation; it does not prove failure or receipt.', 'Delivery is independent of execution outcome and ownership release; budgets and reconciliation remain open.', 'A status observation never starts or reruns an agent and never creates ordinary input acceptance.', 'Authentication alone does not establish output identity: match account and provider message identity against saved outbound correlation before recording delivered/read status.', 'Provider delivered/read observations describe transport-reported status; exact WhatsApp wire parsing remains integration-specific and pending.'],
    outputs: [
      output('input.delivery.sent', 'Known delivery result', object({ outputId: text('output-001'), destination, transportReceipt: text('transport-receipt-001'), status: fixed('sent') }), [], 'Transport reports successful sending; user reading is not established.'),
      output('input.delivery.saved', 'Saved output retrievable', object({ outputId: text('output-001'), retrievalRef: text('saved-output:output-001'), requiresAuthorization: fixed(true) }), [], 'Output remains saved for authorized retrieval independent of sending.'),
      output('input.delivery.retry', 'Delivery retry pending', object({ output: outputRecord, reason: text('transport-unavailable'), replayExecution: fixed(false) }), [], 'Send failure is known and a future delivery policy permits retry.'),
      output('input.delivery.observed-delivered', 'Correlated delivery observed', object({ outputId: text('output-001'), providerMessageId: text('provider-message-001'), accountId: text('account-demo'), observedStatus: fixed('delivered'), recordedAt: text('2026-10-07T10:00:04Z'), evidenceScope: fixed('authenticated-provider-observation') }), [], 'Authenticated delivered observation matches a saved outbound account/message correlation; no execution is launched.'),
      output('input.delivery.observed-read', 'Correlated read observation', object({ outputId: text('output-001'), providerMessageId: text('provider-message-001'), accountId: text('account-demo'), observedStatus: fixed('read'), recordedAt: text('2026-10-07T10:00:05Z'), evidenceScope: fixed('authenticated-provider-observation') }), [], 'Authenticated provider read status matches a saved outbound message; this is provider evidence, not independent proof of a person reading.'),
      output('input.delivery.uncorrelated', 'Unmatched delivery observation', object({ accountId: text('account-demo'), providerMessageId: text('provider-message-unknown'), reason: fixed('saved-outbound-correlation-missing'), createsAcceptedInput: fixed(false) }), [], 'No saved outbound mapping establishes the corresponding output; do not attach this status to an unrelated output.'),
      output('input.delivery.uncertain', 'Delivery reconciliation required', object({ outputId: text('output-001'), evidenceRef: text('delivery-evidence:output-001'), replayExecution: fixed(false) }), [], 'External send may have succeeded but acknowledgement is missing.'),
    ],
  },
  {
    nodeId: 'lina-input-recovery',
    external: [{ label: 'Restart recovery scan', source: 'Service startup or authorized recovery worker over durable accepted records.', value: object({ scanId: text('restart-scan-001'), inputId: text('input-001') }) }],
    context: recoveryContext,
    contextExamples: [
      { label: 'Unstarted accepted input returns to dispatch', value: recoveryContext },
      { label: 'Known-safe checkpoint resumes existing turn', value: replaceField(replaceField(replaceField(recoveryContext, 'phase', fixed('checkpointed')), 'storedCheckpoint', checkpoint), 'recoveryAuthority', authority) },
      { label: 'Saved answer retries delivery without execution', value: replaceField(replaceField(recoveryContext, 'phase', fixed('answer-saved')), 'savedAnswer', reply('answer', '4')) },
      { label: 'Uncertain effect retains authority for reconciliation', value: replaceField(replaceField(replaceField(recoveryContext, 'phase', fixed('uncertain')), 'uncertainOperation', uncertainty), 'recoveryAuthority', authority) },
    ],
    contextSource: 'Durable accepted/admission records, saved outputs, checkpoint evidence and fresh authorization/ownership checks.',
    reads: ['Recorded input progress, original route and known tool outcomes', 'Current authority and prior owner evidence'], writes: ['Proposed recovery claim and selected safe recovery path'],
    rules: ['Restart reads existing accepted identity instead of creating a new source event.', 'Unstarted accepted work returns to dispatch, which still applies its recorded operation.', 'Resume only a known-safe checkpoint under valid authority; never blindly repeat uncertain effects.', 'Saved-answer delivery skips execution. Recovery claims/checkpoint safety remain open.'],
    outputs: [
      output('input.recovery.unstarted', 'Unstarted accepted work', accepted, inputEdges(29), 'No execution began and current authority permits restored dispatch.'),
      output('input.recovery.checkpoint', 'Known-safe checkpoint', checkpoint, inputEdges(45), 'Evidence establishes safe resumption under retained or transferred authority.'),
      output('input.recovery.answer', 'Saved answer for delivery', reply('answer', '4'), inputEdges(46), 'An answer is already saved; execution must not rerun.'),
      output('input.recovery.uncertain', 'Uncertain execution', uncertainty, inputEdges(47), 'An effect or execution outcome is unresolved; reconcile before any continuation.'),
      output('input.recovery.blocked', 'Recovery withheld', object({ inputId: text('input-001'), reason: choice(['authorization-revoked', 'owner-unknown', 'missing-evidence']) }), [], 'Safe ownership or current authorization cannot be established.'),
    ],
  },
  {
    nodeId: 'lina-input-queue',
    external: [{ label: 'Authorized queue wake', source: 'Conversation service resume policy or authorized operator.', value: object({ conversationId: text('conversation-demo'), action: fixed('resume'), actorId: text('person-demo') }) }],
    context: queueContext,
    contextExamples: [
      { label: 'Empty queue has no work to admit', value: queueContext },
      { label: 'Pending entry rechecks admission with owner free', value: replaceField(queueContext, 'entries', list(queueEntry)) },
      { label: 'Active owner retains waiting entry', value: replaceField(replaceField(queueContext, 'entries', list(queueEntry)), 'activeOwner', activeOwner) },
      { label: 'Paused queue retains waiting entry', value: replaceField(replaceField(queueContext, 'entries', list(queueEntry)), 'paused', fixed(true)) },
      { label: 'Unresolved prior work blocks queue draining', value: replaceField(replaceField(queueContext, 'entries', list(queueEntry)), 'blockedByUncertainty', fixed(true)) },
    ],
    contextSource: 'Conversation-owned queue records and current owner, pause and unresolved-work state. Limits and durability remain proposed.',
    reads: ['Ordinary/explicit queued work or matching owner-release event', 'Waiting records, current owner and configured ordering'], writes: ['Queue membership and proposed drain claim; never new execution authority'],
    rules: ['Queue belongs to conversation, not the active turn.', 'Release/wake is a signal to recheck admission, not permission to start execution.', 'Preserve original input order/identity; persistence and exact ordering policies remain open.', 'Do not drain behind unresolved prior work or while paused.'],
    outputs: [
      output('input.queue.admission', 'Next work for admission', work, inputEdges(43), 'Queue policy permits one waiting entry to recheck current admission.'),
      output('input.queue.waiting', 'Queue waiting', object({ conversationId: text('conversation-demo'), entryIds: list(text('queue-001')), reason: choice(['owner-active', 'paused', 'unresolved-work']) }), [], 'Entries are retained while safe draining is unavailable.'),
      output('input.queue.empty', 'No queued work', object({ conversationId: text('conversation-demo'), remaining: fixed(0) }), [], 'Release/wake finds no eligible waiting entry.'),
      output('input.queue.refused', 'Queue capacity/persistence failure', object({ conversationId: text('conversation-demo'), inputIds: list(text('input-001')), reason: choice(['capacity', 'persistence-unavailable', 'commit-unknown']) }), [], 'Configured queue policy cannot safely retain work; accepted responsibility must remain recorded.'),
    ],
  },
  {
    nodeId: 'lina-input-reconcile', context: reconcileContext,
    contextExamples: [
      { label: 'Authorized evidence-backed resume selects checkpoint', value: replaceField(replaceField(reconcileContext, 'operatorDecision', object({ actorId: text('operator-demo'), authorized: fixed(true), decision: fixed('resume-safe') })), 'candidateCheckpoint', checkpoint) },
    ],
    contextSource: 'Operation evidence, retained/transferred fenced ownership and authorized reconciliation decisions.',
    reads: ['Uncertain effect and observed operation evidence', 'Required outstanding work and authority for any safe follow-up'], writes: ['Known outcome or unresolved decision status, and proposed safe checkpoint'],
    rules: ['Never blindly retry an uncertain tool or assume a timeout stopped it.', 'Retain or transfer fenced ownership while required work remains unresolved.', 'Only evidence-backed safe follow-up may return to the runtime checkpoint-resume boundary.', 'Reconciliation permission, checkpoints and eventual release remain open.'],
    outputs: [
      output('input.reconcile.safe', 'Known-safe resume selected', checkpoint, inputEdges(48), 'Evidence and authority establish a safe checkpoint; fresh Start turn is not appropriate.'),
      output('input.reconcile.status', 'Recorded reconciliation status', reply('status', 'An operation outcome needs reconciliation before execution can resume.'), inputEdges(49), 'A saved status/decision request can be delivered without repeating execution.'),
      output('input.reconcile.waiting', 'Outcome still unresolved', object({ turn, operationId: text('call-001'), authorityRetained: fixed(true), awaiting: choice(['external-evidence', 'authorized-decision', 'required-work']) }), [], 'Evidence is insufficient; ownership is not cleanly released.'),
    ],
  },
];

const resolvedRead = object({ callId: text('call-001'), outcome: fixed('success'), value: fixed(4) });
const addDependencies = (value: Payload, fields: Record<string, Payload>) => object({ ...Object.fromEntries(Object.entries(value.schema.properties ?? {}).map(([key, schema]) => [key, { schema, example: (value.example as Record<string, import('./schema').Json>)[key] }])), ...fields });
const scopedWait = object({ waitId: text('wait:approval:call-001'), waitKind: choice(['tool-approval', 'tool-input', 'user-clarification']), owningNodeId: text('lina-tools-permissions'), batchId: text('batch-001'), callId: nullable(text('call-001')), attemptId: sample(nullable(text('adapter-attempt-001')), null), bindingGeneration: count(4), answerSchemaRef: text('answer-schema:approval:v1'), accountId: text('account-demo'), answerEvidenceRef: text('answer-evidence:prompt-001') });
const checkpointCorrelation = object({ stateRevision: count(3), ownerFence: count(1), batchId: text('batch-001'), settledCallIds: list(text('call-002'), ['call-002']), activeCallIds: list(text('call-001'), []), pendingWaitIds: list(text('wait:approval:call-001'), ['wait:approval:call-001']), unresolvedEffectCallIds: list(text('call-001'), []), safeResumeEntry: choice(['prepare', 'controls', 'settle', 'wait', 'reconcile'], 'wait') });
for (const definition of inputExecutionContracts) {
  const fields: Record<string, Payload> = {};
  if (['custody', 'delivery'].some(id => definition.nodeId === `lina-input-${id}`)) fields.channelBinding = object({ connectionId: text('conn-original-account-demo'), adapterRef: text('adapter:origin:v1'), accountId: text('account-demo'), ownerScopeRef: text('owner:person-demo'), configurationRevision: count(2), readinessGeneration: count(4), credentialRef: text('credential:origin-demo'), state: choice(['ready', 'authentication-required', 'unavailable', 'disabled']) });
  if (['queue', 'recovery', 'runtime', 'reconcile'].some(id => definition.nodeId === `lina-input-${id}`)) fields.checkpointCorrelation = checkpointCorrelation;
  if (['accept', 'dispatch', 'queue', 'recovery', 'runtime', 'reconcile', 'delivery'].some(id => definition.nodeId === `lina-input-${id}`)) fields.stateOwner = object({ serviceRef: text('future-state-owner'), implemented: fixed(false), writeIdentityRef: text('write:input-001:v1'), expectedStateRevision: count(3) });
  if (definition.nodeId === 'lina-input-prompt') fields.retainedWait = scopedWait;
  if (Object.keys(fields).length) {
    definition.context = addDependencies(definition.context, fields);
    definition.contextExamples = definition.contextExamples?.map(example => ({ ...example, value: addDependencies(example.value, fields) }));
  }
  if (definition.nodeId === 'lina-input-control') definition.outputs = definition.outputs.map(value => value.id === 'input.control.steer' ? { ...value, edgeIds: executionEdges('turn-steer') } : value);
  if (definition.nodeId === 'lina-input-prompt') {
    definition.outputs = definition.outputs.map(value => value.id === 'input.prompt.matched' ? output(value.id, value.label, addDependencies(promptAnswer, { wait: scopedWait, answerEvidenceRef: text('answer-evidence:prompt-001'), continuationGranted: fixed(false) }), value.edgeIds, 'Exact prompt/wait/turn/call/responder/account/generation match; the operation owner still validates the answer.') : value);
    definition.rules.push('Wrong account, stale arguments or binding generation and duplicate answers retain pending work. OAuth callbacks are verified by connection ownership, never treated as ordinary chat answers.');
  }
  if (definition.nodeId === 'lina-input-runtime') definition.outputs.push(output('input.runtime.resume-wait', 'Restore retained wait', object({ checkpoint: addDependencies(replaceField(checkpoint, 'nextStep', fixed('wait')), { correlation: checkpointCorrelation }), restoredState, resumeAt: fixed('wait'), retainedWait: scopedWait, replayDispatchAllowed: fixed(false) }), executionEdges('resume-wait'), 'Known-safe restart restores the wait, siblings and counters. Restore correlation without another call or turn.'));
  if (definition.nodeId === 'lina-input-queue') definition.rules.push('Drain rechecks current source, conversation and operation policy; prior admission does not grant permanent permission. Owner-release and queue entries are deduplicated by exact identity and fence.');
  if (definition.nodeId === 'lina-input-delivery') {
    definition.outputs.push(output('input.delivery.status-observation', 'Account-correlated delivery observation', object({ outputId: text('output-001'), providerMessageId: nullable(text('provider-message-001')), accountId: text('account-demo'), state: choice(['created', 'queued', 'sent', 'failed', 'unknown', 'delivered']), observedAt: text('2026-10-08T10:00:05Z'), turnExecutionRepeated: fixed(false) }), [], 'Observed send lifecycle is retained separately from acceptance, execution completion and user consumption.'));
    definition.rules.push('Unknown acknowledgement never permits blind resend. Retry saved delivery independently from model/tool execution. Output service ownership remains a future dependency.');
  }
  if (definition.nodeId === 'lina-input-reconcile') {
    const sibling = object({ callId: text('call-002'), outcome: fixed('success'), value: fixed(6) });
    definition.outputs.push(output('execution.reconciled-batch', 'Publish evidence-resolved batch', object({ state: replaceField(restoredState, 'results', list(importedResult, [resolvedRead.example, sibling.example])), round: object({ roundId: text('round-001'), index: count(1) }), batchId: text('batch-001'), requestedCallIds: list(text('call-001'), ['call-001', 'call-002']), results: list(importedResult, [resolvedRead.example, sibling.example]), evidenceRef: text('reconciliation-evidence:batch-001'), effectEvidence: fixed('known-success'), pendingCallIds: fixed([]), authorityRetained: fixed(true) }), executionEdges('reconcile-publish'), 'External evidence proves every required result; retain successful siblings and return to ordinary Tools publication.'), output('execution.reconciliation-terminal', 'Resolved evidence requires terminal settlement', object({ state: restoredState, round: object({ roundId: text('round-001'), index: count(1) }), terminal: object({ turn, outcome: fixed('cancelled'), reason: text('stop_requested'), requiredWorkResolved: fixed(true) }), candidate: fixed(null), evidenceRef: text('reconciliation-evidence:cancelled-batch-001') }), executionEdges('reconcile-settle'), 'Evidence resolves required work but cancellation intent prevents another model round.'));
    definition.rules.push('Operator acknowledgement cannot convert unknown effects into known success. Full batch identity, settled siblings and exact attempt evidence must survive reconciliation. Resume checkpoint and publish known batch are distinct routes.');
  }
}
const custodyContract = inputExecutionContracts.find(definition => definition.nodeId === 'lina-input-custody')!;
custodyContract.rules.push('Failed secret retrieval, unavailable binding or changed original retrieval account use known pre-acceptance failure. Never fetch through another account silently.');
custodyContract.contextExamples ??= [];
custodyContract.contextExamples.push({ label: 'Original retrieval binding changed', value: addDependencies(custodyContract.context, { originalBindingGeneration: count(4), currentBindingGeneration: count(5), originalAccountId: text('account-original-demo'), currentAccountId: text('account-other-demo'), retrievalAllowed: fixed(false) }) });
// This alternative includes explicit evidence alongside the usual dependencies;
// reflect it in the local context union rather than silently accepting unknown keys.
const custodyAlternate = custodyContract.contextExamples.at(-1)!.value;
custodyContract.context = { schema: { anyOf: [custodyContract.context.schema, custodyAlternate.schema] }, example: custodyContract.context.example };
const reconciler = inputExecutionContracts.find(definition => definition.nodeId === 'lina-input-reconcile')!;
const noEffectResult = object({ callId: text('call-001'), outcome: fixed('error'), code: text('confirmed-no-effect'), message: text('Authoritative operation evidence confirms no external change occurred.'), correctable: fixed(true) });
const preservedPeer = object({ callId: text('call-002'), outcome: fixed('success'), value: fixed(6) });
reconciler.outputs.push(output('execution.reconciled-batch-no-effect', 'Publish proven no-effect plus settled sibling', object({ state: replaceField(restoredState, 'results', list(importedResult, [noEffectResult.example, preservedPeer.example])), round: object({ roundId: text('round-001'), index: count(1) }), batchId: text('batch-001'), requestedCallIds: list(text('call-001'), ['call-001', 'call-002']), results: list(importedResult, [noEffectResult.example, preservedPeer.example]), evidenceRef: text('reconciliation-evidence:batch-001:no-effect'), effectEvidence: fixed('known-no-effect'), pendingCallIds: fixed([]), authorityRetained: fixed(true), retryAuthorized: fixed(false) }), executionEdges('reconcile-publish'), 'Authoritative evidence proves the uncertain operation did not occur. Retain its explicit error and sibling success; evidence does not silently authorize replay.'));
