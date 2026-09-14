import type { ModelRequest, ModelStreamEvent } from "../runtime/contracts.js";

export interface ModelProvider {
  readonly provider: ModelRequest["provider"];
  readonly model: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}
