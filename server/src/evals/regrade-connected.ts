import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONNECTED_GRADER_REVISION, matchesFixtureState, sustainedTaskCriteria, type Scenario } from './connected.js';

/** Reassess only retained sustained evidence. Original criteria outside the
 * corrected sustained contract remain gates; this never runs an agent. */
export function assessConnectedStage(input: { stage: Scenario['stages'][number]; record: any; run: any; receipts: any[]; manifest: any; namespace: string; platform: string }) {
  if (input.run.runId !== input.record.runId || input.manifest.runId !== input.record.runId || input.manifest.platform !== input.platform ||
      input.run.manifest?.platform !== input.platform || input.manifest.context?.sessionId !== input.namespace ||
      input.run.manifest?.context?.sessionId !== input.namespace || input.run.manifest?.context?.turnId !== input.manifest.context?.turnId ||
      input.run.executionReference?.platform !== input.platform) throw new Error('Retained run, platform, namespace or turn identity mismatch');
  const criteria = sustainedTaskCriteria(input);
  const { record, run, stage } = input;
  const preservedCriteria: [string, unknown][] | undefined = record.toolCriteria && Object.entries(record.toolCriteria).filter(([key]) => key !== 'sustainedCriteria');
  const passed = ['toolCounts', 'failuresObserved', 'denialVerified', 'approvalVerified', 'retrievalVerified', 'errorObserved'].every(key => record.toolCriteria?.[key] === true) &&
    !!preservedCriteria?.length && preservedCriteria.every(([, value]) => value === true) &&
    run.status === 'completed' && record.nativeStatus === 'completed' && !!record.after && matchesFixtureState(record.after, stage.expected) &&
    !record.abortEvidence && !run.events.some((event: any) => event.kind === 'ToolExecutionUnknown') && Object.values(criteria).every(Boolean);
  return { id: record.id, runId: record.runId, originalVerdict: record.verdict, verdict: passed ? 'pass' : 'fail',
    preservedCriteria: Object.fromEntries(preservedCriteria ?? []), sustainedCriteria: criteria };
}

/** Write exclusively to a new versioned assessment. Every consumed evidence
 * file is hashed so the correction can be reproduced without rewriting history. */
export async function regradeConnected(summaryPath: string) {
  const path = resolve(summaryPath); const directory = dirname(path);
  const hashes: Record<string, string> = {};
  const read = async (file: string) => { const bytes = await readFile(file); hashes[resolve(file)] = createHash('sha256').update(bytes).digest('hex'); return JSON.parse(bytes.toString('utf8')); };
  const original = await read(path); const scenario: Scenario = original.scenario;
  if (original.mode !== 'real-model-controlled-connected' || !scenario?.sustained || !scenario?.stages?.every(stage => stage.collection)) throw new Error('Only retained sustained collection assessments are supported');
  const outcomes = [];
  for (const outcome of original.outcomes) {
    const stages = [];
    for (const record of outcome.stages) {
      const stage = scenario.stages.find(stage => stage.id === record.id);
      if (!stage || !record.after || !record.toolCriteria) {
        stages.push({ id: record.id, runId: record.runId, originalVerdict: record.verdict, verdict: 'fail', reason: 'Incomplete retained assessment' }); continue;
      }
      try {
        const run = await read(join(directory, `${outcome.platform}-${record.id}.json`));
        const runRoot = join(directory, '..', '..', record.runId);
        const manifest = await read(join(runRoot, 'config.json'));
        const receiptRoot = join(runRoot, 'artifacts', 'capability-calls');
        const receipts = await Promise.all((await readdir(receiptRoot)).filter(name => name.endsWith('.json')).sort().map(name => read(join(receiptRoot, name))));
        stages.push(assessConnectedStage({ stage, record, run, receipts, manifest, namespace: outcome.namespace, platform: outcome.platform }));
      } catch (error) {
        stages.push({ id: record.id, runId: record.runId, originalVerdict: record.verdict, verdict: 'fail', reason: error instanceof Error ? error.message : 'Retained evidence unavailable' });
      }
    }
    outcomes.push({ platform: outcome.platform, namespace: outcome.namespace, originalVerdict: outcome.verdict,
      verdict: stages.length === scenario.stages.length && stages.every(stage => stage.verdict === 'pass') ? 'pass' : 'fail', stages });
  }
  const codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const graderCodeHashes: Record<string, string> = {};
  const suffix = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  for (const name of ['regrade-connected', 'connected', 'connected-verification']) {
    const url = new URL(`./${name}.${suffix}`, import.meta.url);
    graderCodeHashes[name] = createHash('sha256').update(await readFile(url)).digest('hex');
  }
  const assessment = { schemaVersion: 1, graderRevision: CONNECTED_GRADER_REVISION, codeRevision, graderCodeHashes, assessedAt: new Date().toISOString(),
    correction: 'Exact complete collection receipts count as same-target post-action verification; temporal and receipt requirements remain unchanged.',
    originalReport: path, sourceRevision: original.sourceRevision, originalCriteriaPolicy: 'Non-sustained criteria are retained original gates, not independently recomputed; source hashes bind those values.', sourceInputHashes: hashes, outcomes };
  const destination = join(directory, `assessment-grader-v${CONNECTED_GRADER_REVISION}-${codeRevision.slice(0, 12)}.json`);
  await writeFile(destination, JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx' });
  return { destination, assessment };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length !== 1) throw new Error('Usage: eval:regrade-connected /absolute/path/to/retained/summary.json');
  regradeConnected(args[0]!).then(({ destination, assessment }) => {
    console.info(destination); if (assessment.outcomes.some(outcome => outcome.verdict !== 'pass')) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
