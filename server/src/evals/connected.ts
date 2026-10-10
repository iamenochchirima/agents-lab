import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadLocalServerEnvironment } from '../control-plane/bootstrap/local-env.js';
import { COMPARISON_FREE_MODEL, assertFreeModelCatalog, getFreeEvalSettings } from '../models/openrouter/free-model-policy.js';
import { installedRuntimeVersions } from './runtime-versions.js';
import type { RunView } from '../control-plane/application/run-service.js';
import { validateConnectedContinuation } from './connected-continuation.js';
import type { InvocationReviewView } from '../capabilities/reviews/contracts.js';

interface Scenario {
  schemaVersion: 1; fixtureOnly: true; id: string; provider: string; profileId: string;
  mutationTool: string; stages: { id: string; goal: string; decision: 'approved' | 'denied' | null; allowedArguments?: Record<string, unknown>; requiredTools?: Record<string, number>; requiredFailureTools?: string[]; requiredErrorCode?: string; verificationTool?: string; expected: Record<string, unknown> }[];
}
/** Real-model observation driver; native platforms own every model/tool step.
 * Automated decisions authorize only a declared local fictional provider. */
async function main() {
  loadLocalServerEnvironment();
  const args = process.argv.slice(2).filter(value => value !== '--');
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--api', '--platforms', '--scenario', '--model', '--continuation'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: eval:connected --api URL --platforms mastra,temporal,langgraph,restate,vercel-workflows --scenario JSON [--model exact-approved-id:free] [--continuation JSON]');
    values.set(args[index], args[index + 1]);
  }
  const api = values.get('--api') ?? 'http://127.0.0.1:4322';
  const platforms = (values.get('--platforms') ?? 'mastra,temporal,langgraph,restate').split(',');
  if (platforms.some(platform => !['mastra', 'temporal', 'langgraph', 'restate', 'vercel-workflows'].includes(platform))) throw new Error('Unsupported native platform');
  const scenario: Scenario = JSON.parse(await readFile(resolve(values.get('--scenario') ?? '../lab/scenarios/connected-tools/scenario.json'), 'utf8'));
  if (scenario.schemaVersion !== 1 || scenario.fixtureOnly !== true || !scenario.stages?.length) throw new Error('A declared fixture-only scenario is required');
  const provider = new URL(scenario.provider);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(provider.hostname) || provider.username || provider.password || provider.protocol !== 'http:') throw new Error('Automatic fixture decisions require a credential-free loopback provider');
  const health = await json(`${scenario.provider}/health`);
  if (health.mode !== 'controlled-fictional-provider') throw new Error('The provider does not declare the controlled fixture contract');
  const continuation = values.has('--continuation') ? JSON.parse(await readFile(resolve(values.get('--continuation')!), 'utf8')) as { platform: string; sourceReport: string; startStage: string; feedback?: string }[] : null;
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
    controls: { model: catalogObservation, experimentId, maxOutputTokens: getFreeEvalSettings(experimentId)!.maxOutputTokens, freeOnly: true, catalogCheckedAt: new Date().toISOString(), nativeExecutionTimeoutMs: Number(process.env.AGENTLAB_NATIVE_EXECUTION_TIMEOUT_MS ?? 180000), temporalActivityTimeoutMs: Number(process.env.AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS ?? 120000), reviewDecisions: 'scripted-local-fixture-only; not frontend verification', deadlineMs: 180000 }, outcomes: [] };
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
        const observed = await json(`${scenario.provider}/state/${namespace}`);
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
        const before = await json(`${scenario.provider}/state/${namespace}`);
        let run: RunView = await json(`${api}/api/runs`, { platform, variant: 'baseline', sessionId: namespace, clientTurnId: `${item ? directory.split('/').at(-1) : 'connected'}-${stage.id}`,
          task: { kind: 'prompt', prompt: `${item?.feedback && stage.id === item.startStage ? item.feedback + '\n\n' : ''}${stage.goal.replaceAll('{namespace}', namespace)}` }, model: { provider: 'openrouter', model },
          selection: { scenarioId: scenario.id, experimentId }, capabilities: { profileId: scenario.profileId, tools: { enabledNames: [], maxRounds: 16, maxCalls: 24 } } });
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
            if (!stage.decision || action.call.name !== scenario.mutationTool || (action.displayArguments as any).namespace !== namespace || !Object.entries(stage.allowedArguments ?? {}).every(([key, value]) => (action.displayArguments as any)[key] === value)) throw new Error('Unexpected action; no automatic authorization was issued');
            const stateBeforeDecision = await json(`${scenario.provider}/state/${namespace}`);
            if (stateBeforeDecision.effectCount !== before.effectCount) throw new Error('Provider changed before required review');
            await json(`${api}/api/runs/${run.runId}/actions/${action.requestId}/decision`, { requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest,
              decisionId: randomUUID(), decision: stage.decision, reason: 'Scripted decision for the declared local fictional fixture only' });
            record.reviews.push({ requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest, call: action.call, decision: stage.decision, stateBeforeDecision });
            decided.add(identity); await save();
          }
          await new Promise(resolve => setTimeout(resolve, 350));
          run = await json(`${api}/api/runs/${run.runId}`);
        }
        const after = await json(`${scenario.provider}/state/${namespace}`);
        record.after = after; record.nativeStatus = run.status; record.error = run.result?.error; record.output = run.result?.output; record.failureCategory = run.result?.error?.failureKind ?? (run.status === 'completed' ? null : 'native-runtime');
        await writeFile(join(directory, `${platform}-${stage.id}.json`), JSON.stringify(run, null, 2) + '\n');
        const expected = Object.entries(stage.expected).every(([key, value]) => after[key] === value);
        const reviewObserved = stage.decision === null || record.reviews.length > 0;
        const toolCounts = Object.entries(stage.requiredTools ?? {}).every(([name, count]) => run.events.filter(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === name).length >= count);
        const failuresObserved = (stage.requiredFailureTools ?? []).every(name => run.events.some(event => event.kind === 'ToolExecutionFailed' && event.payload.toolName === name));
        const deniedEvent = run.events.find(event => event.kind === 'InvocationReviewDecided' && event.payload.decision === 'denied');
        const denialVerified = stage.decision !== 'denied' || (!!deniedEvent && run.events.some(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === stage.verificationTool && event.recordedSequence > deniedEvent.recordedSequence));
        // Two reads could both precede the mutation. Verification must observe
        // saved state after the final successful mutation in this stage.
        const completedMutations = run.events.filter(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === scenario.mutationTool);
        const lastMutationSequence = Math.max(-1, ...completedMutations.map(event => event.recordedSequence));
        const approvalVerified = stage.decision !== 'approved' || (lastMutationSequence >= 0 && !!stage.verificationTool && run.events.some(event => event.kind === 'ToolExecutionCompleted' && event.payload.toolName === stage.verificationTool && event.recordedSequence > lastMutationSequence));
        let errorObserved = !stage.requiredErrorCode;
        if (stage.requiredErrorCode) {
          const receiptRoot = resolve(process.env.AGENTLAB_RUN_ROOT ?? '../lab/runs', run.runId, 'artifacts/capability-calls');
          for (const filename of await readdir(receiptRoot)) {
            const receipt = JSON.parse(await readFile(join(receiptRoot, filename), 'utf8'));
            if (receipt.status === 'complete' && receipt.result?.status === 'failed' && JSON.stringify(receipt.result).includes(stage.requiredErrorCode)) errorObserved = true;
          }
        }
        record.toolCriteria = { toolCounts, failuresObserved, denialVerified, approvalVerified, errorObserved };
        record.verdict = run.status === 'completed' && expected && reviewObserved && toolCounts && failuresObserved && denialVerified && approvalVerified && errorObserved ? 'pass' : 'fail';
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
main().catch(error => { console.error(error instanceof Error ? error.message : 'Connected acceptance failed'); process.exitCode = 1; });
