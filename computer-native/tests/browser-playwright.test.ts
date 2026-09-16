import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BrowserError,
  BrowserSessionManager,
  BrowserArtifactStore,
  BrowserTools,
  BrowserUrlPolicy,
  PlaywrightBrowserAdapter,
  asBrowserSessionId,
  browserStartFailureMessage,
  sanitizedBrowserEnvironment,
} from "../src/browser/index.js";

test("browser process environment excludes provider credentials and arbitrary parent variables", () => {
  const environment = sanitizedBrowserEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/test",
    LANG: "en_US.UTF-8",
    OPENROUTER_API_KEY: "secret-provider-key",
    COMPUTER_NATIVE_WORKSPACE_ROOT: "/private/workspace",
    NODE_OPTIONS: "--require=/private/inject.js",
    CUSTOM_PARENT_VARIABLE: "not-for-browser",
  });

  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    HOME: "/home/test",
    LANG: "en_US.UTF-8",
  });
});

test("missing managed Chromium errors provide the pnpm installation command", () => {
  assert.match(browserStartFailureMessage(new Error("Executable doesn't exist at /missing/chromium")), /pnpm .*playwright install chromium/u);
  assert.equal(browserStartFailureMessage(new Error("permission denied")), "The managed Chromium browser could not be started.");
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

test("managed Playwright browser opens a local fixture, snapshots controls, and acts by reference", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-disposition": "attachment; filename=fixture.txt" }).end("download fixture");
      return;
    }
    if (request.url === "/blocked") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
        <!doctype html>
        <html><body>
          <button id="blocked" type="button">Blocked action</button>
          <div style="position: fixed; inset: 0; z-index: 2; background: transparent"></div>
        </body></html>
      `);
      return;
    }
    if (request.url === "/navigate-slow") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
        <!doctype html>
        <html><body>
          <button id="navigate" type="button" onclick="location.href='/slow-response'">Start slow navigation</button>
        </body></html>
      `);
      return;
    }
    if (request.url === "/slow-response") {
      setTimeout(() => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("slow response"), 1_000);
      return;
    }
    if (request.url === "/dialog") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
        <!doctype html>
        <html><body>
          <button id="dialog" type="button">Show dialog</button>
          <p id="status">Not clicked</p>
          <script>
            document.querySelector('#dialog').addEventListener('click', () => {
              alert('fixture dialog message');
              document.querySelector('#status').textContent = 'Clicked after dialog';
            });
          </script>
        </body></html>
      `);
      return;
    }
    if (request.url !== "/fixture") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
      <!doctype html>
      <html><head><title>Computer Native Fixture</title></head>
      <body>
        <h1>Fixture page</h1>
        <label>Name <input aria-label="Name"></label>
        <button id="continue" type="button">Continue</button>
        <p id="status">Not clicked</p>
        <input id="upload" type="file" aria-label="Upload file">
        <a id="download" href="/download" download>Download fixture</a>
        <script>
          document.querySelector('#continue').addEventListener('click', () => {
            document.querySelector('#status').textContent = 'Clicked';
          });
          document.querySelector('#upload').addEventListener('change', (event) => {
            document.querySelector('#status').textContent = 'Uploaded ' + event.target.files[0].name;
          });
        </script>
      </body></html>
    `);
  });
  const port = await listen(server);
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-profile-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-artifacts-"));
  const urlPolicy = new BrowserUrlPolicy({
    allowedLocalHosts: ["127.0.0.1"],
    dnsLookup: async () => ["127.0.0.1"],
  });
  const adapter = new PlaywrightBrowserAdapter({
    headless: true,
    actionTimeoutMs: 500,
    urlPolicy,
  });
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_playwright_test"),
    profileDirectory: () => profileDirectory,
    artifactStore: new BrowserArtifactStore(artifactRoot, { maxScreenshotBytes: 1_024 * 1_024 }),
    urlPolicy,
  });
  let sessionId: ReturnType<typeof asBrowserSessionId> | undefined;

  try {
    const session = await manager.start();
    sessionId = session.sessionId;
    const tab = await manager.open(session.sessionId, `http://127.0.0.1:${port}/fixture`);
    const first = await manager.snapshot(session.sessionId, tab.tabId);
    assert.match(first.content, /Fixture page/u);
    assert.match(first.content, /Continue/u);
    assert.equal(new Set(first.references.map((reference) => reference.value)).size, first.references.length);
    const continueRef = first.references.find((reference) => reference.value === "@e2");
    assert.ok(continueRef);

    await manager.act(session.sessionId, tab.tabId, { kind: "click", reference: continueRef });
    const afterClick = await manager.snapshot(session.sessionId, tab.tabId);
    assert.match(afterClick.content, /Clicked/u);
    const cancelledAction = new AbortController();
    cancelledAction.abort();
    await assert.rejects(
      manager.act(session.sessionId, tab.tabId, { kind: "click", reference: continueRef }, cancelledAction.signal),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-cancelled",
    );
    assert.equal(manager.get(session.sessionId).status, "active");
    const uploadSource = path.join(artifactRoot, "upload.txt");
    await writeFile(uploadSource, "upload fixture");
    const uploadRef = afterClick.references.find((reference) => reference.value === "@e3");
    assert.ok(uploadRef);
    await manager.upload(session.sessionId, tab.tabId, { kind: "upload", reference: uploadRef, sourcePath: uploadSource, maxBytes: 1_024 });
    const afterUpload = await manager.snapshot(session.sessionId, tab.tabId);
    assert.match(afterUpload.content, /Uploaded upload\.txt/u);
    const waited = await manager.wait(session.sessionId, tab.tabId, { milliseconds: 1 });
    assert.equal(waited.waitedMs, 1);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      manager.wait(session.sessionId, tab.tabId, { milliseconds: 50 }, cancelled.signal),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-cancelled",
    );
    assert.equal(manager.get(session.sessionId).status, "active");
    const screenshot = await manager.screenshot(session.sessionId, tab.tabId);
    assert.equal(screenshot.kind, "screenshot");
    assert.ok(screenshot.byteSize > 0);
    assert.ok((screenshot.width ?? 0) > 0);
    assert.ok((screenshot.height ?? 0) > 0);
    assert.equal((await stat(screenshot.path)).size, screenshot.byteSize);
    const downloadRef = afterUpload.references.find((reference) => reference.value === "@e4");
    assert.ok(downloadRef);
    const downloadTarget = await manager.reserveDownload(session.sessionId, tab.tabId);
    const downloadArtifact = await manager.download(session.sessionId, tab.tabId, { kind: "download", reference: downloadRef }, downloadTarget);
    assert.equal(await readFile(downloadArtifact.path, "utf8"), "download fixture");
    assert.equal(downloadArtifact.fileName, "fixture.txt");

    const blockedTab = await manager.open(session.sessionId, `http://127.0.0.1:${port}/blocked`);
    const blockedSnapshot = await manager.snapshot(session.sessionId, blockedTab.tabId);
    const blockedRef = blockedSnapshot.references.find((reference) => reference.value === "@e1");
    assert.ok(blockedRef);
    await assert.rejects(
      manager.act(session.sessionId, blockedTab.tabId, { kind: "click", reference: blockedRef }),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-timeout",
    );
    assert.equal(manager.get(session.sessionId).status, "active");

    const dialogTab = await manager.open(session.sessionId, `http://127.0.0.1:${port}/dialog`);
    const dialogSnapshot = await manager.snapshot(session.sessionId, dialogTab.tabId);
    const dialogRef = dialogSnapshot.references.find((reference) => reference.value === "@e1");
    assert.ok(dialogRef);
    await assert.rejects(
      manager.act(session.sessionId, dialogTab.tabId, { kind: "click", reference: dialogRef }),
      (error: unknown) => error instanceof BrowserError
        && error.browserCode === "browser-ambiguous"
        && error.dialog?.type === "alert"
        && error.dialog.message === "fixture dialog message"
        && error.dialogDecision === "dismiss",
    );
    const afterDialog = await manager.snapshot(session.sessionId, dialogTab.tabId);
    assert.match(afterDialog.content, /Clicked after dialog/u);
    const dialogRefAfterDismiss = afterDialog.references.find((reference) => reference.value === "@e1");
    assert.ok(dialogRefAfterDismiss);
    await assert.rejects(
      manager.act(session.sessionId, dialogTab.tabId, { kind: "click", reference: dialogRefAfterDismiss }, undefined, async (dialog) => {
        assert.deepEqual(dialog, { type: "alert", message: "fixture dialog message" });
        return { decision: "accept" };
      }),
      (error: unknown) => error instanceof BrowserError
        && error.browserCode === "browser-ambiguous"
        && error.dialogDecision === "accept",
    );
    assert.equal(manager.get(session.sessionId).status, "active");

    const cancellationTab = await manager.open(session.sessionId, `http://127.0.0.1:${port}/navigate-slow`);
    const cancellationSnapshot = await manager.snapshot(session.sessionId, cancellationTab.tabId);
    const cancellationRef = cancellationSnapshot.references.find((reference) => reference.value === "@e1");
    assert.ok(cancellationRef);
    const cancellation = new AbortController();
    const cancellationAction = manager.act(session.sessionId, cancellationTab.tabId, { kind: "click", reference: cancellationRef }, cancellation.signal);
    setTimeout(() => cancellation.abort("user-cancelled"), 50);
    await assert.rejects(
      cancellationAction,
      (error: unknown) => error instanceof BrowserError
        && error.browserCode === "browser-cancelled"
        && error.cancellationConfirmed === true,
    );
    assert.equal(manager.get(session.sessionId).status, "active");
    await assert.rejects(
      manager.snapshot(session.sessionId, cancellationTab.tabId),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "tab-closed",
    );

  } finally {
    if (sessionId) await manager.close(sessionId).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDirectory, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("real browser tab close removes one page while keeping the session usable", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Close fixture</title><p>close me</p>");
  });
  const port = await listen(server);
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-close-profile-"));
  const urlPolicy = new BrowserUrlPolicy({
    allowedLocalHosts: ["127.0.0.1"],
    dnsLookup: async () => ["127.0.0.1"],
  });
  const adapter = new PlaywrightBrowserAdapter({ headless: true, actionTimeoutMs: 1_000, urlPolicy });
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_close_tab_test"),
    profileDirectory: () => profileDirectory,
    urlPolicy,
  });
  let sessionId: ReturnType<typeof asBrowserSessionId> | undefined;

  try {
    const session = await manager.start();
    sessionId = session.sessionId;
    const tab = await manager.open(session.sessionId, `http://127.0.0.1:${port}/close`);
    const closed = await manager.closeTab(session.sessionId, tab.tabId);
    assert.deepEqual(closed, { sessionId: session.sessionId, tabId: tab.tabId, status: "closed" });
    const remainingTabs = await manager.listTabs(session.sessionId);
    assert.equal(remainingTabs.some((remaining) => remaining.tabId === tab.tabId), false);
    await assert.rejects(
      manager.snapshot(session.sessionId, tab.tabId),
      (error: unknown) => error instanceof BrowserError && error.browserCode === "tab-closed",
    );
    const replacement = await manager.open(session.sessionId, `http://127.0.0.1:${port}/replacement`);
    assert.notEqual(replacement.tabId, tab.tabId);
    assert.equal(manager.get(session.sessionId).status, "active");
  } finally {
    if (sessionId) await manager.close(sessionId).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test("real browser form submission is approval-gated and denial performs no POST", async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/submit") {
      submissions += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("submitted");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`
      <!doctype html>
      <html><body>
        <form method="post" action="/submit">
          <label>Name <input aria-label="Name"></label>
          <button type="submit">Submit form</button>
        </form>
      </body></html>
    `);
  });
  const port = await listen(server);
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-form-profile-"));
  const urlPolicy = new BrowserUrlPolicy({
    allowedLocalHosts: ["127.0.0.1"],
    dnsLookup: async () => ["127.0.0.1"],
  });
  const adapter = new PlaywrightBrowserAdapter({ headless: true, actionTimeoutMs: 1_000, snapshotMaxChars: 40, urlPolicy });
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_form_test"),
    profileDirectory: () => profileDirectory,
    urlPolicy,
  });
  const tools = new BrowserTools({ manager, maxOutputBytes: 32_000 });

  try {
    await tools.execute("browser_start", "call_start", {}, {});
    await tools.execute("browser_open", "call_open", { url: `http://127.0.0.1:${port}/form` }, {});
    const initialSnapshot = await tools.execute("browser_snapshot", "call_snapshot", {}, {});
    assert.match(initialSnapshot.content, /snapshot truncated/u);
    const typed = await tools.execute("browser_type", "call_type", { ref: "@e1", text: "Ada" }, {
      approveBrowser: async (request) => {
        assert.equal(request.text, "Ada");
        return { decision: "allow-once" };
      },
    });
    assert.equal(typed.ok, true);

    await tools.execute("browser_snapshot", "call_snapshot_again", {}, {});
    const denied = await tools.execute("browser_click", "call_denied", { ref: "@e2" }, {
      approveBrowser: async () => ({ decision: "deny", reason: "form submission not approved" }),
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.errorCode, "browser-approval-denied");
    assert.equal(submissions, 0);

    await tools.execute("browser_snapshot", "call_snapshot_final", {}, {});
    const submitted = await tools.execute("browser_click", "call_allowed", { ref: "@e2" }, {
      approveBrowser: async () => ({ decision: "allow-once" }),
    });
    assert.equal(submitted.ok, true);
    assert.equal(submissions, 1);
  } finally {
    await manager.close("browser_form_test" as ReturnType<typeof asBrowserSessionId>).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
