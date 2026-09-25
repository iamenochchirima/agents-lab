import { parseStudioApiConfig } from "./config.js";
import { createStudioApiApp } from "./http/app.js";

const config = parseStudioApiConfig(process.env);
const app = await createStudioApiApp({ webOrigin: config.webOrigin, logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, "Studio API failed to start");
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error, "Studio API failed to shut down cleanly");
      process.exitCode = 1;
    });
  });
}
