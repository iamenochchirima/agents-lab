import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ComputerNativeError, redactSecrets } from "../runtime/errors.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${stableStringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

export async function atomicWriteJsonLines(filePath: string, values: readonly unknown[]): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${values.map((value) => stableStringify(value)).join("\n")}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const handle = await open(filePath, "a", 0o600);
  try {
    await handle.writeFile(`${stableStringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new ComputerNativeError(
      "persistence",
      `Could not read durable record '${path.basename(filePath)}'. Repair the record or remove the incomplete session deliberately.`,
      { cause: error },
    );
  }
}

export async function readJsonLines<T>(filePath: string): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new ComputerNativeError("persistence", `Could not read '${path.basename(filePath)}'.`, { cause: error });
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  return lines.map((line) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new ComputerNativeError(
        "persistence",
        `The durable record '${path.basename(filePath)}' contains malformed JSON. Repair it before continuing.`,
        { cause: error },
      );
    }
  });
}

export async function removeFileIfPresent(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export function safePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value)) {
    throw new ComputerNativeError("invalid-input", `${label} contains unsupported characters.`);
  }
  return value;
}

export function redactRecord(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactRecord(entry, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        key.toLowerCase().includes("authorization") || key.toLowerCase().includes("api_key") || key.toLowerCase().includes("apikey")
          ? "[REDACTED]"
          : redactRecord(entry, secrets),
      ]),
    );
  }
  return value;
}
