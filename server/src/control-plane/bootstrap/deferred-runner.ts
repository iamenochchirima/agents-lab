import type { RunManifest, PlatformExecutionReference } from "../domain/types.js";
import type { PlatformRunner, RunnerConnectivity, RunnerCancellationResult, RunnerInspection, RunnerResumeResult } from "../ports/runner.js";

/**
 * Starts one optional native connector without delaying API composition. The
 * unavailable adapter supplies native metadata and validation until connection
 * succeeds; execution never waits for initialization or pretends it is ready.
 *
 * Initialization is attempted once per server lifetime. Restart the server to
 * retry a failed connector. Closing during initialization returns immediately;
 * any runner acquired later is closed before it can accept execution.
 */
export class DeferredPlatformRunner implements PlatformRunner {
  readonly platform: PlatformRunner["platform"];
  readonly variant: PlatformRunner["variant"];
  readonly resume?: (reference: PlatformExecutionReference, input: unknown) => Promise<RunnerResumeResult>;
  readonly recoverContextOverflow?: (manifest: RunManifest, reference: PlatformExecutionReference) => Promise<PlatformExecutionReference>;
  private runner: PlatformRunner | null = null;
  private state: "initializing" | "ready" | "unavailable" | "closed" = "initializing";
  private closePromise: Promise<void> | null = null;

  constructor(private readonly unavailable: PlatformRunner, connect: () => Promise<PlatformRunner>) {
    this.platform = unavailable.platform;
    this.variant = unavailable.variant;
    if (unavailable.resume) this.resume = async (reference, input) => this.requireRunner().resume!(reference, input);
    if (unavailable.recoverContextOverflow) {
      this.recoverContextOverflow = async (manifest, reference) => this.requireRunner().recoverContextOverflow!(manifest, reference);
    }
    // Resolve in a microtask so a synchronously throwing connector cannot escape
    // bootstrap, and install the rejection handler before native work begins.
    void Promise.resolve().then(connect).then(async (runner) => {
      if (this.state === "closed") {
        await runner.close?.();
        return;
      }
      this.runner = runner;
      this.state = "ready";
    }).catch(() => {
      if (this.state !== "closed") this.state = "unavailable";
      else console.warn(`${this.platform}/${this.variant} initialization or late cleanup failed after shutdown.`);
      // SDK errors can include private endpoints or credentials. The native
      // unavailable adapter supplies a bounded diagnostic instead.
    });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return (this.runner ?? this.unavailable).manifestConfiguration();
  }

  validate(manifest: RunManifest) {
    return (this.runner ?? this.unavailable).validate(manifest);
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.state === "ready") return this.runner!.checkConnection();
    if (this.state === "unavailable") return this.unavailable.checkConnection();
    return { reachable: false, message: `${this.platform}/${this.variant} is ${this.state}.` };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    return this.requireRunner().start(manifest);
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    return this.requireRunner().cancel(reference, reason);
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    return this.requireRunner().inspect(reference);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closed";
    this.closePromise = Promise.resolve().then(() => this.runner?.close?.());
    return this.closePromise;
  }

  private requireRunner(): PlatformRunner {
    if (this.state !== "ready" || !this.runner) {
      throw new Error(`${this.platform}/${this.variant} is ${this.state}.`);
    }
    return this.runner;
  }
}
