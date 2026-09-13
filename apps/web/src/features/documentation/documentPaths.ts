import type { DocumentRecord } from "../../generated/document-catalog";
import { appPaths } from "../../routes/paths";

export const defaultDocumentId = "docs/architecture/system-overview.md";

function decodeRoutePath(routePath: string) {
  try {
    return decodeURIComponent(routePath);
  } catch {
    return routePath;
  }
}

export function pathForDocument(documentId: string) {
  const documentPath = documentId.startsWith("docs/") ? documentId.slice("docs/".length) : documentId;
  return `${appPaths.docs}/${encodeURI(documentPath)}`;
}

export function documentIdForRoutePath(
  routePath: string,
  documents: readonly DocumentRecord[],
) {
  const decodedPath = decodeRoutePath(routePath.replace(/^\/+|\/+$/g, ""));
  if (!decodedPath) return defaultDocumentId;

  const documentIds = new Set(documents.map((document) => document.id));
  const candidates = [decodedPath, `docs/${decodedPath}`];
  return candidates.find((candidate) => documentIds.has(candidate));
}
