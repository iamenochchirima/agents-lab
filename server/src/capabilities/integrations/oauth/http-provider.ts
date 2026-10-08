import type { OAuthAuthorizationRequest, OAuthProvider, OAuthTokenSet } from "./flow.js";

export interface HttpOAuthProviderOptions {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly resolveClientSecret?: () => string;
  readonly resource?: string;
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
  private readonly revocationEndpoint: URL | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: HttpOAuthProviderOptions) {
    this.authorizationEndpoint = exactHttpUrl(options.authorizationEndpoint);
    this.tokenEndpoint = exactHttpUrl(options.tokenEndpoint);
    this.revocationEndpoint = options.revocationEndpoint ? exactHttpUrl(options.revocationEndpoint) : undefined;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async authorize(request: OAuthAuthorizationRequest, signal?: AbortSignal): Promise<{ readonly code: string; readonly state: string }> {
    const url = new URL(request.authorizationUrl);
    if (url.origin + url.pathname !== this.authorizationEndpoint.origin + this.authorizationEndpoint.pathname) {
      throw new Error("OAuth authorization endpoint does not match the configured provider.");
    }
    const response = await this.fetchImplementation(url, { method: "GET", signal, redirect: "error" });
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
    if (!this.revocationEndpoint) return; // Local access revocation still deletes the grant.
    const response = await this.fetchImplementation(this.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ token, ...this.clientParameters() }).toString(),
      signal, redirect: "error",
    });
    if (!response.ok) throw new Error(`OAuth revocation failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
  }

  private async token(values: Record<string, string>, signal?: AbortSignal): Promise<OAuthTokenSet> {
    const response = await this.fetchImplementation(this.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...values, ...this.clientParameters(), ...(this.options.resource ? { resource: this.options.resource } : {}) }).toString(),
      signal, redirect: "error",
    });
    const body = await readJson(response);
    if (!response.ok || !isRecord(body)) throw new Error(`OAuth token request failed with HTTP ${response.status}.`);
    if (typeof body.access_token !== "string" || !body.access_token || body.access_token.length > 16384 || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 315360000) {
      throw new Error("OAuth token response is invalid.");
    }
    const scope = typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [];
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresAt: new Date(Date.now() + body.expires_in * 1_000).toISOString(),
      scopes: scope,
      scopesProvided: typeof body.scope === "string",
    };
  }
  private clientParameters(): Record<string, string> {
    const clientSecret = this.options.resolveClientSecret?.() ?? this.options.clientSecret;
    return { ...(this.options.clientId ? { client_id: this.options.clientId } : {}), ...(clientSecret ? { client_secret: clientSecret } : {}) };
  }
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 64 * 1024) { await reader.cancel(); throw new Error("OAuth response exceeds the configured limit."); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); } catch { throw new Error("OAuth provider returned malformed JSON."); }
}

function exactHttpUrl(value: string): URL {
  const parsed = new URL(value);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.hash) throw new Error("OAuth endpoint must use HTTP(S) without URL credentials or fragments.");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
