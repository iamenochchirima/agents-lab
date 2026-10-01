import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCuaAuthorizationHost,
  type CuaAuthorizationRequestView,
} from "../src/browser/cua-authorization.js";

const actions = { allow: 10 as never, deny: 20 as never, cancel: 30 as never };

function request(overrides: Partial<{
  schema: string;
  nonce: string;
  generation: bigint;
  daemonInstance: string;
  permissionMode: string;
  adapterId: string;
  riskClass: string;
  publicSession: string;
  transportSession: string;
  resourceJson: string;
  humanSummary: string;
  expiresUnixMs: bigint;
  requestDigest: string;
}> = {}) {
  return {
    schema: "cua.authorization.v1",
    nonce: "nonce",
    generation: 1n,
    daemonInstance: "daemon",
    permissionMode: "standard",
    adapterId: "browser",
    riskClass: "existing_profile",
    publicSession: "browser_session",
    transportSession: "transport",
    resourceJson: '{"pid":1234}',
    humanSummary: "Attach to the explicitly approved browser profile.",
    expiresUnixMs: 2_000n,
    requestDigest: "digest-1",
    ...overrides,
  };
}

test("Cua authorization host exposes a bounded request view and never resource JSON", async () => {
  let seen: CuaAuthorizationRequestView | undefined;
  const host = createCuaAuthorizationHost({
    actions,
    now: () => 1_000,
    authorize: async (view) => {
      seen = view;
      return "allow";
    },
  });

  const result = await host.authorize(request() as never);
  assert.deepEqual(result, { action: 10, requestDigest: "digest-1" });
  assert.deepEqual(seen, {
    schema: "cua.authorization.v1",
    requestDigest: "digest-1",
    adapterId: "browser",
    riskClass: "existing_profile",
    publicSession: "browser_session",
    humanSummary: "Attach to the explicitly approved browser profile.",
    expiresUnixMs: 2_000,
    resourceDigest: "d28203f757b6d839c0df5220da09a48640ec41394de7b21eb87fc49e81ea2470",
  });
  assert.equal("resourceJson" in (seen ?? {}), false);
});

test("Cua authorization host consumes a digest once, including concurrent calls", async () => {
  let calls = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const host = createCuaAuthorizationHost({
    actions,
    now: () => 1_000,
    authorize: async () => {
      calls += 1;
      await waiting;
      return "allow";
    },
  });

  const first = host.authorize(request() as never);
  const second = await host.authorize(request() as never);
  assert.deepEqual(second, { action: 30, requestDigest: "digest-1" });
  release();
  assert.deepEqual(await first, { action: 10, requestDigest: "digest-1" });
  assert.equal(calls, 1);
});

test("Cua authorization host cancels expired, malformed, and callback-free requests", async () => {
  const expired = createCuaAuthorizationHost({ actions, now: () => 2_000, authorize: async () => "allow" });
  assert.deepEqual(await expired.authorize(request() as never), { action: 30, requestDigest: "digest-1" });

  const malformed = createCuaAuthorizationHost({ actions, now: () => 1_000, authorize: async () => "allow" });
  assert.deepEqual(await malformed.authorize(request({ resourceJson: "x".repeat(65 * 1024) }) as never), { action: 30, requestDigest: "digest-1" });

  const callbackFree = createCuaAuthorizationHost({ actions, now: () => 1_000 });
  assert.deepEqual(await callbackFree.authorize(request() as never), { action: 30, requestDigest: "digest-1" });
});

test("Cua authorization host maps deny and callback failures without changing the digest", async () => {
  const denied = createCuaAuthorizationHost({ actions, now: () => 1_000, authorize: async () => "deny" });
  assert.deepEqual(await denied.authorize(request() as never), { action: 20, requestDigest: "digest-1" });

  const failed = createCuaAuthorizationHost({ actions, now: () => 1_000, authorize: async () => { throw new Error("ui failed"); } });
  assert.deepEqual(await failed.authorize(request() as never), { action: 30, requestDigest: "digest-1" });
});
