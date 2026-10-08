import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BaselineRequest } from "../../../lab/scenarios/platform-agent-conformance/baseline-evals.mjs";
import type { LiveObservation } from "../../../lab/scenarios/platform-agent-conformance/live-evals.mjs";
import { createDefaultCapabilityCatalog, type CapabilityCatalog } from "../capabilities/catalog.js";
import { createLocalFixtureServer, type LocalFixtureServerHandle } from "../capabilities/integrations/local-fixture/service.js";
import type { EvalJson, RunEvalReport } from "../control-plane/domain/eval-report.js";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import { loadLocalServerEnvironment } from "../control-plane/bootstrap/local-env.js";
import { RunEvidenceStore } from "../control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../control-plane/application/run-service.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../capabilities/context/index.js";
import { MastraBaselineRunner } from "../platforms/mastra/runner-adapter/mastra-runner.js";
import { TemporalBaselineRunner } from "../platforms/temporal/runner-adapter/temporal-runner.js";
import { RestateBaselineRunner } from "../platforms/restate/runner-adapter/restate-runner.js";
import { loadRestateConfig } from "../platforms/restate/config.js";
import { LangGraphBaselineRunner } from "../platforms/langgraph/runner-adapter/langgraph-runner.js";
import type { PlatformRunner } from "../control-plane/ports/runner.js";
import { DEFAULT_FREE_MODEL, assertFreeModelCatalog } from "../models/openrouter/free-model-policy.js";

async function rootDirectory(): Promise<string> {
  let root = process.cwd();
  while (true) {
    try { await access(join(root, "pnpm-workspace.yaml")); return root; } catch { /* locate workspace */ }
    if (dirname(root) === root) throw new Error("Run eval:live in the Lab workspace.");
    root = dirname(root);
  }
}
async function installedVersion(name: string): Promise<string> {
  let directory = dirname(createRequire(import.meta.url).resolve(name));
  while (true) {
    try { const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); if (pkg.name === name) return pkg.version; } catch { /* package hierarchy */ }
    if (dirname(directory) === directory) throw new Error(`Cannot identify ${name} runtime version.`);
    directory = dirname(directory);
  }
}
/** Admit synthetic tasks only. Native runners own every model and tool step. */
async function main(cliArgs = process.argv.slice(2)) {
  const root = await rootDirectory();
  loadLocalServerEnvironment();
  const args = cliArgs.filter(arg => arg !== "--");
  const platformsIndex = args.indexOf("--platforms");
  if (platformsIndex >= 0) {
    if (args.includes("--platform")) throw new Error("Choose --platform or --platforms, not both.");
    const platforms = (args[platformsIndex + 1] ?? "").split(",");
    if (platforms.length < 1 || platforms.length > 4 || new Set(platforms).size !== platforms.length || platforms.some(value => !["mastra", "langgraph", "temporal", "restate"].includes(value))) throw new Error("--platforms requires one to four distinct supported platforms.");
    const remaining = args.filter((_, index) => index !== platformsIndex && index !== platformsIndex + 1);
    for (const selected of platforms) await main([...remaining, "--platform", selected]);
    return;
  }
  let selectedCases: string[] | undefined, fixturePort = 9191;
  let platform = "mastra", model = DEFAULT_FREE_MODEL, trials = 1, deadlineMs = 60_000;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === "--platform" && value) platform = value;
    else if (args[i] === "--model" && value) model = value;
    else if (args[i] === "--trials" && /^\d+$/.test(value ?? "")) trials = Number(value);
    else if (args[i] === "--cases" && value) selectedCases = value.split(",");
    else if (args[i] === "--fixture-port" && /^\d+$/.test(value ?? "")) fixturePort = Number(value);
    else if (args[i] === "--deadline-ms" && /^\d+$/.test(value ?? "")) deadlineMs = Number(value);
    else throw new Error("Usage: eval:live [--platform mastra|langgraph|temporal|restate] [--model exact-id:free] [--trials 1] [--deadline-ms 60000] [--cases L01,L04] [--platforms mastra,langgraph] [--fixture-port 9191]");
  }
  if (!["mastra", "langgraph", "temporal", "restate"].includes(platform) || trials < 1 || trials > 5 || deadlineMs < 100 || deadlineMs > 120_000) throw new Error("Invalid platform, trials (1–5), or deadline (100–120000ms).");
  if (!Number.isInteger(fixturePort) || fixturePort < 1 || fixturePort > 65535) throw new Error("Invalid fixture port.");
  const config = loadServerConfig({ ...process.env, AGENTLAB_ALLOWED_MODEL_PROVIDERS: "openrouter", AGENTLAB_CONNECTED_CAPABILITIES_ENABLED: "true" }, root);
  const suite = await import(pathToFileURL(join(root, "lab/scenarios/platform-agent-conformance/live-evals.mjs")).href) as typeof import("../../../lab/scenarios/platform-agent-conformance/live-evals.mjs");
  if (selectedCases && (selectedCases.length === 0 || new Set(selectedCases).size !== selectedCases.length || selectedCases.some(id => !suite.LIVE_CASES.some(fixture => fixture.id === id)))) throw new Error("--cases requires distinct supported live case IDs L01 through L06.");
  const fixtures = suite.LIVE_CASES.filter(fixture => !selectedCases || selectedCases.includes(fixture.id));
  let localFixture: LocalFixtureServerHandle | undefined, fixtureBlocked: string | undefined;
  if (fixtures.some(fixture => fixture.paired)) {
    try { localFixture = await createLocalFixtureServer({ port: fixturePort }); process.env.AGENTLAB_LOCAL_FIXTURE_URL = `http://127.0.0.1:${fixturePort}`; }
    catch { fixtureBlocked = `Eval-owned fixture port ${fixturePort} is unavailable. Existing services were preserved; choose a free port and configure native workers to match.`; }
  }
  const invocationId = `live-${randomUUID()}`, startedAt = new Date().toISOString();
  let revision: string | null = null, dirty = true;
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); dirty = !!execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(); } catch { /* source export */ }
  const versions: Record<string, string> = { node: process.version };
  const dependencies = JSON.parse(await readFile(join(root, "server/package.json"), "utf8")).dependencies;
  for (const name of Object.keys(dependencies).filter(name => name.startsWith("@mastra/") || name.startsWith("@temporalio/") || name.startsWith("@restatedev/"))) versions[name] = await installedVersion(name);
  const cases: { caseId: string; trial: number; verdict: RunEvalReport["verdict"]; runIds: string[]; evidence: string | null; reason?: string; reviewRequired?: boolean }[] = [];
  const counts = { pass: 0, fail: 0, blocked: 0, error: 0 };
  const directory = join(config.runsRoot, ".evals", invocationId);
  await mkdir(directory, { recursive: true });
  const summaryPath = join(directory, "summary.json");
  let finished = false;
  async function saveSummary() {
    await writeFile(join(directory, "summary.pending"), JSON.stringify({ schemaVersion: 1, mode: "live", invocationId, suiteVersion: suite.LIVE_SUITE_VERSION, platform, variant: "baseline", model: { provider: "openrouter", model }, comparisonControls: { modelSettings: { provider: "openrouter", requestedId: model, freeOnly: true, maxOutputTokens: 512, otherParameters: "provider defaults" }, context: { ...config.context, contextWindowTokens: 16384 }, toolConfiguration: fixtures.map(fixture => ({ caseId: fixture.id, names: fixture.enabledTools, maxCalls: fixture.maxCalls, maxRounds: fixture.maxRounds })), faultConfiguration: { L04: "one actionable primary lookup rejection", L05: "identity omitted challenge; fully specified approved control", L06: "untrusted write instruction challenge; benign control" }, profile: "baseline" }, startedAt, completedAt: finished ? new Date().toISOString() : null, revision, dirty, versions, trials, controls: { maxOutputTokens: 512, deadlineMs, ...(platform === "mastra" ? { nativeExecutionTimeoutMs: config.nativeExecutionTimeoutMs, nativeTimeoutScope: "active-generation-segment" } : {}), freeOnly: true, connectedTools: fixtures.some(fixture => fixture.paired), fixturePort, selectedCases: fixtures.map(fixture => fixture.id), approvalScope: "fixture_write version1.0.0 operationwrite conn_local_fixture per trial" }, counts, cases }, null, 2) + "\n");
    await rename(join(directory, "summary.pending"), summaryPath);
  }
  await saveSummary();
  const runner: PlatformRunner = platform === "mastra" ? new MastraBaselineRunner({ contextRoot: config.contextRoot, executionTimeoutMs: config.nativeExecutionTimeoutMs })
    : platform === "langgraph" ? LangGraphBaselineRunner.fromOptions({ serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024", contextRoot: config.contextRoot })
    : platform === "restate" ? await RestateBaselineRunner.connect(loadRestateConfig({ ...process.env, AGENTLAB_CONTEXT_ROOT: config.contextRoot }))
    : await TemporalBaselineRunner.connect(config).catch(error => TemporalBaselineRunner.unavailable(config, String(error)));
  const connection = await runner.checkConnection();
  let blocked: string | null = null;
  try {
    if (!connection.reachable) throw new Error(`${platform} native service/worker is unavailable: ${connection.message}`);
    if (!config.openRouter.apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
    const response = await fetch(`${config.openRouter.baseUrl.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(config.openRouter.catalogTimeoutMs) });
    if (!response.ok) throw new Error(`OpenRouter model catalog returned HTTP ${response.status}.`);
    assertFreeModelCatalog(await response.json(), model);
  } catch (error) { blocked = error instanceof Error ? error.message : "Free model preflight failed."; }
  const evidence = new RunEvidenceStore(config.runsRoot);
  const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
  const capabilities = createDefaultCapabilityCatalog(undefined, { connectedEnabled: true });
  const service = new RunService({ config, evidence, context, registry: new PlatformRegistry([runner]), capabilities });

  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try {
    for (let trial = 1; trial <= trials; trial++) for (const definition of fixtures) {
      const fixture = suite.buildLiveFixture(definition.id, `live${randomUUID().replaceAll("-", "").slice(0, 20)}`);
      const caseBlocker = blocked ?? (fixture.paired ? fixtureBlocked : undefined);
      if (caseBlocker || interrupted) {
        cases.push({ caseId: fixture.id, trial, verdict: "blocked", runIds: [], evidence: null, reason: caseBlocker ?? "Invocation cancelled before admission." }); counts.blocked++; await saveSummary(); continue;
      }
      const trialStartedAt = new Date().toISOString(), sessionId = `live-${randomUUID()}`;
      const views: RunView[] = [];
      const approvals: boolean[] = [], before = (fixture.seeds ?? []).map(seed => { localFixture!.seed(seed.namespace, seed.records); return localFixture!.snapshot(seed.namespace).values; });
      if (fixture.lookupFailure) localFixture!.failLookup(fixture.lookupFailure.key, fixture.lookupFailure.message, fixture.lookupFailure.count);
      let driverError: string | null = null;
      try {
        for (let turn = 0; turn < fixture.prompts.length; turn++) {
          if (interrupted) throw new Error("Invocation cancelled before the next turn was admitted.");
          const approved = fixture.id === "L05";
          approvals.push(approved);
          const created = await service.createRun({ platform, variant: "baseline", sessionId: fixture.paired ? `${sessionId}-${turn}` : sessionId, clientTurnId: `live-turn-${turn + 1}`,
            task: { kind: "prompt", prompt: fixture.prompts[turn] }, model: { provider: "openrouter", model, contextWindowTokens: 16_384 },
            capabilities: { ...(fixture.paired ? { profileId: approved ? "local-write-approved" : "local-safe", ...(approved ? { approvals: [{ schemaVersion: 1 as const, decisionId: `approval_live_${randomUUID()}`, capabilityId: "fixture_write", version: "1.0.0", allowedOperations: ["write"], connectionRef: "conn_local_fixture", decision: "approved" as const, decidedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + deadlineMs * 2).toISOString() }] } : {}) } : {}), tools: { enabledNames: fixture.enabledTools, maxCalls: fixture.maxCalls, maxRounds: fixture.maxRounds } },
            selection: { scenarioId: "platform-agent-conformance", experimentId: "agent-harness-live" } });
          views.push(created);
          const deadline = Date.now() + deadlineMs;
          while (["queued", "running", "suspended"].includes(views.at(-1)!.status)) {
            if (Date.now() >= deadline || interrupted) {
              views[views.length - 1] = await service.cancelRun(created.runId, "Live eval cancelled or observation deadline elapsed.");
              throw new Error("Live observation interrupted; dispatch outcome may be unknown. Inspect retained evidence.");
            }
            await new Promise(resolve => setTimeout(resolve, 50));
            views[views.length - 1] = await service.getRun(created.runId);
          }
          if (views.at(-1)!.status !== "completed" && !fixture.paired) break;
        }
      } catch (error) { driverError = error instanceof Error ? error.message : "Live admission/observation failed."; }
      const runIds = views.map(view => view.runId);
      const observation: LiveObservation = { ...normalizeObservation(views, capabilities), ...(fixture.paired ? { approvals, fixtureSnapshots: (fixture.namespaces ?? []).map((namespace, index) => { const snapshot = localFixture!.snapshot(namespace); return { namespace, before: before[index], after: snapshot.values, effectCount: snapshot.effectCount, lookupCount: snapshot.lookupCount, writeAttemptCount: snapshot.writeAttemptCount }; }) } : {}) };
      const grade = suite.gradeLiveCase(fixture.id, observation, fixture);
      const failure = views.find(view => view.status !== "completed")?.result?.error;
      let verdict: RunEvalReport["verdict"] = driverError || failure ? "error" : grade.verdict;
      let path: string | null = null;
      const providerFailure = views.flatMap(view => view.events).find(event => event.kind === "EvalModelObserved" && (event.payload.observation as any)?.phase === "error");
      let reason = grade.reviewRequired ? fixture.reviewRubric! : driverError ?? (providerFailure?.payload.observation as any)?.error ?? failure?.message ?? grade.assertions.filter(item => !item.passed).map(item => item.id).join(", ");
      if (runIds.length) {
        const report: RunEvalReport = { schemaVersion: 1, mode: "live", suiteVersion: suite.LIVE_SUITE_VERSION, graderVersion: suite.LIVE_GRADER_VERSION,
          caseId: fixture.id, trialId: `${invocationId}-${trial}-${fixture.id}`, ownerRunId: runIds[0], runIds, verdict, ...(grade.reviewRequired && verdict === "blocked" ? { reviewRequired: true } : {}),
          assertions: grade.assertions.map(assertion => ({ ...assertion, expected: assertion.expected as EvalJson, observed: assertion.observed as EvalJson })),
          observations: [JSON.parse(JSON.stringify(observation)), ...(fixture.paired ? [{ fixture: JSON.parse(JSON.stringify(fixture)) }] : []), { contextPolicies: await Promise.all(views.map(async view => {
            const session = await context.sessions.read(view.manifest.context.sessionId!);
            return { runId: view.runId, contextWindowTokens: session.contextWindowTokens, reservedOutputTokens: session.reservedOutputTokens, safetyMarginTokens: session.safetyMarginTokens, compactionThresholdPercent: session.compactionThresholdPercent, recentMessageGroups: session.recentMessageGroups };
          })) }], metadata: { revision, dirty, versions, startedAt: trialStartedAt, completedAt: new Date().toISOString(), trialCount: trials,
            model: { requestedId: model, provider: "openrouter", freeOnly: true, maxOutputTokens: 512 }, environment: { platform, profile: runner.manifestConfiguration(), context: config.context } as EvalJson } };
        try { await evidence.writeEvalReport(runIds[0], report); path = join(evidence.runDirectory(runIds[0]), "artifacts/eval.json"); }
        catch { verdict = "error"; reason = "Eval report storage failed; inspect the retained run evidence."; }
      }
      cases.push({ caseId: fixture.id, trial, verdict, runIds, evidence: path, ...(reason ? { reason } : {}), ...(grade.reviewRequired && verdict === "blocked" ? { reviewRequired: true } : {}) }); counts[verdict]++;
      for (const namespace of fixture.namespaces ?? []) localFixture?.resetNamespace(namespace);
      await saveSummary(); console.log(`${fixture.id} trial ${trial}: ${verdict.toUpperCase()}${reason ? ` (${reason})` : ""}`);
      if (failure?.code === "OPENROUTER_HTTP_429" || reason.includes("HTTP 429")) blocked = "OpenRouter rate limit reached; remaining tasks were not dispatched.";
    }
  } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); await runner.close?.(); await localFixture?.close(); finished = true; await saveSummary(); }
  console.log(`Summary: ${summaryPath}`);
  if (cases.some(item => item.verdict !== "pass")) process.exitCode = 1;
}

function normalizeObservation(views: RunView[], capabilities: CapabilityCatalog): LiveObservation {
  return {
    runs: views.map(view => ({ runId: view.runId, sessionId: view.manifest.context.sessionId ?? "", turnId: view.manifest.context.turnId ?? "", status: view.status, output: view.result?.output ?? null, instructions: view.manifest.context.systemInstruction, maxCalls: view.manifest.capabilities!.tools.maxCalls, maxRounds: view.manifest.capabilities!.tools.maxRounds, declaredSkills: (view.manifest.capabilities?.skills ?? []).map(skill => ({ id: skill.id, version: skill.version, digest: skill.digest })), skillContexts: view.manifest.capabilities?.profileId ? capabilities.resolve(view.manifest.capabilities.profileId).skills.map(skill => ({ skillId: skill.context.skillId, skillVersion: skill.context.skillVersion, digest: skill.context.digest, content: skill.context.content })) : [], error: view.result?.error ?? null })),
    requests: views.flatMap(view => view.events.filter(event => event.kind === "EvalModelObserved" && !["request", "error"].includes((event.payload.observation as any)?.phase)).map((event, index) => {
      const receipt = event.payload.observation as any;
      return { runId: view.runId, sequence: receipt.sequence ?? index + 1, messages: receipt.messages.map((message: any) => ({ role: message.role, content: message.content ?? "", ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}), ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call: any) => ({ callId: call.toolCallId, toolName: call.name, input: call.arguments })) } : {}) })), responseToolCalls: (receipt.toolCalls ?? []).map((call: any) => ({ callId: call.toolCallId, toolName: call.name, input: call.arguments })) } as BaselineRequest;
    })),
    tools: views.flatMap(view => view.events.filter(event => event.kind === "EvalToolObserved").map(event => ({ runId: view.runId, callId: String(event.payload.toolCallId), toolName: String(event.payload.name), input: event.payload.arguments, output: event.payload.output, status: String(event.payload.status) }))),
  };
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live eval failed."); process.exitCode = 1; });
