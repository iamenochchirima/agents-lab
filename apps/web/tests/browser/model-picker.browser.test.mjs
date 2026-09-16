import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const WEB_URL = process.env.AGENTLAB_WEB_URL ?? "http://127.0.0.1:5173";
const CHROME_BIN = process.env.AGENTLAB_CHROME_BIN ?? "google-chrome";

test("model picker handles loading, keyboard selection, empty/error, and stale catalog responses", async () => {
  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-model-picker-browser-"));
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

  let cdp;
  try {
    const target = await waitForPageTarget(debugPort);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    const modelRequests = [];
    const waiters = [];
    cdp.on("Fetch.requestPaused", (event) => {
      if (!event.request.url.includes("/api/models")) {
        void cdp.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => undefined);
        return;
      }
      if (event.request.method === "OPTIONS") {
        void cdp.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => undefined);
        return;
      }
      if (!(new URL(event.request.url).searchParams.get("q") ?? "")) {
        void fulfill(cdp, event.requestId, catalog([model("Alpha model", "alpha/model", 128_000), model("Beta model", "beta/model", 64_000)])).catch(() => undefined);
        return;
      }
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else modelRequests.push(event);
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:4318/api/models*", requestStage: "Request" }] });
    await cdp.send("Page.navigate", { url: `${WEB_URL}/platforms/temporal` });

    await waitForText(cdp, "Select a model");
    await click(cdp, ".model-picker-trigger");
    await waitForText(cdp, "Beta model");

    await focusSearch(cdp);
    await key(cdp, "ArrowDown", 40);
    await key(cdp, "Enter", 13);
    await waitForText(cdp, "Beta model");
    assert.equal(await text(cdp, ".model-picker-trigger"), "Beta model");

    await click(cdp, ".model-picker-trigger");
    await focusSearch(cdp);
    await insertText(cdp, "slow");
    const slowLoadingRequest = await nextModelRequest(modelRequests, waiters);
    await waitForText(cdp, "Searching");
    await fulfill(cdp, slowLoadingRequest.requestId, catalog([model("Slow model", "slow/model", 32_000)]));
    await waitForText(cdp, "Slow model");

    await focusSearch(cdp);
    await replaceSearch(cdp, "empty");
    const emptyRequest = await nextModelRequest(modelRequests, waiters);
    await fulfill(cdp, emptyRequest.requestId, catalog());
    await waitForText(cdp, "No models found");

    await focusSearch(cdp);
    await replaceSearch(cdp, "error");
    const errorRequest = await nextModelRequest(modelRequests, waiters);
    await fulfill(cdp, errorRequest.requestId, { status: 503, body: { error: { message: "Catalog unavailable in browser fixture." } } });
    await waitForText(cdp, "Catalog unavailable in browser fixture.");
    assert.equal(await text(cdp, '[role="alert"]'), "Catalog unavailable in browser fixture.");

    await focusSearch(cdp);
    await replaceSearch(cdp, "slow");
    const slowRequest = await nextModelRequest(modelRequests, waiters);
    await replaceSearch(cdp, "fast");
    const fastRequest = await nextModelRequest(modelRequests, waiters);
    await fulfill(cdp, fastRequest.requestId, catalog([model("Fast model", "fast/model", 32_000)]));
    await waitForText(cdp, "Fast model");
    try {
      await fulfill(cdp, slowRequest.requestId, catalog([model("Slow model", "slow/model", 32_000)]));
    } catch (error) {
      assert.match(String(error), /Invalid InterceptionId/);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await text(cdp, ".model-picker-option strong"), "Fast model");
  } finally {
    await cdp?.close();
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

function model(name, id, contextLength) {
  return {
    id,
    name,
    description: null,
    contextLength,
    inputModalities: ["text"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0,
    completionPriceUsdPerMillion: 0,
    isFree: true,
    supportsTools: false,
  };
}

function catalog(models = []) {
  return { status: 200, body: { provider: "openrouter", defaultModel: null, models } };
}

async function click(cdp, selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function focusSearch(cdp) {
  await cdp.evaluate('document.querySelector(\'[aria-label="Search OpenRouter models"]\')?.focus()');
}

async function replaceSearch(cdp, value) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await cdp.send("Input.insertText", { text: value });
}

async function insertText(cdp, value) {
  await cdp.send("Input.insertText", { text: value });
}

async function key(cdp, keyValue, keyCode) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyValue, code: keyValue, windowsVirtualKeyCode: keyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code: keyValue, windowsVirtualKeyCode: keyCode });
}

async function text(cdp, selector) {
  return cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ""`);
}

async function waitForText(cdp, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String((await cdp.evaluate("document.body?.innerText")) ?? "");
    if (body.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const currentPage = await cdp.evaluate("JSON.stringify({ href: location.href, readyState: document.readyState, body: document.body?.innerText ?? '' })");
  throw new Error(`Browser did not render expected text: ${expected}. Current page: ${String(currentPage).replace(/\s+/g, " ").slice(0, 700)}`);
}

async function nextModelRequest(queue, waiters, timeoutMs = 5_000) {
  if (queue.length > 0) return queue.shift();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(resolve);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("Timed out waiting for the browser model request."));
    }, timeoutMs);
    waiters.push((event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });
}

async function fulfill(cdp, requestId, response) {
  const body = Buffer.from(JSON.stringify(response.body)).toString("base64");
  await cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: response.status,
    responseHeaders: [
      { name: "content-type", value: "application/json" },
      { name: "access-control-allow-origin", value: "*" },
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
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
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  evaluate(expression) {
    return this.send("Runtime.evaluate", { expression, returnByValue: true }).then((response) => response.result?.value ?? null);
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
