import Fastify from 'fastify';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Fictional, local-only provider for connected-task acceptance. Never proxies an account. */
export async function startConnectedFixture(options: { root?: string; port?: number } = {}) {
  const root = resolve(options.root ?? process.env.AGENTLAB_CONNECTED_FIXTURE_ROOT ?? '../lab/runs/.connected-fixture');
  await mkdir(root, { recursive: true });
  const app = Fastify();
  const namespace = { type: 'string', pattern: '^cap-[a-z0-9-]{1,100}$' };
  const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
  const tools = [
    { name: 'dispatch.inspect', description: 'Read Cedar release record and revision in the supplied disposable namespace. A missing record returns an actionable error.', inputSchema: schema({ namespace, key: { type: 'string' } }, ['namespace', 'key']) },
    { name: 'dispatch.assign', description: 'Assign a documentation owner to Cedar, preserving date/dependency/status. Requires expectedRevision from inspect. This is a mutation and needs exact action review.', inputSchema: schema({ namespace, key: { type: 'string', enum: ['cedar'] }, expectedRevision: { type: 'integer', minimum: 1 }, owner: { type: 'string', minLength: 1, maxLength: 40 } }, ['namespace', 'key', 'expectedRevision', 'owner']) },
    { name: 'collection.list', description: 'List the six fictional release records in a disposable collection. Read only.', inputSchema: schema({ namespace }, ['namespace']) },
    { name: 'collection.inspect', description: 'Read one fictional collection record with its revision. Read only.', inputSchema: schema({ namespace, key: { type: 'string', enum: ['cedar', 'birch', 'maple', 'oak', 'pine', 'willow'] } }, ['namespace', 'key']) },
    { name: 'collection.correct', description: 'Correct only a fictional record documentation owner, preserving release constraints. Requires current expectedRevision and exact action approval.', inputSchema: schema({ namespace, key: { type: 'string', enum: ['cedar', 'birch', 'maple', 'oak', 'pine', 'willow'] }, expectedRevision: { type: 'integer', minimum: 1 }, owner: { type: 'string', minLength: 1, maxLength: 40 } }, ['namespace', 'key', 'expectedRevision', 'owner']) },
  ];
  const state = async (id: string) => {
    if (!/^cap-[a-z0-9-]{1,100}$/.test(id)) throw new Error('Invalid disposable namespace');
    try { return JSON.parse(await readFile(join(root, `${id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { key: 'cedar', owner: 'Unassigned', revision: 1, approvedDate: '2026-11-12', dependency: 'Documentation incomplete', status: 'blocked', effectCount: 0 }; }
  };
  app.get('/health', async () => ({ ready: true, mode: 'controlled-fictional-provider', version: '1.0.0' }));
  app.get<{ Params: { namespace: string } }>('/state/:namespace', request => state(request.params.namespace));
  app.get('/handbook', async () => ({ project: 'cedar', approvedDate: '2026-11-12', rule: 'Assign exactly the requested documentation owner; retain blocked status until documentation is complete.' }));
  const reference = { cedar: 'Morgan', birch: 'Avery', maple: 'Jordan', oak: 'Taylor', pine: 'Riley', willow: 'Casey' };
  const collectionState = async (id: string) => {
    if (!/^cap-[a-z0-9-]{1,100}$/.test(id)) throw new Error('Invalid disposable namespace');
    try { return JSON.parse(await readFile(join(root, `${id}.collection.json`), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { effectCount: 0, effects: [], records: Object.fromEntries(Object.entries(reference).map(([key, owner]) => [key, {
        key, owner: ['birch', 'oak'].includes(key) ? owner : key === 'pine' ? 'Devon' : 'Unassigned', revision: 1,
        approvedDate: '2026-11-12', dependency: 'Documentation incomplete', status: 'blocked',
      }])) };
    }
  };
  // Reads and corrections share one collection queue. Concurrent calls must not
  // lose increments or validate the same revision before either write commits.
  const collectionQueues = new Map<string, Promise<unknown>>();
  const collectionOperation = async (id: string, operation: (current: any) => Promise<unknown>) => {
    const previous = collectionQueues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => operation(await collectionState(id)));
    collectionQueues.set(id, next);
    try { return await next; } finally { if (collectionQueues.get(id) === next) collectionQueues.delete(id); }
  };
  app.get<{ Params: { namespace: string } }>('/collection-state/:namespace', request => collectionOperation(request.params.namespace, async current => current));
  app.get('/collection-reference', async () => ({ source: 'release-reference', revision: 1,
    records: Object.entries(reference).map(([key, owner]) => ({ key, owner })),
    constraints: { approvedDate: '2026-11-12', dependency: 'Documentation incomplete', status: 'blocked',
      rule: 'Correct discrepant documentation owners only. Preserve dates, dependencies and blocked status. A denied correction stays unchanged.' } }));
  app.post('/mcp', async (request, reply) => {
    const body = request.body as { id?: unknown; method: string; params?: Record<string, any> };
    if (body.method === 'notifications/initialized') return reply.code(202).send();
    let result: unknown;
    if (body.method === 'initialize') result = { protocolVersion: '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'fictional-dispatch-board', version: '1.0.0' } };
    else if (body.method === 'tools/list') result = { tools };
    else if (body.method === 'tools/call') {
      const args = body.params?.arguments ?? {};
      if (String(body.params?.name).startsWith('collection.')) {
        const value: any = await collectionOperation(args.namespace, async current => {
          if (body.params?.name === 'collection.list') return { records: Object.values(current.records), effectCount: current.effectCount };
          const record = current.records[args.key];
          if (!record) return { code: 'RECORD_NOT_FOUND', message: 'Select one record in the declared disposable collection.' };
          if (body.params?.name === 'collection.inspect') return record;
          if (body.params?.name !== 'collection.correct') return { code: 'UNKNOWN_TOOL', message: 'Select a discovered collection operation.' };
          if (args.expectedRevision !== record.revision) return { code: 'REVISION_CONFLICT', message: 'Read the latest record before another correction.' };
          if (typeof args.owner !== 'string' || !args.owner.trim() || args.owner.length > 40) return { code: 'INVALID_OWNER', message: 'Owner must be non-empty bounded text.' };
          const corrected = { ...record, owner: args.owner, revision: record.revision + 1 };
          const changed = { ...current, records: { ...current.records, [args.key]: corrected }, effectCount: current.effectCount + 1,
            effects: [...current.effects, { key: args.key, owner: args.owner, expectedRevision: args.expectedRevision, revision: corrected.revision }] };
          const path = join(root, `${args.namespace}.collection.json`);
          await writeFile(`${path}.tmp`, JSON.stringify(changed)); await rename(`${path}.tmp`, path);
          return corrected;
        });
        return reply.send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(value.code ? { isError: true } : {}) } });
      }
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
  await app.listen({ host: '127.0.0.1', port: options.port ?? Number(process.env.AGENTLAB_CONNECTED_FIXTURE_PORT ?? 19196) });
  return app;
}
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) await startConnectedFixture();
