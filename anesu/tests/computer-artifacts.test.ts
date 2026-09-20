import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ComputerArtifactError, ComputerArtifactStore } from "../src/computer/artifacts.js";
import type { ComputerEnvironmentObservation } from "../src/computer/contracts.js";

function observation(screenshotPath: string, overrides: Partial<ComputerEnvironmentObservation> = {}): ComputerEnvironmentObservation {
  return {
    observationId: "observation_artifact",
    environment: "ubuntu-x11-cua",
    sessionId: "session_artifact",
    generation: 1,
    text: "bounded desktop state",
    imageCount: 1,
    imageBytes: 12,
    screenshotPath,
    display: ":99",
    screenWidth: 320,
    screenHeight: 240,
    ...overrides,
  };
}

test("computer artifact store creates immutable metadata and a safe relative reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-artifact-store-"));
  const scratch = path.join(root, "scratch.png");
  const artifacts = path.join(root, "managed");
  try {
    await writeFile(scratch, Buffer.from("bounded-png-data"));
    const store = new ComputerArtifactStore(artifacts, { now: () => "2026-09-20T00:00:00.000Z" });
    store.beginRun("computer_run_artifact");
    const result = await store.captureObservation("computer_run_artifact", observation(scratch));
    assert.ok(result);
    assert.equal(result.runId, "computer_run_artifact");
    assert.equal(result.observationId, "observation_artifact");
    assert.equal(result.relativePath, path.join("computer_run_artifact", `${result.artifactId}.png`));
    assert.equal(result.path.startsWith(path.resolve(artifacts) + path.sep), true);
    assert.equal(await readFile(result.path, "utf8"), "bounded-png-data");
    assert.deepEqual(JSON.parse(await readFile(`${result.path}.json`, "utf8")), result);
    assert.equal(await readFile(scratch, "utf8"), "bounded-png-data");
    store.endRun("computer_run_artifact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computer artifact store fails closed for symlink and bound violations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-artifact-invalid-"));
  const outside = path.join(root, "outside.png");
  const linked = path.join(root, "linked.png");
  try {
    await writeFile(outside, Buffer.from("outside"));
    await symlink(outside, linked);
    const store = new ComputerArtifactStore(path.join(root, "managed"), { maxBytes: 4, maxWidth: 100, maxHeight: 100 });
    await assert.rejects(
      () => store.captureObservation("computer_run_invalid", observation(linked)),
      (error: unknown) => error instanceof ComputerArtifactError && error.code === "artifact-violation",
    );
    await writeFile(outside, Buffer.from("too-large"));
    await assert.rejects(
      () => store.captureObservation("computer_run_invalid", observation(outside)),
      (error: unknown) => error instanceof ComputerArtifactError && error.code === "artifact-violation",
    );
    await assert.rejects(
      () => store.captureObservation("../escape", observation(outside)),
      (error: unknown) => error instanceof ComputerArtifactError && error.code === "artifact-violation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computer artifact retention keeps active and recent runs and removes bounded old artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-computer-artifact-retention-"));
  try {
    const store = new ComputerArtifactStore(root, { now: () => "2026-09-20T00:00:00.000Z" });
    const create = async (runId: string, createdAt: string): Promise<void> => {
      const scratch = path.join(root, `${runId}.png`);
      await writeFile(scratch, Buffer.from("artifact"));
      const runStore = new ComputerArtifactStore(root, { now: () => createdAt });
      await runStore.captureObservation(runId, observation(scratch, { observationId: `observation_${runId}` }));
    };
    await create("computer_run_old", "2026-09-18T00:00:00.000Z");
    await create("computer_run_recent", "2026-09-19T12:00:00.000Z");
    store.beginRun("computer_run_active");
    const activeScratch = path.join(root, "active.png");
    await writeFile(activeScratch, Buffer.from("artifact"));
    await store.captureObservation("computer_run_active", observation(activeScratch, { observationId: "observation_active" }));

    const result = await store.cleanupExpired({ maxAgeMs: 24 * 60 * 60 * 1_000, maxEntries: 10, now: () => Date.parse("2026-09-20T00:00:00.000Z") });
    assert.equal(result.removed, 1);
    assert.equal(result.retained, 2);
    assert.equal(result.truncated, false);
    await assert.rejects(() => readFile(path.join(root, "computer_run_old")), /ENOENT/u);
    await readdir(path.join(root, "computer_run_recent"));
    await readdir(path.join(root, "computer_run_active"));
    store.endRun("computer_run_active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
