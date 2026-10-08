import assert from "node:assert/strict";
import test from "node:test";
import { projectToolResult, toolResultEvidence } from "../../src/capabilities/tools/result-projection.js";
import type { ToolExecutionResult } from "../../src/capabilities/tools/contracts.js";

test("text-only native projection retains structured results and identifies unsupported media", () => {
  const result: ToolExecutionResult = { status: "completed", content: "raw source envelope", error: null, durationMs: 1, attemptCount: 1,
    effect: {state: "confirmed", evidence: "provider persistence"}, presentation: "valid", structuredContent: {owner: "Avery"},
    contentBlocks: [{type: "text", text: "Saved."}, {type: "image", data: "fictional-image", mimeType: "image/png"}, {type: "resource", resource: {uri: "fixture:report", text: "Report evidence."}}] };
  const projected = projectToolResult(result);
  assert.match(projected.content, /Saved\./);
  assert.match(projected.content, /Report evidence\./);
  assert.match(projected.content, /"owner":"Avery"/);
  assert.match(projected.content, /Unsupported tool content retained in evidence: image/);
  assert.equal(projected.content.includes("fictional-image"), false);
  assert.deepEqual(projected.unsupportedContent, ["image"]);
  const evidence = toolResultEvidence(result);
  assert.deepEqual(evidence.effect, result.effect);
  assert.deepEqual(evidence.contentBlocks, result.contentBlocks);
  assert.equal(projectToolResult({...result, contentBlocks: undefined}).content, `${result.content}\n${JSON.stringify(result.structuredContent)}`);
  assert.equal(projectToolResult({...result, contentBlocks: undefined, structuredContent: undefined}).content, result.content);
});
