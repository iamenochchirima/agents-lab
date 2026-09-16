import { URL } from "node:url";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_CATALOG_TIMEOUT_MS = 8_000;
export const OPENROUTER_DEFAULT_CATALOG_CACHE_TTL_MS = 60_000;
export const OPENROUTER_DEFAULT_CATALOG_LIMIT = 40;

export interface OpenRouterCatalogConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly cacheTtlMs: number;
  readonly resultLimit: number;
  readonly defaultModel: string | null;
}

export interface OpenRouterModelOption {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly contextLength: number | null;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly promptPriceUsdPerMillion: number | null;
  readonly completionPriceUsdPerMillion: number | null;
  readonly isFree: boolean;
  readonly supportsTools: boolean;
}

export interface OpenRouterCatalogResult {
  readonly provider: "openrouter";
  readonly defaultModel: string | null;
  readonly models: readonly OpenRouterModelOption[];
}

export interface OpenRouterCatalogClient {
  list(query?: string, signal?: AbortSignal): Promise<OpenRouterCatalogResult>;
}

export class OpenRouterCatalogError extends Error {
  constructor(
    readonly code: "OPENROUTER_NOT_CONFIGURED" | "OPENROUTER_CATALOG_UNAVAILABLE" | "OPENROUTER_CATALOG_INVALID" | "OPENROUTER_MODEL_NOT_FOUND",
    message: string,
    readonly statusCode = 503,
  ) {
    super(message);
    this.name = "OpenRouterCatalogError";
  }
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: OpenRouterCatalogResult;
}

export class OpenRouterModelCatalog implements OpenRouterCatalogClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: OpenRouterCatalogConfig,
    options: { readonly fetchImplementation?: typeof fetch; readonly now?: () => number } = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async list(query = "", signal?: AbortSignal): Promise<OpenRouterCatalogResult> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ").toLowerCase();
    const cached = this.cache.get(normalizedQuery);
    if (cached && cached.expiresAt > this.now()) {
      return cached.result;
    }

    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      throw new OpenRouterCatalogError(
        "OPENROUTER_NOT_CONFIGURED",
        "OpenRouter is not configured. Add OPENROUTER_API_KEY to the server environment.",
      );
    }

    const endpoint = new URL(`${this.config.baseUrl.replace(/\/$/, "")}/models`);
    endpoint.searchParams.set("output_modalities", "text");
    if (normalizedQuery) endpoint.searchParams.set("q", normalizedQuery);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await this.fetchImplementation(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenRouterCatalogError(
          "OPENROUTER_CATALOG_UNAVAILABLE",
          `OpenRouter model catalog returned HTTP ${response.status}.`,
          response.status >= 400 && response.status < 500 ? 502 : 503,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OpenRouterCatalogError(
          "OPENROUTER_CATALOG_INVALID",
          "OpenRouter returned an invalid model catalog response.",
          502,
        );
      }

      const result = parseCatalog(body, this.config.defaultModel, this.config.resultLimit, normalizedQuery.length === 0);
      this.cache.set(normalizedQuery, { expiresAt: this.now() + this.config.cacheTtlMs, result });
      return result;
    } catch (error) {
      if (error instanceof OpenRouterCatalogError) throw error;
      if (signal?.aborted) throw error;
      throw new OpenRouterCatalogError(
        "OPENROUTER_CATALOG_UNAVAILABLE",
        "The OpenRouter model catalog could not be reached.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async resolve(provider: string, model: string, signal?: AbortSignal): Promise<{ readonly contextWindowTokens: number | null } | null> {
    if (provider !== "openrouter") return null;
    const selectedModel = model.trim();
    if (!selectedModel) return null;
    const catalog = await this.list(selectedModel, signal);
    const option = catalog.models.find((candidate) => candidate.id === selectedModel);
    if (!option) {
      throw new OpenRouterCatalogError("OPENROUTER_MODEL_NOT_FOUND", "The selected OpenRouter model was not found in the server catalog.", 400);
    }
    return { contextWindowTokens: option.contextLength };
  }
}

function parseCatalog(
  body: unknown,
  defaultModel: string | null,
  limit: number,
  includeDefault: boolean,
): OpenRouterCatalogResult {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new OpenRouterCatalogError("OPENROUTER_CATALOG_INVALID", "OpenRouter returned no model catalog data.", 502);
  }

  const sortedModels = body.data
    .map(parseModel)
    .filter((model): model is OpenRouterModelOption => model !== null)
    .filter((model) => model.outputModalities.length === 0 || model.outputModalities.includes("text"))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const models = sortedModels.slice(0, limit);
  if (includeDefault && defaultModel && !models.some((model) => model.id === defaultModel)) {
    const defaultOption = sortedModels.find((model) => model.id === defaultModel);
    if (defaultOption) {
      models.splice(Math.max(models.length - 1, 0), 1, defaultOption);
      models.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    }
  }

  return { provider: "openrouter", defaultModel, models };
}

function parseModel(value: unknown): OpenRouterModelOption | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const id = value.id.trim();
  const name = value.name.trim();
  if (!id || !name) return null;

  const pricing = isRecord(value.pricing) ? value.pricing : null;
  const inputModalities = stringArray(value.input_modalities);
  const outputModalities = stringArray(value.output_modalities);
  const supportedParameters = stringArray(value.supported_parameters);
  const promptPriceUsdPerMillion = pricePerMillion(pricing?.prompt);
  const completionPriceUsdPerMillion = pricePerMillion(pricing?.completion);

  return {
    id,
    name,
    description: typeof value.description === "string" && value.description.trim() ? value.description.trim() : null,
    contextLength: integerOrNull(value.context_length),
    inputModalities,
    outputModalities,
    promptPriceUsdPerMillion,
    completionPriceUsdPerMillion,
    isFree: promptPriceUsdPerMillion === 0 && completionPriceUsdPerMillion === 0,
    supportsTools: supportedParameters.includes("tools") || supportedParameters.includes("tool_choice"),
  };
}

function pricePerMillion(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed * 1_000_000;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}
