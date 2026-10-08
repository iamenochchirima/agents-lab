/** MCP HTTP OAuth discovery and client registration. Credentials returned by this
 * module belong exclusively in the backend credential store, never registry/API output.
 * The administrator pins issuer trust and scopes before remote metadata is consulted.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 */
export interface McpOAuthMetadata {
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint?: string;
  readonly issuerRequired: boolean;
  readonly requestedScopes: readonly string[];
  readonly tokenEndpointAuthMethods: readonly string[];
  readonly clientMetadataDocumentSupported: boolean;
  readonly registrationEndpoint?: string;
}
export interface McpOAuthDiscoveryOptions {
  readonly resource: string;
  readonly allowedIssuers: readonly string[];
  readonly requestedScopes: readonly string[];
  readonly protectedResourceMetadataUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}
export type McpOAuthClient = {
  readonly kind: "ready";
  readonly method: "pre_registered" | "metadata_document" | "dynamic_registration";
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenEndpointAuthMethod: "none" | "client_secret_post";
} | { readonly kind: "manual_setup"; readonly reason: string };
export interface McpOAuthClientOptions {
  readonly metadata: McpOAuthMetadata;
  readonly redirectUri: string;
  readonly preRegistered?: { readonly clientId: string; readonly clientSecret?: string };
  /** Must already be published as an HTTPS client metadata document. */
  readonly clientMetadataUrl?: string;
  readonly clientName?: string;
  readonly fetchImplementation?: typeof fetch;
}
export class OAuthDiscoveryError extends Error {
  constructor(readonly code: "OAUTH_DISCOVERY_FAILED" | "OAUTH_SCOPE_CHANGE_REQUIRED" | "OAUTH_ISSUER_UNTRUSTED" | "OAUTH_REGISTRATION_UNKNOWN", message: string) { super(message); this.name = code; }
}
const MAX_BYTES = 65_536;
function fail(message: string): never { throw new OAuthDiscoveryError("OAUTH_DISCOVERY_FAILED", message); }

/** Challenge URL first; otherwise protected-resource path then root. Issuer metadata
 * tries OAuth path insertion, OIDC path insertion, then OIDC path append in that order.
 * An invalid metadata identity is a hard failure rather than a fallback opportunity.
 */
export async function discoverMcpOAuth(options: McpOAuthDiscoveryOptions, signal: AbortSignal): Promise<McpOAuthMetadata> {
  const resource = trustedUrl(options.resource);
  const fetcher = options.fetchImplementation ?? fetch;
  if (!options.allowedIssuers.length || options.allowedIssuers.length > 16) fail("OAuth discovery requires explicitly trusted issuers.");
  options.allowedIssuers.forEach(trustedUrl);
  validateScopes(options.requestedScopes);
  const response = await safeFetch(fetcher, options.resource, { method: "GET", headers: { accept: "application/json, text/event-stream" } }, signal);
  const challenge = parseBearerChallenge(response.status === 401 ? response.headers.get("www-authenticate") : null);
  await response.body?.cancel();
  if (challenge.scopes.some(scope => !options.requestedScopes.includes(scope))) throw new OAuthDiscoveryError("OAUTH_SCOPE_CHANGE_REQUIRED", "Provider requires additional scopes; update the connection grant before authorizing.");
  const fallback = [`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`, `${resource.origin}/.well-known/oauth-protected-resource`];
  const urls = challenge.metadataUrl ? [challenge.metadataUrl] : options.protectedResourceMetadataUrl ? [options.protectedResourceMetadataUrl] : [...new Set(fallback)];
  for (const url of urls) if (resource.protocol === "https:" && trustedUrl(url).protocol !== "https:") fail("Protected resource metadata cannot downgrade HTTPS.");
  const protectedMetadata = await firstMetadata(fetcher, urls, signal);
  if (protectedMetadata.resource !== options.resource || !Array.isArray(protectedMetadata.authorization_servers) || protectedMetadata.authorization_servers.length > 16) fail("Protected resource metadata identity is invalid.");
  const issuer = protectedMetadata.authorization_servers.find(value => typeof value === "string" && options.allowedIssuers.includes(value));
  if (typeof issuer !== "string") throw new OAuthDiscoveryError("OAUTH_ISSUER_UNTRUSTED", "The provider authorization issuer is not explicitly trusted.");
  const issuerUrl = trustedUrl(issuer), path = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname;
  const metadataUrls = [`${issuerUrl.origin}/.well-known/oauth-authorization-server${path}`, `${issuerUrl.origin}/.well-known/openid-configuration${path}`, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`];
  const metadata = await firstMetadata(fetcher, [...new Set(metadataUrls)], signal);
  if (metadata.issuer !== issuer) fail("Authorization server metadata issuer does not match the trusted issuer.");
  if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256")) fail("The authorization server does not advertise S256 PKCE.");
  const authorizationEndpoint = endpoint(metadata.authorization_endpoint), tokenEndpoint = endpoint(metadata.token_endpoint);
  const methods = metadata.token_endpoint_auth_methods_supported === undefined ? ["client_secret_basic"] : stringArray(metadata.token_endpoint_auth_methods_supported);
  return {
    resource: options.resource, issuer, authorizationEndpoint, tokenEndpoint,
    ...(metadata.revocation_endpoint !== undefined ? { revocationEndpoint: endpoint(metadata.revocation_endpoint) } : {}),
    issuerRequired: metadata.authorization_response_iss_parameter_supported === true,
    requestedScopes: [...options.requestedScopes], tokenEndpointAuthMethods: methods,
    clientMetadataDocumentSupported: metadata.client_id_metadata_document_supported === true,
    ...(metadata.registration_endpoint !== undefined ? { registrationEndpoint: endpoint(metadata.registration_endpoint) } : {}),
  };
}

/** Prefer configured clients, then an actual hosted CIMD, then advertised DCR.
 * Registration is a side effect: a lost DCR response is unknown and is never retried.
 * Publication and encrypted storage of the returned client belong to the caller.
 */
export async function selectMcpOAuthClient(options: McpOAuthClientOptions, signal: AbortSignal): Promise<McpOAuthClient> {
  const fetcher = options.fetchImplementation ?? fetch, metadata = options.metadata;
  trustedUrl(options.redirectUri); validateScopes(metadata.requestedScopes);
  if (options.preRegistered) {
    boundedText(options.preRegistered.clientId, 2048);
    const method = options.preRegistered.clientSecret !== undefined ? "client_secret_post" : "none";
    if (!metadata.tokenEndpointAuthMethods.includes(method)) return manual("This provider requires a different client authentication method; configure a compatible OAuth client.");
    if (options.preRegistered.clientSecret !== undefined) boundedText(options.preRegistered.clientSecret, 8192);
    return { kind: "ready", method: "pre_registered", ...options.preRegistered, tokenEndpointAuthMethod: method };
  }
  if (metadata.clientMetadataDocumentSupported && options.clientMetadataUrl) {
    const url = trustedUrl(options.clientMetadataUrl);
    if (url.protocol !== "https:" || url.pathname === "/") fail("Client metadata requires a published HTTPS document URL with a path.");
    const document = await readMetadata(fetcher, options.clientMetadataUrl, signal);
    if (!document || document.client_id !== options.clientMetadataUrl || typeof document.client_name !== "string" || !document.client_name || !Array.isArray(document.redirect_uris) || !document.redirect_uris.includes(options.redirectUri)) fail("Client metadata document identity or redirect URI is invalid.");
    const method = document.token_endpoint_auth_method ?? "none";
    if (method !== "none" || !metadata.tokenEndpointAuthMethods.includes("none")) return manual("Hosted client metadata requires a supported public client authentication method.");
    return { kind: "ready", method: "metadata_document", clientId: options.clientMetadataUrl, tokenEndpointAuthMethod: "none" };
  }
  if (!metadata.registrationEndpoint) return manual("Register an OAuth client with the provider and enter its client ID and optional secret.");
  const method = metadata.tokenEndpointAuthMethods.includes("none") ? "none" : metadata.tokenEndpointAuthMethods.includes("client_secret_post") ? "client_secret_post" : undefined;
  if (!method) return manual("This provider requires a client authentication method the Lab does not support.");
  if (options.clientName !== undefined) boundedText(options.clientName, 160);
  const body = JSON.stringify({ client_name: options.clientName ?? "Agent Harness Lab", redirect_uris: [options.redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: method, ...(metadata.requestedScopes.length ? { scope: metadata.requestedScopes.join(" ") } : {}) });
  if (signal.aborted) fail("Client registration was cancelled before dispatch.");
  let response: Response;
  try { response = await safeFetch(fetcher, metadata.registrationEndpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body }, signal); }
  catch { throw new OAuthDiscoveryError("OAUTH_REGISTRATION_UNKNOWN", "Client registration acknowledgement was lost; inspect provider registration before trying again."); }
  if (!response.ok) { await response.body?.cancel(); return manual("The provider declined automatic registration; configure a pre-registered client."); }
  let registered: Record<string, unknown>;
  try { registered = await boundedJson(response); }
  catch { throw new OAuthDiscoveryError("OAUTH_REGISTRATION_UNKNOWN", "Client registration acknowledgement was invalid; inspect provider registration before trying again."); }
  boundedText(registered.client_id, 2048);
  if (registered.token_endpoint_auth_method !== undefined && registered.token_endpoint_auth_method !== method) fail("Registered client authentication method is incompatible.");
  if (!Array.isArray(registered.redirect_uris) || registered.redirect_uris.length !== 1 || registered.redirect_uris[0] !== options.redirectUri) fail("Registered client redirect URI does not match the requested callback.");
  if (registered.scope !== undefined) {
    if (typeof registered.scope !== "string" || registered.scope.split(/\s+/).filter(Boolean).some(scope => !metadata.requestedScopes.includes(scope))) throw new OAuthDiscoveryError("OAUTH_SCOPE_CHANGE_REQUIRED", "Registered client scope exceeds the configured grant.");
  }
  if (method === "client_secret_post") boundedText(registered.client_secret, 8192);
  return { kind: "ready", method: "dynamic_registration", clientId: registered.client_id as string, ...(method === "client_secret_post" ? { clientSecret: registered.client_secret as string } : {}), tokenEndpointAuthMethod: method };
}
function manual(reason: string): McpOAuthClient { return { kind: "manual_setup", reason }; }
function endpoint(value: unknown): string { boundedText(value, 2048); trustedUrl(value); return value; }
function trustedUrl(value: string): URL {
  let url: URL; try { url = new URL(value); } catch { return fail("OAuth endpoint URL is invalid."); }
  if (url.username || url.password || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) fail("OAuth endpoints require HTTPS, except explicit loopback development URLs, without URL credentials.");
  return url;
}
function boundedText(value: unknown, max: number): asserts value is string { if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) fail("OAuth metadata contains invalid bounded text."); }
function validateScopes(scopes: readonly string[]): void { if (scopes.length > 64 || new Set(scopes).size !== scopes.length || scopes.some(scope => !/^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/.test(scope))) fail("OAuth scopes are invalid."); }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.length > 64 || value.some(item => typeof item !== "string" || item.length > 256)) fail("OAuth metadata list is invalid."); return value as string[]; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function safeFetch(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  trustedUrl(url);
  try { return await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }); }
  catch { fail("OAuth endpoint request failed."); }
}
async function readMetadata(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const response = await safeFetch(fetcher, url, { headers: { accept: "application/json" } }, signal);
  if ([404, 405].includes(response.status)) { await response.body?.cancel(); return undefined; }
  if (!response.ok) { await response.body?.cancel(); fail("OAuth metadata endpoint is unavailable."); }
  return boundedJson(response);
}
async function firstMetadata(fetcher: typeof fetch, urls: string[], signal: AbortSignal): Promise<Record<string, unknown>> {
  for (const url of urls) { const result = await readMetadata(fetcher, url, signal); if (result) return result; }
  return fail("OAuth metadata discovery endpoints are unavailable.");
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  if (reader) try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); fail("OAuth metadata exceeds its configured limit."); } chunks.push(item.value); } } finally { reader.releaseLock(); }
  let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail("OAuth metadata is not a JSON object."); }
  if (!record(value)) fail("OAuth metadata is not a JSON object."); return value;
}
function parseBearerChallenge(header: string | null): { metadataUrl?: string; scopes: string[] } {
  if (!header) return { scopes: [] }; if (header.length > 8192) fail("OAuth challenge exceeds its configured limit.");
  const bearer = /(?:^|,)\s*Bearer\s+/i.exec(header); if (!bearer) return { scopes: [] };
  const section = header.slice(bearer.index + bearer[0].length).split(/,\s*[A-Za-z][A-Za-z0-9_-]*\s+(?![=])/)[0]!;
  const fields = new Map<string, string>();
  const pattern = /(?:^|,)\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*(?=,|$)/g;
  for (const match of section.matchAll(pattern)) { const name = match[1]!.toLowerCase(); if (fields.has(name)) fail("OAuth challenge contains duplicate parameters."); fields.set(name, match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : match[3]!); }
  const metadataUrl = fields.get("resource_metadata"), scopes = (fields.get("scope") ?? "").split(/\s+/).filter(Boolean); validateScopes(scopes);
  if (metadataUrl) trustedUrl(metadataUrl);
  return { ...(metadataUrl ? { metadataUrl } : {}), scopes };
}
