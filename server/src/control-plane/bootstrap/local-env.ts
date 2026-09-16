import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_SERVER_ENV_KEYS = [
  "AGENTLAB_ALLOWED_MODEL_PROVIDERS",
  "AGENTLAB_STUDIO_RUN_ROOT",
  "AGENTLAB_CONTEXT_MAX_SESSION_BYTES",
  "AGENTLAB_CONTEXT_MAX_TRANSCRIPT_BYTES",
  "AGENTLAB_OPENROUTER_BASE_URL",
  "AGENTLAB_OPENROUTER_CATALOG_TIMEOUT_MS",
  "AGENTLAB_OPENROUTER_CATALOG_TTL_MS",
  "AGENTLAB_OPENROUTER_CATALOG_LIMIT",
  "AGENTLAB_OPENROUTER_DEFAULT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
] as const;

/**
 * Load the small set of local-only server settings used by the server.
 *
 * This intentionally is not a general environment loader. Production and
 * deployed processes should receive secrets from their runtime environment;
 * local development may keep them in the ignored server/.env file. Explicit
 * process environment values always win over the local file.
 */
export function loadLocalServerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  envFilePath = findLocalServerEnvFile(),
): readonly string[] {
  if (!envFilePath || !existsSync(envFilePath)) {
    return [];
  }

  const values = parseLocalEnvironment(readFileSync(envFilePath, "utf8"));
  const loaded: string[] = [];

  for (const key of LOCAL_SERVER_ENV_KEYS) {
    if (environment[key] === undefined && values[key] !== undefined) {
      environment[key] = values[key];
      loaded.push(key);
    }
  }

  return loaded;
}

function findLocalServerEnvFile(): string | undefined {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "server/.env"),
    resolve(moduleDirectory, "../../../.env"),
    resolve(moduleDirectory, "../../../../.env"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function parseLocalEnvironment(contents: string): Partial<Record<(typeof LOCAL_SERVER_ENV_KEYS)[number], string>> {
  const values: Partial<Record<(typeof LOCAL_SERVER_ENV_KEYS)[number], string>> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1] as (typeof LOCAL_SERVER_ENV_KEYS)[number];
    if (!LOCAL_SERVER_ENV_KEYS.includes(key)) {
      continue;
    }

    values[key] = unquote(match[2].trim());
  }

  return values;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
