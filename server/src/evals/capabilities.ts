import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalServerEnvironment } from "../control-plane/bootstrap/local-env.js";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import type { CapabilityProfileView } from "../capabilities/catalog.js";
import type { RunView } from "../control-plane/application/run-service.js";
import { capabilityWorkspaceRoot } from "../capabilities/extensions/runtime.js";
import { COMPARISON_FREE_MODEL, assertFreeModelCatalog, assertFreeModelRequest, getFreeEvalSettings } from "../models/openrouter/free-model-policy.js";

/** Acceptance driver only: the selected native platform owns model and tool steps.
 * It submits the same fictional task and correction, then inspects real artifacts.
 * This is a bounded integration observation, not a model-quality benchmark.
 */
async function main() {
  loadLocalServerEnvironment();
  const args = process.argv.slice(2).filter(value => value !== "--");
  let api = "http://127.0.0.1:4318", platforms = ["mastra", "langgraph", "temporal", "restate"], tasks = ["workspace", "service"], model = COMPARISON_FREE_MODEL;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === "--api" && value) api = value;
    else if (args[i] === "--platforms" && value) platforms = value.split(",");
    else if (args[i] === "--model" && value) model = value;
    else if (args[i] === "--tasks" && value) tasks = value.split(",");
    else throw new Error("Usage: eval:capabilities [--api http://127.0.0.1:4318] [--platforms mastra,langgraph,temporal,restate] [--tasks workspace,service] [--model exact-approved-id:free]");
  }
  if (!platforms.length || new Set(platforms).size !== platforms.length || platforms.some(value => !["mastra", "langgraph", "temporal", "restate"].includes(value))) throw new Error("Select distinct supported native platforms.");
  if (!tasks.length || new Set(tasks).size !== tasks.length || tasks.some(value => !["workspace", "service"].includes(value))) throw new Error("Select distinct supported tasks.");
  const root = capabilityWorkspaceRoot(), config = loadServerConfig(process.env, root);
  const catalog = await fetch(`${config.openRouter.baseUrl.replace(/\/$/, "")}/models`, {signal: AbortSignal.timeout(config.openRouter.catalogTimeoutMs)});
  if (!catalog.ok) throw new Error(`Free model catalog unavailable: HTTP ${catalog.status}.`);
  const checkedModel = assertFreeModelCatalog(await catalog.json(), model);
  const profiles = await request<{profiles: CapabilityProfileView[]}>("/api/capabilities");
  const invocationId = `capabilities-${randomUUID()}`, directory = join(config.runsRoot, ".evals", invocationId);
  await mkdir(directory, {recursive: true});
  const outcomes: unknown[] = [];
  const experimentId = "agent-capabilities-live";
  const controls = {model: checkedModel, freeOnly: true, maxOutputTokens: getFreeEvalSettings(experimentId)!.maxOutputTokens, experimentId, maxRounds: 24, maxCalls: 32, deadlineMs: 180000, sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], {cwd: root, encoding: "utf8"}).trim()};
  const workspacePrompts = [
    "Use the available skills to complete the task in brief.md. Discover and load the evidence-report skill and its referenced report-format resource. Inspect the workspace documents, resolve the latest approved Cedar launch date against the older proposal, and write artifacts/cedar-report.md with the dependency, next action and file/line citations. Read the saved report to verify it. Work autonomously with the approved workspace tools.",
    "Revise the saved artifacts/cedar-report.md in this same workspace: add the exact heading 'Immediate action' and explicitly state that a documentation owner must be assigned. Keep the approved launch date and citations. Read the current file first, use its current digest for the edit, and read the saved revision to verify it.",
  ];
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  async function save() { await writeFile(join(directory, "summary.json"), JSON.stringify({schemaVersion: 1, mode: "capability-acceptance", invocationId, controls, workspacePrompts, outcomes}, null, 2) + "\n"); }
  await save();
  for (const platform of platforms) for (const task of tasks) {
    if (interrupted) break;
    const profile = profiles.profiles.find(value => value.id === `${task}-agent` && value.available);
    if (!profile) throw new Error(`Configure the ${task}-agent package profile before acceptance.`);
    const sessionId = `cap-${task}-${platform}-${randomUUID()}`, runs: RunView[] = [];
    const serviceSnapshots: unknown[] = []; let error: string | undefined;
    const prompts = task === "workspace" ? workspacePrompts : [
      `Use the release-coordination skill to assign Morgan as documentation owner for Cedar in namespace ${sessionId}. Read the current record through MCP, assign the owner through the approved API tool with the current revision and status in_progress, then read through MCP again to verify the saved state. Preserve the approved date and dependency; the launch remains blocked by incomplete documentation.`,
      `Correction: in namespace ${sessionId}, the documentation owner must be Avery. Read the current revision, update the saved owner using the API tool, then verify the record through MCP again. Preserve the approved date and dependency.`,
    ];
    try {
      for (let turn = 0; turn < prompts.length; turn++) {
        const now = Date.now();
        const run = await request<RunView>("/api/runs", {method: "POST", body: JSON.stringify({platform, variant: "baseline", sessionId, clientTurnId: `capability-turn-${turn + 1}`, task: {kind: "prompt", prompt: prompts[turn]}, model: {provider: "openrouter", model}, selection: {scenarioId: `${task}-capabilities`, experimentId}, capabilities: {profileId: profile.id, tools: {enabledNames: [], maxRounds: controls.maxRounds, maxCalls: controls.maxCalls}, approvals: profile.capabilities.filter(value => ["write", "external"].includes(value.risk)).map(value => ({schemaVersion: 1, decisionId: `approval_${randomUUID()}`, capabilityId: value.id, version: value.version, allowedOperations: value.operations, decision: "approved", decidedAt: new Date(now).toISOString(), expiresAt: new Date(now + 360000).toISOString()}))}})});
        runs.push(run); const deadline = now + controls.deadlineMs;
        while (["queued", "running", "suspended"].includes(runs.at(-1)!.status)) {
          if (Date.now() >= deadline || interrupted) { runs[runs.length - 1] = await request<RunView>(`/api/runs/${run.runId}/cancel`, {method: "POST", body: JSON.stringify({reason: "Capability acceptance observation interrupted."})}); throw new Error("Observation interrupted; inspect the native evidence."); }
          await new Promise(resolve => setTimeout(resolve, 250));
          runs[runs.length - 1] = await request<RunView>(`/api/runs/${run.runId}`);
        }
        console.log(`${platform} ${task} turn ${turn + 1}: ${runs.at(-1)!.status} ${run.runId}`);
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
    try { artifact = await readFile(join(config.runsRoot, ".workspaces", sessionId, "artifacts/cedar-report.md"), "utf8"); } catch { /* recorded below */ }
    const toolEvidence = await Promise.all(runs.map(value => inspectToolEvidence(config.runsRoot, value.runId)));
    const initial = toolEvidence[0]?.calls ?? [], corrected = toolEvidence[1]?.calls ?? [];
    const successful = (calls: ObservedCall[], operation: string) => calls.filter(call => call.status === "completed" && call.name.endsWith(`_${operation}`));
    const edits = [...successful(corrected, "write_file"), ...successful(corrected, "patch_file")].filter(call => call.path === "artifacts/cedar-report.md");
    const correctionReads = successful(corrected, "read_file").filter(call => call.path === "artifacts/cedar-report.md");
    const firstEdit = Math.min(...edits.map(call => call.sequence ?? Infinity)), lastEdit = Math.max(...edits.map(call => call.sequence ?? -Infinity));
    const workspaceAssertions = {
      twoCompletedTurns: runs.length === 2 && runs.every(value => value.status === "completed"),
      retainedToolEvidence: toolEvidence.length === 2 && toolEvidence.every(value => value.error === null),
      procedureLoaded: successful(initial, "load_skill").length > 0,
      referenceRead: successful(initial, "read_skill_resource").some(call => call.path === "references/report-format.md"),
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
    const assertions = task === "workspace" ? workspaceAssertions : {
      twoCompletedTurns: workspaceAssertions.twoCompletedTurns,
      retainedToolEvidence: workspaceAssertions.retainedToolEvidence,
      procedureLoaded: workspaceAssertions.procedureLoaded,
      initialEditVerified: serviceEditVerified(initial), correctionVerified: serviceEditVerified(corrected),
      assignedOwner: records[0]?.owner === "Morgan" && records[0]?.revision === 2,
      correctedOwner: records[1]?.owner === "Avery" && records[1]?.revision === 3,
      preservedFacts: records.length === 2 && records.every(record => record.approvedDate === "2026-10-22" && record.status === "in_progress" && record.dependency === "Integration documentation incomplete"),
    };
    let routingValid = runs.length > 0;
    const observedRequests = new Set<string>();
    for (const run of runs) for (const event of run.events) {
      const observation = event.kind === "EvalModelObserved" ? event.payload.observation as { phase?: string; providerRequest?: unknown } : undefined;
      if (observation?.phase === "request") {
        observedRequests.add(run.runId);
        try { assertFreeModelRequest(observation.providerRequest, model, experimentId); } catch { routingValid = false; }
      }
    }
    routingValid = routingValid && runs.every(run => observedRequests.has(run.runId));
    const outcome = {platform, task, profileId: profile.id, prompts, sessionId, runIds: runs.map(value => value.runId), statuses: runs.map(value => value.status), assertions: {...assertions, routingValid}, toolEvidence, verdict: error ? "error" : routingValid && Object.values(assertions).every(Boolean) ? "pass" : "fail", ...(error ? {error} : {}), artifact, serviceSnapshots};
    outcomes.push(outcome); await save(); console.log(`${platform} ${task}: ${outcome.verdict}`);
    if (outcome.verdict !== "pass") process.exitCode = 1;
  }
  console.log(`Acceptance evidence: ${join(directory, "summary.json")}`);
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, api), {...options, headers: {"content-type": "application/json"}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

interface ObservedCall { callId: string; name: string; status: string; path: string | null; sequence: number | null }
async function inspectToolEvidence(runsRoot: string, runId: string): Promise<{ runId: string; calls: ObservedCall[]; error: string | null }> {
  const calls: ObservedCall[] = [];
  try {
    const directory = join(runsRoot, runId, "artifacts/capability-calls");
    const events = (await readFile(join(runsRoot, runId, "events.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
    for (const name of (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const receipt = JSON.parse(await readFile(join(directory, name), "utf8"));
      let content: Record<string, unknown> = {};
      try { content = JSON.parse(receipt.result?.content ?? "{}"); } catch { /* Non-JSON tool results have no artifact path. */ }
      const event = events.find(event => event.kind === "ToolExecutionCompleted" && event.payload?.toolCallId === receipt.toolCallId);
      calls.push({ callId: receipt.toolCallId, name: receipt.toolName, status: receipt.status === "complete" ? receipt.result?.status ?? "unknown" : "unknown", path: typeof content?.path === "string" ? content.path : null, sequence: typeof event?.recordedSequence === "number" ? event.recordedSequence : null });
    }
    calls.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
    return { runId, calls, error: null };
  } catch (error) { return { runId, calls, error: error instanceof Error ? error.message : "Tool evidence unavailable." }; }
}
main().catch(error => {console.error(error instanceof Error ? error.message : error); process.exitCode = 1;});
