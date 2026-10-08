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
