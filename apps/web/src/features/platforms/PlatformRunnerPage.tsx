import { ChevronDown, Play, Settings2, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router";

import { environmentCatalog } from "../environments/environmentCatalog";
import { experimentCatalog } from "../experiments/experimentCatalog";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import type { PlatformOutletContext } from "./PlatformWorkspaceLayout";
import { CompareRunModal } from "./CompareRunModal";

export function PlatformRunnerPage() {
  const { platform } = useOutletContext<PlatformOutletContext>();
  const [task, setTask] = useState("");
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0].id);
  const [environmentId, setEnvironmentId] = useState(platform.computerEnvironmentIds[0] ?? "");
  const [backendProfileId, setBackendProfileId] = useState(platform.backendProfiles[0]?.id ?? "");
  const [variantId, setVariantId] = useState(platform.variants[0].id);
  const [infrastructureId, setInfrastructureId] = useState(platform.infrastructure[0]?.id ?? "none");
  const [experimentId, setExperimentId] = useState("none");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  const environments = useMemo(
    () => environmentCatalog.filter((environment) => platform.computerEnvironmentIds.includes(environment.id)),
    [platform.computerEnvironmentIds],
  );

  return (
    <div className="runner-page">
      <header className="runner-heading">
        <div>
          <span className="eyebrow">{platform.name}</span>
          <h1>Run an agent</h1>
        </div>
        <button className="quiet-button" onClick={() => setIsCompareOpen(true)} type="button">
          <SlidersHorizontal aria-hidden="true" size={15} /> Compare
        </button>
      </header>

      <main className="runner-surface">
        <section className="task-surface" aria-label="Task input">
          <div className="task-surface-header">
            <span>New task</span>
            <label className="inline-select">
              <span className="sr-only">Scenario</span>
              <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
                {scenarioCatalog.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" size={14} />
            </label>
          </div>
          <textarea
            aria-label="Task prompt"
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe a task, or use the selected scenario as a starting point…"
            rows={8}
            value={task}
          />
          <div className="task-surface-footer">
            <span>The selected scenario remains the comparable workload unless you provide a custom task.</span>
            <button className="button button-primary" disabled type="button">
              <Play aria-hidden="true" size={14} /> Run
            </button>
          </div>
        </section>

        <section className="runner-controls" aria-label="Run configuration">
          <div className="runner-controls-heading">
            <span><Settings2 aria-hidden="true" size={15} /> Configuration</span>
            <small>Runner not connected</small>
          </div>
          <div className="runner-control-grid">
            {platform.kind === "computer-native" ? (
              <CompactSelect label="Computer environment" value={environmentId} onChange={setEnvironmentId}>
                {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
              </CompactSelect>
            ) : (
              <CompactSelect label="Backend profile" value={backendProfileId} onChange={setBackendProfileId}>
                {platform.backendProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </CompactSelect>
            )}
            <CompactSelect label="Variant" value={variantId} onChange={setVariantId}>
              {platform.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
            </CompactSelect>
            <CompactSelect label="Infrastructure" value={infrastructureId} onChange={setInfrastructureId}>
              {platform.infrastructure.length === 0
                ? <option value="none">No platform service</option>
                : platform.infrastructure.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </CompactSelect>
            <CompactSelect label="Experiment" value={experimentId} onChange={setExperimentId}>
              {experimentCatalog.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
            </CompactSelect>
            <label className="compact-control">
              <span>Model</span>
              <div><input onChange={(event) => setProvider(event.target.value)} placeholder="Provider" value={provider} /><input onChange={(event) => setModel(event.target.value)} placeholder="Model" value={model} /></div>
            </label>
          </div>
        </section>
      </main>

      <CompareRunModal
        initialExperimentId={experimentId}
        initialModel={model}
        initialPlatformId={platform.id}
        initialProvider={provider}
        initialScenarioId={scenarioId}
        initialTask={task}
        onClose={() => setIsCompareOpen(false)}
        open={isCompareOpen}
      />
    </div>
  );
}

function CompactSelect({ children, label, onChange, value }: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <label className="compact-control"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}
