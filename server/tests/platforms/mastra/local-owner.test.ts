import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireLocalOwner } from "../../../src/platforms/mastra/runner-adapter/local-owner.js";

test("concurrent dead-owner adoption admits one local owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "mastra-owner-"));
  try {
    await writeFile(join(root, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }));
    const claims = await Promise.all(Array.from({ length: 8 }, () => acquireLocalOwner(root)));
    const owners = claims.filter(claim => claim !== null);
    assert.equal(owners.length, 1);
    assert.equal(await acquireLocalOwner(root), null);
    await owners[0]!();
    const next = await acquireLocalOwner(root); assert.ok(next); await next();
  } finally { await rm(root, { recursive: true, force: true }); }
});
