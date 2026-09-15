import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { LangGraphBaselineRunner } from "../../../src/platforms/langgraph/runner-adapter/langgraph-runner.js";
import { parseInspection } from "../../../src/platforms/langgraph/protocol/protocol.js";

async function withProtocolServer(
  handler: (request: { method: string; url: string; body: unknown }) => { status?: number; body: unknown },
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    const result = handler({ method: request.method ?? "GET", url: request.url ?? "/", body });
    response.statusCode = result.status ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result.body));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function manifest(serviceUrl: string): RunManifest {
  return {
    schemaVersion: 1,
    runId: "langgraph-test-run",
    createdAt: "2026-09-15T10:00:00.000Z",
    serverVersion: "test",
    platform: "langgraph",
    variant: "baseline",
    task: { kind: "prompt", prompt: "hello" },
    context: { systemInstruction: "answer directly" },
    platformConfig: {
      serviceUrl,
      protocolVersion: 1,
      graph: "baseline",
      durability: "sqlite-sync",
      maxAttempts: 2,
      timeoutMs: 30_000,
    },
    model: { provider: "fake", model: "fake-success" },
  };
}
test("LangGraph adapter validates and maps the local protocol", async () => {
  await withProtocolServer(
    ({ method, url, body }) => {
      if (method === "GET" && url === "/health") {
        return {
          body: {
            protocolVersion: 1,
            service: "langgraph",
            serviceVersion: "0.1.0",
            langgraphVersion: "1.2.10",
            pythonVersion: "3.12.3",
            status: "ready",
            checkpointPath: "/tmp/langgraph.sqlite",
            checkpointPathWritable: true,
            message: "ready",
          },
        };
      }
      if (method === "POST" && url === "/v1/runs") {
        assert.equal((body as Record<string, unknown>).runId, "langgraph-test-run");
        return { status: 202, body: { protocolVersion: 1, executionId: "langgraph:langgraph-test-run", runId: "langgraph-test-run", threadId: "langgraph-test-run", graph: "baseline", status: "queued", idempotent: false } };
      }
      if (method === "GET" && url === "/v1/runs/langgraph%3Alanggraph-test-run") {
        return { body: inspectionBody("completed") };
      }
      if (method === "POST" && url === "/v1/runs/langgraph%3Alanggraph-test-run/cancel") {
        return { body: { protocolVersion: 1, executionId: "langgraph:langgraph-test-run", status: "completed", accepted: false, alreadyTerminal: true, message: "Execution is already completed." } };
      }
      return { status: 404, body: { detail: "not found" } };
    },
    async (origin) => {
      const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: origin });
      const connection = await runner.checkConnection();
      assert.deepEqual(connection, { reachable: true, message: "ready" });
      const request = manifest(origin);
      assert.deepEqual(runner.validate(request), { valid: true, reason: null });
      const reference = await runner.start(request);
      assert.equal(reference.executionId, "langgraph:langgraph-test-run");
      assert.equal(reference.native.threadId, "langgraph-test-run");
      assert.equal(reference.native.serviceOrigin, origin);
      assert.equal("prompt" in reference.native, false);
      const inspection = await runner.inspect(reference);
      assert.equal(inspection.status, "completed");
      assert.equal(inspection.result?.output, "Fake response: hello");
      assert.equal(inspection.metrics?.modelCallCount, 1);
      const cancellation = await runner.cancel(reference, "already done");
      assert.equal(cancellation.alreadyTerminal, true);
    },
  );
});

test("LangGraph adapter turns an unknown native outcome into reconciliation-required evidence", () => {
  assert.throws(
    () => parseInspection({ protocolVersion: 999 }),
    /Unsupported LangGraph protocol version/,
  );
});

test("LangGraph adapter reconciles a lost start acknowledgement by stable execution identity", async () => {
  await withProtocolServer(
    ({ method, url }) => {
      if (method === "POST" && url === "/v1/runs") {
        return { status: 503, body: { detail: "admission response was lost" } };
      }
      if (method === "GET" && url === "/v1/runs/langgraph%3Alanggraph-test-run") {
        return { body: inspectionBody("completed") };
      }
      return { status: 404, body: { detail: "not found" } };
    },
    async (origin) => {
      const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: origin });
      const reference = await runner.start(manifest(origin));
      assert.equal(reference.executionId, "langgraph:langgraph-test-run");
      assert.equal(reference.native["serviceOrigin"], origin);
    },
  );
});

test("LangGraph adapter reports an unavailable service without fabricating a run", async () => {
  const runner = LangGraphBaselineRunner.fromOptions({
    serviceUrl: "http://127.0.0.1:1",
    requestTimeoutMs: 100,
  });
  const connection = await runner.checkConnection();
  assert.equal(connection.reachable, false);
  await assert.rejects(
    () => runner.start(manifest("http://127.0.0.1:1")),
    /fetch failed|LangGraph service|ECONNREFUSED/i,
  );
});

function inspectionBody(status: "completed" | "unknown") {
  return {
    protocolVersion: 1,
    executionId: "langgraph:langgraph-test-run",
    runId: "langgraph-test-run",
    threadId: "langgraph-test-run",
    graph: "baseline",
    status,
    checkpoint: { checkpointId: "checkpoint-1", step: 1, count: 3, pendingWrites: 0 },
    events: [
      { source: "langgraph-service", sourceSequence: 1, kind: "ModelRequested", runId: "langgraph-test-run", occurredAt: "2026-09-15T10:00:00.000Z", payload: { node: "model", attempt: 1 } },
    ],
    result: {
      status,
      runId: "langgraph-test-run",
      startedAt: "2026-09-15T10:00:00.000Z",
      finishedAt: "2026-09-15T10:00:01.000Z",
      output: status === "completed" ? "Fake response: hello" : null,
      error: status === "completed" ? null : { code: "SERVICE_RESTARTED", message: "unknown", failureKind: "outcome_unknown", retryable: false },
      attemptCount: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    },
    trajectory: { phases: [{ name: "graph", startedAt: "2026-09-15T10:00:00.000Z", finishedAt: "2026-09-15T10:00:01.000Z" }] },
    metrics: { modelCallCount: 1, modelAttemptCount: 1, checkpointCount: 3, durationMs: 1000, inputTokens: null, outputTokens: null, totalTokens: null },
  };
}
