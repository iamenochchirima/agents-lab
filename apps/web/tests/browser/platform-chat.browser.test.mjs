import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const WEB_URL = process.env.AGENTLAB_WEB_URL ?? "http://127.0.0.1:5173";
const CHROME_BIN = process.env.AGENTLAB_CHROME_BIN ?? "google-chrome";

test("Platform Chat completes a turn, exposes safe evidence, and preserves platform state", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await waitForElement(browser.cdp, ".chat-page");
    await waitForText(browser.cdp, "Temporal");
    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      platform: document.querySelector(".chat-heading .eyebrow")?.textContent?.trim(),
      setupHref: document.querySelector('a[href="/platforms/temporal"]')?.getAttribute("href"),
      controlledRunVisible: Boolean(document.querySelector('textarea[aria-label="Task prompt"]')),
    })`).then(JSON.parse), {
      platform: "Temporal",
      setupHref: "/platforms/temporal",
      controlledRunVisible: false,
    });

    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Calculate 40 + 2.");

    await clickButton(browser.cdp, "Send");
    await click(browser.cdp, 'button[type="submit"]');
    await waitForText(browser.cdp, "The calculator result is 42.");

    const completed = await browser.cdp.evaluate(`JSON.stringify({
      userMessages: document.querySelectorAll(".chat-message-user").length,
      assistantMessages: document.querySelectorAll(".chat-message-assistant").length,
      toolActivity: document.querySelector(".chat-tool-activity")?.textContent?.trim() ?? null,
      context: document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      modelDisabled: document.querySelector(".model-picker-trigger")?.hasAttribute("disabled") ?? false,
      noDuplicateVisibleIds: (() => {
        const ids = [...document.querySelectorAll(".chat-message")].map((node) => node.getAttribute("aria-label"));
        return new Set(ids).size === ids.length;
      })(),
    })`).then(JSON.parse);
    assert.equal(fixture.state.createRequests, 1, "a second send must not create another run");
    assert.match(fixture.state.requests[0]?.sessionId ?? "", /^session-/);
    assert.match(fixture.state.clientTurnIds[0] ?? "", /^chat-turn-[A-Za-z0-9-]+$/);
    assert.equal(completed.userMessages, 1);
    assert.equal(completed.assistantMessages, 1);
    assert.match(completed.toolActivity, /calculator.*Completed/i);
    assert.match(completed.context, /8% used/);
    assert.equal(completed.modelDisabled, true);
    assert.equal(completed.noDuplicateVisibleIds, true);

    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "Evidence");
    const evidence = await browser.cdp.evaluate(`JSON.stringify([...document.querySelectorAll(".chat-evidence a")].map((link) => ({
      name: link.textContent?.trim(),
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
    })))` ).then(JSON.parse);
    assert.deepEqual(evidence.map((item) => item.name), ["config.json", "events.jsonl", "context.json", "trajectory.json", "metrics.json", "result.json"]);
    assert.ok(evidence.every((item) => item.href?.startsWith(`http://127.0.0.1:4318/api/runs/${fixture.state.runIds[0]}/evidence/`)));
    assert.ok(evidence.every((item) => item.target === "_blank"));

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Keep this session going.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".chat-message-user").length === 2 && document.querySelectorAll(".chat-message-assistant").length === 2');
    assert.equal(fixture.state.requests[1]?.sessionId, fixture.state.requests[0]?.sessionId, "Temporal follow-up must address the existing session");
    assert.notEqual(fixture.state.clientTurnIds[0], fixture.state.clientTurnIds[1], "each submitted turn must have a distinct idempotency key");
    assert.ok(fixture.state.clientTurnIds.every((id) => /^chat-turn-[A-Za-z0-9-]+$/.test(id)));
    assert.equal(await browser.cdp.evaluate('document.querySelector(".model-picker-trigger")?.hasAttribute("disabled")'), true);

    await clickButton(browser.cdp, "New chat");
    await waitForText(browser.cdp, "Start a conversation");
    assert.equal(await browser.cdp.evaluate("location.search"), "");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.model-picker-trigger')?.hasAttribute('disabled')"), false);

    await browser.cdp.evaluate('document.querySelector("a[href=\\"/platforms/temporal\\"]")?.click()');
    await waitForElement(browser.cdp, 'textarea[aria-label="Task prompt"]');
    assert.equal(await browser.cdp.evaluate("document.querySelector('.runner-heading h1')?.textContent?.trim()"), "Run an agent");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.chat-page') === null"), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "Chat must not open native browser dialogs");
  } finally {
    await browser.close();
  }
});

test("Platform Chat reports unavailable, API failure, and cancellation states", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Restate");
    await waitForText(browser.cdp, "Restate runtime is unavailable.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(\'textarea[aria-label="Message"]\')?.hasAttribute("disabled")'), true);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-unavailable")?.textContent?.trim()'), "Unavailable");

    await navigate(browser.cdp, "/platforms/temporal/chat");
    fixture.setMode("api-error");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "This request should fail.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The fixture rejected this run.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-failed")?.textContent?.includes("The fixture rejected this run.")'), true);
    assert.equal(fixture.state.createRequests, 1);
    assert.equal(fixture.state.runReads, 0, "a rejected create request must not start polling");

    await clickButton(browser.cdp, "New chat");
    fixture.setMode("cancel");
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Cancel this request.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Stop");
    await clickButton(browser.cdp, "Stop");
    await waitForText(browser.cdp, "Cancelled");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-cancelled")?.textContent?.includes("Cancelled")'), true);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-composer textarea")?.hasAttribute("disabled")'), false);
    assert.equal(fixture.state.createRequests, 2);
    assert.equal(new Set(fixture.state.clientTurnIds).size, 2, "New chat must produce a fresh turn id when the next message is submitted");
    assert.ok(fixture.state.clientTurnIds.every((id) => /^chat-turn-[A-Za-z0-9-]+$/.test(id)));
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "Chat must not open native browser dialogs");
  } finally {
    await browser.close();
  }
});

test("non-Temporal Chat discloses single-turn behavior and requires a model", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    assert.match(await browser.cdp.evaluate("document.body.innerText"), /Each message starts a platform run\./);

    await browser.cdp.evaluate('document.querySelector("[aria-label=\\"Clear selected model\\"]")?.click()');
    assert.equal(await browser.cdp.evaluate('document.querySelector("button[type=submit]")?.hasAttribute("disabled")'), true);
    assert.match(await browser.cdp.evaluate("document.body.innerText"), /Select a model\./);

    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Return a short answer.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Restate fixture completed.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-session-note")?.textContent?.trim()'), "Each turn is a separate platform run until this platform has a session adapter.");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.model-picker-trigger')?.hasAttribute('disabled')"), false);
    assert.equal(fixture.state.createRequests, 1);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

async function installFixture(cdp) {
  const state = {
    createRequests: 0,
    runReads: 0,
    runReadsById: new Map(),
    runIds: [],
    requests: [],
    clientTurnIds: [],
    runRequests: new Map(),
    mode: "complete",
    cancelled: false,
    restateAvailable: false,
  };

  cdp.on("Fetch.requestPaused", (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith("/api/")) {
      void cdp.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => undefined);
      return;
    }
    void respond(event).catch(() => undefined);
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:4318/api/*", requestStage: "Request" }] });

  async function respond(event) {
    const url = new URL(event.request.url);
    if (event.request.method === "OPTIONS") {
      await fulfill(cdp, event.requestId, { status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/models") {
      await fulfill(cdp, event.requestId, { status: 200, body: {
        provider: "openrouter",
        defaultModel: "cohere/north-mini-code:free",
        models: [modelOption()],
      } });
      return;
    }

    const healthMatch = url.pathname.match(/^\/api\/platforms\/([^/]+)\/health$/);
    if (healthMatch) {
      const platform = decodeURIComponent(healthMatch[1]);
      const unavailable = platform === "restate" && !state.restateAvailable;
      await fulfill(cdp, event.requestId, { status: 200, body: {
        platform,
        variant: "baseline",
        reachable: !unavailable,
        message: unavailable ? "Restate runtime is unavailable." : `${platform} fixture is ready.`,
      } });
      return;
    }

    if (url.pathname === "/api/runs" && event.request.method === "POST") {
      state.createRequests += 1;
      const request = JSON.parse(event.request.postData ?? "{}");
      state.requests.push(request);
      state.clientTurnIds.push(request.clientTurnId);
      if (state.mode === "api-error") {
        await fulfill(cdp, event.requestId, { status: 503, body: { error: { code: "FIXTURE_REJECTED", message: "The fixture rejected this run." } } });
        return;
      }
      state.cancelled = false;
      const runId = request.platform === "restate" ? "run-restate" : `run-chat-${state.createRequests}`;
      state.runIds.push(runId);
      state.runRequests.set(runId, request);
      await fulfill(cdp, event.requestId, { status: 202, body: makeRun(request, state.mode === "cancel" ? "running" : "queued", runId) });
      return;
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/(run-chat-\d+|run-restate)$/);
    if (runMatch && event.request.method === "GET") {
      const runId = runMatch[1];
      const request = state.runRequests.get(runId);
      if (!request) {
        await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture run not found." } } });
        return;
      }
      state.runReads += 1;
      const runReads = (state.runReadsById.get(runId) ?? 0) + 1;
      state.runReadsById.set(runId, runReads);
      const status = request.platform === "restate" ? "completed" : state.mode === "cancel"
        ? (state.cancelled ? "cancelled" : "running")
        : runReads === 1 ? "running" : "completed";
      await fulfill(cdp, event.requestId, { status: 200, body: makeRun(request, status, runId) });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/runs\/(run-chat-\d+|run-restate)\/events$/);
    if (eventsMatch && event.request.method === "GET") {
      const runId = eventsMatch[1];
      const request = state.runRequests.get(runId);
      if (!request) {
        await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture run not found." } } });
        return;
      }
      const runReads = state.runReadsById.get(runId) ?? 0;
      const run = makeRun(request, request.platform === "restate" ? "completed" : state.mode === "cancel" && !state.cancelled ? "running" : state.mode === "cancel" ? "cancelled" : runReads > 1 ? "completed" : "running", runId);
      await fulfill(cdp, event.requestId, { status: 200, body: { runId: run.runId, events: run.events, nextSequence: run.events.at(-1)?.recordedSequence ?? 0, hasMore: false, done: run.result !== null } });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/runs\/(run-chat-\d+)\/cancel$/);
    if (cancelMatch && event.request.method === "POST") {
      const runId = cancelMatch[1];
      const request = state.runRequests.get(runId);
      state.cancelled = true;
      await fulfill(cdp, event.requestId, { status: 200, body: makeRun(request ?? { platform: "temporal", task: { kind: "prompt", prompt: "fixture" }, model: modelOption() }, "cancelled", runId) });
      return;
    }

    await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture route not found." } } });
  }

  return {
    state,
    setMode: (mode) => { state.mode = mode; },
    setRestateAvailable: (available) => { state.restateAvailable = available; },
  };
}

function makeRun(request, status, runIdOverride) {
  const platform = request.platform ?? "temporal";
  const runId = runIdOverride ?? (platform === "restate" ? "run-restate" : "run-chat-1");
  const events = platform === "restate"
    ? [event(runId, 1, "AgentStarted", platform), event(runId, 2, "AgentCompleted", platform)]
    : [
        event(runId, 1, "AgentStarted", platform),
        event(runId, 2, "ModelCallStarted", platform),
        event(runId, 3, "ToolCallRequested", platform, { toolName: "calculator" }),
        event(runId, 4, "ToolExecutionStarted", platform, { toolName: "calculator" }),
        event(runId, 5, "ToolExecutionCompleted", platform, { toolName: "calculator" }),
        event(runId, 6, "AgentCompleted", platform),
      ];
  const isTemporal = platform === "temporal";
  const sessionId = request.sessionId ?? "session-chat";
  const terminal = status === "completed" || status === "cancelled";
  const result = terminal ? {
    runId,
    status,
    finishedAt: "2026-09-16T12:00:00.000Z",
    output: status === "completed" ? isTemporal ? "The calculator result is 42." : "Restate fixture completed." : null,
    error: null,
    attemptCount: 1,
    usage: { inputTokens: 8000, outputTokens: 100, totalTokens: 8100 },
  } : null;
  return {
    runId,
    status,
    manifest: {
      platform,
      variant: "baseline",
      task: { prompt: request.task?.prompt ?? "fixture" },
      model: {
        provider: "openrouter",
        model: request.model?.model ?? "cohere/north-mini-code:free",
        contextWindowTokens: 100_000,
      },
      ...(isTemporal ? { context: { sessionId, turnId: "turn-chat", snapshotId: "snapshot-chat" } } : {}),
    },
    events,
    executionReference: { platform, variant: "baseline", executionId: runId, native: { fixture: true } },
    result,
    trajectory: terminal && isTemporal ? { schemaVersion: 1, runId, phases: [] } : null,
    metrics: terminal && isTemporal ? { schemaVersion: 1, runId, durationMs: 0, eventCount: events.length } : null,
    context: isTemporal ? {
      scope: "session",
      sessionId,
      sessionRevision: 1,
      compactionRevision: 0,
      budget: {
        contextWindowTokens: 100_000,
        inputTokens: 8_000,
        reservedOutputTokens: 1_000,
        safetyMarginTokens: 500,
        remainingTokens: 90_500,
        remainingPercent: 90.5,
        quality: "estimated",
        tokenizerBasis: "fixture",
        pressure: "normal",
      },
      updatedAt: "2026-09-16T12:00:00.000Z",
    } : null,
    projection: { state: "current", observedAt: "2026-09-16T12:00:00.000Z", reason: null },
  };
}

function event(runId, sequence, kind, source, payload = {}) {
  return {
    eventId: `${runId}:${sequence}`,
    recordedSequence: sequence,
    source: `${source}-fixture`,
    sourceSequence: sequence,
    kind,
    runId,
    occurredAt: `2026-09-16T12:00:0${sequence}.000Z`,
    payload,
  };
}

function modelOption() {
  return {
    id: "cohere/north-mini-code:free",
    name: "North Mini Code",
    description: null,
    contextLength: 100_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0,
    completionPriceUsdPerMillion: 0,
    isFree: true,
    supportsTools: true,
  };
}

async function openBrowser() {
  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-platform-chat-browser-"));
  const debugPort = await unusedPort();
  const chrome = spawn(CHROME_BIN, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const target = await waitForPageTarget(debugPort);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  const errors = [];
  const dialogs = [];
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") errors.push(params.args?.map((argument) => argument.value ?? argument.description ?? "").join(" ") ?? "console error");
  });
  cdp.on("Page.javascriptDialogOpening", (params) => dialogs.push(params.message));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });

  return {
    cdp,
    errors,
    dialogs,
    async close() {
      await cdp.close();
      chrome.kill("SIGTERM");
      await waitForExit(chrome);
      await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

async function navigate(cdp, path) {
  await cdp.send("Page.navigate", { url: `${WEB_URL}${path}` });
  await waitForElement(cdp, "#root");
}

async function chooseModel(cdp) {
  await waitForElement(cdp, ".model-picker-trigger");
  await click(cdp, ".model-picker-trigger");
  await waitForText(cdp, "Select a model");
  await clickModel(cdp, "cohere/north-mini-code:free");
}

async function clickModel(cdp, modelId) {
  await cdp.evaluate(`(() => {
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((candidate) => candidate.querySelector("code")?.textContent?.trim() === ${JSON.stringify(modelId)});
    if (!option) throw new Error("Model option not found: " + ${JSON.stringify(modelId)});
    option.click();
  })()`);
}

async function click(cdp, selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function clickButton(cdp, label) {
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)} && !candidate.disabled);
    if (!button) throw new Error("Enabled button not found: " + ${JSON.stringify(label)});
    button.click();
  })()`);
}

async function clickSummary(cdp, text) {
  await cdp.evaluate(`(() => {
    const summary = Array.from(document.querySelectorAll("summary"))
      .find((candidate) => candidate.textContent?.trim().startsWith(${JSON.stringify(text)}));
    if (!summary) throw new Error("Summary not found: " + ${JSON.stringify(text)});
    summary.click();
  })()`);
}

async function setInput(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Input not found: " + ${JSON.stringify(selector)});
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function waitForElement(cdp, selector, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for element ${selector}`);
}

async function waitForText(cdp, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String(await cdp.evaluate("document.body?.innerText ?? \"\""));
    if (body.includes(expected)) return;
    await delay(50);
  }
  const currentPage = await cdp.evaluate("JSON.stringify({ href: location.href, body: document.body?.innerText ?? '' })");
  throw new Error(`Browser did not render expected text: ${expected}. Current page: ${String(currentPage).replace(/\\s+/g, " ").slice(0, 900)}`);
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function fulfill(cdp, requestId, response) {
  const isEmpty = response.body === "";
  const body = isEmpty ? "" : Buffer.from(JSON.stringify(response.body)).toString("base64");
  await cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: response.status,
    responseHeaders: [
      { name: "content-type", value: isEmpty ? "text/plain" : "application/json" },
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    ],
    body,
  });
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForPageTarget(debugPort) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await delay(50);
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data))));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, reject, resolve });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  evaluate(expression) {
    return this.send("Runtime.evaluate", { expression, returnByValue: true })
      .then((response) => response.result?.value ?? null);
  }

  close() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    this.socket.close();
    return new Promise((resolve) => this.socket.addEventListener("close", resolve, { once: true }));
  }

  receive(message) {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }
}
