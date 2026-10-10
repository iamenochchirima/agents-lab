import assert from 'node:assert/strict';
import test from 'node:test';
import { observeConnectedAbort } from '../../src/evals/connected-abort-evidence.js';
import type { RunView } from '../../src/control-plane/application/run-service.js';

test('abort retains independent effects and actual native status even when cancellation fails', async () => {
  const requests: string[] = [];
  const native = { runId: 'fixture-run', status: 'running', executionReference: { executionId: 'retained-native' } } as unknown as RunView;
  const state = { effectCount: 2, records: { cedar: { owner: 'Morgan', revision: 2 } } };
  const evidence = await observeConnectedAbort({
    cancel: async () => { requests.push('cancel'); throw new Error('Request failed with HTTP 502'); },
    inspect: async () => { requests.push('inspect'); return native; },
    readProviderState: async () => { requests.push('independent-state'); return state; },
  });
  assert.deepEqual(requests, ['cancel', 'inspect', 'independent-state']);
  assert.deepEqual(evidence.native, native);
  assert.deepEqual(evidence.providerState, state);
  assert.equal(evidence.cancellation.error, 'Request failed with HTTP 502');
  assert.equal(evidence.cancellationConfirmed, false);
  assert.equal(evidence.executionTerminalObserved, false);
});
