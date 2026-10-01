import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CuaBrowserManifestOptions {
  readonly basePath: string;
  readonly outputPath: string;
  /** A private application-owned directory containing only revalidated upload copies. */
  readonly uploadRoot: string;
  /** Adds the stronger existing-profile ceiling only for an explicit deployment opt-in. */
  readonly existingProfileEnabled?: boolean;
  /** Enable only after inspecting the installed native Cua tool inventory. */
  readonly selectOptionAvailable?: boolean;
}

export interface CuaBrowserManifestResult {
  readonly manifestPath: string;
  readonly uploadRoot: string;
}

export interface CuaBrowserTaskManifestOptions {
  readonly basePath: string;
  readonly outputPath: string;
  readonly allowedOrigins: readonly string[];
}

function yamlString(value: string): string {
  // JSON strings are valid YAML double-quoted scalars and safely encode spaces,
  // backslashes, quotes, and control characters in deployment paths.
  return JSON.stringify(value);
}

function addExistingProfileCapability(manifest: string): string {
  const isolatedEntries = Array.from(manifest.matchAll(/^([ ]*)- kind: isolated[ \t]*$/gmu));
  if (isolatedEntries.length !== 1) {
    throw new Error("The base Cua browser manifest must contain exactly one isolated browser profile.");
  }
  const [entry] = isolatedEntries;
  if (!entry) throw new Error("The isolated browser profile entry could not be read.");
  const indentation = entry[1] ?? "";
  return manifest.replace(entry[0], `${indentation}- kind: isolated\n${indentation}- kind: existing_profile`);
}

/** Probe before creating a bounded manifest: unknown tool names make Cua refuse the whole driver. */
export async function installedCuaSupportsBrowserSelectOption(): Promise<boolean> {
  try {
    const { CuaDriver } = await import("@trycua/cua-driver");
    const driver = CuaDriver.create(undefined);
    try {
      const inventory: unknown = JSON.parse(await driver.listToolsJson());
      if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return false;
      const record = inventory as { readonly schema_version?: unknown; readonly tools?: unknown };
      return record.schema_version === "1"
        && Array.isArray(record.tools)
        && record.tools.some((tool) => tool && typeof tool === "object" && !Array.isArray(tool)
          && (tool as { readonly name?: unknown }).name === "browser_select_option");
    } finally {
      await driver.shutdown();
      if ("uniffiDestroy" in driver && typeof driver.uniffiDestroy === "function") driver.uniffiDestroy();
    }
  } catch {
    // Capability discovery must not prevent ordinary chat from starting when
    // the optional Cua native runtime is unavailable. Browser preflight reports
    // that runtime failure if the user actually requests browser work.
    return false;
  }
}

function addSelectOptionCapability(manifest: string): string {
  const typeTool = /^    - browser_type\n/gmu;
  if (Array.from(manifest.matchAll(typeTool)).length !== 1 || /^    - browser_select_option\s*$/mu.test(manifest)) {
    throw new Error("The base Cua browser manifest must contain browser_type once and must not already admit browser_select_option.");
  }
  return manifest.replace(typeTool, "    - browser_type\n    - browser_select_option\n");
}

function canonicalTaskOrigins(origins: readonly string[]): readonly string[] {
  const canonical = [...new Set(origins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      throw new Error("A task browser manifest accepts only credential-free HTTP(S) origins.");
    }
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Task browser origin '${origin}' is not canonical.`);
    }
    return parsed.origin;
  }))].sort();
  return canonical;
}

/**
 * Derive a browser task manifest from Lina's application ceiling, replacing
 * only its origin list. Cua's trusted session binds this immutable file for
 * the lifetime of one browser task.
 */
export async function createCuaBrowserTaskManifest(options: CuaBrowserTaskManifestOptions): Promise<string> {
  const basePath = path.resolve(options.basePath);
  const outputPath = path.resolve(options.outputPath);
  if (basePath === outputPath) throw new Error("The task Cua browser manifest must not overwrite its base manifest.");
  const base = await readFile(basePath, "utf8");
  const originSections = Array.from(base.matchAll(/^    origins:\n(?:      - .*\n)+/gmu));
  if (originSections.length !== 1) {
    throw new Error("The base Cua browser manifest must contain exactly one non-empty browser origin list.");
  }
  const origins = ["about:blank", ...canonicalTaskOrigins(options.allowedOrigins)];
  const originBlock = `    origins:\n${origins.map((origin) => `      - ${yamlString(origin)}\n`).join("")}`;
  const derived = base.replace(originSections[0]![0], originBlock);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, derived, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return outputPath;
}

/**
 * Derive the runtime browser manifest from the checked-in capability ceiling.
 * Cua requires file roots to be absolute and to exist when the driver is created,
 * while Lina's workspace is deployment-specific. The derived file is immutable
 * after startup and grants only the private staging root, never the workspace.
 */
export async function createCuaBrowserManifest(options: CuaBrowserManifestOptions): Promise<CuaBrowserManifestResult> {
  const basePath = path.resolve(options.basePath);
  const manifestPath = path.resolve(options.outputPath);
  const uploadRoot = path.resolve(options.uploadRoot);
  if (basePath === manifestPath) throw new Error("The derived Cua browser manifest must not overwrite its base manifest.");
  if (!path.isAbsolute(options.uploadRoot)) throw new Error("The Cua browser upload root must be an absolute path.");

  const base = await readFile(basePath, "utf8");
  if (/^\s{2}files:\s*$/mu.test(base)) {
    throw new Error("The base Cua browser manifest already declares resources.files.");
  }
  // The root is private to one application/session. Remove only that exact
  // owned root so an interrupted run cannot leave stale files readable by Cua.
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  const normalized = base.endsWith("\n") ? base : `${base}\n`;
  const withProfileCeiling = options.existingProfileEnabled === true
    ? addExistingProfileCapability(normalized)
    : normalized;
  const withOptionalTool = options.selectOptionAvailable === true
    ? addSelectOptionCapability(withProfileCeiling)
    : withProfileCeiling;
  const derived = `${withOptionalTool}  files:\n    read:\n      - dir: ${yamlString(uploadRoot)}\n        recursive: true\n`;
  await writeFile(manifestPath, derived, { encoding: "utf8", mode: 0o600 });
  return { manifestPath, uploadRoot };
}
