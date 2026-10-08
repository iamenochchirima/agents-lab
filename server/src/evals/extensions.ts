import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gradeExtension, type ExtensionInput } from "./extension-contracts.js";

/** Grade an evaluator-owned observation file, preserving its source references.
 * Unlike a native driver this makes no model/tool calls. */
export async function gradeExtensionFile(inputPath: string, outputPath: string): Promise<void> {
  const value: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(value)) throw new Error("Extension observation file must contain an array of case inputs.");
  const reports = value.map(input => gradeExtension(input as ExtensionInput));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ schemaVersion: 1, reports }, null, 2) + "\n", { flag: "wx" });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) throw new Error("Usage: extensions <observations.json> <new-report.json>");
  await gradeExtensionFile(resolve(input), resolve(output));
}
