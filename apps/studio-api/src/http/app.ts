import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { STUDIO_API_ID, STUDIO_API_VERSION, type StudioApiHealth } from "@agent-harness-lab/studio-http-contract";

export interface StudioApiAppOptions {
  readonly webOrigin: string;
  readonly logger?: boolean;
}

export async function createStudioApiApp(options: StudioApiAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: options.webOrigin });

  app.get<{ Reply: StudioApiHealth }>("/health", async () => ({
    service: STUDIO_API_ID,
    status: "ok",
    apiVersion: STUDIO_API_VERSION,
  }));

  return app;
}
