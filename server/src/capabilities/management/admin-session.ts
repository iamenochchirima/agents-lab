import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const COOKIE = 'agentlab_capability_admin';
const TTL_MS = 60 * 60 * 1000;
interface Session { csrf: string; expiresAt: number }

/** Local workspace administration, separate from platform-worker authentication.
 * The deployment token is private infrastructure. Cookies and CSRF values are
 * ephemeral and expire after one hour or a backend restart. This does not supply
 * hosted tenant authentication. Vite/reverse-proxy routes must be same-origin.
 */
export class CapabilityAdminSessions {
  private readonly sessions = new Map<string, Session>();
  private constructor(private readonly token: string, private readonly origins: readonly string[], private readonly now: () => number) {}

  static async create(root: string, origins: readonly string[], configuredToken?: string, now = Date.now): Promise<CapabilityAdminSessions> {
    if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Capability administration requires explicit frontend origins.');
    let token = configuredToken;
    if (!token) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = join(root, 'admin.token');
      try { await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 256 || (stat.mode & 0o077) !== 0) throw new Error('Capability admin token must be a private regular file.');
        token = (await handle.readFile('utf8')).trim();
      } finally { await handle.close(); }
    }
    if (!/^[a-zA-Z0-9_-]{32,256}$/.test(token)) throw new Error('Capability admin token requires 32 to 256 safe characters.');
    return new CapabilityAdminSessions(token, origins, now);
  }

  register(app: FastifyInstance): void {
    app.addHook('preHandler', async (request, reply) => {
      const path = request.url.split('?')[0]!;
      if (!path.startsWith('/api/management/')) return;
      if (!local(request.ip) || (request.headers.origin !== undefined && !this.origins.includes(String(request.headers.origin)))) {
        return reply.code(403).send({ error: 'Capability management requires the trusted local frontend.' });
      }
      if (path === '/api/management/session' && request.method === 'POST') return;
      // OAuth returns across sites, so it cannot rely on SameSite session cookies.
      // The callback handler verifies one-use state, PKCE and issuer instead.
      if (request.method === 'GET' && /^\/api\/management\/connections\/[a-z0-9_-]+\/callback$/.test(path)) return;
      const session = this.session(request);
      if (!session) return reply.code(401).send({ error: 'Unlock capability management with the local administrator token.' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          (!this.origins.includes(String(request.headers.origin ?? '')) || !equal(String(request.headers['x-agentlab-csrf'] ?? ''), session.csrf))) {
        return reply.code(403).send({ error: 'Capability management request could not be authorized.' });
      }
    });
    app.post<{ Body: { token?: unknown } }>('/api/management/session', async (request, reply) => {
      if (!local(request.ip) || !this.origins.includes(String(request.headers.origin ?? '')) || typeof request.body?.token !== 'string' || !equal(request.body.token, this.token)) {
        return reply.code(401).send({ error: 'Capability management could not be unlocked.' });
      }
      this.expire();
      if (this.sessions.size >= 32) return reply.code(429).send({ error: 'Too many active management sessions.' });
      const cookie = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      this.sessions.set(hash(cookie), { csrf, expiresAt: this.now() + TTL_MS });
      reply.header('set-cookie', `${COOKIE}=${cookie}; HttpOnly; SameSite=Strict; Path=/api/management; Max-Age=3600${String(request.headers.origin).startsWith('https:') ? '; Secure' : ''}`);
      reply.header('cache-control', 'no-store');
      return { csrfToken: csrf, expiresAt: new Date(this.now() + TTL_MS).toISOString(), owner: 'local-workspace' };
    });
    app.get('/api/management/session', async (request, reply) => {
      const session = this.session(request)!;
      reply.header('cache-control', 'no-store');
      return { csrfToken: session.csrf, expiresAt: new Date(session.expiresAt).toISOString(), owner: 'local-workspace' };
    });
    app.delete('/api/management/session', async (request, reply) => {
      const cookie = readCookie(request); if (cookie) this.sessions.delete(hash(cookie));
      reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/management; Max-Age=0`);
      return { locked: true };
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
