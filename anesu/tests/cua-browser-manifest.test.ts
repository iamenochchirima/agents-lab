import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CuaDriver, SessionPermissionMode } from "@trycua/cua-driver";
import { createCuaBrowserManifest, createCuaBrowserTaskManifest } from "../src/browser/cua-manifest.js";
import { createCuaNativeManifest } from "../src/computer/cua-manifest.js";

test("derived Cua browser manifest adds one canonical upload read root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-manifest-"));
  try {
    const basePath = path.join(root, "base.yaml");
    const outputPath = path.join(root, "derived", "browser.yaml");
    const uploadRoot = path.join(root, "uploads");
    await writeFile(basePath, "version: 3\nresources:\n  browser:\n    profiles:\n      - kind: isolated\n", "utf8");

    const result = await createCuaBrowserManifest({ basePath, outputPath, uploadRoot });
    assert.equal(result.manifestPath, outputPath);
    assert.equal(result.uploadRoot, path.resolve(uploadRoot));
    assert.equal(await readFile(outputPath, "utf8"), [
      "version: 3",
      "resources:",
      "  browser:",
      "    profiles:",
      "      - kind: isolated",
      "  files:",
      "    read:",
      `      - dir: ${JSON.stringify(path.resolve(uploadRoot))}`,
      "        recursive: true",
      "",
    ].join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived Cua browser manifest adds existing-profile capability only when explicitly enabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-manifest-existing-"));
  try {
    const basePath = path.join(root, "base.yaml");
    const outputPath = path.join(root, "derived", "browser.yaml");
    const uploadRoot = path.join(root, "uploads");
    await writeFile(basePath, "version: 3\nresources:\n  browser:\n    profiles:\n      - kind: isolated\n", "utf8");
    await createCuaBrowserManifest({ basePath, outputPath, uploadRoot, existingProfileEnabled: true });
    const derived = await readFile(outputPath, "utf8");
    assert.equal(derived, [
      "version: 3",
      "resources:",
      "  browser:",
      "    profiles:",
      "      - kind: isolated",
      "      - kind: existing_profile",
      "  files:",
      "    read:",
      `      - dir: ${JSON.stringify(path.resolve(uploadRoot))}`,
      "        recursive: true",
      "",
    ].join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing-profile manifest preserves browser origins and is accepted by the pinned Cua runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-browser-existing-profile-runtime-"));
  try {
    const outputPath = path.join(root, "browser.yaml");
    const uploadRoot = path.join(root, "uploads");
    const basePath = path.join(process.cwd(), "config", "cua-browser-capabilities.yaml");
    await createCuaBrowserManifest({ basePath, outputPath, uploadRoot, existingProfileEnabled: true });

    const expected = (await readFile(basePath, "utf8"))
      .replace("      - kind: isolated\n", "      - kind: isolated\n      - kind: existing_profile\n")
      .replace(/\n$/u, "")
      + `\n  files:\n    read:\n      - dir: ${JSON.stringify(path.resolve(uploadRoot))}\n        recursive: true\n`;
    assert.equal(await readFile(outputPath, "utf8"), expected);

    const driver = CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [SessionPermissionMode.Bounded],
        compatibilityMode: SessionPermissionMode.Bounded,
        compatibilityCapabilityManifestPath: outputPath,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: 8n * 60n * 60n,
        maxIdleTtlSeconds: 30n * 60n,
      },
    });
    await driver.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived Cua browser manifest rejects a base manifest with an existing file section", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-manifest-"));
  try {
    const basePath = path.join(root, "base.yaml");
    await writeFile(basePath, "resources:\n  files:\n    read: []\n", "utf8");
    await assert.rejects(
      createCuaBrowserManifest({
        basePath,
        outputPath: path.join(root, "derived.yaml"),
        uploadRoot: path.join(root, "uploads"),
      }),
      /already declares resources\.files/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task browser manifest replaces the fixed website list and preserves other Cua limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-task-manifest-"));
  try {
    const basePath = path.join(process.cwd(), "config", "cua-browser-capabilities.yaml");
    const outputPath = path.join(root, "task.yaml");
    await createCuaBrowserTaskManifest({
      basePath,
      outputPath,
      allowedOrigins: ["https://public.example"],
    });
    const manifest = await readFile(outputPath, "utf8");
    assert.match(manifest, /- "https:\/\/public\.example"/u);
    assert.match(manifest, /- "about:blank"/u);
    assert.doesNotMatch(manifest, /https:\/\/example\.com|http:\/\/localhost/u);
    assert.match(manifest, /display: false/u);
    assert.match(manifest, /- browser_navigate/u);
    assert.doesNotMatch(manifest, /^\s+- browser_download\s*$/mu);
    await assert.rejects(createCuaBrowserTaskManifest({
      basePath,
      outputPath: path.join(root, "bad.yaml"),
      allowedOrigins: ["https://public.example/path"],
    }), /not canonical/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the pinned Cua SDK accepts an about:blank-only browser task manifest and denies public origins", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-browser-blank-task-"));
  const taskPath = path.join(root, "task.yaml");
  const basePath = path.join(process.cwd(), "config", "cua-browser-capabilities.yaml");
  const driver = CuaDriver.createConfigured({
    claudeCodeCompatibility: false,
    authorization: {
      allowedModes: [SessionPermissionMode.Bounded],
      compatibilityMode: SessionPermissionMode.Bounded,
      compatibilityCapabilityManifestPath: basePath,
      unrestrictedAcknowledged: false,
      maxSessionTtlSeconds: 8n * 60n * 60n,
      maxIdleTtlSeconds: 30n * 60n,
    },
  });
  let bound: ReturnType<typeof import("@trycua/cua-driver").createTrustedSession> | undefined;
  try {
    await createCuaBrowserTaskManifest({ basePath, outputPath: taskPath, allowedOrigins: [] });
    const manifest = await readFile(taskPath, "utf8");
    assert.match(manifest, /origins:\n      - "about:blank"\n/u);
    const sdk = await import("@trycua/cua-driver");
    bound = sdk.createTrustedSession(driver, sdk.TrustedSessionOptions.new({
      publicSession: "browser_blank_task_contract",
      mode: SessionPermissionMode.Bounded,
      ttlSeconds: 600n,
      idleTtlSeconds: 300n,
      capabilityManifestPath: taskPath,
    }));
    await bound.startSession(sdk.StartSessionInput.new({ session: "browser_blank_task_contract" }));
    const refused = await bound.callTool("browser_navigate", JSON.stringify({
      session: "browser_blank_task_contract", target_id: "missing", tab_id: "missing", url: "https://duckduckgo.com/",
    }));
    const refusal = JSON.parse(refused.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    assert.equal(refusal.refusal?.code, "permission_denied");
    const desktop = await bound.callTool("get_window_state", "{}");
    const desktopRefusal = JSON.parse(desktop.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    assert.equal(desktopRefusal.refusal?.code, "permission_denied");
  } finally {
    if (bound) {
      await bound.endSession((await import("@trycua/cua-driver")).EndSessionInput.new({ session: "browser_blank_task_contract" })).catch(() => undefined);
      bound.close();
    }
    await driver.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test("derived Cua native manifest adds only the private screenshot write root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-manifest-"));
  try {
    const basePath = path.join(root, "base.yaml");
    const outputPath = path.join(root, "derived", "native.yaml");
    const screenshotRoot = path.join(root, "screenshots");
    await writeFile(basePath, "version: 3\nresources:\n  apps:\n    - executable: /usr/bin/gnome-text-editor\n      launch: true\n", "utf8");

    const result = await createCuaNativeManifest({ basePath, outputPath, screenshotRoot });
    assert.equal(result.manifestPath, outputPath);
    assert.equal(result.screenshotRoot, path.resolve(screenshotRoot));
    assert.equal(await readFile(outputPath, "utf8"), [
      "version: 3",
      "resources:",
      "  apps:",
      "    - executable: /usr/bin/gnome-text-editor",
      "      launch: true",
      "  files:",
      "    write:",
      `      - dir: ${JSON.stringify(path.resolve(screenshotRoot))}`,
      "        recursive: true",
      "",
    ].join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived Cua native manifest rejects a base manifest with an existing file section", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-manifest-"));
  try {
    const basePath = path.join(root, "base.yaml");
    await writeFile(basePath, "resources:\n  files:\n    write: []\n", "utf8");
    await assert.rejects(
      createCuaNativeManifest({
        basePath,
        outputPath: path.join(root, "derived.yaml"),
        screenshotRoot: path.join(root, "screenshots"),
      }),
      /already declares resources\.files/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checked-in Cua manifests keep origin-scoped browser and native desktop ceilings disjoint", async () => {
  const [browser, native] = await Promise.all([
    readFile(path.join(process.cwd(), "config", "cua-browser-capabilities.yaml"), "utf8"),
    readFile(path.join(process.cwd(), "config", "cua-native-capabilities.yaml"), "utf8"),
  ]);

  assert.match(browser, /desktop:\s*\n\s+display:\s+false/u);
  assert.doesNotMatch(browser, /^\s+- (?:get_window_state|verify_state|move_cursor|click|type_text|press_key|scroll|drag)\s*$/mu);
  assert.doesNotMatch(browser, /^\s+- browser_download\s*$/mu);
  assert.doesNotMatch(native, /^\s+- browser_(?:prepare|navigate|click|type|pointer|dialog|set_input_files|download)\s*$/mu);
  assert.doesNotMatch(native, /^\s+- get_browser_state\s*$/mu);
  assert.doesNotMatch(native, /^\s+origins:\s*$/mu);
});

test("the pinned Cua runtime rejects calls outside each checked-in manifest", async () => {
  const cases = [
    {
      manifestPath: path.join(process.cwd(), "config", "cua-native-capabilities.yaml"),
      forbiddenTool: "browser_prepare",
    },
    {
      manifestPath: path.join(process.cwd(), "config", "cua-browser-capabilities.yaml"),
      forbiddenTool: "get_window_state",
    },
    {
      manifestPath: path.join(process.cwd(), "config", "cua-browser-capabilities.yaml"),
      forbiddenTool: "browser_download",
    },
  ] as const;

  for (const entry of cases) {
    const driver = CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [SessionPermissionMode.Bounded],
        compatibilityMode: SessionPermissionMode.Bounded,
        compatibilityCapabilityManifestPath: entry.manifestPath,
        unrestrictedAcknowledged: false,
        maxSessionTtlSeconds: 8n * 60n * 60n,
        maxIdleTtlSeconds: 30n * 60n,
      },
    });
    try {
      const result = await driver.callTool(entry.forbiddenTool, "{}");
      assert.equal(result.isError, true);
      assert.match(result.text, /outside the capability manifest/u);
      const structured = JSON.parse(result.structuredJson ?? "") as { readonly status?: string; readonly refusal?: { readonly code?: string } };
      assert.equal(structured.status, "refused");
      assert.equal(structured.refusal?.code, "permission_denied");
    } finally {
      await driver.shutdown();
    }
  }
});

test("the pinned Cua SDK binds multiple exact task browser origins outside its compatibility manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-browser-task-origin-"));
  const taskPath = path.join(root, "task.yaml");
  const basePath = path.join(process.cwd(), "config", "cua-browser-capabilities.yaml");
  const base = await readFile(basePath, "utf8");
  await writeFile(taskPath, base.replace(
    "      - https://example.com",
    "      - https://unlisted.example\n      - https://second.example",
  ), "utf8");
  const driver = CuaDriver.createConfigured({
    claudeCodeCompatibility: false,
    authorization: {
      allowedModes: [SessionPermissionMode.Bounded],
      compatibilityMode: SessionPermissionMode.Bounded,
      compatibilityCapabilityManifestPath: basePath,
      unrestrictedAcknowledged: false,
      maxSessionTtlSeconds: 8n * 60n * 60n,
      maxIdleTtlSeconds: 30n * 60n,
    },
  });
  try {
    const sdk = await import("@trycua/cua-driver");
    const bound = sdk.createTrustedSession(driver, sdk.TrustedSessionOptions.new({
      publicSession: "browser_task_origin_contract",
      mode: SessionPermissionMode.Bounded,
      ttlSeconds: 600n,
      idleTtlSeconds: 300n,
      capabilityManifestPath: taskPath,
    }));
    await bound.startSession(sdk.StartSessionInput.new({ session: "browser_task_origin_contract" }));
    const forbidden = await bound.callTool("browser_navigate", JSON.stringify({
      session: "browser_task_origin_contract", target_id: "missing", tab_id: "missing", url: "https://other.example/",
    }));
    const allowed = await bound.callTool("browser_navigate", JSON.stringify({
      session: "browser_task_origin_contract", target_id: "missing", tab_id: "missing", url: "https://unlisted.example/",
    }));
    const secondAllowed = await bound.callTool("browser_navigate", JSON.stringify({
      session: "browser_task_origin_contract", target_id: "missing", tab_id: "missing", url: "https://second.example/",
    }));
    const denied = JSON.parse(forbidden.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    const permittedOrigin = JSON.parse(allowed.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    const permittedSecondOrigin = JSON.parse(secondAllowed.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    assert.equal(denied.refusal?.code, "permission_denied");
    assert.equal(permittedOrigin.refusal?.code, "protected_resource_scope_invalid");
    assert.equal(permittedSecondOrigin.refusal?.code, "protected_resource_scope_invalid");
    const desktop = await bound.callTool("get_window_state", "{}");
    const desktopDenied = JSON.parse(desktop.structuredJson ?? "") as { readonly refusal?: { readonly code?: string } };
    assert.equal(desktopDenied.refusal?.code, "permission_denied");
    await bound.endSession(sdk.EndSessionInput.new({ session: "browser_task_origin_contract" }));
    await bound.close();
  } finally {
    await driver.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
