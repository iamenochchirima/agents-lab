import assert from "node:assert/strict";
import { test } from "node:test";
import type { EndSessionOutput, ToolResult } from "@trycua/cua-driver";
import {
  CuaBrowserGateway,
  CuaBrowserGatewayError,
  type CuaBrowserDriver,
} from "../src/browser/cua-browser-gateway.js";
import { encodeCuaJson } from "../src/browser/cua-json.js";

function result(structured: unknown, options: { readonly isError?: boolean; readonly text?: string } = {}): ToolResult {
  return {
    text: options.text ?? "fixture result",
    images: [],
    structuredJson: JSON.stringify(structured),
    isError: options.isError ?? false,
    degraded: false,
    rawJson: "{\"fixture\":true}",
  };
}

class FakeCuaBrowserDriver implements CuaBrowserDriver {
  readonly calls: Array<{ readonly name: string; readonly argumentsJson: string }> = [];
  readonly ended: string[] = [];
  readonly responses = new Map<string, ToolResult>();

  async callTool(name: string, argumentsJson: string): Promise<ToolResult> {
    this.calls.push({ name, argumentsJson });
    return this.responses.get(name) ?? result({ status: "ok" });
  }

  async endSession(input: { readonly session?: string }): Promise<EndSessionOutput> {
    this.ended.push(input.session ?? "");
    return { session: input.session ?? "", active: false };
  }
}

test("Cua JSON encoding keeps bigint window IDs as exact decimal JSON integers", () => {
  const encoded = encodeCuaJson({
    window_id: 90071992547409931234567890n,
    nested: [-9007199254740993123456789n],
  });

  assert.equal(
    encoded,
    '{"window_id":90071992547409931234567890,"nested":[-9007199254740993123456789]}',
  );
  assert.equal(encoded.includes('"90071992547409931234567890"'), false);
  assert.throws(() => encodeCuaJson({ bad: Number.NaN }), /finite/u);
  assert.throws(() => encodeCuaJson({ bad: undefined as never }), /undefined/u);
});

test("gateway requires a nonempty non-default explicit session", () => {
  const driver = new FakeCuaBrowserDriver();

  assert.throws(() => new CuaBrowserGateway(driver, ""), CuaBrowserGatewayError);
  assert.throws(() => new CuaBrowserGateway(driver, "default"), CuaBrowserGatewayError);
  assert.throws(() => new CuaBrowserGateway(driver, "   "), CuaBrowserGatewayError);
});

test("gateway sends typed browser operations through callTool and preserves bigint binding IDs", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("browser_prepare", result({
    status: "ok",
    prepared: true,
    action: "launched",
    message: "isolated browser launched",
    prepared_pid: 7123,
    attachment: "driver_owned",
  }));
  driver.responses.set("get_browser_state", result({
    status: "ok",
    mode: "bind",
    target_id: "target-1",
    binding_quality: "exact",
    mutation_allowed: true,
    tabs: [{ tab_id: "tab-1", title: "Example", url: "https://example.com", active: true }],
  }));
  driver.responses.set("browser_navigate", result({
    status: "ok",
    target_id: "target-1",
    tab_id: "tab-1",
    url: "https://example.com/next",
    refs_invalidated: true,
  }));
  driver.responses.set("browser_dialog", result({
    status: "ok",
    target_id: "target-1",
    tab_id: "tab-1",
    present: false,
  }));
  driver.responses.set("browser_set_input_files", result({
    status: "ok",
    target_id: "target-1",
    tab_id: "tab-1",
    ref: "p1:2",
    file_count: 1,
  }));

  const gateway = new CuaBrowserGateway(driver, "browser_test_1");
  const prepared = await gateway.prepare({
    allowLaunch: true,
    profile: { mode: "isolated_new" },
  });
  const bound = await gateway.getBrowserState({
    mode: "bind",
    pid: 7123,
    windowId: 90071992547409931234567890n,
  });
  const navigated = await gateway.navigate({
    targetId: "target-1",
    tabId: "tab-1",
    url: "https://example.com/next",
  });
  const dialog = await gateway.dialog({
    targetId: "target-1",
    tabId: "tab-1",
    action: "inspect",
  });
  const uploaded = await gateway.setInputFiles({
    targetId: "target-1",
    tabId: "tab-1",
    ref: "p1:2",
    files: ["/tmp/approved.txt"],
  });

  assert.equal(prepared.kind, "ok");
  assert.equal(prepared.value.preparedPid, 7123);
  assert.equal(bound.kind, "ok");
  assert.equal(bound.kind, "ok");
  if (bound.kind !== "ok" || bound.value.mode !== "bind") throw new Error("expected a bound browser state");
  assert.equal(bound.value.bindingQuality, "exact");
  assert.equal(navigated.kind, "ok");
  assert.equal(navigated.value.refsInvalidated, true);
  assert.equal(dialog.kind, "ok");
  assert.equal(dialog.value.present, false);
  assert.equal(uploaded.kind, "ok");
  assert.equal(uploaded.value.fileCount, 1);

  const prepareCall = driver.calls.find((call) => call.name === "browser_prepare");
  const stateCall = driver.calls.find((call) => call.name === "get_browser_state");
  assert.ok(prepareCall);
  assert.ok(stateCall);
  assert.equal(JSON.parse(prepareCall.argumentsJson).session, "browser_test_1");
  assert.match(stateCall.argumentsJson, /"window_id":90071992547409931234567890/u);
  assert.doesNotMatch(stateCall.argumentsJson, /"window_id":"90071992547409931234567890"/u);
  for (const call of driver.calls) {
    assert.equal(JSON.parse(call.argumentsJson).session, "browser_test_1");
  }
});

test("gateway models click, type, and pointer as coarse action results", async () => {
  const driver = new FakeCuaBrowserDriver();
  const action = {
    status: "ok",
    effect: "unverifiable",
    route: "dom_event",
    delivery: { mode: "background", delivered_count: 1 },
    escalation: { target: "page", reason: "effect_unconfirmed" },
  };
  driver.responses.set("browser_click", result(action));
  driver.responses.set("browser_type", result({ status: "ok", route: "trusted_input" }));
  driver.responses.set("browser_pointer", result({ status: "ok", effect: "confirmed", route: "trusted_input" }));
  const gateway = new CuaBrowserGateway(driver, "browser_actions_1");

  const click = await gateway.click({ targetId: "target-1", tabId: "tab-1", ref: "p1:1", inputRoute: "dom_event" });
  const typed = await gateway.type({ targetId: "target-1", tabId: "tab-1", ref: "p1:2", text: "hello", mode: "keystrokes", replace: true });
  const pointer = await gateway.pointer({ targetId: "target-1", tabId: "tab-1", action: "hover", ref: "p1:3" });
  const scrolled = await gateway.pointer({ targetId: "target-1", tabId: "tab-1", action: "scroll", ref: "p1:5", deltaY: 400, inputRoute: "dom_event" });

  assert.deepEqual(click, {
    kind: "ok",
    value: {
      effect: "unverifiable",
      route: "dom_event",
      delivery: { mode: "background", deliveredCount: 1 },
      escalation: { target: "page", reason: "effect_unconfirmed" },
    },
  });
  assert.deepEqual(typed, { kind: "ok", value: { route: "trusted_input" } });
  const typeCall = driver.calls.find((call) => call.name === "browser_type");
  assert.ok(typeCall);
  assert.equal(JSON.parse(typeCall.argumentsJson).input_route, undefined);
  assert.equal(JSON.parse(typeCall.argumentsJson).mode, "keystrokes");
  assert.deepEqual(pointer, { kind: "ok", value: { effect: "confirmed", route: "trusted_input" } });
  assert.deepEqual(scrolled, { kind: "ok", value: { effect: "confirmed", route: "trusted_input" } });
  const scrollCall = driver.calls.find((call) => call.name === "browser_pointer" && JSON.parse(call.argumentsJson).action === "scroll");
  assert.ok(scrollCall);
  assert.equal(JSON.parse(scrollCall.argumentsJson).ref, "p1:5");
  assert.equal(JSON.parse(scrollCall.argumentsJson).delta_y, 400);
  assert.equal(JSON.parse(scrollCall.argumentsJson).input_route, "dom_event");
});

test("gateway preserves Cua action refusals without inferring a code from diagnostic text", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("browser_click", result(
    { effect: "refused", route: "trusted_input", escalation: { target: "page", reason: "route_unavailable" } },
    { text: "refused (browser_input_trust_unavailable)" },
  ));
  const gateway = new CuaBrowserGateway(driver, "browser_action_refusal_1");

  const response = await gateway.click({ targetId: "target-1", tabId: "tab-1", ref: "p1:1", inputRoute: "trusted" });

  assert.deepEqual(response, {
    kind: "refused",
    refusal: { code: "browser_action_refused", message: "Cua refused browser_click." },
  });
});

test("gateway decodes bounded semantic and legacy browser snapshots", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("get_browser_state", result({
    status: "ok",
    mode: "snapshot",
    target_id: "target-1",
    tab_id: "tab-1",
    snapshot: {
      id: "p1",
      format: "semantic_v2",
      complete: true,
      scope: "document",
      omitted: { css_hidden: 0, budget: 0 },
      continuation: null,
    },
    page: { url: "https://example.com", title: "Example" },
    refs: [{ ref: "p1:1", role: "button", name: "Next", value: null, actions: ["click"], frame: "main", visibility: "in_viewport" }],
    content_refs: [{ ref: "p1:2", role: "heading", name: "Example", value: null, actions: [], frame: "main", visibility: "in_viewport" }],
    oopif: { status: "unsupported", frames: 0 },
  }));
  const gateway = new CuaBrowserGateway(driver, "browser_snapshot_1");

  const response = await gateway.getBrowserState({ mode: "snapshot", targetId: "target-1", tabId: "tab-1", snapshotFormat: "semantic_v2" });

  assert.equal(response.kind, "ok");
  if (response.kind !== "ok" || response.value.mode !== "snapshot") throw new Error("expected a browser snapshot");
  assert.equal(response.value.format, "semantic_v2");
  assert.equal(response.value.refs[0]?.actions[0], "click");
  assert.equal(response.value.oopif?.frames, 0);
  assert.equal(response.value.omissions?.budget, 0);

  driver.responses.set("get_browser_state", result({
    status: "ok",
    mode: "snapshot",
    target_id: "target-1",
    tab_id: "tab-1",
    snapshot_id: "p2",
    url: "https://example.com/legacy",
    refs: [{ ref: "p2:1", node: "button", label: "Continue", frame: "main" }],
    oopif: { status: "unsupported", frames: 0 },
  }));
  const legacy = await gateway.getBrowserState({ mode: "snapshot", targetId: "target-1", tabId: "tab-1" });
  assert.equal(legacy.kind, "ok");
  if (legacy.kind !== "ok" || legacy.value.mode !== "snapshot") throw new Error("expected a legacy browser snapshot");
  assert.equal(legacy.value.format, "dom_refs_v1");
  assert.equal(legacy.value.refs[0]?.name, "Continue");
});

test("gateway accepts an empty bounded outline for a semantic query with no matches", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("get_browser_state", result({
    status: "ok",
    mode: "snapshot",
    target_id: "target-query-empty",
    tab_id: "tab-query-empty",
    snapshot: { id: "p3", format: "semantic_v2", complete: true, scope: "query" },
    page: { url: "https://example.com", title: "Example" },
    outline: "",
    refs: [],
    content_refs: [],
  }));
  const gateway = new CuaBrowserGateway(driver, "browser_query_empty_1");

  const response = await gateway.getBrowserState({
    mode: "snapshot",
    targetId: "target-query-empty",
    tabId: "tab-query-empty",
    snapshotFormat: "semantic_v2",
    query: "no matching element",
  });

  assert.equal(response.kind, "ok");
  if (response.kind !== "ok" || response.value.mode !== "snapshot") throw new Error("expected a semantic query snapshot");
  assert.equal(response.value.outline, "");
  assert.deepEqual(response.value.refs, []);
});

test("gateway preserves Cua's unknown active-tab state for exact binding to reject", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("get_browser_state", result({
    status: "ok",
    mode: "bind",
    target_id: "target-unknown-active",
    binding_quality: "exact",
    mutation_allowed: true,
    tabs: [{ tab_id: "tab-unknown-active", title: "New Tab", url: "about:blank", active: null }],
  }));
  const gateway = new CuaBrowserGateway(driver, "browser_unknown_active_1");

  const response = await gateway.getBrowserState({ mode: "bind", pid: 7123, windowId: 42n });

  assert.equal(response.kind, "ok");
  if (response.kind !== "ok" || response.value.mode !== "bind") throw new Error("expected a bound browser state");
  assert.equal(response.value.tabs[0]?.active, null);
});

test("gateway recognizes structured refusals even when the tool result is not an error", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("get_browser_state", result({
    status: "refused",
    refusal: {
      code: "browser_requires_setup",
      message: "prepare the browser first",
      detail: { next_action: "browser_prepare", ignored: { unbounded: true } },
    },
  }));
  const gateway = new CuaBrowserGateway(driver, "browser_refusal_1");

  const response = await gateway.getBrowserState({
    mode: "bind",
    pid: 7123,
    windowId: 42n,
  });

  assert.deepEqual(response, {
    kind: "refused",
    refusal: {
      code: "browser_requires_setup",
      message: "prepare the browser first",
      nextAction: "browser_prepare",
    },
  });
});

test("gateway does not interpret human text as a refusal and rejects malformed structured output", async () => {
  const driver = new FakeCuaBrowserDriver();
  driver.responses.set("browser_navigate", result({ status: "ok", url: 42 }));
  driver.responses.set("browser_prepare", result({}, { text: "refused: browser_requires_setup" }));
  const gateway = new CuaBrowserGateway(driver, "browser_malformed_1");

  await assert.rejects(
    gateway.navigate({ targetId: "target-1", tabId: "tab-1", url: "https://example.com" }),
    (error: unknown) => error instanceof CuaBrowserGatewayError && error.code === "malformed-result",
  );
  await assert.rejects(
    gateway.prepare({ allowLaunch: true, profile: { mode: "isolated_new" } }),
    (error: unknown) => error instanceof CuaBrowserGatewayError && error.code === "malformed-result",
  );
});

test("gateway ends only its explicit session and exposes no download operation or reserved approval argument", async () => {
  const driver = new FakeCuaBrowserDriver();
  const gateway = new CuaBrowserGateway(driver, "browser_cleanup_1");

  const ended = await gateway.endSession();

  assert.deepEqual(ended, { session: "browser_cleanup_1", active: false });
  assert.deepEqual(driver.ended, ["browser_cleanup_1"]);
  assert.equal("browserDownload" in (gateway as object), false);
  assert.equal(driver.calls.some((call) => call.name === "browser_download"), false);
  assert.equal(driver.calls.some((call) => call.argumentsJson.includes("_cua_browser_download_mcp_host_approved")), false);
});
