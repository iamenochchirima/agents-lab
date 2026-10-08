import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gradeExtension, EXTENSION_CHECKS } from "../../src/evals/extension-contracts.js";
import { readExtensionEvidence } from "../../src/control-plane/application/eval-extension-evidence.js";

test("extension projection validates original assertions and does not infer missing completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "extension-projection-"));
  try {
    const report = gradeExtension({caseId: "X02", platform: "mastra", variant: "baseline", deployment: "synthetic", claimed: true, reason: "synthetic credential sentinel", observations: EXTENSION_CHECKS.X02.map(check => ({check, observed: true, sources: ["synthetic-run"]}))});
    const envelope = { schemaVersion: 1, mode: "scripted-native", metadata: { completedAt: "2026-10-08T00:00:00Z" }, reports: [report] };
    for (const id of ["valid", "tampered", "unfinished"]) await mkdir(join(root, ".review-proof", id), {recursive: true});
    await writeFile(join(root, ".review-proof/valid/extensions.json"), JSON.stringify(envelope));
    await writeFile(join(root, ".review-proof/tampered/extensions.json"), JSON.stringify({...envelope, reports: [{...report, verdict: "fail"}]}));
    await writeFile(join(root, ".review-proof/unfinished/extensions.json"), JSON.stringify({...envelope, metadata: {completedAt: null}}));
    const result = await readExtensionEvidence(root, ["credential sentinel"]);
    assert.equal(result.envelopes.length, 1);
    assert.equal(result.envelopes[0].reports[0].verdict, "pass");
    assert.equal(result.envelopes[0].reports[0].reason, "synthetic [REDACTED]");
    assert.equal(result.issues.length, 2);
    assert.equal(result.envelopes[0].revision, null);
  } finally { await rm(root, {recursive: true, force: true}); }
});
