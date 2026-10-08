import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { StdioMcpServer } from "../../src/capabilities/integrations/mcp/stdio-server.js";
import { McpDispatchUnknownError, McpPreDispatchError } from "../../src/capabilities/integrations/mcp/http-server.js";

const fixture = resolve(process.cwd(), "tests/capabilities/fixtures/mcp-stdio-fixture.mjs");
const signal = () => new AbortController().signal;
const server = (requestTimeoutMs = 1_000, maxResponseBytes = 4096) => new StdioMcpServer({ executable: process.execPath, args: [fixture], cwd: process.cwd(), env: { MCP_TEST_SECRET: "fixture-credential" }, requestTimeoutMs, maxResponseBytes });

test("managed stdio initializes, discovers, calls and restarts with a scrubbed environment", async () => {
  process.env.MCP_UNRELATED_SECRET = "host-only-secret";
  const client = server();
  try {
    assert.equal((await client.listTools(signal()))[0]?.name, "fixture_echo");
    const result = await client.callTool("fixture_echo", { value: "hello" }, "first", signal());
    assert.deepEqual(result.output, { initialized: true, value: "hello", inherited: null, explicit: true });
    const generation = client.status().generation;
    await client.restart();
    assert.equal(client.status().state, "running");
    assert.equal(client.status().generation, generation + 1);
    assert.equal((await client.callTool("fixture_echo", { value: "after restart" }, "second", signal())).output.value, "after restart");
    assert.equal(JSON.stringify(client.status()).includes("fixture-credential"), false);
    await client.stop();
    assert.equal(client.status().state, "stopped");
    assert.equal(client.status().pid, null);
    await assert.rejects(client.callTool("fixture_echo", {}, "stopped", signal()), McpPreDispatchError);
  } finally { delete process.env.MCP_UNRELATED_SECRET; await client.close(); }
});

test("dispatched cancellation, timeout and crash retain unknown outcome without replay", async () => {
  const client = server(100);
  try {
    await client.start();
    const controller = new AbortController();
    const cancelled = client.callTool("fixture_echo", { hang: true }, "cancelled", controller.signal);
    // ready() awaits a shared initialized session; let dispatch reach the child first.
    await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
    await assert.rejects(cancelled, McpDispatchUnknownError);
    await assert.rejects(client.callTool("fixture_echo", { hang: true }, "timeout", signal()), McpDispatchUnknownError);
    await assert.rejects(client.callTool("fixture_echo", { crash: true }, "crash", signal()), McpDispatchUnknownError);
    assert.equal(client.status().state, "failed");
    await assert.rejects(client.callTool("fixture_echo", {}, "after-crash", signal()), McpPreDispatchError);
    await client.restart();
    assert.equal((await client.callTool("fixture_echo", { value: "recovered" }, "recovered", signal())).output.value, "recovered");
  } finally { await client.close(); }
});

test("malformed and oversized provider output fail closed without leaking raw output", async () => {
  for (const args of [{ malformed: true }, { large: true }]) {
    const client = server();
    try {
      await client.start();
      await assert.rejects(client.callTool("fixture_echo", args, "invalid", signal()), McpDispatchUnknownError);
      assert.equal(client.status().state, "failed");
    } finally { await client.close(); }
  }
});

test("failed launch and pre-aborted invocation have no dispatched tool effect", async () => {
  const invalid = new StdioMcpServer({ executable: "/definitely/missing/mcp", cwd: process.cwd(), requestTimeoutMs: 100 });
  try { await assert.rejects(invalid.listTools(signal()), McpPreDispatchError); } finally { await invalid.close(); }
  const client = server();
  const controller = new AbortController(); controller.abort();
  try { await assert.rejects(client.callTool("fixture_echo", {}, "aborted", controller.signal), McpPreDispatchError); assert.equal(client.status().generation, 0); } finally { await client.close(); }
});
