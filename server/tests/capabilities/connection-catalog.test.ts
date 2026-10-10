import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ConnectionManager } from '../../src/capabilities/integrations/connections.js';
import { loadCapabilityPackages } from '../../src/capabilities/extensions/packages.js';
import { createPackageCapabilityCatalog } from '../../src/capabilities/extensions/catalog.js';
import { registerConnectionRoutes } from '../../src/control-plane/http/connections.js';

test('offline source permits startup, explicit refresh discovers tools, revoke blocks frozen authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentlab-source-lifecycle-'));
  let lookupSchema: Record<string, unknown> = { type: 'object' };
  const remote = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { tools: [{ name: 'lookup', description: 'Look up business data', inputSchema: lookupSchema }] } }));
  });
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
  const address = remote.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>(resolve => remote.close(() => resolve()));
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const definitions = [{ ref: 'conn_business', displayName: 'Business service', provider: 'fixture', owner: 'development', resource: endpoint, scopes: ['lookup'], auth: { kind: 'anonymous' as const } }];
  const manager = await ConnectionManager.create(definitions, { stateRoot: join(root, 'connections') });
  const configPath = join(root, 'packages.json');
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, connections: definitions, packages: [{ id: 'remote', version: '1.0.0', source: 'mcp', endpoint, connectionRef: 'conn_business', protocolVersion: '2026-07-28', tools: [{ remoteName: 'lookup', name: 'business_lookup', riskClass: 'read' }] }] }));
  const initial = await loadCapabilityPackages(configPath, { connections: manager, allowUnavailable: true });
  const catalog = createPackageCapabilityCatalog(initial);
  assert.equal(catalog.list().find(p => p.id === 'remote')?.available, false);
  assert.equal(initial.tools.length, 0);
  const app = Fastify();
  registerConnectionRoutes(app, manager, async () => { manager.reportSourceAvailability('conn_business', null); catalog.replace(createPackageCapabilityCatalog(await loadCapabilityPackages(configPath, { connections: manager, allowUnavailable: true }))); });
  try {
    await new Promise<void>(resolve => remote.listen(port, '127.0.0.1', resolve));
    assert.equal((await app.inject({ method: 'POST', url: '/api/connections/conn_business/refresh' })).statusCode, 200);
    assert.equal(catalog.list().find(p => p.id === 'remote')?.available, true);
    assert.equal(catalog.list().find(p => p.id === 'remote')?.capabilities[0].connectionRef, 'conn_business');
    const resolution = catalog.resolve('remote').resolution;
    assert.equal(resolution.grants.length, 1);
    assert.equal(resolution.grants[0].grant.connectionRef, 'conn_business');
    const frozen = catalog.toolSnapshot(['business_lookup'], resolution);
    lookupSchema = { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false };
    assert.equal((await app.inject({ method: 'POST', url: '/api/connections/conn_business/refresh' })).statusCode, 200);
    const refreshed = catalog.toolSnapshot(['business_lookup'], catalog.resolve('remote').resolution);
    assert.notEqual(refreshed.revision, frozen.revision);
    assert.deepEqual(frozen.tools[0].definition.inputSchema, { type: 'object' }, 'Refresh must not rewrite a retained run declaration');
    assert.deepEqual(refreshed.tools[0].definition.inputSchema, lookupSchema, 'A later admission gets the discovered schema without native loop edits');
    const binding = await manager.binding('conn_business');
    assert.deepEqual(await binding.resolveHeaders(new AbortController().signal), {});
    assert.equal((await app.inject({ method: 'POST', url: '/api/connections/conn_business/revoke' })).statusCode, 200);
    await assert.rejects(binding.resolveHeaders(new AbortController().signal), /authority/);
    const restarted = await ConnectionManager.create(definitions, { stateRoot: join(root, 'connections') });
    assert.equal((await restarted.summary('conn_business')).status, 'revoked');
    await manager.connect('conn_business');
    await assert.rejects(binding.resolveHeaders(new AbortController().signal), /authority/);
    assert.equal(frozen.tools[0].connection?.authorityRevision, binding.connection.authorityRevision);
    assert.notEqual((await manager.binding('conn_business')).connection.authorityRevision, binding.connection.authorityRevision);
    assert.equal((await app.inject({ method: 'POST', url: '/api/connections/conn_business/revoke', remoteAddress: '192.0.2.10' })).statusCode, 403);
  } finally {
    await app.close(); remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve())); await rm(root, { recursive: true, force: true });
  }
});
