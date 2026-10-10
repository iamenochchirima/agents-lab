import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { createDurableAgent } from "@mastra/core/agent/durable";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { createDeterministicFakeModel } from "../../../../src/platforms/mastra/variants/baseline/models/fake.js";
import { preserveDurableRecoveryInputs } from "../../../../src/platforms/mastra/variants/baseline/durability/recovery-snapshots.js";
const storage = new LibSQLStore({ id: "approval-worker", url: `file:${join(process.argv[2]!, "snapshots.db")}` });
await storage.init();
const agent = createDurableAgent({ agent: new Agent({ id: "probe-agent", name: "Probe", instructions: "Use calculator",
  model: createDeterministicFakeModel({ modelId: "probe", toolCall: true, ...(process.argv[3] === "interrupt" ? { delayMs: 10_000, onRequest: () => process.stdout.write("MODEL_REQUESTED\n") } : {}) }), maxRetries: 0,
  tools: { calculator: createTool({ id: "calculator", description: "Add", requireApproval: true,
    inputSchema: z.object({ operation: z.string(), left: z.number(), right: z.number() }),
    execute: async () => { throw new Error("Unapproved call escaped"); } }) } }), cleanupTimeoutMs: 0 });
if (process.argv[3] === "interrupt") preserveDurableRecoveryInputs(agent.getWorkflow());
new Mastra({ storage, agents: { probe: agent }, logger: false });
const output = await agent.generate("Add", { runId: "probe-run" });
if (output.finishReason !== "suspended") throw new Error("Native approval did not suspend");
await storage.close();
process.exit(0);
