import assert from "node:assert/strict";
import test from "node:test";
import { getManagementSession, getManagementState, ManagementApiError } from "../src/features/platforms/managementApi.ts";

test("an unavailable backend reports an outage rather than an expired editing session", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 502 }));
  await assert.rejects(getManagementSession(), error => error instanceof ManagementApiError && error.status === 502 && /backend is running/.test(error.message) && !/Unlock/.test(error.message));
});

test("an expired local session renews automatically and retries the request once", async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (path: string) => {
    paths.push(path);
    if (paths.length === 1) return new Response("", { status: 401 });
    if (path.endsWith("/session")) return Response.json({ csrfToken: "new-csrf", owner: "local-workspace", expiresAt: "2099-01-01" });
    return Response.json({ revision: 21 });
  });
  assert.equal((await getManagementState()).revision, 21);
  assert.deepEqual(paths, ["/api/management/state", "/api/management/session", "/api/management/state"]);
});

test("session renewal does not loop if the retried request still fails", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (path: string) => {
    calls++;
    return path.endsWith("/session") ? Response.json({ csrfToken: "new-csrf" }) : new Response("", { status: 401 });
  });
  await assert.rejects(getManagementState(), error => error instanceof ManagementApiError && error.status === 401);
  assert.equal(calls, 3);
});
