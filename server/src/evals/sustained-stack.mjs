import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = resolve(process.env.AGENTLAB_SUSTAINED_STACK_ROOT ?? join(repository, 'lab/runs/.sustained-proof'));
const api = 'http://127.0.0.1:4324';
const control = 'http://127.0.0.1:19198';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const ownerPath = join(root, 'owner.json');
const tokenPath = join(root, '.control-key');

async function json(url, options, timeoutMs = 5000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${new URL(url).pathname}`);
  return response.json();
}
async function until(check, label, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await check()) return; } catch { /* Service may be starting. */ }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}; inspect ${root}/logs.`);
}
async function assertFreePort(port) {
  const probe = createPortProbe();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
}

/** Explicit local owner API: the evaluator never discovers PIDs or signals arbitrary processes. */
export async function restartOwnedNative(input) {
  const descriptor = JSON.parse(await readFile(ownerPath, 'utf8'));
  if (input.api !== descriptor.api) throw new Error('Restart hook API does not belong to the owned stack');
  return json(`${descriptor.control}/restart`, { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${(await readFile(tokenPath, 'utf8')).trim()}`,
  }, body: JSON.stringify(input) }, 180000);
}

async function launch() {
  // Explicit ports fail closed; no existing listener is stopped or re-registered.
  for (const port of [4324, 5174, 19197, 19198, 8081, 9071, 19522, 29081, 22025, 9095]) await assertFreePort(port);
  await mkdir(join(root, 'logs'), { recursive: true, mode: 0o700 });
  const localEnvironment = await import(join(repository, 'server/dist/src/control-plane/bootstrap/local-env.js'));
  const env = { ...process.env };
  localEnvironment.loadLocalServerEnvironment(env, join(repository, 'server/.env'));
  if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter credential is unavailable; no model calls were issued');
  const fixtureUrl = 'http://127.0.0.1:19197';
  const packages = JSON.parse(await readFile(join(repository, 'lab/scenarios/sustained-connected-review/packages.json'), 'utf8'));
  for (const pack of packages.packages) {
    if (pack.endpoint) pack.endpoint = `${fixtureUrl}/mcp`;
    if (pack.baseUrl) pack.baseUrl = fixtureUrl;
    if (pack.root) pack.root = join(repository, 'lab/scenarios/sustained-connected-review/skills');
  }
  const packagePath = join(root, 'packages.json');
  await writeFile(packagePath, JSON.stringify(packages, null, 2));
  const scenario = JSON.parse(await readFile(join(repository, 'lab/scenarios/sustained-connected-review/scenario.json'), 'utf8'));
  scenario.provider = fixtureUrl;
  await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario, null, 2));
  Object.assign(env, {
    AGENTLAB_API_HOST: '127.0.0.1', AGENTLAB_API_PORT: '4324', AGENTLAB_API_ORIGIN: 'http://127.0.0.1:5174', AGENTLAB_API_PROXY_TARGET: api,
    AGENTLAB_CAPABILITY_HOST_URL: api, AGENTLAB_CAPABILITY_HOST_KEY_FILE: join(root, 'runs/.capability-host.key'),
    AGENTLAB_RUN_ROOT: join(root, 'runs'), AGENTLAB_CONTEXT_ROOT: join(root, 'sessions'),
    AGENTLAB_STUDIO_RUN_ROOT: join(root, 'studio'), AGENTLAB_CAPABILITY_STATE_ROOT: join(root, 'capability-state'),
    AGENTLAB_CAPABILITY_PACKAGES: packagePath, AGENTLAB_CONNECTED_CAPABILITIES_ENABLED: 'true',
    AGENTLAB_HATCHET_RUNTIME_MODE: 'remote', AGENTLAB_HATCHET_API_URL: 'http://127.0.0.1:19999', AGENTLAB_HATCHET_HOST_PORT: '127.0.0.1:19998',
    AGENTLAB_MASTRA_WORKFLOW_ENABLED: 'false', AGENTLAB_MASTRA_STORAGE_PATH: join(root, 'mastra.db'),
    AGENTLAB_CREDENTIAL_KEY_HEX: randomBytes(32).toString('hex'),
    AGENTLAB_TEMPORAL_ENDPOINT: '127.0.0.1:7233', AGENTLAB_TEMPORAL_NAMESPACE: 'default', AGENTLAB_TEMPORAL_TASK_QUEUE: 'agentlab-sustained-proof',
    AGENTLAB_RESTATE_INGRESS_URL: 'http://127.0.0.1:8081', AGENTLAB_RESTATE_ADMIN_URL: 'http://127.0.0.1:9071',
    AGENTLAB_RESTATE_SERVICE_URL: 'http://127.0.0.1:29081', AGENTLAB_RESTATE_SERVICE_PORT: '29081',
    AGENTLAB_RESTATE_DATA_DIR: join(root, 'restate'), RESTATE_BIND_IP: '127.0.0.1', RESTATE_BIND_PORT: '19522',
    RESTATE_ADMIN__BIND_ADDRESS: '127.0.0.1:9071', RESTATE_INGRESS__BIND_ADDRESS: '127.0.0.1:8081',
    AGENTLAB_LANGGRAPH_HOST: '127.0.0.1', AGENTLAB_LANGGRAPH_PORT: '22025', AGENTLAB_LANGGRAPH_SERVICE_URL: 'http://127.0.0.1:22025',
    AGENTLAB_LANGGRAPH_STATE_DIR: join(root, 'langgraph'), PYTHONPATH: join(repository, 'server/src/platforms/langgraph'),
    AGENTLAB_VERCEL_WORKFLOWS_PORT: '9095', AGENTLAB_VERCEL_WORKFLOWS_SERVICE_URL: 'http://127.0.0.1:9095',
    AGENTLAB_VERCEL_WORKFLOWS_DATA_DIR: join(root, 'vercel'),
    AGENTLAB_CONNECTED_FIXTURE_PORT: '19197', AGENTLAB_CONNECTED_FIXTURE_ROOT: join(root, 'fixture'),
  });
  const node = path => ({ command: process.execPath, args: [join(repository, `server/dist/src/${path}`)] });
  const specs = {
    fixture: node('evals/connected-fixture.js'),
    'restate-server': { command: join(repository, 'server/src/platforms/restate/node_modules/.bin/restate-server'), args: ['--no-logo', '--node-name=agentlab-sustained-proof', '--base-dir', join(root, 'restate')] },
    restate: node('platforms/restate/service-entry.js'),
    temporal: node('platforms/temporal/runner-adapter/worker-entry.js'),
    langgraph: { command: process.env.AGENTLAB_LANGGRAPH_PYTHON ?? join(repository, 'server/src/platforms/langgraph/.local311/bin/python'), args: ['-m', 'uvicorn', 'service.app:app', '--host', '127.0.0.1', '--port', '22025'] },
    'vercel-workflows': node('platforms/vercel-workflows/service-entry.js'),
    api: node('control-plane/bootstrap/server.js'),
    web: { command: 'pnpm', args: ['--filter', '@agent-harness-lab/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5174'] },
  };
  const children = new Map();
  const owner = `sustained-stack:${process.pid}`;
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenPath, token, { mode: 0o600 });
  const publish = () => writeFile(ownerPath, JSON.stringify({ owner, pid: process.pid, api, control, root, children: Object.fromEntries([...children].map(([name, child]) => [name, child.pid])) }, null, 2), { mode: 0o600 });
  const start = async name => {
    const log = await open(join(root, `logs/${name}.log`), 'a', 0o600);
    const spec = specs[name];
    const child = spawn(spec.command, spec.args, { cwd: repository, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
    const spawned = new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject); });
    children.set(name, child);
    await log.close(); await spawned; await publish();
    return child;
  };
  const stop = async name => {
    const child = children.get(name);
    if (!child || child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned process ${name} already exited`);
    // Each detached process group was created by this launcher. No listener/PID discovery.
    process.kill(-child.pid, 'SIGKILL');
    await new Promise(done => child.once('exit', done));
    children.delete(name); await publish();
    return child.pid;
  };
  let restarting = false;
  const controller = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/restart' || request.headers.authorization !== `Bearer ${token}`) throw new Error('Invalid owned restart request');
      if (restarting) throw new Error('Another owned replacement is in progress');
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 16384) throw new Error('Request too large'); }
      const input = JSON.parse(body);
      const name = input.platform === 'mastra' ? 'api' : input.platform;
      if (input.api !== api || !['api', 'temporal', 'restate', 'langgraph', 'vercel-workflows'].includes(name)) throw new Error('Platform is not owned');
      restarting = true;
      try {
        const before = await json(`${api}/api/runs/${encodeURIComponent(input.runId)}`);
        if (before.manifest.platform !== input.platform || before.executionReference?.executionId !== input.executionReference?.executionId) throw new Error('Original native identity does not match');
        const originalActions = await json(`${api}/api/runs/${input.runId}/actions`);
        if (!originalActions.actions.some(action => action.requestId === input.action.requestId && action.revision === input.action.revision && action.call.toolCallId === input.action.toolCallId && action.status === 'pending')) throw new Error('Original pending review does not match');
        const startedAt = new Date().toISOString();
        const oldPid = await stop(name); const replacement = await start(name);
        await until(async () => {
          const health = await json(`${api}/api/platforms/${input.platform}/health`);
          if (!health.reachable) return false;
          const current = await json(`${api}/api/runs/${input.runId}`);
          const actions = await json(`${api}/api/runs/${input.runId}/actions`);
          return current.executionReference?.executionId === before.executionReference.executionId && actions.actions.some(action =>
            action.requestId === input.action.requestId && action.revision === input.action.revision && action.call.toolCallId === input.action.toolCallId && action.status === 'pending');
        }, `${input.platform} original review after replacement`);
        const storagePath = { temporal: join(root, 'runs'), restate: join(root, 'restate'), langgraph: join(root, 'langgraph'), 'vercel-workflows': join(root, 'vercel'), mastra: join(root, 'sessions') }[input.platform];
        const evidence = { platform: input.platform, runId: input.runId, ...input.action, owner, oldPid, newPid: replacement.pid, startedAt, completedAt: new Date().toISOString(), storagePath, storageRetained: true, nativeExecutionId: before.executionReference.executionId };
        await writeFile(join(root, `restart-${input.runId}.json`), JSON.stringify(evidence, null, 2));
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(evidence));
      } finally { restarting = false; }
    } catch (error) { response.statusCode = 409; response.end(JSON.stringify({ error: error.message })); }
  });
  const cleanup = async (exitCode = 0) => {
    controller.close();
    await Promise.allSettled([...children.keys()].map(stop));
    process.exit(exitCode);
  };
  process.once('SIGTERM', () => void cleanup()); process.once('SIGINT', () => void cleanup());
  try {
    await start('fixture'); await until(() => json(`${fixtureUrl}/health`), 'fictional fixture');
    await start('restate-server'); await until(async () => (await fetch('http://127.0.0.1:9071/health', { signal: AbortSignal.timeout(5000) })).ok, 'isolated Restate server');
    await start('restate');
    await until(async () => { const existing = await json('http://127.0.0.1:9071/deployments'); if (JSON.stringify(existing).includes('http://127.0.0.1:29081')) return true; const result = await fetch('http://127.0.0.1:9071/deployments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri: 'http://127.0.0.1:29081' }), signal: AbortSignal.timeout(5000) }); return result.ok; }, 'isolated Restate deployment');
    for (const name of ['temporal', 'langgraph', 'vercel-workflows', 'api']) await start(name);
    await until(async () => {
      const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) }); const health = await response.json();
      return ['temporal', 'restate', 'langgraph', 'mastra', 'vercel-workflows'].every(platform => health.platforms.some(value => value.platform === platform && value.variant === 'baseline' && value.reachable));
    }, 'five native runtimes', 180000);
    await start('web');
    await until(async () => (await fetch('http://127.0.0.1:5174/platforms/temporal/chat', { signal: AbortSignal.timeout(5000) })).ok, 'isolated frontend');
    await new Promise(done => controller.listen(19198, '127.0.0.1', done));
    console.log(`Owned sustained stack ready: ${api}; scenario ${root}/scenario.json; restart hook ${fileURLToPath(import.meta.url)}`);
  } catch (error) { console.error(error.message); await cleanup(1); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await launch();
