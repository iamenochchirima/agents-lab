import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import { loadServerConfig, type ServerConfig } from "./config.js";
import { loadLocalServerEnvironment } from "./local-env.js";
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
import { createDefaultCapabilityCatalog } from "../../capabilities/catalog.js";
import { createPackageCapabilityCatalog } from "../../capabilities/extensions/catalog.js";

import { loadCapabilityPackages } from "../../capabilities/extensions/packages.js";
import { CapabilityHost } from "../../capabilities/extensions/host.js";
import { InvocationReviewStore } from "../../capabilities/reviews/store.js";
import { ConnectionManager, type ConnectionDefinition } from "../../capabilities/integrations/connections.js";
import { EncryptedFileSecretStore } from "../../capabilities/integrations/oauth/encrypted-file-store.js";
import { registerConnectionRoutes } from "../http/connections.js";
import { capabilityWorkspaceRoot } from "../../capabilities/extensions/runtime.js";

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
  let runner: TemporalBaselineRunner;
  try {
    runner = await TemporalBaselineRunner.connect(config);
  } catch (error) {
    runner = TemporalBaselineRunner.unavailable(config, safeMessage(error));
  }

  const restateRunner = await RestateBaselineRunner.connect(loadRestateConfig());
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
  const hatchetRunner = await HatchetBaselineRunner.connect();
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
  const packageBytes = packagePath ? await readFile(packagePath) : undefined;
  if (packageBytes && packageBytes.length > 262144) throw new Error("Capability configuration exceeds its limit.");
  const connectionDefinitions: ConnectionDefinition[] = packageBytes ? JSON.parse(packageBytes.toString()).connections ?? [] : [];
  const secretKey = process.env.AGENTLAB_OAUTH_SECRET_KEY_HEX;
  const secrets = secretKey && /^[a-f0-9]{64}$/i.test(secretKey)
    ? EncryptedFileSecretStore.fromEnvironment(join(config.contextRoot, ".oauth-secrets")) : undefined;
  const connections = await ConnectionManager.create(connectionDefinitions, {
    stateRoot: join(config.contextRoot, ".connections"), ...(secrets ? { secrets } : {}),
    ...(!secrets ? { oauthUnavailableReason: "OAuth secret encryption key is not configured." } : {}),
  });
  let packages = packagePath ? await loadCapabilityPackages(packagePath, { connections, allowUnavailable: true }) : undefined;
  const reportAvailability = () => {
    for (const definition of connectionDefinitions) connections.reportSourceAvailability(definition.ref, null);
    for (const pkg of packages?.packages ?? []) if (pkg.connectionRef && pkg.unavailableReason) connections.reportSourceAvailability(pkg.connectionRef, pkg.unavailableReason);
  };
  reportAvailability();
  const capabilities = packages
    ? createPackageCapabilityCatalog(packages, config.connectedCapabilitiesEnabled)
    : createDefaultCapabilityCatalog(undefined, { connectedEnabled: config.connectedCapabilitiesEnabled });
  const reviews = new InvocationReviewStore(config.runsRoot);
  const host = packages ? await CapabilityHost.create(evidence, packages.tools, sessions, reviews) : undefined;
  const service = new RunService({ config, context, evidence, modelMetadata: modelCatalog, registry, capabilities, reviews,
    ...(host ? { renewReview: async (runId: string, requestId: string) => {
      const previous = await reviews.get(runId, requestId);
      const renewed = await host.prepare({ runId, turnId: previous.turnId, catalogRevision: previous.catalogRevision, call: previous.call });
      if (!renewed) throw new Error("Action review is no longer available.");
      return renewed;
    } } : {}),
  });
  const app = buildControlPlaneServer({ config, modelCatalog, service, evidence, registry, capabilities });
  if (packages) {
    host!.register(app);
    app.get("/api/capability-packages", async (_request, reply) => reply.send({packages:packages?.packages ?? []}));
  }
  let refreshing: Promise<void> | undefined;
  const refreshCatalog = async () => {
    if (!packagePath || !host) return;
    if (!refreshing) refreshing = (async () => {
      for (const definition of connectionDefinitions) connections.reportSourceAvailability(definition.ref, null);
      const next = await loadCapabilityPackages(packagePath, { connections, allowUnavailable: true });
      const catalog = createPackageCapabilityCatalog(next, config.connectedCapabilitiesEnabled);
      host.replace(next.tools); capabilities.replace(catalog); packages = next; reportAvailability();
    })().finally(() => { refreshing = undefined; });
    await refreshing;
  };
  registerConnectionRoutes(app, connections, refreshCatalog);
  const studio = createStudioModule(config.studioRunsRoot, { memoryLimits: config.studioMemory });
  studio.register(app);

  return {
    app,
    config,
    runner,
    runners,
    async close() {
      await app.close();
      await Promise.all(
        runners.map((platformRunner) =>
          (platformRunner as PlatformRunner).close?.(),
        ),
      );
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

function safeMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "Temporal connection could not be established.";
  }
  return `Temporal connection could not be established: ${error.message}`;
}
