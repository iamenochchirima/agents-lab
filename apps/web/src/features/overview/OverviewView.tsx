import { ArrowRight, CircleCheck, CircleDashed } from "lucide-react";
import type { DocumentRecord } from "../../generated/document-catalog";
import { Link } from "react-router";
import { appPaths } from "../../routes/paths";
import { pathForDocument } from "../documentation/documentPaths";

interface OverviewViewProps {
  documents: readonly DocumentRecord[];
}

export function OverviewView({ documents }: OverviewViewProps) {
  const systemOverviewPath = pathForDocument("docs/architecture/system-overview.md");
  const docsHomePath = pathForDocument("docs/README.md");
  const developmentRulesPath = pathForDocument("docs/AGENTS.md");

  return (
    <div className="page-content overview-page">
      <section className="overview-hero">
        <div className="overview-hero-copy">
          <span className="eyebrow">Local workspace</span>
          <h1>Agent Harness Lab</h1>
          <p>
            A place to build, break, and compare the systems that let agents do useful work over time.
          </p>
          <div className="action-row">
            <Link className="button button-primary" to={systemOverviewPath}>
              Read the architecture
            </Link>
            <Link className="button button-secondary" to={appPaths.architecture}>
              Explore the lab
            </Link>
          </div>
        </div>
        <div className="overview-hero-note">
          <span className="eyebrow">Current focus</span>
          <strong>Platform workspaces are ready</strong>
          <p>Configure platforms, environments, and comparisons. Execution work comes next.</p>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>What is available now</h2>
          </div>
          <span className="section-caption">The first slice is intentionally read-only.</span>
        </div>

        <div className="status-grid">
          <article className="status-card">
            <div className="status-card-heading"><span className="status-icon status-icon-ready"><CircleCheck aria-hidden="true" size={15} /></span><span>Documentation</span></div>
            <strong>{documents.length} Markdown documents</strong>
            <p>Browse project decisions, architecture notes, and directory guides.</p>
            <Link className="inline-link" to={docsHomePath}>Open docs <ArrowRight aria-hidden="true" size={15} /></Link>
          </article>
          <article className="status-card">
            <div className="status-card-heading"><span className="status-icon status-icon-ready"><CircleCheck aria-hidden="true" size={15} /></span><span>Architecture map</span></div>
            <strong>Server mapped</strong>
            <p>See where platforms, environments, scenarios, experiments, and evidence belong.</p>
            <Link className="inline-link" to={appPaths.architecture}>View architecture <ArrowRight aria-hidden="true" size={15} /></Link>
          </article>
          <article className="status-card">
            <div className="status-card-heading"><span className="status-icon status-icon-ready"><CircleCheck aria-hidden="true" size={15} /></span><span>Platform workspace</span></div>
            <strong>Configuration ready</strong>
            <p>Inspect each platform, choose an environment, and prepare a comparison.</p>
            <Link className="inline-link" to={appPaths.platform("anesu")}>Open platforms <ArrowRight aria-hidden="true" size={15} /></Link>
          </article>
        </div>
      </section>

      <section className="overview-columns">
        <article className="content-panel">
          <div className="panel-label">Start here</div>
          <h2>Get oriented</h2>
          <p>Use the architecture notes to understand the boundaries before adding implementation code.</p>
          <div className="orientation-list">
            <Link to={systemOverviewPath}>
              <span>01</span><strong>System overview</strong><small>How a run moves through the lab</small>
            </Link>
            <Link to={appPaths.repository}>
              <span>02</span><strong>Repository map</strong><small>Where each responsibility lives</small>
            </Link>
            <Link to={developmentRulesPath}>
              <span>03</span><strong>Development rules</strong><small>How we keep the project understandable</small>
            </Link>
          </div>
        </article>

        <article className="content-panel next-panel">
          <div className="panel-label">Project state</div>
          <h2>Execution is the next slice.</h2>
          <p>
            The UI can now describe and validate a platform configuration without pretending that a run has happened.
          </p>
          <div className="state-line"><span className="status-dot" /> Local development</div>
        </article>
      </section>
    </div>
  );
}
