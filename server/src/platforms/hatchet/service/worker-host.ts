import type {
  HatchetClient,
  TaskWorkflowDeclaration,
  Worker,
} from "@hatchet-dev/typescript-sdk";

import { loadLocalServerEnvironment } from "../../../control-plane/bootstrap/local-env.js";
import { loadHatchetConfig, type HatchetConfig } from "../config.js";
import { createHatchetBaselineTask } from "../variants/baseline/execution/task.js";
import type {
  HatchetPromptInput,
  HatchetTaskOutput,
} from "../variants/baseline/contracts.js";
import { loadHatchetSdk } from "../sdk.js";

export interface HatchetWorkerHost {
  readonly config: HatchetConfig;
  readonly client: HatchetClient;
  readonly task: TaskWorkflowDeclaration<HatchetPromptInput, HatchetTaskOutput>;
  readonly worker: Worker;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class HatchetWorkerHostImpl implements HatchetWorkerHost {
  private workerPromise: Promise<void> | null = null;

  constructor(
    readonly config: HatchetConfig,
    readonly client: HatchetClient,
    readonly task: TaskWorkflowDeclaration<
      HatchetPromptInput,
      HatchetTaskOutput
    >,
    readonly worker: Worker,
  ) {}

  async start(): Promise<void> {
    this.workerPromise ??= this.worker.start();
    await this.worker.waitUntilReady(this.config.requestTimeoutMs * 10);
  }

  async stop(): Promise<void> {
    if (!this.workerPromise) return;
    await this.worker.stop();
    await this.workerPromise;
    this.workerPromise = null;
  }
}

/**
 * Builds the full Hatchet client/task/worker topology. The worker is separate
 * from the Lab HTTP server so worker restart and server restart remain
 * observable failure boundaries.
 */
export async function createHatchetWorkerHost(
  config: HatchetConfig = loadHatchetConfig(),
): Promise<HatchetWorkerHost> {
  if (!config.clientToken)
    throw new Error(
      "HATCHET_CLIENT_TOKEN is required to start the Hatchet worker.",
    );

  const sdk = loadHatchetSdk();
  const client = sdk.HatchetClient.init({
    token: config.clientToken,
    host_port: config.hostPort,
    api_url: config.apiUrl,
    tenant_id: config.tenantId,
    tls_config: { tls_strategy: config.tlsStrategy },
  });
  const task = createHatchetBaselineTask(client, config);
  const worker = await client.worker(config.workerName, {
    slots: config.workerSlots,
  });
  await worker.registerWorkflows([task]);
  return new HatchetWorkerHostImpl(config, client, task, worker);
}

export async function startHatchetWorker(): Promise<void> {
  loadLocalServerEnvironment();
  const host = await createHatchetWorkerHost();

  try {
    await host.start();
    process.stdout.write(
      `Hatchet worker ${host.config.workerName} is ready for ${host.config.taskName}\n`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    await host.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHatchetWorker().catch((error: unknown) => {
    console.error("Hatchet worker stopped:", error);
    process.exitCode = 1;
  });
}
