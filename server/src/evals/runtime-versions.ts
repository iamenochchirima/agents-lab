import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const nativePackages = ["@mastra/core", "@mastra/libsql", "@temporalio/client", "@temporalio/worker", "@temporalio/workflow", "@restatedev/restate-sdk", "@restatedev/restate-sdk-clients"] as const;

/** Retain actual installed SDK versions rather than dependency ranges.
 * Missing packages stay explicitly unknown. Python/native service versions
 * belong to their separate runtime receipts, not this Node process inventory.
 */
export async function installedRuntimeVersions(): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all(nativePackages.map(async name => [name, await installedPackageVersion(name)] as const));
  return { node: process.version, ...Object.fromEntries(entries) };
}

async function installedPackageVersion(name: string): Promise<string> {
  let directory: string;
  try { directory = dirname(createRequire(import.meta.url).resolve(name)); }
  catch { return "unknown"; }
  while (true) {
    try {
      const contents = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (contents.name === name && typeof contents.version === "string" && contents.version.length > 0) return contents.version;
    } catch { /* A package export may resolve inside a nested distribution directory. */ }
    const parent = dirname(directory);
    if (parent === directory) return "unknown";
    directory = parent;
  }
}
