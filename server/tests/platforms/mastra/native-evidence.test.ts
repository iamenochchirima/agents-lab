import assert from "node:assert/strict";
import test from "node:test";

import { validateMastraNativeEvidence } from "../../../src/platforms/mastra/runner-adapter/native-evidence.js";

test("Mastra native evidence accepts bounded baseline and workflow projections", () => {
  assert.doesNotThrow(() => validateMastraNativeEvidence({
    schemaVersion: 2,
    evidenceSchema: "mastra.native.v2",
    mastraVersion: "1.66.0",
    agentId: "mastra-baseline-agent",
    operation: "agent.generate",
    processScoped: true,
    storage: "none",
    modelProvider: "fake",
    model: "fake-success",
    eventCount: 3,
  }, "baseline"));
  assert.doesNotThrow(() => validateMastraNativeEvidence({
    schemaVersion: 2,
    evidenceSchema: "mastra.native.v2",
    mastraVersion: "1.66.0",
    workflowId: "mastra-agent-workflow",
    workflowRunId: "run-1",
    storage: "libsql-file",
    processScoped: false,
    localSingleProcess: true,
    nativeStatus: "suspended",
  }, "workflow"));
});

test("Mastra native evidence rejects version drift, unbounded counts, and unsafe strings", () => {
  assert.throws(
    () => validateMastraNativeEvidence({
      schemaVersion: 1,
      evidenceSchema: "mastra.native.v2",
      mastraVersion: "1.66.0",
      operation: "agent.generate",
      processScoped: true,
      storage: "none",
    }, "baseline"),
    /mastra\.native\.v2/,
  );
  assert.throws(
    () => validateMastraNativeEvidence({
      schemaVersion: 2,
      evidenceSchema: "mastra.native.v2",
      mastraVersion: "1.66.0",
      operation: "agent.generate",
      processScoped: true,
      storage: "none",
      eventCount: 100_001,
    }, "baseline"),
    /eventCount/,
  );
  assert.throws(
    () => validateMastraNativeEvidence({
      schemaVersion: 2,
      evidenceSchema: "mastra.native.v2",
      mastraVersion: "1.66.0",
      operation: "agent.generate",
      processScoped: true,
      storage: "none",
      model: "secret\nmodel",
    }, "baseline"),
    /model/,
  );
});
