import assert from "node:assert/strict";
import test from "node:test";

import { commandInput, commandName, testConfig } from "./helpers.js";
import { AwsStepFunctionsActivityWorker } from "../../../src/platforms/aws-step-functions/service/activity-worker.js";

test("Activity worker sends a complete output envelope through the native task token", async () => {
  const sent: object[] = [];
  const worker = new AwsStepFunctionsActivityWorker({
    api: { send: async (command) => { sent.push(command); return {}; } },
    config: testConfig(),
    modelRunner: { run: async () => ({ kind: "success", output: "done", providerRequestId: "provider-1", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }) },
    now: () => new Date("2026-09-15T10:00:00.000Z"),
  });
  await worker.processTask("token-1", JSON.stringify({ runId: "run-worker", prompt: "hello", systemInstruction: "be concise", provider: "fake", model: "fake-success", attempt: 0 }));
  assert.equal(sent.length, 1);
  assert.equal(commandName(sent[0]!), "SendTaskSuccessCommand");
  const input = commandInput(sent[0]!);
  assert.equal(input.taskToken, "token-1");
  assert.equal(JSON.parse(String(input.output)).result.output, "done");
  assert.equal(JSON.stringify(input).includes("token-1"), true);
});

test("Activity worker reports invalid input as a non-retryable native failure", async () => {
  const sent: object[] = [];
  const worker = new AwsStepFunctionsActivityWorker({
    api: { send: async (command) => { sent.push(command); return {}; } },
    config: testConfig(),
    modelRunner: { run: async () => { throw new Error("model must not run"); } },
  });
  await worker.processTask("token-invalid", "not-json");
  assert.equal(commandName(sent[0]!), "SendTaskFailureCommand");
  const input = commandInput(sent[0]!);
  assert.equal(input.error, "ActivityWorkerError");
  assert.equal(JSON.parse(String(input.cause)).retryable, false);
});

test("Activity worker does not replay a completion after an ambiguous task-token acknowledgement", async () => {
  const sent: object[] = [];
  const worker = new AwsStepFunctionsActivityWorker({
    api: {
      send: async (command) => {
        sent.push(command);
        throw new Error("task-token acknowledgement lost");
      },
    },
    config: testConfig(),
    modelRunner: { run: async () => ({ kind: "success", output: "done", providerRequestId: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null } }) },
  });
  await assert.rejects(
    () => worker.processTask("token-ambiguous", JSON.stringify({ runId: "run-worker", prompt: "hello", systemInstruction: "be concise", provider: "fake", model: "fake-success", attempt: 0 })),
    /task-token acknowledgement lost/,
  );
  assert.equal(sent.length, 1);
  assert.equal(commandName(sent[0]!), "SendTaskSuccessCommand");
});
