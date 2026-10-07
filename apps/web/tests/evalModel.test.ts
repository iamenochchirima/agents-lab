import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readEvalCases } from "../src/features/evals/evalModel";

test("the frontend reads every saved case and preserves its acceptance criteria", () => {
  const source = readFileSync(new URL("../../../lab/scenarios/platform-agent-conformance/eval-cases.md", import.meta.url), "utf8");
  const cases = readEvalCases(source);
  assert.deepEqual(["B", "M", "X"].map(group => cases.filter(item => item.group === group).length), [12, 4, 5]);
  assert.match(cases.find(item => item.id === "B06")!.acceptance, /fixture state is unchanged/);
  assert.match(cases.find(item => item.id === "M01")!.acceptance, /direct answer fails/);
  assert.match(cases.find(item => item.id === "X02")!.acceptance, /external fixture's idempotency contract/);
});

test("invalid and duplicate case rows cannot silently disappear", () => {
  assert.throws(() => readEvalCases("| B01 missing cells | task |"), /Malformed/);
  const row = "| B01 completion | task | expected |";
  assert.throws(() => readEvalCases(`${row}\n${row}`), /Duplicate/);
  assert.equal(readEvalCases("| B01 completion | task \\| observation | expected |")[0].task, "task | observation");
});
