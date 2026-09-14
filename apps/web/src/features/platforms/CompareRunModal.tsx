import { Check, X } from "lucide-react";
import { useState } from "react";

import { experimentCatalog } from "../experiments/experimentCatalog";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import { platformCatalog } from "./platformCatalog";

interface CompareRunModalProps {
  initialExperimentId: string;
  initialModel: string;
  initialPlatformId: string;
  initialProvider: string;
  initialScenarioId: string;
  initialTask: string;
  onClose: () => void;
  open: boolean;
}

export function CompareRunModal(props: CompareRunModalProps) {
  const [platformIds, setPlatformIds] = useState([props.initialPlatformId]);
  const [scenarioId, setScenarioId] = useState(props.initialScenarioId);
  const [experimentId, setExperimentId] = useState(props.initialExperimentId);
  const [provider, setProvider] = useState(props.initialProvider);
  const [model, setModel] = useState(props.initialModel);

  const canRun = platformIds.length >= 2 && Boolean(provider.trim()) && Boolean(model.trim());

  if (!props.open) return null;

  function togglePlatform(id: string) {
    setPlatformIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div aria-labelledby="compare-run-title" className="modal-backdrop" onMouseDown={props.onClose} role="presentation">
      <section aria-modal="true" className="compare-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><span className="eyebrow">Compare</span><h2 id="compare-run-title">One workload, multiple platforms</h2></div>
          <button aria-label="Close comparison" className="icon-button" onClick={props.onClose} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <div className="compare-modal-body">
          <div className="comparison-platform-picker">
            {platformCatalog.map((platform) => <label className={platformIds.includes(platform.id) ? "is-selected" : ""} key={platform.id}>
              <input checked={platformIds.includes(platform.id)} onChange={() => togglePlatform(platform.id)} type="checkbox" />
              <span>{platform.name}</span>{platformIds.includes(platform.id) && <Check aria-hidden="true" size={14} />}
            </label>)}
          </div>
          <div className="modal-form-grid">
            <label className="compact-control"><span>Scenario</span><select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarioCatalog.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
            <label className="compact-control"><span>Provider</span><input onChange={(event) => setProvider(event.target.value)} placeholder="Provider" value={provider} /></label>
            <label className="compact-control"><span>Model</span><input onChange={(event) => setModel(event.target.value)} placeholder="Model" value={model} /></label>
            <label className="compact-control"><span>Experiment</span><select value={experimentId} onChange={(event) => setExperimentId(event.target.value)}>{experimentCatalog.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}</select></label>
          </div>
          <p className="modal-note">{props.initialTask.trim() ? "Your custom task will be used for this exploratory comparison." : "Choose at least two platforms. Each implementation keeps its own computer environment or backend profile."}</p>
        </div>
        <footer><button className="quiet-button" onClick={props.onClose} type="button">Cancel</button><button className="button button-primary" disabled type="button">Run comparison{canRun ? " (not available)" : ""}</button></footer>
      </section>
    </div>
  );
}
