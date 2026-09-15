import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type * as DbosSdk from "@dbos-inc/dbos-sdk";

let cached: typeof DbosSdk | null = null;

/**
 * Resolve the platform-local SDK in both source and compiled server layouts.
 * DBOS is intentionally not a root dependency: its workflow registry must stay
 * on the platform side of the repository boundary.
 */
export function loadDbosSdk(): typeof DbosSdk {
  if (cached) return cached;

  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const searchPaths = [
    here,
    resolve(here, "../../../../src/platforms/dbos"),
    resolve(here, "../../../../../src/platforms/dbos"),
  ];
  const configuredPath = process.env.AGENTLAB_DBOS_SDK_MODULE?.trim();
  const candidates = configuredPath ? [configuredPath] : searchPaths;

  for (const candidate of candidates) {
    try {
      const packagePath = require.resolve("@dbos-inc/dbos-sdk", { paths: [candidate] });
      cached = require(packagePath) as typeof DbosSdk;
      return cached;
    } catch {
      // Try the next source/dist resolution root.
    }
  }

  throw new Error("The DBOS SDK is not available from the platform-local dependency boundary.");
}
