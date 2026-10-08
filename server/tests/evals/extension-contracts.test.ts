import assert from "node:assert/strict";
import test from "node:test";
import { baselineExtensions, EXTENSION_CHECKS, gradeExtension, type ExtensionInput } from "../../src/evals/extension-contracts.js";
const input: ExtensionInput = { caseId: "X04", platform: "langgraph", variant: "baseline", deployment: "local-persistent", claimed: true,
  reason: "Native invocation review uses persisted checkpoints.", observations: EXTENSION_CHECKS.X04.map(check => ({ check, observed: true, sources: ["run:fixture/events.jsonl"] })) };
test("extension acceptance requires every named boundary and preserves failed controls", () => {
  assert.equal(gradeExtension(input).verdict, "pass");
  assert.equal(gradeExtension({ ...input, observations: input.observations.slice(1) }).verdict, "incomplete");
  assert.equal(gradeExtension({ ...input, observations: input.observations.map((value, index) => ({ ...value, observed: index !== 0 })) }).verdict, "fail");
  assert.throws(() => gradeExtension({ ...input, observations: [...input.observations, input.observations[0]!] }), /unique/);
  assert.throws(() => gradeExtension({ ...input, claimed: false }), /discard/);
});
test("baseline capability claims do not become passes from brand or unrelated telemetry", () => {
  const cases = baselineExtensions("temporal", "local-persistent");
  assert.equal(cases.find(value => value.caseId === "X03")?.verdict, "not-applicable");
  assert.equal(cases.filter(value => value.verdict === "incomplete").length, 4);
  assert.throws(() => gradeExtension({ ...input, observations: [{ check: "B11-dedup", observed: true, sources: ["events"] }] }), /supported/);
});
