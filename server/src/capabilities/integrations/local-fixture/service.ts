import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const MAX_BODY_BYTES = 8_192;

export interface LocalFixtureServerOptions {
  readonly host?: string;
  readonly port?: number;
}

interface FixtureRequest {
  readonly requestId: string;
  readonly operation: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
}

interface StoredWrite {
  readonly fingerprint: string;
  readonly response: FixtureResponse;
}

interface FixtureResponse {
  readonly providerRequestId: string;
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

interface AuthorizationCode {
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
  used: boolean;
}

interface RefreshRecord {
  readonly scopes: readonly string[];
  revoked: boolean;
}

export interface LocalFixtureServerHandle {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Starts the no-Docker local provider used by platform connection tests.
 *
 * It is intentionally a separate HTTP process in the local stack so platform
 * workers and the Python LangGraph service exercise a real connection boundary.
 */
export async function createLocalFixtureServer(options: LocalFixtureServerOptions = {}): Promise<LocalFixtureServerHandle> {
  const host = options.host ?? process.env.AGENTLAB_LOCAL_FIXTURE_HOST ?? "127.0.0.1";
  const port = options.port ?? parsePort(process.env.AGENTLAB_LOCAL_FIXTURE_PORT, 9191);
  const values = new Map<string, string>([
    ["alpha", "local fixture alpha"],
    ["project", "Agent Harness Lab"],
  ]);
  const writes = new Map<string, StoredWrite>();
  const authorizationCodes = new Map<string, AuthorizationCode>();
  const refreshTokens = new Map<string, RefreshRecord>();
  const revokedTokens = new Set<string>();

  const server = createServer((request, response) => {
    void handleRequest(request, response, values, writes, authorizationCodes, refreshTokens, revokedTokens);
  });
  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local fixture server did not expose a TCP address.");
  return {
    server,
    host,
    port: address.port,
    close: () => close(server),
  };
}

export async function startLocalFixtureServer(): Promise<void> {
  const handle = await createLocalFixtureServer();
  console.log(`Agent Harness Lab local fixture listening at http://${handle.host}:${handle.port}`);
  const shutdown = (): void => {
    void handle.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise<void>(() => undefined);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLocalFixtureServer().catch((error: unknown) => {
    console.error("Local fixture stopped:", error);
    process.exitCode = 1;
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  values: Map<string, string>,
  writes: Map<string, StoredWrite>,
  authorizationCodes: Map<string, AuthorizationCode>,
  refreshTokens: Map<string, RefreshRecord>,
  revokedTokens: Set<string>,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { service: "local-fixture", status: "ready", protocols: ["direct-api", "mcp", "oauth"] });
    return;
  }
  if (request.method === "POST" && request.url === "/mcp") {
    await handleMcpRequest(request, response, values);
    return;
  }
  if (request.method === "GET" && request.url?.startsWith("/oauth/authorize")) {
    handleOAuthAuthorize(request, response, authorizationCodes);
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/token") {
    await handleOAuthToken(request, response, authorizationCodes, refreshTokens, revokedTokens);
    return;
  }
  if (request.method === "POST" && request.url === "/oauth/revoke") {
    await handleOAuthRevoke(request, response, revokedTokens, refreshTokens);
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/connection") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const input = parseRequest(await readBody(request));
    const result = execute(input, values, writes);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      providerRequestId: `local-direct:${Date.now()}`,
      statusCode: 400,
      body: { error: safeMessage(error) },
    });
  }
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse, values: Map<string, string>): Promise<void> {
  try {
    const body: unknown = JSON.parse(await readBody(request));
    if (!isRecord(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      sendJson(response, 400, jsonRpcError(null, -32_600, "Invalid JSON-RPC request."));
      return;
    }
    if (body.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    const id = typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
    if (body.method === "initialize") {
      sendJson(response, 200, jsonRpcResult(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agentlab-local-mcp", version: "1.0.0" },
      }));
      return;
    }
    if (body.method === "tools/list") {
      sendJson(response, 200, jsonRpcResult(id, {
        tools: [{
          name: "fixture.lookup",
          description: "Read fixture data",
          inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
          _meta: { agentlabVersion: "1.0.0" },
        }],
      }));
      return;
    }
    if (body.method === "tools/call") {
      if (!isRecord(body.params) || body.params.name !== "fixture.lookup" || !isRecord(body.params.arguments)) {
        sendJson(response, 200, jsonRpcError(id, -32_602, "Unknown or invalid tool call."));
        return;
      }
      const key = stringValue(body.params.arguments.key);
      if (!key || key.length > 64) {
        sendJson(response, 200, jsonRpcError(id, -32_602, "Invalid fixture lookup key."));
        return;
      }
      sendJson(response, 200, jsonRpcResult(id, {
        structuredContent: { key, value: values.get(key) ?? null },
        content: [{ type: "text", text: JSON.stringify({ key, value: values.get(key) ?? null }) }],
        isError: false,
      }));
      return;
    }
    sendJson(response, 200, jsonRpcError(id, -32_601, "Method not found."));
  } catch (error) {
    sendJson(response, 400, jsonRpcError(null, -32_600, safeMessage(error)));
  }
}

function handleOAuthAuthorize(request: IncomingMessage, response: ServerResponse, authorizationCodes: Map<string, AuthorizationCode>): void {
  try {
    const url = new URL(request.url ?? "/oauth/authorize", "http://local-fixture.invalid");
    const state = url.searchParams.get("state");
    const codeChallenge = url.searchParams.get("code_challenge");
    const redirectUri = url.searchParams.get("redirect_uri");
    const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
    if (!state || !codeChallenge || !redirectUri || url.searchParams.get("code_challenge_method") !== "S256") {
      sendJson(response, 400, { error: "Invalid OAuth authorization request." });
      return;
    }
    const code = `fixture-code-${randomBytes(12).toString("hex")}`;
    authorizationCodes.set(code, { codeChallenge, redirectUri, scopes, state, used: false });
    sendJson(response, 200, { code, state });
  } catch (error) {
    sendJson(response, 400, { error: safeMessage(error) });
  }
}

async function handleOAuthToken(
  request: IncomingMessage,
  response: ServerResponse,
  authorizationCodes: Map<string, AuthorizationCode>,
  refreshTokens: Map<string, RefreshRecord>,
  revokedTokens: Set<string>,
): Promise<void> {
  try {
    const form = new URLSearchParams(await readBody(request));
    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      const code = form.get("code");
      const verifier = form.get("code_verifier");
      const redirectUri = form.get("redirect_uri");
      const pending = code ? authorizationCodes.get(code) : undefined;
      if (!pending || pending.used || !verifier || redirectUri !== pending.redirectUri || !samePkce(verifier, pending.codeChallenge)) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      pending.used = true;
      sendJson(response, 200, issueTokens(pending.scopes, refreshTokens));
      return;
    }
    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token");
      const record = refreshToken ? refreshTokens.get(refreshToken) : undefined;
      if (!refreshToken || !record || record.revoked || revokedTokens.has(refreshToken)) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      sendJson(response, 200, issueTokens(record.scopes, refreshTokens));
      return;
    }
    sendJson(response, 400, { error: "unsupported_grant_type" });
  } catch (error) {
    sendJson(response, 400, { error: safeMessage(error) });
  }
}

async function handleOAuthRevoke(
  request: IncomingMessage,
  response: ServerResponse,
  revokedTokens: Set<string>,
  refreshTokens: Map<string, RefreshRecord>,
): Promise<void> {
  const form = new URLSearchParams(await readBody(request));
  const token = form.get("token");
  if (token) {
    revokedTokens.add(token);
    const refresh = refreshTokens.get(token);
    if (refresh) refresh.revoked = true;
  }
  response.statusCode = 200;
  response.end();
}

function issueTokens(scopes: readonly string[], refreshTokens: Map<string, RefreshRecord>): Record<string, unknown> {
  const suffix = randomBytes(10).toString("hex");
  const refreshToken = `fixture-refresh-${suffix}`;
  refreshTokens.set(refreshToken, { scopes: [...scopes], revoked: false });
  return {
    access_token: `fixture-access-${suffix}`,
    token_type: "Bearer",
    refresh_token: refreshToken,
    expires_in: 3_600,
    scope: scopes.join(" "),
  };
}

function samePkce(verifier: string, challenge: string): boolean {
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function jsonRpcResult(id: string | number | null, result: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function execute(request: FixtureRequest, values: Map<string, string>, writes: Map<string, StoredWrite>): FixtureResponse {
  if (request.operation === "fixture.lookup") {
    const key = stringValue(request.input.key);
    if (!key || key.length > 64) return response(request, 400, { error: "Invalid fixture lookup key." });
    return response(request, 200, { key, value: values.get(key) ?? null });
  }

  if (request.operation === "fixture.write") {
    const key = stringValue(request.input.key);
    const value = stringValue(request.input.value);
    if (!key || key.length > 64 || value === null || value.length > 512 || request.idempotencyKey === null) {
      return response(request, 400, { error: "Invalid fixture write request." });
    }
    const fingerprint = JSON.stringify({ key, value });
    const previous = writes.get(request.idempotencyKey);
    if (previous) {
      return previous.fingerprint === fingerprint
        ? previous.response
        : response(request, 409, { error: "The idempotency key was already used for another write." });
    }
    values.set(key, value);
    const committed = response(request, 200, { key, written: true });
    writes.set(request.idempotencyKey, { fingerprint, response: committed });
    return committed;
  }

  return response(request, 404, { error: "The local fixture operation is not available." });
}

function parseRequest(body: string): FixtureRequest {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || !isSafe(value.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/) || !isSafe(value.operation, /^[a-z][a-z0-9_.:-]{0,127}$/) || !isRecord(value.input) || (value.idempotencyKey !== null && !isSafe(value.idempotencyKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/))) {
    throw new Error("Invalid local fixture request.");
  }
  return {
    requestId: value.requestId,
    operation: value.operation,
    input: value.input,
    idempotencyKey: value.idempotencyKey,
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error("Local fixture request is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function response(request: FixtureRequest, statusCode: number, body: Readonly<Record<string, unknown>>): FixtureResponse {
  return { providerRequestId: `local-direct:${request.requestId}`, statusCode, body };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("AGENTLAB_LOCAL_FIXTURE_PORT must be a valid port.");
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafe(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 256) : "Invalid local fixture request.";
}
