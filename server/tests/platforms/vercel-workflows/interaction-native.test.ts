import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskInteractionStore } from '../../../src/capabilities/interaction/store.js';
import { taskInteractionContribution } from '../../../src/capabilities/interaction/tools.js';
import { loadVercelWorkflowsConfig } from '../../../src/platforms/vercel-workflows/config.js';
import { VercelWorkflowsPlatformService } from '../../../src/platforms/vercel-workflows/service/platform-service.js';
import type { VercelWorkflowInput } from '../../../src/platforms/vercel-workflows/variants/baseline/contracts.js';

test('native question hook survives local service replacement; steering supersedes remaining proposals', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vercel-clarification-'));
  const host = Fastify(); const store = new TaskInteractionStore(root);
  const previous = { url: process.env.AGENTLAB_CAPABILITY_HOST_URL, key: process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE };
  for (const operation of ['boundary', 'question', 'answer']) host.post(`/internal/interaction/${operation}`, async request => {
    const body = request.body as any;
    return operation === 'boundary' ? store.consume(body.runId, body.turnId, body.boundaryId) : operation === 'question' ? store.question(body) : store.answer(body.runId, body.turnId, body.questionId);
  });
  await host.listen({ host: '127.0.0.1', port: 0 });
  process.env.AGENTLAB_CAPABILITY_HOST_URL = host.listeningOrigin;
  process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = join(root, 'host.key'); await writeFile(join(root, 'host.key'), 'a'.repeat(64));
  const port = await new Promise<number>((resolve, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const address = socket.address(); socket.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))); }); });
  const config = { ...loadVercelWorkflowsConfig({}), host: '127.0.0.1', port, serviceUrl: `http://127.0.0.1:${port}`, dataDir: join(root, 'world') };
  let native = new VercelWorkflowsPlatformService({ config });
  const inspect = async (id: string) => (await fetch(`${native.address}/runs/${id}`)).json() as Promise<any>;
  const wait = async (id: string, condition: (value: any) => boolean) => {
    for (let i = 0; i < 1000; i++) { const value = await inspect(id); if (condition(value)) return value; if (value.status === "failed") throw new Error(JSON.stringify(value)); await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('Native interaction did not reach expected state: ' + JSON.stringify(await inspect(id)));
  };
  try {
    await native.start();
    for (const choice of ['reply', 'steering'] as const) {
      const runId = `question-${choice}`;
      const input: VercelWorkflowInput = { runId, turnId: 'turn', prompt: JSON.stringify([{ name: 'ask_user', arguments: { question: 'Which date?' } }]), systemInstruction: 'Retain task.', model: { provider: 'fake', model: 'fake-tools' }, modelTimeoutMs: 10000,
        execution: { schemaVersion: 1, mode: 'sustained', deadlineAt: new Date(Date.now() + 45000).toISOString(), modelTimeoutMs: 10000 },
        tools: { enabledNames: ['ask_user'], maxRounds: 6, maxCalls: 8 }, toolCatalog: { schemaVersion: 1, revision: 'b'.repeat(64), tools: [taskInteractionContribution().descriptor] } };
      const admission = await (await fetch(`${native.address}/runs/admit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json() as any;
      assert.equal(typeof admission.workflowRunId, "string", JSON.stringify(admission));
      const waiting = await wait(admission.workflowRunId, value => value.status === 'suspended' && value.pendingQuestion);
      const question = waiting.pendingQuestion;
      if (choice === 'reply') {
        await native.stop(); native = new VercelWorkflowsPlatformService({ config }); await native.start();
        const restored = await wait(admission.workflowRunId, value => value.status === 'suspended');
        assert.equal(restored.pendingQuestion.questionId, question.questionId);
        assert.equal(restored.eventIntents.filter((event: any) => event.kind === 'WorkflowSuspended').length, 1);
      }
      const accepted = await store.accept({ runId, turnId: 'turn', inputId: 'input', kind: choice === 'reply' ? 'clarification_reply' : 'steering', content: 'Friday', ...(choice === 'reply' ? { questionId: question.questionId } : {}) });
      const wake = { kind: 'task_input', runId, turnId: 'turn', inputId: accepted.inputId, sequence: accepted.sequence, inputKind: accepted.kind, ...(choice === 'reply' ? { questionId: question.questionId } : {}) };
      const response = await fetch(`${native.address}/runs/${admission.workflowRunId}?resume=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wake) });
      assert.equal(response.status, 202);
      const completed = await wait(admission.workflowRunId, value => value.status === 'completed' || value.status === 'failed');
      assert.equal(completed.status, 'completed', JSON.stringify(completed));
      assert.match(completed.result.output, choice === 'reply' ? /Friday/ : /TASK_INPUT_SUPERSEDED/);
      assert.equal((await store.read(runId)).inputs[0]?.status, 'consumed');
      assert.equal((await store.read(runId)).questions[0]?.status, choice === 'reply' ? 'answered' : 'cancelled');
    }
  } finally {
    await native.stop(); await host.close();
    if (previous.url === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_URL; else process.env.AGENTLAB_CAPABILITY_HOST_URL = previous.url;
    if (previous.key === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE; else process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = previous.key;
    await rm(root, { recursive: true, force: true });
  }
});
