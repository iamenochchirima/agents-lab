import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadLocalServerEnvironment } from "../../src/control-plane/bootstrap/local-env.js";

test("local server environment loads supported values and preserves explicit values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentlab-local-env-"));
  const filePath = join(directory, ".env");
  await writeFile(
    filePath,
    [
      "AGENTLAB_ALLOWED_MODEL_PROVIDERS=fake,openrouter",
      "OPENROUTER_API_KEY='local-secret'",
      "COMPUTER_NATIVE_PROVIDER=ignored",
    ].join("\n"),
  );

  const environment: NodeJS.ProcessEnv = {
    OPENROUTER_API_KEY: "explicit-secret",
  };

  const loaded = loadLocalServerEnvironment(environment, filePath);

  assert.deepEqual(loaded, ["AGENTLAB_ALLOWED_MODEL_PROVIDERS"]);
  assert.equal(environment.AGENTLAB_ALLOWED_MODEL_PROVIDERS, "fake,openrouter");
  assert.equal(environment.OPENROUTER_API_KEY, "explicit-secret");
  assert.equal(environment.COMPUTER_NATIVE_PROVIDER, undefined);
});

test("missing local server environment is a no-op", () => {
  const environment: NodeJS.ProcessEnv = {};

  assert.deepEqual(loadLocalServerEnvironment(environment, "/tmp/agentlab-env-does-not-exist"), []);
  assert.deepEqual(environment, {});
});
