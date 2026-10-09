import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { IntegrationNetworkPolicy } from '../../src/capabilities/management/network-policy.js';

test('hostname requests use the validated DNS address with Node family selection enabled by default', async () => {
  const server = createServer((_request, response) => { response.end('connected'); });
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    const response = await new IntegrationNetworkPolicy().fetch(`http://localhost:${address.port}`, { signal: AbortSignal.timeout(2000) });
    assert.equal(await response.text(), 'connected');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('integration policy permits explicit loopback but blocks metadata and credential URLs', async () => {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end('{"connected":true}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const policy = new IntegrationNetworkPolicy();
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    assert.deepEqual(await (await policy.fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(1000) })).json(), { connected: true });
    await assert.rejects(policy.destination('https://169.254.169.254/latest/meta-data'), /network policy/);
    await assert.rejects(policy.destination('https://127.0.0.1/?token=secret'), /embedded credentials/);
    await assert.rejects(policy.destination('https://user:secret@example.com/'), /embedded credentials/);
    await assert.rejects(policy.destination('https://10.1.2.3/'), /network policy/);
    assert.equal((await new IntegrationNetworkPolicy(['10.1.2.3']).destination('https://10.1.2.3/')).address, '10.1.2.3');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
