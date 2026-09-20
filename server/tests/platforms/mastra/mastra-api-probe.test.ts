import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Mastra } from "@mastra/core/mastra";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";

test("Mastra workflow and LibSQL public APIs form a runnable local boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-mastra-probe-"));
  const storage = new LibSQLStore({
    id: "agentlab-mastra-probe",
    url: `file:${join(root, "mastra.db")}`,
  });

  const echoStep = createStep({
    id: "echo",
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ response: z.string() }),
    execute: async ({ inputData }) => ({ response: `Echo: ${inputData.prompt}` }),
  });
  const workflow = createWorkflow({
    id: "mastra-api-probe",
    inputSchema: z.object({ prompt: z.string() }),
    outputSchema: z.object({ response: z.string() }),
  }).then(echoStep).commit();

  const mastra = new Mastra({
    storage,
    workflows: { probe: workflow },
    logger: false,
  });

  try {
    const registered = mastra.getWorkflowById("mastra-api-probe");
    const run = await registered.createRun({ runId: "probe-run" });
    const result = await run.start({ inputData: { prompt: "hello" } });

    assert.equal(result.status, "success");
    assert.deepEqual(result.result, { response: "Echo: hello" });
    assert.equal(run.runId, "probe-run");
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
