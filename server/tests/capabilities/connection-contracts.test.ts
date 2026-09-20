import assert from "node:assert/strict";
import test from "node:test";

import {
  isSafeConnectionRef,
  type ConnectionResult,
} from "../../src/capabilities/integrations/contracts.js";
import { summarizeConnectionResult } from "../../src/capabilities/integrations/runtime.js";
import {
  InvalidRunRequestError,
  validateRunRequest,
} from "../../src/control-plane/domain/manifest.js";
import type { RunRequest } from "../../src/control-plane/domain/types.js";

const baseRequest: RunRequest = {
  platform: "temporal",
  variant: "baseline",
  task: { kind: "prompt", prompt: "Read the local fixture." },
  model: { provider: "fake", model: "fake-success" },
};

function requestWithConnection(connectionRef: string): RunRequest {
  return {
    ...baseRequest,
    capabilities: {
      tools: {
        enabledNames: ["fixture_lookup"],
        maxRounds: 2,
        maxCalls: 4,
      },
      connections: [
        {
          toolName: "fixture_lookup",
          connectionRef,
          operations: ["lookup"],
        },
      ],
    },
  };
}

test("connection references accept opaque local IDs and reject secrets or endpoints", () => {
  assert.equal(isSafeConnectionRef("conn_local_fixture"), true);
  assert.equal(isSafeConnectionRef("Bearer sk-live-secret"), false);
  assert.equal(isSafeConnectionRef("https://api.example.test/v1"), false);
});

test("run validation accepts a valid connection binding and rejects non-prefixed bindings", () => {
  assert.doesNotThrow(() => validateRunRequest(requestWithConnection("conn_local_fixture")));

  assert.throws(
    () => validateRunRequest(requestWithConnection("local_fixture")),
    (error: unknown) => error instanceof InvalidRunRequestError,
  );
});

test("connection evidence is bounded and excludes headers, tokens, and raw bodies", () => {
  const result: ConnectionResult = {
    requestId: "run-1:turn-1:call-1",
    status: "failed",
    output: {
      headers: { authorization: "Bearer header-secret" },
      token: "oauth-token-secret",
      rawBody: "raw-provider-body-".repeat(10_000),
    },
    attempts: [
      {
        requestId: "run-1:turn-1:call-1",
        attempt: 1,
        startedAt: "2026-09-20T00:00:00.000Z",
        finishedAt: "2026-09-20T00:00:00.010Z",
        status: "failed",
        retryable: false,
        providerRequestId: "provider-request-1",
        errorCode: "HTTP_500",
        errorMessage: "Bearer error-secret",
      },
    ],
    error: {
      code: "HTTP_500",
      message: "provider body contained password=password-secret",
    },
  };

  const evidence = summarizeConnectionResult(result);
  assert.deepEqual(evidence, {
    requestId: "run-1:turn-1:call-1",
    status: "failed",
    attemptCount: 1,
    providerRequestIds: ["provider-request-1"],
    errorCode: "HTTP_500",
  });

  const serialized = JSON.stringify(evidence);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 1_024);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("header-secret"), false);
  assert.equal(serialized.includes("oauth-token-secret"), false);
  assert.equal(serialized.includes("raw-provider-body"), false);
  assert.equal(serialized.includes("error-secret"), false);
  assert.equal(serialized.includes("password-secret"), false);
});
