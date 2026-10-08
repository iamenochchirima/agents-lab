import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface OAuthAuthorizationRequest {
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly authorizationUrl: string;
}

export interface OAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  /** Internal parsing hint; omitted scope responses retain the granted scopes. */
  readonly scopesProvided?: boolean;
}

export interface OAuthProvider {
  authorize(request: OAuthAuthorizationRequest, signal?: AbortSignal): Promise<{ readonly code: string; readonly state: string }>;
  exchange(code: string, verifier: string, redirectUri: string, signal?: AbortSignal): Promise<OAuthTokenSet>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<OAuthTokenSet>;
  revoke(token: string, signal?: AbortSignal): Promise<void>;
}

export interface SecretStore {
  read(ref: string): Promise<OAuthTokenSet | null>;
  write(ref: string, tokens: OAuthTokenSet): Promise<void>;
  delete(ref: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, OAuthTokenSet>();
  async read(ref: string): Promise<OAuthTokenSet | null> { return this.values.get(ref) ?? null; }
  async write(ref: string, tokens: OAuthTokenSet): Promise<void> { this.values.set(ref, tokens); }
  async delete(ref: string): Promise<void> { this.values.delete(ref); }
}

export class OAuthFlow {
  private readonly pending = new Map<string, { readonly ref: string; readonly generation: number; readonly verifier: string; readonly redirectUri: string; readonly scopes: readonly string[]; readonly expiresAt: number; readonly issuer?: string; readonly issuerRequired?: boolean }>();
  private readonly refreshes = new Map<string, RefreshEntry>();

  private readonly revoked = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly secretMutations = new Map<string, Promise<unknown>>();
  constructor(private readonly provider: OAuthProvider, private readonly secrets: SecretStore, private readonly options: { readonly now?: () => number; readonly stateTtlMs?: number } = {}) {}

  begin(ref: string, authorizationEndpoint: string, redirectUri: string, scopes: readonly string[], binding: { readonly clientId?: string; readonly resource?: string; readonly issuer?: string; readonly issuerRequired?: boolean } = {}): OAuthAuthorizationRequest {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(ref)) throw new Error("OAuth connection reference is unsafe.");
    if (!isExactHttpUrl(redirectUri)) throw new Error("OAuth redirect URI must be an exact HTTP(S) URL.");
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(verifier).digest());
    const now = this.options.now?.() ?? Date.now();
    for (const [key, value] of this.pending) if (value.expiresAt <= now || value.ref === ref) this.pending.delete(key);
    if (this.pending.size >= 128) throw new Error("Too many pending OAuth authorizations.");
    this.revoked.delete(ref);
    const generation = (this.generations.get(ref) ?? 0) + 1; this.generations.set(ref, generation);
    this.pending.set(state, { ref, generation, verifier, redirectUri, scopes: [...scopes], expiresAt: now + (this.options.stateTtlMs ?? 600_000), ...(binding.issuer ? { issuer: binding.issuer, issuerRequired: binding.issuerRequired } : {}) });
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    if (binding.clientId) url.searchParams.set("client_id", binding.clientId);
    if (binding.resource) url.searchParams.set("resource", binding.resource);
    return { state, codeChallenge, codeChallengeMethod: "S256", redirectUri, scopes: [...scopes], authorizationUrl: url.toString() };
  }

  async complete(ref: string, state: string, code: string, signal?: AbortSignal, issuer?: string): Promise<OAuthTokenSet> {
    throwIfAborted(signal);
    const pending = this.pending.get(state);
    if (!pending || pending.expiresAt <= (this.options.now?.() ?? Date.now())) { this.pending.delete(state); throw new Error("OAuth state is missing, expired, or already used."); }
    if (pending.ref !== ref) throw new Error("OAuth state belongs to another connection.");
    this.pending.delete(state);
    if ((pending.issuerRequired && issuer === undefined) || (issuer !== undefined && issuer !== pending.issuer)) throw new Error("OAuth callback issuer does not match the admitted authorization server.");
    if (!code || code.length > 8192) throw new Error("OAuth authorization code is invalid.");
    const received = await this.provider.exchange(code, pending.verifier, pending.redirectUri, signal);
    const tokens = { ...received, scopes: received.scopesProvided === false ? pending.scopes : received.scopes };
    if (tokens.scopes.some(scope => !pending.scopes.includes(scope))) throw new Error("OAuth provider returned scopes outside the requested grant.");
    throwIfAborted(signal);
    await this.persistActive(ref, pending.generation, tokens);
    return tokens;
  }

  async accessToken(ref: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const current = await this.secrets.read(ref);
    if (!current) throw new Error("OAuth connection is not configured.");
    if (this.revoked.has(ref)) throw new Error("OAuth connection was revoked.");
    if (Date.parse(current.expiresAt) > (this.options.now?.() ?? Date.now()) + 30_000) return current.accessToken;
    if (!current.refreshToken) throw new Error("OAuth access token expired and no refresh token is available.");
    let entry = this.refreshes.get(ref);
    if (!entry) {
      const controller = new AbortController();
      const generation = this.generations.get(ref) ?? 0;
      let created: RefreshEntry | undefined;
      const refresh = this.provider.refresh(current.refreshToken, controller.signal).then(async (received) => {
        const tokens = { ...received, refreshToken: received.refreshToken ?? current.refreshToken, scopes: received.scopesProvided === false ? current.scopes : received.scopes };
        if (tokens.scopes.some(scope => !current.scopes.includes(scope))) throw new Error("OAuth refresh attempted to expand the granted scopes.");
        if (controller.signal.aborted) throw new Error("OAuth refresh was invalidated.");
        await this.persistActive(ref, generation, tokens);
        return tokens;
      }).finally(() => {
        if (created && this.refreshes.get(ref) === created) this.refreshes.delete(ref);
      });
      // A cancelled final waiter still leaves the shared provider promise to
      // settle asynchronously. Attach a sink so that provider abort errors do
      // not become process-level unhandled rejections; callers awaiting the
      // entry still receive the original failure through `waitForAbort`.
      void refresh.catch(() => undefined);
      created = { controller, promise: refresh, waiters: 0 };
      entry = created;
      this.refreshes.set(ref, entry);
    }

    entry.waiters += 1;
    try {
      return (await waitForAbort(entry.promise, signal)).accessToken;
    } finally {
      entry.waiters -= 1;
      if (signal?.aborted && entry.waiters === 0 && this.refreshes.get(ref) === entry) {
        entry.controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
      }
    }
  }

  async revoke(ref: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const current = await this.secrets.read(ref);
    this.revoked.add(ref);
    this.generations.set(ref, (this.generations.get(ref) ?? 0) + 1);
    this.refreshes.get(ref)?.controller.abort(new Error("OAuth connection revoked."));
    for (const [state, pending] of this.pending) if (pending.ref === ref) this.pending.delete(state);
    await this.serializeSecret(ref, () => this.secrets.delete(ref));
    if (current) await this.provider.revoke(current.refreshToken ?? current.accessToken, signal);
  }
  private persistActive(ref: string, generation: number, tokens: OAuthTokenSet): Promise<void> {
    return this.serializeSecret(ref, async () => {
      if (this.revoked.has(ref) || (this.generations.get(ref) ?? 0) !== generation) throw new Error("OAuth grant was invalidated before persistence.");
      await this.secrets.write(ref, tokens);
    });
  }
  private serializeSecret<T>(ref: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.secretMutations.get(ref) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.secretMutations.set(ref, next);
    void next.finally(() => { if (this.secretMutations.get(ref) === next) this.secretMutations.delete(ref); }).catch(() => undefined);
    return next;
  }
}

interface RefreshEntry {
  readonly controller: AbortController;
  readonly promise: Promise<OAuthTokenSet>;
  waiters: number;
}

async function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(signal.reason ?? new DOMException("Aborted", "AbortError"));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, abort]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function isExactHttpUrl(value: string): boolean {
  try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; }
}

function base64Url(value: Buffer): string { return value.toString("base64url"); }

export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
