import type { FastifyInstance } from "fastify";

import { StudioComparisonService } from "./application/comparison-service.js";
import { StudioEvidenceStore } from "./adapters/evidence-store.js";
import type { StudioModelAdapter } from "./adapters/replay-model.js";
import { registerStudioRoutes } from "./http/routes.js";

export interface StudioModule {
  readonly service: StudioComparisonService;
  register(app: FastifyInstance): void;
}

export interface StudioModuleOptions {
  /** Explicit injection keeps live-provider execution opt-in. */
  readonly model?: StudioModelAdapter;
}

/**
 * Builds Studio's dependencies without changing the existing control-plane
 * composition. The returned module is registered on the same Fastify instance.
 */
export function createStudioModule(runsRoot: string, options: StudioModuleOptions = {}): StudioModule {
  const service = new StudioComparisonService({
    evidence: new StudioEvidenceStore(runsRoot),
    model: options.model,
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
export * from "./strategies/index.js";
