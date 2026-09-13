import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";

import { pathForDocument } from "./documentPaths";
import type { DocumentWithContent } from "./documentSource";
import { MermaidDiagram } from "./MermaidDiagram";
import { ReferenceCodeMapSteps } from "./ReferenceCodeMapSteps";

interface MarkdownDocumentProps {
  document: DocumentWithContent;
  documentIds: ReadonlySet<string>;
}

function resolveDocumentLink(sourcePath: string, href: string) {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return null;

  const resolved = new URL(href, `https://agent-harness-lab.local/${sourcePath}`).pathname.replace(/^\/+/, "");
  const documentId = resolved.endsWith(".md") ? resolved : `${resolved}.md`;
  return documentId;
}

function removeTitleHeading(content: string, title: string) {
  const heading = content.match(/^#\s+(.+)$/m);
  if (!heading || heading[1].trim() !== title.trim()) return content;

  return content.slice(heading.index! + heading[0].length).replace(/^\r?\n+/, "");
}

const referenceCodeMapStepsMarker = "<!-- agentlab:reference-code-map-steps -->";

export function MarkdownDocument({ document, documentIds }: MarkdownDocumentProps) {
  const components: Components = {
    code({ className, children, ...props }) {
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <MermaidDiagram chart={String(children).replace(/\n$/, "")} />;
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    a({ href, children, ...props }) {
      const documentId = href ? resolveDocumentLink(document.id, href) : null;
      const isInternalDocument = documentId !== null && documentIds.has(documentId);

      if (isInternalDocument) {
        return (
          <Link to={pathForDocument(documentId)} {...props}>
            {children}
          </Link>
        );
      }

      return (
        <a href={href} rel={href?.startsWith("http") ? "noreferrer" : undefined} target={href?.startsWith("http") ? "_blank" : undefined} {...props}>
          {children}
        </a>
      );
    },
  };

  const content = removeTitleHeading(document.content, document.title);
  const [contentBeforeSteps, contentAfterSteps] = content.split(referenceCodeMapStepsMarker);

  return (
    <article className="markdown-document">
      <header className="document-header">
        <div>
          <span className="document-section">{document.section}</span>
          <h1>{document.title}</h1>
        </div>
        <code>{document.path}</code>
      </header>

      {document.placeholder && <p className="placeholder-note">This directory is reserved for future content.</p>}

      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>{contentBeforeSteps}</ReactMarkdown>
      {contentAfterSteps !== undefined && <ReferenceCodeMapSteps documentId={document.id} />}
      {contentAfterSteps !== undefined && (
        <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>{contentAfterSteps}</ReactMarkdown>
      )}
    </article>
  );
}
