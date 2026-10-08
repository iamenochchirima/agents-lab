import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.AGENTLAB_OAUTH_PROBE_PORT || 9198);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port.");
const issuer = "http://127.0.0.1:" + port, resource = issuer + "/mcp";
const codes = new Map(), access = new Map(), refresh = new Map();
const random = () => randomBytes(32).toString("base64url");
const ttl = 30, scope = "probe.read", clientId = "lab-check";
function json(response, status, value, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}
function reject(response, error = "invalid_request") { json(response, 400, { error }); }
function same(a, b) {
  const left = Buffer.from(a || ""), right = Buffer.from(b || "");
  return left.length === right.length && timingSafeEqual(left, right);
}
function callback(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && ["5173", "4322"].includes(url.port) && !url.username && !url.password && !url.hash && !url.search
      && /^\/api\/management\/connections\/conn_[a-z0-9][a-z0-9_-]{0,57}\/callback$/.test(url.pathname);
  } catch { return false; }
}
async function body(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 65536) throw new Error("Body limit."); chunks.push(chunk); }
  return Buffer.concat(chunks).toString();
}
function grant(response) {
  const accessToken = random(), refreshToken = random(), grantId = random();
  access.set(accessToken, { expiresAt: Date.now() + ttl * 1000, resource, scope, grantId });
  refresh.set(refreshToken, { resource, scope, clientId, grantId, expiresAt: Date.now() + 3600_000 });
  json(response, 200, { access_token: accessToken, token_type: "Bearer", expires_in: ttl, refresh_token: refreshToken, scope });
}
function cleanup() {
  const now = Date.now();
  for (const [key, value] of codes) if (value.expiresAt <= now) codes.delete(key);
  for (const store of [access, refresh]) for (const [key, value] of store) if (value.expiresAt <= now) store.delete(key);
}
const server = createServer(async (request, response) => {
  try {
    cleanup();
    const url = new URL(request.url, issuer);
    if (url.pathname === "/") return json(response, 200, { fixture: "Local fake OAuth MCP provider. No real user account; fixture authorization auto-approves.", resource, issuer, clientId });
    if (request.method === "GET" && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname))
      return json(response, 200, { resource, authorization_servers: [issuer], scopes_supported: [scope], bearer_methods_supported: ["header"] });
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server")
      return json(response, 200, { issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", revocation_endpoint: issuer + "/revoke",
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], scopes_supported: [scope],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true });
    if (request.method === "GET" && url.pathname === "/authorize") {
      const p = url.searchParams, redirect = p.get("redirect_uri"), challenge = p.get("code_challenge"), state = p.get("state");
      if (p.get("client_id") !== clientId || p.get("response_type") !== "code" || !callback(redirect)
        || p.get("resource") !== resource || p.get("scope") !== scope || p.get("code_challenge_method") !== "S256"
        || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || !state || state.length > 256) return reject(response);
      // Automatic consent exists only for this fake-data fixture. Production
      // authorization requires an actual identity and account consent.
      const code = random();
      codes.set(code, { clientId, redirect, challenge, resource, state, expiresAt: Date.now() + 120_000 });
      const target = new URL(redirect); target.searchParams.set("code", code); target.searchParams.set("state", state); target.searchParams.set("iss", issuer);
      response.writeHead(302, { location: target.href, "cache-control": "no-store" }); response.end(); return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const p = new URLSearchParams(await body(request));
      if (p.get("client_id") !== clientId || p.get("resource") !== resource) return reject(response, "invalid_client");
      if (p.get("grant_type") === "authorization_code") {
        const code = p.get("code"), record = codes.get(code), verifier = p.get("code_verifier");
        if (!record || record.expiresAt <= Date.now() || record.clientId !== clientId || record.redirect !== p.get("redirect_uri")
          || record.resource !== p.get("resource") || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
          || !same(createHash("sha256").update(verifier).digest("base64url"), record.challenge)) return reject(response, "invalid_grant");
        codes.delete(code); return grant(response);
      }
      if (p.get("grant_type") === "refresh_token") {
        const token = p.get("refresh_token"), record = refresh.get(token);
        if (!record || record.expiresAt <= Date.now() || record.clientId !== clientId || record.resource !== p.get("resource")) return reject(response, "invalid_grant");
        refresh.delete(token);
        for (const [key, value] of access) if (value.grantId === record.grantId) access.delete(key);
        return grant(response);
      }
      return reject(response, "unsupported_grant_type");
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      const p = new URLSearchParams(await body(request)), token = p.get("token");
      if (p.get("client_id") !== clientId || (p.has("resource") && p.get("resource") !== resource)) return reject(response, "invalid_client");
      const record = refresh.get(token) ?? access.get(token);
      if (record) for (const store of [access, refresh]) for (const [key, value] of store) if (value.grantId === record.grantId) store.delete(key);
      response.writeHead(200, { "cache-control": "no-store" }); response.end(); return;
    }
    if (url.pathname === "/mcp") {
      const token = request.headers.authorization?.replace(/^Bearer /i, ""), record = access.get(token);
      if (!record || record.expiresAt <= Date.now() || record.resource !== resource) {
        return json(response, 401, { error: "fixture_authorization_required" }, { "www-authenticate": 'Bearer resource_metadata="' + issuer + '/.well-known/oauth-protected-resource/mcp", scope="' + scope + '"' });
      }
      if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
      const input = JSON.parse(await body(request));
      if (input.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
      let result;
      if (input.method === "initialize") result = { protocolVersion: input.params?.protocolVersion || "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "local-fake-oauth-probe", version: "1.0.0" } };
      else if (input.method === "tools/list") result = { tools: [{ name: "oauth_probe", description: "Read the fake OAuth acceptance marker.", annotations: { readOnlyHint: true },
        inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
      else if (input.method === "tools/call" && input.params?.name === "oauth_probe") result = { isError: false, content: [{ type: "text", text: "oauth-fixture-connected" }] };
      else return json(response, 200, { jsonrpc: "2.0", id: input.id, error: { code: -32601, message: "Unknown fixture method." } });
      return json(response, 200, { jsonrpc: "2.0", id: input.id, result });
    }
    json(response, 404, { error: "not_found" });
  } catch { json(response, 400, { error: "invalid_fixture_request" }); }
});
server.listen(port, "127.0.0.1", () => process.stdout.write("Fake OAuth MCP fixture listening on " + issuer + ". Auto-consent applies only to fake fixture data.\n"));
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
