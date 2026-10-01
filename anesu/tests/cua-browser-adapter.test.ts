import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { EndSessionOutput, ListWindowsOutput, ToolResult } from "@trycua/cua-driver";
import {
  BrowserError,
  BrowserUrlPolicy,
  CuaBrowserAdapter,
  asBrowserDocumentId,
  asBrowserSessionId,
  asBrowserTabId,
} from "../src/browser/index.js";
import type { CuaBrowserAdapterOptions } from "../src/browser/cua-adapter.js";

function result(structured: unknown, options: { readonly text?: string } = {}): ToolResult {
  return {
    text: options.text ?? "fixture result",
    images: [],
    structuredJson: JSON.stringify(structured),
    isError: false,
    degraded: false,
    rawJson: JSON.stringify(structured),
  };
}

function healthyCuaReport() {
  return {
    schema_version: "1",
    platform: "linux",
    overall: "ok",
    checks: [
      "binary_version",
      "platform_supported",
      "session_active",
      "ax_capability",
      "screen_capture_capability",
    ].map((name) => ({ name, status: "pass" })),
  };
}

class FakeCuaRuntime {
  readonly calls: Array<{ readonly name: string; readonly argumentsJson: string }> = [];
  ended = 0;
  shutdowns = 0;
  started = 0;
  endSessionActive = false;
  ambiguousActive = false;
  unidentifiedActive = false;
  rebindTargetId = "target-1";
  actionResponse: { readonly structured: unknown; readonly text?: string } | undefined;
  prepareResponse: { readonly structured: unknown; readonly text?: string } | undefined;
  returnContinuation = false;
  omitRefValue = false;
  navigateTargetId = "target-1";
  navigateRefsInvalidated = true;
  snapshotTargetId: string | undefined;
  snapshotTitle = "Example";
  uploadTargetId = "target-1";
  windowAppName = "Google Chrome";
  selectAvailable = false;
  selectPermissionDenied = false;
  stringControlStates = false;
  private activeTargetId = "target-1";
  private bindCount = 0;

  listToolsJson(): string {
    const schemaProperties: Readonly<Record<string, readonly string[]>> = {
      browser_prepare: ["allow_launch", "profile", "session"],
      get_browser_state: ["continuation", "query", "scope_ref", "session", "snapshot_format"],
      browser_navigate: ["session", "tab_id", "target_id", "url"],
      browser_click: ["input_route", "ref", "session", "tab_id", "target_id"],
      browser_type: ["mode", "ref", "replace", "session", "tab_id", "target_id", "text"],
      browser_select_option: ["label", "ref", "session", "tab_id", "target_id", "value"],
      browser_pointer: ["action", "destination_ref", "input_route", "ref", "session", "tab_id", "target_id"],
      browser_dialog: ["action", "dialog_id", "prompt_text", "session", "tab_id", "target_id"],
      browser_set_input_files: ["files", "ref", "session", "tab_id", "target_id"],
    };
    return JSON.stringify({ tools: [
      "browser_prepare",
      "get_browser_state",
      "browser_navigate",
      "browser_click",
      "browser_type",
      ...(this.selectAvailable ? ["browser_select_option"] : []),
      "browser_pointer",
      "browser_dialog",
      "browser_set_input_files",
    ].map((name) => ({ name, inputSchema: { type: "object", properties: Object.fromEntries((schemaProperties[name] ?? []).map((property) => [property, { type: "string" }])) } })) , schema_version: "1", capability_version: "1" });
  }

  async startSession(): Promise<void> { this.started += 1; }
  async listWindows(): Promise<ListWindowsOutput> {
    return {
      windows: [{
        pid: 7123,
        windowId: 42n,
        appName: this.windowAppName,
        title: "Chrome",
        isOnScreen: true,
        minimized: false,
        bounds: { x: 0, y: 0, width: 1_280, height: 800 },
      }],
    } as unknown as ListWindowsOutput;
  }

  async callTool(name: string, argumentsJson: string): Promise<ToolResult> {
    this.calls.push({ name, argumentsJson });
    const input = JSON.parse(argumentsJson) as { readonly mode?: string; readonly pid?: number; readonly url?: string; readonly continuation?: string; readonly query?: string; readonly scope_ref?: string; readonly strategy?: { readonly kind?: string } };
    if (name === "health_report") return result(healthyCuaReport());
    if (name === "browser_prepare") {
      if (this.prepareResponse) return result(this.prepareResponse.structured, this.prepareResponse.text === undefined ? {} : { text: this.prepareResponse.text });
      if (input.strategy?.kind === "existing_profile") return result({ status: "ok", prepared: true, action: "attached_existing_profile", prepared_pid: 7123, attachment: "existing_profile" });
      return result({ status: "ok", prepared: true, action: "launched", prepared_pid: 7123, attachment: "driver_owned" });
    }
    if (name === "get_browser_state" && (input.mode === "bind" || input.pid !== undefined)) {
      this.bindCount += 1;
      this.activeTargetId = this.bindCount === 1 ? "target-1" : this.rebindTargetId;
      const tabs = this.ambiguousActive
        ? [
          { tab_id: "tab-1", title: "New Tab", url: "about:blank", active: null },
          { tab_id: "tab-2", title: "New Tab", url: "about:blank", active: null },
        ]
        : [{ tab_id: "tab-1", title: "New Tab", url: "about:blank", active: this.unidentifiedActive ? null : true }];
      return result({
        status: "ok",
        mode: "bind",
        target_id: this.activeTargetId,
        binding_quality: "exact",
        mutation_allowed: true,
        tabs,
      });
    }
    if (name === "get_browser_state") {
      return result({
        status: "ok",
        mode: "snapshot",
        target_id: this.snapshotTargetId ?? this.activeTargetId,
        tab_id: "tab-1",
        snapshot: {
          id: input.continuation ? "p2" : "p1",
          format: "semantic_v2",
          complete: true,
          omitted: {},
          continuation: this.returnContinuation && input.continuation === undefined ? "cont-1" : null,
        },
        page: { url: "https://example.test/", title: this.snapshotTitle },
        outline: this.omitRefValue ? 'Example\n- textbox "Message": outlined value [editable=plaintext]' : "Example",
        refs: [
          { ref: "p1:1", role: "button", name: "Continue", actions: ["click"], frame: "main", visibility: "in_viewport" },
          { ref: "p1:2", role: "textbox", name: "Message", ...(this.omitRefValue ? {} : { value: "existing value" }), actions: ["type"], states: { required: true, disabled: false }, frame: "main", visibility: "in_viewport" },
          ...(this.stringControlStates ? [{ ref: "p1:7", role: "checkbox", name: "Consent", actions: ["click"], states: { checked: "true", required: "false", focusable: true }, frame: "main", visibility: "in_viewport" }] : []),
          { ref: "p1:4", role: "button", name: "Hidden", actions: ["click"], frame: "main", visibility: "css_hidden" },
          { ref: "p1:5", role: "region", name: "Article content", actions: ["pointer"], frame: "main", visibility: "in_viewport" },
          ...(this.selectAvailable ? [{ ref: "p1:6", role: "combobox", name: "Industry", actions: ["select"], frame: "main", visibility: "in_viewport" }] : []),
        ],
        content_refs: [{ ref: "p1:3", role: "heading", name: "Example", actions: [], frame: "main", visibility: "in_viewport" }],
      });
    }
    if (name === "browser_navigate") {
      return result({ status: "ok", target_id: this.navigateTargetId, tab_id: "tab-1", url: input.url, refs_invalidated: this.navigateRefsInvalidated });
    }
    if (["browser_click", "browser_type", "browser_pointer"].includes(name)) {
      const response = this.actionResponse ?? { structured: { status: "ok", effect: "confirmed", route: "trusted_input" } };
      return result(response.structured, response.text === undefined ? {} : { text: response.text });
    }
    if (name === "browser_select_option" && this.selectAvailable) {
      if (this.selectPermissionDenied) return result({ status: "refused", refusal: { code: "permission_denied", message: "Tool is outside the capability manifest." } });
      return result({ status: "ok", target_id: "target-1", tab_id: "tab-1", ref: "p1:6", selected_value: "retail", input_route: "dom_event" });
    }
    if (name === "browser_set_input_files") {
      return result({ status: "ok", target_id: this.uploadTargetId, tab_id: "tab-1", ref: "p1:2", file_count: 1 });
    }
    if (name === "browser_dialog") {
      return result({ status: "ok", target_id: "target-1", tab_id: "tab-1", present: false });
    }
    throw new Error(`Unexpected Cua tool ${name}`);
  }

  async endSession(): Promise<EndSessionOutput> {
    this.ended += 1;
    return { session: "browser_cua_test", active: this.endSessionActive };
  }

  async shutdown(): Promise<void> {
    this.shutdowns += 1;
  }
}

test("Cua browser adapter can prove capability and health before starting a browser session", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver });
  await adapter.preflight();
  assert.equal(driver.started, 0);
  assert.equal(driver.calls.filter((call) => call.name === "health_report").length, 1);
});

test("Cua trusted browser session idle lifetime matches the managed browser lifetime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-browser-idle-ttl-"));
  const manifestPath = path.join(root, "cua-browser-capabilities.yaml");
  await writeFile(manifestPath, await readFile(path.join(process.cwd(), "config/cua-browser-capabilities.yaml")));
  const driver = new FakeCuaRuntime();
  let options: Record<string, unknown> | undefined;
  let trustedCloseCount = 0;
  const sdk = {
    CuaDriver: {
      createConfiguredWithAuthorizationHost: () => driver,
    },
    DriverAuthorizationAction: { Allow: "allow", Deny: "deny", Cancel: "cancel" },
    SessionPermissionMode: { Bounded: "bounded" },
    TrustedSessionOptions: {
      new: (value: Record<string, unknown>) => {
        options = value;
        return value;
      },
    },
    createTrustedSession: () => Object.assign(driver, {
      close: async () => { trustedCloseCount += 1; },
    }),
    StartSessionInput: { new: (value: unknown) => value },
    EndSessionInput: { new: (value: unknown) => value },
    ListWindowsInput: { new: (value: unknown) => value },
  } as unknown as Awaited<ReturnType<NonNullable<CuaBrowserAdapterOptions["loadSdk"]>>>;
  const adapter = new CuaBrowserAdapter({
    manifestPath,
    loadSdk: async () => sdk,
    urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }),
  });
  const sessionId = asBrowserSessionId("browser_idle_ttl_alignment");

  try {
    await adapter.startSession({ sessionId, allowedOrigins: ["https://example.test"] });
    assert.equal(options?.ttlSeconds, 30n * 60n);
    assert.equal(options?.idleTtlSeconds, 30n * 60n);
    await adapter.closeSession(sessionId);
    assert.equal(driver.ended, 1);
    assert.equal(trustedCloseCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cua browser adapter refuses an incomplete installed tool contract before starting a session", async () => {
  const driver = new FakeCuaRuntime();
  driver.listToolsJson = () => JSON.stringify({ schema_version: "1", capability_version: "1", tools: [{ name: "browser_prepare", inputSchema: { type: "object", properties: {} } }] });
  const adapter = new CuaBrowserAdapter({ driver });
  await assert.rejects(
    () => adapter.startSession({ sessionId: asBrowserSessionId("browser_cua_missing_capability"), profileDirectory: ".anesu-browser/missing" }),
    /missing required operations/u,
  );
  assert.deepEqual(driver.calls, []);
  assert.equal(driver.started, 0);
  assert.equal(driver.ended, 0);
});

test("Cua browser adapter accepts Cua-attested Edge and rejects generic Chromium windows", async () => {
  const edgeDriver = new FakeCuaRuntime();
  edgeDriver.windowAppName = "Microsoft Edge";
  const edgeAdapter = new CuaBrowserAdapter({ driver: edgeDriver });
  const edgeSession = asBrowserSessionId("browser_edge_product");
  await edgeAdapter.startSession({ sessionId: edgeSession });
  await edgeAdapter.closeSession(edgeSession);
  assert.equal(edgeDriver.ended, 1);

  const linuxChromeDriver = new FakeCuaRuntime();
  linuxChromeDriver.windowAppName = "Google-chrome";
  const linuxChromeAdapter = new CuaBrowserAdapter({ driver: linuxChromeDriver });
  const linuxChromeSession = asBrowserSessionId("browser_linux_chrome_product");
  await linuxChromeAdapter.startSession({ sessionId: linuxChromeSession });
  await linuxChromeAdapter.closeSession(linuxChromeSession);
  assert.equal(linuxChromeDriver.ended, 1);

  const unsupportedDriver = new FakeCuaRuntime();
  unsupportedDriver.windowAppName = "Chromium";
  const unsupportedAdapter = new CuaBrowserAdapter({ driver: unsupportedDriver });
  await assert.rejects(
    () => unsupportedAdapter.startSession({ sessionId: asBrowserSessionId("browser_unsupported_product") }),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "browser-ambiguous"
      && /Chrome or Edge/u.test(error.message),
  );
  assert.equal(unsupportedDriver.ended, 1);
});

test("Cua browser adapter binds an explicitly authorized existing Chrome profile without launching", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_existing_profile");
  await adapter.startSession({
    sessionId,
    profileMode: "existing_profile",
    authorizeExistingProfile: async (authorization) => {
      assert.equal(authorization.publicSession, sessionId);
      assert.equal(authorization.riskClass, "existing_profile");
      return "allow";
    },
  });
  const prepareCall = driver.calls.find((call) => call.name === "browser_prepare");
  assert.ok(prepareCall);
  const prepareArguments = JSON.parse(prepareCall.argumentsJson) as Record<string, unknown>;
  assert.equal(prepareArguments.allow_launch, undefined);
  assert.equal(prepareArguments.profile, undefined);
  assert.deepEqual(prepareArguments.strategy, { kind: "existing_profile" });
  assert.equal(prepareArguments.pid, 7123);
  assert.ok(prepareArguments.window_id !== undefined);
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter can bind the sole unidentified tab in a new isolated profile", async () => {
  const driver = new FakeCuaRuntime();
  driver.unidentifiedActive = true;
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_isolated_unidentified_singleton");

  await adapter.startSession({ sessionId });
  const tabs = await adapter.listTabs(sessionId);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0]?.tabId, asBrowserTabId("tab-1"));
  assert.equal(tabs[0]?.active, true, "the sole tab in the exact isolated binding is unambiguous");
  assert.equal(tabs[0]?.url, "about:blank");
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter refuses a sole unidentified tab when attaching an existing profile", async () => {
  const driver = new FakeCuaRuntime();
  driver.unidentifiedActive = true;
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.startSession({
      sessionId: asBrowserSessionId("browser_existing_profile_unidentified_singleton"),
      profileMode: "existing_profile",
      authorizeExistingProfile: async () => "allow",
    }),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "browser-ambiguous"
      && /exactly one active/u.test(error.message),
  );
  assert.equal(driver.ended, 1);
});

test("Cua browser adapter preserves a non-action refusal code during preparation", async () => {
  const driver = new FakeCuaRuntime();
  driver.prepareResponse = {
    structured: { status: "refused", refusal: { code: "browser_setup_required", message: "Browser setup is required." } },
  };
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.startSession({ sessionId: asBrowserSessionId("browser_setup_refusal") }),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "adapter-failure"
      && error.cuaCode === "browser_setup_required"
      && /browser_setup_required/u.test(error.message),
  );
  assert.equal(driver.ended, 1);
});

test("Cua browser adapter preserves the documented non-action refusal vocabulary", async () => {
  const refusalCodes = [
    "browser_requires_setup",
    "browser_consent_required",
    "browser_consent_revoked",
    "browser_route_unavailable",
    "browser_binding_ambiguous",
    "browser_binding_stale",
    "browser_wrong_target_refused",
    "browser_tab_not_found",
    "browser_ref_stale",
    "browser_action_unavailable",
    "browser_input_trust_unavailable",
    "browser_endpoint_owner_mismatch",
    "browser_reconnect_exhausted",
    "browser_origin_outside_scope",
    "browser_input_incomplete",
  ] as const;

  for (const code of refusalCodes) {
    const driver = new FakeCuaRuntime();
    driver.prepareResponse = {
      structured: { status: "refused", refusal: { code, message: `Cua refused with ${code}.` } },
    };
    const adapter = new CuaBrowserAdapter({ driver });

    await assert.rejects(
      () => adapter.startSession({ sessionId: asBrowserSessionId(`browser_refusal_${code}`) }),
      (error: unknown) => error instanceof BrowserError
        && error.cuaCode === code
        && error.message.includes(code),
    );
    assert.equal(driver.ended, 1);
  }
});

test("Cua browser adapter fails closed when capability discovery is unavailable", async () => {
  const driver = new FakeCuaRuntime();
  Object.defineProperty(driver, "listToolsJson", { value: undefined });
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.preflight(),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "adapter-failure"
      && /capability discovery is unavailable/u.test(error.message),
  );
  assert.equal(driver.calls.some((call) => call.name === "health_report"), false);
  assert.equal(driver.calls.some((call) => call.name === "browser_prepare"), false);
});

test("Cua browser preflight rejects an SDK object with missing callable adapter methods", async () => {
  const driver = new FakeCuaRuntime();
  Object.defineProperty(driver, "callTool", { value: undefined });
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.preflight(),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "adapter-failure"
      && /missing callable adapter methods: callTool/u.test(error.message),
  );
  assert.equal(driver.calls.length, 0);
});

test("Cua browser adapter reports an incomplete end-session cleanup", async () => {
  const driver = new FakeCuaRuntime();
  driver.endSessionActive = true;
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_cleanup_incomplete");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_cleanup_incomplete" });
  await assert.rejects(
    () => adapter.closeSession(sessionId),
    (error: unknown) => error instanceof BrowserError && /inactive during cleanup/u.test(error.message),
  );
});

test("Cua browser preflight rejects a schema that does not require the fields Anesu sends", async () => {
  const driver = new FakeCuaRuntime();
  const inventory = JSON.parse(driver.listToolsJson()) as { readonly tools: Array<{ readonly name: string; readonly inputSchema: Record<string, unknown> }> };
  const typeText = inventory.tools.find((tool) => tool.name === "browser_type");
  assert.ok(typeText);
  typeText.inputSchema.required = ["target_id", "tab_id", "text"];
  driver.listToolsJson = () => JSON.stringify(inventory);
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.preflight(),
    /browser_type.*does not require fields/u,
  );
});

test("Cua browser preflight rejects a contradictory read-only annotation", async () => {
  const driver = new FakeCuaRuntime();
  const inventory = JSON.parse(driver.listToolsJson()) as { tools: Array<{ name: string; annotations?: Record<string, unknown> }> };
  const state = inventory.tools.find((tool) => tool.name === "get_browser_state");
  assert.ok(state);
  state.annotations = { readOnlyHint: false };
  driver.listToolsJson = () => JSON.stringify(inventory);
  const adapter = new CuaBrowserAdapter({ driver });

  await assert.rejects(
    () => adapter.preflight(),
    /get_browser_state.*unsafe readOnlyHint/u,
  );
});

test("Cua semantic control states survive the browser gateway and adapter", async () => {
  const driver = new FakeCuaRuntime();
  driver.stringControlStates = true;
  const adapter = new CuaBrowserAdapter({
    driver,
    inputRoute: "dom_event",
    urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }),
  });
  const sessionId = asBrowserSessionId("browser_semantic_control_states");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_semantic_control_states" });
  const page = await adapter.open(sessionId, "https://example.test/");
  const snapshot = await adapter.snapshot(sessionId, page.tabId);
  const message = snapshot.references.find((reference) => reference.name === "Message");

  assert.deepEqual(message?.states, { required: true, disabled: false });
  const consent = snapshot.references.find((reference) => reference.name === "Consent");
  assert.deepEqual(consent?.states, { checked: true, required: false });
  assert.equal(driver.calls.some((call) => call.name === "get_window_state"), false);
});

test("Cua browser adapter prepares, binds, snapshots, navigates, and acts without a second browser backend", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({
    driver,
    inputRoute: "dom_event",
    urlPolicy: new BrowserUrlPolicy({
      dnsLookup: async () => ["93.184.216.34"],
    }),
  });
  const sessionId = asBrowserSessionId("browser_cua_test");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_cua_test" });
  const prepareCall = driver.calls.find((call) => call.name === "browser_prepare");
  assert.ok(prepareCall);
  const prepareArguments = JSON.parse(prepareCall.argumentsJson) as Record<string, unknown>;
  assert.equal(prepareArguments.allow_launch, true);
  assert.deepEqual(prepareArguments.profile, { mode: "isolated_new" });
  assert.equal(prepareArguments.executable, undefined);
  assert.equal(prepareArguments.additional_arguments, undefined);
  assert.equal(prepareArguments.remote_debugging, undefined);
  const tabs = await adapter.listTabs(sessionId);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0]?.tabId, asBrowserTabId("tab-1"));
  assert.equal(tabs[0]?.active, true);

  const opened = await adapter.open(sessionId, "https://example.test/");
  assert.equal(opened.url, "https://example.test/");

  const snapshot = await adapter.snapshot(sessionId, asBrowserTabId("tab-1"));
  assert.equal(snapshot.documentId, asBrowserDocumentId("p1"));
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.headings, ["Example"]);
  assert.deepEqual(snapshot.omissions, {});
  assert.match(snapshot.content, /heading Example/u);
  assert.match(snapshot.content, /\[p1:1\] button Continue/u);
  assert.match(snapshot.content, /\[p1:2\] input text Message/u);
  assert.equal(snapshot.references.find((reference) => reference.value === "p1:2")?.currentValue, "existing value");
  assert.doesNotMatch(snapshot.content, /p1:4/u);

  const acted = await adapter.act(sessionId, asBrowserTabId("tab-1"), {
    kind: "click",
    reference: { value: "p1:1", documentId: snapshot.documentId },
  });
  assert.match(acted.summary, /Cua click dispatched/u);
  const clickCall = driver.calls.find((call) => call.name === "browser_click");
  assert.ok(clickCall);
  assert.equal(JSON.parse(clickCall.argumentsJson).input_route, "dom_event");

  const uploadSnapshot = await adapter.snapshot(sessionId, asBrowserTabId("tab-1"));
  const uploaded = await adapter.upload(sessionId, asBrowserTabId("tab-1"), {
    kind: "upload",
    reference: { value: "p1:2", documentId: uploadSnapshot.documentId },
    sourcePath: "/tmp/approved.txt",
  });
  assert.match(uploaded.summary, /Cua browser upload dispatched/u);
  assert.notEqual(uploaded.tab.documentId, uploadSnapshot.documentId);
  assert.match(uploaded.tab.documentId, /^generation:/u);
  assert.ok(driver.calls.some((call) => call.name === "browser_set_input_files"));

  await assert.rejects(
    adapter.download(
      sessionId,
      asBrowserTabId("tab-1"),
      { kind: "download", reference: { value: "p1:1", documentId: snapshot.documentId } },
      { artifactId: "artifact_unused", sessionId, tabId: asBrowserTabId("tab-1"), path: "/tmp/unused-download", maxBytes: 1_024 },
    ),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure" && /public Cua TypeScript SDK/u.test(error.message),
  );

  await adapter.closeSession(sessionId);
  await adapter.shutdown();
  assert.equal(driver.ended, 1);
  assert.equal(driver.shutdowns, 1);
});

test("Cua browser adapter selects a native option through the discovered typed tool", async () => {
  const driver = new FakeCuaRuntime();
  driver.selectAvailable = true;
  const adapter = new CuaBrowserAdapter({ driver, inputRoute: "dom_event", urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }) });
  const sessionId = asBrowserSessionId("browser_select_option_test");
  const tabId = asBrowserTabId("tab-1");
  await adapter.startSession({ sessionId });
  await adapter.open(sessionId, "https://example.test/");
  const snapshot = await adapter.snapshot(sessionId, tabId);
  const reference = snapshot.references.find((item) => item.value === "p1:6");
  assert.ok(reference);
  assert.deepEqual(reference?.actions, ["select"]);

  const selected = await adapter.act(sessionId, tabId, {
    kind: "select", reference, value: "Retail",
  });
  assert.equal(selected.route, "dom_event");
  const call = driver.calls.find((item) => item.name === "browser_select_option");
  assert.ok(call);
  assert.equal(JSON.parse(call.argumentsJson).label, "Retail");
  assert.equal(JSON.parse(call.argumentsJson).value, undefined);
  driver.selectPermissionDenied = true;
  const fresh = await adapter.snapshot(sessionId, tabId);
  await assert.rejects(
    adapter.act(sessionId, tabId, { kind: "select", reference: fresh.references.find((item) => item.value === "p1:6"), value: "Retail" }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-action-refused" && error.cuaCode === "permission_denied",
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter does not expose about:blank as the title of a navigated page", async () => {
  const driver = new FakeCuaRuntime();
  driver.snapshotTitle = "about:blank";
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_stale_title");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_stale_title" });
  const snapshot = await adapter.snapshot(sessionId, asBrowserTabId("tab-1"));

  assert.equal(snapshot.url, "https://example.test/");
  assert.equal(snapshot.title, "");
  assert.deepEqual(snapshot.headings, ["Example"]);
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter retains a uniquely bound textbox value from the semantic outline", async () => {
  const driver = new FakeCuaRuntime();
  driver.omitRefValue = true;
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_outline_value");

  await adapter.startSession({ sessionId });
  const snapshot = await adapter.snapshot(sessionId, asBrowserTabId("tab-1"));
  assert.equal(snapshot.references.find((reference) => reference.value === "p1:2")?.currentValue, "outlined value");
  await adapter.closeSession(sessionId);
  await adapter.shutdown();
});

test("Cua browser adapter rejects navigation that does not confirm the authorized binding and invalidation", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({
    driver,
    urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }),
  });
  const sessionId = asBrowserSessionId("browser_binding_response");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_binding_response" });
  driver.navigateTargetId = "target-attacker";
  await assert.rejects(
    () => adapter.open(sessionId, "https://example.test/"),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure" && /target or tab identity/u.test(error.message),
  );

  driver.navigateTargetId = "target-1";
  driver.navigateRefsInvalidated = false;
  await assert.rejects(
    () => adapter.open(sessionId, "https://example.test/"),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure" && /invalidation/u.test(error.message),
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter rejects snapshots and uploads that change the authorized target or file ref", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_response_identity");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_response_identity" });
  driver.snapshotTargetId = "target-attacker";
  await assert.rejects(
    () => adapter.snapshot(sessionId, tabId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure" && /target or tab identity/u.test(error.message),
  );

  driver.snapshotTargetId = "target-1";
  const snapshot = await adapter.snapshot(sessionId, tabId);
  driver.uploadTargetId = "target-attacker";
  await assert.rejects(
    () => adapter.upload(sessionId, tabId, {
      kind: "upload",
      reference: { value: "p1:2", documentId: snapshot.documentId },
      sourcePath: "/tmp/approved.txt",
    }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "adapter-failure" && /target or tab identity/u.test(error.message),
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter forwards bounded semantic reads and consumes continuations once", async () => {
  const driver = new FakeCuaRuntime();
  driver.returnContinuation = true;
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_cua_continuation");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_cua_continuation" });
  const first = await adapter.snapshot(sessionId, tabId);
  assert.equal(first.continuation, "cont-1");
  const second = await adapter.snapshot(sessionId, tabId, undefined, {
    scopeRef: "p1:heading",
    query: "heading",
    continuation: first.continuation,
  });
  assert.equal(second.documentId, asBrowserDocumentId("p2"));
  const continuationCall = [...driver.calls].reverse().find((call) => call.name === "get_browser_state" && JSON.parse(call.argumentsJson).continuation === "cont-1");
  assert.ok(continuationCall);
  const continuationInput = JSON.parse(continuationCall.argumentsJson) as Record<string, unknown>;
  assert.equal(continuationInput.query, "heading");
  assert.equal(continuationInput.scope_ref, "p1:heading");

  await assert.rejects(
    adapter.snapshot(sessionId, tabId, undefined, { continuation: first.continuation }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "stale-reference",
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter propagates bounded action effect, route, delivery, and escalation", async () => {
  const driver = new FakeCuaRuntime();
  driver.actionResponse = {
    structured: {
      status: "ok",
      effect: "unverifiable",
      route: "dom_event",
      delivery: { mode: "background", delivered_count: 1 },
      escalation: { target: "page", reason: "effect_unconfirmed" },
    },
  };
  const adapter = new CuaBrowserAdapter({ driver, inputRoute: "dom_event" });
  const sessionId = asBrowserSessionId("browser_action_metadata");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_action_metadata" });
  const snapshot = await adapter.snapshot(sessionId, tabId);
  const acted = await adapter.act(sessionId, tabId, {
    kind: "click",
    reference: { value: "p1:1", documentId: snapshot.documentId },
  });

  assert.deepEqual({
    effect: acted.effect,
    route: acted.route,
    delivery: acted.delivery,
    escalation: acted.escalation,
  }, {
    effect: "unverifiable",
    route: "dom_event",
    delivery: { mode: "background", deliveredCount: 1 },
    escalation: { target: "page", reason: "effect_unconfirmed" },
  });
  await adapter.closeSession(sessionId);
});

test("Cua browser Enter dispatch uses the installed newline keystroke encoding", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver, inputRoute: "trusted" });
  const sessionId = asBrowserSessionId("browser_enter_key");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_enter_key" });
  const snapshot = await adapter.snapshot(sessionId, tabId);
  const reference = snapshot.references.find((candidate) => candidate.name === "Message");
  assert.ok(reference);

  await assert.rejects(
    adapter.act(sessionId, tabId, { kind: "press", reference, key: "ArrowDown" }),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "invalid-action"
      && /limited to Enter/u.test(error.message),
  );
  assert.equal(driver.calls.filter((call) => call.name === "browser_type").length, 0);

  await adapter.act(sessionId, tabId, { kind: "press", reference, key: "Enter" });
  const call = [...driver.calls].reverse().find((candidate) => candidate.name === "browser_type");
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.argumentsJson), {
    target_id: "target-1",
    tab_id: "tab-1",
    ref: "p1:2",
    text: "\n",
    mode: "keystrokes",
    session: "browser_enter_key",
  });
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter sends the selected semantic ref for scroll through browser_pointer", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver, inputRoute: "dom_event" });
  const sessionId = asBrowserSessionId("browser_scroll_ref");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_scroll_ref" });
  const snapshot = await adapter.snapshot(sessionId, tabId);
  const scrollRef = snapshot.references.find((reference) => reference.value === "p1:5");
  assert.deepEqual(scrollRef?.actions, ["pointer"]);

  await adapter.act(sessionId, tabId, {
    kind: "scroll",
    inputRoute: "dom_event",
    reference: { value: "p1:5", documentId: snapshot.documentId, actions: ["pointer"], role: "region", name: "Article content" },
    direction: "down",
    amount: 400,
  });

  const call = driver.calls.find((candidate) => candidate.name === "browser_pointer");
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.argumentsJson), {
    target_id: "target-1",
    tab_id: "tab-1",
    action: "scroll",
    input_route: "dom_event",
    ref: "p1:5",
    delta_x: 0,
    delta_y: 400,
    session: "browser_scroll_ref",
  });
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter refuses synthetic typing when the installed type contract has no route", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver, inputRoute: "trusted" });
  const sessionId = asBrowserSessionId("browser_type_route_boundary");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_type_route_boundary" });
  const snapshot = await adapter.snapshot(sessionId, asBrowserTabId("tab-1"));
  const reference = snapshot.references.find((value) => value.name === "Message");
  assert.ok(reference);
  await assert.rejects(
    adapter.act(sessionId, asBrowserTabId("tab-1"), { kind: "type", inputRoute: "dom_event", reference, text: "hello" }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-input-trust-unavailable",
  );
  assert.equal(driver.calls.filter((call) => call.name === "browser_type").length, 0);
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter inserts into an empty or unreported date input but refuses a known non-empty value", async () => {
  for (const [index, currentValue] of ["", undefined, "2026-10-12"].entries()) {
    const driver = new FakeCuaRuntime();
    const adapter = new CuaBrowserAdapter({ driver, inputRoute: "trusted" });
    const sessionId = asBrowserSessionId(`browser_date_insert_${index}`);
    const tabId = asBrowserTabId("tab-1");

    await adapter.startSession({ sessionId, profileDirectory: `.anesu-browser/browser_date_insert_${index}` });
    const snapshot = await adapter.snapshot(sessionId, tabId);
    const reference = {
      value: "p1:date",
      documentId: snapshot.documentId,
      role: "date",
      actions: ["type"],
      ...(currentValue === undefined ? {} : { currentValue }),
    };
    if (currentValue === "" || currentValue === undefined) {
      await adapter.act(sessionId, tabId, { kind: "type", reference, text: "2026-10-12", typingMode: "keystrokes" });
      const call = driver.calls.find((entry) => entry.name === "browser_type");
      assert.ok(call);
      assert.deepEqual(JSON.parse(call.argumentsJson), {
        target_id: "target-1",
        tab_id: "tab-1",
        ref: "p1:date",
        text: "2026-10-12",
        mode: "keystrokes",
        replace: false,
        session: `browser_date_insert_${index}`,
      });
    } else {
      await assert.rejects(
        adapter.act(sessionId, tabId, { kind: "type", reference, text: "2026-10-12" }),
        (error: unknown) => error instanceof BrowserError
          && error.browserCode === "invalid-action"
          && /known non-empty date/u.test(error.message),
      );
      assert.equal(driver.calls.some((entry) => entry.name === "browser_type"), false);
    }
    await adapter.closeSession(sessionId);
  }
});

test("Cua browser uploads use a private staged copy inside the manifest read root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anesu-cua-upload-"));
  try {
    const sourcePath = path.join(root, "workspace-file.txt");
    const stagingRoot = path.join(root, "staging");
    await writeFile(sourcePath, "approved upload contents\n", "utf8");
    const driver = new FakeCuaRuntime();
    const adapter = new CuaBrowserAdapter({ driver, uploadStagingRoot: stagingRoot });
    const sessionId = asBrowserSessionId("browser_upload_staging");
    const tabId = asBrowserTabId("tab-1");

    await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_upload_staging" });
    const snapshot = await adapter.snapshot(sessionId, tabId);
    await adapter.upload(sessionId, tabId, {
      kind: "upload",
      reference: { value: "p1:2", documentId: snapshot.documentId },
      sourcePath,
    });

    const call = [...driver.calls].reverse().find((entry) => entry.name === "browser_set_input_files");
    assert.ok(call);
    const stagedPath = (JSON.parse(call.argumentsJson) as { readonly files?: readonly string[] }).files?.[0];
    assert.ok(stagedPath);
    assert.equal(path.dirname(path.dirname(stagedPath)), path.resolve(stagingRoot));
    assert.notEqual(stagedPath, sourcePath);
    assert.equal(await readFile(stagedPath, "utf8"), "approved upload contents\n");

    await adapter.closeSession(sessionId);
    await assert.rejects(access(stagedPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cua browser adapter keeps structured action refusals typed", async () => {
  const driver = new FakeCuaRuntime();
  driver.actionResponse = {
    structured: {
      effect: "refused",
      route: "trusted_input",
      escalation: { target: "page", reason: "route_unavailable" },
    },
    text: "refused (browser_input_trust_unavailable)",
  };
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_action_refusal");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_action_refusal" });
  const snapshot = await adapter.snapshot(sessionId, tabId);

  await assert.rejects(
    adapter.act(sessionId, tabId, {
      kind: "click",
      reference: { value: "p1:1", documentId: snapshot.documentId },
    }),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "browser-action-refused"
      && error.cuaCode === "browser_action_refused"
      && /Cua refused browser_click/u.test(error.message),
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter rejects origins outside the checked-in manifest scope before dispatch", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({
    driver,
    allowedOrigins: ["https://example.test"],
    urlPolicy: new BrowserUrlPolicy({ dnsLookup: async () => ["93.184.216.34"] }),
  });
  const sessionId = asBrowserSessionId("browser_origin_test");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_origin_test" });
  await assert.rejects(
    adapter.open(sessionId, "https://outside.example/"),
    (error: unknown) => error instanceof BrowserError
      && error.browserCode === "navigation-policy"
      && /outside the Cua browser manifest/u.test(error.message),
  );
  assert.equal(driver.calls.some((call) => call.name === "browser_navigate"), false);
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter refuses an ambiguous active tab during binding refresh", async () => {
  const driver = new FakeCuaRuntime();
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_ambiguous_active_refresh");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_ambiguous_active_refresh" });
  driver.ambiguousActive = true;

  await assert.rejects(
    () => adapter.listTabs(sessionId),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "browser-ambiguous" && /exactly one active/u.test(error.message),
  );
  await adapter.closeSession(sessionId);
});

test("Cua browser adapter adopts a freshly minted bind target and invalidates prior document refs", async () => {
  const driver = new FakeCuaRuntime();
  driver.rebindTargetId = "target-2";
  const adapter = new CuaBrowserAdapter({ driver });
  const sessionId = asBrowserSessionId("browser_rebind_target");
  const tabId = asBrowserTabId("tab-1");

  await adapter.startSession({ sessionId, profileDirectory: ".anesu-browser/browser_rebind_target" });
  const before = await adapter.snapshot(sessionId, tabId);
  await adapter.listTabs(sessionId);

  await assert.rejects(
    () => adapter.act(sessionId, tabId, {
      kind: "click",
      reference: { value: "p1:1", documentId: before.documentId },
    }),
    (error: unknown) => error instanceof BrowserError && error.browserCode === "stale-reference",
  );

  await adapter.snapshot(sessionId, tabId);
  const snapshotCall = [...driver.calls].reverse().find((call) => {
    if (call.name !== "get_browser_state") return false;
    const input = JSON.parse(call.argumentsJson) as { readonly pid?: number };
    return input.pid === undefined;
  });
  assert.ok(snapshotCall);
  assert.equal(JSON.parse(snapshotCall.argumentsJson).target_id, "target-2");
  await adapter.closeSession(sessionId);
});
