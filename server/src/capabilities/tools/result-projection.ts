import type { ToolExecutionResult } from "./contracts.js";

/** Text-only native tool messages preserve supported text and structured JSON.
 * Other content is retained as evidence with an explicit unsupported marker;
 * it must never be reported as having been perceived by a text-only model.
 * Equivalent JSON text/structured representations are sent once; raw evidence is unchanged.
 * Pure code is safe to run within a durable workflow's deterministic boundary.
 */
export function projectToolResult(result: ToolExecutionResult): { content: string; unsupportedContent: string[] } {
  const blocks = Array.isArray(result.contentBlocks) ? result.contentBlocks : null;
  const texts: string[] = blocks ? [] : [result.content]; const unsupported = new Set<string>();
  for (const value of blocks ?? []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { unsupported.add("invalid"); continue; }
    const block = value as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
    else if (block.type === "resource" && block.resource && typeof block.resource === "object" && "text" in block.resource && typeof block.resource.text === "string") texts.push(block.resource.text);
    else if (block.type === "resource_link") texts.push(JSON.stringify({ resourceLink: block.uri, name: block.name }));
    else unsupported.add(typeof block.type === "string" ? block.type : "unknown");
  }
  if (result.structuredContent !== undefined && !texts.some(text => containsEquivalentJson(text, result.structuredContent))) {
    texts.push(JSON.stringify(result.structuredContent));
  }
  const unsupportedContent = [...unsupported].sort();
  if (unsupportedContent.length) texts.push(`Unsupported tool content retained in evidence: ${unsupportedContent.join(", ")}.`);
  return { content: texts.join("\n"), unsupportedContent };
}

/** Retain business certainty and original content independently of projection. */
export function toolResultEvidence(result: ToolExecutionResult): Record<string, unknown> {
  const projection = projectToolResult(result);
  return {
    ...(result.effect ? { effect: result.effect } : {}),
    ...(result.presentation ? { presentation: result.presentation } : {}),
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    ...(result.contentBlocks ? { contentBlocks: result.contentBlocks } : {}),
    modelProjection: { mode: "text", unsupportedContent: projection.unsupportedContent },
  };
}


/** Compare JSON values, not formatting/object key order; never collapse distinct text blocks. */
function containsEquivalentJson(text: string, structured: unknown): boolean {
  try { return jsonEquivalent(JSON.parse(text), structured); } catch { return false; }
}
function jsonEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => jsonEquivalent(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && jsonEquivalent(a[key], b[key]));
}
