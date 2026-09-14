import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import { loadServerConfig } from "../../../control-plane/bootstrap/config.js";
import { baselineActivities } from "../variants/baseline/activities.js";

/**
 * The worker is a separate process so killing it exercises Temporal recovery
 * instead of merely restarting an in-process callback.
 */
export async function startTemporalWorker(): Promise<void> {
  const config = loadServerConfig();
  const connection = await NativeConnection.connect({ address: config.temporal.endpoint });
  const workflowExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.taskQueue,
    workflowsPath: fileURLToPath(new URL(`../variants/baseline/workflow.${workflowExtension}`, import.meta.url)),
    activities: baselineActivities,
  });

  const shutdown = (): void => worker.shutdown();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await worker.run();
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await connection.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTemporalWorker().catch((error: unknown) => {
    console.error("Temporal worker stopped:", error);
    process.exitCode = 1;
  });
}
