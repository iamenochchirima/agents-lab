import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskInteractionStore } from '../../../src/capabilities/interaction/store.js';
import { taskInteractionContribution } from '../../../src/capabilities/interaction/tools.js';
import { MastraBaselineRunner } from '../../../src/platforms/mastra/runner-adapter/mastra-runner.js';
import { createDeterministicFakeModel } from '../../../src/platforms/mastra/variants/baseline/models/fake.js';
import { buildRunManifest } from '../../../src/control-plane/domain/manifest.js';

test('native clarification retains original call through runner replacement and consumes exact answer', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mastra-clarification-'));
  const host = Fastify(); const store = new TaskInteractionStore(root);
  const previous = { url: process.env.AGENTLAB_CAPABILITY_HOST_URL, key: process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE };
  const requests: unknown[] = [];
  let finalBoundary = false;
  for (const operation of ['boundary', 'question', 'answer']) host.post(`/internal/interaction/${operation}`, async request => {
    const body = request.body as any;
    assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(64)}`);
    return operation === 'boundary' ? store.consume(body.runId, body.turnId, body.boundaryId) : operation === 'question' ? store.question(body) : store.answer(body.runId, body.turnId, body.questionId);
  });
  await host.listen({ host: '127.0.0.1', port: 0 });
  process.env.AGENTLAB_CAPABILITY_HOST_URL = host.listeningOrigin;
  process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = join(root, 'host.key'); await writeFile(join(root, 'host.key'), 'a'.repeat(64));
  const factory = () => {
    const model = createDeterministicFakeModel({ modelId: 'clarification' }) as any;
    model.doGenerate = async ({ prompt }: any) => {
      requests.push(prompt);
      if (finalBoundary) {
        const fresh = JSON.stringify(prompt).includes('Friday');
        if (!fresh) await store.accept({ runId: 'completion-run', turnId: 'turn', inputId: 'steering', kind: 'steering', content: 'Use Friday and recheck before reporting.' });
        return { content: [{ type: 'text', text: fresh ? 'Friday rechecked.' : 'Obsolete final response.' }], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
      }
      return { content: JSON.stringify(prompt).includes('Friday') ? [{ type: 'text', text: 'Friday confirmed.' }] : [{ type: 'tool-call', toolCallId: 'original-ask', toolName: 'ask_user', input: JSON.stringify({ question: 'Which date?' }) }],
        finishReason: JSON.stringify(prompt).includes('Friday') ? 'stop' : 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
    };
    return model;
  };
  let runner = new MastraBaselineRunner({ contextRoot: root, modelFactory: factory });
  try {
    const base = buildRunManifest({ platform: 'mastra', variant: 'baseline', task: { kind: 'prompt', prompt: 'Keep original task; ask date.' }, model: { provider: 'fake', model: 'fake-success' } }, { runId: 'clarification-run', platformConfig: runner.manifestConfiguration() });
    const deadlineAt = new Date(Date.now() + 25000).toISOString();
    const manifest = { ...base, context: { ...base.context, turnId: 'turn' }, execution: { schemaVersion: 1 as const, mode: 'sustained' as const, deadlineAt, modelTimeoutMs: 10000 },
      capabilities: { schemaVersion: 1 as const, tools: { enabledNames: ['ask_user'], maxRounds: 6, maxCalls: 8 }, toolCatalog: { schemaVersion: 1 as const, revision: 'b'.repeat(64), tools: [taskInteractionContribution().descriptor] } } };
    const reference = await runner.start(manifest);
    for (let i = 0; i < 500 && (await runner.inspect(reference)).status !== 'suspended'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await runner.inspect(reference)).status, 'suspended', JSON.stringify(await runner.inspect(reference)));
    const question = (await store.read(manifest.runId)).questions[0]!;
    assert.equal(question.toolCallId, 'original-ask'); assert.equal(requests.length, 1);
    await runner.close(); runner = new MastraBaselineRunner({ contextRoot: root, modelFactory: factory });
    assert.equal((await runner.inspect(reference)).status, 'suspended');
    const reply = await store.accept({ runId: manifest.runId, turnId: 'turn', inputId: 'reply', kind: 'clarification_reply', questionId: question.questionId, content: 'Friday' });
    const wake = { kind: 'task_input', runId: manifest.runId, turnId: 'turn', inputId: reply.inputId, sequence: reply.sequence, inputKind: reply.kind, questionId: question.questionId };
    assert.equal((await runner.resume(reference, { ...wake, questionId: 'wrong' })).accepted, false);
    assert.equal((await runner.resume(reference, wake)).accepted, true);
    let inspected = await runner.inspect(reference);
    for (let i = 0; i < 500 && !inspected.result; i++) { await new Promise(resolve => setTimeout(resolve, 10)); inspected = await runner.inspect(reference); }
    assert.equal(inspected.result?.status, 'completed', JSON.stringify(inspected.result));
    assert.equal(requests.length, 2); assert.match(inspected.result?.output ?? '', /Friday/);
    assert.equal((await store.read(manifest.runId)).inputs[0]?.status, 'consumed');
    assert.equal(inspected.eventIntents.filter(event => event.kind === 'TaskInputConsumed').length, 1);
    assert.equal(inspected.reference.executionId, reference.executionId);
    finalBoundary = true;
    const nextManifest = { ...manifest, runId: 'completion-run', task: { kind: 'prompt' as const, prompt: 'Keep original task while reporting.' } };
    const nextReference = await runner.start(nextManifest);
    let final = await runner.inspect(nextReference);
    for (let i = 0; i < 500 && !final.result; i++) { await new Promise(resolve => setTimeout(resolve, 10)); final = await runner.inspect(nextReference); }
    assert.equal(final.result?.status, 'completed', JSON.stringify(final));
    assert.equal(final.result?.output, 'Friday rechecked.', JSON.stringify({ final, requests }));
    assert.equal(requests.length, 4);
    assert.equal(final.eventIntents.filter(event => event.kind === 'TaskOutputSuperseded').length, 1);
    assert.equal((await store.read('completion-run')).inputs[0]?.status, 'consumed');
  } finally {
    await runner.close(); await host.close();
    if (previous.url === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_URL; else process.env.AGENTLAB_CAPABILITY_HOST_URL = previous.url;
    if (previous.key === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE; else process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = previous.key;
    await rm(root, { recursive: true, force: true });
  }
});
