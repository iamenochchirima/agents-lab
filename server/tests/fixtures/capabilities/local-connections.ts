import type { DirectApiAdapter, DirectApiResponse } from "../../../src/capabilities/integrations/direct-api/client.js";
import type { McpServer } from "../../../src/capabilities/integrations/mcp/local-transport.js";
import type { OAuthAuthorizationRequest, OAuthProvider, OAuthTokenSet } from "../../../src/capabilities/integrations/oauth/flow.js";

/** Deterministic protocol-shaped fixtures used by capability acceptance tests. */
export function createLocalMcpServer(): McpServer {
  return {
    serverName: "agentlab-local-mcp",
    protocolVersion: "2025-06-18",
    async listTools() {
      return [{
        name: "fixture.lookup",
        version: "1.0.0",
        description: "Read fixture data",
        inputSchema: { type: "object" },
      }];
    },
    async callTool(name, input, requestId) {
      if (name !== "fixture.lookup" || input.key !== "alpha") throw new Error("Local MCP fixture received an invalid call.");
      return { providerRequestId: `mcp:${requestId}`, output: { key: "alpha", value: "local fixture alpha" } };
    },
  };
}

export class LocalDirectApiFixture implements DirectApiAdapter {
  calls = 0;

  constructor(private readonly failuresBeforeSuccess = 0) {}

  async send(request: { readonly requestId: string }, _signal: AbortSignal): Promise<DirectApiResponse> {
    this.calls += 1;
    if (this.calls <= this.failuresBeforeSuccess) {
      return { providerRequestId: `direct-provider-${this.calls}`, statusCode: 503, body: { retry: true } };
    }
    return {
      providerRequestId: `direct-provider-${this.calls}`,
      statusCode: 200,
      body: { requestId: request.requestId, value: "local direct API value" },
    };
  }
}

export class LocalOAuthFixture implements OAuthProvider {
  refreshCalls = 0;
  revokedTokens: string[] = [];

  async authorize(request: OAuthAuthorizationRequest): Promise<{ readonly code: string; readonly state: string }> {
    return { code: `fixture-code-${request.state.slice(0, 8)}`, state: request.state };
  }

  async exchange(_code: string, _verifier: string, _redirectUri: string): Promise<OAuthTokenSet> {
    return this.tokens("initial");
  }

  async refresh(_refreshToken: string): Promise<OAuthTokenSet> {
    this.refreshCalls += 1;
    return this.tokens("refreshed");
  }

  async revoke(token: string): Promise<void> {
    this.revokedTokens.push(token);
  }

  private tokens(suffix: string): OAuthTokenSet {
    return {
      accessToken: `local-access-${suffix}`,
      refreshToken: `local-refresh-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scopes: ["fixture.read"],
    };
  }
}
