import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildRunManifest } from "../src/control-plane/domain/manifest.js";
import { RunEvidenceStore } from "../src/control-plane/application/evidence-store.js";
import { PlatformRegistry } from "../src/control-plane/application/platform-registry.js";
import { RunService } from "../src/control-plane/application/run-service.js";
import { loadServerConfig } from "../src/control-plane/bootstrap/config.js";
import { buildControlPlaneServer } from "../src/control-plane/http/server.js";
import { CharacterTokenEstimator, ContextService, ContextSessionStore } from "../src/capabilities/context/index.js";
import { loadRestateConfig } from "../src/platforms/restate/config.js";
import {
  RestateBaselineRunner,
  type RestateIngress,
} from "../src/platforms/restate/runner-adapter/restate-runner.js";
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
      adminAPIBaseUrl(): string;
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
        tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 },
      };
      const runner = RestateBaselineRunner.fromOptions({
        config: loadRestateConfig({
          AGENTLAB_RESTATE_INGRESS_URL: environment.baseUrl(),
          AGENTLAB_RESTATE_ADMIN_URL: environment.adminAPIBaseUrl(),
        }),
        ingress: ingress as unknown as RestateIngress,
      });
      const manifest = buildRunManifest({
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: input.prompt },
        model: input.model,
      }, { runId: RUN_ID, platformConfig: runner.manifestConfiguration() });
      const reference = await runner.start(manifest);
      const workflow = ingress.workflowClient(baselineWorkflow, reference.executionId);
      const result = await workflow.workflowAttach();
      const state = await environment.stateOf(baselineWorkflow, `agentlab:${RUN_ID}`).get("status");
      const inspection = await runner.inspect(reference);
      const cancellation = await runner.cancel(reference, "already complete");

      assert.equal(reference.native.submissionOutcome, "accepted");
      assert.equal(result.runId, RUN_ID);
      assert.equal(result.status, "completed");
      assert.equal(result.output, "Fake response: integration prompt");
      assert.equal(result.eventIntents.at(-1)?.kind, "RunCompleted");
      assert.deepEqual(state, { status: "completed", runId: RUN_ID, finishedAt: result.finishedAt });
      assert.equal(inspection.status, "completed");
      assert.equal(cancellation.alreadyTerminal, true);

      const toolRunId = `${RUN_ID}-tool-loop`;
      const toolInput: RestateWorkflowInput = {
        runId: toolRunId,
        prompt: "Calculate twenty plus twenty-two.",
        systemInstruction: "Use the calculator when appropriate.",
        model: { provider: "fake", model: "fake-tool-call" },
        tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 },
      };
      const toolManifest = buildRunManifest({
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: toolInput.prompt },
        model: toolInput.model,
      }, { runId: toolRunId, platformConfig: runner.manifestConfiguration() });
      const toolReference = await runner.start(toolManifest);
      const toolWorkflow = ingress.workflowClient(baselineWorkflow, toolReference.executionId);
      const toolResult = await toolWorkflow.workflowAttach();

      assert.equal(toolResult.status, "completed");
      assert.equal(toolResult.output, 'The calculator returned {"value":42}.');
      assert.deepEqual(
        toolResult.eventIntents.filter((event) => event.kind.startsWith("Tool")).map((event) => event.kind),
        ["ToolCallRequested", "ToolCallValidated", "ToolExecutionStarted", "ToolExecutionCompleted"],
      );
      assert.equal(toolResult.eventIntents.filter((event) => event.kind === "ModelRequested").length, 2);
      assert.equal(toolResult.metrics.toolCallCount, 1);
      assert.equal(toolResult.metrics.toolAttemptCount, 1);
    } finally {
      await environment.stop();
    }
  },
);

test(
  "native Restate server runs the baseline workflow without Docker and projects evidence",
  {
    skip:
      process.env.AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION === "1"
        ? false
        : "Set AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 with the native Restate server and service running.",
  },
  async () => {
    const config = loadRestateConfig(process.env);
    const runner = await RestateBaselineRunner.connect(config);
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);

    const runId = `restate-native-${Date.now()}`;
    const manifest = buildRunManifest(
      {
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Calculate twenty plus twenty-two." },
        model: { provider: "fake", model: "fake-tool-call" },
      },
      { runId, platformConfig: runner.manifestConfiguration() },
    );
    assert.equal(runner.validate(manifest).valid, true);

    const runRoot = await mkdtemp(join(tmpdir(), "agentlab-restate-native-"));
    try {
      const evidence = new RunEvidenceStore(runRoot);
      await evidence.createRun(manifest);
      let reference = await runner.start(manifest);
      await evidence.writeExecutionReference(runId, reference);

      let terminal = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const inspection = await runner.inspect(reference);
        reference = inspection.reference;
        await evidence.writeExecutionReference(runId, reference);
        if (inspection.result) {
          for (const event of inspection.eventIntents) await evidence.appendEvent(event);
          await evidence.writeResult(inspection.result);
          if (inspection.trajectory) await evidence.writeTrajectory(inspection.trajectory);
          if (inspection.metrics) await evidence.writeMetrics(inspection.metrics);
          terminal = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.equal(terminal, true, "native Restate workflow did not reach a terminal result");
      const snapshot = await evidence.readSnapshot(runId);
      assert.equal(snapshot.result?.status, "completed");
      assert.equal(snapshot.result?.output, 'The calculator returned {"value":42}.');
      assert.deepEqual(snapshot.events.filter((event) => event.kind.startsWith("Tool")).map((event) => event.kind), [
        "ToolCallRequested",
        "ToolCallValidated",
        "ToolExecutionStarted",
        "ToolExecutionCompleted",
      ]);
      assert.equal(snapshot.metrics?.toolCallCount, 1);
      assert.equal(snapshot.metrics?.toolAttemptCount, 1);
      assert.equal(snapshot.executionReference?.native.serviceName, "AgentLabRestateBaseline");

      const duplicateReference = await runner.start(manifest);
      assert.equal(duplicateReference.executionId, reference.executionId);
      assert.equal(duplicateReference.native.submissionOutcome, "already_accepted");
      const duplicateInspection = await runner.inspect(duplicateReference);
      assert.equal(duplicateInspection.result?.output, 'The calculator returned {"value":42}.');
      assert.equal(duplicateInspection.metrics?.toolCallCount, 1);

      // Native Restate retains completed workflow keys. Keep the cancellation
      // fixture unique so a previous local test run cannot turn this active
      // cancellation check into an already-terminal invocation.
      const cancelRunId = `restate-native-${Date.now()}-cancel`;
      const cancelManifest = buildRunManifest({
        platform: "restate",
        variant: "baseline",
        task: { kind: "prompt", prompt: "Cancel this delayed run." },
        model: { provider: "fake", model: "fake-delay" },
      }, { runId: cancelRunId, platformConfig: runner.manifestConfiguration() });
      const cancelReference = await runner.start(cancelManifest);
      let cancellation = await runner.cancel(cancelReference, "integration cancellation");
      for (let attempt = 0; attempt < 20 && !cancellation.accepted && !cancellation.alreadyTerminal; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        cancellation = await runner.cancel(cancelReference, "integration cancellation");
      }
      assert.equal(cancellation.accepted, true, cancellation.message);

      let cancelledInspection = await runner.inspect(cancelReference);
      for (let attempt = 0; attempt < 100 && !cancelledInspection.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        cancelledInspection = await runner.inspect(cancelReference);
      }
      assert.equal(cancelledInspection.result?.status, "cancelled");
      assert.equal(cancelledInspection.result?.error?.failureKind, "cancelled");
      assert.equal(cancelledInspection.eventIntents.at(-1)?.kind, "RunCancelled");
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  },
);

test(
  "native Restate baseline runs through the generic HTTP API",
  {
    skip:
      process.env.AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION === "1"
        ? false
        : "Set AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 with the native Restate server and service running.",
  },
  async () => {
    const restateConfig = loadRestateConfig(process.env);
    const runner = await RestateBaselineRunner.connect(restateConfig);
    const connectivity = await runner.checkConnection();
    assert.equal(connectivity.reachable, true, connectivity.message);

    const runRoot = await mkdtemp(join(tmpdir(), "agentlab-restate-api-"));
    const config = loadServerConfig(
      {
        AGENTLAB_RUN_ROOT: runRoot,
        AGENTLAB_CONTEXT_ROOT: restateConfig.contextRoot,
        AGENTLAB_ALLOWED_MODEL_PROVIDERS: "fake",
      },
      process.cwd(),
    );
    const evidence = new RunEvidenceStore(runRoot);
    const registry = new PlatformRegistry([runner]);
    const context = new ContextService(new ContextSessionStore(config.contextRoot, config.context), new CharacterTokenEstimator());
    const service = new RunService({ config, context, evidence, registry });
    const app = buildControlPlaneServer({ config, service, evidence, registry });
    const contextSessionId = `restate-native-context-${Date.now()}`;

    try {
      await app.ready();
      const createdResponse = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          platform: "restate",
          variant: "baseline",
          task: { kind: "prompt", prompt: "Calculate twenty plus twenty-two." },
          model: { provider: "fake", model: "fake-tool-call", contextWindowTokens: 128_000 },
        },
      });
      assert.equal(createdResponse.statusCode, 202, createdResponse.body);

      type ApiRun = {
        runId: string;
        status: string;
        events: readonly { kind: string }[];
        result: { output: string } | null;
        executionReference: { executionId: string } | null;
        context?: { budget: { remainingPercent: number | null } } | null;
      };
      let run = createdResponse.json() as ApiRun;
      for (let attempt = 0; attempt < 100 && !run.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const inspectionResponse = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}` });
        assert.equal(inspectionResponse.statusCode, 200, inspectionResponse.body);
        run = inspectionResponse.json() as typeof run;
      }

      assert.equal(run.status, "completed");
      assert.equal(run.result?.output, 'The calculator returned {"value":42}.');
      assert.deepEqual(run.events.filter((event) => event.kind.startsWith("Tool")).map((event) => event.kind), [
        "ToolCallRequested",
        "ToolCallValidated",
        "ToolExecutionStarted",
        "ToolExecutionCompleted",
      ]);
      assert.match(run.executionReference?.executionId ?? "", /^agentlab:/);
      for (const file of ["config.json", "events.jsonl", "trajectory.json", "metrics.json", "result.json", "native/restate.json"]) {
        const response = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}/evidence/${file}` });
        assert.equal(response.statusCode, 200, `${file}: ${response.body}`);
      }
      const configResponse = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(run.runId)}/evidence/config.json` });
      const storedManifest = configResponse.json() as { platformConfig?: { tools?: { enabledNames?: readonly string[] } } };
      assert.deepEqual(storedManifest.platformConfig?.tools?.enabledNames, ["calculator"]);
      assert.equal(configResponse.body.includes("OPENROUTER_API_KEY"), false);

      const contextRun = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          platform: "restate",
          variant: "baseline",
          sessionId: contextSessionId,
          clientTurnId: "turn-one",
          task: { kind: "prompt", prompt: "Remember conformance-4318." },
          model: { provider: "fake", model: "fake-context", contextWindowTokens: 128_000 },
        },
      });
      assert.equal(contextRun.statusCode, 202, contextRun.body);
      let firstContextRun = contextRun.json() as typeof run;
      for (let attempt = 0; attempt < 100 && !firstContextRun.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        firstContextRun = (await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(firstContextRun.runId)}` })).json() as typeof run;
      }
      assert.equal(firstContextRun.status, "completed");

      const continuationRun = await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          platform: "restate",
          variant: "baseline",
          sessionId: contextSessionId,
          clientTurnId: "turn-two",
          task: { kind: "prompt", prompt: "What value did you remember?" },
          model: { provider: "fake", model: "fake-context", contextWindowTokens: 128_000 },
        },
      });
      assert.equal(continuationRun.statusCode, 202, continuationRun.body);
      let secondContextRun = continuationRun.json() as typeof run;
      for (let attempt = 0; attempt < 100 && !secondContextRun.result; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        secondContextRun = (await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(secondContextRun.runId)}` })).json() as typeof run;
      }
      assert.equal(secondContextRun.status, "completed");
      assert.equal(secondContextRun.result?.output, "conformance-4318");
      assert.ok(secondContextRun.events.some((event) => event.kind === "ContextPrepared"));
      assert.ok(secondContextRun.context?.budget.remainingPercent !== null);
      const contextResponse = await app.inject({ method: "GET", url: `/api/runs/${encodeURIComponent(secondContextRun.runId)}/evidence/context.json` });
      assert.equal(contextResponse.statusCode, 200, contextResponse.body);
    } finally {
      await app.close();
      await rm(join(restateConfig.contextRoot, contextSessionId), { recursive: true, force: true });
      await rm(runRoot, { recursive: true, force: true });
    }
  },
);

function platformDependency(packageName: string): string {
  const sourcePath = new URL(`../src/platforms/restate/node_modules/@restatedev/${packageName}/dist/index.js`, import.meta.url);
  if (existsSync(fileURLToPath(sourcePath))) return fileURLToPath(sourcePath);
  const serverNodeModulesPath = import.meta.url.includes("/dist/")
    ? `../../node_modules/@restatedev/${packageName}/dist/index.js`
    : `../node_modules/@restatedev/${packageName}/dist/index.js`;
  return fileURLToPath(new URL(serverNodeModulesPath, import.meta.url));
}
