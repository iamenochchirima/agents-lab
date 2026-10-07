import test from "node:test";
import assert from "node:assert/strict";
import { createLocalFixtureServer } from "../../src/capabilities/integrations/local-fixture/service.js";

test("disposable namespaces inspect real HTTP effects independently of model text", async () => {
  const fixture = await createLocalFixtureServer({ port: 0 });
  try {
    fixture.seed("trial", { record: "before" }); fixture.seed("other", { record: "preserved" });
    const send = async (operation: string, input: unknown, idempotencyKey: string | null) => {
      const response = await fetch(`http://${fixture.host}:${fixture.port}/v1/connection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "fixture-call", operation, input, idempotencyKey }) });
      return response.json();
    };
    fixture.failLookup("trial:record", "Read trial:alternate instead.");
    assert.equal((await send("fixture.lookup", { key: "trial:record" }, null)).statusCode, 400);
    assert.equal((await send("fixture.lookup", { key: "trial:record" }, null)).body.value, "before");
    for (let count = 0; count < 2; count++) await send("fixture.write", { key: "trial:record", value: "after" }, "one-write");
    const state = fixture.snapshot("trial");
    assert.equal(state.effectCount, 1); assert.equal(state.writeAttemptCount, 2); assert.equal(state.lookupCount, 2);
    assert.equal(state.values["trial:record"], "after");
    fixture.resetNamespace("trial"); assert.equal(fixture.snapshot("trial").effectCount, 0);
    assert.equal(fixture.snapshot("other").values["other:record"], "preserved");
    assert.throws(() => fixture.seed("../bad", {}));
  } finally { await fixture.close(); }
});
