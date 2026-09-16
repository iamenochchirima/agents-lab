import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/config.js";
import { openChatApplication } from "../src/runtime/application.js";

test("the standalone application wires durable memory without exposing its files to the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "computer-native-memory-application-"));
  try {
    const stateDir = path.join(root, "state");
    const application = await openChatApplication(loadConfig({ stateDir, workspaceRoot: root, browserEnabled: false }, {}));
    try {
      assert.ok(application.toolNames.includes("memory_search"));
      assert.ok(application.toolNames.includes("memory_get"));
      assert.ok(application.toolNames.includes("memory"));
      assert.ok(application.toolNames.includes("memory_forget"));
      const status = await application.readMemoryStatus?.();
      assert.equal(status?.enabled, true);
      assert.equal(status?.entries, 0);
      assert.match(status?.indexPath ?? "", /memory[\\/]index\.sqlite$/u);
    } finally {
      await application.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
