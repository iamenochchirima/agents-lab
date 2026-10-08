import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTPUT_EDGES, OUTPUT_STATE_ROUTES } from '../src/features/lina/outputBlock';
import { outputDeliveryContracts, outputPhasePayload, outputStatuses } from '../src/features/lina/contracts/outputDelivery';
import { outputIntent, outputContent, outputPrompt, outputTypedResult, outputRecipientPlan, outputAttempt, outputObservation, outputStreamRevision, outputNotificationEligibility, outputMediaHandle, outputClarificationPrompt, outputUpload } from '../src/features/lina/contracts/outputRecords';
import { contractDefinitions, contractForNode, outputsForEdge } from '../src/features/lina/contracts/nodeContracts';
import { stateRecordKinds, stateRecordsByKind, stateCheckpointManifest } from '../src/features/lina/contracts/stateRecords';
import type { Json } from '../src/features/lina/contracts/schema';
const record = (value: Json) => value as Record<string, Json>;
const payload = (value: Json) => record(record(value).payload);
test('thirteen Output contracts carry every producer payload unchanged into its consumer', () => {
    assert.equal(outputDeliveryContracts.length, 13);
    for (const edge of OUTPUT_EDGES)
        for (const out of outputsForEdge(edge.id)) {
            assert.equal(contractDefinitions.find(def => def.outputs.includes(out))?.nodeId, edge.source);
            assert.ok(contractForNode(edge.target)?.input.examples.some(input => input.edgeId === edge.id && JSON.stringify(record(input.value).event) === JSON.stringify(out.example)), edge.id);
        }
    for (const edge of OUTPUT_EDGES)
        assert.ok(outputsForEdge(edge.id).length, edge.id);
});
test('State request and response preserve original transaction, recipient identity and inspection fingerprint', () => {
    for (const route of OUTPUT_STATE_ROUTES) {
        const request = payload(outputsForEdge(route.id)[0].example);
        for (const out of outputsForEdge(route.returnId)) {
            const result = payload(out.example);
            for (const field of ['identity', 'deliveryId', 'transactionId', 'fingerprint', 'expectedRevision', 'expectedOwnerGeneration', 'requestPhase', 'requesterNodeId', 'returnToNodeId'])
                assert.deepEqual(result[field], request[field], `${route.phase}: ${field}`);
            assert.equal(result.storageReceiptProvesNativeAcceptance, false);
            assert.equal(result.recordAbsenceProvesUnsent, false);
            assert.equal(result.dispatchFromStorageReceiptAlone, false);
            if (result.storageOutcome === 'unknown' || result.storageOutcome === 'failed')
                assert.equal(result.custodyAcknowledged, false);
        }
    }
    const registered = payload(outputsForEdge('lina-output-edge-register-state-record')[0].example);
    const inspected = payload(outputsForEdge('lina-output-edge-register-inspect-state-load')[0].example);
    assert.equal(inspected.transactionId, registered.transactionId);
    assert.equal(inspected.fingerprint, registered.fingerprint);
});
test('canonical content is discriminated and preserves all prompt choices and typed result identity', () => {
    assert.deepEqual(outputContent.schema.anyOf!.map(shape => shape.properties?.kind.const), ['text', 'artifact', 'typed-result', 'prompt', 'prompt', 'quiet', 'internal-result']);
    assert.deepEqual(record(outputPrompt.example).choices, ['allow-once', 'allow-session', 'allow-always', 'deny']);
    assert.equal(record(outputPrompt.example).deliveryGrantsApproval, false);
    assert.equal(record(outputTypedResult.example).renderedTextChangesCanonicalValue, false);
    const ordinary = record(outputPhasePayload('render', 'ready').example);
    assert.equal(ordinary.prompt, null);
    assert.equal(ordinary.canonicalStructuredResult, null);
    const fallback = record(outputPhasePayload('render', 'fallback').example);
    assert.deepEqual(record(fallback.prompt).choices, record(outputPrompt.example).choices);
    assert.equal(record((fallback.parts as Json[])[0]).controlsFallback, 'numbered-four-choices');
});
test('unknown sends and previews cannot claim required final or authorize a retry', () => {
    const unknown = record(outputPhasePayload('send', 'unknown').example);
    assert.equal(unknown.effectCertainty, 'unknown');
    assert.equal(record(unknown.attempt).providerMessageId, null);
    const reconciling = record(outputPhasePayload('reconcile', 'unresolved').example);
    assert.equal(reconciling.blindResendAllowed, false);
    assert.equal(reconciling.retainOriginalObligation, true);
    assert.equal(record(outputStreamRevision.example).previewAcceptanceFulfillsFinal, false);
    assert.equal(record(outputAttempt.example).agentRerunAllowed, false);
    assert.equal(record(outputObservation.example).nativeReadProvesHumanRead, false);
});
test('partial native success identifies accepted and unsent parts separately', () => {
    const partial = record(outputPhasePayload('send', 'partial').example);
    assert.deepEqual(partial.confirmedPartIds, ['part:output:001:0']);
    assert.deepEqual(partial.unsentSiblingIds, ['part:output:001:1']);
    for (const status of ['safe-retry', 'deferred', 'permanent', 'exhausted', 'reconcile']) {
        const result = record(outputPhasePayload('retry', status).example);
        assert.equal(result.retryAcceptedPart, false);
    }
});
test('internal output and tool result handoffs retain exact producer semantics', () => {
    const internal = record(outputPhasePayload('intent', 'internal').example);
    assert.equal(record(internal.intent).audience, 'internal-parent');
    assert.equal(record(internal.intent).category, 'child-result');
    assert.equal(internal.externalRoutingAllowed, false);
    const child = payload(outputsForEdge('lina-output-edge-child-intent')[0].example);
    assert.equal(record(child.identity).producerNodeId, 'lina-subagents-return');
    assert.equal(record(child.intent).audience, 'internal-parent');
    const tool = record(payload(outputsForEdge('lina-output-edge-intent-tools')[0].example).handoff);
    assert.equal(tool.originalToolBatchOwnsResultJoin, true);
    assert.equal(tool.outputCreatesNewToolBatch, false);
});
test('required registration transfers custody independently of read receipts and acceptance cannot delete artifacts', () => {
    const release = record(payload(outputsForEdge('lina-output-edge-register-release')[0].example).handoff);
    assert.equal(release.custodyTransferred, true);
    assert.equal(release.waitForReadReceipt, false);
    const bestEffort = record(outputPhasePayload('register', 'best-effort').example);
    assert.equal(record(record(bestEffort.obligation).plan).policy, 'best-effort');
    const settled = record(outputPhasePayload('settle', 'accepted').example);
    assert.equal(settled.artifactDeletionAuthorizedByAcceptanceAlone, false);
});
test('all phase examples disclose fixture evidence and never enable agent recreation', () => {
    for (const [phase, statuses] of Object.entries(outputStatuses))
        for (const status of statuses) {
            const value = record(outputPhasePayload(phase, status).example);
            assert.equal(value.status, status);
            assert.equal(value.evidenceSource, 'design-fixture');
            assert.equal(value.actualExternalSendPerformed, false);
            assert.equal(value.agentRerunAllowed, false);
        }
    assert.equal(record(outputIntent.example).recreateByRerunningAgent, false);
    const plan = record(outputRecipientPlan.example);
    assert.equal(record(plan.destination).channel, 'telegram');
    assert.equal(plan.remoteDeduplicationGuaranteed, false);
});
test('Output persisted kinds and checkpoint references retain prepared bytes and uncertainty', () => {
    for (const kind of ['output-obligation', 'output-attempt', 'output-observation', 'output-settlement', 'output-stream', 'output-upload']) {
        assert.ok((stateRecordKinds as readonly string[]).includes(kind));
        assert.ok(stateRecordsByKind[kind]);
    }
    const checkpoint = stateCheckpointManifest.schema.properties!.outputReferences.items!;
    assert.equal(checkpoint.properties!.rerunAgentToRecreateReply.const, false);
    assert.equal(checkpoint.properties!.missingReceiptProvesUnsent.const, false);
});
test('notification constraints retain admission and consent separately from native eligibility', () => {
    const notice = record(outputNotificationEligibility.example);
    assert.equal(notice.nativeEligibilityGrantsPermission, false);
    assert.equal(notice.substitutionRequiresExplicitAuthority, true);
    for (const key of ['producerTaskId', 'producerGeneration', 'producerAdmissionRef', 'routeAuthorityRef', 'serviceWindow', 'optIn', 'template'])
        assert.ok(outputNotificationEligibility.schema.required?.includes(key));
    assert.equal(record(notice.optIn).current, true);
    assert.equal(record(notice.serviceWindow).open, true);
});
test('media reuse and clarification prompts retain exact native and wait authority without approval choices', () => {
    const handle = record(outputMediaHandle.example);
    assert.equal(handle.reuseRequiresMatchingDigestAccountAndExpiry, true);
    assert.equal(handle.unknownUploadCanBeRepeatedBlindly, false);
    for (const key of ['uploadId', 'accountId', 'digest', 'expiresAt', 'artifactVersion', 'nativeAcknowledgementRef'])
        assert.ok(outputMediaHandle.schema.required?.includes(key));
    const clarification = record(outputClarificationPrompt.example);
    assert.equal(clarification.promptType, 'clarification');
    assert.equal(clarification.deliveryGrantsApproval, false);
    assert.equal(clarification.choices, undefined);
    assert.ok(outputClarificationPrompt.schema.required?.includes('answerSchemaRef'));
});
test('upload effect records preserve original custody and never imply delivered media', () => {
    const upload = record(outputUpload.example);
    assert.equal(upload.unknownUploadCanBeReplaced, false);
    assert.equal(upload.uploadAcceptanceIsMessageAcceptance, false);
    assert.equal(upload.nativeHandle, null);
    const unknown = record(outputPhasePayload('media', 'unknown').example);
    assert.equal(record(unknown.upload).effectBoundary, 'unknown');
    assert.equal(unknown.nativeHandle, null);
});
test('upload State record and inspection share original identity and cannot recreate unknown transfer', () => {
    const request = payload(outputsForEdge('lina-output-edge-media-state-record')[0].example);
    const inspect = payload(outputsForEdge('lina-output-edge-media-inspect-state-load')[0].example);
    assert.equal(request.transactionId, inspect.transactionId);
    assert.equal(request.fingerprint, inspect.fingerprint);
    assert.equal(record(request.record).uploadId, record(inspect.record).uploadId);
    assert.equal(record(inspect.record).unknownUploadCanBeReplaced, false);
    const denied = record(outputPhasePayload('media', 'denied').example);
    assert.equal(record(denied.artifact).authorizedForRecipient, false);
    const accepted = record(outputPhasePayload('media', 'ready').example);
    assert.ok(record(accepted.upload).nativeHandle);
});
test('late acknowledgements preserve original attempt evidence without reviving cancelled dispatch', () => {
    const stale = record(outputPhasePayload('observe', 'stale').example);
    const receipt = record(stale.observation);
    assert.equal(receipt.fact, 'accepted');
    assert.equal(receipt.correlation, 'stale');
    assert.equal(receipt.originalAttemptFence, 2);
    assert.equal(receipt.observedOwnerFence, 3);
    assert.equal(receipt.cancellationObserved, true);
    assert.equal(stale.receiptAuthorizesNewWork, false);
    assert.equal(receipt.lateEvidenceAuthorizesSend, false);
    assert.ok(receipt.rawEvidenceRef);
});
