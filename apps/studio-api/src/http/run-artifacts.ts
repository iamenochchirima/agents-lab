import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { JsonValue } from "@agent-harness-lab/agent-protocol";

const ARTIFACT_NAMES = new Set(["config.json", "result.json"]);

export interface RunArtifactStore {
  readonly rootDirectory: string;
  readonly runDirectory: string;
  write(name: "config.json" | "result.json", value: unknown): Promise<void>;
}

/** Create a private run directory beneath the trusted host-selected runs root. */
export async function createRunArtifactStore(rootDirectory: string, runId: string): Promise<RunArtifactStore> {
  const requestedRoot = resolve(rootDirectory);
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Studio runs root must be a real directory, not a symbolic link.");
  const safeRoot = await realpath(requestedRoot);
  const runDirectory = join(safeRoot, `run-${encodeURIComponent(runId)}`);
  await mkdir(runDirectory, { mode: 0o700 });
  const runStat = await lstat(runDirectory);
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) throw new Error("Studio run path must be a newly created real directory.");

  return Object.freeze({
    rootDirectory: safeRoot,
    runDirectory,
    async write(name: "config.json" | "result.json", value: unknown): Promise<void> {
      if (!ARTIFACT_NAMES.has(name)) throw new Error("Unsupported Studio run artifact name.");
      const filePath = join(runDirectory, name);
      const serialized = `${JSON.stringify(toJson(value), null, 2)}\n`;
      const handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      const directoryHandle = await open(runDirectory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    },
  });
}

function toJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as JsonValue;
}
