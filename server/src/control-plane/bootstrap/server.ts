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
import { loadRestateConfig } from "../../platforms/restate/config.js";
import { RestateBaselineRunner } from "../../platforms/restate/runner-adapter/restate-runner.js";
import { TemporalBaselineRunner } from "../../platforms/temporal/runner-adapter/temporal-runner.js";

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
  });
  const mastraRunner = new MastraBaselineRunner();
  const runners = [runner, restateRunner, langgraphRunner, mastraRunner] as const;
  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry(runners);
  const service = new RunService({ config, evidence, registry });
  const app = buildControlPlaneServer({ config, service, evidence, registry });

  return {
    app,
    config,
    runner,
    runners,
    async close() {
      await app.close();
      await runner.close();
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
