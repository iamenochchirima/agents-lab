import assert from "node:assert/strict";
import test from "node:test";
import { getManagementSession, ManagementApiError } from "../src/features/platforms/managementApi.ts";

test("an unavailable backend reports an outage rather than an expired editing session", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 502 }));
  await assert.rejects(getManagementSession(), error => error instanceof ManagementApiError && error.status === 502 && /backend is running/.test(error.message) && !/Unlock/.test(error.message));
});

test("an expired editing session remains distinguishable from a backend outage", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 401 }));
  await assert.rejects(getManagementSession(), error => error instanceof ManagementApiError && error.status === 401 && /Unlock/.test(error.message));
});
