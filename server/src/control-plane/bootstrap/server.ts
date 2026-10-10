import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import { loadServerConfig, type ServerConfig } from "./config.js";
import { DeferredPlatformRunner } from "./deferred-runner.js";
import { loadHatchetConfig } from "../../platforms/hatchet/config.js";
import { loadLocalServerEnvironment } from "./local-env.js";
import { trustedFrontendOrigins } from "./frontend-origins.js";
import { RunEvidenceStore } from "../application/evidence-store.js";
import { PlatformRegistry } from "../application/platform-registry.js";
import { RunService } from "../application/run-service.js";
import { buildControlPlaneServer } from "../http/server.js";
import type { PlatformRunner } from "../ports/runner.js";
import { LangGraphBaselineRunner } from "../../platforms/langgraph/runner-adapter/langgraph-runner.js";
import { MastraBaselineRunner } from "../../platforms/mastra/runner-adapter/mastra-runner.js";
import { MastraWorkflowRunner } from "../../platforms/mastra/runner-adapter/mastra-workflow-runner.js";
import { loadRestateConfig } from "../../platforms/restate/config.js";
import { RestateBaselineRunner } from "../../platforms/restate/runner-adapter/restate-runner.js";
import { TemporalBaselineRunner } from "../../platforms/temporal/runner-adapter/temporal-runner.js";
import { DbosBaselineRunner } from "../../platforms/dbos/runner-adapter/dbos-runner.js";
import { InngestBaselineRunner } from "../../platforms/inngest/runner-adapter/inngest-runner.js";
import { TriggerDevBaselineRunner } from "../../platforms/trigger-dev/runner-adapter/trigger-dev-runner.js";
import { HatchetBaselineRunner } from "../../platforms/hatchet/runner-adapter/hatchet-runner.js";
import { VercelWorkflowsBaselineRunner } from "../../platforms/vercel-workflows/runner-adapter/vercel-workflows-runner.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../../capabilities/context/index.js";
import { OpenRouterModelCatalog } from "../../models/openrouter/catalog.js";
import { createStudioModule } from "../../studio/index.js";
import { createPackageCapabilityCatalog } from "../../capabilities/extensions/catalog.js";

import { CapabilityHost } from "../../capabilities/extensions/host.js";
import { InvocationReviewStore } from "../../capabilities/reviews/store.js";
import { CapabilityManagement } from "../../capabilities/management/service.js";
import { CapabilityAdminSessions } from "../../capabilities/management/admin-session.js";
import { registerCapabilityManagement } from "../http/capability-management.js";
import { capabilityWorkspaceRoot } from "../../capabilities/extensions/runtime.js";

import { AgentStateStore, createAgentMemoryTools } from "../../capabilities/agent-state/index.js";
import { TaskInteractionStore, taskInteractionContribution, registerInternalInteraction } from "../../capabilities/interaction/index.js";
import { registerAgentState } from "../http/agent-state.js";

export interface ControlPlaneRuntime {
  readonly app: FastifyInstance;
  readonly config: ServerConfig;
  readonly runner: PlatformRunner;
  readonly runners: readonly PlatformRunner[];
  close(): Promise<void>;
}

/**
 * Compose the application once. Route handlers receive already-built seams and
 * never construct SDK clients or filesystem paths themselves.
 */
export async function createControlPlaneRuntime(config = loadServerConfig()): Promise<ControlPlaneRuntime> {
  const runner = new DeferredPlatformRunner(
    TemporalBaselineRunner.unavailable(config, "Temporal initialization failed. Check the configured endpoint and restart the server to retry."),
    () => TemporalBaselineRunner.connect(config),
  );
  const restateConfig = loadRestateConfig();
  const restateRunner = new DeferredPlatformRunner(
    RestateBaselineRunner.unavailable(restateConfig, "Restate initialization failed. Check the configured ingress and restart the server to retry."),
    () => RestateBaselineRunner.connect(restateConfig),
  );
  const langgraphRunner = LangGraphBaselineRunner.fromOptions({
    serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024",
    contextRoot: config.contextRoot,
    timeoutMs: config.nativeExecutionTimeoutMs,
  });
  const mastraRunner = new MastraBaselineRunner({ contextRoot: config.contextRoot, executionTimeoutMs: config.nativeExecutionTimeoutMs });
  const mastraWorkflowRunner = config.mastra.workflowEnabled
    ? new MastraWorkflowRunner({ contextRoot: config.contextRoot, storagePath: config.mastra.workflowStoragePath })
    : null;
  const inngestRunner = new InngestBaselineRunner();
  const triggerDevRunner = TriggerDevBaselineRunner.fromEnvironment();
  const dbosRunner = new DbosBaselineRunner();
  const hatchetConfig = loadHatchetConfig();
  const hatchetRunner = new DeferredPlatformRunner(
    HatchetBaselineRunner.unavailable(hatchetConfig, "Hatchet initialization failed. Check the native runtime logs and restart the server to retry."),
    () => HatchetBaselineRunner.connect(hatchetConfig),
  );
  const vercelWorkflowsRunner = new VercelWorkflowsBaselineRunner();
  const runners: PlatformRunner[] = [
    runner,
    restateRunner,
    langgraphRunner,
    mastraRunner,
    inngestRunner,
    triggerDevRunner,
    dbosRunner,
    hatchetRunner,
    vercelWorkflowsRunner,
  ];
  if (mastraWorkflowRunner) runners.push(mastraWorkflowRunner);
  const evidence = new RunEvidenceStore(config.runsRoot);
  const sessions = new ContextSessionStore(config.contextRoot, config.context);
  const context = new ContextService(sessions, new CharacterTokenEstimator());
  const registry = new PlatformRegistry(runners);
  const modelCatalog = new OpenRouterModelCatalog({
    apiKey: config.openRouter.apiKey,
    baseUrl: config.openRouter.baseUrl,
    timeoutMs: config.openRouter.catalogTimeoutMs,
    cacheTtlMs: config.openRouter.catalogCacheTtlMs,
    resultLimit: config.openRouter.catalogLimit,
    defaultModel: config.openRouter.defaultModel,
  });
  const defaultPackages = join(capabilityWorkspaceRoot(), "server/capability-packages/example.json");
  const packagePath = process.env.AGENTLAB_CAPABILITY_PACKAGES ?? (existsSync(defaultPackages) ? defaultPackages : undefined);
  const managementRoot = resolve(capabilityWorkspaceRoot(), process.env.AGENTLAB_CAPABILITY_STATE_ROOT ?? "lab/state/capabilities");
  const agentState = new AgentStateStore(resolve(managementRoot, "../agent-state"));
  const interaction = new TaskInteractionStore(config.runsRoot);
  const applicationTools = [...createAgentMemoryTools(agentState, async execution => {
    const manifest = await evidence.readManifest(execution.runId);
    if (manifest.context.turnId !== execution.turnId) throw new Error("Memory turn identity mismatch.");
    return { namespace: manifest.context.memoryNamespace ?? "workspace-local", enabled: manifest.context.memoryEnabled !== false };
  }), taskInteractionContribution()];
  const management = await CapabilityManagement.create({ root: managementRoot, seedPath: packagePath, applicationTools,
    legacyOAuthRoot: join(config.contextRoot, ".oauth-secrets"), connectedEnabled: config.connectedCapabilitiesEnabled });
  const capabilities = createPackageCapabilityCatalog(management.loaded, config.connectedCapabilitiesEnabled);
  const reviews = new InvocationReviewStore(config.runsRoot);
  const host = await CapabilityHost.create(evidence, management.loaded.tools, sessions, reviews);
  management.attach(host, capabilities);
  // Reconstruct retained hosted implementations after attaching live owners. Run
  // admission keeps its recorded catalog while new frontend edits publish atomically.
  await management.reload();
  const service = new RunService({ config, context, evidence, modelMetadata: modelCatalog, registry, capabilities, reviews, agentState, interaction,
    renewReview: async (runId: string, requestId: string) => {
      const previous = await reviews.get(runId, requestId);
      const renewed = await host.prepare({ runId, turnId: previous.turnId, catalogRevision: previous.catalogRevision, call: previous.call });
      if (!renewed) throw new Error("Action review is no longer available.");
      return renewed;
    },
  });
  const app = buildControlPlaneServer({ config, modelCatalog, service, evidence, registry, capabilities });
  host.setInteraction(interaction);
  host.register(app);
  await registerInternalInteraction(app, interaction, evidence);
  registerAgentState(app, agentState, service, trustedFrontendOrigins(config.api.origin));
  app.get("/api/capability-packages", async (_request, reply) => reply.send({ packages: management.loaded.packages }));
  const adminSessions = await CapabilityAdminSessions.create(trustedFrontendOrigins(config.api.origin));
  registerCapabilityManagement(app, management, adminSessions);
  // Inspection and retained decision delivery continue when no browser is open.
  // Never overlap passes; native runtimes still own every model/tool step.
  let observing: Promise<void> | null = null;
  const observe = () => {
    if (observing) return;
    observing = service.observeActiveRuns().catch(() => undefined).finally(() => { observing = null; });
  };
  const observationTimer = setInterval(observe, 2_000);
  observationTimer.unref();
  app.addHook("onReady", async () => { observe(); });
  app.addHook("onClose", async () => { clearInterval(observationTimer); await observing; await management.close(); });
  const studio = createStudioModule(config.studioRunsRoot, { memoryLimits: config.studioMemory });
  studio.register(app);

  return {
    app,
    config,
    runner,
    runners,
    async close() {
      try {
        await app.close();
      } finally {
        await Promise.all(runners.map((platformRunner) => platformRunner.close?.()));
      }
    },
  };
}

export async function startControlPlane(): Promise<void> {
  loadLocalServerEnvironment();
  const runtime = await createControlPlaneRuntime();
  await runtime.app.listen({ host: runtime.config.api.host, port: runtime.config.api.port });
  console.log(`Agent Harness Lab server listening at http://${runtime.config.api.host}:${runtime.config.api.port}`);

  const shutdown = async (): Promise<void> => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await runtime.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  startControlPlane().catch((error: unknown) => {
    console.error("Server stopped:", error);
    process.exitCode = 1;
  });
}
