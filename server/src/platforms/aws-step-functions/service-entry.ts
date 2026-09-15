import { loadAwsStepFunctionsConfig } from "./config.js";
import { AwsStepFunctionsPlatformService } from "./service/step-functions-service.js";

export async function startAwsStepFunctionsService(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const service = new AwsStepFunctionsPlatformService({ config: loadAwsStepFunctionsConfig(environment) });
  await service.initialize();
  const server = service.createHttpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(service.config.servicePort, "127.0.0.1", () => resolve());
  });
  process.stdout.write(`AWS Step Functions baseline service listening on ${service.config.serviceUrl}\n`);

  const shutdown = (): void => {
    void service.close().finally(() => {
      server.close(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startAwsStepFunctionsService();
}
