import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BaselineCaseId, BaselineObservation, BaselineRequest, BaselineToolObservation } from "../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs";
import type { EvalJson, RunEvalReport } from "../control-plane/domain/eval-report.js";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../control-plane/application/run-service.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../capabilities/context/index.js";
import { MastraBaselineRunner } from "../platforms/mastra/runner-adapter/mastra-runner.js";
import type { PlatformRunner } from "../control-plane/ports/runner.js";
import { TemporalBaselineRunner } from "../platforms/temporal/runner-adapter/temporal-runner.js";
import { RestateBaselineRunner } from "../platforms/restate/runner-adapter/restate-runner.js";
import { loadRestateConfig } from "../platforms/restate/config.js";
import { LangGraphBaselineRunner } from "../platforms/langgraph/runner-adapter/langgraph-runner.js";
import { scriptedMastraModel, type CapturedRequest } from "./mastra-scripted-model.js";

async function installedVersion(name: string): Promise<string> {
  let directory = dirname(createRequire(import.meta.url).resolve(name));
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name === name && typeof pkg.version === "string") return pkg.version;
    } catch { /* walk package hierarchy */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot identify installed version of ${name}.`);
    directory = parent;
  }
}

async function repositoryRoot(): Promise<string> {
  let directory = process.cwd();
  while (true) {
    try { await access(join(directory, "pnpm-workspace.yaml")); return directory; } catch { /* walk to workspace root */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Run eval:baseline from the Lab workspace.");
    directory = parent;
  }
}

/** Development driver. Native runners own execution; this only admits, observes, grades and retains. */
async function main(): Promise<void> {
  const root = await repositoryRoot();
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let platform = "mastra", trials = 1, deadlineMs = 30_000;
  for (let index = 0; index < args.length; index++) {
    const value = args[++index];
    if (args[index - 1] === "--platform" && value) platform = value;
    else if (args[index - 1] === "--trials" && /^\d+$/.test(value ?? "")) trials = Number(value);
    else if (args[index - 1] === "--deadline-ms" && /^\d+$/.test(value ?? "")) deadlineMs = Number(value);
    else throw new Error("Usage: eval:baseline [--platform mastra] [--trials 1] [--deadline-ms 30000]");
  }
  if (trials < 1 || trials > 20 || deadlineMs < 100 || deadlineMs > 120_000) throw new Error("Trials must be 1–20 and deadline 100–120000 milliseconds.");
  if (!["mastra", "temporal", "restate", "langgraph"].includes(platform)) throw new Error("Select mastra, temporal, restate, or langgraph.");
  const suite = await import(pathToFileURL(join(root, "lab/scenarios/platform-agent-conformance/baseline-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs");
  const invocationId = `baseline-${randomUUID()}`;
  const invocationStartedAt = new Date().toISOString();
  const config = loadServerConfig({ ...process.env, AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake", AGENTLAB_CONNECTED_CAPABILITIES_ENABLED: "false" }, root);
  const captures: CapturedRequest[] = [];
  const tools: BaselineToolObservation[] = [];
  const runner: PlatformRunner = platform === "mastra" ? new MastraBaselineRunner({
    contextRoot: config.contextRoot,
    modelFactory: (manifest) => scriptedMastraModel(manifest, captures),
    // The observer receives actual execution results, independently of model answer text.
    onToolObservation: (runId, call, result) => tools.push({ runId, callId: call.toolCallId, toolName: call.name, input: call.arguments, output: result.content, status: result.status }),
  }) : platform === "temporal" ? await TemporalBaselineRunner.connect(config).catch((error: unknown) => TemporalBaselineRunner.unavailable(config, error instanceof Error ? error.message : "Connection failed."))
    : platform === "restate" ? await RestateBaselineRunner.connect(loadRestateConfig({ ...process.env, AGENTLAB_CONTEXT_ROOT: config.contextRoot }))
    : LangGraphBaselineRunner.fromOptions({ serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024", contextRoot: config.contextRoot });
  const evidence = new RunEvidenceStore(config.runsRoot);
  const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
  const service = new RunService({ config, evidence, context, registry: new PlatformRegistry([runner]) });
  let revision: string | null = null, dirty = true;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  } catch { /* Non-Git source exports retain unknown revision explicitly. */ }
  const pkg = JSON.parse(await readFile(join(root, "server/package.json"), "utf8")) as { dependencies: Record<string, string> };
  const versions: Record<string, string> = { node: process.version };
  for (const name of Object.keys(pkg.dependencies).filter((name) => name.startsWith("@mastra/") || name.startsWith("@temporalio/") || name.startsWith("@restatedev/"))) versions[name] = await installedVersion(name);
  const connection = await runner.checkConnection();
  const summary: { caseId: string; trial: number; verdict: string; runIds: string[]; evidence: string | null; reason?: string }[] = [];
  try {
    for (let trial = 1; trial <= trials; trial++) {
      for (const fixture of suite.BASELINE_CASES) {
        if (!connection.reachable) {
          summary.push({ caseId: fixture.id, trial, verdict: "blocked", runIds: [], evidence: null, reason: connection.message });
          console.log(`${fixture.id} trial ${trial}: BLOCKED ${connection.message}`);
          continue;
        }
        const startedAt = new Date().toISOString();
        const views: RunView[] = [];
        const probes = fixture.id === "B07" ? ["calls", "rounds"] as const : [];
        const sessionId = `eval-${randomUUID()}`;
        let driverError: string | null = null;
        try {
          const count = fixture.id === "B07" ? 2 : fixture.prompts.length;
          for (let turn = 0; turn < count; turn++) {
            const probe = probes[turn];
            const created = await service.createRun({
              platform, variant: "baseline", sessionId: probe ? `${sessionId}-${probe}` : sessionId,
              clientTurnId: `eval-turn-${turn + 1}`,
              task: { kind: "prompt", prompt: probe ? `[baseline-limit:${probe}] Keep using the calculator to add 17 and 25.` : fixture.prompts[turn] },
              model: { provider: "fake", model: platform === "mastra" ? fixture.id === "B03" ? "fake-context" : fixture.enabledTools.length ? "fake-tool-call" : "fake-success"
                : probe ? "fake-eval-loop" : fixture.id === "B03" ? "fake-eval-context" : fixture.enabledTools.length ? "fake-eval-tool" : "fake-eval-completion", contextWindowTokens: 16_384 },
              capabilities: { tools: { enabledNames: fixture.enabledTools, maxCalls: probe === "calls" ? 1 : probe === "rounds" ? 8 : fixture.maxCalls, maxRounds: probe === "calls" ? 4 : probe === "rounds" ? 2 : fixture.maxRounds } },
              selection: { scenarioId: "platform-agent-conformance", experimentId: "agent-harness-baseline" },
            });
            // Preserve admission evidence even when polling/continuation fails.
            views.push(created);
            views[views.length - 1] = await observe(service, created, deadlineMs, (latest) => { views[views.length - 1] = latest; });
            if (fixture.id === "B03" && views.at(-1)?.status !== "completed") break;
          }
        } catch (error) { driverError = error instanceof Error ? error.message : String(error); }
        const runIds = views.map((view) => view.runId);
        const observation: BaselineObservation = {
          runs: views.map((view, index) => ({ runId: view.runId, sessionId: view.manifest.context.sessionId ?? "", turnId: view.manifest.context.turnId ?? "", status: view.status, output: view.result?.output ?? null, instructions: view.manifest.context.systemInstruction, maxCalls: view.manifest.capabilities!.tools.maxCalls, maxRounds: view.manifest.capabilities!.tools.maxRounds, error: view.result?.error ?? null, ...(probes[index] ? { probe: probes[index] } : {}) })),
          requests: platform === "mastra" ? captures.filter((request) => runIds.includes(request.runId)) as BaselineRequest[] : nativeRequests(views),
          tools: platform === "mastra" ? tools.filter((tool) => runIds.includes(tool.runId)) : nativeTools(views),
        };
        let grade: ReturnType<typeof suite.gradeBaselineCase>;
        try { grade = suite.gradeBaselineCase(fixture.id as BaselineCaseId, observation); }
        catch (error) {
          driverError = `Grader error: ${error instanceof Error ? error.message : String(error)}`;
          grade = { caseId: fixture.id, verdict: "fail", assertions: [] };
        }
        let verdict: RunEvalReport["verdict"] = driverError ? "error" : grade.verdict;
        let reportPath: string | null = null;
        if (views.length) {
          const ownerRunId = views[0].runId;
          const contextPolicies = await Promise.all(views.map(async (view) => {
            const session = await context.sessions.read(view.manifest.context.sessionId!);
            return { runId: view.runId, contextWindowTokens: session.contextWindowTokens, reservedOutputTokens: session.reservedOutputTokens, safetyMarginTokens: session.safetyMarginTokens, compactionThresholdPercent: session.compactionThresholdPercent, recentMessageGroups: session.recentMessageGroups, maxSessionBytes: session.maxSessionBytes, maxTranscriptBytes: session.maxTranscriptBytes };
          }));
          const report: RunEvalReport = {
            schemaVersion: 1, suiteVersion: suite.BASELINE_SUITE_VERSION, graderVersion: suite.BASELINE_GRADER_VERSION,
            caseId: fixture.id, trialId: `${invocationId}-${trial}`, ownerRunId, runIds, verdict,
            assertions: grade.assertions.map((assertion) => ({ ...assertion, expected: assertion.expected as EvalJson, observed: assertion.observed as EvalJson, observationRefs: [{ runId: ownerRunId, file: "artifacts/eval.json", pointer: "/observations/0" }] })),
            observations: [JSON.parse(JSON.stringify(observation)) as EvalJson, { contextPolicies }, ...(driverError ? [{ driverError }] : [])],
            metadata: { revision, dirty, versions: { ...versions, ...Object.fromEntries(views.flatMap((view) => Object.entries(view.executionReference?.native ?? {}).filter(([key, value]) => key.endsWith("Version") && typeof value === "string").map(([key, value]) => [key, String(value)]))) }, startedAt, completedAt: new Date().toISOString(), trialCount: trials },
          };
          try {
            await evidence.writeEvalReport(ownerRunId, report);
            reportPath = join(evidence.runDirectory(ownerRunId), "artifacts/eval.json");
          } catch (error) {
            verdict = "error";
            driverError = `Report storage error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        summary.push({ caseId: fixture.id, trial, verdict, runIds, evidence: reportPath, ...(driverError ? { reason: driverError } : {}) });
        console.log(`${fixture.id} trial ${trial}: ${verdict.toUpperCase()}${reportPath ? ` ${reportPath}` : ""}`);
        for (const assertion of grade.assertions.filter((item) => !item.passed)) console.log(`  ${assertion.id}: expected ${JSON.stringify(assertion.expected)}; observed ${JSON.stringify(assertion.observed)}`);
      }
    }
  } finally { await runner.close?.(); }
  const summaryDirectory = join(config.runsRoot, ".evals", invocationId);
  await mkdir(summaryDirectory, { recursive: true });
  const summaryPath = join(summaryDirectory, "summary.json");
  const counts = { pass: 0, fail: 0, blocked: 0, error: 0, unimplemented: suite.UNIMPLEMENTED_CORE_CASES.length };
  for (const item of summary) counts[item.verdict as "pass" | "fail" | "blocked" | "error"]++;
  await writeFile(summaryPath, JSON.stringify({ schemaVersion: 1, invocationId, platform, variant: "baseline", startedAt: invocationStartedAt, completedAt: new Date().toISOString(), profile: runner.manifestConfiguration(), contextLimits: config.context, contextRoot: config.contextRoot, connection, revision, dirty, versions, trials, counts, cases: summary, unimplemented: suite.UNIMPLEMENTED_CORE_CASES }, null, 2) + "\n");
  console.log(`Results: ${counts.pass} passed, ${counts.fail} failed, ${counts.blocked} blocked, ${counts.error} errors.`);
  console.log(`Unimplemented: ${suite.UNIMPLEMENTED_CORE_CASES.join(", ")}. B07 covers call/round limits only.`);
  console.log(`Summary: ${summaryPath}`);
  if (summary.some((item) => item.verdict !== "pass")) process.exitCode = 1;
}

/** Normalize eval-only native receipts while retaining their originals in events.jsonl. */
function nativeRequests(views: RunView[]): BaselineRequest[] {
  return views.flatMap((view) => view.events.filter((event) => event.kind === "EvalModelObserved").map((event, index) => {
    const receipt = event.payload.observation as { messages: { role: string; content: string | null; toolCallId?: string; toolCalls?: { toolCallId: string; name: string; arguments: unknown }[] }[]; toolCalls: { toolCallId: string; name: string; arguments: unknown }[] };
    return { runId: view.runId, sequence: index + 1, messages: receipt.messages.map((message) => ({ role: message.role, content: message.content ?? "", ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}), ...(message.toolCalls?.length ? { toolCalls: message.toolCalls.map((call) => ({ callId: call.toolCallId, toolName: call.name, input: call.arguments })) } : {}) })) as BaselineRequest["messages"], responseToolCalls: receipt.toolCalls.map((call) => ({ callId: call.toolCallId, toolName: call.name, input: call.arguments })) };
  }));
}
function nativeTools(views: RunView[]): BaselineToolObservation[] {
  return views.flatMap((view) => view.events.filter((event) => event.kind === "EvalToolObserved").map((event) => ({ runId: view.runId, callId: String(event.payload.toolCallId), toolName: String(event.payload.name), input: event.payload.arguments, output: event.payload.output, status: String(event.payload.status) })));
}

async function observe(service: RunService, created: RunView, deadlineMs: number, retain: (view: RunView) => void): Promise<RunView> {
  const deadline = Date.now() + deadlineMs;
  let view = created;
  while (["queued", "running", "suspended"].includes(view.status)) {
    if (Date.now() >= deadline) {
      const cancelled = await service.cancelRun(view.runId, "Baseline eval observation deadline elapsed.");
      retain(cancelled);
      throw new Error(`Observation deadline elapsed for ${view.runId}; cancellation requested. Inspect retained evidence.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    view = await service.getRun(view.runId);
    retain(view);
  }
  return view;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
