import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { STUDIO_API_ID, STUDIO_API_VERSION, type StudioApiHealth } from "@agent-harness-lab/studio-http-contract";
import { registerStudioChatRoutes } from "./chat.js";
import { registerStudioContextExperimentRoutes } from "./context-experiments.js";
import { DEFAULT_STUDIO_RUNS_ROOT, DEFAULT_STUDIO_DATABASE_PATH } from "../config.js";
import { registerStudioComparisonRoutes } from "./comparison.js";
import { registerStudioLinaRoutes } from "./lina.js";

export interface StudioApiAppOptions {
  readonly webOrigin: string;
  readonly runsRoot?: string;
  readonly databasePath?: string;
  readonly logger?: boolean;
}

export async function createStudioApiApp(options: StudioApiAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: options.webOrigin, methods: ["GET", "HEAD", "POST", "PUT", "DELETE"] });

  app.get<{ Reply: StudioApiHealth }>("/health", async () => ({
    service: STUDIO_API_ID,
    status: "ok",
    apiVersion: STUDIO_API_VERSION,
  }));

  registerStudioChatRoutes(app, undefined, options.runsRoot ?? DEFAULT_STUDIO_RUNS_ROOT);
  registerStudioContextExperimentRoutes(app, options.runsRoot ?? DEFAULT_STUDIO_RUNS_ROOT);
  registerStudioComparisonRoutes(app, options.databasePath ?? DEFAULT_STUDIO_DATABASE_PATH);
  registerStudioLinaRoutes(app, options.databasePath ?? DEFAULT_STUDIO_DATABASE_PATH);

  return app;
}
