import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadLocalServerEnvironment } from "../control-plane/bootstrap/local-env.js";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import type { CapabilityProfileView } from "../capabilities/catalog.js";
import type { InvocationReviewView } from "../capabilities/reviews/contracts.js";
import type { RunView } from "../control-plane/application/run-service.js";
import { capabilityWorkspaceRoot } from "../capabilities/extensions/runtime.js";
import { validateCapabilityRouting } from "./capability-evidence.js";
import { installedRuntimeVersions } from "./runtime-versions.js";
import { COMPARISON_FREE_MODEL, assertFreeModelCatalog, getFreeEvalSettings } from "../models/openrouter/free-model-policy.js";

/** Acceptance driver only: the selected native platform owns model and tool steps.
 * It submits the same fictional task and correction, then inspects real artifacts.
 * This is a bounded integration observation, not a model-quality benchmark.
 */
async function main() {
  const args = process.argv.slice(2).filter(value => value !== "--");
  // Reinspect retained dispatch bodies without calling a model or replacing evidence.
  if (args.length === 2 && args[0] === "--review-routing") {
    const path = resolve(args[1]);
    const report = JSON.parse(await readFile(path, "utf8"));
    if (report.mode !== "capability-acceptance" || !Array.isArray(report.outcomes)) throw new Error("Select a retained capability acceptance summary.json.");
    const runsRoot = resolve(dirname(path), "../..");
    const outcomes = [];
    for (const outcome of report.outcomes) {
      if (!Array.isArray(outcome.runIds) || outcome.runIds.some((id: unknown) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))) throw new Error("Invalid retained run identity.");
      const runs = await Promise.all(outcome.runIds.map(async (id: string) => ({events: (await readFile(join(runsRoot, id, "events.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line))})));
      outcomes.push({platform: outcome.platform, task: outcome.task, originalVerdict: outcome.verdict, routingValid: validateCapabilityRouting(runs, report.controls.model.id, report.controls.experimentId)});
    }
    const reviewPath = join(dirname(path), "routing-review.json");
    await writeFile(reviewPath, JSON.stringify({schemaVersion: 1, mode: "capability-routing-review", originalReport: path, reviewedAt: new Date().toISOString(), graderRevision: execFileSync("git", ["rev-parse", "HEAD"], {cwd: capabilityWorkspaceRoot(), encoding: "utf8"}).trim(), outcomes}, null, 2) + "\n");
    console.log(`Routing review: ${reviewPath}`);
    return;
  }
  loadLocalServerEnvironment();
  let api = "http://127.0.0.1:4318", platforms = ["mastra", "langgraph", "temporal", "restate"], tasks = ["workspace", "service"], model = COMPARISON_FREE_MODEL, deadlineMs = 180000;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === "--api" && value) api = value;
    else if (args[i] === "--platforms" && value) platforms = value.split(",");
    else if (args[i] === "--model" && value) model = value;
    else if (args[i] === "--tasks" && value) tasks = value.split(",");
    else if (args[i] === "--deadline-ms" && /^\d+$/.test(value ?? "")) deadlineMs = Number(value);
    else throw new Error("Usage: eval:capabilities [--api http://127.0.0.1:4318] [--platforms mastra,langgraph,temporal,restate] [--tasks workspace,service,support] [--model exact-approved-id:free] [--deadline-ms 180000]");
  }
  if (!platforms.length || new Set(platforms).size !== platforms.length || platforms.some(value => !["mastra", "langgraph", "temporal", "restate"].includes(value))) throw new Error("Select distinct supported native platforms.");
  if (!tasks.length || new Set(tasks).size !== tasks.length || tasks.some(value => !["workspace", "service", "support"].includes(value))) throw new Error("Select distinct supported tasks.");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 600000) throw new Error("Observation deadline must be 1000–600000ms.");
  const versions = await installedRuntimeVersions();
  const root = capabilityWorkspaceRoot(), config = loadServerConfig(process.env, root);
  const catalog = await fetch(`${config.openRouter.baseUrl.replace(/\/$/, "")}/models`, {signal: AbortSignal.timeout(config.openRouter.catalogTimeoutMs)});
  if (!catalog.ok) throw new Error(`Free model catalog unavailable: HTTP ${catalog.status}.`);
  const checkedModel = assertFreeModelCatalog(await catalog.json(), model);
  const profiles = await request<{profiles: CapabilityProfileView[]}>("/api/capabilities");
  // Validate the entire requested suite before admitting its first model run.
  // An absent optional provider must not leave a misleading partial trial.
  for (const task of tasks) {
    if (!profiles.profiles.some(profile => profile.id === `${task}-agent` && profile.available)) {
      throw new Error(`Configure the ${task}-agent package profile before acceptance.`);
    }
  }
  const invocationId = `capabilities-${randomUUID()}`, directory = join(config.runsRoot, ".evals", invocationId);
  await mkdir(directory, {recursive: true});
  const outcomes: unknown[] = [];
  const startedAt = new Date().toISOString();
  let completedAt: string | null = null;
  const experimentId = "agent-capabilities-live";
  const controls = {platforms, tasks, model: checkedModel, freeOnly: true, maxOutputTokens: getFreeEvalSettings(experimentId)!.maxOutputTokens, experimentId, maxRounds: 24, maxCalls: 32, deadlineMs, reviewPolicy: {mode: "local-fixture-only", permittedTool: "support_adjust", amountCents: 500, reason: "late_delivery", productionAuthorization: false}, sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8"}).trim()};
  const workspacePrompts = [
    "Use the available skills to complete the task in brief.md. Discover and load the evidence-report skill and its referenced report-format resource. Inspect the workspace documents, resolve the latest approved Cedar launch date against the older proposal, and write artifacts/cedar-report.md with the dependency, next action and file/line citations. Read the saved report to verify it. Work autonomously with the approved workspace tools.",
    "Revise the saved artifacts/cedar-report.md in this same workspace: add the exact heading 'Immediate action' and explicitly state that a documentation owner must be assigned. Keep the approved launch date and citations. Read the current file first, use its current digest for the edit, and read the saved revision to verify it.",
  ];
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  async function save() { await writeFile(join(directory, "summary.json"), JSON.stringify({schemaVersion: 1, mode: "capability-acceptance", invocationId, startedAt, completedAt, status: completedAt ? "completed" : "incomplete", controls, versions, workspacePrompts, outcomes}, null, 2) + "\n"); }
  await save();
  for (const platform of platforms) for (const task of tasks) {
    if (interrupted) break;
    const profile = profiles.profiles.find(value => value.id === `${task}-agent` && value.available);
    if (!profile) throw new Error(`Configure the ${task}-agent package profile before acceptance.`);
    const sessionId = `cap-${task}-${platform}-${randomUUID()}`, runs: RunView[] = [];
    const reviews: { request: InvocationReviewView; before: unknown; decision: "approved" }[] = [];
    const serviceSnapshots: unknown[] = []; let error: string | undefined;
    const prompts = task === "workspace" ? workspacePrompts : task === "support" ? [
      `Use the customer-support skill. In namespace ${sessionId}, inspect Avery's customer eligibility, order-cedar and the late-delivery adjustment policy using MCP. The customer requests exactly 500 cents as a late_delivery adjustment. If policy permits, propose that exact adjustment with the current order revision using support_adjust. Await the platform review before applying it. Read the saved order afterward and report the verified amount and revision. Do not apply the policy maximum unless it is the requested amount.`,
    ] : [
      `Use the release-coordination skill to assign Morgan as documentation owner for Cedar in namespace ${sessionId}. Read the current record through MCP, assign the owner through the approved API tool with the current revision and status in_progress, then read through MCP again to verify the saved state. Preserve the approved date and dependency; the launch remains blocked by incomplete documentation.`,
      `Correction: in namespace ${sessionId}, the documentation owner must be Avery. Read the current revision, update the saved owner using the API tool, then verify the record through MCP again. Preserve the approved date and dependency.`,
    ];
    try {
      for (let turn = 0; turn < prompts.length; turn++) {
        const now = Date.now();
        const run = await request<RunView>("/api/runs", {method: "POST", body: JSON.stringify({platform, variant: "baseline", sessionId, clientTurnId: `capability-turn-${turn + 1}`, task: {kind: "prompt", prompt: prompts[turn]}, model: {provider: "openrouter", model}, selection: {scenarioId: `${task}-capabilities`, experimentId}, capabilities: {profileId: profile.id, tools: {enabledNames: [], maxRounds: controls.maxRounds, maxCalls: controls.maxCalls}, approvals: profile.capabilities.filter(value => ["write", "external"].includes(value.risk) && value.approvalMode !== "invocation" && value.approvalMode !== "automatic").map(value => ({schemaVersion: 1, decisionId: `approval_${randomUUID()}`, capabilityId: value.id, version: value.version, allowedOperations: value.operations, ...(value.connectionRef ? { connectionRef: value.connectionRef } : {}), decision: "approved", decidedAt: new Date(now).toISOString(), expiresAt: new Date(now + 360000).toISOString()}))}})});
        runs.push(run); const deadline = now + controls.deadlineMs;
        while (["queued", "running", "suspended"].includes(runs.at(-1)!.status)) {
          if (Date.now() >= deadline || interrupted) { runs[runs.length - 1] = await request<RunView>(`/api/runs/${run.runId}/cancel`, {method: "POST", body: JSON.stringify({reason: "Capability acceptance observation interrupted."})}); throw new Error("Observation interrupted; inspect the native evidence."); }
          if (task === "support" && runs.at(-1)!.status === "suspended") {
            const proposals = await request<{actions: InvocationReviewView[]}>(`/api/runs/${run.runId}/actions`);
            for (const proposal of proposals.actions.filter(action => action.status === "pending")) {
              // Explicit local acceptance policy, never production authorization.
              // The driver reviews the model's proposal; it never chooses its calls.
              const argumentsValue = proposal.displayArguments;
              const before = await supportSnapshot(sessionId);
              if (proposal.call.name !== "support_adjust" || argumentsValue.namespace !== sessionId || argumentsValue.orderId !== "order-cedar" || argumentsValue.amountCents !== 500 || argumentsValue.reason !== "late_delivery" || argumentsValue.expectedRevision !== 1 || before.adjustmentCents !== 0 || before.revision !== 1) {
                await request<RunView>(`/api/runs/${run.runId}/actions/${proposal.requestId}/decision`, {method: "POST", body: JSON.stringify({requestId: proposal.requestId, revision: proposal.revision, argumentDigest: proposal.argumentDigest, decisionId: `trial-deny-${randomUUID()}`, decision: "denied", reason: "Outside the explicit fictional acceptance policy."})});
                throw new Error("The model proposed an action outside the trial policy; it was denied without effects.");
              }
              reviews.push({ request: proposal, before, decision: "approved" });
              runs[runs.length - 1] = await request<RunView>(`/api/runs/${run.runId}/actions/${proposal.requestId}/decision`, {method: "POST", body: JSON.stringify({requestId: proposal.requestId, revision: proposal.revision, argumentDigest: proposal.argumentDigest, decisionId: `trial-approve-${randomUUID()}`, decision: "approved", reason: "Explicit local acceptance policy: fictional 500-cent adjustment."})});
            }
          }
          await new Promise(resolve => setTimeout(resolve, 250));
          runs[runs.length - 1] = await request<RunView>(`/api/runs/${run.runId}`);
        }
        console.log(`${platform} ${task} turn ${turn + 1}: ${runs.at(-1)!.status} ${run.runId}`);
        if (task === "support") serviceSnapshots.push(await supportSnapshot(sessionId));
        if (task === "service") {
          const response = await fetch(`http://127.0.0.1:9196/records?namespace=${encodeURIComponent(sessionId)}&key=cedar`, {signal: AbortSignal.timeout(5000)});
          if (!response.ok) throw new Error("Controlled service verification failed.");
          serviceSnapshots.push(await response.json());
        }
        if (runs.at(-1)!.status !== "completed") throw new Error(runs.at(-1)!.result?.error?.message ?? "Native run did not complete.");
      }
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    let artifact: string | null = null;
    // This driver targets the shipped isolated example only; alternate sources
    // need their own outcome inspection rather than claiming a missing file passed.
    try { artifact = await readFile(join(config.runsRoot, ".document-provider", sessionId, "artifacts/cedar-report.md"), "utf8"); } catch { /* recorded below */ }
    const toolEvidence = await Promise.all(runs.map(value => inspectToolEvidence(config.runsRoot, value.runId)));
    const initial = toolEvidence[0]?.calls ?? [], corrected = toolEvidence[1]?.calls ?? [];
    const successful = (calls: ObservedCall[], operation: string) => calls.filter(call => call.status === "completed" && call.name.endsWith(`_${operation}`));
    const edits = [...successful(corrected, "write_file"), ...successful(corrected, "patch_file")].filter(call => call.path === "artifacts/cedar-report.md");
    const correctionReads = successful(corrected, "read_file").filter(call => call.path === "artifacts/cedar-report.md");
    const firstEdit = Math.min(...edits.map(call => call.sequence ?? Infinity)), lastEdit = Math.max(...edits.map(call => call.sequence ?? -Infinity));
    const workspaceAssertions = {
      twoCompletedTurns: runs.length === 2 && runs.every(value => value.status === "completed"),
      retainedToolEvidence: toolEvidence.length === 2 && toolEvidence.every(value => value.error === null),
      procedureLoaded: successful(initial, "load_skill").some(call => call.skill === "evidence-report"),
      referenceRead: successful(initial, "read_skill_resource").some(call => call.skill === "evidence-report" && call.path === "references/report-format.md"),
      workspaceRead: successful(initial, "read_file").some(call => call.path !== "artifacts/cedar-report.md"),
      reportWritten: successful(initial, "write_file").some(call => call.path === "artifacts/cedar-report.md"),
      initialArtifactVerified: successful(initial, "read_file").some(call => call.path === "artifacts/cedar-report.md"),
      correctionReadBeforeEdit: Number.isFinite(firstEdit) && correctionReads.some(call => call.sequence !== null && call.sequence < firstEdit),
      correctionArtifactVerified: Number.isFinite(lastEdit) && correctionReads.some(call => call.sequence !== null && call.sequence > lastEdit),
      savedArtifact: artifact !== null, approvedDate: artifact?.includes("2026-10-22") ?? false,
      dependency: /integration documentation/i.test(artifact ?? ""), correction: artifact?.includes("Immediate action") ?? false,
      assignedOwner: /(?:assign\w*[^.\n]{0,100}documentation owner|documentation owner[^.\n]{0,100}assign)/i.test(artifact ?? ""),
      evidence: /release-status\.md/.test(artifact ?? ""),
    };
    const serviceEditVerified = (calls: ObservedCall[]) => {
      const edit = calls.find(call => call.status === "completed" && call.name === "release_assign");
      return edit?.sequence !== null && edit !== undefined && calls.some(call => call.name === "release_lookup" && call.status === "completed" && call.sequence !== null && call.sequence < edit.sequence!) && calls.some(call => call.name === "release_lookup" && call.status === "completed" && call.sequence !== null && call.sequence > edit.sequence!);
    };
    const records = serviceSnapshots as { owner?: string; revision?: number; approvedDate?: string; status?: string; dependency?: string }[];
    const assertions = task === "workspace" ? workspaceAssertions : task === "support" ? {
      completed: runs.length === 1 && runs[0].status === "completed",
      retainedToolEvidence: toolEvidence.length === 1 && toolEvidence[0].error === null,
      skillLoaded: successful(initial, "load_skill").some(call => call.skill === "customer-support"),
      businessInputsReadBeforeWrite: (() => { const edit = initial.find(call => call.name === "support_adjust" && call.status === "completed"); return edit !== undefined && edit.sequence !== null && ["support_customer", "support_order", "support_policy"].every(name => initial.some(call => call.name === name && call.status === "completed" && call.sequence !== null && call.sequence < edit.sequence!)); })(),
      exactActionReviewed: reviews.length === 1 && reviews[0].request.call.name === "support_adjust",
      noEffectBeforeReview: reviews.length === 1 && (reviews[0].before as {adjustmentCents?: number}).adjustmentCents === 0,
      verifiedAfterWrite: (() => {const edit = initial.find(call => call.name === "support_adjust" && call.status === "completed"); return edit !== undefined && edit.sequence !== null && initial.some(call => call.name === "support_order" && call.status === "completed" && call.sequence !== null && call.sequence > edit.sequence!);})(),
      independentlySaved: serviceSnapshots.length === 1 && (serviceSnapshots[0] as {adjustmentCents?: number; revision?: number; adjustments?: unknown[]}).adjustmentCents === 500 && (serviceSnapshots[0] as {revision?: number}).revision === 2 && (serviceSnapshots[0] as {adjustments?: unknown[]}).adjustments?.length === 1,
    } : {
      twoCompletedTurns: workspaceAssertions.twoCompletedTurns,
      retainedToolEvidence: workspaceAssertions.retainedToolEvidence,
      procedureLoaded: successful(initial, "load_skill").some(call => call.skill === "release-coordination"),
      initialEditVerified: serviceEditVerified(initial), correctionVerified: serviceEditVerified(corrected),
      assignedOwner: records[0]?.owner === "Morgan" && records[0]?.revision === 2,
      correctedOwner: records[1]?.owner === "Avery" && records[1]?.revision === 3,
      preservedFacts: records.length === 2 && records.every(record => record.approvedDate === "2026-10-22" && record.status === "in_progress" && record.dependency === "Integration documentation incomplete"),
    };
    const routingValid = validateCapabilityRouting(runs, model, experimentId);
    const outcome = {platform, task, profileId: profile.id, prompts, sessionId, runIds: runs.map(value => value.runId), statuses: runs.map(value => value.status), nativeConfigurations: runs.map(value => ({runId: value.runId, platformConfig: value.manifest.platformConfig, executionReference: value.executionReference})), assertions: {...assertions, routingValid}, toolEvidence, verdict: error ? "error" : routingValid && Object.values(assertions).every(Boolean) ? "pass" : "fail", ...(error ? {error} : {}), artifact, serviceSnapshots, reviews};
    outcomes.push(outcome); await save(); console.log(`${platform} ${task}: ${outcome.verdict}`);
    if (outcome.verdict !== "pass") process.exitCode = 1;
  }
  if (!interrupted && outcomes.length === platforms.length * tasks.length) completedAt = new Date().toISOString();
  await save();
  console.log(`Acceptance evidence: ${join(directory, "summary.json")}`);
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  async function supportSnapshot(namespace: string): Promise<{adjustmentCents: number; revision: number}> {
    const response = await fetch(`http://127.0.0.1:9196/support/order?namespace=${encodeURIComponent(namespace)}`, {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error("Independent support state verification failed.");
    return response.json() as Promise<{adjustmentCents: number; revision: number}>;
  }
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, api), {...options, headers: {"content-type": "application/json"}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

interface ObservedCall { callId: string; name: string; status: string; path: string | null; skill: string | null; sequence: number | null }
async function inspectToolEvidence(runsRoot: string, runId: string): Promise<{ runId: string; calls: ObservedCall[]; error: string | null }> {
  const calls: ObservedCall[] = [];
  try {
    const directory = join(runsRoot, runId, "artifacts/capability-calls");
    const events = (await readFile(join(runsRoot, runId, "events.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
    for (const name of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const receipt = JSON.parse(await readFile(join(directory, name), "utf8"));
      let content: Record<string, unknown> = {};
      try { content = JSON.parse(receipt.result?.content ?? "{}"); if (content.structuredContent && typeof content.structuredContent === "object") content = content.structuredContent as Record<string, unknown>; } catch { /* Non-JSON tool results have no artifact path. */ }
      const event = events.find(event => event.kind === "ToolExecutionCompleted" && event.payload?.toolCallId === receipt.toolCallId);
      calls.push({ callId: receipt.toolCallId, name: receipt.toolName, status: receipt.status === "complete" ? receipt.result?.status ?? "unknown" : "unknown", path: typeof content?.path === "string" ? content.path : null, skill: typeof content?.name === "string" ? content.name : null, sequence: typeof event?.recordedSequence === "number" ? event.recordedSequence : null });
    }
    calls.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
    return { runId, calls, error: null };
  } catch (error) { return { runId, calls, error: error instanceof Error ? error.message : "Tool evidence unavailable." }; }
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); process.exitCode = 1;});
