import { documentContent } from "../../generated/document-content";
import { documents } from "../../generated/document-catalog";
import type { DocumentRecord } from "../../generated/document-catalog";

export interface DocumentWithContent extends DocumentRecord {
  content: string;
}

export const documentsWithContent: DocumentWithContent[] = documents.map((document) => ({
  ...document,
  content: documentContent[document.id] ?? "",
}));
