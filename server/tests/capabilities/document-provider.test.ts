import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentService } from "../../src/capabilities/integrations/document-service/service.js";
import { loadMcpSource } from "../../src/capabilities/extensions/connected-sources.js";
import { loadCapabilityPackages } from "../../src/capabilities/extensions/packages.js";

test("external document provider owns persistent files and enforces authenticated session scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-documents-"));
  await mkdir(join(root, "template")); await writeFile(join(root, "template/facts.md"), "Approved launch October 22.");
  const token = "fictional-local-fixture-token";
  const service = await createDocumentService({ port: 0, token, templateRoot: join(root, "template"), stateRoot: join(root, "provider-storage") });
  const address = service.app.server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  async function call(name: string, args: Record<string, unknown>, session?: string, authorized = true) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...(session ? { "X-AgentLab-Session-Id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name, arguments: args } }) });
  }
  try {
    assert.equal((await call("task-workspace_read_file", { path: "facts.md" }, "a", false)).status, 401);
    assert.equal((await call("task-workspace_read_file", { path: "facts.md" })).status, 403);
    // The same adapter boundary used by native platforms injects trusted scope.
    const connected = await loadMcpSource({ id: "documents", version: "2.0.0", endpoint: url, protocolVersion: "2026-07-28", headers: { Authorization: `Bearer ${token}` }, trustedContext: "session", tools: [{ remoteName: "task-workspace_read_file", name: "documents_read", riskClass: "read" }] });
    try {
      const text = await connected[0].implementation.execute({ path: "facts.md" }, { runId: "run-provider", turnId: "turn-provider", sessionId: "adapter-session", signal: new AbortController().signal });
      assert.match(text, /Approved launch October 22/);
    } finally { await connected[0].close?.(); }
    const created = await (await call("task-workspace_write_file", { path: "artifacts/report.md", content: "Session A." }, "a")).json() as any;
    assert.equal(created.result.structuredContent.path, "artifacts/report.md");
    assert.equal(await readFile(join(service.stateRoot, "a/artifacts/report.md"), "utf8"), "Session A.");
    const other = await (await call("task-workspace_read_file", { path: "artifacts/report.md" }, "b")).json() as any;
    assert.equal(other.result.isError, true);
    const followed = await (await call("task-workspace_read_file", { path: "artifacts/report.md" }, "a")).json() as any;
    assert.equal(followed.result.structuredContent.content, "Session A.");
    const injected = await (await call("task-workspace_read_file", { path: "facts.md", sessionId: "b" }, "a")).json() as any;
    assert.equal(injected.result.isError, true);
    const escape = await (await call("task-workspace_read_file", { path: "../template/facts.md" }, "a")).json() as any;
    assert.equal(escape.result.isError, true);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test("legacy native workspace configuration fails with explicit migration and default profile has no provider dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-document-migration-"));
  try {
    const config = join(root, "packages.json");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, packages: [{ id: "files", version: "1.0.0", source: "workspace", root: "." }] }));
    await assert.rejects(loadCapabilityPackages(config), /Native workspace packages.*document provider/);
    const loaded = await loadCapabilityPackages(join(process.cwd(), "capability-packages/example.json"));
    assert.ok(loaded.profiles.some(profile => profile.id === "business-agent"));
    assert.equal(loaded.packages.every(value => value.source === "skills"), true);
    assert.equal(loaded.tools.some(value => value.descriptor.definition.name.endsWith("read_file")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
