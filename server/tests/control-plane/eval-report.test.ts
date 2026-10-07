import assert from "node:assert/strict";
import test from "node:test";
import { assertRunEvalReport, type RunEvalReport } from "../../src/control-plane/domain/eval-report.js";
const report: RunEvalReport = { schemaVersion: 1, suiteVersion: "1", graderVersion: "1", caseId: "B01", trialId: "t", ownerRunId: "r", runIds: ["r"], verdict: "pass", assertions: [{ id: "completion", passed: true, expected: true, observed: true }], observations: [], metadata: { revision: null, dirty: false, versions: {}, startedAt: "2026-10-07T00:00:00Z", completedAt: "2026-10-07T00:00:00Z", trialCount: 1 } };
test("historical schema-v1 reports remain readable and live probes require explicit mode", () => {
  assert.doesNotThrow(() => assertRunEvalReport(report));
  assert.doesNotThrow(() => assertRunEvalReport({ ...report, caseId: "L01", mode: "live", metadata: { ...report.metadata, model: { requested: "model:free", provider: "openrouter" } } }));
  assert.doesNotThrow(() => assertRunEvalReport({ ...report, caseId: "L03", mode: "live", runIds: ["r", "r2"] }));
  assert.throws(() => assertRunEvalReport({ ...report, caseId: "L01" }), /Invalid/);
  assert.throws(() => assertRunEvalReport({ ...report, mode: "live" }), /Invalid/);
  assert.throws(() => assertRunEvalReport({ ...report, caseId: "L01", mode: "live", runIds: ["r", "r2"] }), /Invalid/);
});
