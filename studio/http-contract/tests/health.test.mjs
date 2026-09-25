import assert from "node:assert/strict";
import test from "node:test";

import { isStudioApiHealth } from "../dist/index.js";

test("health guard accepts the stable Studio API identity", () => {
  assert.equal(isStudioApiHealth({ service: "studio-api", status: "ok", apiVersion: "1" }), true);
});

test("health guard rejects incomplete and unrelated JSON", () => {
  assert.equal(isStudioApiHealth({ service: "studio-api", status: "ok" }), false);
  assert.equal(isStudioApiHealth(null), false);
  assert.equal(isStudioApiHealth("ok"), false);
});
