import { linaMemoryBlock } from '../src/features/lina/memoryBlock.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { linaInputBlock } from '../src/features/lina/inputBlock.ts';
import { linaContextBlock } from '../src/features/lina/contextBlock.ts';
import { linaModelBlock } from '../src/features/lina/modelBlock.ts';
import { linaStateBlock } from '../src/features/lina/stateBlock.ts';
import { linaSafetyBlock } from '../src/features/lina/safetyBlock.ts';
import { linaToolsBlock } from '../src/features/lina/toolsBlock.ts';
import { linaExecutionBlock } from '../src/features/lina/executionBlock.ts';
import { advanceSimulation, resetSimulation, startSimulation, type SimulationCase, type SimulationChannel, type ContextCase } from '../src/features/lina/inputSimulation.ts';
import type { LinaDocument } from '../src/features/lina/linaModel.ts';

const document: LinaDocument = {
  version: 1,
  nodes: [...linaInputBlock.nodes, ...linaExecutionBlock.nodes, ...linaContextBlock.nodes, ...linaToolsBlock.nodes, ...linaModelBlock.nodes, ...linaSafetyBlock.nodes, ...linaStateBlock.nodes, ...linaMemoryBlock.nodes],
  edges: [...linaInputBlock.edges, ...linaExecutionBlock.edges, ...linaContextBlock.edges, ...linaToolsBlock.edges, ...linaModelBlock.edges, ...linaSafetyBlock.edges, ...linaStateBlock.edges, ...linaMemoryBlock.edges],
};
const channels: SimulationChannel[] = ['cli', 'whatsapp', 'telegram'];
const cases: SimulationCase[] = ['direct-answer', 'tool-round', 'model-retry', 'tool-error-correction', 'tool-failure', 'model-failure', 'loop-exhausted'];

const contextCases: ContextCase[] = ['fits', 'prune', 'compact', 'compact-failure', 'too-large', 'invalid'];

for (const channel of channels) for (const executionCase of cases) for (const contextCase of contextCases) {
  test(`${channel} / ${executionCase} / ${contextCase} follows real graph edges in both playback modes`, () => {
    const before = JSON.stringify(document);
    let automatic = startSimulation(channel, document, true, executionCase, 3, contextCase);
    let manual = startSimulation(channel, document, false, executionCase, 3, contextCase);
    assert.equal(automatic.status, 'running');
    assert.equal(manual.status, 'paused');
    assert.equal(manual.route[0], `lina-input-${channel}`);
    assert.equal(manual.route.at(-1), 'lina-execution-release');
    assert.equal(manual.transitions.length, manual.route.length - 1);
    const autoVisits = [automatic.route[automatic.step]];
    const manualVisits = [manual.route[manual.step]];
    while (automatic.status !== 'completed') {
      const oldStep = automatic.step;
      automatic = advanceSimulation(automatic, document);
      manual = advanceSimulation(manual, document);
      assert.equal(automatic.step, oldStep + 1);
      assert.equal(manual.step, automatic.step);
      assert.equal(manual.rounds, automatic.rounds);
      assert.equal(manual.attempts, automatic.attempts);
      assert.equal(manual.contextPreparations, automatic.contextPreparations);
      assert.equal(manual.contextReductions, automatic.contextReductions);
      assert.equal(manual.contextSnapshotRef, automatic.contextSnapshotRef);
      assert.equal(manual.outcome, automatic.outcome);
      assert.equal(manual.toolOutcome, automatic.toolOutcome);
      assert.notEqual(automatic.status, 'blocked');
      assert.equal(manual.status, automatic.status === 'completed' ? 'completed' : 'paused');
      autoVisits.push(automatic.route[automatic.step]);
      manualVisits.push(manual.route[manual.step]);
      const event = automatic.events[automatic.step];
      const edge = document.edges.find(candidate => candidate.id === event.edgeId);
      if (event.edgeId) {
        assert.equal(edge?.source, event.sourceNodeId);
        assert.equal(edge?.target, event.nodeId);
      } else assert.equal(autoVisits.at(-2), autoVisits.at(-1), 'a local outcome event retains its graph cursor');
      if (automatic.route[automatic.step] === 'lina-input-runtime') assert.notEqual(automatic.status, 'completed');
    }
    assert.deepEqual(autoVisits, manualVisits);
    assert.strictEqual(advanceSimulation(automatic, document), automatic);
    assert.equal(JSON.stringify(document), before, 'playback does not modify architecture');
    const reset = resetSimulation(manual, document);
    assert.equal(reset.step, 0);
    assert.equal(reset.status, 'paused');
    assert.equal(reset.channel, channel);
    assert.equal(reset.executionCase, executionCase);
    assert.equal(reset.contextCase, contextCase);
    assert.equal(reset.contextPreparations, 0);
    assert.equal(reset.contextReductions, 0);
    assert.equal(reset.contextSnapshotRef, undefined);
    assert.deepEqual(reset.route, manual.route);
    assert.deepEqual(reset.transitions, manual.transitions);
  });
}

test('scripted cases distinguish tools, retry and control-checkpoint revisits', () => {
  const direct = startSimulation('cli', document);
  const tool = startSimulation('cli', document, false, 'tool-round');
  const retry = startSimulation('cli', document, false, 'model-retry');
  assert.equal(direct.route.includes('lina-execution-tools'), false);
  assert.equal(direct.route.includes('lina-execution-recover'), false);
  assert.equal(tool.route.filter(id => id === 'lina-execution-model').length, 2);
  // State checkpoint acknowledgments revisit the owner without another control decision.
  assert.equal(tool.events.filter(event => event.nodeId === 'lina-execution-controls' && !event.stateEvidence).length, 2);
  assert.equal(tool.route.includes('lina-execution-recover'), false);
  assert.ok(tool.transitions.includes('lina-execution-edge-controls-continue'));
  assert.ok(tool.transitions.includes('lina-execution-edge-controls-finish'));
  assert.equal(retry.route.filter(id => id === 'lina-execution-recover').length, 1);
  assert.equal(retry.route.filter(id => id === 'lina-execution-model').length, 2);
  assert.equal(retry.route.includes('lina-execution-tools'), false);
});

test('missing nodes or chosen edges block rather than skipping a step', () => {
  const missingNode = { ...document, nodes: document.nodes.filter(node => node.id !== 'lina-execution-release') };
  const blocked = startSimulation('cli', missingNode);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.error ?? '', /missing component/);
  assert.strictEqual(advanceSimulation(blocked, document), blocked);

  const started = startSimulation('telegram', document, false, 'tool-round');
  const missingEdge = {
    ...document,
    edges: document.edges.filter(edge => edge.id !== 'lina-execution-edge-controls-continue'),
  };
  // A different edge with identical endpoints must not replace the chosen branch.
  missingEdge.edges.push({ id: 'custom-parallel-edge', source: 'lina-execution-controls', target: 'lina-execution-limits', label: 'other policy' });
  assert.equal(startSimulation('telegram', missingEdge, true, 'tool-round').status, 'blocked');
  const interrupted = advanceSimulation(started, missingEdge);
  assert.equal(interrupted.status, 'blocked');
  assert.equal(interrupted.step, 0);
  assert.match(interrupted.error ?? '', /missing connection/);
});

function finish(executionCase: SimulationCase, maxRounds = 3, contextCase: ContextCase = 'fits') {
  let state = startSimulation('cli', document, false, executionCase, maxRounds, contextCase);
  const observed = [state];
  while (state.status === 'paused') {
    state = advanceSimulation(state, document);
    observed.push(state);
  }
  assert.equal(state.status, 'completed');
  return { state, observed };
}

test('tool correction returns the error to the model before a successful replacement call', () => {
  const { state, observed } = finish('tool-error-correction');
  const outcomes = observed.filter(item => item.route[item.step] === 'lina-execution-tool-outcomes' && !item.events[item.step].stateEvidence);
  assert.deepEqual(outcomes.map(item => item.toolOutcome), ['correctable-error', 'success']);
  assert.equal(state.outcome, 'completed');
  assert.equal(state.rounds, 3);
  assert.equal(state.attempts, 3);
});

test('terminal failures release ownership without retrying or reporting success', () => {
  for (const executionCase of ['tool-failure', 'model-failure'] as const) {
    const { state } = finish(executionCase);
    assert.equal(state.outcome, 'failed');
    assert.equal(state.rounds, 1);
    assert.equal(state.attempts, 1);
    assert.equal(state.route.includes('lina-execution-recover'), false);
    assert.equal(state.route.at(-1), 'lina-execution-release');
  }
});

test('round gate prevents the next model call at different configured limits', () => {
  for (const limit of [1, 2, 3, 5, 10]) {
    const { state, observed } = finish('loop-exhausted', limit);
    assert.equal(state.outcome, 'exhausted');
    assert.equal(state.rounds, limit);
    assert.equal(state.attempts, limit);
    assert.equal(observed.filter(item => item.route[item.step] === 'lina-execution-model').length, limit);
    assert.ok(state.transitions.includes('lina-execution-edge-limits-terminal'));
    assert.equal(resetSimulation(state, document).maxRounds, limit);
  }
  assert.equal(finish('tool-error-correction', 1).state.outcome, 'exhausted');
});

test('a provider retry consumes an attempt within the same allowed round', () => {
  const { state } = finish('model-retry', 1);
  assert.equal(state.outcome, 'completed');
  assert.equal(state.rounds, 1);
  assert.equal(state.attempts, 2);
});


test('context publishes a snapshot per logical round; retry reuses it', () => {
  const tool = finish('tool-error-correction');
  assert.equal(tool.state.contextPreparations, 3);
  assert.equal(tool.state.contextReductions, 0);
  const modelCalls = tool.observed.filter(item => item.route[item.step] === 'lina-execution-model');
  assert.deepEqual(modelCalls.map(item => item.contextSnapshotRef), [
    'fixture-context-preparation-1', 'fixture-context-preparation-2', 'fixture-context-preparation-3',
  ]);
  for (const call of modelCalls) {
    assert.equal(call.route[call.step - 1], 'lina-execution-prepare');
    assert.equal(call.route[call.step - 2], 'lina-context-publish');
  }
  const retry = finish('model-retry');
  assert.equal(retry.state.contextPreparations, 1);
  const retryCalls = retry.observed.filter(item => item.route[item.step] === 'lina-execution-model');
  assert.deepEqual(retryCalls.map(item => item.contextSnapshotRef), ['fixture-context-preparation-1', 'fixture-context-preparation-1']);
  assert.equal(retry.state.rounds, 1);
  assert.equal(retry.state.attempts, 2);
});

test('pruning and compaction are bounded fixture reductions without extra main-model attempts', () => {
  for (const contextCase of ['prune', 'compact'] as const) {
    const { state, observed } = finish('tool-round', 3, contextCase);
    assert.equal(state.outcome, 'completed');
    assert.equal(state.contextPreparations, 2);
    assert.equal(state.contextReductions, 1);
    assert.equal(state.rounds, 2);
    assert.equal(state.attempts, 2);
    assert.equal(state.route.filter(id => id === `lina-context-${contextCase}`).length, 1);
    assert.equal(state.route.filter(id => id === 'lina-context-budget').length, 3);
    const reduction = observed.find(item => item.route[item.step] === `lina-context-${contextCase}`)!;
    assert.equal(reduction.rounds, 0);
    assert.equal(reduction.attempts, 0);
    assert.match(reduction.detail ?? '', /Fixture/);
    assert.equal(reduction.route[reduction.step + 1], 'lina-context-budget');
  }
});

test('context failures settle without launching a model or publishing an invalid snapshot', () => {
  for (const contextCase of ['compact-failure', 'too-large', 'invalid'] as const) {
    const { state } = finish('tool-round', 3, contextCase);
    assert.equal(state.outcome, 'failed');
    assert.equal(state.rounds, 0);
    assert.equal(state.attempts, 0);
    assert.equal(state.contextPreparations, 1);
    assert.equal(state.contextSnapshotRef, undefined);
    assert.equal(state.route.includes('lina-execution-model'), false);
    assert.equal(state.route.includes('lina-context-publish'), false);
    assert.deepEqual(state.events.filter(event => !event.stateEvidence).slice(-2).map(event => event.nodeId), ['lina-execution-settle', 'lina-execution-release']);
  }
});

test('missing context branch edges block both start and ongoing playback', () => {
  for (const [contextCase, edgeId] of [
    ['fits', 'lina-context-edge-validate-publish'],
    ['prune', 'lina-context-edge-prune-budget'],
    ['compact', 'lina-context-edge-compact-budget'],
    ['compact-failure', 'lina-context-edge-compact-terminal'],
    ['too-large', 'lina-context-edge-budget-terminal'],
    ['invalid', 'lina-context-edge-validate-terminal'],
  ] as const) {
    const missing = { ...document, edges: document.edges.filter(edge => edge.id !== edgeId) };
    assert.equal(startSimulation('cli', missing, true, 'direct-answer', 3, contextCase).status, 'blocked');
    const started = startSimulation('cli', document, false, 'direct-answer', 3, contextCase);
    const blocked = advanceSimulation(started, missing);
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.step, 0);
  }
});
