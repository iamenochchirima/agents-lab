import type { FastifyInstance } from 'fastify';
import type { ConnectionManager } from '../../capabilities/integrations/connections.js';

/** These are trusted local administrative routes, not a multi-tenant login API. */
export function registerConnectionRoutes(app: FastifyInstance, connections: ConnectionManager, refreshCatalog: () => Promise<void>): void {
  app.get('/api/connections', async () => ({ connections: await connections.summaries() }));
  for (const operation of ['connect', 'refresh', 'revoke'] as const) {
    app.post<{ Params: { ref: string } }>(`/api/connections/:ref/${operation}`, async (request, reply) => {
      if (!isLocal(request.ip)) return reply.code(403).send({ error: 'Connection administration requires the trusted local deployment.' });
      try {
        const outcome = operation === 'connect' ? await connections.connect(request.params.ref)
          : { connection: await connections[operation](request.params.ref) };
        await refreshCatalog();
        return { ...outcome, connection: await connections.summary(request.params.ref) };
      } catch { return reply.code(409).send({ error: 'Connection operation could not complete. Inspect its status and trusted configuration.' }); }
    });
  }
  app.get<{ Params: { ref: string }; Querystring: { state?: string; code?: string; iss?: string } }>('/api/connections/:ref/callback', async (request, reply) => {
    if (!isLocal(request.ip)) return reply.code(403).send({ error: 'OAuth callback requires the trusted local deployment.' });
    const { state, code, iss } = request.query;
    if (typeof state !== 'string' || typeof code !== 'string' || state.length > 1024 || code.length > 4096 || (iss !== undefined && typeof iss !== 'string')) return reply.code(400).send({ error: 'Invalid OAuth callback.' });
    try {
      const connection = await connections.complete(request.params.ref, state, code, iss);
      await refreshCatalog();
      return { connection: await connections.summary(request.params.ref), message: 'Connection authorized. Return to the platform agent.' };
    } catch { return reply.code(409).send({ error: 'OAuth callback was rejected. Start a fresh connection request.' }); }
  });
}
function isLocal(ip: string): boolean { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; }
