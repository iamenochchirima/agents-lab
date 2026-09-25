import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_EXECUTION_ENVIRONMENT_CONFIG, ExecutionEnvironmentConfigError, parseExecutionEnvironmentConfig } from "../dist/index.js";

test("environment config defaults to no grants and a bounded operation timeout", () => {
  assert.deepEqual(parseExecutionEnvironmentConfig(), DEFAULT_EXECUTION_ENVIRONMENT_CONFIG);
  assert.deepEqual(parseExecutionEnvironmentConfig({ operationTimeoutMs: 1200, allowedCapabilities: [] }), {
    operationTimeoutMs: 1200,
    allowedCapabilities: [],
  });
});

test("environment config validates bounds and capability descriptors", () => {
  assert.throws(() => parseExecutionEnvironmentConfig(null), ExecutionEnvironmentConfigError);
  assert.throws(() => parseExecutionEnvironmentConfig({ operationTimeoutMs: null }), /operationTimeoutMs/);
  assert.throws(() => parseExecutionEnvironmentConfig({ allowedCapabilities: null }), /allowedCapabilities/);
  assert.throws(() => parseExecutionEnvironmentConfig({ operationTimeoutMs: "30000" }), /operationTimeoutMs/);
  assert.throws(() => parseExecutionEnvironmentConfig({ operationTimeoutMs: 0 }), /operationTimeoutMs/);
  assert.throws(() => parseExecutionEnvironmentConfig({ allowedCapabilities: [{ id: "fs" }] }), /version/);
  assert.throws(() => parseExecutionEnvironmentConfig({ allowedCapabilities: [{ id: "fs", version: "1", kind: "filesystem", operations: ["read", "read"] }] }), /duplicates/);
  assert.throws(() => parseExecutionEnvironmentConfig({ extra: true }), /Unknown/);
});
