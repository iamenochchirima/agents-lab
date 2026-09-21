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
import { loadRestateConfig } from "../src/platforms/restate/config.js";
import { RestateBaselineRunner } from "../src/platforms/restate/runner-adapter/restate-runner.js";
import { TemporalBaselineRunner } from "../src/platforms/temporal/runner-adapter/temporal-runner.js";

const shouldRun = process.env.AGENTLAB_RUN_PLATFORM_MCP_MATRIX === "1";

/**
 * Opt-in native acceptance for the server-owned MCP capability. The direct API
 * matrix remains a separate control so a successful fixture read cannot hide a
 * protocol or platform-boundary regression.
 */
test(
  "the same MCP capability executes through all four priority platforms",
  {
    skip: shouldRun
      ? false
      : "Set AGENTLAB_RUN_PLATFORM_MCP_MATRIX=1 after starting the local stack.",
  },
  async () => {
    const fixtureUrl = (process.env.AGENTLAB_LOCAL_FIXTURE_URL ?? "http://127.0.0.1:9191").replace(/\/$/, "");
    const sharedContextRoot = process.env.AGENTLAB_CONTEXT_ROOT ?? join(process.cwd(), "lab/sessions");
    await assertFixtureReady(fixtureUrl);
    const roots = await Promise.all([
      mkdtemp(join(tmpdir(), "agentlab-platform-mcp-temporal-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-mcp-restate-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-mcp-langgraph-")),
      mkdtemp(join(tmpdir(), "agentlab-platform-mcp-mastra-")),
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
      runners.push(await TemporalBaselineRunner.connect(temporalConfig));
      runners.push(await RestateBaselineRunner.connect(loadRestateConfig({
        ...process.env,
        AGENTLAB_LOCAL_FIXTURE_URL: fixtureUrl,
        AGENTLAB_RUN_ROOT: roots[1]!,
        AGENTLAB_CONTEXT_ROOT: sharedContextRoot,
        AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
      })));
      runners.push(LangGraphBaselineRunner.fromOptions({
        serviceUrl: process.env.AGENTLAB_LANGGRAPH_SERVICE_URL ?? "http://127.0.0.1:2024",
        contextRoot: sharedContextRoot,
        timeoutMs: 30_000,
      }));
      runners.push(new MastraBaselineRunner({ contextRoot: sharedContextRoot }));

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
          task: { kind: "prompt", prompt: "Read the alpha fixture through the selected MCP server." },
          model: { provider: "fake", model: "fake-mcp-connected-tool", contextWindowTokens: 16_384 },
          capabilities: {
            profileId: "local-mcp-safe",
            tools: { enabledNames: [], maxRounds: 4, maxCalls: 4 },
          },
        });
        const completed = await waitForTerminal(service, created.runId);
        assert.equal(completed.status, "completed", `${runner.platform} did not complete: ${JSON.stringify(completed.result)}`);
        assert.equal(completed.manifest.capabilities?.profileId, "local-mcp-safe");
        const binding = completed.manifest.capabilities?.connections?.find((candidate) => candidate.toolName === "mcp_fixture_lookup");
        assert.equal(binding?.mcp?.toolName, "fixture.lookup");
        const event = completed.events.find((candidate) => candidate.kind === "ToolExecutionCompleted" && candidate.payload.toolName === "mcp_fixture_lookup");
        assert.ok(event, `${runner.platform} events: ${completed.events.map((candidate) => candidate.kind).join(",")}`);
        const connection = event.payload.connection as { status?: string; providerRequestIds?: readonly string[]; mcp?: { phase?: string; serverName?: string } } | undefined;
        assert.equal(connection?.status, "completed");
        assert.equal(connection?.mcp?.phase, "invocation");
        assert.equal(connection?.mcp?.serverName, "agentlab-local-mcp");
        assert.equal(connection?.providerRequestIds?.length, 1);
        assert.equal(completed.events.some((candidate) => candidate.kind === "ToolExecutionUnknown"), false);
      }
    } finally {
      await Promise.all(runners.map((runner) => runner.close?.()));
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
  },
);

async function assertFixtureReady(url: string): Promise<void> {
  const response = await fetch(`${url}/health`);
  if (!response.ok) throw new Error(`The local connection fixture returned HTTP ${response.status}.`);
}

async function waitForTerminal(service: RunService, runId: string): Promise<RunView> {
  const deadline = Date.now() + 30_000;
  let latest: RunView | null = null;
  while (Date.now() < deadline) {
    latest = await service.getRun(runId);
    if (["completed", "failed", "cancelled", "reconciliation_required"].includes(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Platform MCP matrix timed out for ${runId}; last status ${latest?.status ?? "unknown"}.`);
}
