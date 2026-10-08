import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CapabilityAdminSessions } from '../../src/capabilities/management/admin-session.js';

test('local management requires a private session, expected origin and CSRF, with expiry', async () => {
  const app = Fastify(); let now = 1000; const token = 'a'.repeat(64); const origin = 'http://localhost:5173';
  const sessions = await CapabilityAdminSessions.create('/unused', [origin], token, () => now);
  sessions.register(app); app.post('/api/management/check', async () => ({ saved: true }));
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/management/session' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/session', headers: { origin: 'https://foreign.example' }, payload: { token } })).statusCode, 403);
    const unlocked = await app.inject({ method: 'POST', url: '/api/management/session', headers: { origin }, payload: { token } });
    assert.equal(unlocked.statusCode, 200); assert(!unlocked.body.includes(token));
    const cookie = String(unlocked.headers['set-cookie']).split(';')[0]!;
    assert.match(String(unlocked.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
    const headers = { cookie, origin, 'x-agentlab-csrf': unlocked.json().csrfToken };
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { cookie, origin } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/management/check', headers: { ...headers, origin: 'https://foreign.example' } })).statusCode, 403);
    now += 3600001;
    assert.equal((await app.inject({ method: 'GET', url: '/api/management/session', headers: { cookie } })).statusCode, 401);
  } finally { await app.close(); }
});
