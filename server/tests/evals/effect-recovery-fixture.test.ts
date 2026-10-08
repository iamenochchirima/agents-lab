import assert from "node:assert/strict";
import test from "node:test";
import { createEffectRecoveryFixture } from "../../src/evals/effect-recovery-fixture.js";
test("external fixture commits once before acknowledgement loss and recovers the same keyed receipt", async () => {
  const fixture = await createEffectRecoveryFixture();
  try {
    await assert.rejects(fixture.create("fixture-key", "disposable-ticket"));
    assert.equal(fixture.snapshot("fixture-key").effectCount, 1);
    const receipt = await fixture.create("fixture-key", "disposable-ticket");
    assert.equal(receipt.id, fixture.snapshot("fixture-key").ticket?.id);
    assert.equal(fixture.snapshot("fixture-key").attempts, 2);
    await assert.rejects(fixture.create("fixture-key", "conflicting-ticket"), /409/);
    assert.equal(fixture.snapshot("fixture-key").effectCount, 1);
  } finally { await fixture.close(); }
});
