import { choice, fixed, flag, inputEdges, object, output, replaceField, text, type ContractDefinition } from './schema';
import { failure, outputRecord } from './shared';

/** Shared pre-execution failure boundary. A verified reply route is optional;
 * uncertainty about a commit is never converted into a known rejection.
 */
export const inputFailureContracts: ContractDefinition[] = [{
  nodeId: 'lina-input-failure',
  context: object({ receiptStoreWritable: flag(true), safeDestinationVerified: flag(true), receiptInspectionRef: text('receipt-inspection:demo'), disclosurePolicy: choice(['safe-public-reason', 'no-private-status']) }),
  contextSource: 'Verified adapter origin, prior receipt evidence and actual storage availability. Missing or untrusted origins do not authorize a reply.',
  reads: ['Failure stage, certainty and available original input identity', 'Known receipt state and verified safe reply destination'],
  writes: ['Known refusal/failure receipt only when storage permits', 'Unknown commit status or investigation reference without overwriting accepted work'],
  rules: [
    'Known refusal and unknown acceptance are different outcomes. Inspect the existing claim/receipt before retrying an uncertain commit.',
    'Do not launch execution or promise acceptance from this boundary.',
    'Only deliver a safe failure when the original destination is verified; otherwise terminate locally.',
    'Disabled binding, failed secret retrieval and changed original account are known pre-acceptance failures; do not fetch through another account or infer acceptance.',
    'Storage failure may prevent recording a receipt. Do not fabricate durable state or private progress in the response.',
  ],
  outputs: [
    output('input.failure.visible', 'Safe failure response', object({ failure, output: replaceField(replaceField(outputRecord, 'category', fixed('refusal')), 'text', text('This request could not be accepted.')) }), inputEdges(36), 'Failure is known and a verified originating destination permits a safe response.'),
    output('input.failure.unknown', 'Acceptance outcome not confirmed', object({ failure: replaceField(failure, 'certainty', fixed('unknown')), output: replaceField(replaceField(replaceField(outputRecord, 'category', fixed('status')), 'text', text('Acceptance could not be confirmed. Check the original input status before retrying.')), 'saved', flag(false)) }), inputEdges(36), 'Commit outcome is unknown; a safe response reports uncertainty without claiming rejection or acceptance.'),
    output('input.failure.no-reply', 'No safe reply destination', object({ failure, disposition: fixed('stop-without-reply'), acceptedPromise: fixed(false) }), [], 'Transport origin cannot be verified or no usable destination exists. No outbound response is authorized.'),
  ],
}];

for (const code of ['binding-disabled', 'credential-retrieval-failed', 'original-account-changed']) inputFailureContracts[0].outputs.push(
  output(`input.failure.${code}`, 'Known channel binding failure', object({ failure: replaceField(replaceField(replaceField(failure, 'stage', fixed('channel-binding')), 'code', fixed(code)), 'certainty', fixed('known')), connectionId: text('conn-original-account-demo'), originalAccountId: text('account-demo'), acceptedPromise: fixed(false), disposition: fixed('stop-without-reply') }), [], 'Before acceptance, the verified binding cannot be used. Stop without exposing credentials or inventing a usable reply route.'),
);
