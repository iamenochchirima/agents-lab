import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTaskService } from "../../src/capabilities/integrations/task-service/service.js";

test("controlled MCP reads and revisioned HTTP edits preserve records across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-task-service-"));
  let service = await createTaskService({ port: 0, stateRoot: root });
  const namespace = "cap-service-contract";
  async function lookup(id: number) {
    const response = await fetch(`${service.app.listeningOrigin}/mcp`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: {
        name: "release.lookup", arguments: { namespace, key: "cedar" },
      } }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { id: number; result: { content: { text: string }[]; structuredContent: { owner: string | null; revision: number; approvedDate: string; dependency: string; status: string } } };
    assert.equal(body.id, id);
    assert.deepEqual(JSON.parse(body.result.content[0]!.text), body.result.structuredContent);
    return body.result.structuredContent;
  }
  async function assign(expectedRevision: number, owner: string) {
    return fetch(`${service.app.listeningOrigin}/records`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace, key: "cedar", expectedRevision, owner, status: "in_progress" }),
    });
  }
  try {
    const initial = await lookup(1);
    assert.equal(initial.owner, null);
    assert.equal(initial.revision, 1);
    const edit = await assign(initial.revision, "Morgan");
    assert.equal(edit.status, 200);
    const assigned = await lookup(2);
    assert.deepEqual(assigned, { ...initial, owner: "Morgan", status: "in_progress", revision: 2 });
    const stale = await assign(initial.revision, "Avery");
    assert.equal(stale.status, 409);
    assert.deepEqual(await lookup(3), assigned);

    await service.close();
    service = await createTaskService({ port: 0, stateRoot: root });
    assert.deepEqual(await lookup(4), assigned);
    const correction = await assign(assigned.revision, "Avery");
    assert.equal(correction.status, 200);
    assert.deepEqual(await lookup(5), { ...assigned, owner: "Avery", revision: 3 });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("fictional support adjustments enforce revision, policy and provider idempotency across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-support-service-"));
  let service = await createTaskService({ port: 0, stateRoot: root });
  const namespace = "cap-support-contract";
  const adjustment = { namespace, orderId: "order-cedar", expectedRevision: 1, amountCents: 500, reason: "late_delivery" };
  const apply = (body = adjustment) => fetch(`${service.app.listeningOrigin}/support/adjustments`, { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "support-operation-a" }, body: JSON.stringify(body) });
  try {
    assert.equal((await service.support.order(namespace)).adjustmentCents, 0);
    assert.equal((await apply()).status, 200);
    assert.equal((await service.support.order(namespace)).adjustmentCents, 500);
    assert.equal((await apply()).status, 200);
    assert.equal((await service.support.order(namespace)).adjustments.length, 1);
    assert.equal((await apply({ ...adjustment, amountCents: 600 })).status, 409);
    await service.close(); service = await createTaskService({ port: 0, stateRoot: root });
    assert.equal((await apply()).status, 200);
    assert.equal((await service.support.order(namespace)).revision, 2);
    const stale = await fetch(`${service.app.listeningOrigin}/support/adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(adjustment) });
    assert.equal(stale.status, 409);
    const tooMuch = await fetch(`${service.app.listeningOrigin}/support/adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...adjustment, expectedRevision: 2, amountCents: 600 }) });
    assert.equal(tooMuch.status, 422);
    assert.equal((await service.support.order(namespace)).adjustments.length, 1);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test("configured support profile discovers real connected tools and requires exact invocation review", async () => {
  const { createDocumentService } = await import("../../src/capabilities/integrations/document-service/service.js");
  const { loadCapabilityPackages } = await import("../../src/capabilities/extensions/packages.js");
  const { ConnectionManager } = await import("../../src/capabilities/integrations/connections.js");
  const { createPackageCapabilityCatalog } = await import("../../src/capabilities/extensions/catalog.js");
  const { readFile, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "agentlab-support-package-"));
  const token = "fictional-provider-package-token";
  const service = await createTaskService({ port: 0, stateRoot: join(root, "business") });
  const documents = await createDocumentService({ port: 0, token, stateRoot: join(root, "documents") });
  const previous = process.env.AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION;
  const closeCallbacks = new Set<() => Promise<void>>();
  try {
    const configuration = JSON.parse(await readFile(join(process.cwd(), "capability-packages/customer-support.json"), "utf8"));
    const address = documents.app.server.address(); assert.ok(address && typeof address !== "string");
    configuration.packages[0].endpoint = `http://127.0.0.1:${address.port}/mcp`;
    configuration.packages[1].root = join(process.cwd(), "capability-packages/skills");
    configuration.packages[2].endpoint = `${service.app.listeningOrigin}/mcp`;
    configuration.packages[3].baseUrl = service.app.listeningOrigin;
    process.env.AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION = `Bearer ${token}`;
    const path = join(root, "packages.json"); await writeFile(path, JSON.stringify(configuration));
    configuration.connections[0].resource = service.app.listeningOrigin;
    configuration.connections[1].resource = configuration.packages[0].endpoint;
    await writeFile(path, JSON.stringify(configuration));
    const connections = await ConnectionManager.create(configuration.connections);
    const loaded = await loadCapabilityPackages(path, { connections });
    const admission = createPackageCapabilityCatalog(loaded).resolve("support-agent");
    assert.equal(admission.resolution.grants.find(value => value.manifest.id === "support_adjust")?.approval, "invocation_required");
    for (const tool of loaded.tools) if (tool.close) closeCallbacks.add(tool.close);
    assert.equal(loaded.tools.find(tool => tool.descriptor.definition.name === "support_adjust")!.descriptor.definition.approvalMode, "invocation");
    assert.equal(loaded.profiles.find(profile => profile.id === "support-agent")!.grants.length, 7);
    const lookup = loaded.tools.find(tool => tool.descriptor.definition.name === "support_order")!;
    const result = await lookup.implementation.execute({ namespace: "cap-package-check" }, { runId: "package-check", turnId: "package-check", signal: new AbortController().signal });
    assert.match(result, /"adjustmentCents":0/);
  } finally {
    if (previous === undefined) delete process.env.AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION; else process.env.AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION = previous;
    await Promise.allSettled([...closeCallbacks].map(close => close()));
    await service.close(); await documents.close(); await rm(root, { recursive: true, force: true });
  }
});
