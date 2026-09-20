import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { ContextSessionStore } from "../../../src/capabilities/context/session-store.js";
import type { RunManifest } from "../../../src/control-plane/domain/types.js";
import { LangGraphBaselineRunner } from "../../../src/platforms/langgraph/runner-adapter/langgraph-runner.js";
import { langGraphThreadId, parseInspection } from "../../../src/platforms/langgraph/protocol/protocol.js";

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
      contextRoot: "lab/sessions",
    },
    model: { provider: "fake", model: "fake-success", contextWindowTokens: 256_000 },
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
        assert.deepEqual((body as Record<string, unknown>).model, { provider: "fake", model: "fake-success" });
        return { status: 202, body: { protocolVersion: 1, executionId: "langgraph:langgraph-test-run", runId: "langgraph-test-run", threadId: "langgraph-test-run", graph: "baseline", status: "queued", idempotent: false, serviceVersion: "0.1.0", langgraphVersion: "1.2.10", pythonVersion: "3.12.3" } };
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
      assert.equal(reference.native.serviceVersion, "0.1.0");
      assert.equal(reference.native.langgraphVersion, "1.2.10");
      assert.equal(reference.native.pythonVersion, "3.12.3");
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

test("LangGraph adapter maps a Lab session to one stable native thread", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-langgraph-thread-"));
  try {
    const store = new ContextSessionStore(root);
    await store.create({
      sessionId: "session-thread-test",
      platform: "langgraph",
      variant: "baseline",
      model: "fake/fake-success",
      systemInstruction: "answer directly",
      contextWindowTokens: 256_000,
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
    });
    const turn = await store.admitTurn("session-thread-test", "langgraph-test-run", "hello", undefined, "turn-1");

    await withProtocolServer(
      ({ method, url, body }) => {
      if (method === "POST" && url === "/v1/runs") {
        const request = body as Record<string, any>;
        assert.equal(request.sessionId, "session-thread-test");
        assert.equal(request.clientTurnId, "turn-1");
        assert.equal(request.threadId, langGraphThreadId("session-thread-test"));
        return {
          status: 202,
          body: {
            protocolVersion: 1,
            executionId: "langgraph:langgraph-test-run",
            runId: "langgraph-test-run",
            threadId: langGraphThreadId("session-thread-test"),
            graph: "baseline",
            status: "queued",
            idempotent: false,
          },
        };
      }
      return { status: 404, body: { detail: "not found" } };
      },
      async (origin) => {
        const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: origin, contextRoot: root });
        const request = {
          ...manifest(origin),
          context: {
            ...manifest(origin).context,
            sessionId: "session-thread-test",
            turnId: turn.turn.turnId,
            clientTurnId: "turn-1",
          },
          platformConfig: { ...manifest(origin).platformConfig, contextRoot: root },
        } satisfies RunManifest;
        const reference = await runner.start(request);
        assert.equal(reference.native.threadId, langGraphThreadId("session-thread-test"));
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LangGraph adapter compacts shared context before dispatch when the budget is due", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-langgraph-context-"));
  try {
    const store = new ContextSessionStore(root);
    await store.create({
      sessionId: "session-context-compaction",
      platform: "langgraph",
      variant: "baseline",
      model: "fake/fake-context",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 1_200,
      reservedOutputTokens: 100,
      safetyMarginTokens: 50,
      compactionThresholdPercent: 50,
      recentMessageGroups: 0,
    });
    const oldTurn = await store.admitTurn(
      "session-context-compaction",
      "run-context-old",
      `Old question ${"x".repeat(600)}`,
    );
    await store.settleTurn("session-context-compaction", oldTurn.turn.turnId, {
      status: "completed",
      output: `Old answer ${"y".repeat(600)}`,
      error: null,
    });
    const currentTurn = await store.admitTurn(
      "session-context-compaction",
      "run-context-current",
      "Current question.",
    );

    let snapshotId: string | null = null;
    await withProtocolServer(
      ({ method, url, body }) => {
        if (method === "POST" && url === "/v1/runs") {
          const request = body as Record<string, any>;
          snapshotId = request.context?.snapshotId ?? null;
          assert.equal(request.context?.sessionId, "session-context-compaction");
          assert.equal(request.threadId, langGraphThreadId("session-context-compaction"));
          return {
            status: 202,
            body: {
              protocolVersion: 1,
              executionId: "langgraph:run-context-current",
              runId: "run-context-current",
              threadId: langGraphThreadId("session-context-compaction"),
              graph: "baseline",
              status: "queued",
              idempotent: false,
            },
          };
        }
        return { status: 404, body: { detail: "not found" } };
      },
      async (origin) => {
        const base = manifest(origin);
        const request = {
          ...base,
          runId: "run-context-current",
          task: { kind: "prompt" as const, prompt: "Current question." },
          platformConfig: { ...base.platformConfig, contextRoot: root },
          model: { provider: "fake" as const, model: "fake-context", contextWindowTokens: 1_200 },
          context: {
            ...base.context,
            sessionId: "session-context-compaction",
            turnId: currentTurn.turn.turnId,
          },
        } satisfies RunManifest;
        await LangGraphBaselineRunner.fromOptions({ serviceUrl: origin, contextRoot: root }).start(request);
      },
    );

    assert.equal(typeof snapshotId, "string");
    assert.ok(snapshotId);
    const snapshot = await store.readSnapshot("session-context-compaction", snapshotId);
    assert.equal(snapshot.compaction?.trigger, "preflight");
    assert.ok((snapshot.compaction?.sourceMessageIds.length ?? 0) > 0);
    assert.notEqual(snapshot.budget.pressure, "exhausted");
    assert.ok(snapshot.messages.some((message) => message.source === "compaction-summary"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LangGraph adapter submits one recovered native execution after provider overflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-langgraph-overflow-"));
  try {
    const store = new ContextSessionStore(root);
    await store.create({
      sessionId: "session-provider-overflow",
      platform: "langgraph",
      variant: "baseline",
      model: "fake/fake-context",
      systemInstruction: "Answer directly.",
      contextWindowTokens: 1_200,
      reservedOutputTokens: 100,
      safetyMarginTokens: 50,
      compactionThresholdPercent: 50,
      recentMessageGroups: 0,
    });
    const oldTurn = await store.admitTurn(
      "session-provider-overflow",
      "run-overflow-old",
      `Old question ${"x".repeat(600)}`,
    );
    await store.settleTurn("session-provider-overflow", oldTurn.turn.turnId, {
      status: "completed",
      output: `Old answer ${"y".repeat(600)}`,
      error: null,
    });
    const currentTurn = await store.admitTurn(
      "session-provider-overflow",
      "run-provider-overflow",
      "Current question.",
    );

    let requestBody: Record<string, any> | null = null;
    await withProtocolServer(
      ({ method, url, body }) => {
        if (method === "POST" && url === "/v1/runs") {
          requestBody = body as Record<string, any>;
          const runId = requestBody.runId as string;
          return {
            status: 202,
            body: {
              protocolVersion: 1,
              executionId: `langgraph:${runId}`,
              runId,
              threadId: langGraphThreadId("session-provider-overflow"),
              graph: "baseline",
              status: "queued",
              idempotent: false,
            },
          };
        }
        return { status: 404, body: { detail: "not found" } };
      },
      async (origin) => {
        const base = manifest(origin);
        const recoveryManifest = {
          ...base,
          runId: "run-provider-overflow",
          platformConfig: { ...base.platformConfig, contextRoot: root },
          model: { provider: "fake" as const, model: "fake-context", contextWindowTokens: 1_200 },
          context: {
            ...base.context,
            sessionId: "session-provider-overflow",
            turnId: currentTurn.turn.turnId,
          },
        } satisfies RunManifest;
        const reference = {
          platform: "langgraph",
          variant: "baseline",
          executionId: "langgraph:run-provider-overflow",
          native: {
            serviceOrigin: origin,
            executionId: "langgraph:run-provider-overflow",
            labRunId: "run-provider-overflow",
            eventSource: "langgraph-service",
            threadId: langGraphThreadId("session-provider-overflow"),
            graph: "baseline",
            protocolVersion: 1,
          },
        };
        const recovered = await LangGraphBaselineRunner.fromOptions({ serviceUrl: origin }).recoverContextOverflow(recoveryManifest, reference);
        assert.equal(recovered.executionId, `langgraph:${requestBody?.runId}`);
        assert.equal(recovered.native.labRunId, "run-provider-overflow");
        assert.equal(recovered.native.eventSource, "langgraph-context-recovery");
        assert.equal(recovered.native.threadId, langGraphThreadId("session-provider-overflow"));
      },
    );

    assert.ok(requestBody);
    const body = requestBody as Record<string, any>;
    assert.match(body.runId, /^context-recovery-/);
    assert.match(body.clientTurnId, /^context-recovery-/);
    assert.equal(body.context.sessionId, "session-provider-overflow");
    assert.equal(typeof body.context.snapshotId, "string");
    const snapshot = await store.readSnapshot("session-provider-overflow", body.context.snapshotId);
    assert.equal(snapshot.compaction?.trigger, "provider_overflow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
