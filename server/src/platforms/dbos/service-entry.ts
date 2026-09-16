import { loadDbosConfig } from "./config.js";
import { DbosBaselineHost } from "./service/dbos-host.js";
import { loadLocalServerEnvironment } from "../../control-plane/bootstrap/local-env.js";

loadLocalServerEnvironment();
const host = new DbosBaselineHost({ config: loadDbosConfig() });

await host.start();
console.log(`AgentLab DBOS service listening at ${host.address}`);

const stop = async (): Promise<void> => {
  await host.stop();
};

process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
