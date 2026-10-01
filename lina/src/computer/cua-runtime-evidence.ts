import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ComputerRuntimeEvidence } from "./contracts.js";

interface CuaMetadataSource {
  readonly metadata?: (options?: unknown) => Promise<unknown>;
}

interface CuaRuntimeIdentity {
  readonly packageVersion?: string;
  readonly driverVersion?: string;
  readonly contractVersion?: string;
  readonly capabilityVersion?: string;
}

let packageVersionPromise: Promise<string | undefined> | undefined;

function boundedVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

async function findPackageVersion(): Promise<string | undefined> {
  try {
    const entry = fileURLToPath(import.meta.resolve("@trycua/cua-driver"));
    let directory = path.dirname(entry);
    for (let depth = 0; depth < 8; depth += 1) {
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const record = parsed as Record<string, unknown>;
          if (record.name === "@trycua/cua-driver") return boundedVersion(record.version);
        }
      } catch {
        // Keep walking. pnpm and npm place the package entry at different depths.
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // Package metadata is diagnostic evidence. Capability proof remains authoritative.
  }
  return undefined;
}

async function installedPackageVersion(): Promise<string | undefined> {
  packageVersionPromise ??= findPackageVersion();
  return packageVersionPromise;
}

export async function readCuaRuntimeIdentity(source: CuaMetadataSource): Promise<CuaRuntimeIdentity> {
  let metadata: Record<string, unknown> | undefined;
  if (source.metadata) {
    try {
      const value = await source.metadata();
      if (value && typeof value === "object" && !Array.isArray(value)) metadata = value as Record<string, unknown>;
    } catch {
      // A missing metadata response must not replace the stronger tool inventory proof.
    }
  }
  return {
    packageVersion: await installedPackageVersion(),
    driverVersion: boundedVersion(metadata?.driverVersion),
    contractVersion: boundedVersion(metadata?.contractVersion),
    capabilityVersion: boundedVersion(metadata?.capabilityVersion),
  };
}

export function addCuaRuntimeIdentity(
  evidence: ComputerRuntimeEvidence,
  identity: CuaRuntimeIdentity,
): ComputerRuntimeEvidence {
  return {
    ...evidence,
    ...(identity.packageVersion ? { packageVersion: identity.packageVersion } : {}),
    ...(identity.driverVersion ? { driverVersion: identity.driverVersion } : {}),
    ...(identity.contractVersion ? { contractVersion: identity.contractVersion } : {}),
    ...(identity.capabilityVersion && !evidence.capabilityVersion ? { capabilityVersion: identity.capabilityVersion } : {}),
  };
}
