import assert from "node:assert/strict";
import { baselineExtensions, gradeExtension, type ExtensionInput, type ExtensionPlatform, type ExtensionObservation } from "../src/evals/extension-contracts.js";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createEffectRecoveryFixture } from "../src/evals/effect-recovery-fixture.js";
import { installedRuntimeVersions } from "../src/evals/runtime-versions.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { CapabilityCatalog, type CapabilityProfile } from "../src/capabilities/catalog.js";
import { contribution, objectSchema } from "../src/capabilities/extensions/package-utils.js";
import { CapabilityHost } from "../src/capabilities/extensions/host.js";
import { InvocationReviewStore } from "../src/capabilities/reviews/store.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";
import { RestateBaselineRunner } from "../src/platforms/restate/runner-adapter/restate-runner.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";
import { MastraBaselineRunner } from "../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { loadRestateConfig } from "../src/platforms/restate/config.js";
import { normalizeMastraPrompt, scriptedMastraModel, type CapturedRequest } from "../src/evals/mastra-scripted-model.js";
import type { PlatformRunner } from "../src/control-plane/ports/runner.js";
import type { CapabilityManifest } from "../src/capabilities/contracts.js";

/** Scripted choices through actual native SDKs/workers. Requires local Temporal
 * and Restate servers; starts its own workers/services and authenticated host.
 * Durable run evidence is retained separately from real-model acceptance. */
test("native invocation review pauses before effects and resumes the original call", {
  skip: process.env.AGENTLAB_RUN_NATIVE_INVOCATION_REVIEW !== "1", timeout: 180_000,
}, async t => {
  const startedAt = new Date().toISOString();
  const metadata = { revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), versions: await installedRuntimeVersions(), startedAt, model: { provider: "fake", model: "fake-eval-behaviour" }, controls: { maxCalls: 3, maxRounds: 4, reviewRenewals: 2, recovery: "explicit-provider-key-reconciliation", fixtureVersion: "effect-recovery-v1" } };
  const effectProvider = await createEffectRecoveryFixture();
  const id = `native-review-${randomUUID()}`;
  const root = resolve("../lab/runs/.review-proof", id);
  const contextRoot = join(root, "sessions");
  const secrets = await mkdtemp(join(tmpdir(), "agentlab-review-runtime-"));
  await mkdir(root, { recursive: true });
  const key = "b".repeat(64), keyFile = join(secrets, "host.key");
  await writeFile(keyFile, key, { mode: 0o600 });
  const prior = { url: process.env.AGENTLAB_CAPABILITY_HOST_URL, key: process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE };
  process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = keyFile;
  let evidence = new RunEvidenceStore(root);
  let reviewClock = Date.now();
  let reviews = new InvocationReviewStore(root, () => reviewClock);
  let sessions = new ContextSessionStore(contextRoot);
  let effects = 0;
  const captures: CapturedRequest[] = [];
  const original = contribution({ id: "review-test", version: "1.0.0" }, "assign", "Assign a fictional owner",
    objectSchema({ owner: { type: "string" } }, ["owner"]), "write", async (args, context) => {
      effects++;
      if (args.owner === "lose-ack") {
        try { await effectProvider.create(context.runId, "disposable-ticket", context.signal); }
        catch { const error = new Error("External ticket committed but acknowledgement was lost"); error.name = "API_OUTCOME_UNKNOWN"; throw error; }
        throw new Error("Expected controlled first acknowledgement loss.");
      }
      return JSON.stringify({ owner: args.owner, saved: true });
    }, "a".repeat(64));
  let reads = 0;
  const read = contribution({ id: "review-test", version: "1.0.0" }, "read", "Read a fictional owner", objectSchema({}, []), "read", async () => { reads++; return JSON.stringify({ currentOwner: "Robin" }); }, "a".repeat(64));
  const definition = { ...original.descriptor.definition, approvalMode: "invocation" as const };
  const tool = { ...original, descriptor: { ...original.descriptor, definition }, implementation: { ...original.implementation, definition } };
  const manifest: CapabilityManifest = { schemaVersion: 1, id: definition.name, version: "1.0.0", kind: "tool",
    displayName: "Assign owner", description: definition.description, risk: "write", operations: ["execute"],
    inputSchema: definition.inputSchema as CapabilityManifest["inputSchema"], requiredScopes: [],
    source: { kind: "package", ref: "review-test", digest: "a".repeat(64) } };
  const profile: CapabilityProfile = { id: "review-agent", version: "1.0.0", displayName: "Review agent", description: "Native review proof",
    policy: { schemaVersion: 1, policyId: "review-agent", version: "1.0.0", allowedCapabilityIds: [definition.name, read.descriptor.definition.name],
      allowedRiskClasses: ["read", "write"], requiredApprovalRiskClasses: ["write"], allowedConnectionRefs: [],
      maxTimeoutMs: 30_000, maxInputBytes: 65_536, maxOutputBytes: 262_144 },
    grants: [{ schemaVersion: 1, capabilityId: definition.name, version: "1.0.0", enabled: true, allowedOperations: ["execute"],
      approvalMode: "invocation", timeoutMs: 30_000, maxInputBytes: 65_536, maxOutputBytes: 262_144 }, { schemaVersion: 1, capabilityId: read.descriptor.definition.name, version: "1.0.0", enabled: true, allowedOperations: ["execute"], approvalMode: "none", timeoutMs: 30_000, maxInputBytes: 65_536, maxOutputBytes: 262_144 }] };
  const readManifest: CapabilityManifest = { ...manifest, id: read.descriptor.definition.name, displayName: "Read owner", description: read.descriptor.definition.description, risk: "read", inputSchema: read.descriptor.definition.inputSchema as CapabilityManifest["inputSchema"] };
  const modelFactory = (admitted: Parameters<typeof scriptedMastraModel>[0]) => admitted.task.prompt === "[mixed-review-batch]" ? mixedBatchModel(admitted, captures, definition.name, read.descriptor.definition.name) : scriptedMastraModel(admitted, captures);
  const catalog = new CapabilityCatalog([manifest, readManifest], [profile], undefined, undefined, { connectedEnabled: true, toolDescriptors: [tool.descriptor, read.descriptor] });
  let app = Fastify();
  let host = new CapabilityHost(evidence, [tool, read], key, sessions, reviews);
  host.register(app);
  const renewReview = async (runId: string, requestId: string) => {
    const previous = await reviews.get(runId, requestId);
    const renewed = await host.prepare({ runId, turnId: previous.turnId, catalogRevision: previous.catalogRevision, call: previous.call });
    assert.ok(renewed);
    return renewed;
  };
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  process.env.AGENTLAB_CAPABILITY_HOST_URL = `http://127.0.0.1:${address.port}`;
  const environment = { ...process.env, AGENTLAB_RUN_ROOT: root, AGENTLAB_CONTEXT_ROOT: contextRoot,
    AGENTLAB_TEMPORAL_TASK_QUEUE: id, AGENTLAB_TEMPORAL_ACTIVITY_TIMEOUT_MS: "30000", AGENTLAB_TEMPORAL_QUERY_TIMEOUT_MS: "2000",
    AGENTLAB_RESTATE_SERVICE_PORT: "29080", AGENTLAB_RESTATE_SERVICE_URL: "http://127.0.0.1:29080",
    AGENTLAB_RESTATE_INGRESS_URL: process.env.AGENTLAB_RESTATE_INGRESS_URL ?? "http://127.0.0.1:28080",
    AGENTLAB_RESTATE_ADMIN_URL: process.env.AGENTLAB_RESTATE_ADMIN_URL ?? "http://127.0.0.1:29070",
    AGENTLAB_LANGGRAPH_STATE_DIR: join(root, "langgraph"), AGENTLAB_LANGGRAPH_PORT: "22024",
    AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake" };
  const children: ChildProcess[] = [];
  const nativeProcesses = new Map<string, ChildProcess>();
  const runners: PlatformRunner[] = [];
  const reports: unknown[] = [];
  const effectObservations = new Map<string, ExtensionObservation[]>();
  const extensionObservations = new Map<string, ExtensionObservation[]>();
  const observe = (platform: string, checks: readonly string[], runId: string) => {
    const observations = extensionObservations.get(platform) ?? [];
    for (const check of checks) observations.push({ check, observed: true, sources: [`${root}/${runId}/events.jsonl`, `${root}/summary.json`] });
    extensionObservations.set(platform, observations);
  };
  const selected = new Set((process.env.AGENTLAB_REVIEW_PLATFORMS ?? "mastra,temporal,langgraph,restate").split(","));
  try {
    const config = loadServerConfig(environment, resolve(".."));
    if (selected.has("mastra")) runners.push(new MastraBaselineRunner({ contextRoot, modelFactory }));
    if (selected.has("temporal")) {
      const worker = start(process.execPath, [resolve("dist/src/platforms/temporal/runner-adapter/worker-entry.js")], environment);
      children.push(worker); nativeProcesses.set("temporal", worker);
      runners.push(await TemporalBaselineRunner.connect(config));
    }
    if (selected.has("langgraph")) {
      const platformRoot = resolve("src/platforms/langgraph");
      const worker = start(process.env.AGENTLAB_LANGGRAPH_PYTHON ?? join(platformRoot, ".local311/bin/python"),
        ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", "22024"], environment, platformRoot);
      children.push(worker); nativeProcesses.set("langgraph", worker);
      await ready("http://127.0.0.1:22024/health");
      runners.push(LangGraphBaselineRunner.fromOptions({ serviceUrl: "http://127.0.0.1:22024", contextRoot, timeoutMs: 30000, maxAttempts: 1 }));
    }
    if (selected.has("restate")) {
      const worker = start(process.execPath, [resolve("dist/src/platforms/restate/service-entry.js")], environment);
      children.push(worker); nativeProcesses.set("restate", worker);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await fetch(`${environment.AGENTLAB_RESTATE_ADMIN_URL}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: environment.AGENTLAB_RESTATE_SERVICE_URL, force: true }) });
      assert.ok(response.ok, await response.text());
      runners.push(await RestateBaselineRunner.connect(loadRestateConfig(environment)));
    }
    let service = new RunService({ config, evidence, reviews, renewReview, capabilities: catalog,
      context: new ContextService(sessions, new CharacterTokenEstimator()), registry: new PlatformRegistry(runners) });
    for (const runner of runners) await t.test(runner.platform, async () => {
      const before = effects;
      const prompt = `[eval-behaviour:${Buffer.from(JSON.stringify({ action: "tool", toolName: definition.name, input: { owner: "Avery" } })).toString("base64url")}]`;
      const created = await service.createRun({ platform: runner.platform, variant: "baseline", task: { kind: "prompt", prompt },
        model: { provider: "fake", model: "fake-eval-behaviour", contextWindowTokens: 16_384 },
        capabilities: { profileId: profile.id, tools: { enabledNames: [], maxCalls: 3, maxRounds: 4 } } });
      const waiting = await waitFor(service, created.runId, view => view.status === "suspended");
      const initialModelRequests = waiting.events.filter(event => event.kind === "ModelRequested").length;
      assert.equal(effects, before, "Suspension must precede provider dispatch");
      assert.equal(waiting.result, null);
      // Restart the actual policy endpoint and its durable projections while
      // each native runtime retains the same suspended call.
      await app.close();
      evidence = new RunEvidenceStore(root);
      reviews = new InvocationReviewStore(root, () => reviewClock);
      sessions = new ContextSessionStore(contextRoot);
      app = Fastify();
      host = new CapabilityHost(evidence, [tool, read], key, sessions, reviews);
      host.register(app);
      await app.listen({ host: "127.0.0.1", port: address.port });
      service = new RunService({ config, evidence, reviews, renewReview, capabilities: catalog,
        context: new ContextService(sessions, new CharacterTokenEstimator()), registry: new PlatformRegistry(runners) });
      assert.equal((await service.actions(created.runId))[0]!.status, "pending");
      assert.equal(effects, before);
      const worker = nativeProcesses.get(runner.platform);
      if (runner.platform === "mastra") {
        const replacement = new MastraBaselineRunner({ contextRoot, modelFactory });
        const index = runners.indexOf(runner);
        runners[index] = replacement;
        service = new RunService({ config, evidence, reviews, renewReview, capabilities: catalog,
          context: new ContextService(sessions, new CharacterTokenEstimator()), registry: new PlatformRegistry(runners) });
        const recovered = await waitFor(service, created.runId, view => view.status === "suspended");
        assert.equal(recovered.executionReference?.executionId, waiting.executionReference?.executionId);
        assert.equal(effects, before);
      }
      if (worker) {
        await stop(worker);
        let replacement: ChildProcess;
        if (runner.platform === "langgraph") {
          const platformRoot = resolve("src/platforms/langgraph");
          replacement = start(process.env.AGENTLAB_LANGGRAPH_PYTHON ?? join(platformRoot, ".local311/bin/python"),
            ["-m", "uvicorn", "service.app:app", "--host", "127.0.0.1", "--port", "22024"], environment, platformRoot);
          await ready("http://127.0.0.1:22024/health");
        } else replacement = start(process.execPath, [resolve(runner.platform === "temporal"
          ? "dist/src/platforms/temporal/runner-adapter/worker-entry.js" : "dist/src/platforms/restate/service-entry.js")], environment);
        children.push(replacement); nativeProcesses.set(runner.platform, replacement);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const recovered = await waitFor(service, created.runId, view => view.status === "suspended" && view.projection.state === "current");
        assert.equal(recovered.executionReference?.executionId, waiting.executionReference?.executionId);
        assert.equal(effects, before);
      }
      let pending = (await service.actions(created.runId))[0]!;
      assert.equal(pending.status, "pending");
      assert.deepEqual(pending.displayArguments, { owner: "Avery" });
      const initialRequestId = pending.requestId;
      const initialCallId = pending.call.toolCallId;
      for (let renewal = 0; renewal < 2; renewal++) {
        reviewClock += 24 * 60 * 60 * 1000 + 1;
        assert.equal((await service.actions(created.runId))[0]!.status, "expired");
        await service.renewAction(created.runId, pending.requestId);
        const renewedWaiting = await waitFor(service, created.runId, view => {
          const acknowledged = view.events.find(event => event.source !== "control-plane" &&
            ["WorkflowSuspended", "InvocationReviewRenewed"].includes(event.kind) &&
            event.payload.requestId === initialRequestId && event.payload.revision === renewal + 2);
          return view.status === "suspended" && !!acknowledged && (runner.platform !== "langgraph" ||
            view.events.some(event => event.kind === "RunSuspended" && event.recordedSequence > acknowledged.recordedSequence));
        });
        pending = (await service.actions(created.runId))[0]!;
        assert.equal(pending.status, "pending");
        assert.equal(pending.revision, renewal + 2);
        assert.equal(pending.requestId, initialRequestId);
        assert.equal(pending.call.toolCallId, initialCallId);
        assert.equal(effects, before, "Renewal must not dispatch or repeat the model choice");
        assert.equal(renewedWaiting.events.filter(event => event.kind === "ModelRequested").length, initialModelRequests);
        if (runner.platform === "mastra") assert.equal(captures.filter(value => value.runId === created.runId).length, 1);
      }
      await service.decideAction(created.runId, pending.requestId, { requestId: pending.requestId, revision: pending.revision,
        argumentDigest: pending.argumentDigest, decisionId: randomUUID(), decision: "approved" });
      const completed = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(completed.status, "completed", JSON.stringify(completed.result));
      assert.equal(effects, before + 1);
      assert.match(completed.result?.output ?? "", /Avery/);
      assert.equal(completed.manifest.context.turnId, waiting.manifest.context.turnId);
      assert.equal(completed.executionReference?.executionId, waiting.executionReference?.executionId);
      const completedCalls = completed.events.filter(event => event.kind === "ToolExecutionCompleted");
      assert.equal(completedCalls.length, 1);
      assert.equal(completedCalls[0]!.payload.toolCallId, initialCallId);
      observe(runner.platform, ["noEffectBeforeApproval", "exactArgumentsRetained", "nativeWaitingRecovery", "hostWaitingRecovery", "sameNativeIdentity", "expiryNoEffect", "renewalNoRedispatch", "approvedSingleEffect"], created.runId);
      reports.push({ platform: runner.platform, runId: created.runId, status: completed.status, effects: effects - before, waitingRestart: !!worker || runner.platform === "mastra", apiHostRestart: true, reviewRenewals: 2 });
    });
    const mastra = runners.find(value => value.platform === "mastra");
    if (mastra) await t.test("mixed native batch gates each write independently", async () => {
      const before = effects, beforeReads = reads;
      const created = await service.createRun({ platform: "mastra", variant: "baseline", task: { kind: "prompt", prompt: "[mixed-review-batch]" },
        model: { provider: "fake", model: "fake-eval-behaviour", contextWindowTokens: 16_384 },
        capabilities: { profileId: profile.id, tools: { enabledNames: [], maxCalls: 3, maxRounds: 4 } } });
      await waitFor(service, created.runId, view => view.status === "suspended");
      assert.equal(effects, before);
      let pending = (await service.actions(created.runId)).find(value => value.status === "pending")!;
      assert.equal(pending.call.toolCallId, "mixed-write-first");
      await service.decideAction(created.runId, pending.requestId, { requestId: pending.requestId, revision: pending.revision,
        argumentDigest: pending.argumentDigest, decisionId: randomUUID(), decision: "approved" });
      await waitFor(service, created.runId, view => view.status === "suspended" && view.events.some(event =>
        event.kind === "WorkflowSuspended" && event.payload.toolCallId === "mixed-write-second"));
      assert.equal(effects, before + 1, "Approving one write must not approve another call in its batch");
      pending = (await service.actions(created.runId)).find(value => value.status === "pending")!;
      assert.equal(pending.call.toolCallId, "mixed-write-second");
      await service.decideAction(created.runId, pending.requestId, { requestId: pending.requestId, revision: pending.revision,
        argumentDigest: pending.argumentDigest, decisionId: randomUUID(), decision: "denied", reason: "Decline second write" });
      const completed = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(completed.status, "completed", JSON.stringify(completed.result));
      assert.equal(effects, before + 1);
      assert.equal(reads, beforeReads + 1);
      const requests = captures.filter(value => value.runId === created.runId);
      assert.equal(requests.length, 2, "Human decisions must resume the original model batch without repeated inference");
      const feedback = requests[1]!.messages.filter(value => value.role === "tool");
      assert.deepEqual(feedback.map(value => value.toolCallId).sort(), ["mixed-read", "mixed-write-first", "mixed-write-second"]);
      assert.match(feedback.find(value => value.toolCallId === "mixed-read")!.content, /Robin/);
      assert.match(feedback.find(value => value.toolCallId === "mixed-write-first")!.content, /First/);
      assert.match(feedback.find(value => value.toolCallId === "mixed-write-second")!.content, /TOOL_APPROVAL_DENIED/);
      reports.push({ platform: "mastra", outcome: "mixed-batch", runId: created.runId, effects: effects - before, reads: reads - beforeReads });
    });
    for (const effectRunner of runners) await t.test(`${effectRunner.platform} external effect acknowledgement recovery`, async () => {
      const before = effects;
      const prompt = `[eval-behaviour:${Buffer.from(JSON.stringify({ action: "tool", toolName: definition.name, input: { owner: "lose-ack" } })).toString("base64url")}]`;
      const created = await service.createRun({ platform: effectRunner.platform, variant: "baseline", task: { kind: "prompt", prompt },
        model: { provider: "fake", model: "fake-eval-behaviour", contextWindowTokens: 16_384 },
        capabilities: { profileId: profile.id, tools: { enabledNames: [], maxCalls: 3, maxRounds: 4 } } });
      await waitFor(service, created.runId, view => view.status === "suspended");
      const pending = (await service.actions(created.runId))[0]!;
      await service.decideAction(created.runId, pending.requestId, { requestId: pending.requestId, revision: pending.revision,
        argumentDigest: pending.argumentDigest, decisionId: randomUUID(), decision: "approved" });
      const failed = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(failed.status, effectRunner.platform === "langgraph" ? "reconciliation_required" : "failed");
      assert.equal(failed.result?.error?.failureKind, effectRunner.platform === "langgraph" ? "reconciliation" : "outcome_unknown");
      if (effectRunner.platform === "langgraph") assert.equal(failed.result?.error?.code, "LANGGRAPH_OUTCOME_UNKNOWN");
      assert.equal(effects, before + 1);
      const uncertainCalls = failed.events.filter(event => event.kind === "ToolExecutionUnknown");
      assert.equal(uncertainCalls.length, 1);
      assert.equal(uncertainCalls[0]!.payload.toolCallId, pending.call.toolCallId);
      if (effectRunner.platform === "mastra") assert.equal(captures.filter(value => value.runId === created.runId).length, 1, "The SDK must not call the model after an unknown effect");
      const committed = effectProvider.snapshot(created.runId);
      assert.equal(committed.effectCount, 1);
      assert.equal(committed.attempts, 1, "Unknown effect must not cause blind native redispatch");
      const receipt = await effectProvider.create(created.runId, "disposable-ticket");
      const recovered = effectProvider.snapshot(created.runId);
      assert.equal(receipt.id, committed.ticket?.id);
      assert.equal(recovered.effectCount, 1);
      assert.equal(recovered.attempts, 2);
      const providerPath = join(root, created.runId, "artifacts", "external-effect-recovery.json");
      await writeFile(providerPath, JSON.stringify({ fixtureVersion: "effect-recovery-v1", idempotencyContract: "same-key-same-content-replays-receipt; conflicting-content-rejects", committed, recovered, receipt }, null, 2));
      effectObservations.set(effectRunner.platform, ["externalEffectCommitted", "acknowledgementLost", "providerIdempotencyDeclared", "sameKeyRecovery", "independentSingleEffect", "recoveredReceipt"].map(check => ({ check, observed: true, sources: [providerPath, `${root}/${created.runId}/events.jsonl`] })));
      reports.push({ platform: effectRunner.platform, outcome: "unknown-reconciled", runId: created.runId, effects: 1, status: failed.status });
    });
    for (const reviewRunner of runners) for (const outcome of ["deny", "cancel"] as const) await t.test(`${reviewRunner.platform} ${outcome}`, async () => {
      const before = effects;
      const prompt = `[eval-behaviour:${Buffer.from(JSON.stringify({ action: "tool", toolName: definition.name, input: { owner: "Declined" } })).toString("base64url")}]`;
      const created = await service.createRun({ platform: reviewRunner.platform, variant: "baseline", task: { kind: "prompt", prompt },
        model: { provider: "fake", model: "fake-eval-behaviour", contextWindowTokens: 16_384 },
        capabilities: { profileId: profile.id, tools: { enabledNames: [], maxCalls: 3, maxRounds: 4 } } });
      await waitFor(service, created.runId, view => view.status === "suspended");
      const pending = (await service.actions(created.runId))[0]!;
      if (outcome === "deny") await service.decideAction(created.runId, pending.requestId, {
        requestId: pending.requestId, revision: pending.revision, argumentDigest: pending.argumentDigest,
        decisionId: randomUUID(), decision: "denied", reason: "Controlled rejection" });
      else await service.cancelRun(created.runId, "Cancel while awaiting review");
      const settled = await waitFor(service, created.runId, view => !!view.result);
      assert.equal(effects, before);
      assert.equal(settled.status, outcome === "deny" ? "completed" : "cancelled", JSON.stringify(settled.result));
      if (outcome === "deny") assert.match(settled.result?.output ?? "", reviewRunner.platform === "langgraph" ? /INVOCATION_DENIED/ : /TOOL_APPROVAL_DENIED/);
      observe(reviewRunner.platform, outcome === "deny" ? ["deniedNoEffect", "denialFeedback"] : ["cancelledNoEffect"], created.runId);
      reports.push({ platform: reviewRunner.platform, outcome, runId: created.runId, effects: 0, status: settled.status });
    });
  } finally {
    const extensionInputs: ExtensionInput[] = [...selected].flatMap(platform => baselineExtensions(platform as ExtensionPlatform, "isolated-native-review").map(report => ({ ...report, observations: report.caseId === "X04" ? extensionObservations.get(platform) ?? [] : report.caseId === "X02" ? effectObservations.get(platform) ?? [] : [] })));
    await writeFile(join(root, "extension-observations.json"), JSON.stringify(extensionInputs, null, 2));
    await writeFile(join(root, "extensions.json"), JSON.stringify({ schemaVersion: 1, mode: "scripted-native", metadata: { ...metadata, completedAt: new Date().toISOString() }, reports: extensionInputs.map(gradeExtension) }, null, 2));
    await writeFile(join(root, "summary.json"), JSON.stringify({ mode: "scripted-native", reports }, null, 2));
    await Promise.allSettled(runners.map(runner => runner.close?.()));
    await Promise.all(children.map(stop));
    await app.close();
    await effectProvider.close();
    await rm(secrets, { recursive: true, force: true });
    if (prior.url === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_URL; else process.env.AGENTLAB_CAPABILITY_HOST_URL = prior.url;
    if (prior.key === undefined) delete process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE; else process.env.AGENTLAB_CAPABILITY_HOST_KEY_FILE = prior.key;
    console.info(`Retained native review proof: ${join(root, "summary.json")}`);
  }
});
function start(executable: string, args: string[], env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  const child = spawn(executable, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", () => {});
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>(resolve => child.once("exit", () => resolve())), new Promise<void>(resolve => setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); resolve(); }, 3000))]);
}
async function ready(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Service unavailable: ${url}`);
}
async function waitFor(service: RunService, runId: string, predicate: (run: RunView) => boolean): Promise<RunView> {
  for (let i = 0; i < 400; i++) {
    const run = await service.getRun(runId);
    if (predicate(run)) return run;
    if (run.result) throw new Error(`Native review stopped: ${JSON.stringify(run.result)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Native review deadline: ${runId}`);
}

function mixedBatchModel(manifest: Parameters<typeof scriptedMastraModel>[0], captures: CapturedRequest[], writeName: string, readName: string): ReturnType<typeof scriptedMastraModel> {
  return {
    specificationVersion: "v2", provider: "agentlab.eval", modelId: manifest.model.model, supportedUrls: {},
    doGenerate: async ({ prompt }: { prompt: unknown }) => {
      const messages = normalizeMastraPrompt(prompt);
      const calls = messages.some(message => message.role === "tool") ? [] : [
        { callId: "mixed-read", toolName: readName, input: {} },
        { callId: "mixed-write-first", toolName: writeName, input: { owner: "First" } },
        { callId: "mixed-write-second", toolName: writeName, input: { owner: "Second" } },
      ];
      captures.push({ runId: manifest.runId, sequence: captures.filter(value => value.runId === manifest.runId).length + 1, messages, responseToolCalls: calls });
      return { content: calls.length ? calls.map(call => ({ type: "tool-call", toolCallId: call.callId, toolName: call.toolName, input: JSON.stringify(call.input) })) : [{ type: "text", text: "Mixed batch finished." }],
        finishReason: calls.length ? "tool-calls" : "stop", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 }, warnings: [] };
    },
    doStream: async () => { throw new Error("Mixed batch uses generate."); },
  } as unknown as ReturnType<typeof scriptedMastraModel>;
}
