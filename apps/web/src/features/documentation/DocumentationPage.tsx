import { useParams } from "react-router";

import { defaultDocumentId, documentIdForRoutePath } from "./documentPaths";
import { documentsWithContent } from "./documentSource";
import { DocumentationView } from "./DocumentationView";

export function DocumentationPage() {
  const { "*": routePath } = useParams();
  const selectedDocumentId = routePath
    ? documentIdForRoutePath(routePath, documentsWithContent)
    : defaultDocumentId;

  return <DocumentationView documents={documentsWithContent} selectedDocumentId={selectedDocumentId} />;
}
