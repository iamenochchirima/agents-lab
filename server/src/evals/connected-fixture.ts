import Fastify from 'fastify';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Fictional, local-only provider for connected-task acceptance. Never proxies an account. */
export async function startConnectedFixture() {
  const root = resolve(process.env.AGENTLAB_CONNECTED_FIXTURE_ROOT ?? '../lab/runs/.connected-fixture');
  await mkdir(root, { recursive: true });
  const app = Fastify();
  const namespace = { type: 'string', pattern: '^cap-[a-z0-9-]{1,100}$' };
  const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
  const tools = [
    { name: 'dispatch.inspect', description: 'Read Cedar release record and revision in the supplied disposable namespace. A missing record returns an actionable error.', inputSchema: schema({ namespace, key: { type: 'string' } }, ['namespace', 'key']) },
    { name: 'dispatch.assign', description: 'Assign a documentation owner to Cedar, preserving date/dependency/status. Requires expectedRevision from inspect. This is a mutation and needs exact action review.', inputSchema: schema({ namespace, key: { type: 'string', enum: ['cedar'] }, expectedRevision: { type: 'integer', minimum: 1 }, owner: { type: 'string', minLength: 1, maxLength: 40 } }, ['namespace', 'key', 'expectedRevision', 'owner']) },
  ];
  const state = async (id: string) => {
    if (!/^cap-[a-z0-9-]{1,100}$/.test(id)) throw new Error('Invalid disposable namespace');
    try { return JSON.parse(await readFile(join(root, `${id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { key: 'cedar', owner: 'Unassigned', revision: 1, approvedDate: '2026-11-12', dependency: 'Documentation incomplete', status: 'blocked', effectCount: 0 }; }
  };
  app.get('/health', async () => ({ ready: true, mode: 'controlled-fictional-provider', version: '1.0.0' }));
  app.get<{ Params: { namespace: string } }>('/state/:namespace', request => state(request.params.namespace));
  app.get('/handbook', async () => ({ project: 'cedar', approvedDate: '2026-11-12', rule: 'Assign exactly the requested documentation owner; retain blocked status until documentation is complete.' }));
  app.post('/mcp', async (request, reply) => {
    const body = request.body as { id?: unknown; method: string; params?: Record<string, any> };
    if (body.method === 'notifications/initialized') return reply.code(202).send();
    let result: unknown;
    if (body.method === 'initialize') result = { protocolVersion: '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'fictional-dispatch-board', version: '1.0.0' } };
    else if (body.method === 'tools/list') result = { tools };
    else if (body.method === 'tools/call') {
      const args = body.params?.arguments ?? {};
      const current = await state(args.namespace);
      let value: unknown = current; let isError = false;
      if (args.key !== 'cedar') { value = { code: 'RECORD_NOT_FOUND', message: 'Only cedar exists in this disposable namespace.' }; isError = true; }
      else if (body.params?.name === 'dispatch.assign') {
        if (args.expectedRevision !== current.revision) { value = { code: 'REVISION_CONFLICT', message: 'Read the latest record before proposing another assignment.' }; isError = true; }
        else {
          value = { ...current, owner: args.owner, revision: current.revision + 1, effectCount: current.effectCount + 1 };
          const path = join(root, `${args.namespace}.json`); const temporary = `${path}.tmp`;
          await writeFile(temporary, JSON.stringify(value)); await rename(temporary, path);
        }
      } else if (body.params?.name !== 'dispatch.inspect') { value = { code: 'UNKNOWN_TOOL', message: 'Select a discovered operation.' }; isError = true; }
      result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
    } else return reply.send({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unsupported fixture method' } });
    return reply.send({ jsonrpc: '2.0', id: body.id, result });
  });
  await app.listen({ host: '127.0.0.1', port: Number(process.env.AGENTLAB_CONNECTED_FIXTURE_PORT ?? 19196) });
  return app;
}
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) await startConnectedFixture();
