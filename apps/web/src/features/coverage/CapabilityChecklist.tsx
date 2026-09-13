import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { pathForDocument } from "../documentation/documentPaths";
import { resolveCapabilityStatus } from "./coverageModel";
import type { CapabilityAssessment, CapabilityDefinition } from "./coverageTypes";
import { StatusBadge } from "./StatusBadge";

interface CapabilityChecklistProps {
  assessment?: CapabilityAssessment;
  definition: CapabilityDefinition;
}

export function CapabilityChecklist({ assessment, definition }: CapabilityChecklistProps) {
  const completedChecks = new Set(assessment?.completedChecks ?? []);
  const status = resolveCapabilityStatus(definition, assessment);

  return (
    <details className="coverage-capability">
      <summary>
        <span>
          <span className="coverage-capability-title">{definition.title}</span>
          <small>{definition.summary}</small>
        </span>
        <StatusBadge status={status} />
      </summary>
      <div className="coverage-capability-body">
        <dl className="coverage-facts">
          <div><dt>Owner</dt><dd>{assessment?.owner ?? "Not assigned"}</dd></div>
          <div><dt>Approach</dt><dd>{assessment?.approach ?? "Not documented"}</dd></div>
          <div><dt>Next action</dt><dd>{assessment?.nextAction ?? "Assess this capability for the variant"}</dd></div>
          {assessment?.blockedBy ? <div><dt>Blocked by</dt><dd>{assessment.blockedBy}</dd></div> : null}
        </dl>

        <div className="coverage-checklist" aria-label={`${definition.title} checklist`}>
          {definition.checks.map((check) => {
            const complete = completedChecks.has(check.id);
            return (
              <div className="coverage-check" key={check.id}>
                <span aria-hidden="true" className={complete ? "is-complete" : ""}>{complete ? "✓" : ""}</span>
                <span>{check.label}</span>
              </div>
            );
          })}
        </div>

        <div className="coverage-evidence">
          <strong>Evidence</strong>
          {assessment?.evidence?.length ? (
            assessment.evidence.map((item) => (
              <Link key={item.documentId} to={pathForDocument(item.documentId)}>
                {item.label}<ExternalLink aria-hidden="true" size={13} />
              </Link>
            ))
          ) : <span>No evidence recorded</span>}
        </div>
      </div>
    </details>
  );
}
