import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpOAuthProvider, type HttpOAuthProviderOptions } from "./oauth/http-provider.js";
import { MemorySecretStore, OAuthFlow, type SecretStore } from "./oauth/flow.js";

export interface ConnectionDefinition {
  readonly ref: string; readonly displayName: string; readonly provider: string; readonly owner: string;
  readonly resource: string; readonly scopes: readonly string[]; readonly enabled?: boolean;
  readonly auth: { readonly kind: "anonymous" } | { readonly kind: "static"; readonly headersEnv: Readonly<Record<string, string>> } | {
    readonly kind: "oauth"; readonly clientId: string; readonly clientSecretEnv?: string; readonly redirectUri: string;
    readonly issuer?: string; readonly authorizationEndpoint?: string; readonly tokenEndpoint?: string; readonly revocationEndpoint?: string;
    readonly discovery?: { readonly kind: "mcp"; readonly allowedIssuers: readonly string[]; readonly protectedResourceMetadataUrl?: string };
  };
}
export interface ManagedConnectionSummary {
  readonly ref: string; readonly displayName: string; readonly provider: string; readonly owner: string;
  readonly resource: string; readonly scopes: readonly string[];
  readonly status: "available" | "unavailable" | "authorization_required" | "expired" | "revoked" | "connecting";
  readonly reason: string | null; readonly authorityRevision: string; readonly expiresAt: string | null;
}
export interface ManagedConnectionBinding {
  readonly connection: { readonly ref: string; readonly authorityRevision: string; readonly resource: string; readonly scopes: readonly string[] };
  readonly resolveHeaders: (signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
}
interface Entry {
  readonly config: ConnectionDefinition; readonly fingerprint: string;
  revoked: boolean; generation: number; connecting: boolean; reason: string | null;
  sourceReason?: string | null; authorizationExpiresAt?: number; authorizationRequired?: boolean;
  flow?: OAuthFlow; issuer?: string; issuerRequired?: boolean; authorizationEndpoint?: string;
  oauthInitialization?: Promise<void>;
}
export interface ConnectionManagerOptions {
  readonly secrets?: SecretStore; readonly stateRoot?: string; readonly now?: () => number;
  readonly environment?: NodeJS.ProcessEnv; readonly fetchImplementation?: typeof fetch;
  readonly oauthUnavailableReason?: string;
}

/** Trusted local administration, stable authority identity and late credential resolution.
 * Endpoint liveness is checked by source discovery, not invented by this manager.
 */
export class ConnectionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly secrets: SecretStore;
  private readonly fetchImplementation: typeof fetch;
  private readonly mutations = new Map<string, Promise<unknown>>();
  private constructor(private readonly options: ConnectionManagerOptions) {
    this.secrets = options.secrets ?? new MemorySecretStore(); this.fetchImplementation = options.fetchImplementation ?? fetch;
  }
  static async create(configs: readonly ConnectionDefinition[], options: ConnectionManagerOptions = {}): Promise<ConnectionManager> {
    const manager = new ConnectionManager(options);
    if (!Array.isArray(configs) || configs.length > 64) throw new Error("Connections require a bounded trusted configuration array.");
    for (const config of configs) {
      validateDefinition(config);
      if (manager.entries.has(config.ref)) throw new Error("Connection reference is duplicated.");
      const fingerprint = digest(config);
      const entry: Entry = { config, fingerprint, revoked: false, generation: 0, connecting: false, reason: null };
      if (options.stateRoot) try {
        const bytes = await readFile(join(options.stateRoot, `${config.ref}.json`));
        if (bytes.length > 4096) throw new Error("Connection lifecycle record exceeds its limit.");
        const saved: unknown = JSON.parse(bytes.toString());
        if (!record(saved) || typeof saved.revoked !== "boolean" || !Number.isSafeInteger(saved.generation) || Number(saved.generation) < 0 || typeof saved.fingerprint !== "string") throw new Error("Connection lifecycle record is invalid.");
        entry.generation = Number(saved.generation) + (saved.fingerprint === fingerprint ? 0 : 1); entry.revoked = saved.fingerprint === fingerprint && saved.revoked;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      manager.entries.set(config.ref, entry);
      // Persist configuration transitions immediately so A → B → A cannot reuse an old authority revision.
      await manager.persist(entry);
    }
    return manager;
  }
  async summaries(): Promise<ManagedConnectionSummary[]> { return Promise.all([...this.entries.keys()].map(ref => this.summary(ref))); }
  async summary(ref: string): Promise<ManagedConnectionSummary> {
    const entry = this.entry(ref), config = entry.config;
    let status: ManagedConnectionSummary["status"] = "available", reason: string | null = entry.reason, expiresAt: string | null = null;
    if (config.enabled === false) { status = "unavailable"; reason = "Connection is disabled by trusted configuration."; }
    else if (entry.revoked) { status = "revoked"; reason = entry.reason ?? "Connection access was revoked."; }
    else if (config.auth.kind === "oauth" && this.options.oauthUnavailableReason) { status = "unavailable"; reason = this.options.oauthUnavailableReason; }
    else if (entry.authorizationRequired) { status = "authorization_required"; }
    else if (entry.connecting && (entry.authorizationExpiresAt ?? 0) > this.now()) status = "connecting";
    else if (config.auth.kind === "static") { try { this.staticHeaders(config.auth.headersEnv); } catch { status = "unavailable"; reason = "Configured service credentials are unavailable."; } }
    else if (config.auth.kind === "oauth") {
      let tokens;
      try { tokens = await this.secrets.read(ref); }
      catch { return { ref, displayName: config.displayName, provider: config.provider, owner: config.owner, resource: config.resource, scopes: config.scopes, status: "unavailable", reason: "Stored account credentials could not be read. Check the deployment secret store.", expiresAt: null, authorityRevision: this.revision(entry) }; }
      if (!tokens) { status = "authorization_required"; reason = entry.reason ?? "Connect this account to authorize its tools."; }
      else {
        expiresAt = tokens.expiresAt;
        if (!config.scopes.every(scope => tokens.scopes.includes(scope))) { status = "authorization_required"; reason = "The account grant does not include the required scopes."; }
        else if (Date.parse(tokens.expiresAt) <= this.now()) { status = "expired"; reason = tokens.refreshToken ? "Access token expired; refresh is available." : "Access token expired; reconnect this account."; }
      }
    }
    if (status === "available" && entry.sourceReason) { status = "unavailable"; reason = entry.sourceReason; }
    return { ref, displayName: config.displayName, provider: config.provider, owner: config.owner, resource: config.resource, scopes: config.scopes,
      status, reason, expiresAt, authorityRevision: this.revision(entry) };
  }
  async binding(ref: string): Promise<ManagedConnectionBinding> {
    const entry = this.entry(ref), authorityRevision = this.revision(entry);
    return { connection: { ref, authorityRevision, resource: entry.config.resource, scopes: entry.config.scopes }, resolveHeaders: async signal => {
      if (signal.aborted) throw signal.reason ?? new Error("Credential resolution cancelled.");
      if (entry.config.enabled === false || entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Admitted connection authority is unavailable or changed. Readmit the run.");
      if (entry.config.auth.kind === "oauth" && this.options.oauthUnavailableReason) throw new Error(this.options.oauthUnavailableReason);
      if (entry.authorizationRequired) throw new Error(entry.reason ?? "Connection requires a different configured authorization grant.");
      if (entry.config.auth.kind === "anonymous") return {};
      if (entry.config.auth.kind === "static") return this.staticHeaders(entry.config.auth.headersEnv);
      await this.ensureOAuth(entry, signal);
      const accessToken = await entry.flow!.accessToken(ref, signal);
      const tokens = await this.secrets.read(ref);
      if (!tokens || !entry.config.scopes.every(scope => tokens.scopes.includes(scope))) throw new Error("Connection no longer grants the required scopes.");
      if (entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Connection authority changed before dispatch.");
      return { authorization: `Bearer ${accessToken}` };
    } };
  }
  connect(ref: string, signal = AbortSignal.timeout(30_000)): Promise<{ connection: ManagedConnectionSummary; authorizationUrl?: string }> { return this.serialize(ref, () => this.connectOwned(ref, signal)); }
  private async connectOwned(ref: string, signal: AbortSignal): Promise<{ connection: ManagedConnectionSummary; authorizationUrl?: string }> {
    const entry = this.entry(ref); if (entry.config.enabled === false) throw new Error("Connection is disabled by trusted configuration.");
    if (entry.config.auth.kind === "oauth" && this.options.oauthUnavailableReason) throw new Error(this.options.oauthUnavailableReason);
    entry.sourceReason = null; entry.reason = null; entry.authorizationRequired = false;
    if (entry.revoked) { entry.revoked = false; entry.generation++; await this.persist(entry); }
    if (entry.config.auth.kind !== "oauth") { await (await this.binding(ref)).resolveHeaders(signal); return { connection: await this.summary(ref) }; }
    await this.ensureOAuth(entry, signal);
    const authorization = entry.flow!.begin(ref, entry.authorizationEndpoint!, entry.config.auth.redirectUri, entry.config.scopes,
      { clientId: entry.config.auth.clientId, resource: entry.config.resource, issuer: entry.issuer, issuerRequired: entry.issuerRequired });
    entry.connecting = true; entry.authorizationExpiresAt = this.now() + 600_000; entry.reason = null;
    return { connection: await this.summary(ref), authorizationUrl: authorization.authorizationUrl };
  }
  complete(ref: string, state: string, code: string, issuer?: string, signal = AbortSignal.timeout(30_000)): Promise<ManagedConnectionSummary> { return this.serialize(ref, () => this.completeOwned(ref, state, code, issuer, signal)); }
  private async completeOwned(ref: string, state: string, code: string, issuer: string | undefined, signal: AbortSignal): Promise<ManagedConnectionSummary> {
    const entry = this.entry(ref);
    if (entry.config.auth.kind !== "oauth" || !entry.flow || !entry.connecting) throw new Error("Connection has no pending OAuth authorization.");
    try { await entry.flow.complete(ref, state, code, signal, issuer); entry.reason = null; }
    finally { entry.connecting = false; }
    return this.summary(ref);
  }
  refresh(ref: string, signal = AbortSignal.timeout(30_000)): Promise<ManagedConnectionSummary> { return this.serialize(ref, () => this.refreshOwned(ref, signal)); }
  private async refreshOwned(ref: string, signal: AbortSignal): Promise<ManagedConnectionSummary> {
    const entry = this.entry(ref); if (entry.revoked) throw new Error("Reconnect a revoked connection before refreshing it.");
    entry.sourceReason = null;
    await (await this.binding(ref)).resolveHeaders(signal);
    entry.reason = null; return this.summary(ref);
  }
  revoke(ref: string, signal = AbortSignal.timeout(30_000)): Promise<ManagedConnectionSummary> {
    this.entry(ref).revoked = true; // Immediately close dispatch permission while lifecycle I/O settles.
    return this.serialize(ref, () => this.revokeOwned(ref, signal));
  }
  private async revokeOwned(ref: string, signal: AbortSignal): Promise<ManagedConnectionSummary> {
    const entry = this.entry(ref); entry.revoked = true; entry.connecting = false; entry.generation++; await this.persist(entry);
    if (entry.config.auth.kind === "oauth") {
      try { await this.ensureOAuth(entry, signal); await entry.flow!.revoke(ref, signal); }
      catch { entry.reason = "Local access revoked; remote token revocation could not be confirmed."; }
      finally {
        // Metadata failure must never retain a locally usable grant after revocation.
        await this.secrets.delete(ref);
      }
    }
    return this.summary(ref);
  }
  /** Catalog discovery owns endpoint liveness; credential presence is not health. */
  reportSourceAvailability(ref: string, reason: string | null): void { this.entry(ref).sourceReason = reason?.slice(0, 512) ?? null; }
  private async ensureOAuth(entry: Entry, signal: AbortSignal): Promise<void> {
    if (entry.flow) return;
    if (entry.oauthInitialization) return entry.oauthInitialization;
    const initialization = this.initializeOAuth(entry, signal); entry.oauthInitialization = initialization;
    try { await initialization; } finally { if (entry.oauthInitialization === initialization) entry.oauthInitialization = undefined; }
  }
  private async initializeOAuth(entry: Entry, signal: AbortSignal): Promise<void> {
    const auth = entry.config.auth; if (auth.kind !== "oauth") throw new Error("Connection is not OAuth configured.");
    let endpoints: Partial<HttpOAuthProviderOptions> = { authorizationEndpoint: auth.authorizationEndpoint, tokenEndpoint: auth.tokenEndpoint, revocationEndpoint: auth.revocationEndpoint };
    let issuer = auth.issuer, issuerRequired = false;
    if (auth.discovery) {
      const resource = new URL(entry.config.resource);
      const challenge = await this.resourceChallenge(entry.config.resource, signal);
      if (challenge.scopes.some(scope => !entry.config.scopes.includes(scope))) {
        entry.authorizationRequired = true; entry.reason = "Provider requested scopes beyond the configured grant. Update trusted connection configuration before authorizing.";
        throw new Error(entry.reason);
      }
      const metadataUrl = challenge.metadataUrl ?? auth.discovery.protectedResourceMetadataUrl ?? `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`;
      if (resource.protocol === "https:" && trustedUrl(metadataUrl).protocol !== "https:") throw new Error("Protected resource metadata cannot downgrade HTTPS.");
      const protectedMetadata = await this.metadata(metadataUrl, signal);
      if (protectedMetadata.resource !== entry.config.resource || !Array.isArray(protectedMetadata.authorization_servers)) throw new Error("MCP protected resource metadata identity is invalid.");
      issuer = protectedMetadata.authorization_servers.find(value => typeof value === "string" && auth.discovery!.allowedIssuers.includes(value));
      if (!issuer) throw new Error("MCP authorization server is not allowlisted.");
      const issuerUrl = new URL(issuer), metadataPaths = [`${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname}`, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`];
      let serverMetadata: Record<string, unknown> | undefined;
      for (const url of metadataPaths) { try { serverMetadata = await this.metadata(url, signal); break; } catch { if (signal.aborted) throw signal.reason; } }
      if (!serverMetadata || serverMetadata.issuer !== issuer || typeof serverMetadata.authorization_endpoint !== "string" || typeof serverMetadata.token_endpoint !== "string") throw new Error("Authorization server metadata is unavailable or inconsistent.");
      if (!Array.isArray(serverMetadata.code_challenge_methods_supported) || !serverMetadata.code_challenge_methods_supported.includes("S256")) throw new Error("Authorization server does not advertise S256 PKCE.");
      const supportedMethods = serverMetadata.token_endpoint_auth_methods_supported;
      const configuredMethod = auth.clientSecretEnv ? "client_secret_post" : "none";
      if (Array.isArray(supportedMethods) && !supportedMethods.includes(configuredMethod)) throw new Error("OAuth token authentication method is unsupported; configured clients support none or client_secret_post.");
      endpoints = { authorizationEndpoint: serverMetadata.authorization_endpoint, tokenEndpoint: serverMetadata.token_endpoint, ...(typeof serverMetadata.revocation_endpoint === "string" ? { revocationEndpoint: serverMetadata.revocation_endpoint } : {}) };
      issuerRequired = serverMetadata.authorization_response_iss_parameter_supported === true;
    }
    if (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint) throw new Error("OAuth requires configured endpoints or supported MCP metadata discovery. Dynamic client registration is not implemented.");
    trustedUrl(endpoints.authorizationEndpoint); trustedUrl(endpoints.tokenEndpoint);
    if (endpoints.revocationEndpoint) trustedUrl(endpoints.revocationEndpoint);
    const clientSecret = auth.clientSecretEnv ? this.environment()[auth.clientSecretEnv] : undefined;
    if (auth.clientSecretEnv && !clientSecret) throw new Error("Configured OAuth client credential is unavailable.");
    const provider = new HttpOAuthProvider({ authorizationEndpoint: endpoints.authorizationEndpoint, tokenEndpoint: endpoints.tokenEndpoint, revocationEndpoint: endpoints.revocationEndpoint,
      clientId: auth.clientId, ...(auth.clientSecretEnv ? { resolveClientSecret: () => { const value = this.environment()[auth.clientSecretEnv!]; if (!value) throw new Error("Configured OAuth client credential is unavailable."); return value; } } : {}), resource: entry.config.resource, fetchImplementation: this.fetchImplementation });
    entry.flow = new OAuthFlow(provider, this.secrets, { now: () => this.now() }); entry.authorizationEndpoint = endpoints.authorizationEndpoint; entry.issuer = issuer; entry.issuerRequired = issuerRequired;
  }
  /** A single unauthenticated probe discovers the provider's advertised metadata, never requests additional permissions. */
  private async resourceChallenge(resource: string, signal: AbortSignal): Promise<{ metadataUrl?: string; scopes: string[] }> {
    const response = await this.fetchImplementation(resource, { method: "GET", signal, headers: { accept: "application/json, text/event-stream" }, redirect: "error" });
    const header = response.status === 401 ? response.headers.get("www-authenticate") : null;
    await response.body?.cancel();
    if (!header) return { scopes: [] };
    if (header.length > 8192) throw new Error("OAuth authentication challenge exceeds its configured limit.");
    const bearer = /(?:^|,)\s*Bearer\s+/i.exec(header);
    if (!bearer) return { scopes: [] };
    const parameters = header.slice(bearer.index + bearer[0].length).split(/,\s*[A-Za-z][A-Za-z0-9_-]*\s+(?![=])/)[0]!;
    const values = new Map<string, string>();
    const pattern = /(?:^|,)\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*(?=,|$)/g;
    for (const match of parameters.matchAll(pattern)) {
      const name = match[1]!.toLowerCase();
      if (values.has(name)) throw new Error("OAuth authentication challenge has duplicate parameters.");
      values.set(name, match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : match[3]!);
    }
    const metadataUrl = values.get("resource_metadata");
    if (metadataUrl) trustedUrl(metadataUrl);
    return { ...(metadataUrl ? { metadataUrl } : {}), scopes: (values.get("scope") ?? "").split(/\s+/).filter(Boolean) };
  }
  private async metadata(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    trustedUrl(url); const response = await this.fetchImplementation(url, { signal, headers: { accept: "application/json" }, redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new Error("OAuth metadata endpoint is unavailable."); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 65536) { await reader.cancel(); throw new Error("OAuth metadata exceeds its configured limit."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!record(value)) throw new Error("OAuth metadata is invalid."); return value;
  }
  private entry(ref: string): Entry { const entry = this.entries.get(ref); if (!entry) throw new Error("Connection reference is not configured."); return entry; }
  private serialize<T>(ref: string, operation: () => Promise<T>): Promise<T> {
    const pending = this.mutations.get(ref) ?? Promise.resolve();
    const next = pending.catch(() => undefined).then(operation); this.mutations.set(ref, next);
    void next.finally(() => { if (this.mutations.get(ref) === next) this.mutations.delete(ref); }).catch(() => undefined);
    return next;
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private environment() { return this.options.environment ?? process.env; }
  private revision(entry: Entry) { return digest({ fingerprint: entry.fingerprint, generation: entry.generation }); }
  private staticHeaders(mapping: Readonly<Record<string, string>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [header, variable] of Object.entries(mapping)) { const value = this.environment()[variable]; if (!value || /[\r\n]/.test(value)) throw new Error("Configured connection credential is unavailable."); result[header] = value; }
    return result;
  }
  private async persist(entry: Entry): Promise<void> {
    if (!this.options.stateRoot) return;
    await mkdir(this.options.stateRoot, { recursive: true, mode: 0o700 }); const path = join(this.options.stateRoot, `${entry.config.ref}.json`), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ fingerprint: entry.fingerprint, revoked: entry.revoked, generation: entry.generation }), { mode: 0o600 }); await rename(temporary, path);
  }
}
function validateDefinition(config: ConnectionDefinition): void {
  if (!config || !/^conn_[a-z0-9][a-z0-9_-]{0,57}$/.test(config.ref) || !config.displayName?.trim() || !config.provider?.trim() || !config.owner?.trim() || !Array.isArray(config.scopes) || config.scopes.length > 128 || config.scopes.some(scope => typeof scope !== "string" || !scope || scope.length > 256)) throw new Error("Connection requires a safe reference, owner, resource and scopes.");
  trustedUrl(config.resource);
  if (!config.auth || !["anonymous", "static", "oauth"].includes(config.auth.kind)) throw new Error("Connection authentication mode is invalid.");
  if (config.auth.kind === "static") {
    if (!record(config.auth.headersEnv) || Object.entries(config.auth.headersEnv).some(([header, variable]) => !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) || typeof variable !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(variable))) throw new Error("Static credentials require header-to-environment references.");
  }
  if (config.auth.kind === "oauth") {
    if (!config.auth.clientId?.trim()) throw new Error("OAuth requires a pre-registered client ID; dynamic registration is unsupported.");
    trustedUrl(config.auth.redirectUri); for (const endpoint of [config.auth.issuer, config.auth.authorizationEndpoint, config.auth.tokenEndpoint, config.auth.revocationEndpoint]) if (endpoint) trustedUrl(endpoint);
    if (config.auth.discovery && (config.auth.discovery.kind !== "mcp" || !Array.isArray(config.auth.discovery.allowedIssuers) || !config.auth.discovery.allowedIssuers.length)) throw new Error("MCP OAuth discovery requires allowlisted authorization issuers.");
  }
}
function trustedUrl(value: string): URL { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Connection URL requires HTTP(S) without embedded credentials or fragments."); if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Remote connection endpoints require HTTPS."); return url; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
