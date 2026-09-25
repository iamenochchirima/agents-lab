import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MODEL_INTERFACE_CONFIG, ModelInterfaceConfigError, parseModelInterfaceConfig } from "../dist/index.js";

test("model config supplies bounded single-attempt defaults", () => {
  assert.deepEqual(parseModelInterfaceConfig(), DEFAULT_MODEL_INTERFACE_CONFIG);
  assert.deepEqual(parseModelInterfaceConfig({ requestTimeoutMs: 1000, maxOutputTokens: 1, maxAttempts: 3 }), {
    requestTimeoutMs: 1000,
    maxOutputTokens: 1,
    maxAttempts: 3,
  });
});

test("model config rejects invalid bounds, types, and fields", () => {
  assert.throws(() => parseModelInterfaceConfig(null), ModelInterfaceConfigError);
  assert.throws(() => parseModelInterfaceConfig({ requestTimeoutMs: null }), /requestTimeoutMs/);
  assert.throws(() => parseModelInterfaceConfig({ maxOutputTokens: null }), /maxOutputTokens/);
  assert.throws(() => parseModelInterfaceConfig({ maxAttempts: null }), /maxAttempts/);
  assert.throws(() => parseModelInterfaceConfig({ requestTimeoutMs: 0 }), /requestTimeoutMs/);
  assert.throws(() => parseModelInterfaceConfig({ maxOutputTokens: "50" }), /maxOutputTokens/);
  assert.throws(() => parseModelInterfaceConfig({ maxAttempts: 4 }), /maxAttempts/);
  assert.throws(() => parseModelInterfaceConfig({ apiKey: "secret" }), /Unknown/);
});
