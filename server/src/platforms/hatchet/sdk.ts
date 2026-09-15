import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type * as HatchetSdk from "@hatchet-dev/typescript-sdk";

let cached: typeof HatchetSdk | null = null;

/**
 * Hatchet is a platform-local dependency. Resolve it from both source and
 * compiled server layouts so the shared server package does not acquire a
 * framework-specific dependency.
 */
export function loadHatchetSdk(): typeof HatchetSdk {
  if (cached) return cached;

  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const searchPaths = [
    here,
    resolve(here, "../../../../src/platforms/hatchet"),
    resolve(here, "../../../../../src/platforms/hatchet"),
  ];
  const configuredPath = process.env.AGENTLAB_HATCHET_SDK_MODULE?.trim();
  const candidates = configuredPath ? [configuredPath] : searchPaths;

  for (const candidate of candidates) {
    try {
      const packagePath = require.resolve("@hatchet-dev/typescript-sdk/v1", {
        paths: [candidate],
      });
      cached = require(packagePath) as typeof HatchetSdk;
      return cached;
    } catch {
      // Try the next source/dist resolution root.
    }
  }

  throw new Error(
    "The Hatchet SDK is not available from the platform-local dependency boundary.",
  );
}
