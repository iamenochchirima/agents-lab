import assert from "node:assert/strict";
import test from "node:test";

import { PlatformRegistry } from "../../src/control-plane/application/platform-registry.js";
import type { PlatformRunner } from "../../src/control-plane/ports/runner.js";

const temporalRunner = { platform: "temporal", variant: "baseline" } as PlatformRunner;

test("registry exposes only registered implementations as runnable", () => {
  const registry = new PlatformRegistry([temporalRunner]);

  assert.equal(registry.find("temporal", "baseline")?.status, "runnable");
  assert.equal(registry.find("temporal", "baseline")?.runner, temporalRunner);
  assert.equal(registry.find("restate", "baseline")?.status, "planned");
  assert.equal(registry.runnable({ platform: "temporal", variant: "baseline" } as never), temporalRunner);
});

test("unknown platform variants are not implicitly runnable", () => {
  const registry = new PlatformRegistry([]);

  assert.equal(registry.find("unknown", "baseline"), null);
  assert.equal(registry.runnable({ platform: "temporal", variant: "baseline" } as never), null);
});

test("registered adapters outside the planning catalog are still runnable", () => {
  const adapter = {
    platform: "test-adapter",
    variant: "baseline",
  } as PlatformRunner;
  const registry = new PlatformRegistry([adapter]);

  assert.equal(registry.find("test-adapter", "baseline")?.status, "runnable");
  assert.equal(registry.runnable({ platform: "test-adapter", variant: "baseline" } as never), adapter);
});
