import assert from "node:assert/strict";
import test from "node:test";

import { parseStudioApiConfig } from "../dist/config.js";
import { createStudioApiApp } from "../dist/http/app.js";

test("Studio API health returns only its stable public identity", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      service: "studio-api",
      status: "ok",
      apiVersion: "1",
    });
  } finally {
    await app.close();
  }
});

test("Studio API only grants browser CORS to the configured web origin", async () => {
  const app = await createStudioApiApp({ webOrigin: "http://127.0.0.1:5173" });
  try {
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const rejected = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://example.test" },
    });
    assert.equal(allowed.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
    assert.equal(rejected.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  } finally {
    await app.close();
  }
});

test("Studio API configuration rejects invalid ports and non-origin web URLs", () => {
  assert.deepEqual(parseStudioApiConfig({}), {
    host: "127.0.0.1",
    port: 4320,
    webOrigin: "http://localhost:5173",
  });
  assert.throws(() => parseStudioApiConfig({ STUDIO_API_PORT: "70000" }), /STUDIO_API_PORT/);
  assert.throws(() => parseStudioApiConfig({ STUDIO_API_WEB_ORIGIN: "http://localhost:5173/studio" }), /STUDIO_API_WEB_ORIGIN/);
});
