import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadServerConfig } from "../../src/control-plane/bootstrap/config.js";
import { RunEvidenceStore } from "../../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import { RunService } from "../../src/control-plane/application/run-service.js";
import { buildControlPlaneServer } from "../../src/control-plane/http/server.js";
import { createStudioModule } from "../../src/studio/index.js";
import type { StudioComparisonRequest } from "../../src/studio/index.js";

test("Studio runs a controlled context comparison through the existing server", async () => {
  await withStudioApp(async (app, studioRoot) => {
    const created = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      headers: { "x-idempotency-key": "context-comparison-1" },
      payload: comparisonRequest(),
    });

    assert.equal(created.statusCode, 202);
    const comparison = created.json();
    assert.equal(comparison.status, "completed");
    assert.equal(comparison.trials.length, 2);
    assert.equal(comparison.trials[0].manifest.strategy.id, "full-history");
    assert.equal(comparison.trials[0].context.retainedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[0].result.output, "The support agent should use English for this account.");
    assert.equal(comparison.trials[0].result.grade.status, "pass");
    assert.equal(comparison.trials[1].manifest.strategy.id, "sliding-window");
    assert.equal(comparison.trials[1].context.omittedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[1].result.output, "The support agent should use English for this account.");
    assert.equal(comparison.trials[1].result.grade.status, "fail");
    assert.equal(comparison.trials[0].composition.slots.length, 12);
    assert.deepEqual(comparison.trials[0].memory.retrievedRecordIds, []);
    assert.equal(
      comparison.trials[0].manifest.fixedControlFingerprint,
      comparison.trials[1].manifest.fixedControlFingerprint,
    );
    assert.notEqual(comparison.trials[0].manifest.strategy.id, comparison.trials[1].manifest.strategy.id);
    assert.notDeepEqual(comparison.trials[0].manifest.strategy, comparison.trials[1].manifest.strategy);
    assert.equal(comparison.metrics.totalTokens, null);

    const events = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/events?after=0&limit=50`,
    });
    assert.equal(events.statusCode, 200);
    assert.deepEqual(
      events.json().events.map((event: { kind: string }) => event.kind),
      [
        "ComparisonCreated",
        "ComparisonStarted",
        "TrialCreated",
        "InputNormalized",
        "MemoryRead",
        "ContextAssembled",
        "PlanProduced",
        "ControlLoopStarted",
        "ModelRequested",
        "ModelCompleted",
        "ToolDispatchSkipped",
        "ComputerUseUnavailable",
        "SafetyChecked",
        "OutputCollected",
        "MemoryWritten",
        "MemoryConsolidated",
        "TrialGraded",
        "TurnCompleted",
        "TrialCompleted",
        "TrialCreated",
        "InputNormalized",
        "MemoryRead",
        "ContextAssembled",
        "PlanProduced",
        "ControlLoopStarted",
        "ModelRequested",
        "ModelCompleted",
        "ToolDispatchSkipped",
        "ComputerUseUnavailable",
        "SafetyChecked",
        "OutputCollected",
        "MemoryWritten",
        "MemoryConsolidated",
        "TrialGraded",
        "TurnCompleted",
        "TrialCompleted",
        "ComparisonCompleted",
      ],
    );

    const evidence = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[0].manifest.trialId}/context.json`,
    });
    assert.equal(evidence.statusCode, 200);
    assert.equal(JSON.parse(evidence.body).strategyId, "full-history");

    const memoryEvidence = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[0].manifest.trialId}/memory.json`,
    });
    assert.equal(memoryEvidence.statusCode, 200);
    assert.deepEqual(JSON.parse(memoryEvidence.body).retrievedRecordIds, []);

    const compositionEvidence = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[0].manifest.trialId}/composition.json`,
    });
    assert.equal(compositionEvidence.statusCode, 200);
    assert.equal(JSON.parse(compositionEvidence.body).slots.length, 12);

    const config = await readFile(join(studioRoot, comparison.manifest.comparisonId, "config.json"), "utf8");
    assert.equal(JSON.parse(config).fixedEnvelope.model, "context-replay-v1");
    assert.deepEqual(await readDirectoryOrEmpty(join(studioRoot, "..", "platform-runs")), []);
  });
});

test("Studio can execute a three-strategy Context comparison through the same server", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-three-way", true),
    });

    assert.equal(response.statusCode, 202);
    const comparison = response.json();
    assert.equal(comparison.status, "completed");
    assert.deepEqual(
      comparison.trials.map((trial: { manifest: { strategy: { id: string } } }) => trial.manifest.strategy.id),
      ["full-history", "sliding-window", "relevance-ranked"],
    );
    assert.equal(comparison.trials[2].context.retainedMessageIds.includes("context-fact-language"), true);
    assert.equal(comparison.trials[2].result.output, "The support agent should use English for this account.");
  });
});

test("Studio runs a Memory comparison with fixed Context and isolated durable policies", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: memoryRequest("memory-comparison-1"),
    });

    assert.equal(response.statusCode, 202);
    const comparison = response.json();
    assert.equal(comparison.status, "completed");
    assert.deepEqual(
      comparison.trials.map((trial: { manifest: { strategy: { id: string } } }) => trial.manifest.strategy.id),
      ["no-memory", "semantic-keyed-facts"],
    );
    assert.deepEqual(
      comparison.trials.map((trial: { result: { grade: { status: string } } }) => trial.result.grade.status),
      ["fail", "pass"],
    );
    assert.equal(comparison.trials[0].context.strategyId, "full-history");
    assert.equal(comparison.trials[1].context.strategyId, "full-history");
    assert.deepEqual(comparison.trials[0].memory.retrievedRecordIds, []);
    assert.deepEqual(comparison.trials[1].memory.retrievedRecordIds, ["memory-fact-language"]);
    assert.equal(comparison.trials[0].context.messages.some((message: { messageId: string }) => message.messageId === "memory-memory-fact-language"), false);
    assert.equal(comparison.trials[1].context.messages.some((message: { messageId: string }) => message.messageId === "memory-memory-fact-language"), true);
    assert.equal(comparison.trials[0].manifest.fixedControlFingerprint, comparison.trials[1].manifest.fixedControlFingerprint);
    assert.equal(comparison.events.filter((event: { kind: string }) => event.kind === "MemorySeeded").length, 2);
    const semanticEvents = comparison.events
      .filter((event: { kind: string; payload?: { trialId?: string } }) => event.payload?.trialId === comparison.trials[1].manifest.trialId)
      .map((event: { kind: string }) => event.kind);
    assert.deepEqual(semanticEvents.slice(0, 6), [
      "TrialCreated",
      "InputNormalized",
      "MemorySeeded",
      "MemoryCandidatesRanked",
      "MemoryRetrieved",
      "ContextAssembled",
    ]);
    assert.equal(semanticEvents.includes("MemoryWriteDecided"), true);
    assert.equal(semanticEvents.includes("MemoryStatePersisted"), true);

    const memoryState = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[1].manifest.trialId}/memory/records.json`,
    });
    assert.equal(memoryState.statusCode, 200);
    assert.match(memoryState.body, /memory-fact-language/);

    const memoryDecisions = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[1].manifest.trialId}/memory/decisions.jsonl`,
    });
    assert.equal(memoryDecisions.statusCode, 200);
    assert.match(memoryDecisions.body, /seed-/);
  });
});

test("Studio carries Memory across an ordered turn sequence and exposes turn evidence", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: memoryMultiturnRequest("memory-multiturn-comparison-1"),
    });

    assert.equal(response.statusCode, 202);
    const comparison = response.json();
    assert.equal(comparison.status, "completed");
    assert.deepEqual(comparison.trials.map((trial: { manifest: { strategy: { id: string } } }) => trial.manifest.strategy.id), [
      "no-memory",
      "semantic-keyed-facts",
    ]);
    assert.deepEqual(comparison.trials.map((trial: { turns: { turnId: string }[] }) => trial.turns.map((turn) => turn.turnId)), [
      ["turn-01-learn", "turn-02-recall"],
      ["turn-01-learn", "turn-02-recall"],
    ]);
    assert.equal(comparison.trials[0].turns[1].metrics.requiredRecordHit, false);
    assert.equal(comparison.trials[1].turns[0].memory.writtenRecordIds.length, 1);
    assert.deepEqual(comparison.trials[1].turns[1].memory.retrievedRecordIds, ["turn-01-learn-add-support-language-record"]);
    assert.equal(comparison.trials[1].turns[1].metrics.requiredRecordHit, true);
    assert.deepEqual(comparison.trials.map((trial: { result: { grade: { status: string } } }) => trial.result.grade.status), ["fail", "pass"]);
    assert.equal(comparison.metrics.turnCount, 4);
    assert.equal(comparison.metrics.completedTurnCount, 4);
    assert.equal(comparison.metrics.memoryWrittenCount, 1);
    assert.equal(comparison.metrics.maxActiveRecordCount, 1);
    assert.equal(comparison.events.some((event: { kind: string }) => event.kind === "MemoryStoreReopened"), true);
    assert.equal(comparison.events.filter((event: { kind: string; payload?: { turnId?: string } }) => event.payload?.turnId === "turn-02-recall").length > 0, true);

    const turnEvidence = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[1].manifest.trialId}/turns/turn-02-recall.json`,
    });
    assert.equal(turnEvidence.statusCode, 200);
    assert.equal(JSON.parse(turnEvidence.body).metrics.requiredRecordHit, true);
  });
});

test("Studio records a Memory revision when a keyed fact changes", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: memoryUpdateRequest("memory-update-comparison-1"),
    });

    assert.equal(response.statusCode, 202);
    const comparison = response.json();
    assert.equal(comparison.status, "completed");
    assert.deepEqual(
      comparison.trials.map((trial: { result: { grade: { status: string } } }) => trial.result.grade.status),
      ["fail", "pass"],
    );
    assert.deepEqual(comparison.trials[1].memory.updatedRecordIds, ["memory-update-language-r2"]);
    assert.equal(comparison.trials[1].memory.activeRecordIds.includes("memory-update-language"), false);
    assert.equal(comparison.trials[1].memory.activeRecordIds.includes("memory-update-language-r2"), true);
    assert.equal(comparison.trials[1].memory.decisions.some((decision: { operation: string; targetRecordId: string | null }) => decision.operation === "update" && decision.targetRecordId === "memory-update-language"), true);

    const memoryState = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[1].manifest.trialId}/memory/records.json`,
    });
    assert.equal(memoryState.statusCode, 200);
    const state = JSON.parse(memoryState.body);
    assert.equal(state.records.find((record: { recordId: string }) => record.recordId === "memory-update-language")?.state, "superseded");
    assert.equal(state.records.find((record: { recordId: string }) => record.recordId === "memory-update-language-r2")?.state, "active");

    const decisions = await app.inject({
      method: "GET",
      url: `/api/studio/comparisons/${comparison.manifest.comparisonId}/evidence/trials/${comparison.trials[1].manifest.trialId}/memory/decisions.jsonl`,
    });
    assert.equal(decisions.statusCode, 200);
    assert.match(decisions.body, /"operation":"update"/);
  });
});

test("Studio runs the Memory miss, duplicate, expiry, and procedural fixtures", async () => {
  await withStudioApp(async (app) => {
    const cases = [
      {
        idempotencyKey: "memory-miss-comparison-1",
        experimentId: "compare-memory-misses",
        scenarioId: "memory-retrieval-miss",
        strategies: ["no-memory", "semantic-keyed-facts", "episodic-lexical"],
        grades: ["fail", "fail", "fail"],
      },
      {
        idempotencyKey: "memory-duplicate-comparison-1",
        experimentId: "compare-memory-deduplication",
        scenarioId: "memory-duplicate-preference",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "pass"],
      },
      {
        idempotencyKey: "memory-expiry-comparison-1",
        experimentId: "compare-memory-expiry",
        scenarioId: "memory-expired-preference",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "fail"],
      },
      {
        idempotencyKey: "memory-procedure-comparison-1",
        experimentId: "compare-memory-procedures",
        scenarioId: "memory-procedure-reuse",
        strategies: ["no-memory", "procedural-cache"],
        grades: ["fail", "pass"],
      },
    ] as const;

    for (const memoryCase of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/studio/comparisons",
        payload: memoryCaseRequest(memoryCase),
      });
      assert.equal(response.statusCode, 202, memoryCase.experimentId);
      const comparison = response.json();
      assert.equal(comparison.status, "completed", memoryCase.experimentId);
      assert.deepEqual(comparison.trials.map((trial: { manifest: { strategy: { id: string } } }) => trial.manifest.strategy.id), memoryCase.strategies);
      assert.deepEqual(comparison.trials.map((trial: { result: { grade: { status: string } } }) => trial.result.grade.status), memoryCase.grades);
      assert.equal(comparison.trials.every((trial: { context: { strategyId: string } }) => trial.context.strategyId === "full-history"), true);
      assert.equal(comparison.trials.every((trial: { manifest: { fixedControlFingerprint: string } }) => trial.manifest.fixedControlFingerprint === comparison.trials[0].manifest.fixedControlFingerprint), true);

      if (memoryCase.experimentId === "compare-memory-deduplication") {
        assert.equal(comparison.trials[1].memory.decisions.some((decision: { operation: string }) => decision.operation === "noop"), true);
      }
      if (memoryCase.experimentId === "compare-memory-expiry") {
        assert.equal(comparison.trials[1].memory.expiredRecordIds.includes("memory-expired-language"), true);
      }
      if (memoryCase.experimentId === "compare-memory-procedures") {
        assert.deepEqual(comparison.trials[1].memory.retrievedRecordIds, ["memory-procedure-invoice"]);
      }
    }
  });
});

test("Studio exposes the multi-turn Memory scenario matrix", async () => {
  await withStudioApp(async (app) => {
    const cases = [
      {
        idempotencyKey: "memory-multiturn-update-comparison-1",
        experimentId: "compare-memory-multiturn-updates",
        scenarioId: "memory-multiturn-update-then-recall",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "pass"],
      },
      {
        idempotencyKey: "memory-multiturn-duplicate-comparison-1",
        experimentId: "compare-memory-multiturn-deduplication",
        scenarioId: "memory-multiturn-duplicate-write",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "pass"],
      },
      {
        idempotencyKey: "memory-multiturn-expiry-comparison-1",
        experimentId: "compare-memory-multiturn-expiry",
        scenarioId: "memory-multiturn-expiry",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "fail"],
      },
      {
        idempotencyKey: "memory-multiturn-miss-comparison-1",
        experimentId: "compare-memory-multiturn-misses",
        scenarioId: "memory-multiturn-retrieval-miss",
        strategies: ["no-memory", "semantic-keyed-facts"],
        grades: ["fail", "fail"],
      },
      {
        idempotencyKey: "memory-multiturn-procedure-comparison-1",
        experimentId: "compare-memory-multiturn-procedures",
        scenarioId: "memory-multiturn-procedure-reuse",
        strategies: ["no-memory", "procedural-cache"],
        grades: ["fail", "pass"],
      },
    ] as const;

    for (const memoryCase of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/studio/comparisons",
        payload: memoryCaseRequest(memoryCase),
      });
      assert.equal(response.statusCode, 202, memoryCase.experimentId);
      const comparison = response.json();
      assert.equal(comparison.status, "completed", memoryCase.experimentId);
      assert.deepEqual(comparison.trials.map((trial: { result: { grade: { status: string } } }) => trial.result.grade.status), memoryCase.grades, memoryCase.experimentId);
      assert.equal(comparison.metrics.turnCount > comparison.trials.length, true, memoryCase.experimentId);
      assert.equal(comparison.trials.every((trial: { turns: unknown[] }) => trial.turns.length >= 2), true, memoryCase.experimentId);

      if (memoryCase.experimentId === "compare-memory-multiturn-updates") {
        assert.deepEqual(comparison.trials[1].turns[1].memory.retrievedRecordIds, ["memory-multiturn-update-language-r2"]);
        assert.deepEqual(comparison.trials[1].turns[2].memory.retrievedRecordIds, ["memory-multiturn-update-language-r2"]);
        assert.equal(
          comparison.events.filter((event: { kind: string; payload?: { trialId?: string } }) =>
            event.kind === "MemoryStoreReopened" && event.payload?.trialId === comparison.trials[1].manifest.trialId).length,
          2,
        );
      }
      if (memoryCase.experimentId === "compare-memory-multiturn-deduplication") {
        assert.equal(comparison.trials[1].turns[1].memory.decisions.some((decision: { operation: string }) => decision.operation === "noop"), true);
      }
      if (memoryCase.experimentId === "compare-memory-multiturn-expiry") {
        assert.equal(comparison.trials[1].turns[0].memory.expiredRecordIds.includes("memory-multiturn-expired-language"), true);
      }
      if (memoryCase.experimentId === "compare-memory-multiturn-misses") {
        assert.equal(comparison.trials[1].turns[1].memory.omittedRecordIds.includes("memory-multiturn-unrelated-invoice"), true);
      }
      if (memoryCase.experimentId === "compare-memory-multiturn-procedures") {
        assert.deepEqual(comparison.trials[1].turns[1].memory.retrievedRecordIds, ["turn-01-procedure-add-invoice-dispute-record"]);
      }
    }
  });
});

test("Studio multi-turn replay observations are stable across independent comparisons", async () => {
  await withStudioApp(async (app) => {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: memoryMultiturnRequest("memory-multiturn-determinism-1"),
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: memoryMultiturnRequest("memory-multiturn-determinism-2"),
    });
    assert.equal(firstResponse.statusCode, 202);
    assert.equal(secondResponse.statusCode, 202);

    const comparable = (comparison: any) => comparison.trials.map((trial: any) => ({
      strategy: trial.manifest.strategy,
      turns: trial.turns.map((turn: any) => ({
        turnId: turn.turnId,
        output: turn.result.output,
        grade: turn.result.grade,
        context: {
          retainedMessageIds: turn.context.retainedMessageIds.filter((id: string) => !id.startsWith("studio-system-")),
          omittedMessageIds: turn.context.omittedMessageIds,
          messages: turn.context.messages.map((message: any) => ({ messageId: message.messageId.startsWith("studio-system-") ? "studio-system" : message.messageId, content: message.content, source: message.source })),
        },
        memory: {
          retrievedRecordIds: turn.memory.retrievedRecordIds,
          omittedRecordIds: turn.memory.omittedRecordIds,
          writtenRecordIds: turn.memory.writtenRecordIds,
          updatedRecordIds: turn.memory.updatedRecordIds,
          expiredRecordIds: turn.memory.expiredRecordIds,
          activeRecordIds: turn.memory.activeRecordIds,
          decisions: turn.memory.decisions,
        },
        metrics: { ...turn.metrics, latencyMs: null },
      })),
    }));
    assert.deepEqual(comparable(firstResponse.json()), comparable(secondResponse.json()));
  });
});

test("Studio catalog exposes all harness areas without claiming planned implementations", async () => {
  await withStudioApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/studio/catalog" });
    assert.equal(response.statusCode, 200);
    const catalog = response.json();
    assert.equal(catalog.components.length, 12);
    assert.equal(catalog.components[0].id, "input-perception");
    assert.equal(catalog.components[1].id, "context-management");
    assert.equal(catalog.components[1].status, "available");
    assert.deepEqual(catalog.components[1].strategies.map((strategy: { id: string }) => strategy.id), ["full-history", "sliding-window", "relevance-ranked"]);
    assert.equal(catalog.components[3].id, "memory");
    assert.equal(catalog.components[3].status, "available");
    assert.deepEqual(catalog.components[3].strategies.map((strategy: { id: string }) => strategy.id), ["no-memory", "semantic-keyed-facts", "episodic-lexical", "working-memory", "procedural-cache"]);
    assert.deepEqual(catalog.components[3].experiments.map((experiment: { id: string }) => experiment.id), [
      "compare-memory-retrieval",
      "compare-memory-multiturn",
      "compare-memory-multiturn-updates",
      "compare-memory-multiturn-deduplication",
      "compare-memory-multiturn-expiry",
      "compare-memory-multiturn-misses",
      "compare-memory-multiturn-procedures",
      "compare-memory-updates",
      "compare-memory-misses",
      "compare-memory-deduplication",
      "compare-memory-expiry",
      "compare-memory-procedures",
    ]);
    assert.equal(JSON.stringify(catalog).includes("expectedAnswer"), false);
    assert.equal(JSON.stringify(catalog).includes("context-fact-language"), false);
  });
});

test("Studio idempotency returns the original comparison and rejects a changed request", async () => {
  await withStudioApp(async (app) => {
    const first = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-2"),
    });
    assert.equal(first.statusCode, 202);
    const firstComparison = first.json();

    const repeated = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-2"),
    });
    assert.equal(repeated.statusCode, 202);
    assert.equal(repeated.json().manifest.comparisonId, firstComparison.manifest.comparisonId);

    const changed = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: {
        ...comparisonRequest("context-comparison-2"),
        seed: "different-seed",
      },
    });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, "STUDIO_CONFLICT");

    const distinct = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: comparisonRequest("context-comparison-3"),
    });
    assert.equal(distinct.statusCode, 202);
    assert.notEqual(distinct.json().manifest.comparisonId, firstComparison.manifest.comparisonId);
  });
});

test("Studio rejects unsupported strategies and does not create a comparison", async () => {
  await withStudioApp(async (app, studioRoot) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: {
        ...comparisonRequest("context-comparison-invalid"),
        experiment: {
          ...comparisonRequest("context-comparison-invalid").experiment,
          subject: {
            component: "context-management",
            strategies: [
              { id: "unknown-strategy", version: "1", parameters: {} },
              { id: "sliding-window", version: "1", parameters: {} },
            ],
          },
        },
      },
    });
    assert.equal(response.statusCode, 400);
    const entries = await readDirectoryOrEmpty(studioRoot);
    assert.deepEqual(entries, []);
  });
});

test("Studio rejects parameters that a Memory policy does not declare", async () => {
  await withStudioApp(async (app, studioRoot) => {
    const request = memoryRequest("memory-invalid-parameters");
    const response = await app.inject({
      method: "POST",
      url: "/api/studio/comparisons",
      payload: {
        ...request,
        experiment: {
          ...request.experiment,
          subject: {
            ...request.experiment.subject,
            strategies: [
              { id: "no-memory", version: "1", parameters: { maxRecords: "1" } },
              request.experiment.subject.strategies[1],
            ],
          },
        },
      },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(await readDirectoryOrEmpty(studioRoot), []);
  });
});

function comparisonRequest(idempotencyKey = "context-comparison-1", includeRelevance = false): StudioComparisonRequest {
  const strategies: StudioComparisonRequest["experiment"]["subject"]["strategies"][number][] = [
    { id: "full-history", version: "1", parameters: {} },
    { id: "sliding-window", version: "1", parameters: { recentMessages: "4" } },
  ];
  if (includeRelevance) strategies.push({ id: "relevance-ranked", version: "1", parameters: { maxMessages: "4" } });
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-context-retention",
      version: "1",
      scenario: { id: "context-old-important-fact", version: "1" },
      subject: {
        component: "context-management",
        strategies,
      },
    },
    seed: "seed-1",
    idempotencyKey,
  };
}

function memoryRequest(idempotencyKey = "memory-comparison-1"): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-memory-retrieval",
      version: "1",
      scenario: { id: "memory-previous-preference", version: "1" },
      subject: {
        component: "memory",
        strategies: [
          { id: "no-memory", version: "1", parameters: {} },
          { id: "semantic-keyed-facts", version: "1", parameters: {} },
        ],
      },
    },
    seed: "seed-memory-1",
    idempotencyKey,
  };
}

function memoryMultiturnRequest(idempotencyKey = "memory-multiturn-comparison-1"): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-memory-multiturn",
      version: "1",
      scenario: { id: "memory-learn-then-recall", version: "1" },
      subject: {
        component: "memory",
        strategies: [
          { id: "no-memory", version: "1", parameters: {} },
          { id: "semantic-keyed-facts", version: "1", parameters: {} },
        ],
      },
    },
    seed: "seed-memory-multiturn-1",
    idempotencyKey,
  };
}

function memoryUpdateRequest(idempotencyKey = "memory-update-comparison-1"): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: "compare-memory-updates",
      version: "1",
      scenario: { id: "memory-update-preference", version: "1" },
      subject: {
        component: "memory",
        strategies: [
          { id: "no-memory", version: "1", parameters: {} },
          { id: "semantic-keyed-facts", version: "1", parameters: {} },
        ],
      },
    },
    seed: "seed-memory-update-1",
    idempotencyKey,
  };
}

function memoryCaseRequest(memoryCase: {
  readonly idempotencyKey: string;
  readonly experimentId: string;
  readonly scenarioId: string;
  readonly strategies: readonly string[];
}): StudioComparisonRequest {
  return {
    system: { id: "neutral-agent", version: "1" },
    environment: { id: "deterministic-replay", version: "1" },
    experiment: {
      id: memoryCase.experimentId,
      version: "1",
      scenario: { id: memoryCase.scenarioId, version: "1" },
      subject: {
        component: "memory",
        strategies: memoryCase.strategies.map((id) => ({ id, version: "1", parameters: {} })),
      },
    },
    seed: `seed-${memoryCase.idempotencyKey}`,
    idempotencyKey: memoryCase.idempotencyKey,
  } as StudioComparisonRequest;
}

async function readDirectoryOrEmpty(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function withStudioApp(run: (app: ReturnType<typeof buildControlPlaneServer>, studioRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "agentlab-studio-"));
  const studioRoot = join(root, "studio-runs");
  try {
    const config = loadServerConfig({
      AGENTLAB_RUN_ROOT: join(root, "platform-runs"),
      AGENTLAB_CONTEXT_ROOT: join(root, "sessions"),
      AGENTLAB_STUDIO_RUN_ROOT: studioRoot,
    }, "/repo");
    const evidence = new RunEvidenceStore(config.runsRoot);
    const registry = new PlatformRegistry([]);
    const service = new RunService({ config, evidence, registry });
    const app = buildControlPlaneServer({ config, service, evidence, registry });
    createStudioModule(config.studioRunsRoot).register(app);
    await app.ready();
    try {
      await run(app, studioRoot);
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
