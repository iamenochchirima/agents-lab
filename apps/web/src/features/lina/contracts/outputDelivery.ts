/** Source-owned Output handoffs. State acknowledgements preserve transaction
 * identity and never mean a channel action has taken place. */
import { OUTPUT_EDGES, OUTPUT_STATE_ROUTES } from '../outputBlock';
import { choice, count, fixed, flag, list, object, output, replaceField, text, type ContractDefinition, type Payload, type Json } from './schema';
import { outputIdentity, outputIntent, outputRecipientPlan, outputPart, outputAttempt, outputObservation, outputObligation, outputStreamRevision, outputSettlement, outputLocalContext, outputArtifact, outputPrompt, outputTypedResult, outputRetryDecision, outputText, outputClaim, outputNotificationEligibility, outputMediaHandle, outputClarificationPrompt, outputUpload } from './outputRecords';
export const outputPhases = ['intent', 'route', 'policy', 'render', 'media', 'stream', 'register', 'schedule', 'send', 'observe', 'retry', 'reconcile', 'settle'] as const;
export const outputStatuses: Record<string, string[]> = {
    intent: ['external', 'internal', 'quiet', 'invalid', 'duplicate-final'], route: ['bound', 'fanout', 'missing', 'ambiguous', 'stale'], policy: ['allowed', 'permission-wait', 'deferred', 'rejected', 'suppressed'], render: ['ready', 'fallback', 'invalid', 'unsupported'], media: ['ready', 'expired', 'denied', 'unavailable', 'unknown'], stream: ['prepared', 'block-complete', 'promotion-candidate', 'stale', 'aborted'], register: ['stored', 'existing', 'best-effort', 'storage-failed', 'storage-unknown'], schedule: ['ready', 'deferred', 'cancelled', 'superseded', 'exhausted'], send: ['accepted', 'proven-unsent', 'rejected', 'partial', 'unknown'], observe: ['accepted', 'delivered', 'read', 'partial', 'duplicate', 'stale', 'unmatched', 'failed', 'unknown'], retry: ['safe-retry', 'deferred', 'permanent', 'exhausted', 'reconcile'], reconcile: ['confirmed-sent', 'proven-unsent', 'unresolved', 'contradictory'], settle: ['accepted', 'failed', 'suppressed', 'cancelled', 'stale', 'unresolved'],
};
const rules: Record<string, string[]> = {
    intent: ['Keep producer/output identity, audience and finality. Internal child results never acquire an external route implicitly.', 'Suppress duplicate final only with confirmed same-target same-content evidence; distinct new content remains owed. Quiet completion is explicit.'],
    route: ['Bind account/chat/thread/reply and conversation incarnation under exact authority. No silent account switch or thread drift.', 'Fanout has independent recipient identities, obligations and outcomes; native capabilities are versioned facts, not permissions.'],
    policy: ['Apply disclosure before preview or final exposure; private reasoning and tool details require separate authority.', 'Safety owns permission. Native readiness, service-window/template/opt-in eligibility and public content policy are separate constraints.'],
    render: ['Preserve canonical typed result bytes and schema identity while rendering ordered native parts.', 'Enforce declared text/escaping/code-fence limits. Preserve all four approval choices through an explicit fallback. JSONL/RPC stdout contains no diagnostics.'],
    media: ['Consume authorized retained bytes/digest and versioned custody, never an arbitrary sandbox path.', 'Native upload handles are account/digest/expiry scoped. Unknown upload retains original attempt; required custody survives cleanup.'],
    stream: ['Serialize admitted public revisions through shared transport; no raw model delta sends directly.', 'Preview acceptance never fulfills required final. Stale revisions cannot overwrite a sealed final; Stop cannot retract prior exposure.'],
    register: ['Required obligation custody and prepared bytes are acknowledged before dispatch and execution release.', 'Unknown registration inspects original transaction. Required storage failure never downgrades silently to best-effort.'],
    schedule: ['Acquire exact due part under account/recipient/thread ordering and current fence.', 'Independent recipients may run concurrently. Only declared best-effort updates may coalesce; owed finals and prompts retain explicit outcomes.'],
    send: ['Recheck exact prepared digest, route binding, claim, policy, cancellation and readiness at the effect boundary.', 'Persist send-start before native effect. Credential references are opaque. Unknown acknowledgement is not proof of failure and cannot authorize blind replay.'],
    observe: ['Correlate account/provider/recipient/part/revision and retain raw observations including duplicates.', 'Derive status without regressing known facts. Provider read is not human-read proof. Late evidence cannot revive approvals or authorize dispatch.'],
    retry: ['Retry only proven safe original unsent parts within deadline/provider wait and a current admitted claim.', 'Never rerun the agent or resend accepted siblings. Unknown non-idempotent sends require reconciliation.'],
    reconcile: ['Restore original saved identity, payload, attempts and evidence; adapter/operator observation is not a fresh send.', 'Conservative unknown hold is default. Warned resend requires explicit duplicate-risk authorization. Lease expiry and missing receipts do not prove unsent.'],
    settle: ['Settle per part and recipient at declared acceptance/delivery/read threshold. Fanout is not atomic.', 'Transfer retained artifact ownership before cleanup. Turn success/release, prompt approval and delivery are different facts; unresolved effects retain ownership.'],
};
export function outputPhasePayload(phase: string, status: string): Payload {
    const fields: Record<string, Payload> = { identity: outputIdentity, phase: fixed(phase), status: fixed(status), evidenceSource: fixed('design-fixture'), actualExternalSendPerformed: fixed(false), agentRerunAllowed: fixed(false) };
    if (phase === 'intent') {
        fields.intent = status === 'internal' ? replaceField(replaceField(replaceField(outputIntent, 'audience', fixed('internal-parent')), 'finality', fixed('internal')), 'category', fixed('child-result')) : status === 'quiet' || status === 'duplicate-final' ? replaceField(outputIntent, 'content', list(object({ kind: fixed('quiet'), reason: fixed(status === 'duplicate-final' ? 'duplicate-final' : 'policy-silence'), confirmedTargetEvidenceRef: status === 'duplicate-final' ? text('receipt:tool-send:same-target:same-content') : fixed(null) }))) : outputIntent;
        if (status === 'internal')
            fields.intent = replaceField(fields.intent, 'content', list(object({ kind: fixed('internal-result'), parentTaskId: text('task:parent:001'), childTaskId: text('task:child:001'), resultRef: text('artifact:child-result:001'), publicationAuthorized: fixed(false) })));
        fields.externalRoutingAllowed = fixed(status === 'external');
        fields.confirmedDuplicateEvidenceRef = status === 'duplicate-final' ? text('receipt:tool-send:same-target:same-content') : fixed(null);
    }
    if (phase === 'route') {
        fields.plan = outputRecipientPlan;
        fields.recipientPlans = list(outputRecipientPlan, status === 'fanout' ? [outputRecipientPlan.example, replaceField(replaceField(replaceField(outputRecipientPlan, 'deliveryId', text('delivery:output:002')), 'recipientId', text('recipient:output:002')), 'destination', replaceField({ schema: outputRecipientPlan.schema.properties!.destination, example: (outputRecipientPlan.example as Record<string, Json>).destination }, 'chatId', text('chat-second-demo'))).example] : [outputRecipientPlan.example]);
        fields.fanoutAtomic = fixed(false);
        fields.routeChangedWithoutAuthorization = fixed(false);
    }
    if (phase === 'policy') {
        fields.plan = outputRecipientPlan;
        fields.admissionRef = status === 'allowed' ? text('safety:output:001') : fixed(null);
        fields.eligibility = choice(['service-window', 'approved-template', 'not-required', 'ineligible'], status === 'rejected' ? 'ineligible' : 'not-required');
        fields.outputOwnsApproval = fixed(false);
        fields.notificationEligibility = fixed(null);
    }
    if (phase === 'render') {
        fields.parts = list(outputPart);
        fields.canonicalStructuredResult = fixed(null);
        fields.prompt = status === 'fallback' ? outputPrompt : fixed(null);
        if (status === 'fallback')
            fields.parts = list(replaceField(replaceField(replaceField(outputPart, 'kind', fixed('prompt')), 'controlsFallback', fixed('numbered-four-choices')), 'text', text('1. Allow once\n2. Allow session\n3. Allow always\n4. Deny')));
        fields.fourChoicesPreserved = fixed(true);
        fields.fallback = fixed(status === 'fallback' ? 'numbered-four-choices' : 'none');
    }
    if (phase === 'media') {
        fields.artifact = status === 'denied' ? replaceField(outputArtifact, 'authorizedForRecipient', fixed(false)) : outputArtifact;
        fields.custodyBytesAvailable = fixed(status !== 'unavailable');
        fields.nativeHandle = status === 'ready' ? outputMediaHandle : fixed(null);
        fields.originalUploadId = text('upload:output:001');
        fields.upload = replaceField(replaceField(replaceField(outputUpload, 'effectBoundary', fixed(status === 'ready' ? 'accepted' : status === 'unknown' ? 'unknown' : 'not-started')), 'nativeHandle', status === 'ready' ? outputMediaHandle : fixed(null)), 'stateAcknowledgementRef', status === 'ready' || status === 'unknown' ? text('state-ack:upload:001') : fixed(null));
        fields.cleanupPermittedByPathAlone = fixed(false);
    }
    if (phase === 'stream') {
        fields.stream = replaceField(outputStreamRevision, 'state', fixed(status === 'prepared' ? 'coalesced' : status));
        fields.acceptedPreviewFulfillsFinal = fixed(false);
        fields.newSendAuthorizedByDelta = fixed(false);
    }
    if (phase === 'register') {
        fields.obligation = status === 'best-effort' ? replaceField(outputObligation, 'plan', replaceField(replaceField(outputRecipientPlan, 'policy', fixed('best-effort')), 'parts', list(replaceField(outputPart, 'required', fixed(false))))) : outputObligation;
        fields.custodyAcknowledged = fixed(status === 'stored' || status === 'existing');
        fields.requiredDowngradedToBestEffort = fixed(false);
        fields.inspectOriginalTransaction = fixed(status === 'storage-unknown');
    }
    if (phase === 'schedule') {
        fields.obligation = outputObligation;
        fields.part = outputPart;
        fields.dispatchEligible = fixed(status === 'ready');
        fields.discardRequiredPart = fixed(false);
    }
    if (phase === 'send') {
        fields.attempt = replaceField(replaceField(replaceField(outputAttempt, 'effectBoundary', fixed(status === 'accepted' || status === 'partial' ? 'accepted' : status === 'unknown' ? 'unknown' : status === 'proven-unsent' ? 'not-started' : 'known-rejected')), 'sendStartRecorded', fixed(status !== 'proven-unsent')), 'providerMessageId', status === 'accepted' || status === 'partial' ? text('provider-message:001') : fixed(null));
        fields.effectCertainty = fixed(status === 'unknown' ? 'unknown' : 'known');
        fields.confirmedPartIds = list(text('part:output:001:0'), status === 'partial' || status === 'accepted' ? ['part:output:001:0'] : []);
        fields.unsentSiblingIds = list(text('part:output:001:1'), status === 'partial' ? ['part:output:001:1'] : []);
    }
    if (phase === 'observe') {
        fields.observation = replaceField(replaceField(outputObservation, 'fact', fixed(['accepted', 'delivered', 'read'].includes(status) ? status : status === 'failed' ? 'rejected' : status === 'unknown' ? 'unknown' : 'accepted')), 'correlation', fixed(['duplicate', 'stale', 'unmatched'].includes(status) ? status : 'matched'));
        fields.regressPriorKnownFacts = fixed(false);
        fields.receiptAuthorizesNewWork = fixed(false);
        if (status === 'stale')
            fields.observation = replaceField(replaceField(fields.observation, 'observedOwnerFence', count(3)), 'cancellationObserved', fixed(true));
    }
    if (phase === 'retry') {
        fields.decision = replaceField(replaceField(outputRetryDecision, 'decision', fixed(status === 'safe-retry' ? 'retry' : status === 'deferred' ? 'defer' : status === 'reconcile' ? 'reconcile' : 'fail')), 'certainty', fixed(status === 'reconcile' ? 'unknown' : 'known-unsent'));
        fields.retryAcceptedPart = fixed(false);
    }
    if (phase === 'reconcile') {
        fields.originalAttempt = outputAttempt;
        fields.effectFact = fixed(status === 'confirmed-sent' ? 'accepted' : status === 'proven-unsent' ? 'proven-unsent' : status === 'contradictory' ? 'contradictory' : 'unknown');
        fields.blindResendAllowed = fixed(false);
        fields.retainOriginalObligation = fixed(status === 'unresolved' || status === 'contradictory');
    }
    if (phase === 'settle') {
        fields.settlement = replaceField(replaceField(outputSettlement, 'status', fixed(status)), 'unresolvedReason', status === 'unresolved' ? text('Original effect still unknown.') : fixed(null));
        fields.retentionTransferred = fixed(status === 'accepted' || status === 'suppressed');
        fields.artifactDeletionAuthorizedByAcceptanceAlone = fixed(false);
        fields.executionWaitsForRead = fixed(false);
        fields.settlement = replaceField(fields.settlement, 'partOutcomes', list(object({ partId: text('part:output:001:0'), status: fixed(status === 'accepted' ? 'accepted' : status === 'unresolved' ? 'unknown' : status === 'cancelled' || status === 'stale' || status === 'suppressed' ? 'cancelled' : 'failed'), evidenceRefs: list(text('observation:delivery:001:1'), status === 'accepted' ? ['observation:delivery:001:1'] : []) })));
    }
    return object(fields);
}
export const outputDeliveryContracts: ContractDefinition[] = outputPhases.map(phase => ({ nodeId: `lina-output-${phase}`, context: outputLocalContext, contextSource: 'Output coordinator loads original scoped intent, immutable prepared parts and State evidence. Deterministic fixtures only.', reads: ['Original output/recipient/part identity, route authority, prepared digest and owner generation', 'Phase-specific capability, admission, custody, claim and native evidence'], writes: ['Correlated phase outcome or exact existing-owner request; State owns persisted records'], rules: rules[phase], outputs: [] }));
type Edge = {
    id: string;
    source: string;
    target: string;
};
function stateHandoff(edge: Edge, outcome?: string): Payload | undefined {
    const route = OUTPUT_STATE_ROUTES.find(item => item.id === edge.id || item.returnId === edge.id);
    if (!route)
        return;
    const phase = route.id.includes('register-inspect') ? 'register' : route.id.includes('media-inspect') ? 'media' : route.source.replace('lina-output-', '');
    const record = phase === 'media' ? outputUpload : phase === 'send' ? outputAttempt : phase === 'observe' ? outputObservation : phase === 'settle' ? outputSettlement : phase === 'reconcile' ? outputAttempt : phase === 'schedule' ? object({ obligation: outputObligation, claim: outputClaim }) : outputObligation;
    const fields: Record<string, Payload> = { identity: outputIdentity, deliveryId: text('delivery:output:001'), requesterNodeId: fixed(route.source), returnToNodeId: fixed(route.returnTarget), requestPhase: fixed(route.phase), transactionId: text(`output-tx:${phase}:001`), fingerprint: text(`sha256:output:${phase}:001`), expectedRevision: count(1), expectedOwnerGeneration: count(2), record, persistenceOwner: fixed('state'), deliverySemanticsOwner: fixed('output'), containsCredentialMaterial: fixed(false), replayExternalEffects: fixed(false) };
    if (edge.source.startsWith('lina-state-')) {
        fields.storageOutcome = fixed(outcome ?? 'found');
        fields.acknowledgedRevision = ['applied', 'already-applied'].includes(outcome ?? '') ? count(2) : fixed(null);
        fields.originalIdentityVerified = fixed(true);
        fields.custodyAcknowledged = fixed(['applied', 'already-applied', 'found'].includes(outcome ?? ''));
        fields.dispatchFromStorageReceiptAlone = fixed(false);
        fields.storageReceiptProvesNativeAcceptance = fixed(false);
        fields.recordAbsenceProvesUnsent = fixed(false);
        fields.receiptAuthorizesSend = fixed(false);
    }
    else {
        fields.command = fixed(route.phase);
        fields.retryUsesOriginalIdentity = fixed(true);
        fields.newMutationWhileUnknown = fixed(false);
    }
    return object(fields);
}
function handoff(edge: Edge, outcome?: string): Payload {
    const stored = stateHandoff(edge, outcome);
    if (stored)
        return stored;
    const short = edge.id.replace('lina-output-edge-', '');
    const fields: Record<string, Payload> = { identity: outputIdentity, deliveryId: text('delivery:output:001'), originalRequesterNodeId: text(edge.source), returnToNodeId: text(edge.target), originalOutputRetained: fixed(true), grantsApproval: fixed(false), actualExternalSendPerformed: fixed(false) };
    if (short.includes('observe') || short.includes('recovery') || short === 'settle-input')
        fields.observation = outputObservation;
    else if (short.includes('approval')) {
        fields.intent = replaceField(replaceField(replaceField(outputIntent, 'category', fixed('approval')), 'finality', fixed('required-prompt')), 'content', list(outputPrompt));
        fields.prompt = outputPrompt;
    }
    else if (short.includes('environment')) {
        fields.artifact = outputArtifact;
        fields.artifactRequesterId = text('delivery:output:001');
        fields.requiresRetainedCustody = fixed(true);
        fields.cleanupBeforeCustodyAllowed = fixed(false);
    }
    else if (short.includes('safety')) {
        fields.intent = outputIntent;
        fields.plan = outputRecipientPlan;
        fields.reviewedBindingDigest = text('sha256:fixture-output-target');
        fields.authorizationOwner = fixed('safety');
        fields.admissionRef = short === 'safety-policy' ? text('safety:output:001') : fixed(null);
    }
    else if (short.includes('auth')) {
        fields.plan = outputRecipientPlan;
        fields.accountId = text('account-demo');
        fields.readinessGrantsPermission = fixed(false);
        fields.rawCredentialsIncluded = fixed(false);
    }
    else if (short.includes('wait')) {
        fields.waitId = text('wait:output:001');
        fields.waitRevision = count(1);
        fields.owner = fixed('output');
        fields.originalAttempt = outputAttempt;
        fields.matchingReadinessGrantsSend = fixed(false);
    }
    else if (short === 'cancel-schedule') {
        fields.obligation = outputObligation;
        fields.cancellationGeneration = count(1);
        fields.startedEffectsPreserved = fixed(true);
        fields.newDispatchAllowed = fixed(false);
    }
    else if (short.includes('model') || short.includes('stream') || short === 'cancel-stream') {
        fields.stream = outputStreamRevision;
        fields.modelFinalAuthority = fixed(false);
        fields.previewIsFinal = fixed(false);
        fields.cancellationGeneration = count(short === 'cancel-stream' ? 1 : 0);
    }
    else if (short.includes('child') || short === 'intent-coordinate') {
        fields.childTaskId = text('task:child:001');
        fields.parentTaskId = text('task:parent:001');
        fields.resultRef = text('artifact:child-result:001');
        fields.audience = choice(['internal-parent', 'external'], short === 'settle-child' ? 'external' : 'internal-parent');
        fields.intent = short === 'settle-child' ? replaceField(outputIntent, 'category', fixed('notification')) : replaceField(replaceField(replaceField(outputIntent, 'audience', fixed('internal-parent')), 'finality', fixed('internal')), 'category', fixed('child-result'));
        fields.externalPublicationRequiresSeparateAuthority = fixed(true);
    }
    else if (short.includes('tools')) {
        fields.intent = replaceField(outputIntent, 'category', fixed('tool-message'));
        fields.callId = text('call:message:001');
        fields.batchId = text('batch:message:001');
        if (edge.source === 'lina-output-settle')
            fields.settlement = outputSettlement;
        else {
            fields.actionAdmissionRef = text('safety:message-call:001');
            fields.effectBoundary = fixed('not-started');
        }
        fields.originalToolBatchOwnsResultJoin = fixed(true);
        fields.outputCreatesNewToolBatch = fixed(false);
    }
    else if ((short === 'settle-release' || short === 'register-release')) {
        fields.obligation = outputObligation;
        fields.custodyTransferred = fixed(true);
        fields.waitForReadReceipt = fixed(false);
        fields.releaseAuthorityOwner = fixed('execution');
    }
    else {
        fields.intent = outputIntent;
        fields.plan = outputRecipientPlan;
        fields.part = outputPart;
    }
    const value = object(fields);
    if (!edge.source.startsWith('lina-output-') && !edge.source.startsWith('lina-state-')) {
        const scopedIdentity = replaceField(outputIdentity, 'producerNodeId', fixed(edge.source));
        const walk = (item: Json): Json => Array.isArray(item) ? item.map(walk) : item && typeof item === 'object' ? 'producerNodeId' in item && 'outputId' in item ? scopedIdentity.example : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)])) : item;
        return { schema: value.schema, example: walk(value.example) };
    }
    return value;
}
const branches: Record<string, string[]> = { 'intent-route': ['external'], 'intent-settle': ['quiet', 'invalid', 'duplicate-final'], 'intent-child': ['internal'], 'intent-coordinate': ['internal'], 'route-policy': ['bound', 'fanout'], 'route-settle': ['missing', 'ambiguous', 'stale'], 'policy-render': ['allowed'], 'policy-wait': ['permission-wait', 'deferred'], 'policy-settle': ['rejected', 'suppressed'], 'render-register': ['ready', 'fallback'], 'render-media': ['ready'], 'render-stream': ['ready'], 'render-settle': ['invalid', 'unsupported'], 'media-register': ['ready'], 'media-settle': ['expired', 'denied', 'unavailable'], 'media-reconcile': ['unknown'], 'stream-register': ['prepared', 'block-complete', 'promotion-candidate'], 'stream-settle': ['stale', 'aborted'], 'register-schedule': ['stored', 'existing', 'best-effort'], 'register-settle': ['storage-failed'], 'schedule-send': ['ready'], 'schedule-schedule': ['deferred'], 'schedule-settle': ['cancelled', 'superseded', 'exhausted'], 'send-observe': ['accepted', 'rejected', 'partial'], 'send-retry': ['proven-unsent'], 'send-reconcile': ['unknown'], 'observe-stream': ['accepted'], 'observe-schedule': ['partial'], 'observe-settle': ['accepted', 'delivered', 'read', 'duplicate', 'stale', 'unmatched'], 'observe-retry': ['failed'], 'observe-reconcile': ['unknown'], 'retry-schedule': ['safe-retry', 'deferred'], 'retry-settle': ['permanent', 'exhausted'], 'retry-reconcile': ['reconcile'], 'reconcile-observe': ['confirmed-sent'], 'reconcile-schedule': ['proven-unsent'], 'reconcile-wait': ['unresolved'], 'reconcile-settle': ['unresolved', 'contradictory'] };
for (const edge of OUTPUT_EDGES) {
    const producer = outputDeliveryContracts.find(item => item.nodeId === edge.source);
    if (!producer)
        continue;
    const phase = edge.source.replace('lina-output-', '');
    const short = edge.id.replace('lina-output-edge-', '');
    if (stateHandoff(edge))
        producer.outputs.push(output(`output.${short}.request`, `${phase}: State request`, handoff(edge), [edge.id], 'Existing State owner conditionally records or inspects the exact original transaction.'));
    else
        for (const status of branches[short] ?? [outputStatuses[phase][0]])
            producer.outputs.push(output(`output.${short}.${status}`, `${phase}: ${status}`, object({ phaseOutcome: outputPhasePayload(phase, status), handoff: handoff(edge, status) }), [edge.id], 'Only this declared outcome follows the original recipient and owner continuation; no model rerun.'));
}
export function attachOutputProducerHandoffs(definitions: ContractDefinition[]): void {
    for (const edge of OUTPUT_EDGES.filter(item => !item.source.startsWith('lina-output-'))) {
        const source = definitions.find(item => item.nodeId === edge.source);
        if (!source)
            throw new Error(`Missing Output producer ${edge.source}`);
        const route = OUTPUT_STATE_ROUTES.find(item => item.returnId === edge.id);
        for (const status of route ? route.kind === 'record' ? ['applied', 'already-applied', 'conflict', 'failed', 'unknown'] : ['found', 'missing', 'failed', 'still-unknown'] : ['requested'])
            source.outputs.push(output(`output.${edge.id.replace('lina-output-edge-', '')}.${status}`, `Output: ${status}`, handoff(edge, status), [edge.id], route ? 'Return original State request identity; stored receipt does not prove native acceptance or permit replay.' : 'Existing owner supplies exact admitted output, evidence, artifact custody or matched continuation.'));
    }
}
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-intent')!.external = [outputIntent, replaceField(outputIntent, 'category', fixed('notification'))].map((value, index) => ({ label: index ? 'Admitted proactive notification' : 'Canonical external output', source: 'Producer with explicit route authority; scheduling remains outside Output', value }));
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-observe')!.external = [{ label: 'Correlated native status', source: 'Channel adapter with retained native/account/part correlation', value: outputObservation }];
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-stream')!.external = [{ label: 'Admitted public revision', source: 'Visible model-event owner; private reasoning is excluded', value: outputStreamRevision }];
// Distinct canonical content inputs preserve typed data and prompt authority.
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-render')!.external = [
    { label: 'Canonical structured result', source: 'Validated schema-bound output producer', value: object({ intent: replaceField(outputIntent, 'content', list(outputTypedResult)), canonicalContent: outputTypedResult, plan: outputRecipientPlan }) },
    { label: 'Four-choice registered prompt', source: 'Safety registered wait; transport does not own approval', value: object({ intent: replaceField(replaceField(replaceField(outputIntent, 'category', fixed('approval')), 'finality', fixed('required-prompt')), 'content', list(outputPrompt)), canonicalContent: outputPrompt, plan: outputRecipientPlan }) },
    { label: 'Registered clarification prompt', source: 'Execution input wait; answers return to the original Input owner', value: object({ intent: replaceField(replaceField(replaceField(outputIntent, 'category', fixed('clarification')), 'finality', fixed('required-prompt')), 'content', list(outputClarificationPrompt)), canonicalContent: outputClarificationPrompt, plan: outputRecipientPlan }) },
    { label: 'Plain final text', source: 'Execution authoritative saved final', value: object({ intent: outputIntent, canonicalContent: outputText, plan: outputRecipientPlan }) },
];
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-policy')!.external = [{ label: 'Proactive eligibility with admitted producer identity', source: 'Notification producer and native constraint owner; scheduling is outside Output', value: object({ intent: replaceField(outputIntent, 'category', fixed('notification')), plan: outputRecipientPlan, notificationEligibility: outputNotificationEligibility }) }];
outputDeliveryContracts.find(item => item.nodeId === 'lina-output-media')!.external = [{ label: 'Retained artifact and native reuse candidate', source: 'Environment custody and exact channel account adapter', value: object({ artifact: outputArtifact, handle: outputMediaHandle, plan: outputRecipientPlan }) }];
