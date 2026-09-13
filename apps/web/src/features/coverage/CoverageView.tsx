import { CalendarClock, ClipboardCheck, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { pathForDocument } from "../documentation/documentPaths";
import { coverageStatusLabels, summarizeCatalog } from "./coverageModel";
import type { CoverageCatalog, CoverageStatus } from "./coverageTypes";
import { StatusBadge } from "./StatusBadge";
import { VariantCoverageSection } from "./VariantCoverageSection";

interface CoverageViewProps {
  catalog: CoverageCatalog;
}

const filterableStatuses: readonly CoverageStatus[] = [
  "not-assessed",
  "planned",
  "in-progress",
  "implemented",
  "verified",
  "blocked",
  "unsupported",
  "not-applicable",
];

export function CoverageView({ catalog }: CoverageViewProps) {
  const [platformId, setPlatformId] = useState("all");
  const [environmentId, setEnvironmentId] = useState("all");
  const [status, setStatus] = useState<CoverageStatus | "all">("all");
  const [query, setQuery] = useState("");
  const summary = summarizeCatalog(catalog);

  const environmentOptions = useMemo(() => {
    const environments = catalog.platforms.flatMap((platform) =>
      platform.variants.flatMap((variant) => variant.environments),
    );
    return [...new Map(environments.map((item) => [item.id, item.name])).entries()];
  }, [catalog]);

  const visiblePlatforms = catalog.platforms.filter((platform) => {
    if (platformId !== "all" && platform.id !== platformId) return false;
    if (environmentId === "all") return true;
    return platform.variants.some((variant) =>
      variant.environments.some((environment) => environment.id === environmentId),
    );
  });

  return (
    <div className="page-content coverage-page">
      <header className="coverage-hero">
        <div>
          <span className="eyebrow">Implementation map</span>
          <h1>Harness coverage</h1>
          <p>
            Trace each platform from its harness variants and agent definitions through environments,
            infrastructure, core agent capabilities, workloads, and verification evidence.
          </p>
        </div>
        <aside className="coverage-readonly-note">
          <ClipboardCheck aria-hidden="true" size={19} />
          <div><strong>Read-only by design</strong><span>Coverage changes stay reviewable in source control.</span></div>
        </aside>
      </header>

      <section className="coverage-focus" aria-labelledby="coverage-focus-title">
        <div className="coverage-focus-heading">
          <div>
            <span className="coverage-kicker">Current focus</span>
            <h2 id="coverage-focus-title">{catalog.currentFocus.projectPhase}</h2>
          </div>
          <span><CalendarClock aria-hidden="true" size={15} /> Reviewed {catalog.currentFocus.lastReviewed}</span>
        </div>
        <div className="coverage-focus-grid">
          <div><span>Platform</span><strong>{catalog.currentFocus.activePlatform}</strong></div>
          <div><span>Harness variant</span><strong>{catalog.currentFocus.activeHarnessVariant}</strong></div>
          <div><span>Scenario</span><strong>{catalog.currentFocus.activeScenario}</strong></div>
          <div><span>Experiment</span><strong>{catalog.currentFocus.activeExperiment}</strong></div>
        </div>
        <div className="coverage-focus-work">
          <div><span>Now</span><strong>{catalog.currentFocus.currentWork}</strong></div>
          <div><span>Next checkpoint</span><strong>{catalog.currentFocus.nextCheckpoint}</strong></div>
        </div>
      </section>

      <section className="coverage-summary" aria-label="Coverage summary">
        <article><span>Platforms</span><strong>{summary.platforms}</strong></article>
        <article><span>Layered compositions</span><strong>{summary.compositions}</strong></article>
        <article><span>Harness variants</span><strong>{summary.variants}</strong></article>
        <article><span>Capabilities per variant</span><strong>{summary.capabilitiesPerVariant}</strong></article>
        <article><span>Verified assessments</span><strong>{summary.verified}</strong></article>
        <article><span>Blocked assessments</span><strong>{summary.blocked}</strong></article>
        <article><span>Assessed</span><strong>{summary.assessed}/{summary.totalAssessments}</strong></article>
      </section>

      <section className="coverage-compositions" aria-labelledby="coverage-compositions-title">
        <div>
          <span className="coverage-kicker">Cross-platform layers</span>
          <h2 id="coverage-compositions-title">Planned compositions</h2>
          <p>These are layered assemblies, not additional platforms or direct competitors.</p>
        </div>
        <div className="coverage-composition-list">
          {catalog.compositions.map((composition) => (
            <article key={composition.id}>
              <div><strong>{composition.name}</strong><StatusBadge status={composition.status} /></div>
              <p>{composition.notes}</p>
              <span>{composition.layers.join(" → ")}</span>
              {composition.evidence.map((item) => (
                <Link key={item.documentId} to={pathForDocument(item.documentId)}>{item.label}</Link>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="coverage-workspace" aria-labelledby="coverage-workspace-title">
        <div className="coverage-workspace-heading">
          <div><span className="eyebrow">Platform matrix</span><h2 id="coverage-workspace-title">Implementation coverage</h2></div>
          <p>Missing assessment is shown explicitly; an empty box is never treated as implementation.</p>
        </div>

        <div className="coverage-filters">
          <label className="coverage-search">
            <span>Find a capability</span>
            <span><Search aria-hidden="true" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Context, retries, tools…" /></span>
          </label>
          <label>
            <span>Platform</span>
            <select value={platformId} onChange={(event) => setPlatformId(event.target.value)}>
              <option value="all">All platforms</option>
              {catalog.platforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
            </select>
          </label>
          <label>
            <span>Environment</span>
            <select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="all">All environments</option>
              {environmentOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as CoverageStatus | "all")}>
              <option value="all">All statuses</option>
              {filterableStatuses.map((item) => <option key={item} value={item}>{coverageStatusLabels[item]}</option>)}
            </select>
          </label>
          <span className="coverage-filter-mark"><Filter aria-hidden="true" size={15} /> Platform scopes sections, environment scopes combinations, and search and status scope capabilities.</span>
        </div>

        <div className="coverage-platform-list">
          {visiblePlatforms.map((platform) => (
            <details
              className="coverage-platform"
              key={platform.id}
              open={platformId !== "all" || environmentId !== "all" || query.trim() !== "" || status !== "all"}
            >
              <summary>
                <span>
                  <span className="coverage-kicker">{platform.role}</span>
                  <strong>{platform.name}</strong>
                  <small>{platform.description}</small>
                </span>
                <span className="coverage-platform-meta">
                  <span>{platform.language}</span><span>{platform.runtime}</span><span>{platform.variants.length} variant</span>
                </span>
              </summary>
              <div className="coverage-platform-body">
                <div className="coverage-platform-evidence">
                  <span>Platform evidence</span>
                  {platform.evidence.map((item) => (
                    <Link key={item.documentId} to={pathForDocument(item.documentId)}>{item.label}</Link>
                  ))}
                </div>
                {platform.variants.map((variant) => (
                  <VariantCoverageSection
                    capabilities={catalog.capabilities}
                    capabilityGroups={catalog.capabilityGroups}
                    capabilityQuery={query}
                    environmentFilter={environmentId}
                    key={variant.id}
                    statusFilter={status}
                    variant={variant}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
