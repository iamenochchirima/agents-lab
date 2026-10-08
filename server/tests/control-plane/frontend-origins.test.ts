import assert from "node:assert/strict";
import test from "node:test";
import { trustedFrontendOrigins } from "../../src/control-plane/bootstrap/frontend-origins.js";

test("loopback frontend aliases preserve the configured protocol and port", () => {
  const expected = ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"];
  for (const origin of expected) {
    assert.deepEqual(new Set(trustedFrontendOrigins(origin)), new Set(expected));
  }
  assert.deepEqual(new Set(trustedFrontendOrigins("https://localhost:8443")),
    new Set(["https://localhost:8443", "https://127.0.0.1:8443", "https://[::1]:8443"]));
});

test("hosted and non-loopback frontend origins are not expanded", () => {
  for (const origin of ["https://lab.example", "http://192.168.1.2:5173", "http://localhost.example:5173", "http://127.0.0.2:5173"]) {
    assert.deepEqual(trustedFrontendOrigins(origin), [origin]);
  }
});

test("loopback aliases do not trust other ports or protocols", () => {
  const origins = trustedFrontendOrigins("http://localhost:5173");
  for (const origin of ["http://127.0.0.1:5174", "https://127.0.0.1:5173", "http://localhost", "https://foreign.example"]) {
    assert.equal(origins.includes(origin), false);
  }
});
