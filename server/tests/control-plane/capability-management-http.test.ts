import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { CapabilityAdminSessions } from "../../src/capabilities/management/admin-session.js";
import { OAuthDiscoveryError } from "../../src/capabilities/management/oauth-discovery.js";
import type { CapabilityManagement } from "../../src/capabilities/management/service.js";
import { trustedFrontendOrigins } from "../../src/control-plane/bootstrap/frontend-origins.js";
import { registerCapabilityManagement } from "../../src/control-plane/http/capability-management.js";

test("management API returns sanitized OAuth setup diagnostics instead of its generic failure", async () => {
  const app = Fastify();
  const origin = "http://localhost:5173";
  const sessions = await CapabilityAdminSessions.create(trustedFrontendOrigins(origin));
  const management = {
    saveConnection: async () => {
      throw new OAuthDiscoveryError("OAUTH_DISCOVERY_FAILED", "OAuth metadata discovery endpoints are unavailable.");
    },
  } as unknown as CapabilityManagement;
  registerCapabilityManagement(app, management, sessions);

  try {
    const sessionResponse = await app.inject({ method: "GET", url: "/api/management/session" });
    const cookie = String(sessionResponse.headers["set-cookie"]).split(";")[0]!;
    const response = await app.inject({
      method: "POST",
      url: "/api/management/connections",
      headers: { origin, cookie, "x-agentlab-csrf": sessionResponse.json().csrfToken },
      payload: { expectedRevision: 0, connection: {} },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "OAuth metadata discovery endpoints are unavailable.",
      code: "OAUTH_DISCOVERY_FAILED",
    });
  } finally {
    await app.close();
  }
});

test("management API keeps unknown provider errors private", async () => {
  const app = Fastify();
  const origin = "http://localhost:5173";
  const sessions = await CapabilityAdminSessions.create(trustedFrontendOrigins(origin));
  const management = { saveConnection: async () => { throw new Error("provider echoed access_token=private-value"); } } as unknown as CapabilityManagement;
  registerCapabilityManagement(app, management, sessions);

  try {
    const sessionResponse = await app.inject({ method: "GET", url: "/api/management/session" });
    const cookie = String(sessionResponse.headers["set-cookie"]).split(";")[0]!;
    const response = await app.inject({
      method: "POST",
      url: "/api/management/connections",
      headers: { origin, cookie, "x-agentlab-csrf": sessionResponse.json().csrfToken },
      payload: { expectedRevision: 0, connection: {} },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "Capability operation could not complete. Check the connection, setup fields, dependencies and current configuration.");
    assert.equal(JSON.stringify(response.json()).includes("private-value"), false);
  } finally {
    await app.close();
  }
});
