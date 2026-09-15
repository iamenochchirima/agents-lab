import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import type { DocumentWithContent } from "../documentation/documentSource";
import { MarkdownDocument } from "../documentation/MarkdownDocument";
import { pathForDocument } from "../documentation/documentPaths";

interface ArchitectureViewProps {
  documents: readonly DocumentWithContent[];
}

const architectureDocumentId = "docs/architecture/system-overview.md";

export function ArchitectureView({ documents }: ArchitectureViewProps) {
  const systemOverview = documents.find((document) => document.id === architectureDocumentId);
  const systemOverviewPath = pathForDocument(architectureDocumentId);

  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Planning surface</span>
          <h1>Understand the laboratory before building it.</h1>
          <p>
            This view explains the stable pieces of Agent Harness Lab and the seams where different implementations can be compared.
          </p>
        </div>
        <Link className="text-button" to={systemOverviewPath}>
          Open source document <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </section>

      <section className="architecture-cards" aria-label="Architecture areas">
        <article className="summary-card">
          <span className="card-index">01</span>
          <h2>Server</h2>
          <p>CLI, registry, runner, telemetry, storage, evaluation, and API coordinate a run.</p>
        </article>
        <article className="summary-card">
          <span className="card-index">02</span>
          <h2>Replaceable subjects</h2>
          <p>Platforms, environments, scenarios, and experiments stay independent where practical.</p>
        </article>
        <article className="summary-card">
          <span className="card-index">03</span>
          <h2>Evidence</h2>
          <p>Every run leaves inspectable configuration, events, results, metrics, logs, and artifacts.</p>
        </article>
      </section>

      {systemOverview ? (
        <section className="panel architecture-document">
          <MarkdownDocument
            document={systemOverview}
            documentIds={new Set(documents.map((document) => document.id))}
          />
        </section>
      ) : (
        <section className="panel empty-state">
          <h2>System overview is not available.</h2>
          <p>The documentation catalog did not contain {architectureDocumentId}.</p>
        </section>
      )}
    </div>
  );
}
