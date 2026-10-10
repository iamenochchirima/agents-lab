import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumentDigest } from '../capabilities/reviews/store.js';
import { loadLocalServerEnvironment } from '../control-plane/bootstrap/local-env.js';
import { COMPARISON_FREE_MODEL, assertFreeModelCatalog, getFreeEvalSettings } from '../models/openrouter/free-model-policy.js';
import { installedRuntimeVersions } from './runtime-versions.js';
import type { RunView } from '../control-plane/application/run-service.js';
import { matchesConnectedVerification } from './connected-verification.js';
import { validateConnectedContinuation } from './connected-continuation.js';
import type { InvocationReviewView } from '../capabilities/reviews/contracts.js';

export interface Scenario {
  schemaVersion: 1; fixtureOnly: true; id: string; provider: string; profileId: string;
  statePath?: string;
  sustained?: { maxDurationMs: number; modelTimeoutMs: number; holdFirstReviewMs: number; requireRestart: boolean };
  mutationTool: string; stages: { id: string; goal: string; decision: 'approved' | 'denied' | null; allowedArguments?: Record<string, unknown>; requiredTools?: Record<string, number>; requiredFailureTools?: string[]; requiredErrorCode?: string; requiredFailureArguments?: Record<string, unknown>; verificationTool?: string; verificationArguments?: Record<string, unknown>; expected: Record<string, unknown>;
    reviewRules?: { decision: 'approved' | 'denied'; allowedArguments: { key: string; owner: string } }[];
    collection?: { keys: string[]; listTool: string; inspectTool: string; referenceTool: string; skillTool: string; reference: Record<string, unknown> };
  }[];
}

/** The observer authorizes only exact declared fixture targets. It does not tell
 * the model which order or tools to choose. */
export function fixtureReviewDecision(scenario: Scenario, stage: Scenario['stages'][number], action: InvocationReviewView, namespace: string): 'approved' | 'denied' {
  const args = action.displayArguments as Record<string, unknown>;
  const rule = stage.reviewRules?.find(rule => Object.entries(rule.allowedArguments).every(([key, value]) => args[key] === value));
  const decision = stage.reviewRules ? rule?.decision : stage.decision;
  if (!/^cap-[a-z0-9-]{1,100}$/.test(namespace) || !decision || action.call.name !== scenario.mutationTool || args.namespace !== namespace ||
      !Object.entries(stage.reviewRules ? rule!.allowedArguments : stage.allowedArguments ?? {}).every(([key, value]) => args[key] === value) ||
      stage.reviewRules && (Object.keys(args).some(key => !['namespace', 'key', 'owner', 'expectedRevision'].includes(key)) || !Number.isInteger(args.expectedRevision) || Number(args.expectedRevision) < 1)) {
    throw new Error('Unexpected action; no automatic authorization was issued');
  }
  return decision;
}

export function validateOwnedRestartEvidence(value: any, input: { platform: string; runId: string; action: InvocationReviewView; waitStartedAt: string }): void {
  if (!value || value.platform !== input.platform || value.runId !== input.runId || value.requestId !== input.action.requestId ||
      value.toolCallId !== input.action.call.toolCallId || value.revision !== input.action.revision || value.storageRetained !== true ||
      !Number.isInteger(value.oldPid) || value.oldPid <= 0 || !Number.isInteger(value.newPid) || value.newPid <= 0 || value.oldPid === value.newPid ||
      typeof value.owner !== 'string' || !value.owner || typeof value.storagePath !== 'string' || !value.storagePath ||
      !Number.isFinite(Date.parse(value.startedAt)) || Date.parse(value.startedAt) < Date.parse(input.waitStartedAt) ||
      !Number.isFinite(Date.parse(value.completedAt)) || Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    throw new Error('Restart hook did not establish owned replacement with retained storage and the original review identity');
  }
}

export function matchesFixtureState(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && argumentDigest(actual[key]) === argumentDigest(value));
}

/** Grade tool evidence against independently observed fixture state. Runtime
 * completion and the model's own report cannot substitute for source receipts. */
export function sustainedTaskCriteria(input: { stage: Scenario['stages'][number]; record: any; run: RunView; receipts: any[]; manifest: any; namespace: string }): Record<string, boolean> {
  const { stage, record, run, receipts, manifest, namespace } = input;
  const collection = stage.collection!;
  const events = run.events.filter(event => event.kind === 'ToolExecutionCompleted');
  const verified = (name: string, args: Record<string, unknown>, state: Record<string, unknown>, phase?: { before?: number; after?: number }) => events.some(event =>
    event.payload.toolName === name && matchesConnectedVerification({ receipt: receipts.find(receipt => receipt.toolCallId === event.payload.toolCallId),
      catalogRevision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId,
      toolCallId: String(event.payload.toolCallId), toolName: name, round: Number(event.payload.round), arguments: args, expectedState: state,
      sequence: { actual: event.recordedSequence, ...phase } }));
  const firstEffect = Math.min(Infinity, ...record.reviews.filter((review: any) => review.decision === 'approved').map((review: any) =>
    events.find(event => event.payload.toolCallId === review.call.toolCallId)?.recordedSequence ?? Infinity));
  const collectionRead = verified(collection.listTool, { namespace }, { records: Object.values(record.before.records) }, { before: firstEffect });
  const recordsRead = collectionRead || collection.keys.every(key => verified(collection.inspectTool, { namespace, key }, record.before.records[key], { before: firstEffect }));
  const rulesReviewed = stage.reviewRules!.every(rule => record.reviews.some((review: any) => review.decision === rule.decision && matchesFixtureState(review.arguments, rule.allowedArguments)));
  const mutationsVerified = record.reviews.every((review: any) => {
    const key = review.arguments.key;
    const decision = run.events.find(event => event.kind === 'InvocationReviewDecided' && event.payload.requestId === review.requestId && event.payload.decision === review.decision);
    if (!decision) return false;
    const mutation = events.find(event => event.payload.toolCallId === review.call.toolCallId);
    if (review.decision === 'denied') return !mutation && argumentDigest(record.after.records[key]) === argumentDigest(review.stateBeforeDecision.records[key]) &&
      verified(collection.inspectTool, { namespace, key }, record.after.records[key], { after: decision.recordedSequence });
    return !!mutation && matchesConnectedVerification({ receipt: receipts.find(receipt => receipt.toolCallId === review.call.toolCallId),
      catalogRevision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId, toolCallId: review.call.toolCallId,
      toolName: String(mutation.payload.toolName), round: review.call.round, arguments: review.arguments, expectedState: record.after.records[key] }) &&
      verified(collection.inspectTool, { namespace, key }, record.after.records[key], { after: mutation.recordedSequence });
  });
  const immutableConstraints = collection.keys.every(key => ['approvedDate', 'dependency', 'status'].every(field =>
    record.before.records[key]?.[field] === record.after.records[key]?.[field]));
  const skillLoaded = events.some(event => {
    if (event.payload.toolName !== collection.skillTool) return false;
    const receipt = receipts.find(receipt => receipt.toolCallId === event.payload.toolCallId);
    if (!receipt || receipt.status !== 'complete' || receipt.toolName !== collection.skillTool || receipt.catalogRevision !== manifest.capabilities.toolCatalog.revision || receipt.result?.status !== 'completed' ||
        receipt.fingerprint !== argumentDigest({ revision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId,
          call: { toolCallId: receipt.toolCallId, name: collection.skillTool, arguments: { name: 'collection-review' }, round: Number(event.payload.round) } })) return false;
    try {
      const skill = JSON.parse(receipt.result.content);
      if (skill.packageId !== 'record-review-skills' || skill.name !== 'collection-review' || skill.trust !== 'untrusted' || skill.authority !== 'none' || typeof skill.digest !== 'string' || typeof skill.instructions !== 'string') return false;
      return run.events.some(later => {
        const observation = later.payload.observation as any;
        return later.kind === 'EvalModelObserved' && later.recordedSequence > event.recordedSequence &&
          observation?.providerRequest?.messages?.some((message: any) => message.role === 'tool' && message.tool_call_id === receipt.toolCallId && message.content === receipt.result.content);
      });
    } catch { return false; }
  });
  const task = stage.goal.replaceAll('{namespace}', namespace);
  const firstDecision = run.events.find(event => event.kind === 'InvocationReviewDecided');
  const taskRetainedAfterWait = !!firstDecision && run.events.some(event => {
    const observation = event.payload.observation as any;
    return event.kind === 'EvalModelObserved' && event.recordedSequence > firstDecision.recordedSequence &&
      observation?.providerRequest?.messages?.some((message: any) => message.role === 'user' && typeof message.content === 'string' && message.content.includes(task));
  });
  return { taskRetainedAfterWait, recordsRead, referenceRead: verified(collection.referenceTool, {}, collection.reference), skillLoaded, rulesReviewed, mutationsVerified,
    immutableConstraints, originalWaitRetained: !!record.wait?.completedAt && record.wait.elapsedMs >= 60000,
    restartObserved: !!record.wait?.restart, reportCoversCollection: collection.keys.every(key => String(record.output ?? '').toLowerCase().includes(key)) };
}
/** Real-model observation driver; native platforms own every model/tool step.
 * Automated decisions authorize only a declared local fictional provider. */
async function main() {
  loadLocalServerEnvironment();
  const args = process.argv.slice(2).filter(value => value !== '--');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--api', '--platforms', '--scenario', '--model', '--continuation', '--restart-hook'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: eval:connected --api URL --platforms mastra,temporal,langgraph,restate,vercel-workflows --scenario JSON [--model exact-approved-id:free] [--continuation JSON] [--restart-hook owned-local-module.mjs]');
    values.set(args[index], args[index + 1]);
  }
  const api = values.get('--api') ?? 'http://127.0.0.1:4322';
  const platforms = (values.get('--platforms') ?? 'mastra,temporal,langgraph,restate').split(',');
  if (platforms.some(platform => !['mastra', 'temporal', 'langgraph', 'restate', 'vercel-workflows'].includes(platform))) throw new Error('Unsupported native platform');
  const scenario: Scenario = JSON.parse(await readFile(resolve(values.get('--scenario') ?? '../lab/scenarios/connected-tools/scenario.json'), 'utf8'));
  if (scenario.schemaVersion !== 1 || scenario.fixtureOnly !== true || !scenario.stages?.length) throw new Error('A declared fixture-only scenario is required');
  if (scenario.sustained && (scenario.stages.length !== 1 || ![scenario.sustained.maxDurationMs, scenario.sustained.modelTimeoutMs, scenario.sustained.holdFirstReviewMs].every(Number.isFinite) || scenario.sustained.modelTimeoutMs < 100 || scenario.sustained.modelTimeoutMs > 300000 || scenario.sustained.maxDurationMs < 120000 || scenario.sustained.maxDurationMs > 3600000 ||
      scenario.sustained.holdFirstReviewMs < 60000 || scenario.sustained.holdFirstReviewMs > 120000 || !scenario.stages[0].reviewRules?.length || !scenario.stages[0].collection || values.has('--continuation'))) {
    throw new Error('Sustained acceptance requires one collection task, declared review rules, a 60–120 second retained wait and no fresh-run continuation');
  }
  const restartHook = values.has('--restart-hook') ? await import(pathToFileURL(resolve(values.get('--restart-hook')!)).href) : null;
  if (scenario.sustained?.requireRestart && typeof restartHook?.restartOwnedNative !== 'function') throw new Error('This scenario requires an explicit owned native restart hook; the observer never discovers or kills processes');
  const provider = new URL(scenario.provider);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(provider.hostname) || provider.username || provider.password || provider.protocol !== 'http:') throw new Error('Automatic fixture decisions require a credential-free loopback provider');
  const health = await json(`${scenario.provider}/health`);
  if (health.mode !== 'controlled-fictional-provider') throw new Error('The provider does not declare the controlled fixture contract');
  const continuation = values.has('--continuation') ? JSON.parse(await readFile(resolve(values.get('--continuation')!), 'utf8')) as { platform: string; sourceReport: string; startStage: string; feedback?: string }[] : null;
  const stateUrl = (namespace: string) => `${scenario.provider}${(scenario.statePath ?? '/state/{namespace}').replace('{namespace}', namespace)}`;
  if (continuation && (!Array.isArray(continuation) || platforms.some(platform => continuation.filter(item => item.platform === platform).length !== 1))) throw new Error('Continuation requires one explicit source/start stage for every selected platform');
  const model = values.get('--model') ?? COMPARISON_FREE_MODEL;
  const raw = await fetch(`${process.env.AGENTLAB_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'}/models`, { signal: AbortSignal.timeout(15000) });
  if (!raw.ok) throw new Error(`Free catalog unavailable: ${raw.status}`);
  const rawCatalog = await raw.json();
  const catalogObservation = assertFreeModelCatalog(rawCatalog, model);
  const rawSelectedEntry = (rawCatalog as any).data.find((entry: any) => entry.id === model);
  const priceObservation = { fetchedAt: new Date().toISOString(), catalogUrl: `${process.env.AGENTLAB_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'}/models`, id: rawSelectedEntry.id, pricing: rawSelectedEntry.pricing, supportedParameters: rawSelectedEntry.supported_parameters };
  const versions = await installedRuntimeVersions();
  const experimentId = 'agent-capabilities-live';
  const report: Record<string, any> = { schemaVersion: 1, mode: 'real-model-controlled-connected', startedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), versions, priceObservation, scenario, ...(continuation ? { continuation, interpretation: 'Separate bounded continuation with retained session/state; not initial full-workflow acceptance' } : {}),
    controls: { model: catalogObservation, experimentId, maxOutputTokens: getFreeEvalSettings(experimentId)!.maxOutputTokens, freeOnly: true, catalogCheckedAt: new Date().toISOString(), nativeExecutionTimeoutMs: Number(process.env.AGENTLAB_NATIVE_EXECUTION_TIMEOUT_MS ?? 180000), temporalActivityTimeoutMs: Number(process.env.AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS ?? 120000), reviewDecisions: 'scripted-local-fixture-only; not frontend verification', deadlineMs: scenario.sustained?.maxDurationMs ?? 180000,
      ...(scenario.sustained ? { sustained: scenario.sustained, restartHook: values.get('--restart-hook') ?? null } : {}) }, outcomes: [] };
  const directory = resolve(process.env.AGENTLAB_RUN_ROOT ?? '../lab/runs', '.connected-proof', `connected-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const save = () => writeFile(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  await save();
  for (const platform of platforms) {
    const item = continuation?.find(item => item.platform === platform);
    const source = item ? JSON.parse(await readFile(resolve(item.sourceReport), 'utf8')) : null;
    const namespace = item ? source.outcomes.find((outcome: any) => outcome.platform === platform)?.namespace : `cap-${platform}-${randomUUID()}`;
    const outcome: Record<string, any> = { platform, namespace, stages: [], verdict: 'incomplete' };
    report.outcomes.push(outcome); await save();
    try {
      let startIndex = 0;
      if (item) {
        const observed = await json(stateUrl(namespace));
        const validated = validateConnectedContinuation(scenario, source, platform, item.startStage, observed, model);
        startIndex = validated.startIndex;
        outcome.provenance = { sourceReport: item.sourceReport, sourceRevision: source.sourceRevision, sourceModel: source.controls.model, ...validated, observedBeforeContinuation: observed, feedback: item.feedback ?? null };
        for (const runId of validated.sourceRunIds) {
          const prior = await json(`${api}/api/runs/${runId}/actions`);
          if (prior.actions.some((action: any) => action.status === 'pending')) throw new Error('A prior action is still pending; continuation cannot authorize a competing proposal');
        }
        await save();
      }
      for (const stage of scenario.stages.slice(startIndex)) {
        const before = await json(stateUrl(namespace));
        let run: RunView = await json(`${api}/api/runs`, { platform, variant: 'baseline', sessionId: namespace, clientTurnId: `${item ? directory.split('/').at(-1) : 'connected'}-${stage.id}`,
          task: { kind: 'prompt', prompt: `${item?.feedback && stage.id === item.startStage ? item.feedback + '\n\n' : ''}${stage.goal.replaceAll('{namespace}', namespace)}` }, model: { provider: 'openrouter', model },
          selection: { scenarioId: scenario.id, experimentId }, capabilities: { profileId: scenario.profileId, tools: { enabledNames: [], maxRounds: scenario.sustained ? 24 : 16, maxCalls: scenario.sustained ? 48 : 24 } },
          ...(scenario.sustained ? { execution: { mode: 'sustained', maxDurationMs: scenario.sustained.maxDurationMs, modelTimeoutMs: scenario.sustained.modelTimeoutMs } } : {}) });
        const record: Record<string, any> = { id: stage.id, runId: run.runId, before, reviews: [], verdict: 'incomplete' };
        outcome.stages.push(record); await save();
        const deadline = Date.now() + report.controls.deadlineMs;
        const decided = new Set<string>();
        while (['queued', 'running', 'suspended'].includes(run.status)) {
          if (Date.now() > deadline) {
            await json(`${api}/api/runs/${run.runId}/cancel`, { reason: 'Controlled connected acceptance deadline' });
            throw new Error('Observation deadline; cancellation requested, provider state retained for reconciliation');
          }
          const actions: InvocationReviewView[] = (await json(`${api}/api/runs/${run.runId}/actions`)).actions;
          for (const action of actions.filter(action => action.status === 'pending')) {
            const identity = `${action.requestId}:${action.revision}`;
            if (decided.has(identity)) continue;
            const decision = fixtureReviewDecision(scenario, stage, action, namespace);
            if (stage.reviewRules && record.reviews.some((review: any) => review.arguments.key === (action.displayArguments as any).key)) throw new Error('A record was proposed twice; no repeated mutation was authorized');
            if (scenario.sustained && !record.wait) {
              const waitStartedAt = new Date().toISOString();
              record.wait = { startedAt: waitStartedAt, requestId: action.requestId, revision: action.revision, toolCallId: action.call.toolCallId,
                argumentDigest: action.argumentDigest, nativeBefore: run.executionReference, statusBefore: run.status };
              await save();
              if (restartHook) {
                const evidence = await restartHook.restartOwnedNative({ api, platform, runId: run.runId, executionReference: run.executionReference,
                  action: { requestId: action.requestId, revision: action.revision, toolCallId: action.call.toolCallId }, waitStartedAt });
                validateOwnedRestartEvidence(evidence, { platform, runId: run.runId, action, waitStartedAt });
                record.wait.restart = evidence; await save();
              }
              const remainingWait = scenario.sustained.holdFirstReviewMs - (Date.now() - Date.parse(waitStartedAt));
              if (remainingWait > 0) await new Promise(resolve => setTimeout(resolve, remainingWait));
              run = await json(`${api}/api/runs/${run.runId}`);
              const retainedActions: InvocationReviewView[] = (await json(`${api}/api/runs/${run.runId}/actions`)).actions;
              const retained = retainedActions.find(value => value.requestId === action.requestId && value.revision === action.revision && value.status === 'pending');
              if (!retained || retained.call.toolCallId !== action.call.toolCallId || retained.argumentDigest !== action.argumentDigest ||
                  run.executionReference?.executionId !== record.wait.nativeBefore?.executionId || !['running', 'suspended'].includes(run.status)) throw new Error('The original native execution/review did not survive the retained wait and restart');
              record.wait.completedAt = new Date().toISOString(); record.wait.elapsedMs = Date.now() - Date.parse(waitStartedAt);
              record.wait.nativeAfter = run.executionReference; record.wait.statusAfter = run.status; await save();
            }
            const stateBeforeDecision = await json(stateUrl(namespace));
            const authorizedEffects = before.effectCount + record.reviews.filter((review: any) => review.decision === 'approved').length;
            if (stage.reviewRules ? stateBeforeDecision.effectCount > authorizedEffects : stateBeforeDecision.effectCount !== before.effectCount) throw new Error('Provider changed before required review');
            await json(`${api}/api/runs/${run.runId}/actions/${action.requestId}/decision`, { requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest,
              decisionId: randomUUID(), decision, reason: 'Scripted decision for the declared local fictional fixture only' });
            record.reviews.push({ requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest, call: action.call, arguments: action.displayArguments, decision, stateBeforeDecision });
            decided.add(identity); await save();
          }
          await new Promise(resolve => setTimeout(resolve, 350));
          run = await json(`${api}/api/runs/${run.runId}`);
        }
        const after = await json(stateUrl(namespace));
        record.after = after; record.nativeStatus = run.status; record.error = run.result?.error; record.output = run.result?.output; record.failureCategory = run.result?.error?.failureKind ?? (run.status === 'completed' ? null : 'native-runtime');
        await writeFile(join(directory, `${platform}-${stage.id}.json`), JSON.stringify(run, null, 2) + '\n');
        const expected = matchesFixtureState(after, stage.expected);
        const reviewObserved = stage.decision === null || record.reviews.length > 0;
        const toolCounts = Object.entries(stage.requiredTools ?? {}).every(([name, count]) => run.events.filter(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === name).length >= count);
        const failuresObserved = (stage.requiredFailureTools ?? []).every(name => run.events.some(event => event.kind === 'ToolExecutionFailed' && event.payload.toolName === name));
        const receiptRoot = resolve(process.env.AGENTLAB_RUN_ROOT ?? '../lab/runs', run.runId, 'artifacts/capability-calls');
        const receipts = await readdir(receiptRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; }).then(files => Promise.all(files.map(async filename => JSON.parse(await readFile(join(receiptRoot, filename), 'utf8')))));
        const manifest = JSON.parse(await readFile(resolve(process.env.AGENTLAB_RUN_ROOT ?? '../lab/runs', run.runId, 'config.json'), 'utf8'));
        const verificationArguments = Object.fromEntries(Object.entries(stage.verificationArguments ?? {}).map(([key, value]) => [key, typeof value === 'string' ? value.replaceAll('{namespace}', namespace) : value]));
        const verificationReads = (state: Record<string, unknown>, phase?: { before?: number; after?: number }) => run.events.filter(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === stage.verificationTool &&
          !!stage.verificationArguments && matchesConnectedVerification({ receipt: receipts.find(receipt => receipt.toolCallId === event.payload.toolCallId),
            catalogRevision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId,
            toolCallId: String(event.payload.toolCallId), toolName: String(event.payload.toolName), round: Number(event.payload.round), arguments: verificationArguments, expectedState: state, sequence: { actual: event.recordedSequence, ...phase } }));
        const deniedEvent = run.events.find(event => event.kind === 'InvocationReviewDecided' && event.payload.decision === 'denied');
        const denialVerified = stage.decision !== 'denied' || (!!deniedEvent && verificationReads(before, { before: deniedEvent.recordedSequence }).length > 0 && verificationReads(after, { after: deniedEvent.recordedSequence }).length > 0);
        // Verification must target the same record and return the independently
        // observed state. Another namespace's successful read cannot count.
        const completedMutations = run.events.filter(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === scenario.mutationTool);
        const lastMutationSequence = Math.max(-1, ...completedMutations.map(event => event.recordedSequence));
        const firstMutationSequence = Math.min(Infinity, ...completedMutations.map(event => event.recordedSequence));
        const approvalVerified = stage.decision !== 'approved' || (lastMutationSequence >= 0 && verificationReads(before, { before: firstMutationSequence }).length > 0 && verificationReads(after, { after: lastMutationSequence }).length > 0);
        const retrievalVerified = stage.decision !== null || !stage.verificationTool || verificationReads(after).length > 0;
        const failureArguments = Object.fromEntries(Object.entries(stage.requiredFailureArguments ?? {}).map(([key, value]) => [key, typeof value === 'string' ? value.replaceAll('{namespace}', namespace) : value]));
        const errorObserved = !stage.requiredErrorCode || (!!stage.requiredFailureArguments && !!stage.requiredFailureTools?.length && stage.requiredFailureTools.every(name => run.events.some(event => event.kind === 'ToolExecutionFailed' && event.payload.toolName === name &&
          matchesConnectedVerification({ receipt: receipts.find(receipt => receipt.toolCallId === event.payload.toolCallId),
            catalogRevision: manifest.capabilities.toolCatalog.revision, turnId: manifest.context.turnId,
            toolCallId: String(event.payload.toolCallId), toolName: name, round: Number(event.payload.round), arguments: failureArguments,
            resultStatus: 'failed', expectedState: { code: stage.requiredErrorCode } }))));
        if (stage.collection) record.contextEvidence = { compactions: run.events.filter(event => event.kind === 'ContextCompacted'),
          originalTaskDigest: argumentDigest(stage.goal.replaceAll('{namespace}', namespace)),
          originalReviewCallId: record.wait?.toolCallId, nativeExecution: run.executionReference };
        const sustainedCriteria = stage.collection ? sustainedTaskCriteria({ stage, record, run, receipts, manifest, namespace }) : null;
        record.toolCriteria = { toolCounts, failuresObserved, denialVerified, approvalVerified, retrievalVerified, errorObserved, ...(sustainedCriteria ? { sustainedCriteria } : {}) };
        record.verdict = run.status === 'completed' && expected && reviewObserved && toolCounts && failuresObserved && denialVerified && approvalVerified && retrievalVerified && errorObserved &&
          (!sustainedCriteria || Object.values(sustainedCriteria).every(Boolean)) ? 'pass' : 'fail';
        await save();
        if (record.verdict !== 'pass') throw new Error(`Stage ${stage.id} did not establish its native/result/state/review criteria`);
        if (run.events.some(event => event.kind === 'ToolExecutionUnknown')) throw new Error('Unknown effects require reconciliation before a fresh mutation');
      }
      outcome.verdict = 'pass';
    } catch (error) {
      outcome.verdict = 'fail'; outcome.error = error instanceof Error ? error.message : 'Observation failed';
      const latest = outcome.stages.at(-1);
      if (latest?.runId && !latest.nativeStatus) {
        try { latest.interruption = await json(`${api}/api/runs/${latest.runId}/cancel`, { reason: 'Controlled observer stopped before further fixture authorization' }); } catch { latest.cancellationUnconfirmed = true; }
      }
    }
    await save();
    if (continuation && outcome.stages.some((stage: any) => stage.error?.code?.includes('429'))) { report.stopReason = 'Provider rate limit observed; no additional continuation trial or retry'; break; }
  }
  report.completedAt = new Date().toISOString(); await save();
  console.info(`Retained connected acceptance: ${join(directory, 'summary.json')}`);
  if (report.outcomes.some((outcome: any) => outcome.verdict !== 'pass')) process.exitCode = 1;
}
async function json(url: string, body?: unknown): Promise<any> {
  const response = await fetch(url, { ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : 'Connected acceptance failed'); process.exitCode = 1; });
