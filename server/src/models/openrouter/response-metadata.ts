/** Safe bounded diagnostics from a parsed completion response, never reasoning content.
 * Missing fields remain null: token exhaustion is an interpretation of recorded
 * finish reason and counts, not an inferred provider failure category.
 */
export interface OpenRouterResponseMetadata {
  readonly finishReason: string | null;
  readonly providerRequestId: string | null;
  readonly providerModel: string | null;
  readonly providerName: string | null;
  readonly providerUsage: { readonly inputTokens: number | null; readonly outputTokens: number | null;
    readonly totalTokens: number | null; readonly reasoningTokens: number | null };
}

export function openRouterResponseMetadata(body: unknown): OpenRouterResponseMetadata {
  const record = asRecord(body);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const usage = asRecord(record.usage);
  const details = asRecord(usage.completion_tokens_details);
  return {
    finishReason: text(asRecord(choices[0]).finish_reason),
    providerRequestId: text(record.id), providerModel: text(record.model), providerName: text(record.provider),
    providerUsage: { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens),
      totalTokens: count(usage.total_tokens), reasoningTokens: count(details.reasoning_tokens) },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" ? Buffer.from(value, "utf8").subarray(0, 256).toString("utf8") : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
