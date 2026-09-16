export interface ResolvedModelMetadata {
  readonly contextWindowTokens: number | null;
}

/**
 * Resolves provider metadata at the server boundary. Run manifests retain the
 * returned value so a later catalog change cannot alter an existing run.
 */
export interface ModelMetadataResolver {
  resolve(provider: string, model: string, signal?: AbortSignal): Promise<ResolvedModelMetadata | null>;
}
