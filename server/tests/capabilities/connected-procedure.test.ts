import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTaskService } from "../../src/capabilities/integrations/task-service/service.js";
import { createProcedureService } from "../../src/capabilities/integrations/procedure-service/service.js";
import { loadCapabilityPackages } from "../../src/capabilities/extensions/packages.js";
import { createPackageCapabilityCatalog } from "../../src/capabilities/extensions/catalog.js";
import { ConnectionManager } from "../../src/capabilities/integrations/connections.js";
import { ToolRegistry } from "../../src/capabilities/tools/registry.js";

test("skill resource executes through an authorized connected provider, never the loader", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-procedure-"));
  const business = await createTaskService({port: 0, stateRoot: join(root, "business")});
  const token = "fictional-connected-procedure-token";
  const service = await createProcedureService({port: 0, token, businessUrl: business.app.listeningOrigin});
  const prior = process.env.AGENTLAB_PROCEDURE_PROVIDER_AUTHORIZATION;
  const closes = new Set<() => Promise<void>>();
  try {
    const namespace = "cap-procedure-contract";
    const edit = await fetch(`${business.app.listeningOrigin}/support/adjustments`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({namespace, orderId: "order-cedar", expectedRevision: 1, amountCents: 500, reason: "late_delivery"})});
    assert.equal(edit.status, 200);
    const config = JSON.parse(await readFile(join(process.cwd(), "capability-packages/execution.json"), "utf8"));
    config.packages[0].root = join(process.cwd(), "capability-packages/execution-skills");
    config.packages[1].endpoint = `${service.app.listeningOrigin}/mcp`;
    config.connections[0].resource = config.packages[1].endpoint;
    process.env.AGENTLAB_PROCEDURE_PROVIDER_AUTHORIZATION = `Bearer ${token}`;
    const path = join(root, "config.json"); await writeFile(path, JSON.stringify(config));
    const connections = await ConnectionManager.create(config.connections, {stateRoot: join(root, "connections")});
    const loaded = await loadCapabilityPackages(path, {connections});
    for (const tool of loaded.tools) if (tool.close) closes.add(tool.close);
    const catalog = createPackageCapabilityCatalog(loaded);
    assert.deepEqual(catalog.get("business-summary-agent")!.supportedVariants, ["mastra/baseline", "langgraph/baseline", "temporal/baseline", "restate/baseline", "vercel-workflows/baseline"]);
    assert.deepEqual(catalog.get("business-summary-agent")!.policy.allowedConnectionRefs, ["conn_procedures_local"]);
    const registry = new ToolRegistry({enabledNames: loaded.tools.map(tool => tool.descriptor.definition.name)});
    for (const tool of loaded.tools) registry.register(tool.implementation);
    let ordinal = 0;
    async function execute(name: string, argumentsValue: Record<string, unknown>) {
      const validated = registry.validateCall({name, arguments: argumentsValue, toolCallId: `procedure-${++ordinal}`, round: ordinal});
      assert.equal(validated.accepted, true); assert.equal(registry.authorize(validated.call).allowed, true);
      return registry.execute(validated, {runId: "procedure-contract", turnId: "procedure-contract", signal: new AbortController().signal});
    }
    const skill = await execute("execution-procedures_load_skill", {name: "adjustment-summary"});
    assert.match(JSON.parse(skill.content).instructions, /procedures_execute/);
    assert.match(JSON.parse(skill.content).instructions, /Reading the script does not execute/);
    const resource = await execute("execution-procedures_read_skill_resource", {name: "adjustment-summary", path: "scripts/summary.json"});
    const script = JSON.parse(resource.content);
    assert.equal(script.encoding, "utf8");
    const result = await execute("procedures_execute", {namespace, script: script.content, scriptDigest: script.digest});
    assert.equal(result.status, "completed");
    const summary = result.structuredContent as {summary: {netTotalCents: number; revision: number}; execution: {digest: string; stepCount: number}};
    assert.equal(summary.summary.netTotalCents, 4500);
    assert.equal(summary.summary.revision, 2);
    assert.equal(summary.execution.digest, script.digest);
    assert.equal(summary.execution.stepCount, 3);
    const unsafe = await execute("procedures_execute", {namespace, script: "require('child_process').exec('anything')", scriptDigest: script.digest});
    assert.equal(unsafe.status, "failed");
    const denied = new ToolRegistry({enabledNames: ["execution-procedures_load_skill"]});
    for (const tool of loaded.tools) denied.register(tool.implementation);
    assert.equal(denied.authorize({name: "procedures_execute", arguments: {}, toolCallId: "denied-script", round: 1}).allowed, false);
    assert.equal((await business.support.order(namespace)).adjustments.length, 1);
    assert.equal(loaded.tools.find(tool => tool.descriptor.definition.name === "procedures_execute")!.descriptor.connection!.ref, "conn_procedures_local");
    await connections.revoke("conn_procedures_local");
    const revoked = await execute("procedures_execute", {namespace, script: script.content, scriptDigest: script.digest});
    assert.equal(revoked.status, "failed");
    assert.equal((await connections.summary("conn_procedures_local")).status, "revoked");
  } finally {
    if (prior === undefined) delete process.env.AGENTLAB_PROCEDURE_PROVIDER_AUTHORIZATION; else process.env.AGENTLAB_PROCEDURE_PROVIDER_AUTHORIZATION = prior;
    await Promise.allSettled([...closes].map(close => close())); await service.close(); await business.close(); await rm(root, {recursive: true, force: true});
  }
});
