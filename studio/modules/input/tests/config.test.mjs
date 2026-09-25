import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_INPUT_CONFIG, InputConfigError, parseInputConfig } from "../dist/index.js";

test("input config supplies documented defaults and accepts bounded overrides", () => {
  assert.deepEqual(parseInputConfig(), DEFAULT_INPUT_CONFIG);
  assert.deepEqual(parseInputConfig({ maxTextBytes: 1024, maxAttachments: 0 }), {
    maxTextBytes: 1024,
    maxAttachments: 0,
  });
});

test("input config rejects invalid bounds, types, and unknown settings", () => {
  assert.throws(() => parseInputConfig({ maxTextBytes: 0 }), InputConfigError);
  assert.throws(() => parseInputConfig({ maxTextBytes: null }), InputConfigError);
  assert.throws(() => parseInputConfig({ maxAttachments: "2" }), InputConfigError);
  assert.throws(() => parseInputConfig({ trustUntrusted: true }), InputConfigError);
});
