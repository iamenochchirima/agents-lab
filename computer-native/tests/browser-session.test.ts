import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireBrowserProfileLease,
  BrowserError,
  BrowserSessionManager,
  BrowserUrlPolicy,
  cleanupOrphanedBrowserProfiles,
  asBrowserDocumentId,
  asBrowserSessionId,
  asBrowserTabId,
  type BrowserActionRequest,
  type BrowserAdapter,
  type BrowserSessionId,
  type BrowserSnapshot,
  type BrowserTabInfo,
} from "../src/browser/index.js";
import { pngFixture } from "./browser-fixtures.js";

class TestBrowserAdapter implements BrowserAdapter {
  readonly openedUrls: string[] = [];
  closeCount = 0;
  private readonly tabs = new Map<BrowserSessionId, BrowserTabInfo>();

  async startSession(): Promise<void> {}

  async closeSession(sessionId: BrowserSessionId): Promise<void> {
    this.closeCount += 1;
    this.tabs.delete(sessionId);
  }

  async listTabs(sessionId: BrowserSessionId): Promise<readonly BrowserTabInfo[]> {
    const tab = this.tabs.get(sessionId);
    return tab ? [tab] : [];
  }

  async open(sessionId: BrowserSessionId, url: string): Promise<BrowserTabInfo> {
    this.openedUrls.push(url);
    const tab: BrowserTabInfo = {
      sessionId,
      tabId: asBrowserTabId("tab_1"),
      documentId: asBrowserDocumentId(`document_${this.openedUrls.length}`),
      url,
      title: "Fixture",
    };
    this.tabs.set(sessionId, tab);
    return tab;
  }

  async snapshot(sessionId: BrowserSessionId, tabId: ReturnType<typeof asBrowserTabId>): Promise<BrowserSnapshot> {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    return {
      ...tab,
      content: "[button] Continue",
      references: [{ value: "@e1", documentId: tab.documentId }],
    };
  }

  async act(sessionId: BrowserSessionId, tabId: ReturnType<typeof asBrowserTabId>, request: BrowserActionRequest) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    const result = { sessionId, tab, summary: `${request.kind} completed` };
    return result;
  }

  async wait(sessionId: BrowserSessionId, tabId: ReturnType<typeof asBrowserTabId>, request: { readonly milliseconds: number }) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    return { sessionId, tab, waitedMs: request.milliseconds };
  }

  async screenshot(_sessionId: BrowserSessionId, _tabId: ReturnType<typeof asBrowserTabId>, target: { readonly path: string }) {
    const bytes = pngFixture();
    await writeFile(target.path, bytes);
    return { byteSize: bytes.length, width: 1, height: 1 };
  }

  async upload(sessionId: BrowserSessionId, tabId: ReturnType<typeof asBrowserTabId>, request: BrowserActionRequest) {
    const tab = this.tabs.get(sessionId);
    assert.ok(tab);
    assert.equal(tab.tabId, tabId);
    assert.ok(request.sourcePath);
    return { sessionId, tab, summary: "upload completed" };
  }

  async download(_sessionId: BrowserSessionId, _tabId: ReturnType<typeof asBrowserTabId>, _request: BrowserActionRequest, target: { readonly path: string }) {
    const bytes = Buffer.from("download");
    await writeFile(target.path, bytes);
    return { byteSize: bytes.length, fileName: "fixture.txt" };
  }
}

class CrashingBrowserAdapter extends TestBrowserAdapter {
  async snapshot(): Promise<never> {
    throw new BrowserError("browser-crash", "The browser process exited unexpectedly.");
  }
}

class FailingStartBrowserAdapter extends TestBrowserAdapter {
  async startSession(): Promise<void> {
    throw new Error("browser start failed");
  }
}

class ClosedTabBrowserAdapter extends TestBrowserAdapter {
  async snapshot(): Promise<never> {
    throw new BrowserError("tab-closed", "Browser tab 'tab_1' is closed.");
  }
}

class TransientReadFailureAdapter extends TestBrowserAdapter {
  listFailures = 1;
  snapshotFailures = 1;

  async listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    if (this.listFailures > 0) {
      this.listFailures -= 1;
      throw new BrowserError("adapter-failure", "The fixture tab listing failed transiently.");
    }
    return super.listTabs(sessionId);
  }

  async snapshot(sessionId: BrowserSessionId, tabId: ReturnType<typeof asBrowserTabId>, signal?: AbortSignal): Promise<BrowserSnapshot> {
    if (this.snapshotFailures > 0) {
      this.snapshotFailures -= 1;
      throw new BrowserError("adapter-failure", "The fixture snapshot failed transiently.");
    }
    return super.snapshot(sessionId, tabId);
  }
}

class SlowReadFailureAdapter extends TransientReadFailureAdapter {
  async listTabs(sessionId: BrowserSessionId, signal?: AbortSignal): Promise<readonly BrowserTabInfo[]> {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    return super.listTabs(sessionId, signal);
  }
}

function policy(): BrowserUrlPolicy {
  return new BrowserUrlPolicy({
    allowedLocalHosts: ["127.0.0.1"],
    dnsLookup: async (hostname) => (hostname === "127.0.0.1" ? ["127.0.0.1"] : ["93.184.216.34"]),
  });
}

test("browser session manager owns session and tab identity", async () => {
  const adapter = new TestBrowserAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_test"),
    now: () => "2026-09-15T00:00:00.000Z",
    profileDirectory: () => "/tmp/browser-profile-test",
    urlPolicy: policy(),
  });

  const session = await manager.start();
  const tab = await manager.open(session.sessionId, "http://127.0.0.1:4173/fixture");
  const tabs = await manager.listTabs(session.sessionId);

  assert.equal(session.status, "active");
  assert.equal(tab.sessionId, session.sessionId);
  assert.deepEqual(tabs, [tab]);
  assert.deepEqual(adapter.openedUrls, ["http://127.0.0.1:4173/fixture"]);
});

test("browser session manager enforces the configured tab limit before opening another tab", async () => {
  const adapter = new TestBrowserAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_tab_limit"),
    maxTabs: 1,
    urlPolicy: policy(),
  });
  const session = await manager.start();
  await manager.open(session.sessionId, "http://127.0.0.1:4173/first");

  await assert.rejects(
    manager.open(session.sessionId, "http://127.0.0.1:4173/second"),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "browser-resource-limit"
      && /maximum of 1 browser tab/u.test(error.message),
  );
  assert.deepEqual(adapter.openedUrls, ["http://127.0.0.1:4173/first"]);
});

test("browser session manager retries only transient read-only adapter failures", async () => {
  const adapter = new TransientReadFailureAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_read_retry"),
    readOnlyRetryCount: 1,
    urlPolicy: policy(),
  });
  const session = await manager.start();
  const tab = await manager.open(session.sessionId, "http://127.0.0.1:4173/fixture");

  assert.equal((await manager.listTabs(session.sessionId)).length, 1);
  const snapshot = await manager.snapshot(session.sessionId, tab.tabId);
  assert.match(snapshot.content, /Continue/u);
  assert.equal(adapter.listFailures, 0);
  assert.equal(adapter.snapshotFailures, 0);
});

test("browser session manager does not retry a read-only failure when retries are disabled", async () => {
  const adapter = new TransientReadFailureAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_read_no_retry"),
    readOnlyRetryCount: 0,
    urlPolicy: policy(),
  });
  const session = await manager.start();
  await assert.rejects(
    manager.listTabs(session.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure",
  );
  assert.equal(adapter.listFailures, 0);
});

test("browser session manager bounds read-only retries by the operation timeout", async () => {
  const adapter = new SlowReadFailureAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_read_timeout"),
    readOnlyRetryCount: 1,
    readOnlyTimeoutMs: 5,
    urlPolicy: policy(),
  });
  const session = await manager.start();

  await assert.rejects(
    manager.listTabs(session.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-timeout",
  );
});

test("browser session manager does not retry a cancelled read-only operation", async () => {
  const adapter = new TransientReadFailureAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_read_cancelled"),
    readOnlyRetryCount: 1,
    urlPolicy: policy(),
  });
  const session = await manager.start();
  const cancelled = new AbortController();
  cancelled.abort();

  await assert.rejects(
    manager.listTabs(session.sessionId, cancelled.signal),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-cancelled",
  );
  assert.equal(adapter.listFailures, 0);
});

test("browser session manager expires a session and closes its adapter at the lifetime bound", async () => {
  const adapter = new TestBrowserAdapter();
  const cleaned: string[] = [];
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_session_timeout"),
    sessionTimeoutMs: 25,
    profileDirectory: () => "/managed/browser_session_timeout",
    cleanupProfile: async (profileDirectory) => { cleaned.push(profileDirectory); },
    urlPolicy: policy(),
  });
  const session = await manager.start();

  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  assert.equal(new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime(), 25);
  assert.equal(adapter.closeCount, 1);
  assert.deepEqual(cleaned, ["/managed/browser_session_timeout"]);
  assert.equal(manager.get(session.sessionId).status, "expired");
  await assert.rejects(
    manager.listTabs(session.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "session-timeout",
  );
  await manager.close(session.sessionId);
  assert.equal(manager.get(session.sessionId).status, "closed");
  assert.equal(adapter.closeCount, 1);
});

test("orphaned profile cleanup removes only old managed profiles within the explicit root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-profile-cleanup-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-profile-outside-"));
  try {
    const staleName = `browser_${"a".repeat(32)}`;
    const recentName = `browser_${"b".repeat(32)}`;
    const unrelatedName = "not-a-browser-profile";
    const stale = path.join(root, staleName);
    const recent = path.join(root, recentName);
    const unrelated = path.join(root, unrelatedName);
    await mkdir(stale, { recursive: true });
    await mkdir(recent, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await writeFile(path.join(stale, "profile.data"), "stale");
    await writeFile(path.join(recent, "profile.data"), "recent");
    const now = Date.now();
    const oldSeconds = (now - 10_000) / 1_000;
    await utimes(stale, oldSeconds, oldSeconds);
    const linked = path.join(root, `browser_${"c".repeat(32)}`);
    await symlink(outside, linked);

    const result = await cleanupOrphanedBrowserProfiles(root, { maxAgeMs: 1_000, maxEntries: 10, now: () => now });

    assert.equal(result.truncated, false);
    assert.equal(result.removed, 1);
    await assert.rejects(stat(stale), { code: "ENOENT" });
    assert.equal((await stat(recent)).isDirectory(), true);
    assert.equal((await stat(unrelated)).isDirectory(), true);
    assert.equal((await lstat(linked)).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("orphaned profile cleanup stops at its entry bound", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-profile-bound-"));
  try {
    const first = path.join(root, `browser_${"a".repeat(32)}`);
    const second = path.join(root, `browser_${"b".repeat(32)}`);
    await mkdir(first);
    await mkdir(second);
    const now = Date.now();
    const oldSeconds = (now - 10_000) / 1_000;
    await utimes(first, oldSeconds, oldSeconds);
    await utimes(second, oldSeconds, oldSeconds);

    const result = await cleanupOrphanedBrowserProfiles(root, { maxAgeMs: 1_000, maxEntries: 1, now: () => now });

    assert.equal(result.scanned, 1);
    assert.equal(result.truncated, true);
    const remaining = (await Promise.all([first, second].map(async (candidate) => {
      try {
        await stat(candidate);
        return candidate;
      } catch {
        return undefined;
      }
    }))).filter((candidate): candidate is string => candidate !== undefined);
    assert.equal(remaining.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orphaned profile cleanup retains a profile with a live ownership lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-browser-profile-lease-"));
  try {
    const profile = path.join(root, `browser_${"a".repeat(32)}`);
    await mkdir(profile, { recursive: true });
    const lease = await acquireBrowserProfileLease(profile);
    const oldSeconds = (Date.now() - 10_000) / 1_000;
    await utimes(profile, oldSeconds, oldSeconds);

    const result = await cleanupOrphanedBrowserProfiles(root, { maxAgeMs: 1_000, maxEntries: 10 });

    assert.equal(result.retained, 1);
    assert.equal(result.removed, 0);
    assert.equal((await stat(profile)).isDirectory(), true);
    await lease.release();
    await utimes(profile, oldSeconds, oldSeconds);
    const reclaimed = await cleanupOrphanedBrowserProfiles(root, { maxAgeMs: 1_000, maxEntries: 10 });
    assert.equal(reclaimed.removed, 1);
    await assert.rejects(stat(profile), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser session manager holds and releases an optional profile lease", async () => {
  const adapter = new TestBrowserAdapter();
  let acquired = 0;
  let released = 0;
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_profile_lease"),
    profileDirectory: () => "/managed/browser_profile_lease",
    acquireProfileLease: async () => {
      acquired += 1;
      return { release: async () => { released += 1; } };
    },
    urlPolicy: policy(),
  });

  const session = await manager.start();
  assert.equal(acquired, 1);
  assert.equal(released, 0);
  await manager.close(session.sessionId);
  assert.equal(released, 1);
});

test("browser session manager releases a profile lease when adapter startup fails", async () => {
  let released = 0;
  const manager = new BrowserSessionManager(new FailingStartBrowserAdapter(), {
    createSessionId: () => asBrowserSessionId("browser_profile_lease_failure"),
    profileDirectory: () => "/managed/browser_profile_lease_failure",
    acquireProfileLease: async () => ({ release: async () => { released += 1; } }),
    urlPolicy: policy(),
  });

  await assert.rejects(() => manager.start(), /browser start failed/u);
  assert.equal(released, 1);
});

test("browser session manager requires a fresh snapshot before acting on a changed document", async () => {
  const adapter = new TestBrowserAdapter();
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_stale"),
    urlPolicy: policy(),
  });
  const session = await manager.start();
  const tab = await manager.open(session.sessionId, "http://127.0.0.1:4173/fixture");
  await manager.snapshot(session.sessionId, tab.tabId);

  await assert.rejects(
    manager.act(session.sessionId, tab.tabId, {
      kind: "click",
      reference: { value: "@e1", documentId: asBrowserDocumentId("document_from_old_page") },
    }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "stale-reference",
  );
});

test("browser session manager rejects unknown, closed, and cross-session tabs", async () => {
  const adapter = new TestBrowserAdapter();
  let nextId = 0;
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId(`browser_${++nextId}`),
    urlPolicy: policy(),
  });
  const first = await manager.start();
  const second = await manager.start();
  const tab = await manager.open(first.sessionId, "http://127.0.0.1:4173/fixture");

  await assert.rejects(
    manager.snapshot(second.sessionId, tab.tabId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "tab-not-found",
  );
  await manager.close(first.sessionId);
  await assert.rejects(
    manager.listTabs(first.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "session-closed",
  );
  await assert.rejects(
    manager.open(asBrowserSessionId("browser_missing"), "http://127.0.0.1:4173/fixture"),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "session-not-found",
  );
});

test("browser session manager cleans the owned profile after adapter close", async () => {
  const adapter = new TestBrowserAdapter();
  const cleaned: string[] = [];
  const manager = new BrowserSessionManager(adapter, {
    createSessionId: () => asBrowserSessionId("browser_cleanup"),
    profileDirectory: () => "/managed/browser_cleanup",
    cleanupProfile: async (profileDirectory) => { cleaned.push(profileDirectory); },
    urlPolicy: policy(),
  });

  const session = await manager.start();
  await manager.close(session.sessionId);

  assert.deepEqual(cleaned, ["/managed/browser_cleanup"]);
  assert.equal(manager.get(session.sessionId).status, "closed");
});

test("browser session manager quarantines a crashed browser and still permits cleanup", async () => {
  const cleaned: string[] = [];
  const manager = new BrowserSessionManager(new CrashingBrowserAdapter(), {
    createSessionId: () => asBrowserSessionId("browser_crashed"),
    profileDirectory: () => "/managed/browser_crashed",
    cleanupProfile: async (profileDirectory) => { cleaned.push(profileDirectory); },
    urlPolicy: policy(),
  });

  const session = await manager.start();
  const tab = await manager.open(session.sessionId, "http://127.0.0.1:4173/fixture");
  await assert.rejects(
    manager.snapshot(session.sessionId, tab.tabId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-crash",
  );
  assert.equal(manager.get(session.sessionId).status, "failed");
  assert.match(manager.get(session.sessionId).failure ?? "", /exited unexpectedly/u);
  await assert.rejects(
    manager.listTabs(session.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-crash",
  );

  await manager.closeAll();
  assert.equal(manager.get(session.sessionId).status, "closed");
  assert.deepEqual(cleaned, ["/managed/browser_crashed"]);
});

test("browser session manager reports a closed tab without quarantining the session", async () => {
  const manager = new BrowserSessionManager(new ClosedTabBrowserAdapter(), {
    createSessionId: () => asBrowserSessionId("browser_tab_closed"),
    urlPolicy: policy(),
  });
  const session = await manager.start();
  const tab = await manager.open(session.sessionId, "http://127.0.0.1:4173/fixture");

  await assert.rejects(
    manager.snapshot(session.sessionId, tab.tabId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "tab-closed",
  );
  assert.equal(manager.get(session.sessionId).status, "active");
});

test("browser session manager preserves profile cleanup failures separately from close state", async () => {
  const manager = new BrowserSessionManager(new TestBrowserAdapter(), {
    createSessionId: () => asBrowserSessionId("browser_cleanup_failure"),
    profileDirectory: () => "/managed/browser_cleanup_failure",
    cleanupProfile: async () => { throw new Error("permission denied"); },
    urlPolicy: policy(),
  });
  const session = await manager.start();

  await assert.rejects(
    manager.close(session.sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure",
  );
  const closed = manager.get(session.sessionId);
  assert.equal(closed.status, "closed");
  assert.equal(closed.cleanupError, "permission denied");
});
