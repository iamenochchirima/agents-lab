import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type * as HatchetSdk from "@hatchet-dev/typescript-sdk";

let cached: typeof HatchetSdk | null = null;
let cachedEmbedded: HatchetEmbeddedSdkModule | null = null;

export interface HatchetEmbeddedOptions {
  readonly version?: string;
  readonly postgresDataDir?: string;
  readonly grpcPort?: number;
  readonly apiPort?: number;
  readonly readyTimeoutMs?: number;
}

export interface HatchetEmbeddedClient extends HatchetSdk.HatchetClient {
  stopEmbedded(): Promise<void>;
}

export interface HatchetEmbeddedSdkModule {
  readonly HatchetEmbeddedClient: {
    init(options?: HatchetEmbeddedOptions): Promise<HatchetEmbeddedClient>;
  };
}

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

/**
 * Loads the optional embedded entry point from the same platform-local SDK
 * boundary as the normal client. Keeping this resolution here prevents the
 * shared server package from taking a direct dependency on Hatchet.
 */
export function loadHatchetEmbeddedSdk(): HatchetEmbeddedSdkModule {
  if (cachedEmbedded) return cachedEmbedded;

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
      const packagePath = require.resolve(
        "@hatchet-dev/typescript-sdk/v1/embedded",
        { paths: [candidate] },
      );
      cachedEmbedded = require(packagePath) as HatchetEmbeddedSdkModule;
      return cachedEmbedded;
    } catch {
      // Try the next source/dist resolution root.
    }
  }

  throw new Error(
    "The Hatchet embedded SDK is not available from the platform-local dependency boundary.",
  );
}
