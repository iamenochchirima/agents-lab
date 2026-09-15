import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidAwsStepFunctionsConfigError,
  loadAwsStepFunctionsConfig,
  safeManifestConfiguration,
} from "../../../src/platforms/aws-step-functions/config.js";

test("local Step Functions config has safe defaults and no provider secret", () => {
  const config = loadAwsStepFunctionsConfig({
    OPENROUTER_API_KEY: "sk-test-secret",
    AGENTLAB_AWS_STEP_FUNCTIONS_WORKER_ENABLED: "false",
  });
  const safe = safeManifestConfiguration(config);
  assert.equal(config.profile, "local");
  assert.equal(config.endpointUrl, "http://127.0.0.1:8083");
  assert.equal(safe.executionType, "STANDARD");
  assert.equal(JSON.stringify(safe).includes("sk-test-secret"), false);
});

test("hosted profile requires explicit native resources", () => {
  assert.throws(
    () => loadAwsStepFunctionsConfig({ AGENTLAB_AWS_STEP_FUNCTIONS_PROFILE: "aws" }),
    (error: unknown) => error instanceof InvalidAwsStepFunctionsConfigError && /requires/.test(error.message),
  );
});

test("config rejects a model timeout that can outlive its Activity", () => {
  assert.throws(
    () => loadAwsStepFunctionsConfig({
      AGENTLAB_AWS_STEP_FUNCTIONS_MODEL_TIMEOUT_MS: "31000",
      AGENTLAB_AWS_STEP_FUNCTIONS_ACTIVITY_TIMEOUT_SECONDS: "30",
    }),
    /must not exceed the Activity timeout/,
  );
});
