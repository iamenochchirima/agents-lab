import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import { loadLocalServerEnvironment } from "../control-plane/bootstrap/local-env.js";
import { RunEvidenceStore } from "../control-plane/application/evidence-store.js";
import { createDefaultCapabilityCatalog } from "../capabilities/catalog.js";
import type { EvalJson, RunEvalReport } from "../control-plane/domain/eval-report.js";
import type { LiveCaseId, LiveObservation } from "../../../lab/scenarios/platform-agent-conformance/live-evals.mjs";

const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ceiling = 256 * 1024;
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
async function workspace(): Promise<string> {
  let root = process.cwd();
  while (true) { try { await access(join(root, "pnpm-workspace.yaml")); return root; } catch { /* ascend */ } if (dirname(root) === root) throw new Error("Run regrading in the Lab workspace."); root = dirname(root); }
}
/** Read one fixed summary location without following linked files or directories. */
async function summary(runsRoot: string, invocation: string): Promise<Record<string, any>> {
  if (!safeId.test(invocation)) throw new Error("Invalid source invocation ID.");
  for (const directory of [join(runsRoot, ".evals"), join(runsRoot, ".evals", invocation)]) { const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe source summary directory."); }
  const path = join(runsRoot, ".evals", invocation, "summary.json"), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > ceiling) throw new Error("Unsafe or oversized source summary.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(ceiling + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > ceiling) throw new Error("Source summary exceeds the read limit.");
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    if (!object(value) || value.schemaVersion !== 1 || value.invocationId !== invocation || value.mode !== "live" || !value.completedAt || !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 100) throw new Error("Source must be one complete retained live invocation.");
    return value;
  } finally { await handle.close(); }
}

/** Reuse immutable execution evidence. This command never creates or dispatches an agent run. */
async function main() {
  const args = process.argv.slice(2).filter(value => value !== "--");
  if (args.length !== 2 || args[0] !== "--invocation" || !safeId.test(args[1])) throw new Error("Usage: eval:regrade-live -- --invocation retained-live-invocation-id");
  const root = await workspace(); loadLocalServerEnvironment();
  const config = loadServerConfig(process.env, root), source = await summary(config.runsRoot, args[1]);
  const suite = await import(pathToFileURL(join(root, "lab/scenarios/platform-agent-conformance/live-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/live-evals.mjs");
  if (suite.LIVE_GRADER_VERSION !== "3") throw new Error("Only the bounded grader-3 revision is supported.");
  const evidence = new RunEvidenceStore(config.runsRoot), capabilities = createDefaultCapabilityCatalog();
  const invocationId = `regrade-${randomUUID()}`, startedAt = new Date().toISOString();
  const directory = join(config.runsRoot, ".evals", invocationId); await mkdir(directory, { recursive: true });
  const cases: Record<string, any>[] = [], counts = { pass: 0, fail: 0, blocked: 0, error: 0 };
  async function save(completedAt: string | null) {
    const value = { schemaVersion: 1, mode: "live", invocationId, sourceInvocationId: source.invocationId, graderVersion: suite.LIVE_GRADER_VERSION,
      suiteVersion: source.suiteVersion, platform: source.platform, variant: source.variant, model: source.model,
      startedAt, completedAt, trials: source.trials, comparisonControls: source.comparisonControls,
      controls: { ...source.controls, regradeOnly: true }, counts, cases };
    const text = JSON.stringify(value, null, 2) + "\n"; if (Buffer.byteLength(text) > ceiling) throw new Error("Derived summary exceeds the storage limit.");
    await writeFile(join(directory, "summary.pending"), text); await rename(join(directory, "summary.pending"), join(directory, "summary.json"));
  }
  await save(null);
  for (const item of source.cases) {
    if (!object(item) || !suite.LIVE_CASES.some(fixture => fixture.id === item.caseId) || !Number.isInteger(item.trial) || !Array.isArray(item.runIds) || item.runIds.length > 16 || item.runIds.some((id: unknown) => typeof id !== "string" || !safeId.test(id))) throw new Error("Invalid source case identity.");
    if (item.runIds.length === 0 || !item.evidence) { cases.push({ caseId: item.caseId, trial: item.trial, runIds: item.runIds, verdict: "blocked", evidence: null, reason: item.reason ?? "The source trial has no report to regrade." }); counts.blocked++; await save(null); continue; }
    const report = await evidence.readEvalReport(item.runIds[0]);
    if (!report || report.mode !== "live" || report.caseId !== item.caseId || JSON.stringify(report.runIds) !== JSON.stringify(item.runIds)) throw new Error("Source case and immutable report do not agree.");
    const observation = structuredClone(report.observations[0]) as unknown as LiveObservation;
    if (!object(observation) || !Array.isArray(observation.runs) || !Array.isArray(observation.requests) || !Array.isArray(observation.tools) || JSON.stringify(observation.runs.map(run => run.runId)) !== JSON.stringify(report.runIds)) throw new Error("Source report has unsupported live observations.");
    for (const run of observation.runs) {
      const manifest = await evidence.readManifest(run.runId);
      run.declaredSkills = (manifest.capabilities?.skills ?? []).map(skill => ({ id: skill.id, version: skill.version, digest: skill.digest }));
      run.skillContexts = manifest.capabilities?.profileId ? capabilities.resolve(manifest.capabilities.profileId).skills.map(skill => ({ skillId: skill.context.skillId, skillVersion: skill.context.skillVersion, digest: skill.context.digest, content: skill.context.content })) : [];
      if (run.declaredSkills.length !== run.skillContexts.length || run.declaredSkills.some((skill, index) => skill.id !== run.skillContexts![index].skillId || skill.version !== run.skillContexts![index].skillVersion || skill.digest !== run.skillContexts![index].digest)) throw new Error("Allowlisted skill content no longer matches the immutable execution digest.");
    }
    const fixture = report.observations.find(value => object(value) && object((value as Record<string, unknown>).fixture)) as unknown as { fixture: Parameters<typeof suite.gradeLiveCase>[2] } | undefined;
    const grade = suite.gradeLiveCase(item.caseId as LiveCaseId, observation, fixture?.fixture);
    const verdict = item.verdict === "error" ? "error" : grade.verdict;
    const revised: RunEvalReport = { ...report, graderVersion: suite.LIVE_GRADER_VERSION, trialId: `${invocationId}-${item.trial}-${item.caseId}`, verdict,
      reviewRequired: Boolean(grade.reviewRequired && verdict === "blocked"), assertions: grade.assertions.map(assertion => ({ ...assertion, expected: assertion.expected as EvalJson, observed: assertion.observed as EvalJson })),
      observations: [JSON.parse(JSON.stringify(observation)), ...report.observations.slice(1), { regrade: { sourceInvocationId: source.invocationId, originalGraderVersion: report.graderVersion, evaluatedAt: new Date().toISOString(), modelDispatchCount: 0 } }],
      metadata: { ...report.metadata, environment: { original: report.metadata.environment ?? null, regradeOnly: true, sourceInvocationId: source.invocationId } } };
    const existingRevision = await evidence.readEvalReport(report.ownerRunId, "artifacts/eval-grader-3.json");
    if (existingRevision) {
      if (existingRevision.verdict !== revised.verdict || JSON.stringify(existingRevision.assertions) !== JSON.stringify(revised.assertions)) throw new Error("The immutable grader-3 revision disagrees with current grading; version the grader before revising again.");
    } else await evidence.writeEvalReport(report.ownerRunId, revised, { graderRevision: true });
    const reason = verdict === "error" ? item.reason : grade.reviewRequired ? fixture?.fixture?.reviewRubric : grade.assertions.filter(assertion => !assertion.passed).map(assertion => assertion.id).join(", ");
    cases.push({ caseId: item.caseId, trial: item.trial, verdict, runIds: report.runIds, evidence: "artifacts/eval-grader-3.json", ...(grade.reviewRequired && verdict === "blocked" ? { reviewRequired: true } : {}), ...(reason ? { reason } : {}) }); counts[verdict]++; await save(null);
    console.log(`${item.caseId} trial ${item.trial}: ${verdict.toUpperCase()} (regraded existing evidence)`);
  }
  await save(new Date().toISOString()); console.log(`Summary: ${join(directory, "summary.json")}`);
  if (cases.some(item => item.verdict === "fail" || item.verdict === "error")) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live regrading failed."); process.exitCode = 1; });
