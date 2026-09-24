import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CuaNativeManifestOptions {
  readonly basePath: string;
  readonly outputPath: string;
  /** A private application-owned directory for Cua screenshot output only. */
  readonly screenshotRoot: string;
}

export interface CuaNativeManifestResult {
  readonly manifestPath: string;
  readonly screenshotRoot: string;
}

function yamlString(value: string): string {
  // JSON strings are valid YAML double-quoted scalars and safely encode spaces,
  // backslashes, quotes, and control characters in deployment paths.
  return JSON.stringify(value);
}

/**
 * Derive the native Cua manifest from the checked-in application ceiling.
 * Native observations ask Cua to write a screenshot into a task scratch root;
 * that exact root is the only additional filesystem resource granted here.
 * The derived manifest never broadens native applications or tool access.
 */
export async function createCuaNativeManifest(options: CuaNativeManifestOptions): Promise<CuaNativeManifestResult> {
  const basePath = path.resolve(options.basePath);
  const manifestPath = path.resolve(options.outputPath);
  const screenshotRoot = path.resolve(options.screenshotRoot);
  if (basePath === manifestPath) throw new Error("The derived Cua native manifest must not overwrite its base manifest.");
  if (!path.isAbsolute(options.screenshotRoot)) throw new Error("The Cua native screenshot root must be an absolute path.");

  const base = await readFile(basePath, "utf8");
  if (/^\s{2}files:\s*$/mu.test(base)) {
    throw new Error("The base Cua native manifest already declares resources.files.");
  }
  // Remove only this exact application-owned root so an interrupted run cannot
  // leave stale screenshots available to a later Cua runtime.
  await rm(screenshotRoot, { recursive: true, force: true });
  await mkdir(screenshotRoot, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
  const normalized = base.endsWith("\n") ? base : `${base}\n`;
  const derived = `${normalized}  files:\n    write:\n      - dir: ${yamlString(screenshotRoot)}\n        recursive: true\n`;
  await writeFile(manifestPath, derived, { encoding: "utf8", mode: 0o600 });
  return { manifestPath, screenshotRoot };
}
