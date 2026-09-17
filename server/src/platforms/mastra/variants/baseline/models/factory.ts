import type { MastraModelConfig } from "@mastra/core/llm";

import type { RunManifest } from "../../../../../control-plane/domain/types.js";
import { modelIdForManifest } from "../config/configuration.js";
import { createDeterministicFakeModel } from "./fake.js";

export type MastraModelFactory = (manifest: RunManifest) => MastraModelConfig;

export const defaultMastraModelFactory: MastraModelFactory = (manifest) => {
  if (manifest.model.provider === "fake") {
    return fakeModelFromName(manifest.model.model);
  }

  // Mastra's model router reads OPENROUTER_API_KEY from the environment. The
  // key is deliberately not passed through the manifest or native evidence.
  return modelIdForManifest(manifest);
};

function fakeModelFromName(modelName: string): MastraModelConfig {
  switch (modelName) {
    case "fake-success":
      return createDeterministicFakeModel({ modelId: modelName });
    case "fake-slow":
      return createDeterministicFakeModel({ modelId: modelName, delayMs: 100 });
    case "fake-provider-failure":
      return createDeterministicFakeModel({ modelId: modelName, failure: "provider" });
    case "fake-ambiguous":
      return createDeterministicFakeModel({ modelId: modelName, failure: "ambiguous" });
    case "fake-tool-call":
      return createDeterministicFakeModel({ modelId: modelName, toolCall: true });
    default:
      throw new Error(`Unsupported Mastra fake model: ${modelName}.`);
  }
}
