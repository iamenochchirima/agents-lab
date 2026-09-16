import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BrowserArtifactStore,
  BrowserError,
  BrowserFilePolicy,
  asBrowserSessionId,
  asBrowserTabId,
} from "../src/browser/index.js";
import { Workspace } from "../src/workspace/workspace.js";
import { pngFixture } from "./browser-fixtures.js";

test("browser artifact store writes bounded screenshot metadata under its managed root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-"));
  try {
    const store = new BrowserArtifactStore(root, { maxScreenshotBytes: 64, now: () => "2026-09-15T00:00:00.000Z" });
    const target = await store.createScreenshotTarget(asBrowserSessionId("browser_artifact"), asBrowserTabId("tab_artifact"));
    const bytes = pngFixture(320, 240);
    await writeFile(target.path, bytes);

    const artifact = await store.finalizeScreenshot(target, { byteSize: bytes.length, width: 320, height: 240 });
    assert.equal(artifact.kind, "screenshot");
    assert.equal(artifact.byteSize, bytes.length);
    assert.equal(artifact.width, 320);
    assert.equal(artifact.height, 240);
    assert.equal(artifact.mimeType, "image/png");
    assert.equal(artifact.createdAt, "2026-09-15T00:00:00.000Z");
    assert.equal((await stat(artifact.path)).size, bytes.length);
    assert.deepEqual(JSON.parse(await readFile(`${artifact.path}.json`, "utf8")), artifact);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact store rejects oversized screenshots and removes the file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-limit-"));
  try {
    const store = new BrowserArtifactStore(root, { maxScreenshotBytes: 4 });
    const target = await store.createScreenshotTarget(asBrowserSessionId("browser_limit"), asBrowserTabId("tab_limit"));
    await writeFile(target.path, Buffer.from("too-large"));

    await assert.rejects(
      store.finalizeScreenshot(target, { byteSize: 9, width: 1, height: 1 }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    await assert.rejects(stat(target.path), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact store rejects screenshots over the configured pixel bounds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-dimensions-"));
  try {
    const store = new BrowserArtifactStore(root, { maxScreenshotBytes: 1_024, maxScreenshotWidth: 100, maxScreenshotHeight: 100 });
    const target = await store.createScreenshotTarget(asBrowserSessionId("browser_dimensions"), asBrowserTabId("tab_dimensions"));
    const bytes = pngFixture(101, 100);
    await writeFile(target.path, bytes);

    await assert.rejects(
      store.finalizeScreenshot(target, { byteSize: bytes.length, width: 101, height: 100 }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation" && /pixel/u.test(error.message),
    );
    await assert.rejects(stat(target.path), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact finalization rejects symlink targets and mismatched observations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-finalize-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-finalize-outside-"));
  try {
    const store = new BrowserArtifactStore(root, { maxScreenshotBytes: 1_024, maxDownloadBytes: 1_024 });
    const screenshotTarget = await store.createScreenshotTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    const screenshotBytes = pngFixture();
    const outsideScreenshot = path.join(outside, "outside.png");
    await writeFile(outsideScreenshot, screenshotBytes);
    await symlink(outsideScreenshot, screenshotTarget.path);
    await assert.rejects(
      store.finalizeScreenshot(screenshotTarget, { byteSize: screenshotBytes.length, width: 1, height: 1 }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    assert.equal((await lstat(screenshotTarget.path).catch(() => undefined)) === undefined, true);
    assert.equal((await stat(outsideScreenshot)).isFile(), true);

    const mismatchedTarget = await store.createScreenshotTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    await writeFile(mismatchedTarget.path, screenshotBytes);
    await assert.rejects(
      store.finalizeScreenshot(mismatchedTarget, { byteSize: screenshotBytes.length, width: 2, height: 1 }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    await assert.rejects(stat(mismatchedTarget.path), { code: "ENOENT" });

    const downloadTarget = await store.createDownloadTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    const outsideDownload = path.join(outside, "outside.download");
    await writeFile(outsideDownload, "download");
    await symlink(outsideDownload, downloadTarget.path);
    await assert.rejects(
      store.finalizeDownload(downloadTarget, { byteSize: 8, fileName: "fixture.txt" }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    assert.equal((await stat(outsideDownload)).isFile(), true);

    const validDownloadTarget = await store.createDownloadTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    await writeFile(validDownloadTarget.path, "download");
    const validDownload = await store.finalizeDownload(validDownloadTarget, { byteSize: 8, fileName: "../evil\\name.txt" });
    assert.equal(validDownload.fileName, "evil_name.txt");

    const mismatchedDownloadTarget = await store.createDownloadTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    await writeFile(mismatchedDownloadTarget.path, "download");
    await assert.rejects(
      store.finalizeDownload(mismatchedDownloadTarget, { byteSize: 7, fileName: "fixture.txt" }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    await assert.rejects(stat(mismatchedDownloadTarget.path), { code: "ENOENT" });

    const metadataFailureTarget = await store.createDownloadTarget(asBrowserSessionId("browser_finalize"), asBrowserTabId("tab_finalize"));
    await writeFile(metadataFailureTarget.path, "download");
    await mkdir(`${metadataFailureTarget.path}.json`);
    await assert.rejects(
      store.finalizeDownload(metadataFailureTarget, { byteSize: 8, fileName: "fixture.txt" }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    await assert.rejects(stat(metadataFailureTarget.path), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser artifact paths reject symlinked managed directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-directory-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-directory-outside-"));
  try {
    const sessionDirectory = path.join(root, "browser_symlink");
    await mkdir(sessionDirectory);
    await symlink(outside, path.join(sessionDirectory, "screenshots"));
    const store = new BrowserArtifactStore(root);
    await assert.rejects(
      store.createScreenshotTarget(asBrowserSessionId("browser_symlink"), asBrowserTabId("tab_symlink")),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "artifact-violation",
    );
    assert.equal((await stat(outside)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser artifact cleanup removes expired pairs and orphans while retaining recent artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-cleanup-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-outside-"));
  try {
    let now = Date.parse("2026-09-15T00:00:00.000Z");
    let artifactNumber = 0;
    const store = new BrowserArtifactStore(root, {
      maxScreenshotBytes: 1_024,
      now: () => new Date(now).toISOString(),
      createArtifactId: () => `artifact_cleanup_${++artifactNumber}`,
    });
    const oldTarget = await store.createScreenshotTarget(asBrowserSessionId("browser_cleanup"), asBrowserTabId("tab_cleanup"));
    const oldBytes = pngFixture();
    await writeFile(oldTarget.path, oldBytes);
    await store.finalizeScreenshot(oldTarget, { byteSize: oldBytes.length, width: 1, height: 1 });

    now += 5_000;
    const freshTarget = await store.createScreenshotTarget(asBrowserSessionId("browser_cleanup"), asBrowserTabId("tab_cleanup"));
    const freshBytes = pngFixture();
    await writeFile(freshTarget.path, freshBytes);
    await store.finalizeScreenshot(freshTarget, { byteSize: freshBytes.length, width: 1, height: 1 });

    const orphanPath = path.join(root, "browser_cleanup", "screenshots", "artifact_orphan.png");
    await writeFile(orphanPath, "orphan");
    const oldSeconds = (now - 5_000) / 1_000;
    await utimes(orphanPath, oldSeconds, oldSeconds);
    const outsidePath = path.join(outside, "artifact_escape.download");
    await writeFile(outsidePath, "outside");
    await utimes(outsidePath, oldSeconds, oldSeconds);
    await symlink(outside, path.join(root, "browser_cleanup", "downloads"));

    const result = await store.cleanupExpired({ maxAgeMs: 1_000, maxEntries: 10, now: () => now });

    assert.equal(result.truncated, false);
    assert.ok(result.removed >= 2);
    await assert.rejects(stat(oldTarget.path), { code: "ENOENT" });
    await assert.rejects(stat(`${oldTarget.path}.json`), { code: "ENOENT" });
    await assert.rejects(stat(orphanPath), { code: "ENOENT" });
    assert.equal((await stat(outsidePath)).isFile(), true);
    assert.equal((await stat(freshTarget.path)).isFile(), true);
    assert.equal((await stat(`${freshTarget.path}.json`)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("browser artifact cleanup removes an expired temporary metadata publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-metadata-temp-"));
  try {
    const directory = path.join(root, "browser_metadata_temp", "screenshots");
    await mkdir(directory, { recursive: true });
    const temporaryMetadata = path.join(directory, "artifact_partial.png.json.tmp-123-abcd");
    await writeFile(temporaryMetadata, "{\"createdAt\":\"not-finished\"");
    const now = Date.parse("2026-09-15T00:00:00.000Z");
    await utimes(temporaryMetadata, (now - 5_000) / 1_000, (now - 5_000) / 1_000);

    const result = await new BrowserArtifactStore(root).cleanupExpired({ maxAgeMs: 1_000, maxEntries: 10, now: () => now });

    assert.equal(result.removed, 1);
    await assert.rejects(stat(temporaryMetadata), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact cleanup stops at its candidate bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-bound-"));
  try {
    const directory = path.join(root, "browser_bound", "screenshots");
    await mkdir(directory, { recursive: true });
    const first = path.join(directory, "artifact_first.png");
    const second = path.join(directory, "artifact_second.png");
    await writeFile(first, "first");
    await writeFile(second, "second");
    const oldSeconds = (Date.now() - 10_000) / 1_000;
    await utimes(first, oldSeconds, oldSeconds);
    await utimes(second, oldSeconds, oldSeconds);

    const result = await new BrowserArtifactStore(root).cleanupExpired({ maxAgeMs: 1_000, maxEntries: 1 });

    assert.equal(result.scanned, 1);
    assert.equal(result.truncated, true);
    assert.equal((await stat(first).catch(() => undefined)) === undefined || (await stat(second).catch(() => undefined)) === undefined, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact cleanup retains an in-flight artifact with a live lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-lease-"));
  try {
    const store = new BrowserArtifactStore(root);
    const target = await store.createScreenshotTarget(asBrowserSessionId("browser_lease"), asBrowserTabId("tab_lease"));
    await writeFile(target.path, "partial capture");
    const oldSeconds = (Date.now() - 10_000) / 1_000;
    await utimes(target.path, oldSeconds, oldSeconds);

    const result = await store.cleanupExpired({ maxAgeMs: 1_000, maxEntries: 10 });

    assert.equal(result.retained, 1);
    assert.equal(result.removed, 0);
    assert.equal((await stat(target.path)).isFile(), true);
    await store.discardScreenshot(target);
    await assert.rejects(stat(target.path), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser artifact cleanup retains an expired artifact with corrupt ownership metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-corrupt-lock-"));
  try {
    const directory = path.join(root, "browser_corrupt_lock", "screenshots");
    await mkdir(directory, { recursive: true });
    const artifact = path.join(directory, "artifact_corrupt.png");
    const lock = `${artifact}.lock`;
    await writeFile(artifact, "partial capture");
    await writeFile(lock, "not-json");
    const oldSeconds = (Date.now() - 10_000) / 1_000;
    await utimes(artifact, oldSeconds, oldSeconds);
    await utimes(lock, oldSeconds, oldSeconds);

    const result = await new BrowserArtifactStore(root).cleanupExpired({ maxAgeMs: 1_000, maxEntries: 10 });

    assert.equal(result.retained, 1);
    assert.equal(result.removed, 0);
    assert.equal((await stat(artifact)).isFile(), true);
    assert.equal((await stat(lock)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser upload policy accepts bounded regular workspace files and rejects links or traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-upload-"));
  try {
    await writeFile(path.join(root, "safe.txt"), "safe");
    await writeFile(path.join(root, "large.txt"), "this is too large");
    await symlink("safe.txt", path.join(root, "link.txt"));
    const workspace = await Workspace.open(root, { maxFileBytes: 128, maxDirectoryEntries: 20 });
    const policy = new BrowserFilePolicy(workspace.policy, { maxUploadBytes: 16 });

    const source = await policy.resolveUpload("safe.txt");
    assert.equal(source.requestedPath, "safe.txt");
    assert.equal(source.byteSize, 4);
    assert.equal(source.identity.size, 4);
    assert.equal(source.identity.contentHash.length, 64);
    await assert.rejects(policy.resolveUpload("link.txt"), /symbolic link/u);
    await assert.rejects(policy.resolveUpload("../outside.txt"), /outside/u);
    await assert.rejects(policy.resolveUpload("missing.txt"), /existing regular workspace file/u);
    await mkdir(path.join(root, "directory"));
    await assert.rejects(policy.resolveUpload("directory"), /existing regular workspace file/u);
    await assert.rejects(policy.resolveUpload(path.join(root, "safe.txt")), /Absolute paths are not allowed/u);
    await assert.rejects(new BrowserFilePolicy(workspace.policy, { maxUploadBytes: 4 }).resolveUpload("large.txt"), /exceeds/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
