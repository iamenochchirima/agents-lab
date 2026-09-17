import type { FastifyInstance } from "fastify";

import { StudioComparisonService } from "./application/comparison-service.js";
import { StudioEvidenceStore } from "./adapters/evidence-store.js";
import { registerStudioRoutes } from "./http/routes.js";

export interface StudioModule {
  readonly service: StudioComparisonService;
  register(app: FastifyInstance): void;
}

/**
 * Builds Studio's dependencies without changing the existing control-plane
 * composition. The returned module is registered on the same Fastify instance.
 */
export function createStudioModule(runsRoot: string): StudioModule {
  const service = new StudioComparisonService({
    evidence: new StudioEvidenceStore(runsRoot),
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
export * from "./catalog.js";
export * from "./domain/manifest.js";
export * from "./domain/state.js";
export * from "./domain/types.js";
export * from "./runtime/environment.js";
export * from "./strategies/index.js";
