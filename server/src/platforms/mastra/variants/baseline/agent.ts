import { Agent } from "@mastra/core/agent";

import type { RunManifest } from "../../../../control-plane/domain/types.js";
import { MASTRA_AGENT_ID } from "./config/configuration.js";
import { defaultMastraModelFactory, type MastraModelFactory } from "./models/factory.js";

export const BASELINE_AGENT_INSTRUCTIONS =
  "You are the Agent Harness Lab Mastra baseline agent. Answer the user's prompt directly and concisely.";

export function createBaselineAgent(
  manifest: RunManifest,
  modelFactory: MastraModelFactory = defaultMastraModelFactory,
): Agent {
  return new Agent({
    id: MASTRA_AGENT_ID,
    name: "Mastra baseline agent",
    instructions: BASELINE_AGENT_INSTRUCTIONS,
    model: modelFactory(manifest),
    maxRetries: 0,
    // No tools, memory, workspace, workflows, or durable option are supplied
    // in this direct-agent variant. Those are separate Mastra experiments.
  });
}
