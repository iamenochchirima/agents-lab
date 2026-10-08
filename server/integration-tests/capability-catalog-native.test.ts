import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { CapabilityCatalog, DEFAULT_CAPABILITY_MANIFESTS, DEFAULT_CAPABILITY_PROFILES, builtinToolDescriptors } from "../src/capabilities/catalog.js";
import { loadCapabilityPackages } from "../src/capabilities/extensions/packages.js";
import { capabilityWorkspaceRoot } from "../src/capabilities/extensions/runtime.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import type { JsonObject } from "../src/capabilities/contracts.js";
import type { PlatformRunner } from "../src/control-plane/ports/runner.js";
import { scriptedMastraModel } from "../src/evals/mastra-scripted-model.js";
import { MastraBaselineRunner } from "../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";
import { RestateBaselineRunner } from "../src/platforms/restate/runner-adapter/restate-runner.js";
import { loadRestateConfig } from "../src/platforms/restate/config.js";

/** Opt-in actual-native acceptance, not a model-quality evaluation.
 * Requires a capability host with the example package catalog and the same
 * run/context roots, plus actual Temporal, LangGraph and Restate services.
 * The existing synthetic model chooses arbitrary catalog names; no platform
 * tool registration or fake-model name switch is modified by this test.
 * Evidence is retained because the external host must validate admitted runs.
 */
test("new package tools traverse all four native runtimes and the authenticated host", {
  skip: process.env.AGENTLAB_RUN_CAPABILITY_CATALOG_NATIVE !== "1", timeout: 120_000,
}, async (t) => {
  const root = capabilityWorkspaceRoot();
  const config = loadServerConfig({ ...process.env, AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake", AGENTLAB_CONNECTED_CAPABILITIES_ENABLED: "true",
    AGENTLAB_RUN_ROOT: join(root, "lab/runs"), AGENTLAB_CONTEXT_ROOT: join(root, "lab/sessions") }, root);
  const packages = await loadCapabilityPackages(join(root, "server/capability-packages/example.json"));
  const capabilities = new CapabilityCatalog([...DEFAULT_CAPABILITY_MANIFESTS, ...packages.tools.map(({ descriptor }) => ({
    schemaVersion: 1 as const, id: descriptor.definition.name, version: descriptor.source.version, kind: "tool" as const,
    displayName: descriptor.definition.name, description: descriptor.definition.description, risk: descriptor.definition.riskClass,
    operations: ["execute"], inputSchema: descriptor.definition.inputSchema as JsonObject, requiredScopes: [],
    source: { kind: "package" as const, ref: descriptor.source.id, digest: descriptor.source.digest },
  }))], [...DEFAULT_CAPABILITY_PROFILES, ...packages.profiles], undefined, undefined, {
    connectedEnabled: true, toolDescriptors: [...builtinToolDescriptors(), ...packages.tools.map(value => value.descriptor)],
  });
  const runners: PlatformRunner[] = [new MastraBaselineRunner({ contextRoot: config.contextRoot, modelFactory: manifest => scriptedMastraModel(manifest, []) }),
    await TemporalBaselineRunner.connect(config), LangGraphBaselineRunner.fromOptions({ serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024", contextRoot: config.contextRoot, timeoutMs: 30_000, maxAttempts: 1 }),
    await RestateBaselineRunner.connect(loadRestateConfig({ ...process.env, AGENTLAB_CONTEXT_ROOT: config.contextRoot }))];
  const evidence = new RunEvidenceStore(config.runsRoot);
  const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
  const service = new RunService({ config, evidence, context, capabilities, registry: new PlatformRegistry(runners) });
  const invocationId = `native-catalog-${randomUUID()}`;
  const reports: Record<string, unknown>[] = [];
  const tasks = [
    { name: "task-procedures_list_skills", input: {}, expected: "evidence-report" },
    { name: "task-workspace_read_file", input: { path: "brief.md" }, expected: "Cedar" },
  ];
  try {
    for (const runner of runners) await t.test(runner.platform, async () => {
      const connection = await runner.checkConnection();
      assert.equal(connection.reachable, true, connection.message);
      for (const task of tasks) {
        const prompt = `Perform this deterministic native-tool probe. [eval-behaviour:${Buffer.from(JSON.stringify({ action: "tool", toolName: task.name, input: task.input })).toString("base64url")}]`;
        let view = await service.createRun({ platform: runner.platform, variant: "baseline", sessionId: `catalog-${randomUUID()}`, clientTurnId: `turn-${randomUUID()}`,
          task: { kind: "prompt", prompt }, model: { provider: "fake", model: "fake-eval-behaviour", contextWindowTokens: 16384 },
          capabilities: { profileId: "workspace-agent", tools: { enabledNames: [], maxCalls: 2, maxRounds: 3 } },
          selection: { scenarioId: "workspace-capabilities", experimentId: "agent-capabilities-scripted" } });
        const deadline = Date.now() + 20_000;
        while (["queued", "running"].includes(view.status) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 100)); view = await service.getRun(view.runId);
        }
        reports.push({ platform: runner.platform, runId: view.runId, toolName: task.name, status: view.status });
        assert.equal(view.status, "completed", JSON.stringify(view.result?.error));
        assert.match(view.result?.output ?? "", new RegExp(task.expected));
        const manifest = await evidence.readManifest(view.runId);
        const descriptor = manifest.capabilities?.toolCatalog?.tools.find(value => value.definition.name === task.name);
        assert.equal(descriptor?.execution.kind, "hosted");
        const events = await evidence.readEvents(view.runId);
        assert.equal(events.filter(event => event.kind === "ToolExecutionStarted" && event.payload.toolName === task.name).length, 1);
        assert.equal(events.filter(event => event.kind === "ToolExecutionCompleted" && event.payload.toolName === task.name).length, 1);
        assert.equal(events.some(event => event.kind === "ToolExecutionUnknown" || event.kind === "ToolExecutionFailed"), false);
        const directory = join(evidence.runDirectory(view.runId), "artifacts/capability-calls");
        const files = await readdir(directory);
        assert.equal(files.length, 1);
        const receipt = JSON.parse(await readFile(join(directory, files[0]), "utf8"));
        assert.equal(receipt.status, "complete");
        assert.equal(receipt.toolName, task.name);
        assert.equal(receipt.catalogRevision, manifest.capabilities?.toolCatalog?.revision);
        assert.equal(receipt.result.status, "completed");
        assert.match(receipt.result.content, new RegExp(task.expected));
        console.info(JSON.stringify({ mode: "scripted-native", platform: runner.platform, runId: view.runId, toolName: task.name, verdict: "pass" }));
      }
    });
  } finally {
    const output = join(config.runsRoot, ".capability-proof", invocationId);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "summary.json"), JSON.stringify({ schemaVersion: 1, invocationId, mode: "scripted-native", modelId: "fake-eval-behaviour", experimentId: "agent-capabilities-scripted", reports }, null, 2));
    await Promise.all(runners.map(runner => runner.close?.()));
    console.info(`Retained scripted native acceptance: ${output}/summary.json`);
  }
});
