import assert from "node:assert/strict";
import test from "node:test";

import { DeferredPlatformRunner } from "../../src/control-plane/bootstrap/deferred-runner.js";
import type { PlatformRunner } from "../../src/control-plane/ports/runner.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function runner(overrides: Partial<PlatformRunner> = {}): PlatformRunner {
  return {
    platform: "temporal", variant: "baseline",
    manifestConfiguration: () => ({ native: "retained" }),
    validate: () => ({ valid: true, reason: null }),
    checkConnection: async () => ({ reachable: false, message: "Initialization failed. Restart to retry." }),
    start: async () => { throw new Error("No client"); },
    cancel: async () => { throw new Error("No client"); },
    inspect: async () => { throw new Error("No client"); },
    ...overrides,
  };
}

test("a blocked optional connector does not block probes, metadata, or shutdown", async () => {
  const deferred = new DeferredPlatformRunner(runner(), () => new Promise(() => {}));
  assert.deepEqual(deferred.manifestConfiguration(), { native: "retained" });
  assert.equal(deferred.validate({} as never).valid, true);
  assert.deepEqual(await deferred.checkConnection(), { reachable: false, message: "temporal/baseline is initializing." });
  await assert.rejects(deferred.start({} as never), /initializing/);
  assert.equal(deferred.resume, undefined);
  await deferred.close();
  assert.equal((await deferred.checkConnection()).reachable, false);
  await assert.rejects(deferred.start({} as never), /closed/);
});

test("connector failures become safe unavailable status, including synchronous throws", async () => {
  for (const connect of [
    () => Promise.reject(new Error("credential=private")),
    () => { throw new Error("credential=private"); },
  ]) {
    const deferred = new DeferredPlatformRunner(runner(), connect);
    await turn();
    assert.deepEqual(await deferred.checkConnection(), { reachable: false, message: "Initialization failed. Restart to retry." });
    await assert.rejects(deferred.start({} as never), /unavailable/);
    await deferred.close();
  }
});

test("initialized runner delegates native execution and optional resume, and closes once", async () => {
  let closes = 0;
  const reference = { native: "reference" } as never;
  const inspection = { native: "inspection" } as never;
  const cancellation = { accepted: true, alreadyTerminal: false, message: "cancelled" };
  const resumption = { accepted: true, alreadyTerminal: false, message: "resumed" };
  const native = runner({
    checkConnection: async () => ({ reachable: true, message: "Native probe succeeded." }),
    start: async () => reference,
    inspect: async () => inspection,
    cancel: async (_reference, reason) => { assert.equal(reason, "user cancellation"); return cancellation; },
    resume: async (_reference, input) => { assert.equal(input, "approved"); return resumption; },
    close: async () => { closes++; },
  });
  const deferred = new DeferredPlatformRunner(runner({ resume: native.resume }), async () => native);
  await turn();
  assert.equal((await deferred.checkConnection()).reachable, true);
  assert.equal(await deferred.start({} as never), reference);
  assert.equal(await deferred.inspect(reference), inspection);
  assert.equal(await deferred.cancel(reference, "user cancellation"), cancellation);
  assert.equal(await deferred.resume!(reference, "approved"), resumption);
  await Promise.all([deferred.close(), deferred.close()]);
  assert.equal(closes, 1);
});

test("shutdown disposes a runner that finishes connecting later without publishing readiness", async () => {
  let resolve!: (runner: PlatformRunner) => void;
  let closes = 0;
  const deferred = new DeferredPlatformRunner(runner(), () => new Promise((done) => { resolve = done; }));
  await turn();
  await deferred.close();
  resolve(runner({ close: async () => { closes++; } }));
  await turn();
  assert.equal(closes, 1);
  assert.deepEqual(await deferred.checkConnection(), { reachable: false, message: "temporal/baseline is closed." });
  await assert.rejects(deferred.start({} as never), /closed/);
});
