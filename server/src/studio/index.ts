import type { FastifyInstance } from "fastify";

import { StudioComparisonService } from "./application/comparison-service.js";
import { StudioEvidenceStore } from "./adapters/evidence-store.js";
import type { StudioModelAdapter } from "./adapters/replay-model.js";
import { registerStudioRoutes } from "./http/routes.js";
import { DEFAULT_STUDIO_MEMORY_LIMITS, FileStudioMemoryRepository, PolicyMemoryStore, memoryPolicies } from "./memory/index.js";

export interface StudioModule {
  readonly service: StudioComparisonService;
  register(app: FastifyInstance): void;
}

export interface StudioModuleOptions {
  /** Explicit injection keeps live-provider execution opt-in. */
  readonly model?: StudioModelAdapter;
  readonly memoryFactory?: ConstructorParameters<typeof StudioComparisonService>[0]["memoryFactory"];
}

/**
 * Builds Studio's dependencies without changing the existing control-plane
 * composition. The returned module is registered on the same Fastify instance.
 */
export function createStudioModule(runsRoot: string, options: StudioModuleOptions = {}): StudioModule {
  const evidence = new StudioEvidenceStore(runsRoot);
  const policies = new Map(memoryPolicies().map((policy) => [policy.adapterId, policy]));
  const service = new StudioComparisonService({
    evidence,
    model: options.model,
    memoryFactory: options.memoryFactory ?? ((input) => {
      const policy = policies.get(input.strategy.id);
      if (!policy) throw new Error(`Unknown Studio Memory policy: ${input.strategy.id}.`);
      const namespace = {
        comparisonId: input.comparisonId,
        trialId: input.trialId,
        scenarioId: input.scenario.id,
        sessionId: `studio-${input.scenario.id}`,
      } as const;
      return new PolicyMemoryStore(
        policy,
        new FileStudioMemoryRepository(evidence.memoryDirectory(input.comparisonId, input.trialId), namespace),
        DEFAULT_STUDIO_MEMORY_LIMITS,
      );
    }),
  });
  return {
    service,
    register(app) {
      registerStudioRoutes(app, service);
    },
  };
}

export * from "./application/comparison-service.js";
export * from "./adapters/evidence-store.js";
export * from "./adapters/replay-model.js";
export * from "./adapters/openrouter-model.js";
export * from "./catalog.js";
export * from "./domain/manifest.js";
export * from "./domain/state.js";
export * from "./domain/types.js";
export * from "./runtime/environment.js";
export * from "./runtime/contracts.js";
export * from "./runtime/baseline-components.js";
export * from "./runtime/harness-runtime.js";
export * from "./memory/index.js";
export * from "./strategies/index.js";
