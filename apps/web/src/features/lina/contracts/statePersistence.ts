import { STATE_REQUEST_ROUTES, type StateRequestRoute } from '../stateBlock';
import { choice, count, fixed, flag, list, nullable, object, output, replaceField, sample, text, type ContractDefinition, type Json, type Payload } from './schema';
import { stateCheckpointManifest, stateLocalContext, stateRecord, stateRecordsByKind, stateScope } from './stateRecords';
const refine = (value: Payload, fields: Record<string, Payload>) => Object.entries(fields).reduce((current, [key, field]) => replaceField(current, key, field), value);
const phaseKinds: Record<string, string[]> = {
 'claim-input': ['input-claim'], 'commit-acceptance': ['accepted-input', 'input-receipt'], 'inspect-duplicate': ['input-receipt'], 'inspect-claim': ['input-claim', 'transaction'], 'inspect-claim-transaction': ['transaction'], 'inspect-acceptance': ['accepted-input', 'input-receipt', 'transaction'], 'inspect-delivery': ['delivery-obligation', 'transaction'], 'record-delivery': ['delivery-obligation'],
 'queue-mutation': ['queue-membership'], 'select-queue': ['queue-membership'], 'acquire-owner': ['execution-owner'], 'release-owner': ['execution-owner'], 'reacquire-owner': ['execution-owner'],
 'persist-wait': ['pending-wait'], 'inspect-grants': ['permission-grant', 'transaction'], 'commit-grants': ['permission-grant', 'grant-reservation'], 'read-history': ['history', 'context-snapshot'],
 'record-tool-intent': ['operation-intent'], 'record-model-intent': ['operation-intent'], 'record-tool-outcome': ['operation-result'], 'record-model-outcome': ['operation-result'], 'record-reconciliation': ['operation-result'],
 'settle-turn': ['history', 'delivery-obligation'], 'persist-stop': ['stop-intent'], 'inspect-recovery': ['transaction', 'execution-owner'],
};
const commands: Record<string, string[]> = {
 'record-delivery': ['record-delivery-intent', 'record-delivery-outcome'], 'claim-input': ['claim-input'], 'commit-acceptance': ['commit-record-set'], 'queue-mutation': ['queue-insert', 'queue-transfer', 'queue-remove'],
 'acquire-owner': ['acquire-owner', 'renew-owner'], 'release-owner': ['release-owner'], 'reacquire-owner': ['reacquire-owner'],
 'persist-wait': ['register-wait', 'consume-wait', 'cancel-wait'], 'commit-grants': ['commit-grant', 'reserve-grant', 'consume-grant', 'release-grant', 'revoke-grant'],
 'record-tool-intent': ['record-intent'], 'record-model-intent': ['record-intent'], 'record-tool-outcome': ['record-outcome'], 'record-model-outcome': ['record-outcome'], 'record-reconciliation': ['record-reconciliation'], 'settle-turn': ['commit-record-set'], 'persist-stop': ['persist-stop'],
};
/** A request identifies its continuation phase, so a postlaunch write reply cannot
 * be mistaken for permission to launch the same effect again. */
const transactionPhase = (phase: string) => ({ 'inspect-acceptance': 'commit-acceptance', 'inspect-claim-transaction': 'claim-input', 'inspect-claim': 'claim-input', 'inspect-duplicate': 'commit-acceptance', 'inspect-grants': 'commit-grants', 'inspect-delivery': 'record-delivery', 'inspect-recovery': 'record-tool-outcome' } as Record<string, string>)[phase] ?? phase;
const correlation = (route: StateRequestRoute) => ({
 schemaVersion: fixed(1), requestId: text(`state-request:${route.phase}:001`), requester: object({ nodeId: fixed(route.source), phase: fixed(route.phase), continuationRef: text(`continuation:${route.phase}:001`) }),
 operationId: text(route.phase.includes('tool-') || route.phase === 'record-reconciliation' || route.phase.includes('grants') ? 'call-001' : route.phase.includes('model-') ? 'model-attempt:round-001:1' : route.phase === 'persist-wait' ? 'call-002' : route.phase.includes('acceptance') || route.phase.includes('claim') || route.phase === 'inspect-duplicate' ? 'input-001' : 'turn-001'), scope: stateScope, expectedRevision: count(4), executionFence: count(8), transactionId: text(`state-tx:${transactionPhase(route.phase)}:001`), requestFingerprint: text(`sha256:fixture-${transactionPhase(route.phase)}`), synthetic: fixed(true), containsCredentials: fixed(false),
});
export function stateRequestForRoute(route: StateRequestRoute, commandOverride?: string): Payload {
 const base = correlation(route);
 if (route.kind === 'checkpoint') return object({ ...base, command: fixed('publish-checkpoint'), manifest: refine(stateCheckpointManifest, { resumeEntry: fixed(route.phase === 'wait-boundary' ? 'lina-execution-wait' : route.phase === 'terminal-boundary' ? 'lina-execution-settle' : 'lina-execution-controls') }), requiredCommitBoundary: fixed('manifest-and-exact-required-references'), fragmentsAloneUsable: fixed(false) });
 if (route.kind === 'load') return object({ ...base, command: choice(['read-records', 'inspect-transaction'], route.phase.includes('inspect') ? 'inspect-transaction' : 'read-records'), recordKinds: list(choice([...Object.keys(stateRecordsByKind), 'checkpoint']), phaseKinds[route.phase] ?? ['checkpoint'], 1), selection: object({ recordRefs: list(text(route.phase === 'read-recovery' ? 'checkpoint:turn-001:4' : 'record:001')), limit: count(50), cursor: sample(nullable(text('cursor:history:50')), null), requiredRevision: nullable(count(4)), required: flag(route.phase !== 'read-history') }), inspectBeforeRetry: fixed(true), missingMeansFailedRead: fixed(false) });
 const kinds = phaseKinds[route.phase] ?? ['operation-intent'];
 const selected = kinds.map(kind => stateRecordsByKind[kind]);
 const selectedCommand = commandOverride ?? (commands[route.phase] ?? ['commit-record-set'])[0];
 const modelRecord = (value: Payload): Payload => {
  let body = objectPayload(value, 'payload');
  if (route.phase.startsWith('record-model')) body = refine(body, { ownerNodeId: fixed('lina-model-invoke'), operationId: fixed('model-attempt:round-001:1'), attemptId: fixed('model-attempt:round-001:1'), launchId: fixed('model-launch:round-001:1'), intentRef: fixed('model-intent:round-001:1') });
  const statusByCommand: Record<string, string> = { 'release-owner': 'released', 'consume-wait': 'consumed', 'cancel-wait': 'cancelled', 'queue-transfer': 'transferring', 'queue-remove': 'removed', 'reserve-grant': 'reserved', 'consume-grant': 'consumed', 'revoke-grant': 'revoked', 'record-delivery-intent': 'sending', 'record-delivery-outcome': 'acknowledged' };
  if (statusByCommand[selectedCommand] && body.schema.properties?.status) body = replaceField(body, 'status', fixed(statusByCommand[selectedCommand]));
  if (selectedCommand === 'reacquire-owner') body = refine(body, { ownerRevision: count(5), executionFence: count(9) });
  return replaceField(value, 'payload', body);
 };
 return object({ ...base, command: commandOverride ? fixed(commandOverride) : choice(commands[route.phase] ?? ['commit-record-set']), idempotencyKey: text(`state-idempotency:${route.phase}:001`), records: list(stateRecord, selected.map(value => modelRecord(value).example), 1), requiredCommitBoundary: fixed('all-listed-records'), rejectChangedFingerprint: fixed(true), acknowledgementRequiredBeforeNextPhase: fixed(true), grantsPermissionToLaunch: fixed(false) });
}
const objectPayload = (value: Payload, key: string): Payload => ({ schema: value.schema.properties![key], example: (value.example as Record<string, Json>)[key] });
function resultFor(route: StateRequestRoute, status: string): Payload {
 const request = stateRequestForRoute(route);
 const committed = ['applied', 'already-applied', 'committed', 'already-committed'].includes(status);
 const base = { request, requestId: text(`state-request:${route.phase}:001`), transactionId: text(`state-tx:${transactionPhase(route.phase)}:001`), status: fixed(status), returnTo: object({ nodeId: fixed(route.returnTarget), requesterPhase: fixed(route.phase), continuationRef: text(`continuation:${route.phase}:001`) }), synthetic: fixed(true) };
 if (route.kind === 'load') {
  const kinds = phaseKinds[route.phase] ?? [];
  const foundRecords = kinds.map(kind => stateRecordsByKind[kind].example);
  return object({ ...base, records: list(stateRecord, status === 'found' ? foundRecords : []), checkpoint: status === 'found' && route.phase === 'read-recovery' ? stateCheckpointManifest : sample(nullable(stateCheckpointManifest), null), recordRevision: status === 'found' ? count(4) : fixed(null), inspection: object({ outcome: choice(['applied', 'absent', 'still-unknown', 'not-requested'], route.phase.includes('inspect') && status === 'found' ? 'applied' : 'not-requested'), transactionId: text(`state-tx:${transactionPhase(route.phase)}:001`), fingerprintMatched: flag(status === 'found'), effectAbsenceProven: fixed(false) }), failedReadMayInitializeEmptyHistory: fixed(false), recoveryRead: fixed(route.phase === 'read-recovery') });
 }
 if (route.kind === 'checkpoint') return object({ ...base, checkpointId: text('checkpoint:turn-001:4'), checkpointRevision: committed ? count(4) : fixed(null), usableRecoveryCandidate: fixed(committed), referencesValidated: fixed(committed), inspectBeforeRetry: fixed(status === 'unknown'), committedFragmentsAloneUsable: fixed(false), grantsPermissionToLaunch: fixed(false) });
 return object({ ...base, acknowledgedRevision: committed ? count(5) : fixed(null), commitEvidenceRef: committed ? text(`commit-evidence:${route.phase}:001`) : fixed(null), acknowledged: fixed(committed), inspectBeforeRetry: fixed(status === 'unknown'), mayAdvanceRequester: fixed(committed), changedFingerprintMayOverwrite: fixed(false), staleOwnerMayWrite: fixed(false), externalEffectOccurred: fixed(false), grantsPermissionToLaunch: fixed(false) });
}
const rules: Record<string, string[]> = {
 load: ['Read only the selected scope, bounded history and declared versions. Missing is distinct from unavailable, incompatible and corrupt.', 'Inspect the original transaction identity and fingerprint before any uncertain write retry. A State transaction read cannot prove an external action did not occur.', 'Return to the same requester phase. Only recovery-specific reads enter Recover. Credential values remain outside State.'],
 record: ['Persist the requested record set as one acknowledged commit boundary or report failure; never imply independent file writes are atomic.', 'Same idempotency identity with the same fingerprint returns the original commit. Changed contents conflict. Compare expected revision and execution fence before mutation.', 'Intent is persisted before physical launch; results afterward. A result acknowledgment returns to collection, not dispatch. Unknown acknowledgment requires inspection before retry.', 'Input and Execution own lifecycle decisions. State performs conditional owner acquisition, renewal and release without adding another admission coordinator.'],
 checkpoint: ['Only a committed manifest naming exact coherent revisions and required artifacts is a recovery candidate. Saved fragments alone are not a checkpoint.', 'Retain settled siblings, waits, Stop, operation identities and counters. Checkpoints do not resurrect stale permission or account bindings.', 'Publishing is explicitly requested at a supported coordinator boundary. Generic record commits never automatically publish checkpoints.'],
 recover: ['Validate schema/implementation compatibility and required record/artifact digests before considering continuation. Reacquire ownership with a newer fence; a newer live owner blocks takeover.', 'Unknown external effects enter the existing reconciliation owner without blind replay. Lease expiry does not prove effect absence.', 'Restore waits with original prompt/operation/responder identity; recheck current expiry, policy and bindings. Runtime-session grants expire across restart.', 'Return a plan through Input recovery. This node never dispatches a tool/model or converts persisted conversation text into permission.'],
};
export const statePersistenceContracts: ContractDefinition[] = ['load', 'record', 'checkpoint', 'recover'].map(id => ({
 nodeId: `lina-state-${id}`, context: stateLocalContext, contextSource: 'Trusted coordinator supplies current scoped versions, owner/fence and supported compatibility. Fixture records are design evidence; no production execution store is installed.', reads: ['Correlated requester phase, immutable operation identity and scoped versioned records'], writes: [id === 'recover' ? 'Validated continuation plan, never physical dispatch' : 'Correlated typed storage response with exact commit boundary'], rules: rules[id], outputs: [],
}));
for (const route of STATE_REQUEST_ROUTES) {
 const definition = statePersistenceContracts.find(node => node.nodeId === route.target)!;
 const statuses = route.kind === 'load' ? ['found', 'missing', 'incompatible', 'corrupt', 'unavailable'] : route.kind === 'record' ? ['applied', 'already-applied', 'conflict', 'failed', 'unknown'] : ['committed', 'already-committed', 'incomplete', 'conflict', 'failed', 'unknown'];
 for (const status of statuses) definition.outputs.push(output(`state.${route.phase}.${route.kind}-${status}`, `${route.phase}: ${status}`, resultFor(route, status), [route.returnId], 'Return the original request identity and phase; the requester decides its next lifecycle transition.'));
 if (route.kind === 'load' && route.phase.includes('inspect')) {
  for (const outcome of ['absent', 'still-unknown']) {
   const found = resultFor(route, 'found');
   const inspected = refine(found, { records: list(stateRecord, []), inspection: refine(objectPayload(found, 'inspection'), { outcome: fixed(outcome), fingerprintMatched: fixed(outcome === 'absent') }) });
   definition.outputs.push(output(`state.${route.phase}.transaction-${outcome}`, `Original transaction ${outcome}`, inspected, [route.returnId], 'Proven absent may permit an idempotent conditional retry; still-unknown withholds progress. This says nothing about an external effect.'));
  }
 }
}
const recovery = statePersistenceContracts.find(node => node.nodeId === 'lina-state-recover')!;
for (const status of ['resume', 'restore-waits', 'reconcile', 'required-review', 'reject']) {
 const accepted = ['resume', 'restore-waits', 'reconcile'].includes(status);
 recovery.outputs.push(output(`state.recovery-plan-${status}`, `Recovery: ${status}`, object({
 requestId: text('recover:turn-001:1'), checkpointId: text('checkpoint:turn-001:4'), status: fixed(status), turnId: text('turn-001'), roundId: text('round-001'), ownerReacquired: fixed(accepted), newOwnerRevision: accepted ? count(5) : fixed(null), newExecutionFence: accepted ? count(9) : fixed(null),
 resumeNodeId: status === 'reject' || status === 'required-review' ? fixed(null) : fixed(status === 'reconcile' ? 'lina-input-reconcile' : status === 'restore-waits' ? 'lina-execution-wait' : 'lina-execution-controls'),
 restoredWaitIds: list(text('wait:approval:call-002'), status === 'restore-waits' ? ['wait:approval:call-002'] : []), preservedResultRefs: list(text('artifact:result:call-001')), unresolvedOperationIds: list(text('call-003'), status === 'reconcile' ? ['call-003'] : []),
 currentPolicyRecheckRequired: fixed(true), currentBindingRecheckRequired: fixed(true), sessionGrantsSurviveRestart: fixed(false), stopIntentPreserved: fixed(true), relaunchAuthorized: fixed(false), dispatchesPhysicalEffects: fixed(false), synthetic: fixed(true),
 reason: text(status === 'reject' ? 'incompatible-or-incomplete-checkpoint-or-newer-live-owner' : status === 'required-review' ? 'saved-permission-or-binding-needs-current-review' : status === 'reconcile' ? 'external-effect-unresolved' : 'compatible-committed-evidence-and-new-owner'),
 }), ['lina-state-edge-recovery-plan'], 'Recovery returns to the existing Input coordinator with exact retained identities, never direct dispatch.'));
}
recovery.external = [{ label: 'Trusted restart compatibility scan', source: 'Execution coordinator restart scan, not ordinary incoming chat text', value: object({ command: fixed('recover-checkpoint'), checkpointId: text('checkpoint:turn-001:4'), supportedSchemaVersion: fixed(1), supportedImplementationRevision: text('lina-design:state-v1'), currentPolicyGeneration: count(2), currentBindingGeneration: count(2), sessionGrantsInvalidated: fixed(true), synthetic: fixed(true) }) }];

/** Attach complete producer requests to existing lifecycle owners. Keeping their
 * event discriminator and requester phase intact gives inspectors exact handoffs. */
export function attachStateProducerHandoffs(definitions: ContractDefinition[]): void {
 for (const route of STATE_REQUEST_ROUTES) {
  const source = definitions.find(node => node.nodeId === route.source);
  if (!source) throw new Error(`Missing State request owner ${route.source}`);
  const variants = route.kind === 'record' ? commands[route.phase] ?? ['commit-record-set'] : [undefined];
  for (const command of variants) source.outputs.push(output(`${route.source}.state-${route.phase}${command ? `-${command}` : ''}`, `${route.phase}: scoped ${route.kind} request`, stateRequestForRoute(route, command), [route.id], 'The coordinator invokes State explicitly and retains its original operation and continuation phase until a known response.'));
 }
}
