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


test("equivalent JSON text and structure project once while distinct blocks and raw evidence remain", () => {
  const structuredContent = { owner: "Avery", constraints: [true, 1, { blocked: true }] };
  const text = ' { "constraints": [true, 1, {"blocked":true}], "owner": "Avery" } ';
  const result: ToolExecutionResult = { status: "completed", content: text, error: null, durationMs: 1, attemptCount: 1, structuredContent,
    contentBlocks: [{ type: "text", text }, { type: "text", text: "Separate provider explanation." }, { type: "text", text: '{"owner":"Different"}' }] };
  assert.equal(projectToolResult(result).content, `${text}\nSeparate provider explanation.\n{"owner":"Different"}`);
  assert.equal(projectToolResult({ ...result, contentBlocks: undefined }).content, text);
  assert.deepEqual(toolResultEvidence(result).structuredContent, structuredContent);
  assert.deepEqual(toolResultEvidence(result).contentBlocks, result.contentBlocks);
  assert.equal(projectToolResult({ ...result, contentBlocks: [{ type: "text", text: '{"owner":"Avery","constraints":[1,1,{"blocked":true}]}' }] }).content.endsWith(JSON.stringify(structuredContent)), true, "boolean and number are distinct JSON values");
});
