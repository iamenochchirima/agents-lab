import type { HatchetConfig } from "../../../config.js";
import type { HatchetModelAdapter } from "../contracts.js";
import { FakeHatchetModelAdapter } from "./fake.js";
import { OpenRouterHatchetModelAdapter } from "./openrouter.js";

export function createHatchetModelAdapter(
  provider: "fake" | "openrouter",
  config: Pick<HatchetConfig, "openRouterApiKey" | "openRouterBaseUrl">,
): HatchetModelAdapter {
  switch (provider) {
    case "fake":
      return new FakeHatchetModelAdapter();
    case "openrouter":
      return new OpenRouterHatchetModelAdapter({
        apiKey: config.openRouterApiKey,
        baseUrl: config.openRouterBaseUrl,
      });
  }
}
