import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { AwsStepFunctionsPlatformService } from "../../../src/platforms/aws-step-functions/service/step-functions-service.js";
import { FakeStepFunctionsApi, testConfig } from "./helpers.js";

test("platform-local HTTP service exposes admit, dispatch, inspect, and cancel", async () => {
  const service = new AwsStepFunctionsPlatformService({
    api: new FakeStepFunctionsApi(),
    config: testConfig(),
    startWorker: false,
  });
  const server = service.createHttpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}`;
  const run = { runId: "run-http", prompt: "hello", systemInstruction: "be concise", provider: "fake", model: "fake-success" };

  try {
    const admitted = await request(endpoint, "/runs/admit", { method: "POST", body: JSON.stringify(run) });
    assert.equal(admitted.status, 200);
    const dispatched = await request(endpoint, "/runs/run-http/dispatch", { method: "POST", body: JSON.stringify(run) });
    assert.equal(dispatched.status, 200);
    const executionArn = String((dispatched.body as { executionArn: string }).executionArn);
    const running = await request(endpoint, `/runs/run-http?executionArn=${encodeURIComponent(executionArn)}`, { method: "GET" });
    assert.equal(running.status, 200);
    assert.equal((running.body as { status: string }).status, "running");
    const cancelled = await request(endpoint, `/runs/run-http?executionArn=${encodeURIComponent(executionArn)}`, { method: "POST", body: JSON.stringify({ reason: "stop" }) });
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body as { accepted: boolean }).accepted, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await service.close();
  }
});

async function request(endpoint: string, path: string, init: { readonly method: string; readonly body?: string }): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${endpoint}${path}`, {
    method: init.method,
    headers: { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return { status: response.status, body: await response.json() };
}
