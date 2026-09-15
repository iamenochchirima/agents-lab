import { loadVercelWorkflowsConfig } from "./config.js";
import { VercelWorkflowsPlatformService } from "./service/platform-service.js";

const service = new VercelWorkflowsPlatformService({ config: loadVercelWorkflowsConfig() });
await service.start();
console.log(`Vercel Workflows baseline listening at ${service.address}`);

const shutdown = async (): Promise<void> => {
  await service.stop();
  process.exit(0);
};
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
