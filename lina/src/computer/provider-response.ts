import { ToolExecutionError } from "../runtime/errors.js";

const MAX_PROVIDER_ERROR_CHARS = 512;

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim().slice(0, MAX_PROVIDER_ERROR_CHARS);
}

function nestedProviderError(rawError: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = rawError.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const nestedRaw = boundedText((metadata as Record<string, unknown>).raw);
  if (!nestedRaw) return undefined;
  try {
    const parsed: unknown = JSON.parse(nestedRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const nestedError = (parsed as Record<string, unknown>).error;
    return nestedError && typeof nestedError === "object" && !Array.isArray(nestedError)
      ? nestedError as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function errorSummary(rawError: unknown, depth = 0): string | undefined {
  if (!rawError || typeof rawError !== "object" || Array.isArray(rawError)) return undefined;
  const error = rawError as Record<string, unknown>;
  const numericCode = typeof error.code === "number" && Number.isInteger(error.code) ? error.code : undefined;
  const namedCode = boundedText(error.code);
  const message = boundedText(error.message);
  if (!message && numericCode === undefined && !namedCode) return undefined;
  if (depth === 0) {
    const nested = nestedProviderError(error);
    const nestedSummary = nested ? errorSummary(nested, 1) : undefined;
    const metadata = error.metadata;
    const providerName = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? boundedText((metadata as Record<string, unknown>).provider_name)
      : undefined;
    if (nestedSummary && (message === "Provider returned error" || nestedSummary !== `${namedCode ?? (numericCode !== undefined ? String(numericCode) : "")}: ${message ?? ""}`)) {
      return `${providerName ? `${providerName}: ` : ""}${nestedSummary}`.slice(0, MAX_PROVIDER_ERROR_CHARS);
    }
  }
  const code = numericCode !== undefined && numericCode >= 400 && numericCode <= 599
    ? `HTTP ${numericCode}`
    : namedCode;
  return `${code ? `${code}: ` : ""}${message ?? "The upstream model provider returned an unspecified error."}`.slice(0, MAX_PROVIDER_ERROR_CHARS);
}

/** Return only the bounded, structured diagnostic from a provider error body. */
export function providerErrorSummary(raw: string): string | undefined {
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    return errorSummary((body as Record<string, unknown>).error);
  } catch {
    return undefined;
  }
}

/** Build a bounded HTTP failure without retaining or exposing the raw body. */
export function providerHttpError(label: string, status: number, raw: string): ToolExecutionError {
  const detail = providerErrorSummary(raw);
  const statusText = detail?.startsWith(`HTTP ${status}:`) === true
    ? detail
    : `HTTP ${status}${detail ? `: ${detail}` : "."}`;
  return new ToolExecutionError(`${label} provider returned ${statusText}`);
}

/**
 * OpenAI-compatible gateways can return HTTP 200 with an error envelope when
 * an upstream model worker fails. Detect that shape before interpreting the
 * response as a malformed computer decision, while keeping the provider's
 * diagnostic bounded and outside durable evidence.
 */
export function throwIfProviderErrorEnvelope(body: Record<string, unknown>, label: string): void {
  const summary = errorSummary(body.error);
  if (!summary) return;
  throw new ToolExecutionError(`${label} provider returned an upstream error: ${summary}`);
}
