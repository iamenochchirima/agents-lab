import type { RunManifest } from "../../control-plane/domain/types.js";
import type { InvocationReviewView } from "./contracts.js";

/** Project display fields from the admitted declaration only. Live discovery and connection settings never participate. */
export function presentInvocationReview(review: InvocationReviewView, manifest: Pick<RunManifest, "capabilities">): InvocationReviewView {
  const catalog = manifest.capabilities?.toolCatalog;
  const descriptor = catalog?.tools.find(tool => tool.definition.name === review.call.name && tool.source.digest === review.sourceDigest);
  if (!descriptor || catalog?.revision !== review.catalogRevision) return review;
  const capability = manifest.capabilities?.resolution?.grants.find(item => item.manifest.id === review.call.name)?.manifest;
  const properties = record(descriptor.definition.inputSchema.properties);
  const argumentLabels: Record<string, string> = {};
  for (const name of Object.keys(review.displayArguments)) {
    const title = record(properties?.[name])?.title;
    if (typeof title === "string" && title.trim()) argumentLabels[name] = bounded(title, 120);
  }
  return { ...review, presentation: {
    displayName: bounded(capability?.displayName ?? descriptor.definition.name, 160),
    description: bounded(descriptor.definition.description, 600),
    source: { id: bounded(descriptor.source.id, 200), version: bounded(descriptor.source.version, 100) },
    risk: descriptor.definition.riskClass,
    argumentLabels,
  } };
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function bounded(value: string, limit: number): string { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit); }
