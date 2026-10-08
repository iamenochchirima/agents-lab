import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverMcpOAuth, selectMcpOAuthClient, OAuthDiscoveryError, type McpOAuthMetadata } from "../../src/capabilities/management/oauth-discovery.js";
const resource = "https://notes.example/public/mcp", issuer = "https://auth.example/tenant";
const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const server = { issuer, authorization_endpoint: "https://auth.example/authorize", token_endpoint: "https://auth.example/token", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_post"] };
const metadata: McpOAuthMetadata = { resource, issuer, authorizationEndpoint: server.authorization_endpoint, tokenEndpoint: server.token_endpoint, requestedScopes: ["notes:read"], tokenEndpointAuthMethods: ["none", "client_secret_post"], issuerRequired: false, clientMetadataDocumentSupported: false };
function fixture(handler: (url: string, init?: RequestInit) => Response): typeof fetch { return (async (url, init) => { assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("authorization"), null); return handler(String(url), init); }) as typeof fetch; }

test("protected-resource root and all issuer-path fallbacks preserve exact authority", async () => {
  const requests: string[] = [];
  const fetcher = fixture(url => {
    requests.push(url);
    if (url === resource) return new Response(null, { status: 401 });
    if (url === "https://notes.example/.well-known/oauth-protected-resource") return json({ resource, authorization_servers: [issuer], scopes_supported: ["notes:read", "notes:write"] });
    if (url === `${issuer}/.well-known/openid-configuration`) return json(server);
    return json({}, 404);
  });
  const result = await discoverMcpOAuth({ resource, allowedIssuers: [issuer], requestedScopes: ["notes:read"], fetchImplementation: fetcher }, signal());
  assert.deepEqual(requests, [resource, "https://notes.example/.well-known/oauth-protected-resource/public/mcp", "https://notes.example/.well-known/oauth-protected-resource", "https://auth.example/.well-known/oauth-authorization-server/tenant", "https://auth.example/.well-known/openid-configuration/tenant", `${issuer}/.well-known/openid-configuration`]);
  assert.deepEqual(result.requestedScopes, ["notes:read"]);
});

test("challenge metadata URL takes precedence; scope expansion and untrusted issuers fail before authorization", async () => {
  const calls: string[] = [];
  const challenge = fixture(url => { calls.push(url); if (url === resource) return new Response(null, { status: 401, headers: { "www-authenticate": 'Basic realm="other", Bearer resource_metadata="https://notes.example/custom", scope="notes:read"' } }); if (url.endsWith("/custom")) return json({ resource, authorization_servers: [issuer] }); return json(server); });
  await discoverMcpOAuth({ resource, allowedIssuers: [issuer], requestedScopes: ["notes:read"], fetchImplementation: challenge }, signal());
  assert.equal(calls[1], "https://notes.example/custom");
  const expansion = fixture(() => new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer scope="notes:write"' } }));
  await assert.rejects(discoverMcpOAuth({ resource, allowedIssuers: [issuer], requestedScopes: ["notes:read"], fetchImplementation: expansion }, signal()), error => error instanceof OAuthDiscoveryError && error.code === "OAUTH_SCOPE_CHANGE_REQUIRED");
  const untrusted = fixture(url => url === resource ? new Response(null, { status: 401 }) : json({ resource, authorization_servers: ["https://untrusted.example"] }));
  await assert.rejects(discoverMcpOAuth({ resource, allowedIssuers: [issuer], requestedScopes: [], fetchImplementation: untrusted }, signal()), error => error instanceof OAuthDiscoveryError && error.code === "OAUTH_ISSUER_UNTRUSTED");
});

test("invalid metadata identity, missing PKCE and oversized documents fail closed", async () => {
  for (const result of [{ ...server, issuer: "https://imposter.example" }, { ...server, code_challenge_methods_supported: [] }, { oversized: "x".repeat(70_000) }]) {
    const fetcher = fixture(url => url === resource ? new Response(null, { status: 401 }) : url.startsWith("https://notes.example/") ? json({ resource, authorization_servers: [issuer] }) : json(result));
    await assert.rejects(discoverMcpOAuth({ resource, allowedIssuers: [issuer], requestedScopes: [], fetchImplementation: fetcher }, signal()), OAuthDiscoveryError);
  }
  await assert.rejects(discoverMcpOAuth({ resource: "http://remote.example/mcp", allowedIssuers: [issuer], requestedScopes: [] }, signal()), OAuthDiscoveryError);
});

test("client selection prefers preregistration then validated HTTPS CIMD before DCR", async () => {
  const capable = { ...metadata, clientMetadataDocumentSupported: true, registrationEndpoint: "https://auth.example/register" };
  const redirectUri = "http://127.0.0.1:4322/oauth/callback";
  let fetchCount = 0;
  const fetcher = fixture(url => { fetchCount++; assert.equal(url, "https://lab.example/client.json"); return json({ client_id: url, client_name: "Lab", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }); });
  const ready = await selectMcpOAuthClient({ metadata: capable, redirectUri, preRegistered: { clientId: "existing", clientSecret: "backend-only" }, clientMetadataUrl: "https://lab.example/client.json", fetchImplementation: fetcher }, signal());
  assert.equal(ready.kind, "ready"); if (ready.kind === "ready") assert.equal(ready.method, "pre_registered"); assert.equal(fetchCount, 0);
  const cimd = await selectMcpOAuthClient({ metadata: capable, redirectUri, clientMetadataUrl: "https://lab.example/client.json", fetchImplementation: fetcher }, signal());
  assert.equal(cimd.kind, "ready"); if (cimd.kind === "ready") assert.equal(cimd.method, "metadata_document"); assert.equal(fetchCount, 1);
  await assert.rejects(selectMcpOAuthClient({ metadata: capable, redirectUri, clientMetadataUrl: "http://localhost/client.json", fetchImplementation: fetcher }, signal()), OAuthDiscoveryError);
  const mismatch = fixture(url => json({ client_id: url, client_name: "Lab", redirect_uris: ["https://other.example/callback"] }));
  await assert.rejects(selectMcpOAuthClient({ metadata: capable, redirectUri, clientMetadataUrl: "https://lab.example/client.json", fetchImplementation: mismatch }, signal()), OAuthDiscoveryError);
});

test("DCR posts only configured grant and returns backend credentials; unsupported providers need manual setup", async () => {
  const redirectUri = "http://localhost:4322/callback";
  const fetcher = fixture((url, init) => { assert.equal(url, "https://auth.example/register"); assert.equal(init?.method, "POST"); const request = JSON.parse(String(init?.body)); assert.equal(request.scope, "notes:read"); assert.deepEqual(request.redirect_uris, [redirectUri]); assert.equal(request.token_endpoint_auth_method, "client_secret_post"); return json({ client_id: "dynamic", client_secret: "store-encrypted", redirect_uris: [redirectUri], token_endpoint_auth_method: "client_secret_post", scope: "notes:read" }, 201); });
  const result = await selectMcpOAuthClient({ metadata: { ...metadata, tokenEndpointAuthMethods: ["client_secret_post"], registrationEndpoint: "https://auth.example/register" }, redirectUri, fetchImplementation: fetcher }, signal());
  assert.deepEqual(result, { kind: "ready", method: "dynamic_registration", clientId: "dynamic", clientSecret: "store-encrypted", tokenEndpointAuthMethod: "client_secret_post" });
  assert.equal((await selectMcpOAuthClient({ metadata, redirectUri }, signal())).kind, "manual_setup");
  let attempts = 0;
  await assert.rejects(selectMcpOAuthClient({ metadata: { ...metadata, registrationEndpoint: "https://auth.example/register" }, redirectUri, fetchImplementation: (async () => { attempts++; throw new Error("secret=must-not-leak"); }) as typeof fetch }, signal()), error => error instanceof OAuthDiscoveryError && error.code === "OAUTH_REGISTRATION_UNKNOWN" && !error.message.includes("must-not-leak"));
  assert.equal(attempts, 1);
});
