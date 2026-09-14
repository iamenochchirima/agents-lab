import type { RunManifest } from "../domain/types.js";
import type { PlatformRunner } from "../ports/runner.js";

export type PlatformRegistrationStatus = "runnable" | "planned";

export interface PlatformRegistration {
  readonly platform: string;
  readonly variant: string;
  readonly status: PlatformRegistrationStatus;
  readonly runner: PlatformRunner | null;
}

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
  ["aws-step-functions", "baseline"],
] as const;

/**
 * Explicitly advertises the runnable surface. Planned entries are visible to
 * callers so a UI can explain availability without pretending to execute them.
 */
export class PlatformRegistry {
  private readonly registrations: readonly PlatformRegistration[];

  constructor(runners: readonly PlatformRunner[]) {
    const runnableKeys = new Set(runners.map((runner) => key(runner.platform, runner.variant)));
    this.registrations = PLANNED_PLATFORM_VARIANTS.map(([platform, variant]) => {
      const runner = runners.find((candidate) => key(candidate.platform, candidate.variant) === key(platform, variant)) ?? null;
      return {
        platform,
        variant,
        status: runnableKeys.has(key(platform, variant)) ? "runnable" : "planned",
        runner,
      };
    });
  }

  list(): readonly PlatformRegistration[] {
    return this.registrations;
  }

  find(platform: string, variant: string): PlatformRegistration | null {
    return this.registrations.find((registration) => registration.platform === platform && registration.variant === variant) ?? null;
  }

  runnable(manifest: RunManifest): PlatformRunner | null {
    const registration = this.find(manifest.platform, manifest.variant);
    return registration?.status === "runnable" ? registration.runner : null;
  }
}

function key(platform: string, variant: string): string {
  return `${platform}/${variant}`;
}
