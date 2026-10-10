import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunManifest } from "../../src/control-plane/domain/manifest.js";
import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { InvocationReviewStore, argumentDigest } from "../../src/capabilities/reviews/store.js";
import { ContextService, ContextSessionStore, CharacterTokenEstimator } from "../../src/capabilities/context/index.js";
import type { InvocationResumeInput } from "../../src/capabilities/reviews/contracts.js";
import type { PlatformExecutionReference, RunManifest, RunResult } from "../../src/control-plane/domain/types.js";
import type { PlatformRunner, RunnerInspection } from "../../src/control-plane/ports/runner.js";

class RetainedRunner implements PlatformRunner {
  readonly platform = "temporal"; readonly variant = "baseline";
  offline = true; deliveries: InvocationResumeInput[] = []; complete = false;
  manifestConfiguration() { return {}; }
  validate() { return { valid: true, reason: null }; }
  async checkConnection() { return { reachable: true, message: "fixture" }; }
  async start(manifest: RunManifest) { return ref(manifest.runId); }
  async cancel() { return { accepted: true, alreadyTerminal: false, message: "requested" }; }
  async resume(_reference: PlatformExecutionReference, input: unknown) {
    if (this.offline) throw new Error("owned worker unavailable");
    this.deliveries.push(input as InvocationResumeInput);
    return { accepted: true, alreadyTerminal: false, message: "retained decision accepted" };
  }
  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const result: RunResult | null = this.complete ? { schemaVersion: 1, runId: reference.executionId, status: "completed",
      startedAt: "2026-10-10T12:00:00Z", finishedAt: "2026-10-10T12:01:00Z", output: "verified",
      error: null, attemptCount: 1, usage: { inputTokens: null, outputTokens: null, totalTokens: null } } : null;
    return { status: this.complete ? "completed" : "suspended", reference, result, eventIntents: [], trajectory: null, metrics: null };
  }
}
const ref = (runId: string): PlatformExecutionReference => ({ platform: "temporal", variant: "baseline", executionId: runId, native: {} });

test("retained approval delivery recovers after API replacement and completion settles without browser polling", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-retained-continuation-"));
  try {
    const evidence = new RunEvidenceStore(join(root, "runs"));
    const reviews = new InvocationReviewStore(join(root, "runs"));
    const sessions = new ContextSessionStore(join(root, "context"));
    const context = new ContextService(sessions, new CharacterTokenEstimator());
    const runner = new RetainedRunner();
    const registry = new PlatformRegistry([runner]);
    const config = loadServerConfig({ AGENTLAB_RUNS_ROOT: join(root, "runs") });
    const deps = { evidence, reviews, context, registry, config };
    const service = new RunService(deps);
    const run = await service.createRun({ platform: "temporal", variant: "baseline", sessionId: "continuation-session", clientTurnId: "turn-one", task: { kind: "prompt", prompt: "Update the disposable record" }, model: { provider: "fake", model: "fake-success" } });
    const review = await reviews.propose({ runId: run.runId, turnId: run.manifest.context.turnId!,
      call: { toolCallId: "original-call", name: "update_fixture", arguments: { owner: "Morgan" }, round: 1 },
      argumentDigest: argumentDigest({ owner: "Morgan" }), catalogRevision: "fixture", sourceDigest: "fixture", connectionIdentity: null, displayArguments: { owner: "Morgan" } });
    // Crash window: the authoritative decision is retained but no native delivery occurs.
    await reviews.locked(run.runId, () => reviews.decide(run.runId, { requestId: review.requestId, revision: review.revision,
      argumentDigest: review.argumentDigest, decisionId: "retained-decision", decision: "approved" }));
    assert.equal((await reviews.get(run.runId, review.requestId)).delivery?.status, "pending");
    const replacement = new RunService(deps);
    runner.offline = false;
    await replacement.observeActiveRuns();
    await replacement.observeActiveRuns();
    assert.equal(runner.deliveries.length, 1);
    assert.equal((await evidence.readEvents(run.runId)).filter(event => event.kind === "InvocationReviewDecided").length, 1);
    assert.equal((await evidence.readEvents(run.runId)).filter(event => event.kind === "InvocationReviewDelivered").length, 1);
    assert.equal(runner.deliveries[0]?.toolCallId, "original-call");
    assert.equal(runner.deliveries[0]?.decisionId, "retained-decision");
    assert.equal((await reviews.get(run.runId, review.requestId)).delivery?.status, "accepted");
    runner.complete = true;
    await replacement.observeActiveRuns();
    assert.equal((await sessions.read("continuation-session")).activeTurnId, null);
    assert.deepEqual(await evidence.activeRunIds(), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancelled retained decisions are not delivered by background recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-cancel-delivery-"));
  try {
    const evidence = new RunEvidenceStore(root); const reviews = new InvocationReviewStore(root);
    const manifest = buildRunManifest({ platform: "temporal", variant: "baseline", task: { kind: "prompt", prompt: "fixture" }, model: { provider: "fake", model: "fake-success" } });
    await evidence.createRun(manifest); await evidence.writeExecutionReference(manifest.runId, ref(manifest.runId));
    const review = await reviews.propose({ runId: manifest.runId, turnId: "turn", call: { toolCallId: "cancel-call", name: "update_fixture", arguments: {}, round: 1 }, argumentDigest: argumentDigest({}), catalogRevision: "fixture", sourceDigest: "fixture", connectionIdentity: null, displayArguments: {} });
    await reviews.locked(manifest.runId, () => reviews.decide(manifest.runId, { requestId: review.requestId, revision: 1, argumentDigest: review.argumentDigest, decisionId: "cancel-decision", decision: "approved" }));
    await reviews.cancel(manifest.runId);
    const runner = new RetainedRunner(); runner.offline = false;
    await new RunService({ evidence, reviews, registry: new PlatformRegistry([runner]), config: loadServerConfig({}) }).observeActiveRuns();
    assert.equal(runner.deliveries.length, 0);
    assert.equal((await reviews.get(manifest.runId, review.requestId)).delivery?.status, "stopped");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("three sequential review decisions survive concurrent native pulls and duplicate delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentlab-three-review-events-"));
  try {
    const evidence = new RunEvidenceStore(root); const reviews = new InvocationReviewStore(root);
    const base = buildRunManifest({ platform: "temporal", variant: "baseline", task: { kind: "prompt", prompt: "Review independent changes" }, model: { provider: "fake", model: "fake-success" } });
    const manifest = { ...base, capabilities: { profileId: "fixture", tools: { enabledNames: [], maxRounds: 8, maxCalls: 16 }, toolCatalog: { schemaVersion: 1 as const, revision: "fixture", tools: [] } } };
    await evidence.createRun(manifest); await evidence.writeExecutionReference(manifest.runId, ref(manifest.runId));
    class PullingRunner extends RetainedRunner {
      rounds = 0;
      override async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
        const inspection = await super.inspect(reference);
        return { ...inspection, eventIntents: Array.from({ length: this.rounds }, (_, index) => ({ runId: manifest.runId,
          source: "temporal-workflow" as const, sourceSequence: index + 1, kind: "WorkflowSuspended", occurredAt: "2026-10-10T12:00:00Z",
          payload: { toolCallId: `call-${index + 1}` } })) };
      }
    }
    const runner = new PullingRunner(); runner.offline = false;
    const deps = { evidence, reviews, registry: new PlatformRegistry([runner]), config: loadServerConfig({}) };
    let service = new RunService(deps);
    for (let index = 1; index <= 3; index++) {
      runner.rounds = index;
      const review = await reviews.propose({ runId: manifest.runId, turnId: "turn", call: { toolCallId: `call-${index}`, name: "update_fixture", arguments: { index }, round: index }, argumentDigest: argumentDigest({ index }), catalogRevision: "fixture", sourceDigest: "fixture", connectionIdentity: null, displayArguments: { index } });
      const input = { requestId: review.requestId, revision: review.revision, argumentDigest: review.argumentDigest, decisionId: `decision-${index}`, decision: index === 3 ? "denied" : "approved" };
      await Promise.all([service.decideAction(manifest.runId, review.requestId, input), service.getRun(manifest.runId), service.observeActiveRuns()]);
      await service.decideAction(manifest.runId, review.requestId, input);
      // API reconstruction must retain control sequence and idempotence.
      service = new RunService(deps);
    }
    const events = await evidence.readEvents(manifest.runId);
    const decided = events.filter(event => event.kind === "InvocationReviewDecided");
    assert.equal(decided.length, 3);
    assert.deepEqual(decided.map(event => event.payload.decisionId), ["decision-1", "decision-2", "decision-3"]);
    assert.deepEqual(decided.map(event => event.payload.decision), ["approved", "approved", "denied"]);
    assert.equal(events.filter(event => event.kind === "InvocationReviewDelivered").length, 3);
    assert.equal(events.filter(event => event.kind === "WorkflowSuspended").length, 3);
    assert.deepEqual(events.map(event => event.recordedSequence), events.map((_, index) => index + 1));
    const controls = events.filter(event => event.source === "control-plane");
    assert.deepEqual(controls.map(event => event.sourceSequence), controls.map((_, index) => index + 1));
    assert.equal(runner.deliveries.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
