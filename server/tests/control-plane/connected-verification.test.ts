import assert from 'node:assert/strict';
import test from 'node:test';
import { argumentDigest } from '../../src/capabilities/reviews/store.js';
import { matchesConnectedVerification } from '../../src/evals/connected-verification.js';
test('verification requires exact target identity and returned state, including missing-key failures', () => {
  const input = { catalogRevision: 'catalog', turnId: 'turn', toolCallId: 'read', toolName: 'inspect', round: 3,
    arguments: { namespace: 'cap-correct', key: 'cedar' }, expectedState: { owner: 'Avery', revision: 3 } };
  const receipt = (args = input.arguments, state = input.expectedState, status = 'completed') => ({ status: 'complete', catalogRevision: 'catalog', toolCallId: 'read', toolName: 'inspect',
    fingerprint: argumentDigest({ revision: 'catalog', turnId: 'turn', call: { toolCallId: 'read', name: 'inspect', arguments: args, round: 3 } }), result: { status, structuredContent: state } });
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt() }), true);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt({ ...input.arguments, namespace: 'cap-typo' }) }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt({ ...input.arguments, key: 'other' }) }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt(input.arguments, { owner: 'Unassigned', revision: 1 }) }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: { ...receipt(), result: { status: 'completed', structuredContent: {} } } }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: undefined }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: { ...receipt(), status: 'pending' } }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: { ...receipt(), result: { status: 'unknown', structuredContent: input.expectedState } } }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt(), sequence: { actual: 10, after: 20 } }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt(), sequence: { actual: 20, before: 10 } }), false);
  assert.equal(matchesConnectedVerification({ ...input, receipt: receipt(), sequence: { actual: 30, after: 20 } }), true);
  const failureArgs = { namespace: 'cap-correct', key: 'missing' };
  const failed = { ...receipt(failureArgs), result: { status: 'failed', structuredContent: { code: 'RECORD_NOT_FOUND' } } };
  assert.equal(matchesConnectedVerification({ ...input, arguments: failureArgs, expectedState: { code: 'RECORD_NOT_FOUND' }, resultStatus: 'failed', receipt: failed }), true);
  assert.equal(matchesConnectedVerification({ ...input, expectedState: { code: 'RECORD_NOT_FOUND' }, resultStatus: 'failed', receipt: failed }), false);
});
