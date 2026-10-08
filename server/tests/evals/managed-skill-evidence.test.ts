import assert from 'node:assert/strict';
import test from 'node:test';
import { skillResourceDelivered } from '../../src/evals/managed-skill-evidence.js';
const output = { packageId: 'notes-check-skills', name: 'notes-check', path: 'references/procedure.md', digest: 'sha256:fixture', content: 'Read private fixture notes only.', trust: 'untrusted', authority: 'none', encoding: 'utf8' };
const receipt = { toolCallId: 'resource-call', sequence: 14, result: { status: 'completed' }, output };
function observed(body: Record<string, unknown> = output, callId = receipt.toolCallId, sequence = 16) { return [{ kind: 'EvalModelObserved', recordedSequence: sequence, payload: { observation: { providerRequest: { messages: [{ role: 'tool', tool_call_id: callId, content: JSON.stringify(body) }] } } } }]; }
test('completed resource reaches a later request through a correlated native tool message', () => {
  assert.equal(skillResourceDelivered(observed(), receipt), true);
  assert.equal(skillResourceDelivered(observed(output, receipt.toolCallId, 13), receipt), false);
});
test('incorrect call identity, digest or authority cannot count as resource delivery', () => {
  assert.equal(skillResourceDelivered(observed(output, 'other-call'), receipt), false);
  assert.equal(skillResourceDelivered(observed({ ...output, digest: 'different' }), receipt), false);
  assert.equal(skillResourceDelivered(observed({ ...output, authority: 'system' }), receipt), false);
  assert.equal(skillResourceDelivered(observed(), { ...receipt, output: { ...output, authority: 'system' } }), false);
});
