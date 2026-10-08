import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadMcpSource } from "../../../src/capabilities/extensions/connected-sources.js";
import { StdioMcpServer } from "../../../src/capabilities/integrations/mcp/stdio-server.js";

/** The same hosted contribution and effect interpreter used by HTTP receives
 * a real stdio provider. No runtime-specific tool or alternate result path exists.
 */
test("managed stdio source exposes namespaced tools through canonical hosted effects", async () => {
  const clients: StdioMcpServer[] = [];
  const contributions = await loadMcpSource({
    id: "stdio-provider", version: "1.0.0", endpoint: "stdio://test-provider", protocolVersion: "2025-11-25",
    tools: [{ remoteName: "fixture_echo", name: "stdio_provider_echo", riskClass: "write", approvalMode: "automatic" }],
    createServer: (_resolveHeaders, onDispatch) => {
      const client = new StdioMcpServer({ executable: process.execPath, args: [resolve(process.cwd(), "tests/capabilities/fixtures/mcp-stdio-fixture.mjs")], cwd: process.cwd(), serverName: "stdio-provider", onDispatch, requestTimeoutMs: 1000 });
      clients.push(client); return client;
    },
  });
  assert.equal(contributions.length, 1);
  const contribution = contributions[0]!;
  assert.equal(contribution.descriptor.definition.name, "stdio_provider_echo");
  assert.equal(contribution.descriptor.source.id, "stdio-provider");
  assert.equal(contribution.descriptor.execution.kind, "hosted");
  assert.equal(contribution.descriptor.definition.executionKind, "connection");
  assert.doesNotMatch(JSON.stringify(contribution.descriptor), /stdio:\/\/|mcp-stdio-fixture|process\.execPath/);
  const context = { runId: "stdio-source-proof", turnId: "turn-1", toolCallId: "echo-call", toolRound: 1, signal: new AbortController().signal };
  const successful = await contribution.implementation.executeResult!({ value: "canonical acknowledgement" }, context);
  assert.equal(successful.status, "completed");
  assert.equal(successful.effect?.state, "acknowledged");
  assert.equal(successful.presentation, "not_declared");
  assert.match(successful.content, /canonical acknowledgement/);
  assert.equal(successful.attemptCount, 1);
  const unknown = await contribution.implementation.executeResult!({ crash: true }, { ...context, toolCallId: "crash-call" });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.effect?.state, "unknown");
  assert.equal(unknown.attemptCount, 1);
  assert.equal(clients.length, 3); // Discovery plus isolated clients for both calls.
  assert.equal(clients.every(client => client.status().state === "stopped" && client.status().pid === null), true);
});
