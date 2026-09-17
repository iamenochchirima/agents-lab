import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnesuError } from "../runtime/errors.js";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_LOCAL_ENV_PATH = path.join(packageDirectory, ".env");

function parseValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      throw new AnesuError("configuration", "The local .env file contains an invalid quoted value.");
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function loadLocalEnvironment(
  filePath: string = DEFAULT_LOCAL_ENV_PATH,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...baseEnvironment };
    throw new AnesuError("configuration", `Could not read local environment file '${path.basename(filePath)}'.`, { cause: error });
  }

  const environment = { ...baseEnvironment };
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      throw new AnesuError("configuration", `The local .env file has an invalid entry on line ${index + 1}.`);
    }
    const [, key, rawValue] = match;
    if (environment[key] === undefined) environment[key] = parseValue(rawValue);
  }
  return environment;
}
