import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { restartOwnedNative } from './sustained-stack.mjs';

// Scripted model choices test actual native wait recovery. This does not measure
// whether a real model chooses to clarify, follow instructions or use memory.
const api = process.env.AGENTLAB_NATIVE_CLARIFICATION_API ?? 'http://127.0.0.1:4324';
const platforms = ['temporal', 'restate'];
const root = resolve(process.env.AGENTLAB_SUSTAINED_STACK_ROOT ?? 'lab/runs/.sustained-proof');
const directory = join(root, 'runs/.identity-memory-proof', `native-clarification-${randomUUID()}`);
if (!['127.0.0.1', 'localhost'].includes(new URL(api).hostname)) throw new Error('Native recovery fixture requires a loopback API.');
await mkdir(directory, { recursive: true });
const {installedRuntimeVersions} = await import('../../dist/src/evals/runtime-versions.js');
const report = {runtimeVersions: await installedRuntimeVersions(), schemaVersion: 1, mode: 'scripted-model-real-native-recovery', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim(), startedAt: new Date().toISOString(), controls: {platforms, model: {provider: 'fake', model: 'fake-eval-behaviour', contextWindowTokens: 32768}, paidModelRequests: 0, replacement: 'owned worker/service only', sameDeadline: true}, outcomes: []};
const save = () => writeFile(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
async function json(path, body) {
  const response = await fetch(`${api}${path}`, {...(body ? {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15000)});
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function until(check, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(done => setTimeout(done, 500)); }
  throw new Error(`Timed out waiting for ${label}`);
}
await save();
for (const platform of platforms) {
  const outcome = {platform, verdict: 'incomplete', startedAt: new Date().toISOString()}; report.outcomes.push(outcome); await save();
  let run;
  try {
    const directive = Buffer.from(JSON.stringify({action: 'tool', toolName: 'ask_user', input: {question: 'Which fictional notes should this recovery task review?'}})).toString('base64url');
    const namespace = `native-clarification-${randomUUID()}`;
    run = await json('/api/runs', {platform, variant: 'baseline', comparisonId: namespace, sessionId: `cap-chat-${randomUUID()}`, clientTurnId: `native-clarification-${randomUUID()}`, task: {kind: 'prompt', prompt: `[eval-behaviour:${directive}] Native clarification recovery fixture.`}, model: {provider: 'fake', model: 'fake-eval-behaviour', contextWindowTokens: 32768}, memory: {enabled: false}, capabilities: {profileId: 'connected-agent', tools: {enabledNames: [], maxRounds: 4, maxCalls: 4}}, execution: {mode: 'sustained', maxDurationMs: 300000, modelTimeoutMs: 30000}});
    outcome.runId = run.runId; await save();
    const question = await until(async () => {
      run = await json(`/api/runs/${run.runId}`);
      if (['completed', 'failed', 'cancelled'].includes(run.status)) throw new Error(`Run became ${run.status} before asking: ${JSON.stringify(run.result?.error)}`);
      const state = await json(`/api/runs/${run.runId}/inputs`);
      return state.questions.find(item => item.status === 'pending');
    }, `${platform} native clarification`);
    const before = await json(`/api/runs/${run.runId}`);
    assert.ok(before.events.some(event => event.kind === 'WorkflowSuspended' && event.payload.reason === 'clarification' && event.payload.questionId === question.questionId));
    const identity = {runId: before.runId, executionId: before.executionReference.executionId, nativeInvocationId: before.executionReference.native.workflowRunId ?? before.executionReference.native.invocationId, turnId: before.manifest.context.turnId, questionId: question.questionId, toolCallId: question.toolCallId, execution: before.manifest.execution};
    outcome.before = identity; await writeFile(join(directory, `${platform}-before.json`), JSON.stringify(before, null, 2));
    outcome.restart = await restartOwnedNative({api, platform, runId: before.runId, executionReference: before.executionReference, question: {questionId: question.questionId, toolCallId: question.toolCallId}}); await save();
    const after = await json(`/api/runs/${run.runId}`);
    const retained = await json(`/api/runs/${run.runId}/inputs`);
    assert.equal(after.executionReference.executionId, identity.executionId);
    assert.equal(after.executionReference.native.workflowRunId ?? after.executionReference.native.invocationId, identity.nativeInvocationId);
    assert.equal(after.manifest.context.turnId, identity.turnId);
    assert.deepEqual(after.manifest.execution, identity.execution);
    assert.ok(retained.questions.some(item => item.questionId === question.questionId && item.toolCallId === question.toolCallId && item.status === 'pending'));
    const inputId = `answer-${randomUUID()}`;
    const input = {inputId, kind: 'clarification_reply', questionId: question.questionId, content: 'Review fictional research notes only.'};
    const accepted = await json(`/api/runs/${run.runId}/inputs`, input);
    const duplicate = await json(`/api/runs/${run.runId}/inputs`, input);
    assert.equal(accepted.inputId, duplicate.inputId);
    const completed = await until(async () => { const current = await json(`/api/runs/${run.runId}`); return ['completed', 'failed', 'cancelled'].includes(current.status) ? current : null; }, `${platform} same native execution completion`);
    const final = await json(`/api/runs/${run.runId}/inputs`);
    assert.equal(completed.status, 'completed', JSON.stringify(completed.result?.error));
    assert.equal(completed.executionReference.executionId, identity.executionId);
    assert.equal(completed.executionReference.native.workflowRunId ?? completed.executionReference.native.invocationId, identity.nativeInvocationId);
    assert.equal(final.questions.length, 1);
    assert.equal(final.questions[0].status, 'answered');
    assert.equal(final.questions[0].answerInputId, inputId);
    assert.equal(final.inputs.length, 1);
    assert.equal(final.inputs[0].status, 'consumed');
    assert.equal(completed.events.filter(event => event.kind === 'ToolCallRequested' && event.payload.toolName === 'ask_user').length, 1);
    assert.equal(completed.events.filter(event => event.kind === 'TaskInputConsumed' && event.payload.inputId === inputId).length, 1);
    assert.match(completed.result.output, /Review fictional research notes only/);
    outcome.after = {executionId: completed.executionReference.executionId, nativeInvocationId: completed.executionReference.native.workflowRunId ?? completed.executionReference.native.invocationId, questionId: final.questions[0].questionId, toolCallId: final.questions[0].toolCallId, inputId, questionCount: final.questions.length, inputCount: final.inputs.length, modelRequests: completed.events.filter(event => event.kind === 'ModelRequested' && event.payload.purpose !== 'summary').length};
    await writeFile(join(directory, `${platform}-completed.json`), JSON.stringify(completed, null, 2));
    await writeFile(join(directory, `${platform}-interaction.json`), JSON.stringify(final, null, 2));
    outcome.verdict = 'passed';
  } catch (error) {
    outcome.verdict = 'failed'; outcome.error = String(error);
    if (run) { try { await json(`/api/runs/${run.runId}/cancel`, {reason: 'Native clarification recovery fixture stopped after failed acceptance.'}); } catch {} }
  }
  outcome.finishedAt = new Date().toISOString(); await save();
}
report.finishedAt = new Date().toISOString(); await save();
console.log(JSON.stringify({directory, outcomes: report.outcomes.map(item => ({platform: item.platform, verdict: item.verdict, runId: item.runId, error: item.error}))}));
if (report.outcomes.some(item => item.verdict !== 'passed')) process.exitCode = 1;
