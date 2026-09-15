import assert from "node:assert/strict";
import test from "node:test";

import type { RunManifest } from "../src/control-plane/domain/types.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";

const serviceUrl = process.env.AGENTLAB_LANGGRAPH_SERVICE_URL;

test("real LangGraph service completes a fake baseline run", { skip: !serviceUrl }, async () => {
  const runner = LangGraphBaselineRunner.fromOptions({ serviceUrl: serviceUrl! });
  const manifest: RunManifest = {
    schemaVersion: 1,
    runId: `integration-${Date.now()}`,
    createdAt: new Date().toISOString(),
    serverVersion: "integration",
    platform: "langgraph",
    variant: "baseline",
    task: { kind: "prompt", prompt: "Return a short checkpoint explanation." },
    context: { systemInstruction: "Answer directly." },
    platformConfig: runner.manifestConfiguration(),
    model: { provider: "fake", model: "fake-success" },
  };

  const connectivity = await runner.checkConnection();
  assert.equal(connectivity.reachable, true, connectivity.message);
  const reference = await runner.start(manifest);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const inspection = await runner.inspect(reference);
    if (inspection.result) {
      assert.equal(inspection.result.status, "completed");
      assert.match(inspection.result.output ?? "", /^Fake response:/);
      assert.ok(inspection.eventIntents.some((event) => event.kind === "CheckpointWritten"));
      assert.ok(inspection.metrics);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("The real LangGraph service did not produce a terminal result.");
});
