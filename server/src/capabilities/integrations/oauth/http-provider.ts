import type { OAuthAuthorizationRequest, OAuthProvider, OAuthTokenSet } from "./flow.js";

export interface HttpOAuthProviderOptions {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * HTTP OAuth adapter for deterministic local providers and provider-shaped
 * acceptance tests. Interactive providers still need a browser redirect for
 * authorization; this adapter's `authorize` method is intentionally limited
 * to a fixture endpoint that returns a test authorization code.
 */
export class HttpOAuthProvider implements OAuthProvider {
  private readonly authorizationEndpoint: URL;
  private readonly tokenEndpoint: URL;
  private readonly revocationEndpoint: URL;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpOAuthProviderOptions) {
    this.authorizationEndpoint = exactHttpUrl(options.authorizationEndpoint);
    this.tokenEndpoint = exactHttpUrl(options.tokenEndpoint);
    this.revocationEndpoint = exactHttpUrl(options.revocationEndpoint);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async authorize(request: OAuthAuthorizationRequest, signal?: AbortSignal): Promise<{ readonly code: string; readonly state: string }> {
    const url = new URL(request.authorizationUrl);
    if (url.origin + url.pathname !== this.authorizationEndpoint.origin + this.authorizationEndpoint.pathname) {
      throw new Error("OAuth authorization endpoint does not match the configured provider.");
    }
    const response = await this.fetchImplementation(url, { method: "GET", signal });
    const body = await readJson(response);
    if (!response.ok || !isRecord(body) || typeof body.code !== "string" || typeof body.state !== "string") {
      throw new Error(`OAuth authorization failed with HTTP ${response.status}.`);
    }
    return { code: body.code, state: body.state };
  }

  async exchange(code: string, verifier: string, redirectUri: string, signal?: AbortSignal): Promise<OAuthTokenSet> {
    return this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }, signal);
  }

  async refresh(refreshToken: string, signal?: AbortSignal): Promise<OAuthTokenSet> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, signal);
  }

  async revoke(token: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchImplementation(this.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ token }).toString(),
      signal,
    });
    if (!response.ok) throw new Error(`OAuth revocation failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
  }

  private async token(values: Record<string, string>, signal?: AbortSignal): Promise<OAuthTokenSet> {
    const response = await this.fetchImplementation(this.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(values).toString(),
      signal,
    });
    const body = await readJson(response);
    if (!response.ok || !isRecord(body)) throw new Error(`OAuth token request failed with HTTP ${response.status}.`);
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
      throw new Error("OAuth token response is invalid.");
    }
    const scope = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [];
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresAt: new Date(Date.now() + body.expires_in * 1_000).toISOString(),
      scopes: scope,
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error("OAuth response exceeds the configured limit.");
  try { return JSON.parse(text); } catch { throw new Error("OAuth provider returned malformed JSON."); }
}

function exactHttpUrl(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("OAuth endpoint must use HTTP(S).");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
