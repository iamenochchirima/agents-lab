import { loadInngestConfig } from "./config.js";
import { InngestPlatformService } from "./service/platform-service.js";

export async function startInngestService(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const service = new InngestPlatformService({ config: loadInngestConfig(environment) });
  await service.initialize();
  const server = service.createHttpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(service.config.servicePort, "127.0.0.1", () => resolve());
  });
  process.stdout.write(`Inngest baseline service listening on ${service.config.serviceUrl}\n`);

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startInngestService();
}
