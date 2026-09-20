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
}

export interface OAuthProvider {
  authorize(request: OAuthAuthorizationRequest): Promise<{ readonly code: string; readonly state: string }>;
  exchange(code: string, verifier: string, redirectUri: string): Promise<OAuthTokenSet>;
  refresh(refreshToken: string): Promise<OAuthTokenSet>;
  revoke(token: string): Promise<void>;
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
  private readonly pending = new Map<string, { readonly verifier: string; readonly redirectUri: string; readonly scopes: readonly string[] }>();
  private readonly refreshes = new Map<string, Promise<OAuthTokenSet>>();

  constructor(private readonly provider: OAuthProvider, private readonly secrets: SecretStore) {}

  begin(ref: string, authorizationEndpoint: string, redirectUri: string, scopes: readonly string[]): OAuthAuthorizationRequest {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(ref)) throw new Error("OAuth connection reference is unsafe.");
    if (!isExactHttpUrl(redirectUri)) throw new Error("OAuth redirect URI must be an exact HTTP(S) URL.");
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash("sha256").update(verifier).digest());
    this.pending.set(state, { verifier, redirectUri, scopes: [...scopes] });
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    return { state, codeChallenge, codeChallengeMethod: "S256", redirectUri, scopes: [...scopes], authorizationUrl: url.toString() };
  }

  async complete(ref: string, state: string, code: string): Promise<OAuthTokenSet> {
    const pending = this.pending.get(state);
    if (!pending) throw new Error("OAuth state is missing, expired, or already used.");
    this.pending.delete(state);
    const tokens = await this.provider.exchange(code, pending.verifier, pending.redirectUri);
    await this.secrets.write(ref, tokens);
    return tokens;
  }

  async accessToken(ref: string): Promise<string> {
    const current = await this.secrets.read(ref);
    if (!current) throw new Error("OAuth connection is not configured.");
    if (Date.parse(current.expiresAt) > Date.now() + 30_000) return current.accessToken;
    if (!current.refreshToken) throw new Error("OAuth access token expired and no refresh token is available.");
    const inFlight = this.refreshes.get(ref);
    if (inFlight) return (await inFlight).accessToken;
    const refresh = this.provider.refresh(current.refreshToken).then(async (tokens) => {
      await this.secrets.write(ref, tokens);
      return tokens;
    }).finally(() => this.refreshes.delete(ref));
    this.refreshes.set(ref, refresh);
    return (await refresh).accessToken;
  }

  async revoke(ref: string): Promise<void> {
    const current = await this.secrets.read(ref);
    if (current) await this.provider.revoke(current.refreshToken ?? current.accessToken);
    await this.secrets.delete(ref);
  }
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
