import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { appPaths } from "../../routes/paths";
import { pathForDocument } from "./documentPaths";
import type { DocumentWithContent } from "./documentSource";
import { MarkdownDocument } from "./MarkdownDocument";

interface DocumentationViewProps {
  documents: readonly DocumentWithContent[];
  selectedDocumentId: string | undefined;
}

interface DocumentGroupProps {
  documents: DocumentWithContent[];
  selectedDocumentId: string | undefined;
  section: string;
  searching: boolean;
}

function displaySectionName(section: string) {
  return section;
}

function DocumentGroup({ documents, selectedDocumentId, section, searching }: DocumentGroupProps) {
  const containsSelectedDocument = documents.some((document) => document.id === selectedDocumentId);
  const [open, setOpen] = useState(
    section === "Start here" || containsSelectedDocument,
  );

  useEffect(() => {
    if (searching || containsSelectedDocument) setOpen(true);
  }, [containsSelectedDocument, searching]);

  return (
    <details
      className="docs-nav-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{displaySectionName(section)}</span>
        <small>{documents.length}</small>
      </summary>
      <div className="docs-nav-items">
        {documents.map((document) => (
          <Link
            className={`docs-nav-link ${selectedDocumentId === document.id ? "is-active" : ""}`}
            key={document.id}
            to={pathForDocument(document.id)}
          >
            <span>{document.title}</span>
            {document.placeholder && <small>Reserved</small>}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function DocumentationView({ documents, selectedDocumentId }: DocumentationViewProps) {
  const [query, setQuery] = useState("");

  const documentIds = useMemo(() => new Set(documents.map((document) => document.id)), [documents]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId);
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = documents.filter((document) => {
      if (!normalizedQuery) return true;
      return [document.title, document.path, document.excerpt, document.section]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

    const grouped = new Map<string, DocumentWithContent[]>();
    for (const document of filtered) {
      const sectionDocuments = grouped.get(document.section) ?? [];
      sectionDocuments.push(document);
      grouped.set(document.section, sectionDocuments);
    }

    return grouped;
  }, [documents, query]);

  return (
    <div className="docs-page">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-heading">
          <span className="eyebrow">Reference</span>
          <h1>Documentation</h1>
          <p>{documents.length} documents in this workspace</p>
        </div>

        <label className="docs-search">
          <span className="sr-only">Search documentation</span>
          <Search aria-hidden="true" size={15} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search docs"
            type="search"
            value={query}
          />
        </label>

        <nav aria-label="Documentation navigation" className="docs-nav">
          {[...groups.entries()]
            .map(([section, sectionDocuments]) => (
              <DocumentGroup
                documents={sectionDocuments}
                key={section}
                searching={query.trim().length > 0}
                section={section}
                selectedDocumentId={selectedDocumentId}
              />
            ))}
        </nav>
      </aside>

      <section className="docs-reading-pane">
        {selectedDocument ? (
          <>
            <div className="docs-breadcrumb">
              Documentation <span aria-hidden="true">/</span>{" "}
              {selectedDocument.section}
            </div>
            <MarkdownDocument
              document={selectedDocument}
              documentIds={documentIds}
            />
          </>
        ) : (
          <div className="docs-empty-state">
            <h2>Document not found</h2>
            <p>The requested document is not present in this generated catalog.</p>
            <Link className="button button-secondary-light" to={appPaths.docs}>
              Open documentation home
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
