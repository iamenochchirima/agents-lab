import assert from "node:assert/strict";
import test from "node:test";

import { DirectApiClient, DispatchUnknownError } from "../../src/capabilities/integrations/direct-api/client.js";
import type { ConnectionRequest } from "../../src/capabilities/integrations/contracts.js";
import { McpTransport } from "../../src/capabilities/integrations/mcp/local-transport.js";
import { MemorySecretStore, OAuthFlow, type OAuthProvider, type OAuthTokenSet } from "../../src/capabilities/integrations/oauth/flow.js";
import { createLocalMcpServer, LocalDirectApiFixture, LocalOAuthFixture } from "../fixtures/capabilities/local-connections.js";

const limits = { timeoutMs: 100, maxRequestBytes: 8_192, maxResponseBytes: 8_192, maxAttempts: 3 } as const;
const request: ConnectionRequest = {
  requestId: "run-1:turn-1:read-1",
  operation: "fixture.read",
  input: { query: "hello" },
  idempotencyKey: null,
  limits,
};

test("MCP discovery is allowlisted and invocation is bounded", async () => {
  const server = {
    serverName: "local-fixture",
    protocolVersion: "2025-06-18",
    async listTools() {
      return [{ name: "fixture.lookup", version: "1.0.0", description: "Read fixture data", inputSchema: { type: "object" } }];
    },
    async callTool(name: string, input: Readonly<Record<string, unknown>>, requestId: string) {
      assert.equal(name, "fixture.lookup");
      assert.equal(input.key, "alpha");
      return { providerRequestId: `mcp:${requestId}`, output: { value: "fixture-value" } };
    },
  };
  const transport = new McpTransport({ server, endpoint: "local://fixture", allowedEndpoints: ["local://fixture"], limits });
  const tools = await transport.discover(new AbortController().signal);
  assert.equal(tools[0]?.name, "fixture.lookup");
  const result = await transport.invoke(tools[0]!, "run-1:turn-1:mcp-1", { key: "alpha" }, new AbortController().signal);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, { value: "fixture-value" });
  assert.equal(result.attempts[0]?.providerRequestId, "mcp:run-1:turn-1:mcp-1");
  assert.throws(() => new McpTransport({ server, endpoint: "https://untrusted.example", allowedEndpoints: ["local://fixture"], limits }));
});

test("MCP deadlines and cancellation abort the underlying call", async () => {
  let callAborted = false;
  const server = {
    serverName: "local-cancellable",
    protocolVersion: "2025-06-18",
    async listTools() {
      return [{ name: "fixture.lookup", version: "1.0.0", description: "Read fixture data", inputSchema: { type: "object" } }];
    },
    async callTool(_name: string, _input: Readonly<Record<string, unknown>>, _requestId: string, signal: AbortSignal) {
      await new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          callAborted = true;
          reject(signal.reason ?? new Error("call cancelled"));
        }, { once: true });
      });
      throw new Error("call should have been aborted");
    },
  };
  const tool = { name: "fixture.lookup", version: "1.0.0", description: "Read fixture data", inputSchema: { type: "object" } };
  const transport = new McpTransport({
    server,
    endpoint: "local://cancellable",
    allowedEndpoints: ["local://cancellable"],
    limits: { ...limits, timeoutMs: 5 },
  });
  const timedOut = await transport.invoke(tool, "mcp-timeout", { key: "alpha" }, new AbortController().signal);
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.error?.code, "MCP_TIMEOUT");
  assert.equal(callAborted, true);

  callAborted = false;
  const controller = new AbortController();
  const pending = transport.invoke(tool, "mcp-cancel", { key: "alpha" }, controller.signal);
  controller.abort(new Error("cancelled by test"));
  const cancelled = await pending;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error?.code, "MCP_CANCELLED");
  assert.equal(callAborted, true);
});

test("direct API retries bounded read failures and keeps provider request IDs", async () => {
  let calls = 0;
  const client = new DirectApiClient({
    limits,
    adapter: {
      async send() {
        calls += 1;
        if (calls < 3) return { providerRequestId: `provider-${calls}`, statusCode: 503, body: { retry: true } };
        return { providerRequestId: "provider-3", statusCode: 200, body: { value: 42 } };
      },
    },
  });
  const result = await client.request(request, { readOnly: true, signal: new AbortController().signal });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts.at(-1)?.providerRequestId, "provider-3");
});

test("direct API does not retry a dispatched write with unknown outcome", async () => {
  let attemptAborted = false;
  const client = new DirectApiClient({
    limits: { ...limits, timeoutMs: 5 },
    adapter: {
      async send(_request, signal) {
        signal.addEventListener("abort", () => { attemptAborted = true; }, { once: true });
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new DispatchUnknownError("ack lost");
      },
    },
  });
  const result = await client.request({
    ...request,
    operation: "fixture.write",
    idempotencyKey: "run-1:write-1",
    limits: { ...request.limits, timeoutMs: 5 },
  }, { readOnly: false, signal: new AbortController().signal });
  assert.equal(result.status, "unknown");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.error?.code, "API_OUTCOME_UNKNOWN");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(attemptAborted, true);
});

test("direct API cancellation aborts the in-flight attempt", async () => {
  const controller = new AbortController();
  let attemptAborted = false;
  const client = new DirectApiClient({
    limits,
    adapter: {
      async send(_request, signal) {
        signal.addEventListener("abort", () => { attemptAborted = true; }, { once: true });
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { providerRequestId: "late", statusCode: 200, body: { late: true } };
      },
    },
  });
  const pending = client.request(request, { readOnly: true, signal: controller.signal });
  controller.abort(new Error("cancelled by test"));
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.error?.code, "API_CANCELLED");
  assert.equal(attemptAborted, true);
});

test("direct API does not retry a write after a provider response either", async () => {
  let calls = 0;
  const client = new DirectApiClient({
    limits,
    adapter: {
      async send() {
        calls += 1;
        return { providerRequestId: "write-provider-1", statusCode: 503, body: { retry: true } };
      },
    },
  });
  const result = await client.request({ ...request, operation: "fixture.write", idempotencyKey: "write-1" }, {
    readOnly: false,
    signal: new AbortController().signal,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts.length, 1);
  assert.equal(calls, 1);
});

test("OAuth flow uses one-time S256 PKCE state and serializes refresh", async () => {
  let refreshCalls = 0;
  const tokens = (suffix: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): OAuthTokenSet => ({
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt,
    scopes: ["profile.read"],
  });
  const provider: OAuthProvider = {
    async authorize(request) { return { code: "fixture-code", state: request.state }; },
    async exchange(code, verifier, redirectUri) {
      assert.equal(code, "fixture-code");
      assert.ok(verifier.length >= 43);
      assert.equal(redirectUri, "http://127.0.0.1/callback");
      return tokens("initial");
    },
    async refresh(refreshToken) {
      refreshCalls += 1;
      assert.equal(refreshToken, "refresh-initial");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return tokens("refreshed");
    },
    async revoke(token) { assert.equal(token, "refresh-refreshed"); },
  };
  const secrets = new MemorySecretStore();
  const flow = new OAuthFlow(provider, secrets);
  const started = flow.begin("social-fixture", "http://127.0.0.1/authorize", "http://127.0.0.1/callback", ["profile.read"]);
  const parsed = new URL(started.authorizationUrl);
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("state"), started.state);
  await flow.complete("social-fixture", started.state, "fixture-code");
  await assert.rejects(() => flow.complete("social-fixture", started.state, "fixture-code"), /state is missing/);

  await secrets.write("social-fixture", tokens("initial", new Date(Date.now() - 1_000).toISOString()));
  const [first, second] = await Promise.all([flow.accessToken("social-fixture"), flow.accessToken("social-fixture")]);
  assert.equal(first, "access-refreshed");
  assert.equal(second, "access-refreshed");
  assert.equal(refreshCalls, 1);
  await flow.revoke("social-fixture");
  assert.equal(await secrets.read("social-fixture"), null);
});

test("OAuth refresh cancellation aborts the shared provider refresh", async () => {
  let refreshAborted = false;
  const provider: OAuthProvider = {
    async authorize(request) { return { code: "fixture-code", state: request.state }; },
    async exchange() { return { accessToken: "access", refreshToken: "refresh", expiresAt: new Date(Date.now() - 1_000).toISOString(), scopes: [] }; },
    async refresh(_refreshToken, signal) {
      await new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => {
          refreshAborted = true;
          reject(signal.reason ?? new Error("refresh cancelled"));
        }, { once: true });
      });
      throw new Error("refresh should have been cancelled");
    },
    async revoke() {},
  };
  const secrets = new MemorySecretStore();
  await secrets.write("cancelled-oauth", {
    accessToken: "expired",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
    scopes: [],
  });
  const flow = new OAuthFlow(provider, secrets);
  const controller = new AbortController();
  const pending = flow.accessToken("cancelled-oauth", controller.signal);
  controller.abort(new Error("cancelled by test"));
  await assert.rejects(pending, /cancelled by test/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(refreshAborted, true);
});

test("local fixtures exercise MCP, direct API, and OAuth through the same boundaries", async () => {
  const mcp = new McpTransport({
    server: createLocalMcpServer(),
    endpoint: "local://mcp",
    allowedEndpoints: ["local://mcp"],
    limits,
  });
  const [tool] = await mcp.discover(new AbortController().signal);
  const mcpResult = await mcp.invoke(tool!, "fixture-mcp-1", { key: "alpha" }, new AbortController().signal);
  assert.deepEqual(mcpResult.output, { key: "alpha", value: "local fixture alpha" });

  const directFixture = new LocalDirectApiFixture(1);
  const directResult = await new DirectApiClient({ adapter: directFixture, limits }).request({ ...request, requestId: "fixture-direct-1" }, {
    readOnly: true,
    signal: new AbortController().signal,
  });
  assert.equal(directResult.status, "completed");
  assert.equal(directFixture.calls, 2);

  const oauthProvider = new LocalOAuthFixture();
  const flow = new OAuthFlow(oauthProvider, new MemorySecretStore());
  const authorization = flow.begin("local-oauth", "http://127.0.0.1/authorize", "http://127.0.0.1/callback", ["fixture.read"]);
  const callback = await oauthProvider.authorize(authorization);
  await flow.complete("local-oauth", callback.state, callback.code);
  assert.match(await flow.accessToken("local-oauth"), /^local-access-/);
});
