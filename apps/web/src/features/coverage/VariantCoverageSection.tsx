import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { pathForDocument } from "../documentation/documentPaths";
import { resolveCapabilityStatus, summarizeVariant } from "./coverageModel";
import type {
  CapabilityDefinition,
  CapabilityGroup,
  CoverageStatus,
  HarnessVariantCoverage,
} from "./coverageTypes";
import { CapabilityChecklist } from "./CapabilityChecklist";
import { StatusBadge } from "./StatusBadge";

interface VariantCoverageSectionProps {
  capabilities: readonly CapabilityDefinition[];
  capabilityGroups: readonly CapabilityGroup[];
  capabilityQuery: string;
  environmentFilter: string;
  statusFilter: CoverageStatus | "all";
  variant: HarnessVariantCoverage;
}

function CoverageCollection({
  emptyMessage,
  items,
}: {
  emptyMessage: string;
  items: ReadonlyArray<{ id: string; name: string; notes?: string; status: CoverageStatus }>;
}) {
  if (items.length === 0) return <p className="coverage-muted">{emptyMessage}</p>;
  return (
    <div className="coverage-collection">
      {items.map((item) => (
        <div className="coverage-collection-row" key={item.id}>
          <span><span className="coverage-row-title">{item.name}</span>{item.notes ? <small>{item.notes}</small> : null}</span>
          <StatusBadge status={item.status} />
        </div>
      ))}
    </div>
  );
}

export function VariantCoverageSection({
  capabilities,
  capabilityGroups,
  capabilityQuery,
  environmentFilter,
  statusFilter,
  variant,
}: VariantCoverageSectionProps) {
  const counts = summarizeVariant(variant, capabilities);
  const visibleEnvironments = environmentFilter === "all"
    ? variant.environments
    : variant.environments.filter((environment) => environment.id === environmentFilter);
  const visibleCapabilities = capabilities.filter((capability) => {
    const assessment = variant.capabilityAssessments[capability.id];
    const matchesStatus = statusFilter === "all" ||
      resolveCapabilityStatus(capability, assessment) === statusFilter;
    const query = capabilityQuery.trim().toLowerCase();
    const matchesQuery = !query || `${capability.title} ${capability.summary}`.toLowerCase().includes(query);
    return matchesStatus && matchesQuery;
  });

  return (
    <details className="coverage-variant" open>
      <summary>
        <span>
          <span className="coverage-kicker">Harness variant · {variant.stage}</span>
          <strong>{variant.name}</strong>
          <small>{variant.description}</small>
        </span>
        <span className="coverage-progress">{counts.verified}/{capabilities.length} verified</span>
      </summary>
      <div className="coverage-variant-body">
        <div className="coverage-next-decision"><strong>Next decision</strong><span>{variant.nextDecision}</span></div>

        <div className="coverage-section-grid">
          <details className="coverage-subsection">
            <summary>Agent definitions <span>{variant.agentDefinitions.length}</span></summary>
            <CoverageCollection emptyMessage="No agent definitions declared." items={variant.agentDefinitions} />
          </details>
          <details className="coverage-subsection">
            <summary>Environment combinations <span>{visibleEnvironments.length}</span></summary>
            <CoverageCollection emptyMessage="This environment is not declared for the variant." items={visibleEnvironments} />
          </details>
          <details className="coverage-subsection">
            <summary>Infrastructure requirements <span>{variant.infrastructure.length}</span></summary>
            <div className="coverage-collection">
              {variant.infrastructure.map((item) => (
                <div className="coverage-collection-row" key={item.id}>
                  <span><span className="coverage-row-title">{item.name}</span><small>{item.requirement} · {item.notes}</small></span>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </details>
          <details className="coverage-subsection">
            <summary>Models and strategies <span>{variant.strategies.length}</span></summary>
            <CoverageCollection emptyMessage="No strategies declared." items={variant.strategies} />
          </details>
          <details className="coverage-subsection">
            <summary>Scenario coverage <span>{variant.scenarios.length}</span></summary>
            <CoverageCollection emptyMessage="No scenarios declared." items={variant.scenarios} />
          </details>
          <details className="coverage-subsection">
            <summary>Experiment coverage <span>{variant.experiments.length}</span></summary>
            <CoverageCollection emptyMessage="No experiments declared." items={variant.experiments} />
          </details>
          <details className="coverage-subsection">
            <summary>Verified combinations <span>{variant.verifiedCombinations.length}</span></summary>
            {variant.verifiedCombinations.length ? (
              <div className="coverage-collection">
                {variant.verifiedCombinations.map((item) => (
                  <div className="coverage-collection-row" key={`${item.scenarioId}/${item.experimentId}`}>
                    <strong>{item.scenarioId} × {item.experimentId}</strong>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            ) : <p className="coverage-muted">No scenario × experiment combination has been verified.</p>}
          </details>
          <details className="coverage-subsection">
            <summary>Variant evidence <span>{variant.evidence.length}</span></summary>
            <div className="coverage-link-list">
              {variant.evidence.map((item) => (
                <Link key={item.documentId} to={pathForDocument(item.documentId)}>
                  {item.label}<ExternalLink aria-hidden="true" size={13} />
                </Link>
              ))}
            </div>
          </details>
        </div>

        <section className="coverage-capabilities">
          <div className="coverage-capabilities-heading">
            <div><span className="coverage-kicker">Harness responsibilities</span><h3>Capability checklist</h3></div>
            <span>{visibleCapabilities.length} of {capabilities.length} shown</span>
          </div>
          {capabilityGroups.map((group) => {
            const groupedCapabilities = visibleCapabilities.filter((item) => item.groupId === group.id);
            if (groupedCapabilities.length === 0) return null;
            return (
              <details className="coverage-capability-group" key={group.id}>
                <summary><span><span className="coverage-group-title">{group.title}</span><small>{group.description}</small></span><span>{groupedCapabilities.length}</span></summary>
                <div className="coverage-capability-list">
                  {groupedCapabilities.map((definition) => (
                    <CapabilityChecklist
                      assessment={variant.capabilityAssessments[definition.id]}
                      definition={definition}
                      key={definition.id}
                    />
                  ))}
                </div>
              </details>
            );
          })}
          {visibleCapabilities.length === 0 ? <p className="coverage-empty-filter">No capabilities match these filters.</p> : null}
        </section>
      </div>
    </details>
  );
}
