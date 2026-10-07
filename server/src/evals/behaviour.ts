import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BehaviourCaseId, BehaviourObservation } from '../../../lab/scenarios/platform-agent-conformance/behaviour-evals.mjs';
import type { BaselineToolObservation, BaselineRequest } from '../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs';
import { loadServerConfig } from '../control-plane/bootstrap/config.js';
import { RunEvidenceStore } from '../control-plane/application/evidence-store.js';
import { RunService, type RunView } from '../control-plane/application/run-service.js';
import { PlatformRegistry } from '../control-plane/application/platform-registry.js';
import type { PlatformRunner } from '../control-plane/ports/runner.js';
import type { PlatformExecutionReference, RunRequest } from '../control-plane/domain/types.js';
import type { EvalJson, RunEvalReport } from '../control-plane/domain/eval-report.js';
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from '../capabilities/context/index.js';
import { createDefaultCapabilityCatalog } from '../capabilities/catalog.js';
import { createLocalFixtureServer, type LocalFixtureServerHandle } from '../capabilities/integrations/local-fixture/service.js';
import { MastraBaselineRunner } from '../platforms/mastra/runner-adapter/mastra-runner.js';
import { TemporalBaselineRunner } from '../platforms/temporal/runner-adapter/temporal-runner.js';
import { RestateBaselineRunner } from '../platforms/restate/runner-adapter/restate-runner.js';
import { loadRestateConfig } from '../platforms/restate/config.js';
import { LangGraphBaselineRunner } from '../platforms/langgraph/runner-adapter/langgraph-runner.js';
import { scriptedMastraModel, type CapturedRequest } from './mastra-scripted-model.js';
import { installedRuntimeVersions } from './runtime-versions.js';
import { normalizeBehaviourObservation, inspectBehaviourIntegrity, exerciseBehaviourProjection } from './behaviour-evidence.js';

const platforms = ['mastra', 'langgraph', 'temporal', 'restate'];
const caseIds = Array.from({ length: 12 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`) as BehaviourCaseId[];
let interrupted = false;
const interrupt = () => { interrupted = true; };
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const directive = (value: Record<string, unknown>, text = 'Perform this synthetic task.') => `${text} [eval-behaviour:${Buffer.from(JSON.stringify(value)).toString('base64url')}]`;

/** Fault after an actual native acceptance, at reference persistence. No operation is redispatched. */
class ReferenceFaultStore extends RunEvidenceStore {
  loseNextReference = false;
  override async writeExecutionReference(runId: string, reference: PlatformExecutionReference): Promise<void> {
    if (this.loseNextReference) { this.loseNextReference = false; throw new Error('Controlled native acknowledgement persistence loss.'); }
    return super.writeExecutionReference(runId, reference);
  }
}
async function rootDirectory() {
  let root = process.cwd();
  while (true) { try { await access(join(root, 'pnpm-workspace.yaml')); return root; } catch { const parent = dirname(root); if (parent === root) throw new Error('Run from the Lab workspace.'); root = parent; } }
}

/** Existing eval:baseline command runs native loops; the driver only arranges controlled probes. */
export async function runBehaviourEvals(args: string[]): Promise<void> {
  let selectedPlatforms = ['mastra'], selectedCases = caseIds, trials = 1, deadlineMs = 30_000;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value) throw new Error('Each eval option needs a value.');
    if (flag === '--platform' || flag === '--platforms') selectedPlatforms = value.split(',');
    else if (flag === '--cases') selectedCases = value.split(',') as BehaviourCaseId[];
    else if (flag === '--trials' && /^\d+$/.test(value)) trials = Number(value);
    else if (flag === '--deadline-ms' && /^\d+$/.test(value)) deadlineMs = Number(value);
    else throw new Error('Usage: eval:baseline --platforms mastra,langgraph --cases B01,B04 --trials 1 --deadline-ms 30000');
  }
  if (!selectedPlatforms.length || selectedPlatforms.length > 4 || new Set(selectedPlatforms).size !== selectedPlatforms.length || selectedPlatforms.some(value => !platforms.includes(value)) || !selectedCases.length || new Set(selectedCases).size !== selectedCases.length || selectedCases.some(value => !caseIds.includes(value)) || trials < 1 || trials > 5 || deadlineMs < 100 || deadlineMs > 120_000) throw new Error('Select distinct supported platforms and B01–B12 cases, 1–5 trials, deadline 100–120000 ms.');
  const root = await rootDirectory();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try { for (const platform of selectedPlatforms) { if (interrupted) break; await runPlatform(root, platform, selectedCases, trials, deadlineMs); } }
  finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  if (interrupted) process.exitCode = 1;
}

async function runPlatform(root: string, platform: string, selectedCases: BehaviourCaseId[], trials: number, deadlineMs: number) {
  const suite = await import(pathToFileURL(join(root, 'lab/scenarios/platform-agent-conformance/behaviour-evals.mjs')).href) as typeof import('../../../lab/scenarios/platform-agent-conformance/behaviour-evals.mjs');
  const legacy = await import(pathToFileURL(join(root, 'lab/scenarios/platform-agent-conformance/baseline-evals.mjs')).href) as typeof import('../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs');
  const config = loadServerConfig({ ...process.env, AGENTLAB_ALLOWED_MODEL_PROVIDERS: 'fake', AGENTLAB_CONNECTED_CAPABILITIES_ENABLED: 'true' }, root);
  const evidence = new ReferenceFaultStore(config.runsRoot);
  const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
  const captures: CapturedRequest[] = [], tools: BaselineToolObservation[] = [];
  let fixture: LocalFixtureServerHandle | null = null, fixtureIssue: string | null = null;
  if (selectedCases.some(id => ['B06', 'B08'].includes(id))) {
    try { fixture = await createLocalFixtureServer({ port: 9191 }); process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://${fixture.host}:${fixture.port}`; }
    catch (error) { fixtureIssue = `Evaluator-owned fixture unavailable: ${error instanceof Error ? error.message : String(error)}`; }
  }
  async function makeRunner(nativeDeadline?: number): Promise<PlatformRunner> {
    if (platform === 'mastra') return new MastraBaselineRunner({ contextRoot: config.contextRoot, ...(nativeDeadline ? { executionTimeoutMs: nativeDeadline } : {}), modelFactory: manifest => scriptedMastraModel(manifest, captures), onToolObservation: (runId, call, result) => tools.push({ runId, callId: call.toolCallId, toolName: call.name, input: call.arguments, output: result.content, status: result.status }) });
    if (platform === 'temporal') return TemporalBaselineRunner.connect(nativeDeadline ? { ...config, temporal: { ...config.temporal, activityTimeoutMs: nativeDeadline } } : config).catch(error => TemporalBaselineRunner.unavailable(config, String(error)));
    if (platform === 'restate') return RestateBaselineRunner.connect(loadRestateConfig({ ...process.env, AGENTLAB_CONTEXT_ROOT: config.contextRoot }));
    return LangGraphBaselineRunner.fromOptions({ serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? 'http://127.0.0.1:2024', contextRoot: config.contextRoot, maxAttempts: 1, ...(nativeDeadline ? { timeoutMs: nativeDeadline } : {}) });
  }
  const base = await makeRunner();
  const connection = await base.checkConnection();
  const versions = await installedRuntimeVersions();
  const invocationId = `behaviour-${randomUUID()}`, startedAt = new Date().toISOString();
  let revision: string | null = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* source export */ }
  const summary: { caseId: string; trial: number; verdict: string; runIds: string[]; evidence: string | null; reason?: string }[] = [];
  const summaryDirectory = join(config.runsRoot, '.evals', invocationId);
  await mkdir(summaryDirectory, { recursive: true });
  async function save(completedAt: string | null = null) {
    const value = { schemaVersion: 1, invocationId, mode: 'scripted', platform, variant: 'baseline', suiteVersion: suite.BEHAVIOUR_SUITE_VERSION, modelId: 'fake-eval-behaviour', startedAt, completedAt, selectedCases, selectedPlatforms: [platform], trials, revision, versions, connection, profile: base.manifestConfiguration(), contextLimits: config.context,
      comparisonControls: { modelSettings: { provider: 'fake', protocol: 'behaviour-v2', contextWindowTokens: 16384 }, context: config.context, toolConfiguration: { maxCalls: 8, maxRounds: 6, scopedFixture: true }, faultConfiguration: { selectedCases, nativeDeadlineMs: 200, scripted: true, unavailable: 'refused endpoint at native runner readiness boundary', acknowledgementLoss: 'reference persistence after native acceptance' }, profile: 'baseline' }, cases: summary };
    const temporary = join(summaryDirectory, 'summary.pending.json');
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n'); await rename(temporary, join(summaryDirectory, 'summary.json'));
  }
  await save();
  try {
    caseLoop: for (let trial = 1; trial <= trials; trial++) for (const id of selectedCases) {
      if (interrupted) break caseLoop;
      if (!connection.reachable || fixtureIssue && ['B06', 'B08'].includes(id)) {
        summary.push({ caseId: id, trial, verdict: 'blocked', runIds: [], evidence: null, reason: fixtureIssue ?? connection.message }); await save(); continue;
      }
      let actualRunner = base;
      let unavailableNext = false;
      let startCount = 0, acceptedReference: PlatformExecutionReference | null = null;
      const runner: PlatformRunner = { platform: actualRunner.platform, variant: actualRunner.variant, manifestConfiguration: () => actualRunner.manifestConfiguration(), validate: manifest => actualRunner.validate(manifest), checkConnection: async () => {
        if (!unavailableNext) return actualRunner.checkConnection();
        unavailableNext = false;
        try { await fetch('http://127.0.0.1:65534/health', { signal: AbortSignal.timeout(200) }); return { reachable: true, message: 'Injected unavailable endpoint unexpectedly replied.' }; }
        catch (cause) { return { reachable: false, message: `Controlled runner readiness endpoint failure: ${cause instanceof Error ? cause.message : String(cause)}` }; }
      }, start: async manifest => { startCount++; acceptedReference = await actualRunner.start(manifest); return acceptedReference; }, inspect: reference => actualRunner.inspect(reference), cancel: (reference, reason) => actualRunner.cancel(reference, reason) };
      const service = new RunService({ config, evidence, context, registry: new PlatformRegistry([runner]), capabilities: createDefaultCapabilityCatalog(undefined, { connectedEnabled: true }) });
      const views: RunView[] = [], probes: string[] = [], initialConfigs = new Map<string, string>(), extras: Partial<BehaviourObservation> = {};
      const elapsed = new Map<string, number>(), deadlineRuns = new Set<string>(), approvals = new Set<string>();
      let error: string | null = null;
      const namespaces: string[] = [];
      const baseRequest = (prompt: string, model = 'fake-eval-behaviour'): RunRequest => ({ platform, variant: 'baseline', sessionId: `eval-${randomUUID()}`, clientTurnId: `turn-${randomUUID()}`, task: { kind: 'prompt', prompt }, model: { provider: 'fake', model, contextWindowTokens: 16384 }, capabilities: { tools: { enabledNames: ['calculator'], maxCalls: 8, maxRounds: 6 } }, selection: { scenarioId: 'platform-agent-conformance', experimentId: 'agent-harness-behaviour' } });
      async function admit(probe: string, request: RunRequest, wait = true) {
        if (interrupted) throw new Error('Eval interrupted before further admission.');
        const time = Date.now(), created = await service.createRun(request), index = views.length;
        probes.push(probe); views.push(created); initialConfigs.set(created.runId, await evidence.readAllowlistedFile(created.runId, 'config.json'));
        if (wait) views[index] = await observe(service, created, deadlineMs, latest => { views[index] = latest; });
        elapsed.set(created.runId, Date.now() - time); return views[index]!;
      }
      async function cancelProbe(probe: 'during' | 'completed' | 'repeated') {
        const view = await admit(probe, baseRequest(directive({ action: probe === 'completed' ? 'complete' : 'slow', delayMs: 3000 })), probe === 'completed');
        let latest = view;
        if (probe !== 'completed') {
          const stop = Date.now() + deadlineMs;
          while (!latest.events.some(event => event.kind === 'ModelRequested') && Date.now() < stop) { await pause(20); latest = await service.getRun(view.runId); }
        }
        latest = await service.cancelRun(view.runId, 'Controlled behaviour cancellation.');
        if (probe === 'repeated') latest = await service.cancelRun(view.runId, 'Repeated controlled cancellation.');
        latest = await observe(service, latest, deadlineMs, value => { latest = value; });
        views[views.findIndex(item => item.runId === latest.runId)] = latest;
        const alreadyTerminal = probe === 'completed' && view.status === 'completed' && JSON.stringify(latest.result) === JSON.stringify(view.result);
        const sequence = latest.events.find(event => event.kind === (probe === 'completed' ? 'RunCompleted' : 'RunCancellationRequested'))?.recordedSequence ?? latest.events.at(-1)?.recordedSequence ?? 0;
        (extras.cancellations ??= []).push({ runId: latest.runId, probe, observedSequence: sequence, requestedCount: probe === 'repeated' ? 2 : 1, status: latest.status, alreadyTerminal, terminalCount: latest.events.filter(event => ['RunCancelled', 'RunCompleted', 'RunFailed'].includes(event.kind)).length, inFlight: probe === 'completed' ? 'none' : latest.events.some(event => /Cancelled/.test(event.kind)) ? 'cancelled' : 'unknown' });
      }
      async function ackLoss(probe: string, resolve: boolean) {
        evidence.loseNextReference = true;
        const view = await admit(probe, baseRequest(directive({ action: 'complete' })), false);
        const observedUnknown = view.status === 'reconciliation_required';
        if (resolve && acceptedReference) {
          await evidence.writeExecutionReference(view.runId, acceptedReference);
          views[views.length - 1] = await observe(service, await service.getRun(view.runId), deadlineMs, latest => { views[views.length - 1] = latest; });
        }
        return { view: views.at(-1)!, observedUnknown };
      }
      try {
        if (['B01', 'B02', 'B03'].includes(id)) {
          const fixtureCase = legacy.BASELINE_CASES.find(item => item.id === id)!;
          const sessionId = `eval-${randomUUID()}`;
          for (const [index, prompt] of fixtureCase.prompts.entries()) {
            const model = platform === 'mastra' ? id === 'B03' ? 'fake-context' : id === 'B02' ? 'fake-tool-call' : 'fake-success' : id === 'B03' ? 'fake-eval-context' : id === 'B02' ? 'fake-eval-tool' : 'fake-eval-completion';
            const request = baseRequest(prompt, model);
            await admit(`turn-${index + 1}`, { ...request, sessionId, capabilities: { tools: { ...request.capabilities!.tools, enabledNames: fixtureCase.enabledTools } } });
          }
        } else if (id === 'B04') {
          const sessions = [`eval-${randomUUID()}`, `eval-${randomUUID()}`];
          for (const probe of ['alpha-store', 'beta-store', 'alpha-recall', 'beta-recall']) {
            const index = probe.startsWith('alpha') ? 0 : 1, marker = suite.ISOLATION_MARKERS[index];
            const request = baseRequest(directive({ action: probe.endsWith('recall') ? 'context' : 'complete', marker, text: 'Stored the marker.' }, probe.endsWith('recall') ? 'Recall the marker from my earlier turn.' : `Remember ${marker}.`));
            await admit(probe, { ...request, sessionId: sessions[index], capabilities: { tools: { ...request.capabilities!.tools, enabledNames: [] } } });
          }
        } else if (id === 'B05') await admit('invalid', baseRequest(directive({ action: 'tool', toolName: 'calculator', input: { operation: 'add', left: 'invalid', right: 25 } })));
        else if (id === 'B06' || id === 'B08') {
          const selected = id === 'B06' ? ['disabled', 'unapproved', 'approved'] : ['provider', 'malformed', 'tool'];
          for (const probe of selected) {
            if (id === 'B08' && probe !== 'tool') { await admit(probe, baseRequest(directive({ action: probe === 'provider' ? 'provider-error' : 'malformed' }))); continue; }
            const namespace = `eval_${randomUUID().slice(0, 20)}`; namespaces.push(namespace); fixture!.seed(namespace, { record: 'before' });
            const before = fixture!.snapshot(namespace);
            if (probe === 'tool') fixture!.failLookup(`${namespace}:record`, 'Controlled recoverable read error.');
            const request = baseRequest(directive({ action: 'tool', toolName: probe === 'tool' ? 'fixture_lookup' : 'fixture_write', input: probe === 'tool' ? { key: `${namespace}:record` } : { key: `${namespace}:record`, value: 'after' } }));
            const approval = { schemaVersion: 1 as const, decisionId: `approval_eval_${randomUUID().replaceAll("-", "_")}`, capabilityId: 'fixture_write', version: '1.0.0', allowedOperations: ['write'], connectionRef: 'conn_local_fixture', decision: 'approved' as const, decidedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
            const view = await admit(probe, { ...request, capabilities: { ...request.capabilities, tools: request.capabilities!.tools, profileId: probe === 'tool' || probe === 'disabled' ? 'local-safe' : 'local-write-approved', ...(probe === 'approved' ? { approvals: [approval] } : {}) } });
            if (probe === 'approved' && view.manifest.capabilities?.resolution?.grants.some(grant => grant.manifest.id === 'fixture_write' && grant.approval === 'approved')) approvals.add(view.runId);
            const after = fixture!.snapshot(namespace);
            (extras.fixtureSnapshots ??= []).push({ probe, namespace, before: before.values, after: after.values, effectCount: after.effectCount });
          }
        } else if (id === 'B07') {
          for (const probe of ['calls', 'rounds']) {
            const request = baseRequest(`[baseline-limit:${probe}] Keep using the calculator to add 17 and 25.`, platform === 'mastra' ? 'fake-tool-call' : 'fake-eval-loop');
            await admit(probe, { ...request, capabilities: { tools: { enabledNames: ['calculator'], maxCalls: probe === 'calls' ? 1 : 8, maxRounds: probe === 'calls' ? 4 : 2 } } });
          }
          actualRunner = await makeRunner(200);
          const view = await admit('deadline', baseRequest(directive({ action: 'slow', delayMs: 2000, timeoutMs: 200 }))); deadlineRuns.add(view.runId);
        } else if (id === 'B09') for (const probe of ['during', 'completed', 'repeated'] as const) await cancelProbe(probe);
        else if (id === 'B10') {
          const request = baseRequest(directive({ action: 'complete' })), canonical = await admit('canonical', request), before = startCount;
          const replay = await service.createRun(request);
          extras.admissions = [{ probe: 'replay', accepted: true, runId: replay.runId, canonicalRunId: canonical.runId, dispatchCount: startCount }];
          try { await service.createRun({ ...request, task: { kind: 'prompt', prompt: 'Changed conflicting content.' } }); extras.admissions.push({ probe: 'conflict', accepted: true, dispatchCount: startCount - before }); }
          catch (cause) { extras.admissions.push({ probe: 'conflict', accepted: false, canonicalRunId: canonical.runId, dispatchCount: startCount - before, errorCode: cause instanceof Error ? cause.name : 'CONFLICT' }); }
        } else if (id === 'B11') {
          await admit('successful', baseRequest(directive({ action: 'complete' }))); await admit('failed', baseRequest(directive({ action: 'provider-error' }))); await cancelProbe('during'); probes[2] = 'cancelled'; await ackLoss('ambiguous', false);
          extras.projection = await exerciseBehaviourProjection(evidence, views[0]!.runId);
          views[0] = await service.getRun(views[0]!.runId);
          await evidence.appendEvent({ runId: views[0]!.runId, source: 'eval-credential-control', sourceSequence: 1, kind: 'EvalCredentialControl', occurredAt: new Date().toISOString(), payload: { apiKey: 'eval-secret-sentinel-7319' } });
          views[0] = await service.getRun(views[0]!.runId);
          extras.integrity = await inspectBehaviourIntegrity(evidence, views, initialConfigs, ['eval-secret-sentinel-7319']);
        } else if (id === 'B12') {
          const before = startCount;
          unavailableNext = true;
          try { await service.createRun(baseRequest(directive({ action: 'complete' }))); extras.admissions = [{ probe: 'unavailable', accepted: true, dispatchCount: startCount - before }]; }
          catch (cause) { extras.admissions = [{ probe: 'unavailable', accepted: false, dispatchCount: startCount - before, errorCode: cause instanceof Error ? cause.name : 'UNAVAILABLE' }]; }
          const lost = await ackLoss('ack-loss', true);
          extras.admissions!.push({ probe: 'ack-loss', accepted: true, runId: lost.view.runId, dispatchCount: startCount - before, reconciliationRequired: lost.observedUnknown, observedUnknown: lost.observedUnknown, resolved: ['completed', 'failed', 'cancelled'].includes(lost.view.status) });
        }
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); console.error(`${id} driver: ${error}`); }
      const runIds = views.map(view => view.runId);
      const observation = normalizeBehaviourObservation(views, { requests: captures.filter(item => runIds.includes(item.runId)) as BaselineRequest[], tools: tools.filter(item => runIds.includes(item.runId)) });
      observation.runs.forEach((run, index) => {
        const view = views[index]!; run.probe = probes[index];
        run.failurePolicy = id === 'B05' ? 'continue' : id === 'B06' ? platform === 'mastra' && ['disabled', 'unapproved'].includes(probes[index]!) ? 'terminal' : 'continue' : id === 'B08' ? probes[index] === 'tool' ? 'continue' : platform === 'langgraph' && probes[index] === 'malformed' ? 'unknown' : 'terminal' : 'terminal';
        if (approvals.has(run.runId)) run.approvalGranted = true;
        if (id === 'B08') { run.observedFailureKind = probes[index] as 'provider' | 'malformed' | 'tool'; run.nativeFailureKind = view.events.find(event => ['ModelFailed', 'RunReconciliationRequired'].includes(event.kind))?.payload.failureKind as string | undefined; const failedTool = view.events.find(event => event.kind === 'ToolExecutionFailed'); const connectionError = (failedTool?.payload.connection as { errorCode?: string } | undefined)?.errorCode; run.originalErrorCode = probes[index] === 'tool' ? connectionError : view.result?.error?.code; run.expectedErrorCode = probes[index] === 'tool' ? 'HTTP_400' : probes[index] === 'malformed' ? platform === 'langgraph' ? 'LANGGRAPH_OUTCOME_UNKNOWN' : platform === 'mastra' ? 'MASTRA_GENERATION_FAILED' : 'OPENROUTER_INVALID_RESPONSE' : platform === 'langgraph' ? 'LANGGRAPH_PROVIDER_FAILED' : platform === 'mastra' ? 'MASTRA_PROVIDER_FAILURE' : 'OPENROUTER_HTTP_403'; run.expectedAttempts = 1; run.attemptCount = view.events.filter(event => event.kind === 'ModelRequested').length; if (probes[index] === 'tool') run.attemptCount = view.events.filter(event => event.kind === 'ToolExecutionStarted').length; }
        if (deadlineRuns.has(run.runId)) Object.assign(run, { deadlineMs: 200, elapsedMs: elapsed.get(run.runId), deadlineSource: 'native', inFlight: view.events.some(event => /Cancelled/.test(event.kind)) ? 'cancelled' : 'unknown' });
      });
      // Admission filters unapproved profile grants before native tool dispatch. Retain that actual policy reason.
      for (const rejection of observation.rejections ?? []) {
        const view = views.find(value => value.runId === rejection.runId)!;
        const decision = view.manifest.capabilities?.resolution?.decisions.find(value => value.capabilityId === rejection.toolName && value.status === 'approval_required');
        if (decision) { rejection.kind = 'approval'; rejection.reason = `${decision.code}: ${decision.message}; native rejection: ${rejection.reason}`; }
        else if (/UNKNOWN_TOOL/.test(rejection.reason)) rejection.kind = 'disabled';
      }
      Object.assign(observation, extras);
      let grade: ReturnType<typeof suite.gradeBehaviourCase>;
      try { grade = suite.gradeBehaviourCase(id, observation); } catch (cause) { grade = { caseId: id, verdict: 'fail', assertions: [] }; error = `Grader error: ${String(cause)}`; }
      let verdict: RunEvalReport['verdict'] = error ? 'error' : grade.verdict, reportPath: string | null = null;
      if (runIds.length) {
        const report: RunEvalReport = { schemaVersion: 1, suiteVersion: suite.BEHAVIOUR_SUITE_VERSION, graderVersion: suite.BEHAVIOUR_GRADER_VERSION, caseId: id, mode: 'scripted', trialId: `${invocationId}-${trial}`, ownerRunId: runIds[0]!, runIds, verdict, assertions: JSON.parse(JSON.stringify(grade.assertions)), observations: [JSON.parse(JSON.stringify(observation)) as EvalJson, ...(error ? [{ driverError: error }] : [])], metadata: { revision, dirty: true, versions: { ...versions, ...Object.fromEntries(views.flatMap(view => Object.entries(view.executionReference?.native ?? {}).filter(([key, value]) => /version$/i.test(key) && typeof value === 'string').map(([key, value]) => [key, String(value)]))) }, startedAt, completedAt: new Date().toISOString(), trialCount: trials } };
        try { await evidence.writeEvalReport(runIds[0]!, report); reportPath = join(evidence.runDirectory(runIds[0]!), 'artifacts/eval.json'); } catch (cause) { verdict = 'error'; error = `${error ? error + '; ' : ''}Report storage error: ${String(cause)}`; }
      }
      summary.push({ caseId: id, trial, verdict, runIds, evidence: reportPath, ...(error ? { reason: error } : {}) }); await save();
      console.log(`${platform} ${id} trial ${trial}: ${verdict.toUpperCase()}${error ? ` ${error}` : ''}`);
      for (const assertion of grade.assertions.filter(value => !value.passed)) console.log(`  ${assertion.id}: ${JSON.stringify(assertion.observed).slice(0, 512)}`);
      for (const namespace of namespaces) fixture?.resetNamespace(namespace);
      if (actualRunner !== base) await actualRunner.close?.();
    }
    await save(interrupted ? null : new Date().toISOString());
  } finally { await fixture?.close(); await base.close?.(); }
  console.log(`Summary: ${join(summaryDirectory, 'summary.json')}`);
  if (summary.some(item => item.verdict !== 'pass')) process.exitCode = 1;
}

async function observe(service: RunService, initial: RunView, deadlineMs: number, retain: (view: RunView) => void): Promise<RunView> {
  let view = initial; const stop = Date.now() + deadlineMs;
  while (['queued', 'running', 'suspended'].includes(view.status)) {
    if (interrupted) { view = await service.cancelRun(view.runId, 'Eval process interrupted.'); retain(view); throw new Error('Eval interrupted after dispatch; native cancellation requested.'); }
    if (Date.now() >= stop) { view = await service.cancelRun(view.runId, 'Eval observation deadline elapsed.'); retain(view); throw new Error('Driver polling deadline elapsed; this is not evidence of a native deadline.'); }
    await pause(20); view = await service.getRun(view.runId); retain(view);
  }
  return view;
}
