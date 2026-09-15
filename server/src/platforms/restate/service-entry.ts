import * as restate from "@restatedev/restate-sdk/node";

import { loadRestateConfig } from "./config.js";
import { restateServices } from "./service/baseline-service.js";

export async function startRestateService(environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = loadRestateConfig(environment);
  return restate.serve({ services: [...restateServices], port: config.servicePort });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startRestateService();
}
