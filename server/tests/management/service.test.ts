import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CapabilityManagement } from "../../src/capabilities/management/service.js";
import { createPackageCapabilityCatalog } from "../../src/capabilities/extensions/catalog.js";
import type { HostedToolContribution } from "../../src/capabilities/extensions/contracts.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../src/capabilities/tools/contracts.js";
import { EncryptedFileSecretStore } from "../../src/capabilities/integrations/oauth/encrypted-file-store.js";

const context: ToolExecutionContext = { runId: "managed-test", turnId: "turn-one", toolCallId: "call-one", signal: new AbortController().signal };
const invoke = (tool: HostedToolContribution) => (tool.implementation as typeof tool.implementation & { executeResult(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> }).executeResult({}, context);

test("managed seed imports once and profile edits survive restart independently of seed files", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-managed-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "skills", "notes-check"), { recursive: true });
  await writeFile(join(root, "skills", "notes-check", "SKILL.md"), "---\nname: notes-check\ndescription: Inspect notes before updating them.\n---\nRead existing notes before changing them.");
  const seedPath = join(root, "seed.json");
  await writeFile(seedPath, JSON.stringify({ schemaVersion: 1, packages: [{ id: "procedures", version: "1.0.0", source: "skills", root: "./skills" }],
    profiles: [{ id: "seed-agent", version: "1.0.0", packages: ["procedures"] }] }));
  const options = { root: join(root, "managed"), seedPath, environment: {} };
  let service = await CapabilityManagement.create(options);
  try {
    assert.equal(service.repository.read().profiles[0].id, "seed-agent");
    await service.saveProfile(service.repository.read().revision, { id: "focused-agent", version: "1.0.0", displayName: "Focused agent", packages: ["procedures"], skills: ["procedures:notes-check"] });
    assert.deepEqual(service.loaded.profiles.find(p => p.id === "focused-agent")?.availableSkills?.map(skill => skill.id), ["procedures:notes-check"]);
    const revision = service.repository.read().revision;
    await service.close();
    await rm(seedPath);
    service = await CapabilityManagement.create(options);
    assert.equal(service.repository.read().revision, revision);
    assert.ok(createPackageCapabilityCatalog(service.loaded).get("focused-agent"));
    assert.equal(service.repository.read().packages[0].source, "skills");
    await assert.rejects(service.saveProfile(revision, { id: "procedures", version: "1.0.0", displayName: "Colliding profile", packages: ["procedures"] }), /duplicated|collid/i);
    assert.equal(service.repository.read().revision, revision, "Failed admission must not publish unusable profile metadata");
  } finally { await service.close(); }
});

test("saved PAT discovers live MCP tools, updates profile and rejects stale authority after replacement", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-managed-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let expected = "Bearer service-fixture-secret", calls = 0;
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== expected) { response.writeHead(401); response.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const result = input.method === "tools/list" ? { tools: [{ name: "list_notes", description: "List private test notes", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] }
      : { content: [{ type: "text", text: "Test note list" }], isError: false };
    if (input.method === "tools/call") calls++;
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const endpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/mcp";
  const options = { root: join(root, "managed"), environment: { AGENTLAB_CREDENTIAL_KEY_HEX: randomBytes(32).toString("hex") } };
  let service = await CapabilityManagement.create(options);
  try {
    await service.saveConnection(0, { ref: "conn_notes", displayName: "Notes", provider: "Notes", owner: "local-workspace", resource: endpoint, scopes: [], enabled: true, auth: { kind: "anonymous" } },
      { kind: "personal-access-token", token: "service-fixture-secret" });
    const record = service.repository.read().connections[0];
    assert.equal(record.auth.kind, "stored");
    if (record.auth.kind !== "stored") throw new Error("Stored auth required");
    const originalCredentialId = record.auth.credentialRef;
    assert.match(record.auth.credentialRef, /^credential_/);
    assert.equal(JSON.stringify(await service.view()).includes("service-fixture-secret"), false);
    const credentialView = (await service.view()).connections[0].credential;
    assert.equal(credentialView.present, true);
    assert.equal(credentialView.expiresAt, null);
    assert.equal((await readFile(join(options.root, "credentials", "credentials.json"), "utf8")).includes("service-fixture-secret"), false);
    const discovered = await service.connectionAction(record.ref, "discover");
    assert.equal(discovered.tools?.[0].name, "list_notes");
    const pkg = service.repository.read().packages[0], tool = service.loaded.tools[0];
    assert.ok(tool);
    await service.saveProfile(service.repository.read().revision, { id: "notes-agent", version: "1.0.0", displayName: "Notes agent", packages: [pkg.id],
      tools: [{ packageId: pkg.id, name: tool.descriptor.definition.name, enabled: true, riskClass: "external", approvalMode: "automatic" }] });
    assert.equal(createPackageCapabilityCatalog(service.loaded).get("notes-agent")?.grants[0].approvalMode, "none");
    const oldTool = service.loaded.tools.find(value => value.descriptor.definition.name === tool.descriptor.definition.name)!;
    assert.equal((await invoke(oldTool)).status, "completed");
    assert.equal(calls, 1);
    expected = "Bearer replacement-fixture-secret";
    await service.saveConnection(service.repository.read().revision, record, { kind: "personal-access-token", token: "replacement-fixture-secret" });
    assert.equal(await service.credentials!.get(originalCredentialId, service.credentialBinding(record)), null);
    assert.equal((await invoke(oldTool)).status, "failed");
    assert.equal(calls, 1, "Old admitted authority must stop before remote tools/call");
    const orphan = await service.credentials!.put(service.credentialBinding(record), { kind: "personal-access-token", token: "interrupted-setup-orphan" });
    await service.close();
    service = await CapabilityManagement.create(options);
    assert.equal(await service.credentials!.get(orphan.id, service.credentialBinding(record)), null);
    assert.ok(createPackageCapabilityCatalog(service.loaded).get("notes-agent"));
    assert.equal((await invoke(service.loaded.tools[0])).status, "completed");
    assert.equal(calls, 2);
    await service.connectionAction(record.ref, "revoke");
    assert.equal((await invoke(service.loaded.tools[0] ?? oldTool)).status, "failed");
    assert.equal(calls, 2);
  } finally { await service.close(); }
});

test("OAuth lifecycle deletes the retired resource grant and allows connection removal", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-managed-oauth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = await CapabilityManagement.create({ root, environment: { AGENTLAB_CREDENTIAL_KEY_HEX: randomBytes(32).toString("hex") } });
  try {
    const connection = { ref: "conn_oauth", displayName: "OAuth notes", provider: "Notes", owner: "local-workspace" as const, resource: "http://127.0.0.1:1/first", scopes: ["notes.read"], enabled: true,
      auth: { kind: "oauth" as const, clientId: "fixture-client", redirectUri: "http://localhost:4322/callback", authorizationEndpoint: "http://127.0.0.1:1/authorize", tokenEndpoint: "http://127.0.0.1:1/token" } };
    await service.saveConnection(0, connection);
    const oldBinding = service.credentialBinding(connection, "oauth-grant");
    const oldId = "oauth_" + createHash("sha256").update(JSON.stringify(oldBinding)).digest("hex").slice(0, 40);
    const tokens = { kind: "oauth-tokens" as const, accessToken: "retired-grant-fixture", refreshToken: "retired-refresh-fixture", expiresAt: "2099-12-01T00:00:00Z", scopes: ["notes.read"] };
    await service.credentials!.upsert(oldId, oldBinding, tokens);
    assert.equal((await service.view()).connections[0].credential.present, true);
    assert.equal((await service.view()).connections[0].credential.expiresAt, tokens.expiresAt);
    const changed = { ...connection, resource: "http://127.0.0.1:1/second" };
    await service.saveConnection(service.repository.read().revision, changed);
    assert.equal(await service.credentials!.get(oldId, oldBinding), null);
    assert.equal((await service.view()).connections[0].credential.present, false);
    const newBinding = service.credentialBinding(changed, "oauth-grant");
    const newId = "oauth_" + createHash("sha256").update(JSON.stringify(newBinding)).digest("hex").slice(0, 40);
    await service.credentials!.upsert(newId, newBinding, tokens);
    await service.remove(service.repository.read().revision, "connections", connection.ref);
    assert.deepEqual(service.repository.read().connections, []);
    assert.equal(await service.credentials!.get(newId, newBinding), null);
  } finally { await service.close(); }
});

test("catalog discovery applies the network policy instead of following provider redirects", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-managed-network-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let redirectedRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/redirect") { response.writeHead(307, { location: "/mcp" }); response.end(); return; }
    redirectedRequests++;
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: input.id,
      result: { tools: [{ name: "list_notes", description: "List notes", inputSchema: { type: "object", properties: {} } }] } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const service = await CapabilityManagement.create({ root, environment: {} });
  try {
    await service.savePackage(0, { id: "redirected-notes", version: "1.0.0", source: "mcp", endpoint: "http://127.0.0.1:" + (server.address() as { port: number }).port + "/redirect" });
    assert.equal(redirectedRequests, 0, "Managed discovery must reject redirects before another destination receives a request");
    assert.ok(service.loaded.packages[0].unavailableReason);
  } finally { await service.close(); }
});

test("restart reconciles an OAuth grant after metadata publication interrupted its cleanup", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-managed-oauth-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { root, environment: { AGENTLAB_CREDENTIAL_KEY_HEX: randomBytes(32).toString("hex") } };
  let service = await CapabilityManagement.create(options);
  try {
    const connection = { ref: "conn_recovery", displayName: "Recovery", provider: "Notes", owner: "local-workspace" as const, resource: "http://127.0.0.1:1/original", scopes: [], enabled: true,
      auth: { kind: "oauth" as const, clientId: "fixture-client", redirectUri: "http://localhost:4322/callback", authorizationEndpoint: "http://127.0.0.1:1/authorize", tokenEndpoint: "http://127.0.0.1:1/token" } };
    await service.saveConnection(0, connection);
    const binding = service.credentialBinding(connection, "oauth-grant");
    const id = "oauth_" + createHash("sha256").update(JSON.stringify(binding)).digest("hex").slice(0, 40);
    await service.credentials!.upsert(id, binding, { kind: "oauth-tokens", accessToken: "retired-crash-token", refreshToken: null, expiresAt: "2099-12-01T00:00:00Z", scopes: [] });
    // This is the durable state left when the process stops after committing
    // metadata and before reload drains the old connection and reconciles secrets.
    await service.repository.mutate(service.repository.read().revision, draft => { draft.connections[0].resource = "http://127.0.0.1:1/replacement"; });
    await service.close();
    service = await CapabilityManagement.create(options);
    assert.equal(await service.credentials!.get(id, binding), null);
    assert.equal((await service.view()).connections[0].credential.present, false);
  } finally { await service.close(); }
});

test("legacy migration preserves unchanged bindings and discards tokens for changed resources", async t => {
  const root = await mkdtemp(join(tmpdir(), "lab-legacy-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32), legacyRoot = join(root, "legacy");
  const options = { root: join(root, "managed"), legacyOAuthRoot: legacyRoot, environment: { AGENTLAB_OAUTH_SECRET_KEY_HEX: key.toString("hex") } };
  let service = await CapabilityManagement.create(options);
  const legacy = new EncryptedFileSecretStore(legacyRoot, key);
  try {
    const original = { ref: "conn_changed", displayName: "Changed", provider: "Notes", owner: "local-workspace" as const, resource: "http://127.0.0.1:1/original", scopes: [], enabled: true,
      auth: { kind: "oauth" as const, clientId: "fixture-client", redirectUri: "http://localhost:4322/callback", authorizationEndpoint: "http://127.0.0.1:1/authorize", tokenEndpoint: "http://127.0.0.1:1/token" } };
    await service.saveConnection(0, original);
    await service.saveConnection(service.repository.read().revision, { ...original, ref: "conn_unchanged" });
    await service.repository.mutate(service.repository.read().revision, draft => { draft.connections.find(connection => connection.ref === original.ref)!.resource = "http://127.0.0.1:1/replacement"; });
    await service.close();
    const tokens = { accessToken: "legacy-access-fixture", refreshToken: null, expiresAt: "2099-12-01T00:00:00Z", scopes: [] };
    await legacy.write("conn_changed", tokens); await legacy.write("conn_unchanged", tokens);
    service = await CapabilityManagement.create(options);
    const connections = (await service.view()).connections;
    assert.equal(connections.find(connection => connection.ref === "conn_changed")!.credential.present, false);
    assert.equal(connections.find(connection => connection.ref === "conn_unchanged")!.credential.present, true);
    assert.equal(await legacy.read("conn_changed"), null);
    assert.equal(await legacy.read("conn_unchanged"), null);
  } finally { await service.close(); }
});
