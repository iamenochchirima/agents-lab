import type { ModelAdapter, TemporalModelProvider } from "../contracts.js";
import { FakeModelAdapter } from "./fake.js";
import { OpenRouterModelAdapter } from "./openrouter.js";

export function createModelAdapter(provider: TemporalModelProvider, environment: NodeJS.ProcessEnv = process.env): ModelAdapter {
  switch (provider) {
    case "fake":
      return new FakeModelAdapter();
    case "openrouter":
      return new OpenRouterModelAdapter({
        apiKey: environment.OPENROUTER_API_KEY,
        baseUrl: environment.AGENTLAB_OPENROUTER_BASE_URL,
      });
  }
}
