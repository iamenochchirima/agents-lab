import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@temporalio/client";

import { loadServerConfig } from "../../../src/control-plane/bootstrap/config.js";
import { buildRunManifest } from "../../../src/control-plane/domain/manifest.js";
import type { TemporalWorkflowInput } from "../../../src/platforms/temporal/variants/baseline/contracts.js";
import { TemporalBaselineRunner } from "../../../src/platforms/temporal/runner-adapter/temporal-runner.js";

test("Temporal adapter forwards the admitted capability inventory into workflow input", async () => {
  let workflowInput: TemporalWorkflowInput | undefined;
  const client = {
    workflow: {
      start: async (_workflow: unknown, options: { args: readonly unknown[]; workflowId: string }) => {
        workflowInput = options.args[0] as TemporalWorkflowInput;
        return { workflowId: options.workflowId, firstExecutionRunId: "temporal-capability-test-run" };
      },
    },
  } as unknown as Client;
  const config = loadServerConfig({}, "/tmp/agentlab-temporal-capability-test");
  const runner = TemporalBaselineRunner.fromClient({ client, config });
  const inventory = {
    schemaVersion: 1 as const,
    revision: "temporal-capability-revision",
    toolCatalogRevision: "temporal-tool-catalog-revision",
    profile: { id: "notes-agent", version: "1.0.0", name: "Notes agent" },
    sources: [{ id: "notes", version: "1.0.0", tools: [{ name: "notes_list", risk: "read" as const, approvalMode: "automatic" as const }] }],
    skills: [],
  };
  const manifest = buildRunManifest({
    platform: "temporal",
    variant: "baseline",
    task: { kind: "prompt", prompt: "List the notes." },
    model: { provider: "fake", model: "fake-success" },
    capabilities: { tools: { enabledNames: ["notes_list"], maxRounds: 2, maxCalls: 3 }, inventory },
  }, { runId: "temporal-capability-test", platformConfig: runner.manifestConfiguration() });

  await runner.start(manifest);

  assert.deepEqual(workflowInput?.inventory, inventory);
});
