import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { baselineWorkflow } from "../src/platforms/restate/service/baseline-service.js";
import type { RestateWorkflowInput, RestateWorkflowResult } from "../src/platforms/restate/variants/baseline/contracts.js";

const RUN_ID = "restate-testcontainer-run";
const clients = (await import(platformDependency("restate-sdk-clients"))) as unknown as {
  connect(options: { readonly url: string }): {
    workflowClient(definition: typeof baselineWorkflow, key: string): {
      workflowSubmit(input: RestateWorkflowInput): Promise<{ readonly status: string; readonly attachable: boolean }>;
      workflowAttach(): Promise<RestateWorkflowResult>;
    };
  };
};
const { RestateContainer, RestateTestEnvironment } = (await import(platformDependency("restate-sdk-testcontainers"))) as unknown as {
  RestateContainer: new (version: string) => unknown;
  RestateTestEnvironment: {
    start(options: {
      readonly services: readonly unknown[];
      readonly alwaysReplay: boolean;
      readonly disableRetries: boolean;
      readonly container: () => unknown;
    }): Promise<{
      baseUrl(): string;
      stateOf(service: typeof baselineWorkflow, key: string): { get(name: string): Promise<unknown> };
      stop(): Promise<void>;
    }>;
  };
};

test(
  "real Restate test environment replays the baseline workflow and retains state",
  {
    skip:
      process.env.AGENTLAB_RUN_RESTATE_INTEGRATION === "1"
        ? false
        : "Set AGENTLAB_RUN_RESTATE_INTEGRATION=1 to run the Docker-backed Restate integration test.",
  },
  async () => {
    const environment = await RestateTestEnvironment.start({
      services: [baselineWorkflow],
      alwaysReplay: true,
      disableRetries: true,
      container: () => new RestateContainer("1.7.10"),
    });

    try {
      const ingress = clients.connect({ url: environment.baseUrl() });
      const input: RestateWorkflowInput = {
        runId: RUN_ID,
        prompt: "integration prompt",
        systemInstruction: "Be concise.",
        model: { provider: "fake", model: "fake-success" },
      };
      const workflow = ingress.workflowClient(baselineWorkflow, `agentlab:${RUN_ID}`);
      const submission = await workflow.workflowSubmit(input);
      const result = await workflow.workflowAttach();
      const state = await environment.stateOf(baselineWorkflow, `agentlab:${RUN_ID}`).get("status");

      assert.equal(submission.status, "Accepted");
      assert.equal(submission.attachable, true);
      assert.equal(result.runId, RUN_ID);
      assert.equal(result.status, "completed");
      assert.equal(result.output, "Fake response: integration prompt");
      assert.equal(result.eventIntents.at(-1)?.kind, "RunCompleted");
      assert.deepEqual(state, { status: "completed", runId: RUN_ID, finishedAt: result.finishedAt });
    } finally {
      await environment.stop();
    }
  },
);

function platformDependency(packageName: string): string {
  const sourcePath = new URL(`../src/platforms/restate/node_modules/@restatedev/${packageName}/dist/index.js`, import.meta.url);
  if (existsSync(fileURLToPath(sourcePath))) return fileURLToPath(sourcePath);
  return fileURLToPath(new URL(`../../node_modules/@restatedev/${packageName}/dist/index.js`, import.meta.url));
}
