import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WorkflowApi = typeof import("workflow/api");
type WorkflowRuntime = typeof import("workflow/runtime");
type WorkflowPackage = typeof import("workflow");
type WorkflowLocalWorld = typeof import("@workflow/world-local");
type WorkflowBuilders = typeof import("@workflow/builders");
export type LocalWorld = import("@workflow/world-local").LocalWorld;

const requireFromPlatform = createRequire(import.meta.url);
const platformDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * The Workflow SDK is intentionally installed under this platform directory,
 * not in the shared server manifest. Resolve from source and compiled roots so
 * both `tsx` development and the root server's emitted `dist` can run without
 * making the platform dependency global.
 */
export function requirePlatformDependency<T>(specifier: string): T {
  const sourceDirectory = platformDirectory.replace(/\/dist\/src(?=\/|$)/, "/src");
  const candidates = [
    platformDirectory,
    sourceDirectory,
    resolve(process.cwd(), "src/platforms/vercel-workflows"),
    resolve(process.cwd(), "server/src/platforms/vercel-workflows"),
  ];
  for (const candidate of candidates) {
    try {
      return requireFromPlatform(requireFromPlatform.resolve(specifier, { paths: [candidate] })) as T;
    } catch {
      // Continue through the explicit platform-local locations.
    }
  }
  throw new Error(
    `Unable to resolve ${specifier} for Vercel Workflows. Install workspace dependencies with pnpm install from the repository root.`,
  );
}

const workflowApi = requirePlatformDependency<WorkflowApi>("workflow/api");
const workflowRuntime = requirePlatformDependency<WorkflowRuntime>("workflow/runtime");
const workflowPackage = requirePlatformDependency<WorkflowPackage>("workflow");
const workflowLocalWorld = requirePlatformDependency<WorkflowLocalWorld>("@workflow/world-local");
const workflowBuilders = requirePlatformDependency<WorkflowBuilders>("@workflow/builders");

export const { getRun, start } = workflowApi;
export const setWorld: WorkflowRuntime["setWorld"] = workflowRuntime.setWorld;
export const { FatalError, getStepMetadata, sleep } = workflowPackage;
export const { createWorld } = workflowLocalWorld;
export const { StandaloneBuilder } = workflowBuilders;
