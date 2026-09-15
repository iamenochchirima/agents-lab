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
import { loadHatchetEmbeddedSdk, loadHatchetSdk } from "../sdk.js";

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
  private embeddedStop: (() => Promise<void>) | null;

  constructor(
    readonly config: HatchetConfig,
    readonly client: HatchetClient,
    readonly task: TaskWorkflowDeclaration<
      HatchetPromptInput,
      HatchetTaskOutput
    >,
    readonly worker: Worker,
    embeddedStop?: () => Promise<void>,
  ) {
    this.embeddedStop = embeddedStop ?? null;
  }

  async start(): Promise<void> {
    this.workerPromise ??= this.worker.start();
    await this.worker.waitUntilReady(this.config.requestTimeoutMs * 10);
  }

  async stop(): Promise<void> {
    let failure: unknown = null;
    if (this.workerPromise) {
      const workerCompletion = this.workerPromise;
      try {
        await finishWithin(this.worker.stop(), 2_000);
      } catch (error) {
        failure = error;
      } finally {
        this.workerPromise = null;
      }
      // Hatchet's start promise represents the long-running listener and can
      // remain pending after stop() has completed its shutdown protocol. Keep
      // its rejection observed without making process shutdown depend on it.
      void workerCompletion.catch((error: unknown) => {
        if (!failure) failure = error;
      });
    }

    const embeddedStop = this.embeddedStop;
    this.embeddedStop = null;
    if (embeddedStop) {
      try {
        // The embedded SDK waits for the sidecar and its bundled Postgres to
        // exit, with its own force-kill deadline. Do not return early here:
        // callers may remove a test data directory or immediately start the
        // next local engine, and either action is unsafe while the child still
        // owns the database or network ports.
        // The SDK unreferences that child, so retain one local event-loop
        // handle while its shutdown promise is pending. Without this guard,
        // Node can report an empty event loop and abandon the await before
        // the sidecar's exit event is delivered.
        const shutdownKeepAlive = setInterval(() => undefined, 1_000);
        try {
          await embeddedStop();
        } finally {
          clearInterval(shutdownKeepAlive);
        }
      } catch (error) {
        failure ??= error;
      }
    }

    if (failure) throw failure;
  }
}

/**
 * Builds the full Hatchet client/task/worker topology. Embedded mode keeps the
 * engine and worker lifecycle inside the Lab server for a low-dependency local
 * run; remote mode preserves the separately deployed worker boundary.
 */
export async function createHatchetWorkerHost(
  config: HatchetConfig = loadHatchetConfig(),
): Promise<HatchetWorkerHost> {
  let client: HatchetClient;
  let embeddedStop: (() => Promise<void>) | undefined;

  if (config.runtimeMode === "embedded") {
    const embeddedSdk = loadHatchetEmbeddedSdk();
    const embeddedClient = await embeddedSdk.HatchetEmbeddedClient.init({
      version: config.embeddedVersion,
      apiPort: portFromUrl(config.apiUrl),
      grpcPort: portFromHostPort(config.hostPort),
      postgresDataDir: config.embeddedPostgresDataDir ?? undefined,
      readyTimeoutMs: config.embeddedReadyTimeoutMs,
    });
    client = embeddedClient;
    embeddedStop = embeddedClient.stopEmbedded;
  } else {
    if (!config.clientToken)
      throw new Error(
        "HATCHET_CLIENT_TOKEN is required when AGENTLAB_HATCHET_RUNTIME_MODE=remote.",
      );

    const sdk = loadHatchetSdk();
    client = sdk.HatchetClient.init({
      token: config.clientToken,
      host_port: config.hostPort,
      api_url: config.apiUrl,
      tenant_id: config.tenantId,
      tls_config: { tls_strategy: config.tlsStrategy },
    });
  }

  try {
    const task = createHatchetBaselineTask(client, config);
    const worker = await client.worker(config.workerName, {
      slots: config.workerSlots,
    });
    await worker.registerWorkflows([task]);
    return new HatchetWorkerHostImpl(
      config,
      client,
      task,
      worker,
      embeddedStop,
    );
  } catch (error) {
    if (embeddedStop) await embeddedStop().catch(() => undefined);
    throw error;
  }
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

async function finishWithin(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    operation,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function portFromUrl(value: string): number {
  const parsed = new URL(value);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

function portFromHostPort(value: string): number {
  return Number(value.slice(value.lastIndexOf(":") + 1));
}
