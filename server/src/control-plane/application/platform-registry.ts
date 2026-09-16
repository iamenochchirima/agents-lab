import type { RunManifest } from "../domain/types.js";
import type { PlatformRunner, RunnerConnectivity } from "../ports/runner.js";

export type PlatformRegistrationStatus = "runnable" | "planned";

export interface PlatformRegistration {
  readonly platform: string;
  readonly variant: string;
  readonly status: PlatformRegistrationStatus;
  readonly runner: PlatformRunner | null;
}

export type PlatformConnection = PlatformRegistration & {
  readonly connectivity: RunnerConnectivity;
};

const PLANNED_PLATFORM_VARIANTS = [
  ["temporal", "baseline"],
  ["restate", "baseline"],
  ["langgraph", "baseline"],
  ["mastra", "baseline"],
  ["vercel-workflows", "baseline"],
  ["inngest", "baseline"],
  ["trigger-dev", "baseline"],
  ["dbos", "baseline"],
  ["hatchet", "baseline"],
] as const;

/**
 * Explicitly advertises the runnable surface. Planned entries are visible to
 * callers so a UI can explain availability without pretending to execute them.
 */
export class PlatformRegistry {
  private readonly registrations: readonly PlatformRegistration[];

  constructor(runners: readonly PlatformRunner[]) {
    const registrations = new Map<string, PlatformRegistration>();

    for (const [platform, variant] of PLANNED_PLATFORM_VARIANTS) {
      registrations.set(key(platform, variant), { platform, variant, status: "planned", runner: null });
    }

    for (const runner of runners) {
      const registrationKey = key(runner.platform, runner.variant);
      if (registrations.get(registrationKey)?.status === "runnable") {
        throw new Error(`Duplicate platform runner registration: ${registrationKey}`);
      }
      registrations.set(registrationKey, {
        platform: runner.platform,
        variant: runner.variant,
        status: "runnable",
        runner,
      });
    }

    this.registrations = [...registrations.values()];
  }

  list(): readonly PlatformRegistration[] {
    return this.registrations;
  }

  find(platform: string, variant: string): PlatformRegistration | null {
    return this.registrations.find((registration) => registration.platform === platform && registration.variant === variant) ?? null;
  }

  runnableFor(platform: string, variant: string): PlatformRunner | null {
    const registration = this.find(platform, variant);
    return registration?.status === "runnable" ? registration.runner : null;
  }

  runnable(manifest: RunManifest): PlatformRunner | null {
    return this.runnableFor(manifest.platform, manifest.variant);
  }

  async checkConnections(): Promise<readonly (PlatformRegistration & { readonly connectivity: RunnerConnectivity })[]> {
    return Promise.all(
      this.registrations
        .filter((registration): registration is PlatformRegistration & { readonly runner: PlatformRunner } => registration.runner !== null)
        .map(async (registration) => ({
          ...registration,
          connectivity: await registration.runner.checkConnection(),
        })),
    );
  }

  /**
   * Checks one selected platform without requiring every optional platform
   * service to be healthy. The browser uses this seam for platform-local
   * readiness; aggregate `/health` remains useful for whole-lab diagnostics.
   */
  async checkConnection(platform: string, variant: string): Promise<PlatformConnection | null> {
    const registration = this.find(platform, variant);
    if (!registration) return null;
    if (!registration.runner) {
      return {
        ...registration,
        connectivity: { reachable: false, message: "Platform runner is not registered." },
      };
    }
    return {
      ...registration,
      connectivity: await registration.runner.checkConnection(),
    };
  }
}


function key(platform: string, variant: string): string {
  return `${platform}/${variant}`;
}
