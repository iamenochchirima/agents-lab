import { loadDbosConfig } from "./config.js";
import { DbosBaselineHost } from "./service/dbos-host.js";

const host = new DbosBaselineHost({ config: loadDbosConfig() });

await host.start();
console.log(`AgentLab DBOS service listening at ${host.address}`);

const stop = async (): Promise<void> => {
  await host.stop();
};

process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
