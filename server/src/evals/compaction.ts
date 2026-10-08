import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadServerConfig } from "../control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../control-plane/application/platform-registry.js";
import { RunService } from "../control-plane/application/run-service.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../capabilities/context/index.js";
import { MastraBaselineRunner } from "../platforms/mastra/runner-adapter/mastra-runner.js";
import { TemporalBaselineRunner } from "../platforms/temporal/runner-adapter/temporal-runner.js";
import { LangGraphBaselineRunner } from "../platforms/langgraph/runner-adapter/langgraph-runner.js";
import { RestateBaselineRunner } from "../platforms/restate/runner-adapter/restate-runner.js";
import { loadRestateConfig } from "../platforms/restate/config.js";
import type { PlatformRunner } from "../control-plane/ports/runner.js";
import { installedRuntimeVersions } from "./runtime-versions.js";
import type { ExtensionPlatform, ExtensionReport } from "./extension-contracts.js";
import { COMPACTION_CASE_VERSION, COMPACTION_PROMPTS, gradeCompaction } from "./compaction-contracts.js";
import { startCompactionProvider, compactionMastraModel } from "./compaction-provider.js";

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function workspace() { let root = process.cwd(); while (true) { try { await access(join(root, "pnpm-workspace.yaml")); return root; } catch { if (dirname(root) === root) throw new Error("Run in the Lab workspace."); root = dirname(root); } } }
async function unusedPort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No port."); await new Promise<void>(resolve => server.close(() => resolve())); return address.port; }
async function waitHttp(url: string) { for (let index = 0; index < 200; index++) { try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* startup */ } await pause(100); } throw new Error(`Native service unavailable: ${url}`); }
async function waitTcp(port: number) { for (let index = 0; index < 200; index++) { const ready = await new Promise<boolean>(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => { socket.destroy(); resolve(false); }); }); if (ready) return; await pause(100); } throw new Error("Isolated native SDK service did not start."); }
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; child.kill("SIGTERM"); for (let index = 0; index < 50 && child.exitCode === null && child.signalCode === null; index++) await pause(100); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }

/** One native compaction boundary per requested baseline. Isolated workers and
 * Restate server preserve user services; only Temporal's existing server is reused. */
export async function runCompactionEvals(selected: ExtensionPlatform[], options: { summaryDelayMs?: number } = {}) {
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(platform => !["mastra", "langgraph", "temporal", "restate"].includes(platform))) throw new Error("Select distinct supported baseline platforms.");
  const root = await workspace(), invocationId = `compaction-${randomUUID()}`;
  const directory = join(root, "lab/runs/.evals", invocationId), contextRoot = join(directory, "sessions");
  await mkdir(directory, { recursive: true });
  const fixture = await startCompactionProvider(options), children: ChildProcess[] = [], runners: PlatformRunner[] = [];
  const logs: Record<string, string> = {}, reports: ExtensionReport[] = [], errors: { platform: string; message: string; runIds: string[] }[] = [];
  const start = (label: string, executable: string, args: string[], environment: NodeJS.ProcessEnv, cwd = root) => {
    const child = spawn(executable, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    logs[label] = ""; const collect = (chunk: Buffer) => { logs[label] += chunk.toString(); }; child.stdout?.on("data", collect); child.stderr?.on("data", collect); child.on("error", error => { logs[label] += error.message; }); children.push(child); return child;
  };
  const environment = { ...process.env, OPENROUTER_API_KEY: "fixture-only-not-a-secret", AGENTLAB_OPENROUTER_BASE_URL: fixture.baseUrl,
    AGENTLAB_ALLOWED_MODEL_PROVIDERS: "openrouter", AGENTLAB_RUN_ROOT: join(root, "lab/runs"), AGENTLAB_CONTEXT_ROOT: contextRoot,
    AGENTLAB_TEMPORAL_TASK_QUEUE: invocationId, AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS: "30000" };
  // LangGraph's adapter resolves its summary endpoint from the current process;
  // save and restore these two variables, never load personal credentials.
  const previousBase = process.env.AGENTLAB_OPENROUTER_BASE_URL, previousKey = process.env.OPENROUTER_API_KEY;
  process.env.AGENTLAB_OPENROUTER_BASE_URL = fixture.baseUrl; process.env.OPENROUTER_API_KEY = environment.OPENROUTER_API_KEY;
  const startedAt = new Date().toISOString();
  const versions = await installedRuntimeVersions();
  const sourcePaths = ["server/src/evals/compaction.ts", "server/src/evals/compaction-contracts.ts", "server/src/evals/compaction-provider.ts", "server/src/platforms/restate/variants/baseline/workflow.ts", "server/src/platforms/temporal/variants/baseline/activities.ts", "server/src/capabilities/context/compaction.ts", "server/src/capabilities/context/context-service.ts", "server/src/capabilities/context/token-counter.ts"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
  let revision: string | null = null, dirty: boolean | null = null; try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()); } catch { /* source export */ }
  try {
    for (const platform of selected) {
      const runIds: string[] = [];
      try {
        const model = `fixture/compaction-${platform}`, config = loadServerConfig(environment, root);
        let runner: PlatformRunner;
        if (platform === "mastra") runner = new MastraBaselineRunner({ contextRoot, modelFactory: manifest => compactionMastraModel(manifest.model.model, fixture.baseUrl) });
        else if (platform === "temporal") {
          start("temporal-worker", process.execPath, [join(root, "server/dist/src/platforms/temporal/runner-adapter/worker-entry.js")], environment);
          runner = await TemporalBaselineRunner.connect(config);
        } else if (platform === "langgraph") {
          const port = await unusedPort(), platformRoot = join(root, "server/src/platforms/langgraph");
          start("langgraph-service", process.env.AGENTLAB_LANGGRAPH_PYTHON ?? join(platformRoot, ".local311/bin/python"), ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", String(port)], { ...environment, AGENTLAB_LANGGRAPH_STATE_DIR: join(directory, "langgraph") }, platformRoot);
          await waitHttp(`http://127.0.0.1:${port}/health`);
          runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: `http://127.0.0.1:${port}`, contextRoot, maxAttempts: 1 });
        } else {
          const ingress = await unusedPort(), admin = await unusedPort(), service = await unusedPort(), fabric = await unusedPort();
          const restateEnvironment = { ...environment, AGENTLAB_RESTATE_INGRESS_URL: `http://127.0.0.1:${ingress}`, AGENTLAB_RESTATE_ADMIN_URL: `http://127.0.0.1:${admin}`, AGENTLAB_RESTATE_SERVICE_URL: `http://127.0.0.1:${service}`, AGENTLAB_RESTATE_SERVICE_PORT: String(service), RESTATE_BIND_IP: "127.0.0.1", RESTATE_ADMIN__BIND_ADDRESS: `127.0.0.1:${admin}`, RESTATE_INGRESS__BIND_ADDRESS: `127.0.0.1:${ingress}`, RESTATE_BIND_PORT: String(fabric) };
          start("restate-server", join(root, "server/src/platforms/restate/node_modules/.bin/restate-server"), ["--no-logo", "--node-name=agentlab-compaction", "--base-dir", join(directory, "restate")], restateEnvironment);
          await waitHttp(`${restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL}/health`);
          start("restate-service", process.execPath, [join(root, "server/dist/src/platforms/restate/service-entry.js")], restateEnvironment);
          await waitTcp(service);
          const registered = await fetch(`${restateEnvironment.AGENTLAB_RESTATE_ADMIN_URL}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: restateEnvironment.AGENTLAB_RESTATE_SERVICE_URL }) });
          if (!registered.ok) throw new Error(`Isolated Restate registration failed: ${registered.status}`);
          runner = await RestateBaselineRunner.connect(loadRestateConfig(restateEnvironment));
        }
        runners.push(runner);
        for (let index = 0; index < 100; index++) { if ((await runner.checkConnection()).reachable) break; await pause(100); }
        const connection = await runner.checkConnection(); if (!connection.reachable) throw new Error(connection.message);
        const evidence = new RunEvidenceStore(config.runsRoot), context = new ContextService(new ContextSessionStore(contextRoot), new CharacterTokenEstimator());
        const service = new RunService({ config, evidence, context, registry: new PlatformRegistry([runner]) });
        const sessionId = `${invocationId}-${platform}`;
        let output: string | null = null;
        for (const [turn, prompt] of COMPACTION_PROMPTS.entries()) {
          let view = await service.createRun({ platform, variant: "baseline", sessionId, clientTurnId: `turn-${turn + 1}`, task: { kind: "prompt", prompt }, model: { provider: "openrouter", model, contextWindowTokens: 12000 }, capabilities: { tools: { enabledNames: [], maxCalls: 1, maxRounds: 2 } }, selection: { scenarioId: "context-stress", experimentId: "agent-compaction-scripted" } });
          runIds.push(view.runId);
          const deadline = Date.now() + 30000;
          while (["queued", "running", "suspended"].includes(view.status)) { if (Date.now() > deadline) { await service.cancelRun(view.runId, "Compaction acceptance observation deadline."); throw new Error("Native compaction acceptance timed out; retained run may require inspection."); } await pause(50); view = await service.getRun(view.runId); }
          if (view.status !== "completed") throw new Error(`Native turn ${turn + 1} ${view.status}: ${view.result?.error?.code}`);
          output = view.result?.output ?? null;
        }
        const snapshot = await context.sessions.latestSnapshot(sessionId); if (!snapshot) throw new Error("No retained native context snapshot.");
        const transcript = await context.sessions.readTranscript(sessionId), receipts = fixture.receipts.filter(receipt => receipt.model === model);
        const source = join(directory, `${platform}-evidence.json`);
        await writeFile(source, JSON.stringify({ schemaVersion: 1, caseVersion: COMPACTION_CASE_VERSION, platform, runIds, snapshot, transcript, receipts, output }, null, 2) + "\n", { flag: "wx" });
        const report = gradeCompaction({ platform, deployment: JSON.stringify(runner.manifestConfiguration()), snapshot, transcript, receipts, output, sources: [source, ...runIds.map(id => join(config.runsRoot, id, "events.jsonl"))] });
        reports.push(report); console.log(`X05 ${platform}: ${report.verdict.toUpperCase()}`);
      } catch (error) { const message = error instanceof Error ? error.message : "Compaction acceptance failed."; errors.push({ platform, message, runIds }); console.log(`X05 ${platform}: ERROR (${message})`); }
    }
  } finally {
    for (const runner of runners) await runner.close?.();
    for (const child of children.reverse()) await stop(child);
    await fixture.close();
    await writeFile(join(directory, "provider-receipts.json"), JSON.stringify(fixture.receipts, null, 2) + "\n", { flag: "wx" });
    if (previousBase === undefined) delete process.env.AGENTLAB_OPENROUTER_BASE_URL; else process.env.AGENTLAB_OPENROUTER_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
    await writeFile(join(directory, "summary.json"), JSON.stringify({ schemaVersion: 1, invocationId, mode: "scripted-extension", caseVersion: COMPACTION_CASE_VERSION, revision, dirty, versions, sourceHashes, startedAt, completedAt: new Date().toISOString(), controls: { provider: "loopback-scripted", summaryDelayMs: options.summaryDelayMs ?? 0, modelQualityClaim: false, contextWindowTokens: 12000, reservedOutputTokens: 4096, safetyMarginTokens: 1024, compactionThresholdPercent: 20, recentMessageGroups: 2, trials: 1 }, reports, errors }, null, 2) + "\n", { flag: "wx" });
    const proofDirectory = join(root, "lab/runs/.review-proof", invocationId);
    await mkdir(proofDirectory, { recursive: true });
    await writeFile(join(proofDirectory, "extensions.json"), JSON.stringify({ schemaVersion: 1, mode: "scripted-native", metadata: { revision, dirty, versions, sourceHashes, startedAt, completedAt: new Date().toISOString(), model: "loopback-scripted-compaction-fixture", controls: { caseVersion: COMPACTION_CASE_VERSION, summaryDelayMs: options.summaryDelayMs ?? 0, summaryQualityClaim: false, contextWindowTokens: 12000, reservedOutputTokens: 4096, safetyMarginTokens: 1024, compactionThresholdPercent: 20, recentMessageGroups: 2, sourceSummary: join(directory, "summary.json") } }, reports }, null, 2) + "\n", { flag: "wx" });
    console.log(`Extension proof: ${join(proofDirectory, "extensions.json")}`);
    for (const [name, contents] of Object.entries(logs)) await writeFile(join(directory, `${name}.log`), contents);
  }
  console.log(`Summary: ${join(directory, "summary.json")}`);
  if (errors.length || reports.some(report => report.verdict !== "pass")) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  if (![2, 4].includes(args.length) || args[0] !== "--platforms" || (args.length === 4 && (args[2] !== "--summary-delay-ms" || !/^\d+$/.test(args[3]!)))) throw new Error("Usage: compaction --platforms mastra,langgraph,temporal,restate [--summary-delay-ms 2000]");
  await runCompactionEvals(args[1]!.split(",") as ExtensionPlatform[], { summaryDelayMs: args.length === 4 ? Number(args[3]) : 0 });
}
