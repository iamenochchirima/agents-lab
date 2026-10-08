import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CapabilityAdminSessions } from '../../src/capabilities/management/admin-session.js';
import { trustedFrontendOrigins } from '../../src/control-plane/bootstrap/frontend-origins.js';

test('local management automatically establishes a session, retaining origin and CSRF guards', async () => {
  const app = Fastify(); let now = 1000; const origin = 'http://localhost:5173';
  const sessions = await CapabilityAdminSessions.create(trustedFrontendOrigins(origin), () => now);
  sessions.register(app);
  app.get('/api/management/state', async () => ({ connections: [] }));
  app.post('/api/management/check', async () => ({ saved: true }));
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/management/session', remoteAddress: '192.0.2.1' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/management/session', headers: { origin: 'https://foreign.example' } })).statusCode, 403);
    const established = await app.inject({ method: 'GET', url: '/api/management/session' });
    assert.equal(established.statusCode, 200);
    const cookie = String(established.headers['set-cookie']).split(';')[0]!;
    assert.match(String(established.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
    const headers = { cookie, origin, 'x-agentlab-csrf': established.json().csrfToken };
    assert.equal((await app.inject({ method: 'GET', url: '/api/management/state', headers: { cookie } })).statusCode, 200);
    const reused = await app.inject({ method: 'GET', url: '/api/management/session', headers: { cookie } });
    assert.equal(reused.json().csrfToken, established.json().csrfToken);
    assert.equal(reused.headers['set-cookie'], undefined);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { cookie, origin } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { cookie, 'x-agentlab-csrf': headers['x-agentlab-csrf'] } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { ...headers, origin: 'http://127.0.0.1:5173' }, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { ...headers, origin: 'http://127.0.0.1:5174' }, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { ...headers, origin: 'https://foreign.example' } })).statusCode, 403);
    now += 3600001;
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers })).statusCode, 401);
    const renewed = await app.inject({ method: 'GET', url: '/api/management/session', headers: { cookie } });
    assert.equal(renewed.statusCode, 200);
    assert.notEqual(renewed.json().csrfToken, established.json().csrfToken);
    const renewedHeaders = { origin, cookie: String(renewed.headers['set-cookie']).split(';')[0]!, 'x-agentlab-csrf': renewed.json().csrfToken };
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: renewedHeaders })).statusCode, 200);
  } finally { await app.close(); }
});
