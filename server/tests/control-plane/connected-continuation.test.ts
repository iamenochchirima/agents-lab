import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConnectedContinuation } from '../../src/evals/connected-continuation.js';
const scenario = { id: 'fixture', provider: 'http://127.0.0.1:19196', profileId: 'fixture', stages: [
  { id: 'retrieve', decision: null, expected: { effectCount: 0 } },
  { id: 'assign', decision: 'approved', expected: { owner: 'Morgan', effectCount: 1 } },
  { id: 'deny', decision: 'denied', expected: { owner: 'Morgan', effectCount: 1 } },
  { id: 'error', decision: null, expected: { owner: 'Morgan', effectCount: 1 } },
] };
function retained() { return { mode: 'real-model-controlled-connected', scenario: { ...scenario, fixtureOnly: true }, outcomes: [{ platform: 'fixture', namespace: 'cap-fixture-123', stages: [
  { id: 'retrieve', runId: 'read', verdict: 'pass' },
  { id: 'assign', runId: 'applied', verdict: 'fail', nativeStatus: 'failed', error: { failureKind: 'provider' }, reviews: [{ decision: 'approved' }], after: { owner: 'Morgan', effectCount: 1 } },
] }] }; }
test('continuation preserves confirmed effects but rejects mutation replay, drift and skipped denial', () => {
  const report = retained(), state = { owner: 'Morgan', effectCount: 1 };
  assert.deepEqual(validateConnectedContinuation(scenario, report, 'fixture', 'deny', state).confirmedEffects, ['assign']);
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'assign', state), /replay/);
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'deny', { ...state, effectCount: 2 }), /drifted/);
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'error', state), /Prior stage deny/);
  report.outcomes[0].stages[1].error!.failureKind = 'outcome_unknown';
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'deny', state), /Unknown/);
});
test('continuation rejects manual namespaces and another provider', () => {
  const report = retained(), state = { owner: 'Morgan', effectCount: 1 };
  report.outcomes[0].namespace = 'cap-chat-manual-20261010';
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'deny', state), /automated/);
  report.scenario.provider = 'http://other-provider';
  assert.throws(() => validateConnectedContinuation(scenario, report, 'fixture', 'deny', state), /scenario\/profile\/provider/);
});
