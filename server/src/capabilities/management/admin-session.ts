import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'agentlab_capability_admin';
const TTL_MS = 60 * 60 * 1000;
interface Session { csrf: string; expiresAt: number }

/** Automatic local workspace request sessions, separate from platform-worker authentication.
 * Cookies and CSRF values are ephemeral and expire after one hour or a backend
 * restart. They protect local request integrity, not user identity or hosted
 * tenant access. Vite/reverse-proxy routes must be same-origin.
 */
export class CapabilityAdminSessions {
  private readonly sessions = new Map<string, Session>();
  private constructor(private readonly origins: readonly string[], private readonly now: () => number) {}

  static async create(origins: readonly string[], now = Date.now): Promise<CapabilityAdminSessions> {
    if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Capability management requires explicit frontend origins.');
    return new CapabilityAdminSessions(origins, now);
  }

  register(app: FastifyInstance): void {
    app.addHook('preHandler', async (request, reply) => {
      const path = request.url.split('?')[0]!;
      if (!path.startsWith('/api/management/')) return;
      if (!local(request.ip) || (request.headers.origin !== undefined && !this.origins.includes(String(request.headers.origin)))) {
        return reply.code(403).send({ error: 'Capability management requires the trusted local frontend.' });
      }
      if (path === '/api/management/session' && ['GET', 'POST'].includes(request.method)) return;
      // OAuth returns across sites, so it cannot rely on SameSite session cookies.
      // The callback handler verifies one-use state, PKCE and issuer instead.
      if (request.method === 'GET' && /^\/api\/management\/connections\/[a-z0-9_-]+\/callback$/.test(path)) return;
      const session = this.session(request);
      if (!session) return reply.code(401).send({ error: 'Local management session expired. Refresh the session and retry.' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          (!this.origins.includes(String(request.headers.origin ?? '')) || !equal(String(request.headers['x-agentlab-csrf'] ?? ''), session.csrf))) {
        return reply.code(403).send({ error: 'Capability management request could not be authorized.' });
      }
    });
    // Session bootstrap is automatic: no deployment password or login UI.
    // Reuse a live cookie so ordinary page reloads do not consume session slots.
    const establish = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
      if (request.method === 'POST' && !this.origins.includes(String(request.headers.origin ?? ''))) {
        return reply.code(403).send({ error: 'Capability management requires the trusted local frontend.' });
      }
      const existing = this.session(request);
      if (existing) return { csrfToken: existing.csrf, expiresAt: new Date(existing.expiresAt).toISOString(), owner: 'local-workspace' };
      if (this.sessions.size >= 32) return reply.code(429).send({ error: 'Too many active management sessions.' });
      const cookie = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      const expiresAt = this.now() + TTL_MS;
      this.sessions.set(hash(cookie), { csrf, expiresAt });
      reply.header('set-cookie', `${COOKIE}=${cookie}; HttpOnly; SameSite=Strict; Path=/api/management; Max-Age=3600${String(request.headers.origin ?? request.headers.referer ?? '').startsWith('https:') ? '; Secure' : ''}`);
      return { csrfToken: csrf, expiresAt: new Date(expiresAt).toISOString(), owner: 'local-workspace' };
    };
    app.get('/api/management/session', establish);
    app.post('/api/management/session', establish);
    app.delete('/api/management/session', async (request, reply) => {
      const cookie = readCookie(request); if (cookie) this.sessions.delete(hash(cookie));
      reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/management; Max-Age=0`);
      return { cleared: true };
    });
  }
  private session(request: FastifyRequest): Session | undefined {
    this.expire(); const cookie = readCookie(request); return cookie ? this.sessions.get(hash(cookie)) : undefined;
  }
  private expire(): void { for (const [id, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(id); }
}
function readCookie(request: FastifyRequest): string | undefined {
  const match = /(?:^|;\s*)agentlab_capability_admin=([a-zA-Z0-9_-]{32,256})(?:;|$)/.exec(request.headers.cookie ?? '');
  return match?.[1];
}
function local(ip: string): boolean { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function equal(a: string, b: string): boolean { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
