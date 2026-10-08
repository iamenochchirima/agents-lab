/** Real-model acceptance observer; native platforms own the model/tool loop.
 * Only disposable exact-marker notes can receive invocation approval. No direct
 * provider writes, model routing fallback or automatic unknown-write retries exist.
 * Show the saved prompt to the user before starting this executable.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { RunView } from '../src/control-plane/application/run-service.js';
import type { InvocationReviewView } from '../src/capabilities/reviews/contracts.js';
import type { CapabilityProfileView } from '../src/capabilities/catalog.js';
import { capabilityWorkspaceRoot } from '../src/capabilities/extensions/runtime.js';
import { loadLocalServerEnvironment } from '../src/control-plane/bootstrap/local-env.js';
import { loadServerConfig } from '../src/control-plane/bootstrap/config.js';
import { assertFreeModelCatalog, DEFAULT_FREE_MODEL, FREE_PROVIDER_ROUTING } from '../src/models/openrouter/free-model-policy.js';
import { validateCapabilityRouting } from '../src/evals/capability-evidence.js';
import { skillResourceDelivered } from '../src/evals/managed-skill-evidence.js';
import { terminateObservation } from '../src/evals/observer-termination.js';

interface Receipt { toolCallId: string; toolName: string; status: string; result?: { status: string; content: string }; sequence: number | null; output: Record<string, unknown> }
interface Snapshot { status: number; memo?: Record<string, unknown> }
const active = new Set(['queued', 'running', 'suspended']);
const writes = ['memo_create_memo', 'memo_update_memo', 'memo_delete_memo'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

async function main() {
  const offlineArgs = process.argv.slice(2).filter(value => value !== '--');
  if (offlineArgs[0] === '--regrade-read-only') {
    if (offlineArgs.length !== 2) throw new Error('Offline regrade accepts only one retained evidence directory.');
    await regradeReadOnly(offlineArgs[1]!, capabilityWorkspaceRoot()); return;
  }
  loadLocalServerEnvironment();
  const root = capabilityWorkspaceRoot(), config = loadServerConfig(process.env, root);
  let api = process.env.AGENTLAB_CAPABILITY_CHECK_API ?? 'http://127.0.0.1:4322';
  let platforms = ['mastra', 'langgraph', 'temporal', 'restate'], model = DEFAULT_FREE_MODEL, deadlineMs = 300_000, denyCreate = false, stdio = false, readOnlyNotes = false, memoryFile = process.env.AGENTLAB_MEMORY_ACCEPTANCE_FILE, cleanupExisting: string | undefined;
  const args = process.argv.slice(2).filter(value => value !== '--');
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]!;
    if (argument === '--deny-create') { denyCreate = true; continue; }
    if (argument === '--stdio') { stdio = true; continue; }
    if (argument === '--read-only-notes') { readOnlyNotes = true; continue; }
    const value = args[++i]; if (!value) throw new Error('Acceptance option requires a value.');
    if (argument === '--api') api = value;
    else if (argument === '--platforms') platforms = value.split(',');
    else if (argument === '--cleanup-existing') cleanupExisting = value;
    else if (argument === '--memory-file') memoryFile = value;
    else if (argument === '--model') model = value;
    else if (argument === '--deadline-ms') deadlineMs = Number(value);
    else throw new Error('Unknown acceptance option.');
  }
  if (!platforms.length || new Set(platforms).size !== platforms.length || platforms.some(platform => !['mastra', 'langgraph', 'temporal', 'restate'].includes(platform))) throw new Error('Choose distinct supported native platforms.');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 600_000) throw new Error('Acceptance deadline must be 1000–600000ms.');
  if (cleanupExisting && (!/^cm-[a-f0-9]{26}$/.test(cleanupExisting) || platforms.length !== 1 || denyCreate || stdio || readOnlyNotes)) throw new Error('Existing-note cleanup requires exactly one platform and an exact retained disposable marker.');
  if (readOnlyNotes && (stdio || denyCreate || cleanupExisting)) throw new Error('Read-only notes mode cannot combine with mutation or stdio modes.');
  if (readOnlyNotes) { await checkReadOnlyNotes({ api, platforms, model, deadlineMs, root, runsRoot: config.runsRoot, modelBaseUrl: config.openRouter.baseUrl }); return; }
  if (stdio) {
    if (denyCreate) throw new Error('Denial mode applies only to reviewed Memos writes.');
    if (!memoryFile) throw new Error('Provide --memory-file or AGENTLAB_MEMORY_ACCEPTANCE_FILE for independent stdio graph verification.');
    await checkStdio({ api, platforms, model, deadlineMs, memoryFile, root, runsRoot: config.runsRoot, modelBaseUrl: config.openRouter.baseUrl }); return;
  }
  for (const value of [api, process.env.AGENTLAB_MEMOS_ENDPOINT ?? 'http://127.0.0.1:5230/mcp']) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) throw new Error('This acceptance driver requires isolated loopback Lab and Memos services.'); }
  const authorization = process.env.AGENTLAB_MEMOS_AUTHORIZATION;
  if (!authorization || /[\r\n]/.test(authorization)) throw new Error('Configure dedicated Memos test account authorization before acceptance.');
  const memos = new URL(process.env.AGENTLAB_MEMOS_ENDPOINT ?? 'http://127.0.0.1:5230/mcp').origin;
  const catalogResponse = await fetch(`${config.openRouter.baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15_000) });
  if (!catalogResponse.ok) throw new Error('Fresh free model catalog is unavailable.');
  const selectedModel = assertFreeModelCatalog(await catalogResponse.json(), model);
  const profile = (await request<{ profiles: CapabilityProfileView[] }>('/api/capabilities')).profiles.find(profile => profile.id === 'notes-acceptance' && profile.available);
  if (!profile || !profile.availableSkills?.some(skill => skill.id === 'notes-check-skills:notes-check')) throw new Error('Configure available notes-acceptance profile and notes-check skill first.');
  for (const name of writes) if (!profile.capabilities.some(tool => tool.id === name && tool.approvalMode === 'invocation' && tool.connectionRef === 'conn_memos_local')) throw new Error('Memos mutations must retain invocation review.');
  const directory = resolve(process.env.AGENTLAB_CAPABILITY_CHECK_ROOT ?? join(config.runsRoot, 'capability-manager-acceptance'), `managed-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const controls = { schemaVersion: 1, mode: 'managed-capability-acceptance', platforms, model: selectedModel, routing: FREE_PROVIDER_ROUTING, experimentId: 'agent-capabilities-live', profileId: profile.id, requestedSkillIds: ['notes-check-skills:notes-check'], maxRounds: 30, maxCalls: 30, deadlineMs, denyCreate, cleanupExisting: cleanupExisting ?? null, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), providerVerification: 'independent Memos REST reads; driver performs no provider mutations' };
  await save('config.json', controls);
  const results: unknown[] = []; let interrupted = false;
  const interrupt = () => { interrupted = true; }; process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    for (const platform of platforms) {
      if (interrupted) break;
      const marker = cleanupExisting ?? `cm-${randomUUID().replaceAll('-', '').slice(0, 26)}`;
      const original = `# Lab notes acceptance ${marker}\nOwner: Alex\nMeeting: 10:00\n#lab-managed-acceptance`;
      const updated = original.replace('Meeting: 10:00', 'Meeting: 14:00');
      const prompt = cleanupExisting ? `Use the preloaded notes-check skill to clean up only the disposable memo with memoId ${marker}, created in an earlier retained acceptance run. First read it and verify the exact title Lab notes acceptance ${marker}, Owner: Alex, PRIVATE visibility, and the #lab-managed-acceptance marker. Then propose memo_delete_memo with exactly {\"memo\":\"${marker}\"}, await review, and use memo_list_memos with ${JSON.stringify({ filter: `content.contains("${marker}")`, pageSize: 10 })} to confirm absence. Always pass the plain ID ${marker} to memo_get_memo and memo_delete_memo, never memos/${marker}. Omit force or set force to false; never use force: true. Do not create or update anything, and do not delete any other memo. Report the verified cleanup.` : `Use the preloaded notes-check skill to ${denyCreate ? 'propose creating' : 'complete a private disposable notes CRUD cycle by creating'} exactly one memo with memoId "${marker}" and this exact Markdown content:\n\n${original}\n\nSet visibility to PRIVATE. Use memo_create_memo with exactly these arguments: ${JSON.stringify({ memoId: marker, body: { content: original, visibility: "PRIVATE" } })}. body has ONLY content and visibility: do not add name, memoId, updateMask or any other property inside body. Await review for every write. ${denyCreate ? 'If creation is denied, stop and honestly explain that no note was created. Do not try another ID or write tool.' : `Read the returned memo to verify its owner, meeting and PRIVATE visibility. Update only its content, changing Meeting: 10:00 to Meeting: 14:00 while preserving all other text. Use memo_update_memo with arguments ${JSON.stringify({ memo: marker, body: { content: updated }, updateMask: "content" })}. The updateMask is a top-level tool argument, outside body. Read it again to verify the saved change. Delete only that same disposable memo using memo_delete_memo with exactly ${JSON.stringify({ memo: marker })}. For memo_get_memo and memo_delete_memo, memo must be the plain ID ${marker}, never the full memos/${marker} resource name. Then use memo_list_memos with ${JSON.stringify({ filter: `content.contains("${marker}")`, pageSize: 10 })} to verify its absence. Never mutate an existing or unrelated note. Report the verified result and memo ID.`}`;
      const evidence: { platform: string; marker: string; prompt: string; reviews: unknown[]; snapshots: unknown[]; run?: RunView; receipts?: Receipt[]; assertions?: Record<string, boolean>; verdict?: string; error?: string; createdMemoName?: string; observerTermination?: unknown } = { platform, marker, prompt, reviews: [], snapshots: [] };
      let createdMemoName: string | undefined, run: RunView | undefined;
      try {
        const before = await snapshot(marker); evidence.snapshots.push({ phase: 'before-run', ...before });
        if (cleanupExisting) {
          const origin = await findCleanupOrigin(config.runsRoot, marker);
          evidence.snapshots.push({ phase: 'retained-creation-provenance', ...origin });
          assert.equal(before.status, 200, 'Cleanup marker must exist.');
          assert.equal(before.memo?.visibility, 'PRIVATE', 'Cleanup note must be private.');
          assert(before.memo?.content === original || before.memo?.content === updated, 'Cleanup note content must match the retained disposable task.');
          createdMemoName = `memos/${marker}`;
        } else assert.equal(before.status, 404, 'Disposable marker must not already exist.');
        const started = Date.now();
        run = await request<RunView>('/api/runs', { method: 'POST', body: JSON.stringify({ platform, variant: 'baseline', sessionId: `managed-${platform}-${randomUUID()}`, clientTurnId: `managed-turn-${marker}`, task: { kind: 'prompt', prompt }, model: { provider: 'openrouter', model }, selection: { scenarioId: 'managed-memos-crud', experimentId: controls.experimentId }, capabilities: { profileId: profile.id, requestedSkillIds: controls.requestedSkillIds, tools: { enabledNames: [], maxRounds: controls.maxRounds, maxCalls: controls.maxCalls } } }) });
        await save(`${platform}.pending.json`, { ...evidence, runId: run.runId });
        while (active.has(run.status)) {
          if (interrupted || Date.now() - started >= deadlineMs) {
            const ended = await terminateObservation({ reason: interrupted ? 'user-interrupt' : 'deadline', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Managed acceptance observation ended.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) });
            run = ended.snapshot; evidence.observerTermination = ended.termination; throw new Error('Observation ended before verified completion.');
          }
          const observed = await receipts(run);
          const created = observed.find(receipt => receipt.toolName === 'memo_create_memo' && receipt.result?.status === 'completed' && receipt.output.name === `memos/${marker}`);
          if (created) createdMemoName = String(created.output.name);
          if (run.status === 'suspended') {
            const proposals: InvocationReviewView[] = (await request<{ actions: InvocationReviewView[] }>(`/api/runs/${run.runId}/actions`)).actions.filter(action => action.status === 'pending');
            for (const proposal of proposals) {
              const actual = await snapshot(marker);
              const args = proposal.displayArguments;
              const exactCreate = proposal.call.name === 'memo_create_memo' && Object.keys(args).every(key => ['memoId', 'body'].includes(key)) && args.memoId === marker && record(args.body) && Object.keys(args.body).every(key => ['content', 'visibility'].includes(key)) && args.body.content === original && args.body.visibility === 'PRIVATE' && actual.status === 404 && !createdMemoName;
              const exactIdentity = createdMemoName === `memos/${marker}` && args.memo === marker;
              const exactUpdate = proposal.call.name === 'memo_update_memo' && exactIdentity && Object.keys(args).every(key => ['memo', 'body', 'updateMask'].includes(key)) && record(args.body) && Object.keys(args.body).every(key => key === 'content') && args.body.content === updated && args.updateMask === 'content' && actual.memo?.content === original && actual.memo?.visibility === 'PRIVATE';
              const updateAcknowledged = observed.some(receipt => receipt.toolName === 'memo_update_memo' && receipt.result?.status === 'completed');
              const exactDelete = proposal.call.name === 'memo_delete_memo' && exactIdentity && Object.keys(args).every(key => ['memo', 'force'].includes(key)) && (args.force === undefined || args.force === false) && updateAcknowledged && actual.memo?.content === updated && actual.memo?.visibility === 'PRIVATE';
              const exactCleanupDelete = cleanupExisting && proposal.call.name === 'memo_delete_memo' && exactIdentity && Object.keys(args).every(key => ['memo', 'force'].includes(key)) && (args.force === undefined || args.force === false) && actual.memo?.visibility === 'PRIVATE' && (actual.memo?.content === original || actual.memo?.content === updated) && observed.some(receipt => receipt.toolName === 'memo_get_memo' && receipt.result?.status === 'completed' && receipt.output.name === createdMemoName);
              const permitted = cleanupExisting ? !!exactCleanupDelete : !denyCreate && (exactCreate || exactUpdate || exactDelete);
              const decision = permitted ? 'approved' : 'denied';
              evidence.reviews.push({ proposal, before: actual, decision, reason: permitted ? 'Exact private disposable-marker mutation.' : denyCreate && exactCreate ? 'Deliberate denial control.' : 'Outside disposable-note acceptance scope.' });
              evidence.snapshots.push({ phase: `before-${proposal.call.name}`, ...actual });
              run = await request<RunView>(`/api/runs/${run.runId}/actions/${proposal.requestId}/decision`, { method: 'POST', body: JSON.stringify({ requestId: proposal.requestId, revision: proposal.revision, argumentDigest: proposal.argumentDigest, decisionId: `managed-review-${randomUUID()}`, decision, reason: permitted ? 'Explicit acceptance authorization for this exact disposable note.' : 'Acceptance policy denied this proposed mutation.' }) });
              await save(`${platform}.pending.json`, { ...evidence, runId: run.runId });
              if (!permitted && !(denyCreate && exactCreate)) throw new Error('Out-of-scope proposal denied; inspect retained model decisions.');
            }
          }
          await new Promise(resolve => setTimeout(resolve, 250));
          run = await request<RunView>(`/api/runs/${run.runId}`);
        }
        const after = await snapshot(marker); evidence.snapshots.push({ phase: 'after-run', ...after });
        const observed = await receipts(run); evidence.receipts = observed;
        evidence.createdMemoName = createdMemoName;
        const completed = observed.filter(receipt => receipt.result?.status === 'completed');
        const decisions = evidence.reviews as { decision: string; proposal: InvocationReviewView }[];
        evidence.assertions = cleanupExisting ? { nativeCompleted: run.status === 'completed', freeRoutingVerified: validateCapabilityRouting([run], model, controls.experimentId), preloadedSkill: verifiedPreloadedSkill(run), noProviderMemo: after.status === 404, exactlyOneReviewedDelete: decisions.length === 1 && decisions[0]!.decision === 'approved' && decisions[0]!.proposal.call.name === 'memo_delete_memo', noCreationOrUpdate: !completed.some(receipt => ['memo_create_memo', 'memo_update_memo'].includes(receipt.toolName)), modelReadExactMemo: completed.some(receipt => receipt.toolName === 'memo_get_memo' && receipt.output.name === `memos/${marker}`), modelVerifiedAbsence: completed.some(receipt => receipt.toolName === 'memo_list_memos' && receipt.sequence !== null && receipt.sequence > (completed.find(receipt => receipt.toolName === 'memo_delete_memo')?.sequence ?? Infinity) && !containsName(receipt.output, `memos/${marker}`)) } : denyCreate ? { freeRoutingVerified: validateCapabilityRouting([run], model, controls.experimentId), noProviderMemo: after.status === 404, noApprovedMutation: decisions.every(decision => decision.decision === 'denied'), exactlyOneDeniedCreate: decisions.length === 1 && decisions[0]!.proposal.call.name === 'memo_create_memo', noCompletedMutation: !completed.some(receipt => writes.includes(receipt.toolName)), preloadedSkill: verifiedPreloadedSkill(run) } : {
          freeRoutingVerified: validateCapabilityRouting([run], model, controls.experimentId), nativeCompleted: run.status === 'completed', returnedCreateIdentity: completed.some(receipt => receipt.toolName === 'memo_create_memo' && receipt.output.name === `memos/${marker}`), createReadUpdateReadDelete: (() => { const ordered = [...completed].sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity)); const actual = ordered.filter(receipt => ['memo_create_memo', 'memo_get_memo', 'memo_update_memo', 'memo_delete_memo'].includes(receipt.toolName)).map(receipt => receipt.toolName); const expected = ['memo_create_memo', 'memo_get_memo', 'memo_update_memo', 'memo_get_memo', 'memo_delete_memo']; let cursor = 0; for (const name of actual) if (name === expected[cursor]) cursor++; return cursor === expected.length && ordered.filter(receipt => expected.includes(receipt.toolName)).every(receipt => receipt.sequence !== null); })(), threeExactReviews: decisions.length === 3 && decisions.every(decision => decision.decision === 'approved'), independentlyVerifiedUpdatedContent: (evidence.snapshots as { phase: string; memo?: Record<string, unknown> }[]).some(item => item.phase === 'before-memo_delete_memo' && item.memo?.content === updated && item.memo.visibility === 'PRIVATE'), noProviderMemo: after.status === 404, modelCheckedAbsence: completed.some(receipt => receipt.toolName === 'memo_list_memos' && receipt.sequence !== null && receipt.sequence > (completed.find(receipt => receipt.toolName === 'memo_delete_memo')?.sequence ?? Infinity) && !containsName(receipt.output, `memos/${marker}`)), preloadedSkill: verifiedPreloadedSkill(run),
        };
        evidence.verdict = Object.values(evidence.assertions).every(Boolean) ? 'pass' : 'fail';
      } catch (error) {
        evidence.verdict = 'incomplete'; evidence.error = driverError(error);
        if (run && active.has(run.status)) { const ended = await terminateObservation({ reason: 'user-interrupt', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Acceptance assertion or policy failed.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) }); run = ended.snapshot; evidence.observerTermination = ended.termination; }
        evidence.snapshots.push({ phase: 'failure-inspection', ...await snapshot(marker).catch(() => ({ status: 0 })) });
        // Do not clean up through direct writes: a remaining note is evidence of an
        // incomplete native workflow and can be explicitly inspected/removed later.
      }
      evidence.run = run; await save(`${platform}.result.json`, evidence); results.push(evidence);
      await save('summary.json', { controls, completedAt: null, results });
      console.log(JSON.stringify({ platform, verdict: evidence.verdict, runId: run?.runId, marker, directory }));
    }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await save('summary.json', { controls, completedAt: new Date().toISOString(), interrupted, results }); }
  if (interrupted || results.some(result => record(result) && result.verdict !== 'pass')) process.exitCode = 1;
  async function save(name: string, value: unknown) { let text = JSON.stringify(value, null, 2); for (const secret of [authorization!, authorization!.replace(/^Bearer\s+/i, '')]) if (secret) text = text.split(secret).join('[redacted]'); await writeFile(join(directory, name), text + '\n'); }
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(new URL(path, api), { ...options, headers: { 'content-type': 'application/json' }, signal: options.signal ?? AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Lab request failed with HTTP ${response.status}.`); return response.json() as Promise<T>; }
  async function snapshot(marker: string): Promise<Snapshot> { const response = await fetch(`${memos}/api/v1/memos/${encodeURIComponent(marker)}`, { headers: { authorization: authorization! }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); if (response.status === 404) { await response.body?.cancel(); return { status: 404 }; } if (!response.ok) { await response.body?.cancel(); throw new Error('Independent Memos verification is unavailable.'); } const value: unknown = await response.json(); if (!record(value) || value.name !== `memos/${marker}`) throw new Error('Independent Memos identity mismatch.'); return { status: response.status, memo: value }; }
  async function receipts(run: RunView): Promise<Receipt[]> {
    const directory = join(config.runsRoot, run.runId, 'artifacts/capability-calls'); let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => { const receipt = JSON.parse(await readFile(join(directory, name), 'utf8')); const output = extractOutput(receipt.result?.content); const event = run.events.find(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolCallId === receipt.toolCallId); return { ...receipt, sequence: event?.recordedSequence ?? null, output }; }));
  }
}
function extractOutput(content: unknown): Record<string, unknown> { if (typeof content !== 'string') return {}; try { const raw: unknown = JSON.parse(content); if (!record(raw)) return {}; if (record(raw.structuredContent)) return raw.structuredContent; if (Array.isArray(raw.content)) for (const block of raw.content) if (record(block) && block.type === 'text' && typeof block.text === 'string') { try { const parsed: unknown = JSON.parse(block.text); if (record(parsed)) return parsed; } catch { /* Preserve bounded outer protocol result. */ } } return raw; } catch { return {}; } }
function containsName(value: unknown, name: string): boolean { if (record(value)) return value.name === name || Object.values(value).some(item => containsName(item, name)); return Array.isArray(value) && value.some(item => containsName(item, name)); }
main().catch(() => { console.error('Managed capability acceptance could not start. Check configuration, exact free model and dedicated local Memos credentials.'); process.exitCode = 1; });

/** Read-only real provider proof. The observer reads provider-owned persistence;
 * the model obtains data exclusively through the managed read_graph tool.
 */
async function checkStdio(options: { api: string; platforms: string[]; model: string; deadlineMs: number; memoryFile: string; root: string; runsRoot: string; modelBaseUrl: string }): Promise<void> {
  const apiUrl = new URL(options.api);
  if (!['http:', 'https:'].includes(apiUrl.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname) || apiUrl.username || apiUrl.password) throw new Error('Stdio acceptance requires the isolated loopback Lab.');
  const catalogResponse = await fetch(`${options.modelBaseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15000) });
  if (!catalogResponse.ok) throw new Error('Fresh free model catalog is unavailable.');
  const selectedModel = assertFreeModelCatalog(await catalogResponse.json(), options.model);
  const profile = (await request<{ profiles: CapabilityProfileView[] }>('/api/capabilities')).profiles.find(value => value.id === 'memory-acceptance' && value.available);
  if (!profile || profile.capabilities.length !== 1 || profile.capabilities[0]?.id !== 'mcp-memory-2026_read_graph' || profile.capabilities[0].risk !== 'read') throw new Error('Configure memory-acceptance with only managed mcp-memory-2026_read_graph.');
  const directory = resolve(process.env.AGENTLAB_CAPABILITY_CHECK_ROOT ?? join(options.runsRoot, 'capability-manager-acceptance'), `stdio-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const prompt = 'Read the actual connected memory graph using the available read_graph tool. Count its entities and relations from the returned graph. Do not guess, mutate the graph, or use filesystem access. Return a JSON object with exactly nodeCount and relationCount; both must be integer counts from the tool result.';
  const providerInstallation = await memoryProviderInstallation(options.memoryFile);
  const controls = { schemaVersion: 1, mode: 'managed-stdio-acceptance', providerInstallation, ...options, memoryFile: resolve(options.memoryFile), selectedModel, routing: FREE_PROVIDER_ROUTING, experimentId: 'agent-capabilities-live', profileId: profile.id, maxRounds: 30, maxCalls: 30, prompt, startedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.root, encoding: 'utf8' }).trim(), providerVerification: 'read-only provider persistence before/after; model reads only through MCP' };
  await save('config.json', controls);
  const outcomes: unknown[] = [];
  let interrupted = false;
  const interrupt = () => { interrupted = true; }; process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    for (const platform of options.platforms) {
      if (interrupted) break;
      let run: RunView | undefined;
      const evidence: { platform: string; before?: unknown; after?: unknown; run?: RunView; receipts?: Receipt[]; assertions?: Record<string, boolean>; verdict?: string; error?: string; observerTermination?: unknown } = { platform };
      try {
        const before = await graphSnapshot(options.memoryFile); evidence.before = before;
        const started = Date.now();
        run = await request<RunView>('/api/runs', { method: 'POST', body: JSON.stringify({ platform, variant: 'baseline', sessionId: `stdio-proof-${platform}-${randomUUID()}`, clientTurnId: `stdio-turn-${randomUUID()}`, task: { kind: 'prompt', prompt }, model: { provider: 'openrouter', model: options.model }, selection: { scenarioId: 'managed-memory-read', experimentId: controls.experimentId }, capabilities: { profileId: profile.id, tools: { enabledNames: [], maxRounds: controls.maxRounds, maxCalls: controls.maxCalls } } }) });
        await save(`${platform}.pending.json`, { ...evidence, runId: run.runId });
        while (active.has(run.status)) {
          if (interrupted || Date.now() - started >= options.deadlineMs || run.status === 'suspended') {
            const ended = await terminateObservation({ reason: interrupted || run.status === 'suspended' ? 'user-interrupt' : 'deadline', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Read-only stdio acceptance ended without completion.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) });
            run = ended.snapshot; evidence.observerTermination = ended.termination; throw new Error('Read-only stdio observation did not complete.');
          }
          await new Promise(resolve => setTimeout(resolve, 250)); run = await request<RunView>(`/api/runs/${run.runId}`);
        }
        const after = await graphSnapshot(options.memoryFile); evidence.after = after;
        const observed = await inspect(run); evidence.receipts = observed;
        const read = observed.find(receipt => receipt.toolName === 'mcp-memory-2026_read_graph' && receipt.result?.status === 'completed');
        const output = parseCounts(run.result?.output);
        evidence.assertions = { nativeCompleted: run.status === 'completed', freeRoutingVerified: validateCapabilityRouting([run], options.model, controls.experimentId), actualMcpRead: !!read, toolGraphMatchesProvider: !!read && canonicalGraph(read.output) === canonicalGraph(before.graph), providerUnchanged: JSON.stringify(before) === JSON.stringify(after), modelCountsMatchProvider: output?.nodeCount === before.graph.entities.length && output?.relationCount === before.graph.relations.length, noOtherTools: observed.every(receipt => receipt.toolName === 'mcp-memory-2026_read_graph') };
        evidence.verdict = Object.values(evidence.assertions).every(Boolean) ? 'pass' : 'fail';
      } catch (error) {
        evidence.verdict = 'incomplete'; evidence.error = driverError(error);
        if (run && active.has(run.status)) { const ended = await terminateObservation({ reason: 'user-interrupt', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Stdio acceptance inspection failed.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) }); run = ended.snapshot; evidence.observerTermination = ended.termination; }
      }
      evidence.run = run; await save(`${platform}.result.json`, evidence); outcomes.push(evidence);
      await save('summary.json', { controls, completedAt: null, outcomes });
      console.log(JSON.stringify({ platform, verdict: evidence.verdict, runId: run?.runId, directory }));
    }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await save('summary.json', { controls, completedAt: new Date().toISOString(), interrupted, outcomes }); }
  if (interrupted || outcomes.some(outcome => record(outcome) && outcome.verdict !== 'pass')) process.exitCode = 1;
  async function save(name: string, value: unknown) { await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n'); }
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> { const response = await fetch(new URL(path, options.api), { ...init, headers: { 'content-type': 'application/json' }, signal: init.signal ?? AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Lab request failed with HTTP ${response.status}.`); return response.json() as Promise<T>; }
  async function inspect(run: RunView): Promise<Receipt[]> {
    const directory = join(options.runsRoot, run.runId, 'artifacts/capability-calls'); let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => { const receipt = JSON.parse(await readFile(join(directory, name), 'utf8')); const event = run.events.find(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolCallId === receipt.toolCallId); return { ...receipt, output: extractOutput(receipt.result?.content), sequence: event?.recordedSequence ?? null }; }));
  }
}
interface MemoryGraph { entities: Record<string, unknown>[]; relations: Record<string, unknown>[] }
async function graphSnapshot(path: string): Promise<{ present: boolean; graph: MemoryGraph }> {
  let bytes: Buffer;
  try { bytes = await readFile(resolve(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { present: false, graph: { entities: [], relations: [] } }; throw error; }
  if (bytes.length > 256 * 1024) throw new Error('Acceptance graph persistence exceeds its limit.');
  const text = bytes.toString('utf8').trim();
  if (!text) return { present: true, graph: { entities: [], relations: [] } };
  try { const whole: unknown = JSON.parse(text); if (record(whole) && Array.isArray(whole.entities) && Array.isArray(whole.relations) && whole.entities.every(record) && whole.relations.every(record)) return { present: true, graph: { entities: whole.entities, relations: whole.relations } }; } catch { /* Current memory MCP persists one typed record per line. */ }
  const graph: MemoryGraph = { entities: [], relations: [] };
  for (const line of text.split(/\r?\n/).filter(Boolean)) { const value: unknown = JSON.parse(line); if (!record(value) || !['entity', 'relation'].includes(String(value.type))) throw new Error('Acceptance graph persistence record is invalid.'); const { type, ...item } = value; if (type === 'entity') graph.entities.push(item); else graph.relations.push(item); }
  return { present: true, graph };
}
function canonicalGraph(value: unknown): string | null { if (!record(value) || !Array.isArray(value.entities) || !Array.isArray(value.relations)) return null; return JSON.stringify({ entities: value.entities.map(item => stableJson(item)).sort(), relations: value.relations.map(item => stableJson(item)).sort() }); }
function stableJson(value: unknown): string { if (record(value)) return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, record(item) ? JSON.parse(stableJson(item)) : item]))); return JSON.stringify(value); }
function parseCounts(output: string | null | undefined): { nodeCount: number; relationCount: number } | null { if (!output) return null; try { const parsed: unknown = JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] ?? output); return record(parsed) && Object.keys(parsed).length === 2 && Number.isSafeInteger(parsed.nodeCount) && Number.isSafeInteger(parsed.relationCount) ? { nodeCount: Number(parsed.nodeCount), relationCount: Number(parsed.relationCount) } : null; } catch { return null; } }

/** Keep driver-owned assertion/status errors explainable without retaining raw
 * JSON parse messages, credentials-store errors or provider response material.
 */
function driverError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown acceptance error.';
  const safe = [
    'Lab request failed with HTTP ', 'Disposable marker must not already exist.',
    'Cleanup marker must exist.', 'Cleanup note must be private.', 'Cleanup note content must match', 'Retained disposable creation proof',
    'Observation ended before verified completion.', 'Out-of-scope proposal denied;',
    'Independent Memos verification is unavailable.', 'Independent Memos identity mismatch.',
    'Read-only stdio observation did not complete.', 'Read-only notes ', 'Independent Memos list ', 'Acceptance graph persistence ',
    'Acceptance graph persistence record is invalid.',
  ];
  return safe.some(prefix => error.message.startsWith(prefix)) ? error.message.slice(0, 512) : error.name;
}

/** Prove selection AND actual dispatch context, rather than the unrelated builtin
 * skill list. A requested ID alone is not evidence that a model received instructions.
 */
function verifiedPreloadedSkill(run: RunView): boolean {
  if (!run.manifest.capabilities?.requestedSkillIds?.includes('notes-check-skills:notes-check')) return false;
  return run.events.some(event => {
    if (event.kind !== 'EvalModelObserved') return false;
    const observation = event.payload.observation;
    if (!record(observation) || !record(observation.providerRequest) || !Array.isArray(observation.providerRequest.messages)) return false;
    return observation.providerRequest.messages.some(message => record(message) && typeof message.content === 'string' && message.content.includes('Previously loaded skill notes-check-skills/notes-check') && message.content.includes('Use only private memos with the exact test marker supplied by the user.') && message.content.includes('Preserve provider memo IDs and do not retry a write with an unknown outcome.'));
  });
}

/** Cleanup is authorized only by a retained successful creation receipt, never by
 * matching a convenient name in an arbitrary provider note. No provider writes occur.
 */
async function findCleanupOrigin(runsRoot: string, marker: string): Promise<{ sourceRunId: string; createToolCallId: string }> {
  const directory = join(runsRoot, 'capability-manager-acceptance');
  const trials = await readdir(directory);
  for (const trial of trials.filter(name => /^managed-[a-f0-9-]{36}$/.test(name))) {
    const files = await readdir(join(directory, trial));
    for (const file of files.filter(name => /^(mastra|langgraph|temporal|restate)\.result\.json$/.test(name))) {
      const evidence = JSON.parse(await readFile(join(directory, trial, file), 'utf8'));
      if (!record(evidence) || evidence.marker !== marker || !record(evidence.run) || typeof evidence.run.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(evidence.run.runId)) continue;
      const sourceRunId = evidence.run.runId;
      const receipts = join(runsRoot, sourceRunId, 'artifacts/capability-calls');
      for (const name of (await readdir(receipts)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
        const receipt = JSON.parse(await readFile(join(receipts, name), 'utf8'));
        if (receipt.toolName === 'memo_create_memo' && receipt.result?.status === 'completed' && extractOutput(receipt.result?.content).name === `memos/${marker}`) return { sourceRunId, createToolCallId: receipt.toolCallId };
      }
    }
  }
  throw new Error('Retained disposable creation proof is missing; inspect the original run before cleanup.');
}

/** Read exact upstream installation identity; the Lab registration's version is
 * separate. Missing metadata is recorded honestly rather than inferred from its name.
 */
async function memoryProviderInstallation(memoryFile: string): Promise<Record<string, unknown>> {
  const packageRoot = resolve(dirname(memoryFile), '..');
  const packagePath = join(packageRoot, 'package.json');
  const lockPath = resolve(packageRoot, '../../..', 'package-lock.json');
  let installedName: string | null = null, installedVersion: string | null = null, packageLockSha256: string | null = null;
  try {
    const metadata: unknown = JSON.parse(await readFile(packagePath, 'utf8'));
    if (record(metadata) && metadata.name === '@modelcontextprotocol/server-memory' && typeof metadata.version === 'string') { installedName = metadata.name; installedVersion = metadata.version; }
  } catch { /* An alternate persistence path may not be adjacent to its provider package. */ }
  try { packageLockSha256 = createHash('sha256').update(await readFile(lockPath)).digest('hex'); } catch { /* Absence is a reproducibility limitation, not an invented hash. */ }
  return { installedName, installedVersion, packageLockSha256, packagePath: installedName ? packagePath : null, lockPath: packageLockSha256 ? lockPath : null, observerNodeVersion: process.version, observerNodeExecutable: process.execPath, note: 'Observer Node identity; inspect admitted managed package command for a different provider executable.' };
}

/** A bounded read proof with the full notes profile still exposed. Any reviewed
 * action is denied; the observer never writes or repairs provider notes.
 */
async function checkReadOnlyNotes(options: { api: string; platforms: string[]; model: string; deadlineMs: number; root: string; runsRoot: string; modelBaseUrl: string }): Promise<void> {
  const endpoint = process.env.AGENTLAB_MEMOS_ENDPOINT ?? 'http://127.0.0.1:5230/mcp';
  for (const value of [options.api, endpoint]) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.hash || url.search) throw new Error('This acceptance driver requires isolated loopback Lab and Memos services.');
  }
  const authorization = process.env.AGENTLAB_MEMOS_AUTHORIZATION;
  if (!authorization || /[\r\n]/.test(authorization)) throw new Error('Configure dedicated Memos test account authorization before acceptance.');
  const filter = 'visibility == "PRIVATE" && content.contains("#lab-managed-acceptance")', listArguments = { filter, pageSize: 10 };
  const prompt = `Use the preloaded notes-check skill. First read its references/procedure.md resource using read_skill_resource with exactly {"name":"notes-check","path":"references/procedure.md"}. Then use memo_list_memos with exactly ${JSON.stringify(listArguments)}. Read only PRIVATE memos with the exact #lab-managed-acceptance tag. Do not create, update or delete anything. Return a JSON object with exactly observedCount and memoIds. observedCount is the number of memos in this returned page, not a total across pages; memoIds contains their exact returned memos/<id> resource names. If the page is empty return {"observedCount":0,"memoIds":[]}. Base the answer on the actual tool result.`;
  const catalogResponse = await fetch(`${options.modelBaseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15000) });
  if (!catalogResponse.ok) throw new Error('Fresh free model catalog is unavailable.');
  const selectedModel = assertFreeModelCatalog(await catalogResponse.json(), options.model);
  const profile = (await request<{ profiles: CapabilityProfileView[] }>('/api/capabilities')).profiles.find(value => value.id === 'notes-acceptance' && value.available);
  if (!profile || !profile.availableSkills?.some(skill => skill.id === 'notes-check-skills:notes-check') || !profile.capabilities.some(tool => tool.id === 'memo_list_memos' && tool.connectionRef === 'conn_memos_local')) throw new Error('Configure available notes-acceptance with connected list tool and notes-check skill.');
  for (const name of writes) if (!profile.capabilities.some(tool => tool.id === name && tool.approvalMode === 'invocation')) throw new Error('Memos mutations must retain invocation review.');
  const directory = resolve(process.env.AGENTLAB_CAPABILITY_CHECK_ROOT ?? join(options.runsRoot, 'capability-manager-acceptance'), `read-only-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const controls = { schemaVersion: 1, mode: 'managed-notes-read-only-acceptance', ...options, selectedModel, routing: FREE_PROVIDER_ROUTING, experimentId: 'agent-capabilities-live', profileId: profile.id, profile, requestedSkillIds: ['notes-check-skills:notes-check'], maxRounds: 30, maxCalls: 30, prompt, listArguments, startedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.root, encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: options.root, encoding: 'utf8' }).trim(), providerVerification: 'independent bounded Memos REST page before/after; no writes approved or performed by observer' };
  await save('config.json', controls);
  const outcomes: Record<string, unknown>[] = [];
  let interrupted = false;
  const interrupt = () => { interrupted = true; }; process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    for (const platform of options.platforms) {
      if (interrupted) break;
      let run: RunView | undefined;
      const evidence: Record<string, unknown> = { platform, prompt, reviews: [] };
      try {
        const before = await snapshot(); evidence.before = before;
        const started = Date.now();
        run = await request<RunView>('/api/runs', { method: 'POST', body: JSON.stringify({ platform, variant: 'baseline', sessionId: `notes-read-${platform}-${randomUUID()}`, clientTurnId: `notes-read-${randomUUID()}`, task: { kind: 'prompt', prompt }, model: { provider: 'openrouter', model: options.model }, selection: { scenarioId: 'managed-notes-read-only', experimentId: controls.experimentId }, capabilities: { profileId: profile.id, requestedSkillIds: controls.requestedSkillIds, tools: { enabledNames: [], maxRounds: controls.maxRounds, maxCalls: controls.maxCalls } } }) });
        await save(`${platform}.pending.json`, { ...evidence, runId: run.runId });
        while (active.has(run.status)) {
          if (interrupted || Date.now() - started >= options.deadlineMs) {
            const ended = await terminateObservation({ reason: interrupted ? 'user-interrupt' : 'deadline', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Read-only notes observation ended.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) });
            run = ended.snapshot; evidence.observerTermination = ended.termination; throw new Error('Read-only notes observation did not complete.');
          }
          if (run.status === 'suspended') {
            const proposals = (await request<{ actions: InvocationReviewView[] }>(`/api/runs/${run.runId}/actions`)).actions.filter(action => action.status === 'pending');
            for (const proposal of proposals) {
              (evidence.reviews as unknown[]).push({ proposal, decision: 'denied', reason: 'Read-only notes acceptance grants no mutations.' });
              run = await request<RunView>(`/api/runs/${run.runId}/actions/${proposal.requestId}/decision`, { method: 'POST', body: JSON.stringify({ requestId: proposal.requestId, revision: proposal.revision, argumentDigest: proposal.argumentDigest, decisionId: `read-only-denial-${randomUUID()}`, decision: 'denied', reason: 'Read-only notes acceptance grants no mutations.' }) });
            }
            throw new Error('Read-only notes proposed a reviewed action; denied and cancelling.');
          }
          await new Promise(resolve => setTimeout(resolve, 250)); run = await request<RunView>(`/api/runs/${run.runId}`);
        }
        const after = await snapshot(); evidence.after = after;
        const observed = await inspect(run); evidence.receipts = observed;
        const completed = observed.filter(receipt => receipt.result?.status === 'completed');
        const reads = completed.filter(receipt => receipt.toolName === 'memo_list_memos');
        const resource = completed.find(receipt => receipt.toolName.endsWith('_read_skill_resource') && receipt.output.name === 'notes-check' && receipt.output.path === 'references/procedure.md' && typeof receipt.output.content === 'string');
        const expected = memoNames(before), final = parseMemoCount(run.result?.output);
        const resourceContext = skillResourceDelivered(run.events, resource);
        const assertions = { nativeCompleted: run.status === 'completed', freeRoutingVerified: validateCapabilityRouting([run], options.model, controls.experimentId), preloadedSkill: verifiedPreloadedSkill(run), skillResourceRead: !!resource, skillResourceInModelContext: resourceContext, actualConnectedList: reads.length > 0, toolMatchesIndependentProvider: reads.length > 0 && reads.every(receipt => JSON.stringify(memoNames(receipt.output)) === JSON.stringify(expected)), providerUnchanged: stableJson(before) === stableJson(after), finalCountAndIds: final !== null && final.observedCount === expected.length && JSON.stringify([...final.memoIds].sort()) === JSON.stringify(expected), noMutations: !observed.some(receipt => writes.includes(receipt.toolName)), noApprovedReview: (evidence.reviews as unknown[]).length === 0 };
        evidence.assertions = assertions; evidence.verdict = Object.values(assertions).every(Boolean) ? 'pass' : 'fail';
      } catch (error) {
        evidence.verdict = 'incomplete'; evidence.error = driverError(error);
        if (run && active.has(run.status)) { const ended = await terminateObservation({ reason: 'user-interrupt', snapshot: run, cancel: signal => request<RunView>(`/api/runs/${run!.runId}/cancel`, { method: 'POST', signal, body: JSON.stringify({ reason: 'Read-only notes inspection or policy failed.' }) }), inspect: signal => request<RunView>(`/api/runs/${run!.runId}`, { signal }) }); run = ended.snapshot; evidence.observerTermination = ended.termination; }
      }
      evidence.run = run; await save(`${platform}.result.json`, evidence); outcomes.push(evidence);
      await save('summary.json', { controls, completedAt: null, outcomes }); console.log(JSON.stringify({ platform, verdict: evidence.verdict, runId: run?.runId, directory }));
    }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); await save('summary.json', { controls, completedAt: new Date().toISOString(), interrupted, outcomes }); }
  if (interrupted || outcomes.some(outcome => outcome.verdict !== 'pass')) process.exitCode = 1;
  async function save(name: string, value: unknown) { let text = JSON.stringify(value, null, 2); for (const secret of [authorization!, authorization!.replace(/^Bearer\s+/i, '')]) if (secret) text = text.split(secret).join('[redacted]'); await writeFile(join(directory, name), text + '\n'); }
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> { const response = await fetch(new URL(path, options.api), { ...init, headers: { 'content-type': 'application/json' }, signal: init.signal ?? AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Lab request failed with HTTP ${response.status}.`); return response.json() as Promise<T>; }
  async function snapshot(): Promise<Record<string, unknown>> {
    const url = new URL('/api/v1/memos', new URL(endpoint).origin); url.searchParams.set('filter', filter); url.searchParams.set('pageSize', '10');
    const response = await fetch(url, { headers: { authorization: authorization! }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Independent Memos verification is unavailable.'); }
    const value: unknown = await response.json();
    if (!record(value)) throw new Error('Independent Memos list response is invalid.');
    const list = value.memos ?? [];
    if (!Array.isArray(list) || list.length > 10 || list.some(memo => !record(memo) || typeof memo.name !== 'string' || memo.visibility !== 'PRIVATE' || typeof memo.content !== 'string' || !/(?:^|\s)#lab-managed-acceptance(?:\s|$)/.test(memo.content))) throw new Error('Independent Memos list scope is invalid.');
    return { ...value, memos: list };
  }
  async function inspect(run: RunView): Promise<Receipt[]> {
    const directory = join(options.runsRoot, run.runId, 'artifacts/capability-calls'); let names: string[];
    try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => { const receipt = JSON.parse(await readFile(join(directory, name), 'utf8')); const event = run.events.find(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolCallId === receipt.toolCallId); return { ...receipt, output: extractOutput(receipt.result?.content), sequence: event?.recordedSequence ?? null }; }));
  }
}
function memoNames(value: Record<string, unknown>): string[] { const memos = value.memos ?? []; return Array.isArray(memos) ? memos.map(memo => record(memo) && typeof memo.name === 'string' ? memo.name : '[invalid-memo]').sort() : ['[invalid-list]']; }
function parseMemoCount(output: string | null | undefined): { observedCount: number; memoIds: string[] } | null {
  if (!output) return null;
  try { const value: unknown = JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] ?? output); return record(value) && Object.keys(value).length === 2 && Number.isSafeInteger(value.observedCount) && Number(value.observedCount) >= 0 && Array.isArray(value.memoIds) && value.memoIds.every(item => typeof item === 'string') ? { observedCount: Number(value.observedCount), memoIds: value.memoIds } : null; } catch { return null; }
}

/** Correct observer interpretation using retained bytes only. Original failures
 * are immutable evidence; corrections create separately named, hash-linked files.
 */
async function regradeReadOnly(path: string, root: string): Promise<void> {
  const evidenceRoot = await realpath(join(root, 'lab/runs/capability-manager-acceptance'));
  const directory = await realpath(resolve(path));
  if (dirname(directory) !== evidenceRoot || !/^read-only-[a-f0-9-]{36}$/.test(directory.slice(evidenceRoot.length + 1))) throw new Error('Offline regrade requires a retained lab/runs/capability-manager-acceptance/read-only UUID directory.');
  const configBytes = await readFile(join(directory, 'config.json'));
  const controls = JSON.parse(configBytes.toString('utf8'));
  if (!record(controls) || controls.mode !== 'managed-notes-read-only-acceptance' || !Array.isArray(controls.platforms) || !record(controls.selectedModel) || typeof controls.selectedModel.id !== 'string' || typeof controls.experimentId !== 'string') throw new Error('Offline regrade requires retained read-only acceptance controls.');
  const corrections: unknown[] = [];
  const metadata = { correctedAt: new Date().toISOString(), graderHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), graderDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), graderScriptSha256: createHash('sha256').update(await readFile(join(root, 'server/scripts/check-managed-capabilities.ts'))).digest('hex'), graderHelperSha256: createHash('sha256').update(await readFile(join(root, 'server/src/evals/managed-skill-evidence.ts'))).digest('hex'), configSha256: createHash('sha256').update(configBytes).digest('hex'), correctionReason: 'Original observer required an internal skill context heading. Native correlated tool-role JSON already delivered the exact completed resource to a subsequent model request. Regrade checks call identity, post-receipt sequence, digest, content and untrusted/no-authority metadata; all other assertions are recomputed unchanged.' };
  for (const platform of controls.platforms) {
    if (typeof platform !== 'string' || !['mastra', 'langgraph', 'temporal', 'restate'].includes(platform)) throw new Error('Offline regrade contains an unsupported platform.');
    const originalPath = join(directory, `${platform}.result.json`);
    if (await realpath(originalPath) !== originalPath) throw new Error('Offline regrade does not accept symlinked source results.');
    const originalBytes = await readFile(originalPath), original: unknown = JSON.parse(originalBytes.toString('utf8'));
    if (!record(original) || !record(original.run) || !record(original.before) || !record(original.after) || !Array.isArray(original.receipts) || !Array.isArray(original.reviews)) throw new Error('Offline regrade requires complete retained run, snapshots and receipts.');
    const run = original.run as unknown as RunView, observed = original.receipts as Receipt[];
    const completed = observed.filter(receipt => receipt.result?.status === 'completed');
    const reads = completed.filter(receipt => receipt.toolName === 'memo_list_memos');
    const resource = completed.find(receipt => receipt.toolName.endsWith('_read_skill_resource') && receipt.output.name === 'notes-check' && receipt.output.path === 'references/procedure.md' && typeof receipt.output.content === 'string');
    const expected = memoNames(original.before), final = parseMemoCount(run.result?.output);
    const assertions = { nativeCompleted: run.status === 'completed', freeRoutingVerified: validateCapabilityRouting([run], controls.selectedModel.id, controls.experimentId), preloadedSkill: verifiedPreloadedSkill(run), skillResourceRead: !!resource, skillResourceInModelContext: skillResourceDelivered(run.events, resource), actualConnectedList: reads.length > 0, toolMatchesIndependentProvider: reads.length > 0 && reads.every(receipt => JSON.stringify(memoNames(receipt.output)) === JSON.stringify(expected)), providerUnchanged: stableJson(original.before) === stableJson(original.after), finalCountAndIds: final !== null && final.observedCount === expected.length && JSON.stringify([...final.memoIds].sort()) === JSON.stringify(expected), noMutations: !observed.some(receipt => writes.includes(receipt.toolName)), noApprovedReview: original.reviews.length === 0 };
    const correction = { schemaVersion: 1, mode: 'offline-read-only-observer-correction', platform, runId: run.runId, originalFile: `${platform}.result.json`, originalSha256: createHash('sha256').update(originalBytes).digest('hex'), originalVerdict: original.verdict, originalAssertions: original.assertions, ...metadata, assertions, verdict: Object.values(assertions).every(Boolean) ? 'pass' : 'fail' };
    await writeFile(join(directory, `${platform}.regraded.json`), JSON.stringify(correction, null, 2) + '\n', { flag: 'wx' });
    corrections.push(correction);
  }
  await writeFile(join(directory, 'regraded-summary.json'), JSON.stringify({ schemaVersion: 1, ...metadata, corrections }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, corrections: corrections.map(value => { const correction = value as { platform: string; verdict: string }; return { platform: correction.platform, verdict: correction.verdict }; }) }));
  if (corrections.some(value => (value as { verdict: string }).verdict !== 'pass')) process.exitCode = 1;
}
