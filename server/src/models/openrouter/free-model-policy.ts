/** Eval-only controls. Paid interactive configuration elsewhere is unchanged.
 * OpenRouter documents zero price ceilings and parameter requirements at
 * https://openrouter.ai/docs/guides/routing/provider-selection#max-price
 */
export const DEFAULT_FREE_MODEL = "google/gemma-4-31b-it:free";
export const COMPARISON_FREE_MODEL = "nvidia/nemotron-3.5-lightning:free";
export const COHERE_FREE_MODEL = "cohere/north-mini-code:free";
export const SUSTAINED_FREE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const LIVE_MAX_OUTPUT_TOKENS = 512;
export type FreeEvalExperiment = "agent-harness-live" | "agent-capabilities-live";
const FREE_EVAL_SETTINGS = Object.freeze({
  "agent-harness-live": Object.freeze({ experimentId: "agent-harness-live" as const, maxOutputTokens: 512 }),
  "agent-capabilities-live": Object.freeze({ experimentId: "agent-capabilities-live" as const, maxOutputTokens: 2048 }),
});
/** Allowances belong to the selected experiment, never a client-supplied token limit. */
export function getFreeEvalSettings(experimentId?: string): { readonly experimentId: FreeEvalExperiment; readonly maxOutputTokens: number } | undefined {
  return experimentId === "agent-harness-live" || experimentId === "agent-capabilities-live" ? FREE_EVAL_SETTINGS[experimentId] : undefined;
}
export function isFreeEval(experimentId?: string): boolean { return getFreeEvalSettings(experimentId) !== undefined; }
export const FREE_PROVIDER_ROUTING = Object.freeze({
  require_parameters: true,
  allow_fallbacks: false,
  max_price: Object.freeze({ prompt: 0, completion: 0, request: 0, image: 0 }),
});
export class FreeModelPolicyError extends Error {
  readonly code = "FREE_MODEL_POLICY_REJECTED";
  constructor(message: string) { super(message); this.name = "FreeModelPolicyError"; }
}
/** Exact IDs only. Adding candidates is explicit and still requires fresh catalog validation. */
export function assertSelectedFreeModel(model: string): void {
  if (![DEFAULT_FREE_MODEL, COMPARISON_FREE_MODEL, COHERE_FREE_MODEL, SUSTAINED_FREE_MODEL].includes(model)) reject("Select an approved exact free-model ID; model routers and paid models are disabled for live evals.");
}
/** Fresh raw /models catalog, not the UI's cached/truncated model list. Fail closed on unknown prices. */
export function assertFreeModelCatalog(catalog: unknown, model: string): { id: string; contextLength: number | null; supportedParameters: readonly string[] } {
  assertSelectedFreeModel(model);
  if (!record(catalog) || !Array.isArray(catalog.data)) reject("OpenRouter returned an invalid catalog.");
  const matches = catalog.data.filter((value: unknown) => record(value) && value.id === model);
  if (matches.length !== 1) reject("Selected free model is unavailable or ambiguous in the current catalog.");
  const value = matches[0] as Record<string, unknown>;
  const pricing = value.pricing;
  if (!record(pricing) || !zeroPrice(pricing.prompt) || !zeroPrice(pricing.completion) ||
      Object.entries(pricing).some(([key, price]) => !["discount", "internal_reasoning_discount"].includes(key) && !zeroPrice(price))) {
    reject("Selected model does not have confirmed zero pricing for every listed billing dimension.");
  }
  const supportedParameters = Array.isArray(value.supported_parameters) ? value.supported_parameters.filter((item): item is string => typeof item === "string") : [];
  if (!supportedParameters.includes("tools") || !supportedParameters.includes("tool_choice") || !supportedParameters.includes("max_tokens")) reject("Selected free model must support tools, tool_choice and max_tokens.");
  return { id: model, contextLength: typeof value.context_length === "number" && Number.isSafeInteger(value.context_length) && value.context_length > 0 ? value.context_length : null, supportedParameters };
}
/** Call immediately before transport. Catalog validation alone cannot constrain SDK routing. */
export function assertFreeModelRequest(body: unknown, model: string, experimentId: string = "agent-harness-live"): void {
  const settings = getFreeEvalSettings(experimentId);
  if (!settings) reject("Unknown free evaluation experiment.");
  assertSelectedFreeModel(model);
  if (!record(body) || body.model !== model || body.models !== undefined || body.route !== undefined || body.plugins !== undefined) reject("Live eval request changed the selected model or enabled routing/plugins.");
  if (body.max_tokens !== settings.maxOutputTokens) reject("Live eval requests must retain the bounded output allowance.");
  const provider = body.provider;
  if (!record(provider) || provider.require_parameters !== true || provider.allow_fallbacks !== false || !record(provider.max_price)) reject("Live eval requests require zero-price routing with fallback disabled.");
  const ceilings = provider.max_price;
  if (["prompt", "completion", "request", "image"].some((key) => ceilings[key] !== 0)) reject("Live eval price ceilings must all be zero.");
}
function zeroPrice(value: unknown): boolean {
  return (typeof value === "number" && value === 0) || (typeof value === "string" && value.trim().length > 0 && Number(value) === 0);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function reject(message: string): never { throw new FreeModelPolicyError(message); }
