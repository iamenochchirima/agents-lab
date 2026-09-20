import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDefaultCapabilityCatalog } from "../src/capabilities/catalog.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../src/capabilities/context/index.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService, type RunView } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import type { PlatformRunner } from "../src/control-plane/ports/runner.js";
import { LangGraphBaselineRunner } from "../src/platforms/langgraph/runner-adapter/langgraph-runner.js";
import { MastraBaselineRunner } from "../src/platforms/mastra/runner-adapter/mastra-runner.js";
import { defaultMastraModelFactory } from "../src/platforms/mastra/variants/baseline/models/factory.js";
import { createDeterministicFakeModel } from "../src/platforms/mastra/variants/baseline/models/fake.js";
import { loadRestateConfig } from "../src/platforms/restate/config.js";
import { RestateBaselineRunner } from "../src/platforms/restate/runner-adapter/restate-runner.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";

const shouldRun = process.env.AGENTLAB_RUN_PLATFORM_CAPABILITY_MATRIX === "1";

/**
 * Opt-in local-native acceptance. The four platform services are intentionally
 * external prerequisites: this test verifies that the same resolved profile
 * crosses each platform's real runner boundary instead of replacing a native
 * worker with a fake successful response.
 */
test(
  "the same connected capability profile executes through all four priority platforms",
  {
    skip: shouldRun
      ? false
      : "Set AGENTLAB_RUN_PLATFORM_CAPABILITY_MATRIX=1 after starting Temporal, Restate, LangGraph, and Mastra local services.",
  },
  async () => {
    const fixtureUrl = (process.env.AGENTLAB_LOCAL_FIXTURE_URL ?? "http://127.0.0.1:9191").replace(/\/$/, "");
    const sharedContextRoot = process.env.AGENTLAB_CONTEXT_ROOT ?? join(process.cwd(), "lab/sessions");
    await assertFixtureReady(fixtureUrl);
    const roots = await Promise.all([
      mkdtemp(join(tmpdir(), "agentlab-platform-matrix-temporal-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-matrix-restate-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-matrix-langgraph-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-matrix-mastra-")),
    ]);
    const runners: PlatformRunner[] = [];
    try {
      const temporalConfig = loadServerConfig({
        ...process.env,
        AGENTLAB_LOCAL_FIXTURE_URL: fixtureUrl,
        AGENTLAB_RUN_ROOT: roots[0]!,
        AGENTLAB_CONTEXT_ROOT: sharedContextRoot,
        AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
      }, process.cwd());
      const temporal = await TemporalBaselineRunner.connect(temporalConfig);
      runners.push(temporal);

      const restate = await RestateBaselineRunner.connect(loadRestateConfig({
        ...process.env,
        AGENTLAB_LOCAL_FIXTURE_URL: fixtureUrl,
        AGENTLAB_RUN_ROOT: roots[1]!,
        AGENTLAB_CONTEXT_ROOT: sharedContextRoot,
        AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
      }));
      runners.push(restate);

      const langgraph = LangGraphBaselineRunner.fromOptions({
        serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024",
        contextRoot: sharedContextRoot,
        timeoutMs: 30_000,
      });
      runners.push(langgraph);

      const mastra = new MastraBaselineRunner({
        contextRoot: sharedContextRoot,
        modelFactory: (manifest) => manifest.model.model === "fake-slow"
          ? createDeterministicFakeModel({ modelId: "fake-slow", delayMs: 5_000 })
          : defaultMastraModelFactory(manifest),
      });
      runners.push(mastra);

      for (const runner of runners) {
        const connectivity = await runner.checkConnection();
        assert.equal(connectivity.reachable, true, `${runner.platform} is unavailable: ${connectivity.message}`);
      }

      for (const [index, runner] of runners.entries()) {
        const root = roots[index]!;
        const config = loadServerConfig({
          ...process.env,
          AGENTLAB_LOCAL_FIXTURE_URL: fixtureUrl,
          AGENTLAB_RUN_ROOT: root,
          AGENTLAB_CONTEXT_ROOT: sharedContextRoot,
          AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
        }, process.cwd());
        const service = new RunService({
          config,
          evidence: new RunEvidenceStore(root),
          registry: new PlatformRegistry([runner]),
          capabilities: createDefaultCapabilityCatalog(),
          context: new ContextService(new ContextSessionStore(config.contextRoot), new CharacterTokenEstimator()),
        });
        const created = await service.createRun({
          platform: runner.platform,
          variant: runner.variant,
          task: { kind: "prompt", prompt: "Read the alpha fixture and report the returned value." },
          model: { provider: "fake", model: "fake-connected-tool", contextWindowTokens: 16_384 },
          capabilities: {
            profileId: "local-safe",
            tools: { enabledNames: [], maxRounds: 4, maxCalls: 4 },
          },
        });
        const completed = await waitForTerminal(service, created.runId);
        assert.equal(completed.status, "completed", `${runner.platform} did not complete: ${JSON.stringify(completed.result)}`);
        assert.equal(completed.manifest.capabilities?.profileId, "local-safe");
        assert.equal(completed.events.some((event) => event.kind === "ToolExecutionCompleted"), true);
        const connectionEvent = completed.events.find((event) => event.kind === "ToolExecutionCompleted");
        assert.equal((connectionEvent?.payload.connection as { status?: string } | undefined)?.status, "completed");
        const eventKeys = completed.events.map((event) => [
          event.platform ?? runner.platform,
          event.runId,
          event.attemptId ?? "legacy",
          event.source,
          event.sourceSequence,
        ].join(":"));
        assert.equal(new Set(eventKeys).size, completed.events.length);

        const writeCreated = await service.createRun({
          platform: runner.platform,
          variant: runner.variant,
          task: { kind: "prompt", prompt: "Write the approved value to the local fixture." },
          model: { provider: "fake", model: "fake-connected-write", contextWindowTokens: 16_384 },
          capabilities: {
            profileId: "local-write-approved",
            tools: { enabledNames: [], maxRounds: 4, maxCalls: 4 },
            approvals: [writeApproval(runner.platform)],
          },
        });
        const writeCompleted = await waitForTerminal(service, writeCreated.runId);
        assert.equal(writeCompleted.status, "completed", `${runner.platform} write did not complete: ${JSON.stringify(writeCompleted.result)}`);
        assert.equal(writeCompleted.manifest.capabilities?.resolution?.decisions.some((decision) => decision.status === "granted" && decision.capabilityId === "fixture_write"), true);
        const writeEvent = writeCompleted.events.find((event) => event.kind === "ToolExecutionCompleted" && event.payload.toolName === "fixture_write");
        assert.equal((writeEvent?.payload.connection as { status?: string } | undefined)?.status, "completed");

        const cancellationModel = runner.platform === "restate"
          ? "fake-delay"
          : runner.platform === "mastra"
            ? "fake-slow"
            : "fake-cancel";
        const cancellationCreated = await service.createRun({
          platform: runner.platform,
          variant: runner.variant,
          task: { kind: "prompt", prompt: "Cancel this deterministic run." },
          model: { provider: "fake", model: cancellationModel, contextWindowTokens: 16_384 },
        });
        await service.cancelRun(cancellationCreated.runId, "platform capability matrix cancellation");
        const cancelled = await waitForTerminal(service, cancellationCreated.runId);
        assert.equal(cancelled.status, "cancelled", `${runner.platform} cancellation was not preserved: ${JSON.stringify(cancelled.result)}`);
      }
    } finally {
      await Promise.all(runners.map((runner) => runner.close?.()));
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
  },
);

async function assertFixtureReady(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${url}/health`);
  } catch (error) {
    throw new Error(`The local connection fixture is unavailable at ${url}. Start the local stack first. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`The local connection fixture returned HTTP ${response.status} at ${url}/health.`);
}

function writeApproval(platform: string) {
  return {
    schemaVersion: 1 as const,
    decisionId: `approval_matrix_${platform}_fixture_write`,
    capabilityId: "fixture_write",
    version: "1.0.0",
    allowedOperations: ["write"],
    connectionRef: "conn_local_fixture",
    decision: "approved" as const,
    decidedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  };
}

async function waitForTerminal(service: RunService, runId: string): Promise<RunView> {
  const deadline = Date.now() + 30_000;
  let latest: RunView | null = null;
  while (Date.now() < deadline) {
    latest = await service.getRun(runId);
    if (latest.status === "completed" || latest.status === "failed" || latest.status === "cancelled" || latest.status === "reconciliation_required") {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Platform capability matrix timed out for ${runId}; last status ${latest?.status ?? "unknown"}.`);
}
