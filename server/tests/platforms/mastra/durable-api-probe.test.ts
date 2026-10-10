import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@mastra/core/agent";
import { createDurableAgent, type AgentSuspendedEventData } from "@mastra/core/agent/durable";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { waitForDurableSettlement } from "../../../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { createDeterministicFakeModel } from "../../../src/platforms/mastra/variants/baseline/models/fake.js";

test("pinned durable approval survives worker exit and resumes the exact call in a fresh process", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-durable-probe-"));
  const stores: LibSQLStore[] = [];
  let effects = 0;
  const build = async () => {
    const storage = new LibSQLStore({ id: "probe", url: `file:${join(root, "snapshots.db")}` });
    stores.push(storage); await storage.init();
    const agent = createDurableAgent({ agent: new Agent({ id: "probe-agent", name: "Probe", instructions: "Use calculator",
      model: createDeterministicFakeModel({ modelId: "probe", toolCall: true }), maxRetries: 0,
      tools: { calculator: createTool({ id: "calculator", description: "Add", requireApproval: true,
        inputSchema: z.object({ operation: z.string(), left: z.number(), right: z.number() }),
        execute: async input => { effects++; return { value: input.left + input.right }; } }) } }), cleanupTimeoutMs: 0 });
    const mastra = new Mastra({ storage, agents: { probe: agent }, logger: false });
    return { agent, mastra };
  };
  try {
    await promisify(execFile)(process.execPath, ["--import", "tsx", new URL("./fixtures/durable-approval-worker.ts", import.meta.url).pathname, root], { timeout: 15_000 });
    assert.equal(effects, 0);
    const second = await build();
    const resumed = await second.agent.approveToolCallGenerate({ runId: "probe-run", toolCallId: "mastra-calculator-1" });
    assert.match(resumed.text, /42/); assert.equal(effects, 1);
    await waitForDurableSettlement(second.agent, "probe-run");
  } finally { for (const storage of stores) await storage.close(); await rm(root, { recursive: true, force: true }); }
});


test("native recovery delivers a new approval suspension after interrupted inference", { timeout: 25_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-recovered-suspension-"));
  let storage: LibSQLStore | undefined;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", new URL("./fixtures/durable-approval-worker.ts", import.meta.url).pathname, root, "interrupt"], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("No native request")); }, 10_000);
      child.stdout.on("data", chunk => { if (String(chunk).includes("MODEL_REQUESTED")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Worker exited before request")); });
    });
    child.kill("SIGKILL"); await once(child, "exit");
    storage = new LibSQLStore({ id: "recovered-approval", url: `file:${join(root, "snapshots.db")}` }); await storage.init();
    const agent = createDurableAgent({ agent: new Agent({ id: "probe-agent", name: "Probe", instructions: "Use calculator",
      model: createDeterministicFakeModel({ modelId: "probe", toolCall: true }), maxRetries: 0,
      tools: { calculator: createTool({ id: "calculator", description: "Add", requireApproval: true,
        inputSchema: z.object({ operation: z.string(), left: z.number(), right: z.number() }),
        execute: async () => { throw new Error("Unapproved effect"); } }) } }), cleanupTimeoutMs: 0 });
    new Mastra({ storage, agents: { probe: agent }, logger: false });
    let suspended!: (data: AgentSuspendedEventData) => void;
    const observed = new Promise<AgentSuspendedEventData>(resolve => { suspended = resolve; });
    const recovered = await agent.recover("probe-run", { onSuspended: suspended });
    const waiting = await Promise.race([observed, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("No recovered suspension")), 5_000); timer.unref();
    })]);
    assert.equal(waiting.toolCallId, "mastra-calculator-1");
    await waitForDurableSettlement(agent, "probe-run"); recovered.cleanup();
  } finally { await storage?.close(); await rm(root, { recursive: true, force: true }); }
});
