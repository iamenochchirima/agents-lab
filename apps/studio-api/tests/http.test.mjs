import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";

import { DEFAULT_STUDIO_RUNS_ROOT, parseStudioApiConfig } from "../dist/config.js";
import { createStudioApiApp } from "../dist/http/app.js";
import { registerStudioChatRoutes } from "../dist/http/chat.js";
import { createReferenceAgent } from "@agent-harness-lab/reference-agent-assembly";
import { TextTurnExecutionError } from "@agent-harness-lab/agent-kernel";

test("Studio API health returns only its stable public identity", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      service: "studio-api",
      status: "ok",
      apiVersion: "1",
    });
  } finally {
    await app.close();
  }
});

test("calculator scenario runs a correlated tool round trip and returns its assembly evidence", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  const conversationId = `studio-test-${randomUUID()}`;
  const requestId = `calculator-test-${randomUUID()}`;
  let runId;
  try {
    const response = await app.inject({
      method: "POST",
      url: "/chat/scenarios/calculator/turns",
      payload: { conversationId, requestId },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    runId = body.runId;
    assert.equal(body.assembly.mode, "deterministic-reference");
    assert.equal(body.assembly.id, "studio-reference-agent");
    assert.equal(body.assembly.components.length, 12);
    assert.equal(body.observability.status, "durable");
    assert.ok(body.assembly.components.some((component) => component.area === "planning"));
    assert.equal(body.planning.module.id, "single-step-response-planner");
    assert.equal(body.planning.proposal.steps[0].kind, "respond");
    assert.equal(body.control.modelCalls, 2);
    assert.equal(body.control.toolCalls, 1);
    assert.equal(body.assistantMessage.content, "19 + 23 = 42.");
    assert.deepEqual(body.modelCalls[1].request.messages.map((message) => message.role), ["system", "user", "user", "assistant", "tool"]);
    const assistantCall = body.modelCalls[1].request.messages.find((message) => message.role === "assistant").toolCalls[0];
    const toolResult = body.modelCalls[1].request.messages.find((message) => message.role === "tool");
    assert.equal(toolResult.toolCallId, assistantCall.callId);
    assert.equal(toolResult.name, assistantCall.name);
    assert.deepEqual(JSON.parse(toolResult.content), { sum: 42 });
    assert.equal(body.runEvidence.find((item) => item.kind === "safety-evaluation").result.decision.decision, "allow");
    assert.equal(body.runEvidence.find((item) => item.kind === "environment-invocation").receipt.outcome, "completed");
    assert.equal(body.runEvidence.find((item) => item.kind === "output-action-receipt").receipt.status, "committed");
    await assertRunArtifacts(body.runId, "completed", "effect.environment-invocation");
  } finally {
    await app.inject({ method: "DELETE", url: `/chat/sessions/${encodeURIComponent(conversationId)}` });
    await app.close();
    await removeRunArtifacts(runId);
  }
});

test("ordinary free-text chat remains a no-tool deterministic Replay turn", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  const conversationId = `studio-test-${randomUUID()}`;
  const requestId = `replay-test-${randomUUID()}`;
  let runId;
  try {
    const response = await app.inject({
      method: "POST",
      url: "/chat/turns",
      payload: { conversationId, requestId, text: "Inspect this replay request.", remember: false },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    runId = body.runId;
    assert.equal(body.assembly.mode, "deterministic-reference");
    assert.equal(body.control.modelCalls, 1);
    assert.equal(body.control.toolCalls, 0);
    const publicResponse = JSON.stringify(body);
    assert.equal(publicResponse.includes(DEFAULT_STUDIO_RUNS_ROOT), false);
    assert.equal(publicResponse.includes("runDirectory"), false);
    assert.equal(body.runEvidence.some((item) => item.kind === "tool-validation"), false);
    assert.equal(body.runEvidence.find((item) => item.kind === "output-action-receipt").receipt.status, "committed");
    assert.equal(body.modelCalls.length, 1);
    assert.equal(body.planning.proposal.steps.length, 1);
    assert.ok(body.modelCalls[0].request.messages.some((message) => message.role === "user" && message.content.includes("Advisory Planning proposal")));
    await assertRunArtifacts(body.runId, "completed", "model.request-response");
  } finally {
    await app.inject({ method: "DELETE", url: `/chat/sessions/${encodeURIComponent(conversationId)}` });
    await app.close();
    await removeRunArtifacts(runId);
  }
});

test("computer scenario routes a verified fixture action through the same assembly", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  const conversationId = `studio-test-${randomUUID()}`;
  const requestId = `computer-test-${randomUUID()}`;
  let runId;
  try {
    const response = await app.inject({
      method: "POST",
      url: "/chat/scenarios/computer/turns",
      payload: { conversationId, requestId },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    runId = body.runId;
    assert.equal(body.assembly.id, "studio-reference-agent");
    assert.equal(body.assembly.components.length, 12);
    assert.equal(body.control.modelCalls, 2);
    assert.equal(body.control.toolCalls, 1);
    assert.equal(body.assistantMessage.content, "I clicked the Say hello button; the page now says hello.");
    const action = body.runEvidence.find((item) => item.kind === "computer-action");
    assert.equal(action.result.receipt.status, "completed");
    assert.equal(action.result.verification.status, "verified");
    assert.equal(body.runEvidence.filter((item) => item.kind === "computer-environment-invocation").length, 3);
    assert.ok(body.runEvidence.some((item) => item.kind === "output-action-receipt" && item.receipt.status === "committed"));
    await assertRunArtifacts(body.runId, "completed", "effect.computer-action");
  } finally {
    await app.inject({ method: "DELETE", url: `/chat/sessions/${encodeURIComponent(conversationId)}` });
    await app.close();
    await removeRunArtifacts(runId);
  }
});

test("session Memory recalls a remembered user turn in a later run", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  const conversationId = `studio-test-${randomUUID()}`;
  const runIds = [];
  try {
    const first = await app.inject({
      method: "POST",
      url: "/chat/turns",
      payload: { conversationId, requestId: `memory-write-${randomUUID()}`, text: "I like black tea in the morning.", remember: true },
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    runIds.push(firstBody.runId);
    assert.equal(firstBody.memory.writeReceipt.outcome, "applied");

    const second = await app.inject({
      method: "POST",
      url: "/chat/turns",
      payload: { conversationId, requestId: `memory-recall-${randomUUID()}`, text: "I like black tea in the morning.", remember: false },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    runIds.push(secondBody.runId);
    assert.ok(secondBody.memory.candidates.some((candidate) => candidate.record.content === "I like black tea in the morning."));
    assert.equal(secondBody.observability.status, "durable");
  } finally {
    await app.inject({ method: "DELETE", url: `/chat/sessions/${encodeURIComponent(conversationId)}` });
    await app.close();
    await Promise.all(runIds.map(removeRunArtifacts));
  }
});

test("cancelled kernel failures keep a cancelled terminal result and partial evidence", async () => {
  const runsRoot = await mkdtemp(join(tmpdir(), "studio-api-cancelled-run-"));
  const referenceAgent = createReferenceAgent();
  const abort = new Error("Studio turn was cancelled.");
  abort.name = "AbortError";
  const partial = {
    contextRequests: [],
    modelRequests: [],
    modelResponses: [],
    observations: [],
    runEvidence: [{ kind: "cancelled-after-planning" }],
  };
  const agent = Object.freeze({
    ...referenceAgent,
    async runTurn() {
      throw new TextTurnExecutionError(abort, partial);
    },
  });
  const app = Fastify({ logger: false });
  registerStudioChatRoutes(app, agent, runsRoot);
  const conversationId = `studio-test-${randomUUID()}`;
  try {
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/chat/turns",
      payload: { conversationId, requestId: `cancel-${randomUUID()}`, text: "Cancel this turn.", remember: false },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "TURN_CANCELLED");
    assert.ok(response.json().evidence.runEvidence.some((item) => item.kind === "cancelled-after-planning"));

    const [runDirectory] = await readdir(runsRoot);
    const result = JSON.parse(await readFile(join(runsRoot, runDirectory, "result.json"), "utf8"));
    assert.equal(result.status, "cancelled");
    assert.ok(result.partialEvidence.runEvidence.some((item) => item.kind === "cancelled-after-planning"));
  } finally {
    await app.close();
    await rm(runsRoot, { recursive: true, force: true });
  }
});

test("Studio API only grants browser CORS to the configured web origin", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  try {
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const rejected = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://example.test" },
    });
    assert.equal(allowed.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
    assert.equal(rejected.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  } finally {
    await app.close();
  }
});

test("Studio API configuration rejects invalid ports and non-origin web URLs", () => {
  assert.deepEqual(parseStudioApiConfig({}), {
    host: "127.0.0.1",
    port: 4320,
    webOrigin: "http://localhost:5173",
    runsRoot: DEFAULT_STUDIO_RUNS_ROOT,
  });
  assert.throws(() => parseStudioApiConfig({ STUDIO_API_PORT: "70000" }), /STUDIO_API_PORT/);
  assert.throws(() => parseStudioApiConfig({ STUDIO_API_WEB_ORIGIN: "http://localhost:5173/studio" }), /STUDIO_API_WEB_ORIGIN/);
});

async function assertRunArtifacts(runId, expectedStatus, expectedEventKind) {
  const directory = join(DEFAULT_STUDIO_RUNS_ROOT, `run-${encodeURIComponent(runId)}`);
  const [configText, eventsText, resultText] = await Promise.all([
    readFile(join(directory, "config.json"), "utf8"),
    readFile(join(directory, "events.jsonl"), "utf8"),
    readFile(join(directory, "result.json"), "utf8"),
  ]);
  const config = JSON.parse(configText);
  const events = eventsText.trim().split("\n").map((line) => JSON.parse(line));
  const result = JSON.parse(resultText);
  assert.equal(config.runId, runId);
  assert.equal(config.assembly.components.length, 12);
  assert.equal(result.status, expectedStatus);
  assert.equal(events.at(-1).event.kind, "run.completed");
  assert.ok(events.some((event) => event.event.kind === expectedEventKind));
  assert.ok(events.every((event, index) => event.event.sequence === index));
  assert.ok(events.every((event) => event.event.runId === runId));
}

async function removeRunArtifacts(runId) {
  if (!runId) return;
  await rm(join(DEFAULT_STUDIO_RUNS_ROOT, `run-${encodeURIComponent(runId)}`), { recursive: true, force: true });
}
