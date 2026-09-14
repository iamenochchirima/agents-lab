import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";

import { loadServerConfig, type ServerConfig } from "./config.js";
import { RunEvidenceStore } from "../application/evidence-store.js";
import { PlatformRegistry } from "../application/platform-registry.js";
import { RunService } from "../application/run-service.js";
import { buildControlPlaneServer } from "../http/server.js";
import type { PlatformRunner } from "../ports/runner.js";
import { TemporalBaselineRunner } from "../../platforms/temporal/runner-adapter/temporal-runner.js";

export interface ControlPlaneRuntime {
  readonly app: FastifyInstance;
  readonly config: ServerConfig;
  readonly runner: PlatformRunner;
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

  const evidence = new RunEvidenceStore(config.runsRoot);
  const registry = new PlatformRegistry([runner]);
  const service = new RunService({ config, evidence, registry });
  const app = buildControlPlaneServer({ config, service, evidence, runner });

  return {
    app,
    config,
    runner,
    async close() {
      await app.close();
      await runner.close();
    },
  };
}

export async function startControlPlane(): Promise<void> {
  const runtime = await createControlPlaneRuntime();
  await runtime.app.listen({ host: runtime.config.api.host, port: runtime.config.api.port });
  console.log(`Agent Harness Lab API listening at http://${runtime.config.api.host}:${runtime.config.api.port}`);

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
    console.error("Control plane stopped:", error);
    process.exitCode = 1;
  });
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "Temporal connection could not be established.";
  }
  return `Temporal connection could not be established: ${error.message}`;
}
