import type { FastifyInstance } from 'fastify';
import { CapabilitySetupRequired, type CapabilityManagement } from '../../capabilities/management/service.js';
import type { CapabilityAdminSessions } from '../../capabilities/management/admin-session.js';
import type { ManagedConnectionRecord, ManagedPackageRecord, ManagedProfileRecord } from '../../capabilities/management/records.js';
import { ManagedRevisionConflict } from '../../capabilities/management/repository.js';
import type { CredentialSecret } from '../../capabilities/management/credentials.js';

/** Trusted local administration endpoints. Safe read models contain references,
 * never secret bytes. All write routes are guarded by admin-session preHandler.
 */
export function registerCapabilityManagement(app: FastifyInstance, management: CapabilityManagement, sessions: CapabilityAdminSessions): void {
  sessions.register(app);
  app.get('/api/management/state', async (_request, reply) => { reply.header('cache-control', 'no-store'); return management.view(); });
  app.get<{ Params: { id: string; name: string } }>('/api/management/packages/:id/skills/:name', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try { return await management.inspectSkill(request.params.id, request.params.name); }
    catch (error) { return failure(reply, error); }
  });
  app.get('/api/connections', async () => ({ connections: await management.connections.summaries() }));
  app.post<{ Body: { expectedRevision: number; connection: ManagedConnectionRecord; credential?: CredentialSecret } }>('/api/management/connections', async (request, reply) => {
    try { return await management.saveConnection(request.body.expectedRevision, request.body.connection, request.body.credential); }
    catch (error) { return failure(reply, error); }
  });
  app.post<{ Body: { expectedRevision: number; package: ManagedPackageRecord; environment?: Record<string, string> } }>('/api/management/packages', async (request, reply) => {
    try { return await management.savePackage(request.body.expectedRevision, request.body.package, request.body.environment); }
    catch (error) { return failure(reply, error); }
  });
  app.post<{ Body: { expectedRevision: number; profile: ManagedProfileRecord } }>('/api/management/profiles', async (request, reply) => {
    try { return await management.saveProfile(request.body.expectedRevision, request.body.profile); }
    catch (error) { return failure(reply, error); }
  });
  for (const kind of ['connections', 'packages', 'profiles', 'installations'] as const) {
    app.delete<{ Params: { id: string }; Body: { expectedRevision: number } }>(`/api/management/${kind}/:id`, async (request, reply) => {
      try { return await management.remove(request.body.expectedRevision, kind, request.params.id); }
      catch (error) { return failure(reply, error); }
    });
  }
  for (const action of ['connect', 'refresh', 'revoke', 'discover'] as const) {
    app.post<{ Params: { ref: string }; Body: { expectedRevision: number } }>(`/api/management/connections/:ref/${action}`, async (request, reply) => {
      try { const revision = management.repository.read().revision; if (request.body.expectedRevision !== revision) throw new ManagedRevisionConflict(request.body.expectedRevision, revision); return await management.connectionAction(request.params.ref, action); }
      catch (error) { return failure(reply, error); }
    });
  }
  for (const path of ['/api/management/connections/:ref/callback', '/api/connections/:ref/callback']) {
    app.get<{ Params: { ref: string }; Querystring: { state?: string; code?: string; iss?: string } }>(path, async (request, reply) => {
      const { state, code, iss } = request.query;
      if (typeof state !== 'string' || typeof code !== 'string' || state.length > 1024 || code.length > 4096 || (iss !== undefined && (typeof iss !== 'string' || iss.length > 2048))) return reply.code(400).send({ error: 'Invalid OAuth callback.' });
      try {
        await management.connections.complete(request.params.ref, state, code, iss);
        await management.reload();
        reply.header('cache-control', 'no-store');
        return { message: 'Account connected. Return to capability management and refresh.' };
      } catch { return reply.code(409).send({ error: 'OAuth callback was rejected. Start authorization again.' }); }
    });
  }
  app.post<{ Body: InstallationInput }>('/api/management/installations/preview', { bodyLimit: 24 * 1024 * 1024 }, async (request, reply) => {
    try { return await management.previewInstallation(request.body); }
    catch (error) { return failure(reply, error); }
  });
  app.post<{ Body: InstallationInput & { expectedRevision: number } }>('/api/management/installations', { bodyLimit: 24 * 1024 * 1024 }, async (request, reply) => {
    try { return await management.install(request.body.expectedRevision, request.body); }
    catch (error) { return failure(reply, error); }
  });
}
export interface InstallationInput { archiveBase64?: string; repositoryUrl?: string; commit?: string; id?: string; version?: string }
function failure(reply: import('fastify').FastifyReply, error: unknown) {
  if (error instanceof CapabilitySetupRequired) return reply.code(400).send({ error: error.message, code: 'SETUP_REQUIRED' });
  if (error instanceof ManagedRevisionConflict) return reply.code(409).send({ error: error.message, code: 'REVISION_CONFLICT' });
  // Provider and credential errors may include untrusted/private material.
  // Named safe application errors can be introduced as a separate read model.
  return reply.code(400).send({ error: 'Capability operation could not complete. Check the connection, setup fields, dependencies and current configuration.' });
}
