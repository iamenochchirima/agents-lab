import { CircleDashed } from "lucide-react";

interface WorkspaceSectionViewProps {
  view: WorkspaceSectionId;
}

export type WorkspaceSectionId = "runs" | "experiments" | "platforms" | "scenarios";

const sectionContent = {
  runs: {
    label: "Execution",
    title: "Runs",
    description: "Inspect concrete harness, scenario, and experiment executions here.",
    emptyTitle: "No runs yet",
    emptyDescription: "Run records will appear here once the execution layer is connected.",
    columns: ["Run", "Status", "Platform", "Scenario", "Started"],
  },
  experiments: {
    label: "Methodology",
    title: "Experiments",
    description: "Define the question, variables, controls, and failure conditions for a comparison.",
    emptyTitle: "No experiments yet",
    emptyDescription: "Experiment definitions will appear here as the lab begins measuring real behaviour.",
    columns: ["Experiment", "Question", "Failure injection", "Status"],
  },
  platforms: {
    label: "Implementations",
    title: "Platforms",
    description: "Keep the platform implementations separate while comparing their architecture and behaviour.",
    emptyTitle: "No platforms registered",
    emptyDescription: "Platform adapters will appear here when the first executable implementations are added.",
    columns: ["Platform", "Language", "Execution", "Durability", "Status"],
  },
  scenarios: {
    label: "Workloads",
    title: "Scenarios",
    description: "Describe the real work that each platform must complete under controlled conditions.",
    emptyTitle: "No scenarios yet",
    emptyDescription: "Canonical workloads will appear here after the scenario contracts are defined.",
    columns: ["Scenario", "Workload", "Side effects", "Status"],
  },
} as const;

export function WorkspaceSectionView({ view }: WorkspaceSectionViewProps) {
  const content = sectionContent[view];

  return (
    <div className="page-content basic-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">{content.label}</span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
      </section>

      <section className="basic-page-panel">
        <div className="collection-toolbar">
          <div>
            <span className="panel-label">Workspace data</span>
            <h2>{content.title}</h2>
          </div>
          <span className="collection-count">0 records</span>
        </div>
        <div className="collection-table" role="table" aria-label={`${content.title} records`}>
          <div
            className="collection-row collection-row-header"
            role="row"
            style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }}
          >
            {content.columns.map((column) => <span key={column} role="columnheader">{column}</span>)}
          </div>
          <div className="collection-empty" role="row">
            <span className="basic-empty-mark" aria-hidden="true"><CircleDashed size={18} /></span>
            <h2>{content.emptyTitle}</h2>
            <p>{content.emptyDescription}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
