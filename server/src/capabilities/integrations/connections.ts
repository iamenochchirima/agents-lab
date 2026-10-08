import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpOAuthProvider, type HttpOAuthProviderOptions } from "./oauth/http-provider.js";
import { MemorySecretStore, OAuthFlow, type SecretStore } from "./oauth/flow.js";
import { discoverMcpOAuth, OAuthDiscoveryError } from "../management/oauth-discovery.js";

export interface ConnectionDefinition {
  readonly ref: string; readonly displayName: string; readonly provider: string; readonly owner: string;
  readonly resource: string; readonly scopes: readonly string[]; readonly enabled?: boolean;
  readonly auth: { readonly kind: "anonymous" } | { readonly kind: "static"; readonly headersEnv: Readonly<Record<string, string>> } | { readonly kind: "stored"; readonly credentialRef: string } | {
    readonly kind: "oauth"; readonly clientId: string; readonly clientSecretEnv?: string; readonly clientSecretRef?: string; readonly redirectUri: string;
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
  config: ConnectionDefinition; fingerprint: string;
  revoked: boolean; generation: number; connecting: boolean; reason: string | null;
  sourceReason?: string | null; authorizationExpiresAt?: number; authorizationRequired?: boolean;
  flow?: OAuthFlow; issuer?: string; issuerRequired?: boolean; authorizationEndpoint?: string;
  oauthInitialization?: Promise<void>;
  credentialOperations?: Set<Promise<unknown>>;
}
export interface ConnectionManagerOptions {
  readonly secrets?: SecretStore; readonly stateRoot?: string; readonly now?: () => number;
  readonly environment?: NodeJS.ProcessEnv; readonly fetchImplementation?: typeof fetch;
  readonly oauthUnavailableReason?: string;
  readonly resolveStoredHeaders?: (config: ConnectionDefinition, signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
  readonly resolveClientSecret?: (config: ConnectionDefinition, signal: AbortSignal) => Promise<string>;
}

/** Trusted local administration, stable authority identity and late credential resolution.
 * Endpoint liveness is checked by source discovery, not invented by this manager.
 */
export class ConnectionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly secrets: SecretStore;
  private readonly fetchImplementation: typeof fetch;
  private readonly mutations = new Map<string, Promise<unknown>>();
  private definitionsMutation: Promise<void> = Promise.resolve();
  private constructor(private readonly options: ConnectionManagerOptions) {
    this.secrets = options.secrets ?? new MemorySecretStore(); this.fetchImplementation = options.fetchImplementation ?? fetch;
  }
  static async create(configs: readonly ConnectionDefinition[], options: ConnectionManagerOptions = {}): Promise<ConnectionManager> {
    const manager = new ConnectionManager(options);
    await manager.applyDefinitions(configs);
    return manager;
  }
  /** Publish trusted definitions on the same manager so previously admitted bindings
   * retain their entry identity and observe revocation/configuration changes.
   * Validate the complete update before closing authority. Failed persistence leaves
   * changed entries revoked rather than dispatching partially published authority.
   */
  applyDefinitions(configs: readonly ConnectionDefinition[]): Promise<void> {
    if (!Array.isArray(configs) || configs.length > 64) return Promise.reject(new Error("Connections require a bounded trusted configuration array."));
    const refs = new Set<string>();
    try { for (const config of configs) { validateDefinition(config); if (refs.has(config.ref)) throw new Error("Connection reference is duplicated."); refs.add(config.ref); } }
    catch (error) { return Promise.reject(error); }
    const definitions: ConnectionDefinition[] = JSON.parse(JSON.stringify(configs));
    const next = this.definitionsMutation.catch(() => undefined).then(async () => {
      const changed = [...this.entries.values()].filter(entry => !definitions.some(config => config.ref === entry.config.ref && digest(config) === entry.fingerprint));
      // Close all retained bindings before any I/O or lifecycle operation can await.
      for (const entry of changed) { entry.revoked = true; entry.generation++; }
      for (const entry of changed) await this.serialize(entry.config.ref, async () => {
        await Promise.allSettled([...(entry.credentialOperations ?? [])]);
        await this.persist(entry);
        if (entry.config.auth.kind === "oauth") await this.secrets.delete(entry.config.ref);
        entry.connecting = false; entry.authorizationRequired = false; entry.authorizationExpiresAt = undefined;
        entry.flow = undefined; entry.oauthInitialization = undefined; entry.issuer = undefined; entry.issuerRequired = undefined; entry.authorizationEndpoint = undefined;
        const config = definitions.find(config => config.ref === entry.config.ref);
        if (!config) { this.entries.delete(entry.config.ref); return; }
        entry.config = config; entry.fingerprint = digest(config); entry.reason = null; entry.sourceReason = null;
        // Persist the replacement while closed; only then reopen the new authority.
        await this.persist(entry); entry.revoked = false;
        try { await this.persist(entry); } catch (error) { entry.revoked = true; throw error; }
      });
      for (const config of definitions) if (!this.entries.has(config.ref)) {
        const entry: Entry = { config, fingerprint: digest(config), revoked: false, generation: 0, connecting: false, reason: null };
        if (this.options.stateRoot) try {
          const bytes = await readFile(join(this.options.stateRoot, `${config.ref}.json`));
          if (bytes.length > 4096) throw new Error("Connection lifecycle record exceeds its limit.");
          const saved: unknown = JSON.parse(bytes.toString());
          if (!record(saved) || typeof saved.revoked !== "boolean" || !Number.isSafeInteger(saved.generation) || Number(saved.generation) < 0 || typeof saved.fingerprint !== "string") throw new Error("Connection lifecycle record is invalid.");
          entry.generation = Number(saved.generation) + (saved.fingerprint === entry.fingerprint ? 0 : 1); entry.revoked = saved.fingerprint === entry.fingerprint && saved.revoked;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await this.persist(entry); this.entries.set(config.ref, entry);
      }
    });
    this.definitionsMutation = next;
    return next;
  }
  /** Credential replacement under the same opaque reference changes admitted authority. */
  invalidate(ref: string): Promise<void> {
    const entry = this.entry(ref); entry.generation++; entry.flow = undefined; entry.oauthInitialization = undefined;
    return this.serialize(ref, () => this.persist(entry));
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
    else if (config.auth.kind === "stored") { try { await this.storedHeaders(config, AbortSignal.timeout(5_000)); } catch { status = "unavailable"; reason = "Stored service credentials are unavailable."; } }
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
      if (entry.config.auth.kind === "stored") {
        const headers = await this.storedHeaders(entry.config, signal);
        if (signal.aborted || entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Connection authority changed before dispatch.");
        return headers;
      }
      return this.withCredentialOperation(entry, async () => {
        if (entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Connection authority changed before credential resolution.");
        await this.ensureOAuth(entry, signal);
        const accessToken = await entry.flow!.accessToken(ref, signal);
        const tokens = await this.secrets.read(ref);
        if (!tokens || !entry.config.scopes.every(scope => tokens.scopes.includes(scope))) throw new Error("Connection no longer grants the required scopes.");
        if (signal.aborted || entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Connection authority changed before dispatch.");
        return { authorization: `Bearer ${accessToken}` };
      });
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
    const entry = this.entry(ref); entry.revoked = true; entry.connecting = false; entry.generation++;
    // A previously dispatched token refresh must settle before deletion; otherwise
    // its late response could restore a locally usable revoked grant.
    await Promise.allSettled([...(entry.credentialOperations ?? [])]);
    await this.persist(entry);
    if (entry.config.auth.kind === "oauth") {
      try {
        // Revocation has already closed the live entry. A cleanup-only provider uses
        // its pinned configuration without reopening any admitted dispatch binding.
        const cleanup: Entry = { ...entry, revoked: false, flow: undefined, oauthInitialization: undefined, credentialOperations: undefined };
        await this.ensureOAuth(cleanup, signal); await cleanup.flow!.revoke(ref, signal);
      }
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
    const authorityRevision = this.revision(entry), config = entry.config;
    if (auth.discovery) {
      try {
        const metadata = await discoverMcpOAuth({ resource: config.resource, allowedIssuers: auth.discovery.allowedIssuers, requestedScopes: config.scopes, protectedResourceMetadataUrl: auth.discovery.protectedResourceMetadataUrl, fetchImplementation: this.fetchImplementation }, signal);
        const configuredMethod = auth.clientSecretEnv || auth.clientSecretRef ? "client_secret_post" : "none";
        if (!metadata.tokenEndpointAuthMethods.includes(configuredMethod)) throw new Error("OAuth token authentication method is unsupported; configured clients support none or client_secret_post.");
        endpoints = { authorizationEndpoint: metadata.authorizationEndpoint, tokenEndpoint: metadata.tokenEndpoint, revocationEndpoint: metadata.revocationEndpoint };
        issuer = metadata.issuer; issuerRequired = metadata.issuerRequired;
      } catch (error) {
        if (error instanceof OAuthDiscoveryError && error.code === "OAUTH_SCOPE_CHANGE_REQUIRED" && this.revision(entry) === authorityRevision) {
          entry.authorizationRequired = true; entry.reason = "Provider requested scopes beyond the configured grant. Update trusted connection configuration before authorizing.";
          throw new Error(entry.reason);
        }
        throw error;
      }
    }
    if (!endpoints.authorizationEndpoint || !endpoints.tokenEndpoint) throw new Error("OAuth requires configured endpoints or supported MCP metadata discovery. Prepare an OAuth client before connecting.");
    trustedUrl(endpoints.authorizationEndpoint); trustedUrl(endpoints.tokenEndpoint);
    if (endpoints.revocationEndpoint) trustedUrl(endpoints.revocationEndpoint);
    const resolveClientSecret = auth.clientSecretEnv || auth.clientSecretRef ? async (requestSignal?: AbortSignal) => {
      const credentialSignal = requestSignal ?? AbortSignal.timeout(30_000);
      let value: string | undefined;
      try { value = auth.clientSecretRef ? await this.options.resolveClientSecret?.(config, credentialSignal) : this.environment()[auth.clientSecretEnv!]; }
      catch { throw new Error("Configured OAuth client credential is unavailable."); }
      if (!value || credentialSignal.aborted || entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Configured OAuth client credential is unavailable or authority changed.");
      return value;
    } : undefined;
    if (resolveClientSecret) await resolveClientSecret(signal);
    if (entry.revoked || this.revision(entry) !== authorityRevision) throw new Error("Connection authority changed during OAuth discovery.");
    const provider = new HttpOAuthProvider({ authorizationEndpoint: endpoints.authorizationEndpoint, tokenEndpoint: endpoints.tokenEndpoint, revocationEndpoint: endpoints.revocationEndpoint,
      clientId: auth.clientId, ...(resolveClientSecret ? { resolveClientSecret } : {}), resource: config.resource, fetchImplementation: this.fetchImplementation });
    entry.flow = new OAuthFlow(provider, this.secrets, { now: () => this.now() }); entry.authorizationEndpoint = endpoints.authorizationEndpoint; entry.issuer = issuer; entry.issuerRequired = issuerRequired;
  }
  private withCredentialOperation<T>(entry: Entry, operation: () => Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(operation);
    entry.credentialOperations ??= new Set(); entry.credentialOperations.add(pending);
    void pending.finally(() => entry.credentialOperations?.delete(pending)).catch(() => undefined);
    return pending;
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
  private async storedHeaders(config: ConnectionDefinition, signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
    if (!this.options.resolveStoredHeaders) throw new Error("Stored service credential resolver is unavailable.");
    let headers: Readonly<Record<string, string>>;
    try { headers = await this.options.resolveStoredHeaders(config, signal); }
    catch { throw new Error("Stored service credentials are unavailable."); }
    if (signal.aborted || !record(headers) || Object.entries(headers).length < 1 || Object.entries(headers).length > 32 || Object.entries(headers).some(([name, value]) => !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || typeof value !== "string" || !value || /[\r\n]/.test(value))) throw new Error("Stored service credentials are invalid or unavailable.");
    return { ...headers };
  }
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
  if (!config.auth || !["anonymous", "static", "stored", "oauth"].includes(config.auth.kind)) throw new Error("Connection authentication mode is invalid.");
  if (config.auth.kind === "static") {
    if (!record(config.auth.headersEnv) || Object.entries(config.auth.headersEnv).some(([header, variable]) => !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) || typeof variable !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(variable))) throw new Error("Static credentials require header-to-environment references.");
  }
  if (config.auth.kind === "stored" && !/^[a-z][a-z0-9_-]{0,63}$/.test(config.auth.credentialRef)) throw new Error("Stored credentials require a safe opaque reference.");
  if (config.auth.kind === "oauth") {
    if (config.auth.clientSecretEnv && config.auth.clientSecretRef) throw new Error("OAuth client secret references are ambiguous.");
    if (config.auth.clientSecretRef && !/^[a-z][a-z0-9_-]{0,63}$/.test(config.auth.clientSecretRef)) throw new Error("OAuth client secret reference is invalid.");
    if (config.auth.clientSecretEnv && !/^[A-Z][A-Z0-9_]{0,127}$/.test(config.auth.clientSecretEnv)) throw new Error("OAuth client secret environment reference is invalid.");
    if (!config.auth.clientId?.trim()) throw new Error("OAuth requires a prepared client ID.");
    trustedUrl(config.auth.redirectUri); for (const endpoint of [config.auth.issuer, config.auth.authorizationEndpoint, config.auth.tokenEndpoint, config.auth.revocationEndpoint]) if (endpoint) trustedUrl(endpoint);
    if (config.auth.discovery && (config.auth.discovery.kind !== "mcp" || !Array.isArray(config.auth.discovery.allowedIssuers) || !config.auth.discovery.allowedIssuers.length)) throw new Error("MCP OAuth discovery requires allowlisted authorization issuers.");
  }
}
function trustedUrl(value: string): URL { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Connection URL requires HTTP(S) without embedded credentials or fragments."); if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Remote connection endpoints require HTTPS."); return url; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
