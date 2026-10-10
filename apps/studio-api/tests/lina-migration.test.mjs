import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerStudioLinaRoutes } from '../dist/http/lina.js';

test('retired Lina writes preserve a recoverable saved snapshot across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lab-lina-migration-'));
  const path = join(directory, 'studio.sqlite');
  let app;
  try {
    app = Fastify();
    registerStudioLinaRoutes(app, path);
    await app.close();
    const document = { version: 1, nodes: [{ id: 'saved', title: 'Saved design', area: 'input', status: 'studying', x: 123, y: -45, purpose: '', inputs: '', outputs: '', decisions: 'retain', references: '', experiments: 'user annotation' }], edges: [] };
    const database = new DatabaseSync(path);
    database.prepare('UPDATE lina_architecture SET revision = ?, document = ? WHERE singleton = 1').run(7, JSON.stringify(document));
    database.close();
    for (let iteration = 0; iteration < 2; iteration++) {
      app = Fastify();
      registerStudioLinaRoutes(app, path);
      const before = await app.inject({ method: 'GET', url: '/lina' });
      assert.equal(before.statusCode, 200);
      assert.deepEqual(before.json(), { revision: 7, document });
      const denied = await app.inject({ method: 'PUT', url: '/lina', payload: { revision: 7, document: { version: 1, nodes: [], edges: [] } } });
      assert.equal(denied.statusCode, 410);
      assert.equal(denied.json().error, 'LINA_ARCHITECTURE_MOVED');
      assert.equal(denied.json().inspectionUrl, 'http://127.0.0.1:4318/#architecture');
      const after = await app.inject({ method: 'GET', url: '/lina' });
      assert.deepEqual(after.json(), before.json());
      await app.close();
    }
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
