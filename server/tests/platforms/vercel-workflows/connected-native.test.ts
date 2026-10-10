import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import Fastify from "fastify";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../../../src/capabilities/context/index.js";
import { CapabilityCatalog, type CapabilityProfile } from "../../../src/capabilities/catalog.js";
import { contribution, objectSchema } from "../../../src/capabilities/extensions/package-utils.js";
import { CapabilityHost } from "../../../src/capabilities/extensions/host.js";
import { InvocationReviewStore } from "../../../src/capabilities/reviews/store.js";
import { RunEvidenceStore } from "../../../src/control-plane/application/evidence-store.js";
import { RunService, type RunView } from "../../../src/control-plane/application/run-service.js";
import { PlatformRegistry } from "../../../src/control-plane/application/platform-registry.js";
import { loadServerConfig } from "../../../src/control-plane/bootstrap/config.js";
import { loadVercelWorkflowsConfig } from "../../../src/platforms/vercel-workflows/config.js";
import { VercelWorkflowsBaselineRunner } from "../../../src/platforms/vercel-workflows/runner-adapter/vercel-workflows-runner.js";
import { VercelWorkflowsPlatformService } from "../../../src/platforms/vercel-workflows/service/platform-service.js";
import type { CapabilityManifest } from "../../../src/capabilities/contracts.js";
import { createEffectRecoveryFixture } from "../../../src/evals/effect-recovery-fixture.js";

/** Actual local World and shared authenticated host, deterministic model choices.
 * Every file and effect is isolated in temporary storage; no paid model call. */
test("native connected Workflow gates effects, restores pending review, renews and stops on lost acknowledgement", { timeout: 240_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-vercel-connected-"));
  const key = "b".repeat(64), keyFile = join(directory, "host.key");
  await writeFile(keyFile, key, { mode: 0o600 });
  const previous = { url: process.env.AGENTLAB_CAPABILITY_HOST_URL, key: process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE, context: process.env.AGENTLAB_CONTEXT_ROOT };
  process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = keyFile;
  process.env.AGENTLAB_CONTEXT_ROOT = join(directory, "sessions");
  const evidence = new RunEvidenceStore(join(directory, "runs"));
  let clock = Date.now();
  const reviews = new InvocationReviewStore(join(directory, "runs"), () => clock);
  const provider = await createEffectRecoveryFixture();
  let effects = 0;
  const original = contribution({ id: "unfamiliar", version: "1.0.0" }, "record", "Save fictional record", objectSchema({ value: { type: "string" } }, ["value"]), "write", async (args, context) => {
    effects++;
    if (args.value === "lose-ack") {
      try { await provider.create(context.runId, "disposable", context.signal); }
      catch { const error = new Error("Committed effect lost acknowledgement"); error.name = "API_OUTCOME_UNKNOWN"; throw error; }
    }
    return JSON.stringify({ saved: args.value });
  }, "a".repeat(64));
  const definition = { ...original.descriptor.definition, approvalMode: "invocation" as const };
  const tool = { ...original, descriptor: { ...original.descriptor, definition }, implementation: { ...original.implementation, definition } };
  const manifest: CapabilityManifest = { schemaVersion: 1, id: definition.name, version: "1.0.0", kind: "tool", displayName: "Fictional record", description: definition.description,
    risk: "write", operations: ["execute"], inputSchema: definition.inputSchema as CapabilityManifest["inputSchema"], requiredScopes: [], source: { kind: "package", ref: "fixture", digest: "a".repeat(64) } };
  const profile: CapabilityProfile = { id: "fixture", version: "1.0.0", displayName: "Fixture", description: "Isolated native test",
    policy: { schemaVersion: 1, policyId: "fixture", version: "1.0.0", allowedCapabilityIds: [definition.name], allowedRiskClasses: ["write"], requiredApprovalRiskClasses: ["write"], allowedConnectionRefs: [], maxTimeoutMs: 30_000, maxInputBytes: 65_536, maxOutputBytes: 262_144 },
    grants: [{ schemaVersion: 1, capabilityId: definition.name, version: "1.0.0", enabled: true, allowedOperations: ["execute"], approvalMode: "invocation", timeoutMs: 30_000, maxInputBytes: 65_536, maxOutputBytes: 262_144 }] };
  const catalog = new CapabilityCatalog([manifest], [profile], undefined, undefined, { connectedEnabled: true, toolDescriptors: [tool.descriptor] });
  const host = new CapabilityHost(evidence, [tool], key, undefined, reviews);
  const app = Fastify(); host.register(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address(); assert.ok(address && typeof address !== "string");
  process.env.AGENTLAB_CAPABILITY_HOST_URL = `http://127.0.0.1:${address.port}`;
  const port = await freePort();
  const config = { ...loadVercelWorkflowsConfig({}), port, serviceUrl: `http://127.0.0.1:${port}`, dataDir: join(directory, "world") };
  let native = new VercelWorkflowsPlatformService({ config });
  const runner = new VercelWorkflowsBaselineRunner({ config, requestTimeoutMs: 10_000 });
  const service = new RunService({ config: loadServerConfig({ AGENTLAB_RUN_ROOT: join(directory, "runs"), AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake" }), evidence, reviews, capabilities: catalog, context: new ContextService(new ContextSessionStore(join(directory, "sessions")), new CharacterTokenEstimator()),
    renewReview: async (runId, requestId) => { const prior = await reviews.get(runId, requestId); const renewed = await host.prepare({ runId, turnId: prior.turnId, catalogRevision: prior.catalogRevision, call: prior.call }); assert.ok(renewed); return renewed; },
    registry: new PlatformRegistry([runner]) });
  try {
    await native.start();
    for (const choice of ["approve", "deny", "lose-ack"] as const) await t.test(choice, async () => {
      const before = effects;
      const created = await service.createRun({ platform: "vercel-workflows", variant: "baseline", task: { kind: "prompt", prompt: JSON.stringify([{ name: definition.name, arguments: { value: choice } }]) },
        model: { provider: "fake", model: "fake-tools", contextWindowTokens: 16384 }, capabilities: { profileId: profile.id, tools: { enabledNames: [definition.name], maxRounds: 3, maxCalls: 2 } } });
      const waiting = await waitFor(service, created.runId, view => view.status === "suspended");
      assert.equal(effects, before);
      assert.ok(waiting.events.some(event => event.kind === "WorkflowSuspended"));
      let pending = (await service.actions(created.runId))[0]!;
      if (choice === "approve") {
        await native.stop();
        native = new VercelWorkflowsPlatformService({ config });
        await native.start();
        const restored = await waitFor(service, created.runId, view => view.status === "suspended");
        assert.equal(restored.executionReference?.executionId, waiting.executionReference?.executionId);
        assert.deepEqual((restored.executionReference?.native.pendingReview as { requestId: string }).requestId, pending.requestId);
        clock += 24 * 60 * 60 * 1000 + 1;
        await service.renewAction(created.runId, pending.requestId);
        await waitFor(service, created.runId, view => view.events.some(event => event.kind === "WorkflowSuspended" && event.payload.revision === 2));
        pending = (await service.actions(created.runId))[0]!;
        assert.equal(pending.revision, 2);
        assert.equal(effects, before);
      }
      const resumeUrl = `${native.address}/runs/${waiting.executionReference!.native.workflowRunId}?resume=1`;
      const stale = await fetch(resumeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        kind: "invocation_review", requestId: pending.requestId, toolCallId: pending.call.toolCallId,
        revision: pending.revision + 2, decisionId: randomUUID(), decision: "approved",
      }) });
      assert.equal(stale.status, 409);
      assert.equal(effects, before);
      const decision = { requestId: pending.requestId, revision: pending.revision, argumentDigest: pending.argumentDigest, decisionId: randomUUID(), decision: choice === "deny" ? "denied" as const : "approved" as const };
      await service.decideAction(created.runId, pending.requestId, decision);
      // The shared API retries the same recorded decision, never a fresh call.
      await service.decideAction(created.runId, pending.requestId, decision);
      const completed = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(effects, before + (choice === "deny" ? 0 : 1));
      if (choice === "lose-ack") {
        assert.equal(completed.result?.status, "reconciliation_required");
        assert.equal(provider.snapshot(created.runId).attempts, 1);
        assert.equal(provider.snapshot(created.runId).effectCount, 1);
      } else {
        assert.equal(completed.result?.status, "completed", JSON.stringify(completed.result));
        assert.match(completed.result?.output ?? "", choice === "deny" ? /TOOL_APPROVAL_DENIED/ : /approve/);
      }
    });
    await t.test("unreachable host fails before dispatch with a safe cause", async () => {
      await app.close();
      const before = effects;
      const created = await service.createRun({ platform: "vercel-workflows", variant: "baseline", task: { kind: "prompt", prompt: JSON.stringify([{ name: definition.name, arguments: { value: "host-failure" } }]) },
        model: { provider: "fake", model: "fake-tools", contextWindowTokens: 16384 }, capabilities: { profileId: profile.id, tools: { enabledNames: [definition.name], maxRounds: 3, maxCalls: 2 } } });
      const completed = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(effects, before);
      assert.equal(completed.status, "failed");
      assert.equal(completed.result?.error?.code, "ACTION_REVIEW_PREPARATION_FAILED");
      assert.equal(completed.result?.error?.failureKind, "pre_dispatch");
      assert.equal(JSON.stringify(completed.result).includes(keyFile), false);
      assert.equal(completed.executionReference?.native.nativeStatus, "completed");
    });
  } finally {
    await native.stop(); await app.close(); await provider.close();
    if (previous.url === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_URL; else process.env.AGENTLAB_CAPABILITY_HOST_URL = previous.url;
    if (previous.key === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE; else process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = previous.key;
    if (previous.context === undefined) delete process.env.AGENTLAB_CONTEXT_ROOT; else process.env.AGENTLAB_CONTEXT_ROOT = previous.context;
    await rm(directory, { recursive: true, force: true });
  }
});
async function waitFor(service: RunService, runId: string, predicate: (view: RunView) => boolean): Promise<RunView> {
  const deadline = Date.now() + 65_000;
  let latest: RunView;
  do { latest = await service.getRun(runId); if (predicate(latest)) return latest; if (latest.result) throw new Error(`Unexpected terminal result: ${JSON.stringify(latest.result)}`); await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for Workflow: ${JSON.stringify(latest!)}`);
}
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
