import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCapabilityPackages } from "../../src/capabilities/extensions/packages.js";
import { ToolRegistry } from "../../src/capabilities/tools/registry.js";
import { workspaceContributions } from "../../src/capabilities/integrations/document-service/files.js";
import { createServer } from "node:http";

test("skills packages and optional provider-owned file procedures retain bounded behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-packages-"));
  try {
    await mkdir(join(root, "workspace")); await writeFile(join(root, "workspace", "facts.md"), "Approved launch: October 22.\nDependency: documentation.\n");
    await mkdir(join(root, "skills", "report", "references"), { recursive: true });
    await writeFile(join(root, "skills", "report", "SKILL.md"), "---\nname: report\ndescription: >-\n  Build a report using\n  source documents.\n---\nRead references/format.md and write the report.\n");
    await writeFile(join(root, "skills", "report", "references", "format.md"), "Cite each source and identify remaining uncertainty.");
    const configPath = join(root, "packages.json"); await writeFile(configPath, JSON.stringify({ schemaVersion: 1, packages: [{ id: "procedures", version: "2.0.0", source: "skills", root: "skills" }], profiles: [{ id: "workspace-agent", version: "1.0.0", packages: ["procedures"] }] }));
    const loaded = await loadCapabilityPackages(configPath); assert.equal(loaded.tools.length, 3); assert.equal(loaded.packages[0].skills[0].name, "report");
    const declaration = loaded.tools.find(tool => tool.descriptor.definition.name === "procedures_load_skill")!.descriptor.definition;
    assert.match(JSON.stringify(declaration.inputSchema), /report: Build a report using source documents/);
    const composed = loaded.profiles.find((profile) => profile.id === "workspace-agent")!;
    assert.equal(composed.grants.length, 3); assert.equal(composed.grants.find((grant) => grant.capabilityId === "procedures_load_skill")?.version, "2.0.0");
    const files = await workspaceContributions({ id: "files", version: "1.0.0" }, join(root, "workspace"));
    const allTools = [...loaded.tools, ...files];
    const registry = new ToolRegistry({ enabledNames: allTools.map((tool) => tool.descriptor.definition.name), approvedNames: ["files_write_file", "files_patch_file"] });
    for (const tool of allTools) registry.register(tool.implementation);
    let calls = 0;
    async function execute(name: string, args: Record<string, unknown>) {
      const validated = registry.validateCall({ toolCallId: `call-${++calls}`, name, arguments: args, round: calls }); assert.equal(validated.accepted, true);
      assert.equal(registry.authorize(validated.call).allowed, true);
      return registry.execute(validated, { runId: "run-test", turnId: "turn-test", signal: new AbortController().signal });
    }
    const read = await execute("files_read_file", { path: "facts.md" }); assert.equal(read.status, "completed"); assert.match(read.content, /October 22/);
    const search = await execute("files_search_files", { query: "Dependency" }); assert.equal(JSON.parse(search.content).matches[0].line, 2);
    const skill = await execute("procedures_load_skill", { name: "report" }); assert.equal(JSON.parse(skill.content).authority, "none"); assert.match(JSON.parse(skill.content).instructions, /references\/format.md/);
    const reference = await execute("procedures_read_skill_resource", { name: "report", path: "references/format.md" }); assert.match(JSON.parse(reference.content).content, /uncertainty/);
    const created = await execute("files_write_file", { path: "artifacts/report.md", content: "Launch October 22." }); assert.equal(created.status, "completed");
    const patched = await execute("files_patch_file", { path: "artifacts/report.md", oldText: "22", newText: "23", expectedDigest: JSON.parse(created.content).digest }); assert.equal(patched.status, "completed"); assert.equal(await readFile(join(root, "workspace", "artifacts", "report.md"), "utf8"), "Launch October 23.");
    assert.equal((await execute("files_write_file", { path: "artifacts/report.md", content: "lost update" })).status, "failed");
    assert.equal((await execute("files_read_file", { path: "../packages.json" })).status, "failed");
    await symlink(join(root, "packages.json"), join(root, "workspace", "outside.json")); assert.equal((await execute("files_read_file", { path: "outside.json" })).status, "failed");
    await writeFile(join(root, "skills", "report", "references", "format.md"), "changed"); assert.equal((await execute("procedures_read_skill_resource", { name: "report", path: "references/format.md" })).status, "failed");
    const denied = new ToolRegistry({ enabledNames: allTools.map((tool) => tool.descriptor.definition.name) }); for (const tool of allTools) denied.register(tool.implementation);
    assert.equal(denied.authorize({ name: "files_write_file", toolCallId: "denied-write", arguments: {}, round: 1 }).allowed, false);
    // Independent sessions share declarations, while follow-ups retain actual files.
    await mkdir(join(root, "template")); await writeFile(join(root, "template", "brief.md"), "Immutable template.");
    const isolated = await workspaceContributions({ id: "isolated", version: "1.0.0" }, join(root, "template"), ["artifacts"], { isolateSessions: true, stateRoot: join(root, "state") });
    const writer = isolated.find((tool) => tool.descriptor.definition.name === "isolated_write_file")!.implementation;
    const reader = isolated.find((tool) => tool.descriptor.definition.name === "isolated_read_file")!.implementation;
    const context = { runId: "run-isolated", turnId: "turn-isolated", signal: new AbortController().signal };
    await writer.execute({ path: "artifacts/report.md", content: "Session A." }, { ...context, sessionId: "session-a" });
    await writer.execute({ path: "artifacts/report.md", content: "Session B." }, { ...context, sessionId: "session-b" });
    assert.match(await reader.execute({ path: "artifacts/report.md" }, { ...context, sessionId: "session-a" }), /Session A/);
    assert.match(await reader.execute({ path: "artifacts/report.md" }, { ...context, sessionId: "session-b" }), /Session B/);
    await assert.rejects(reader.execute({ path: "brief.md" }, context), /host-admitted session/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a later invalid package closes earlier admitted MCP sessions once", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-package-cleanup-"));
  let deletes = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") {
      assert.equal(request.headers["mcp-session-id"], "session-package-test");
      deletes++; response.writeHead(204); response.end(); return;
    }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as { id?: string; method: string };
    if (input.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
    response.writeHead(200, { "content-type": "application/json", "Mcp-Session-Id": "session-package-test" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result: input.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cleanup-test", version: "1.0.0" } } : { tools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }, { name: "inspect", inputSchema: { type: "object", properties: {} } }] } }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const configPath = join(root, "packages.json");
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, packages: [{ id: "remote", version: "1.0.0", source: "mcp", protocolVersion: "2025-06-18", endpoint: `http://127.0.0.1:${address.port}/mcp` }, { id: "invalid", version: "1.0.0", source: "skills", root: "missing" }] }));
    await assert.rejects(loadCapabilityPackages(configPath), /ENOENT/);
    assert.equal(deletes, 1, "two source contributions share one session cleanup");
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
