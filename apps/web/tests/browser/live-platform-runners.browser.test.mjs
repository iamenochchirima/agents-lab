import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const API_URL = process.env.AGENTLAB_API_URL ?? "http://127.0.0.1:4318";
const WEB_URL = process.env.AGENTLAB_WEB_URL ?? "http://127.0.0.1:5173";
const CHROME_BIN = process.env.AGENTLAB_CHROME_BIN ?? "google-chrome";
const MODEL_ID = "cohere/north-mini-code:free";
const REPO_ROOT = process.env.AGENTLAB_REPO_ROOT ?? process.cwd();
const PLATFORMS = [
  "temporal",
  "restate",
  "langgraph",
  "mastra",
  "vercel-workflows",
  "inngest",
  "trigger-dev",
  "dbos",
  "hatchet",
];
const SELECTED_PLATFORMS = (process.env.AGENTLAB_LIVE_PLATFORM_IDS ?? "")
  .split(",")
  .map((platform) => platform.trim())
  .filter(Boolean);
const PLATFORMS_TO_CHECK = SELECTED_PLATFORMS.length > 0 ? SELECTED_PLATFORMS : PLATFORMS;

test("live platform runners use the selected OpenRouter model", { skip: !process.env.AGENTLAB_RUN_LIVE_PLATFORM_UI }, async (t) => {
  const availability = await Promise.all(PLATFORMS_TO_CHECK.map(checkPlatform));
  const reachable = availability.filter((platform) => platform.reachable);
  const unavailable = availability.filter((platform) => !platform.reachable);

  for (const platform of unavailable) {
    t.diagnostic(`${platform.id}: not validated because ${platform.message}`);
  }
  assert.ok(reachable.length > 0, "No configured platform is reachable for the live UI check.");

  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-live-platform-ui-"));
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
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const platform of reachable) {
      await cdp.send("Page.navigate", { url: `${WEB_URL}/platforms/${platform.id}` });
      await waitForElement(cdp, 'textarea[aria-label="Task prompt"]');
      await waitForElement(cdp, ".model-picker-trigger");
      await click(cdp, ".model-picker-trigger");
      await waitForElement(cdp, '[aria-label="Search OpenRouter models"]');
      await setInput(cdp, '[aria-label="Search OpenRouter models"]', MODEL_ID);
      await waitForText(cdp, MODEL_ID);
      await clickModel(cdp, MODEL_ID);
      await setInput(cdp, 'textarea[aria-label="Task prompt"]', `Return exactly: ${platform.id} live runner smoke.`);
      await clickButton(cdp, "Run");
      await waitForElement(cdp, ".run-status-panel");
      await waitForCompleted(cdp, 120_000);

      const result = await cdp.evaluate(`JSON.stringify({
        runId: document.querySelector(".run-status-meta code")?.textContent?.trim() ?? null,
        status: document.querySelector(".run-status-badge")?.textContent?.trim() ?? null,
        model: Array.from(document.querySelectorAll(".run-manifest-summary dd"))
          .find((item) => item.textContent?.includes("openrouter"))?.textContent?.trim() ?? null,
        output: document.querySelector(".run-output p")?.textContent?.trim() ?? null,
      })`);
      const parsed = JSON.parse(result);
      assert.equal(parsed.status, "Completed", `${platform.id} did not complete`);
      assert.equal(parsed.model, `openrouter / ${MODEL_ID}`);
      assert.ok(parsed.runId, `${platform.id} did not render a run ID`);
      assert.ok(parsed.output, `${platform.id} did not render model output`);
      t.diagnostic(`${platform.id}: completed ${parsed.runId}`);
    }
  } finally {
    await cdp?.close();
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("live Restate Chat continues a real session and renders context usage", { skip: !process.env.AGENTLAB_RUN_LIVE_RESTATE_CHAT_UI }, async (t) => {
  const availability = await checkPlatform("restate");
  assert.equal(availability.reachable, true, availability.message);

  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-live-restate-chat-"));
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
  const errors = [];
  try {
    const target = await waitForPageTarget(debugPort);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") errors.push(params.args?.map((argument) => argument.value ?? argument.description ?? "").join(" ") ?? "console error");
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: `${WEB_URL}/platforms/restate/chat` });
    await waitForElement(cdp, ".chat-page");
    await waitForText(cdp, "Ready");

    await click(cdp, ".model-picker-trigger");
    await waitForElement(cdp, '[aria-label="Search OpenRouter models"]');
    await setInput(cdp, '[aria-label="Search OpenRouter models"]', MODEL_ID);
    await waitForText(cdp, MODEL_ID);
    await clickModel(cdp, MODEL_ID);

    await setInput(cdp, 'textarea[aria-label="Message"]', "Give one short sentence about a first live turn.");
    await clickButton(cdp, "Send");
    await waitForChatTurn(cdp, 1);
    const firstTurn = JSON.parse(await cdp.evaluate(`JSON.stringify({
      userMessages: document.querySelectorAll(".chat-message-user").length,
      assistantMessages: document.querySelectorAll(".chat-message-assistant.chat-message-status-completed").length,
      context: document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    })`));
    assert.equal(firstTurn.userMessages, 1);
    assert.equal(firstTurn.assistantMessages, 1);
    assert.match(firstTurn.context ?? "", /tokens/);
    assert.match(firstTurn.context ?? "", /% left/);
    assert.equal(await cdp.evaluate('document.querySelector(".model-picker-trigger")?.hasAttribute("disabled")'), true);

    await setInput(cdp, 'textarea[aria-label="Message"]', "Give one short sentence continuing the conversation.");
    await clickButton(cdp, "Send");
    await waitForChatTurn(cdp, 2);
    const secondTurn = JSON.parse(await cdp.evaluate(`JSON.stringify({
      userMessages: document.querySelectorAll(".chat-message-user").length,
      assistantMessages: document.querySelectorAll(".chat-message-assistant.chat-message-status-completed").length,
      context: document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
    })`));
    assert.equal(secondTurn.userMessages, 2);
    assert.equal(secondTurn.assistantMessages, 2);
    assert.match(secondTurn.context ?? "", /tokens/);
    assert.match(secondTurn.context ?? "", /% left/);
    assert.deepEqual(errors, []);
    t.diagnostic(`Restate Chat completed two real turns with ${secondTurn.context}`);
  } finally {
    await cdp?.close();
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("live Restate Chat reconciles after the Lab server is replaced", { skip: !process.env.AGENTLAB_RUN_LIVE_RESTATE_SERVER_RESTART_UI }, async (t) => {
  const serverPid = Number(process.env.AGENTLAB_LAB_SERVER_PID);
  assert.ok(Number.isInteger(serverPid) && serverPid > 0, "Set AGENTLAB_LAB_SERVER_PID to the Lab server listener PID.");
  const command = spawnSync("ps", ["-p", String(serverPid), "-o", "args="], { encoding: "utf8" }).stdout.trim();
  assert.match(command, /agents-lab/);
  assert.match(command, /control-plane[\\/]bootstrap[\\/]server/);

  const sessionId = `browser-restart-${Date.now()}`;
  const createdResponse = await fetch(`${API_URL}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": `browser-restart-${Date.now()}` },
    body: JSON.stringify({
      platform: "restate",
      variant: "baseline",
      sessionId,
      clientTurnId: `${sessionId}-turn-1`,
      task: { kind: "prompt", prompt: "Browser restart recovery." },
      model: { provider: "fake", model: "fake-delay", contextWindowTokens: 100_000 },
    }),
  });
  const createdBody = await createdResponse.json();
  assert.equal(createdResponse.status, 202, JSON.stringify(createdBody));
  assert.ok(createdBody.runId);
  assert.match(createdBody.status, /queued|running/);

  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-live-restate-server-restart-"));
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
  let replacement;
  let replacementOutput = "";
  try {
    const target = await waitForPageTarget(debugPort);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: `${WEB_URL}/platforms/restate/chat?run=${encodeURIComponent(createdBody.runId)}` });
    await waitForElement(cdp, ".chat-page");
    await waitForText(cdp, createdBody.runId);

    process.kill(serverPid, "SIGTERM");
    await waitForHttpFailure(`${API_URL}/ready`);

    replacement = spawn("./scripts/run_local_stack.sh", ["server"], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTLAB_API_HOST: new URL(API_URL).hostname,
        AGENTLAB_API_PORT: new URL(API_URL).port || "4318",
      },
    });
    replacement.stdout?.on("data", (chunk) => { replacementOutput += String(chunk); });
    replacement.stderr?.on("data", (chunk) => { replacementOutput += String(chunk); });
    await waitForHttp(`${API_URL}/ready`, 20_000, () => replacementOutput);
    try {
      await waitForText(cdp, "Fake response: Browser restart recovery.", 30_000);
    } catch (error) {
      const body = String(await cdp.evaluate("document.body?.innerText ?? ''"));
      throw new Error(`${error instanceof Error ? error.message : String(error)}; browser body: ${body}`);
    }
    assert.equal(await cdp.evaluate("document.querySelectorAll('.chat-message-assistant.chat-message-status-completed').length"), 1);
    assert.equal(await cdp.evaluate("document.body.innerText.includes('Start a new chat before sending another turn.')"), false);
    t.diagnostic(`Browser reconciled ${createdBody.runId} after replacing Lab server PID ${serverPid}.`);
  } finally {
    await cdp?.close();
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    if (replacement?.pid && replacement.exitCode === null) {
      await stopDetachedProcess(replacement);
    }
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

async function checkPlatform(id) {
  try {
    const response = await fetch(`${API_URL}/api/platforms/${encodeURIComponent(id)}/health`);
    const body = await response.json();
    return { id, reachable: response.ok && body.reachable === true, message: body.message ?? `HTTP ${response.status}` };
  } catch (error) {
    return { id, reachable: false, message: error instanceof Error ? error.message : "health request failed" };
  }
}

async function click(cdp, selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function clickButton(cdp, label) {
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error("Button not found: " + ${JSON.stringify(label)});
    button.click();
  })()`);
}

async function clickModel(cdp, modelId) {
  await cdp.evaluate(`(() => {
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((candidate) => candidate.querySelector("code")?.textContent?.trim() === ${JSON.stringify(modelId)});
    if (!option) throw new Error("Model option not found: " + ${JSON.stringify(modelId)});
    option.click();
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

async function waitForElement(cdp, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for element ${selector}`);
}

async function waitForText(cdp, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String(await cdp.evaluate("document.body?.innerText ?? \"\""));
    if (body.includes(expected)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for text ${expected}`);
}

async function waitForExpression(cdp, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function waitForCompleted(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = String(await cdp.evaluate("document.querySelector('.run-status-badge')?.textContent ?? \"\""));
    if (/Completed|Failed|Cancelled|Reconciliation required/i.test(status)) {
      assert.match(status, /Completed/i, `run ended with ${status}`);
      return;
    }
    await delay(1_000);
  }
  throw new Error("Timed out waiting for a platform run to complete.");
}

async function waitForHttp(url, timeoutMs = 20_000, diagnostic = () => "") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The replacement process is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}. Replacement output: ${diagnostic()}`);
}

async function waitForHttpFailure(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await delay(100);
  }
  throw new Error(`The replaced service remained reachable at ${url}`);
}

async function waitForChatTurn(cdp, expectedAssistantCount, timeoutMs = 120_000) {
  await waitForExpression(cdp, `document.querySelectorAll('.chat-message-assistant.chat-message-status-completed').length >= ${expectedAssistantCount} && !document.querySelector('.chat-message-assistant.chat-message-status-running, .chat-message-assistant.chat-message-status-pending')`, timeoutMs);
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

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

async function stopDetachedProcess(child) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([waitForExit(child), delay(3_000)]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
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
