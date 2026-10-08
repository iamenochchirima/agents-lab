import { readExtensionEvidence } from "./eval-extension-evidence.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capabilityWorkspaceRoot } from "../../capabilities/extensions/runtime.js";
const { COVERAGE_VERSION, COVERAGE_PLATFORMS, coverageRequirements } = await import(pathToFileURL(join(capabilityWorkspaceRoot(), "lab/experiments/agent-harness-baseline/coverage.mjs")).href) as typeof import("../../../../lab/experiments/agent-harness-baseline/coverage.mjs");
import { readEvalResults, type EvalResultInvocation } from "./eval-results.js";

/** Coverage links requirements to original observations, never substitutes a score.
 * Scan limits and absent variant identity are visible; old passes are not current readiness.
 */
export function projectEvalCoverage(invocations: readonly EvalResultInvocation[], scanTruncated = false) {
  return { schemaVersion: 1, coverageVersion: COVERAGE_VERSION, scanTruncated, observedAt: new Date().toISOString(), cells: COVERAGE_PLATFORMS.flatMap(platform => coverageRequirements.map(requirement => {
    const matching = invocations.filter(invocation => invocation.platform === platform && invocation.variant === "baseline" && invocation.mode === requirement.mode && invocation.status === "complete").flatMap(invocation => invocation.cases.filter(item => requirement.cases.includes(item.caseId)).map(item => ({ invocation, item }))).sort((a, b) => Date.parse(b.invocation.completedAt ?? b.invocation.startedAt) - Date.parse(a.invocation.completedAt ?? a.invocation.startedAt));
    const latest = matching[0];
    const applicable = !requirement.applicablePlatforms || requirement.applicablePlatforms.includes(platform);
    return { platform, variant: "baseline", requirementId: requirement.id, group: requirement.group, implementation: applicable ? requirement.implementation : "not-applicable", boundary: requirement.boundary,
      measurement: !applicable || requirement.implementation === "not-applicable" ? "not-applicable" : latest ? latest.item.reviewRequired ? "review-required" : latest.item.verdict : "not-exercised",
      ...(latest ? { evidence: { invocationId: latest.invocation.invocationId, caseId: latest.item.caseId, trial: latest.item.trial, originalVerdict: latest.item.verdict, suiteVersion: latest.invocation.suiteVersion, graderVersion: latest.invocation.graderVersion, completedAt: latest.invocation.completedAt, modelId: latest.invocation.modelId } } : {}),
    };
  })) };
}

export async function readEvalCoverage(runsRoot: string, secrets: readonly string[] = []) {
  const results = await readEvalResults(runsRoot, 50, secrets);
  const extensions = await readExtensionEvidence(runsRoot, secrets);
  const coverage = projectEvalCoverage(results.invocations, results.scanTruncated || extensions.scanTruncated);
  return { ...coverage, issues: extensions.issues, cells: coverage.cells.map(cell => {
    if (cell.group !== "X" || cell.implementation === "not-applicable") return cell;
    const proof = extensions.envelopes.flatMap(envelope => envelope.reports.filter(report => report.platform === cell.platform && report.variant === cell.variant && report.caseId === cell.requirementId).map(report => ({envelope, report})))[0];
    return proof ? { ...cell, measurement: proof.report.verdict, extensionEvidence: { invocationId: proof.envelope.invocationId, completedAt: proof.envelope.completedAt, revision: proof.envelope.revision, report: proof.report } } : cell;
  }) };

}
