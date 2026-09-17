import {
  ArrowRight,
  CircleDashed,
  FlaskConical,
  Info,
  LockKeyhole,
  Plus,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { pathForDocument } from "../documentation/documentPaths";
import { appPaths } from "../../routes/paths";
import {
  componentAreas,
  contextCases,
  contextEnvelopeFields,
  contextEvidenceItems,
  contextStrategies,
} from "./componentCatalog";
import { getComponentArea, getStrategy } from "./componentModel";
import type {
  ComponentAreaDescriptor,
  ComponentCaseDescriptor,
  ComponentLabStatus,
  ComponentStrategyDescriptor,
} from "./componentTypes";

interface ComponentLabViewProps {
  areas: readonly ComponentAreaDescriptor[];
  detailMode?: boolean;
  entranceMode?: boolean;
}

const statusLabels: Readonly<Record<ComponentLabStatus, string>> = {
  planned: "Planned",
  designing: "Designing",
  "ui-preview": "UI preview",
  implemented: "Implemented",
  verified: "Verified",
  blocked: "Blocked",
};

function StatusPill({ status }: { status: ComponentLabStatus }) {
  return <span className={`component-status component-status-${status}`}>{statusLabels[status]}</span>;
}

function ComponentLabEntrance({ areas }: { areas: readonly ComponentAreaDescriptor[] }) {
  return (
    <div className="page-content component-lab-page">
      <header className="component-detail-heading component-entrance-heading">
        <div>
          <span className="eyebrow">Focused experiments</span>
          <h1>Component Lab</h1>
          <p>
            Study one part of an agent harness at a time. Choose an area from the
            workspace to inspect its strategies and future experiment shape.
          </p>
        </div>
        <Link className="text-button component-doc-link" to={pathForDocument("docs/planning/component-lab.md")}>Component Lab proposal <ArrowRight aria-hidden="true" size={15} /></Link>
      </header>

      <div className="component-context-layout">
        <aside className="panel component-context-sidebar">
          <div className="component-sidebar-heading"><span className="panel-label">{areas.length} areas</span><strong>Component Lab</strong></div>
          <AreaNavigation activeAreaId="" />
          <div className="component-sidebar-note"><LockKeyhole aria-hidden="true" size={15} /><div><strong>Preview state</strong><p>Selections live in browser memory and are never sent to the server.</p></div></div>
        </aside>

        <div className="component-context-main">
          <section className="panel component-entrance-panel">
            <span className="panel-label">Start here</span>
            <div className="component-entrance-mark" aria-hidden="true"><SlidersHorizontal size={20} /></div>
            <h2>Choose a component area</h2>
            <p>Each area will hold its own strategies, cases, configuration, and evidence. Context Management is the first detailed workspace.</p>
            <div className="component-entrance-status"><span className="component-status component-status-designing">Context Management</span><span>Workspace in design</span></div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AreaNavigation({ activeAreaId }: { activeAreaId: string }) {
  return (
    <nav aria-label="Component areas" className="component-area-nav">
      {componentAreas.map((area) => (
        <Link className={area.id === activeAreaId ? "is-active" : ""} key={area.id} to={appPaths.component(area.id)}>
          <span>{String(componentAreas.indexOf(area) + 1).padStart(2, "0")}</span>
          <strong>{area.name}</strong>
        </Link>
      ))}
    </nav>
  );
}

function PlannedAreaView({ area }: { area: ComponentAreaDescriptor }) {
  return (
    <section className="panel component-planned-panel">
      <span className="panel-label">Workspace not started</span>
      <div className="component-planned-mark" aria-hidden="true"><CircleDashed size={20} /></div>
      <h2>{area.name} has no strategy workspace yet</h2>
      <p>{area.nextAction}</p>
      {area.document && <Link className="text-button" to={pathForDocument(area.document.documentId)}>{area.document.label} <ArrowRight aria-hidden="true" size={15} /></Link>}
    </section>
  );
}

function StrategyCard({
  strategy,
  isSelected,
  onSelect,
}: {
  strategy: ComponentStrategyDescriptor;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={`context-strategy-card ${isSelected ? "is-selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <span className="context-strategy-card-top"><span className="context-strategy-radio" aria-hidden="true" /> <StatusPill status={strategy.status} /></span>
      <strong>{strategy.name}</strong>
      <span>{strategy.summary}</span>
    </button>
  );
}

function CaseCard({
  testCase,
  isSelected,
  onSelect,
}: {
  testCase: ComponentCaseDescriptor;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={`context-case-card ${isSelected ? "is-selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <span className="context-case-card-top"><span className="context-strategy-radio" aria-hidden="true" /> <strong>{testCase.name}</strong></span>
      <span>{testCase.fixtureSummary}</span>
    </button>
  );
}

function ContextStrategyDetails({
  strategy,
  values,
  onChange,
}: {
  strategy: ComponentStrategyDescriptor;
  values: Readonly<Record<string, string>>;
  onChange: (parameterId: string, value: string) => void;
}) {
  return (
    <div className="context-strategy-details">
      <div className="context-detail-heading">
        <div><span className="component-lab-note-label">Selected strategy</span><h3>{strategy.name}</h3></div>
        <span className="configuration-state">Preview configuration</span>
      </div>
      <p>{strategy.summary}</p>
      <div className="context-parameter-grid">
        {strategy.parameters.map((parameter) => (
          <label className="context-parameter" key={parameter.id}>
            <span>{parameter.label}</span>
            <select value={values[parameter.id] ?? parameter.defaultValue} onChange={(event) => onChange(parameter.id, event.target.value)}>
              {parameter.options.map((option) => <option key={option}>{option}</option>)}
            </select>
            <small>{parameter.description}</small>
          </label>
        ))}
      </div>
      <div className="context-detail-columns">
        <div><span>Inputs</span><ul>{strategy.inputs.map((input) => <li key={input}>{input}</li>)}</ul></div>
        <div><span>Future evidence</span><ul>{strategy.outputs.map((output) => <li key={output}>{output}</li>)}</ul></div>
      </div>
      <div className="context-limitations"><span>Known limits</span><ul>{strategy.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>
    </div>
  );
}

function ContextEnvelope({ selectedCase }: { selectedCase: ComponentCaseDescriptor }) {
  return (
    <section className="panel context-envelope-panel" aria-labelledby="context-envelope-title">
      <div className="component-section-heading">
        <div><span className="panel-label">Experiment shape</span><h2 id="context-envelope-title">Fixed envelope</h2></div>
        <span><LockKeyhole aria-hidden="true" size={14} /> Shared across slots</span>
      </div>
      <p className="context-envelope-intro">The selected strategy is the variable. Everything below should remain the same when a future run compares it with another strategy.</p>
      <div className="context-envelope-grid">
        {contextEnvelopeFields.map((field) => (
          <div className={`context-envelope-field ${field.label === "Changed variable" ? "is-changed" : ""}`} key={field.label}>
            <span>{field.label}</span>
            <strong>{field.label === "Case fixture" || field.label === "Task" ? (field.label === "Case fixture" ? selectedCase.name : selectedCase.task) : field.value}</strong>
            <small>{field.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContextComparison({
  comparisonStrategyIds,
  onChange,
  onAdd,
  onRemove,
}: {
  comparisonStrategyIds: readonly string[];
  onChange: (index: number, strategyId: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="panel context-comparison-panel" aria-labelledby="context-comparison-title">
      <div className="component-section-heading">
        <div><span className="panel-label">Future run setup</span><h2 id="context-comparison-title">Compare strategies</h2></div>
        <span>{comparisonStrategyIds.length} slots</span>
      </div>
      <p className="context-envelope-intro">Each slot uses the same case and fixed envelope. Only the strategy selection changes.</p>
      <div className="context-comparison-list">
        {comparisonStrategyIds.map((strategyId, index) => (
          <div className="context-comparison-row" key={`${index}-${strategyId}`}>
            <span className="context-comparison-index">{String(index + 1).padStart(2, "0")}</span>
            <label>
              <span>Strategy slot {index + 1}</span>
              <select value={strategyId} onChange={(event) => onChange(index, event.target.value)}>
                {contextStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
              </select>
            </label>
            {comparisonStrategyIds.length > 2 && <button aria-label={`Remove strategy slot ${index + 1}`} className="text-button context-remove-button" onClick={() => onRemove(index)} type="button">Remove</button>}
          </div>
        ))}
      </div>
      {comparisonStrategyIds.length < 3 && <button className="text-button context-add-button" onClick={onAdd} type="button"><Plus aria-hidden="true" size={15} /> Add strategy slot</button>}
      <div className="component-unavailable-callout">
        <div className="component-unavailable-icon"><FlaskConical aria-hidden="true" size={17} /></div>
        <div><strong>Execution is the next slice</strong><p>This preview does not call a model or create a run record. The future component runner will consume this envelope.</p></div>
        <button className="button button-primary" disabled type="button">Run comparison</button>
      </div>
    </section>
  );
}

function ContextEvidencePreview() {
  return (
    <section className="panel context-evidence-panel" aria-labelledby="context-evidence-title">
      <div className="component-section-heading">
        <div><span className="panel-label">What a run should leave behind</span><h2 id="context-evidence-title">Evidence preview</h2></div>
        <Info aria-hidden="true" size={17} />
      </div>
      <div className="context-evidence-list">
        {contextEvidenceItems.map((item) => <div key={item.label}><span>{item.label}</span><p>{item.description}</p></div>)}
      </div>
      <p className="context-evidence-note"><Target aria-hidden="true" size={15} /> A future result must separate context-selection behaviour from model answer quality.</p>
    </section>
  );
}

function ContextManagementView({ area }: { area: ComponentAreaDescriptor }) {
  const [selectedStrategyId, setSelectedStrategyId] = useState(contextStrategies[0].id);
  const [selectedCaseId, setSelectedCaseId] = useState(contextCases[0].id);
  const [comparisonStrategyIds, setComparisonStrategyIds] = useState<readonly string[]>([
    contextStrategies[0].id,
    contextStrategies[1].id,
  ]);
  const [parameterValues, setParameterValues] = useState<Readonly<Record<string, string>>>({});
  const selectedStrategy = getStrategy(selectedStrategyId, contextStrategies);
  const selectedCase = contextCases.find((testCase) => testCase.id === selectedCaseId) ?? contextCases[0];
  const contextPlanPath = pathForDocument("development/implementation-plans/completed/context-management.md");

  const parameterKey = `${selectedStrategy.id}:`;
  const selectedParameterValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const parameter of selectedStrategy.parameters) {
      values[parameter.id] = parameterValues[`${parameterKey}${parameter.id}`] ?? parameter.defaultValue;
    }
    return values;
  }, [parameterKey, parameterValues, selectedStrategy]);

  function selectStrategy(strategyId: string) {
    setSelectedStrategyId(strategyId);
    setComparisonStrategyIds((current) => [strategyId, ...current.slice(1)]);
  }

  function updateParameter(parameterId: string, value: string) {
    setParameterValues((current) => ({ ...current, [`${parameterKey}${parameterId}`]: value }));
  }

  function updateComparisonSlot(index: number, strategyId: string) {
    setComparisonStrategyIds((current) => current.map((item, itemIndex) => itemIndex === index ? strategyId : item));
  }

  function addComparisonSlot() {
    setComparisonStrategyIds((current) => [
      ...current,
      contextStrategies.find((strategy) => !current.includes(strategy.id))?.id ?? contextStrategies[0].id,
    ]);
  }

  return (
    <>
      <header className="component-detail-heading">
        <div>
          <span className="eyebrow">Context management</span>
          <div className="component-detail-title-row"><h1>{area.name}</h1><StatusPill status={area.status} /></div>
          <p>{area.summary} This workspace lets us align the experiment shape before connecting an implementation.</p>
        </div>
        <div className="component-detail-links">
          {area.document && <Link className="text-button component-doc-link" to={pathForDocument(area.document.documentId)}>{area.document.label} <ArrowRight aria-hidden="true" size={15} /></Link>}
          <Link className="text-button component-doc-link" to={contextPlanPath}>Context implementation plan <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </header>

      <div className="component-context-layout">
        <aside className="panel component-context-sidebar">
          <div className="component-sidebar-heading"><span className="panel-label">Areas</span><strong>Component Lab</strong></div>
          <AreaNavigation activeAreaId={area.id} />
          <div className="component-sidebar-note"><LockKeyhole aria-hidden="true" size={15} /><div><strong>Preview state</strong><p>Selections live in browser memory and are never sent to the server.</p></div></div>
        </aside>

        <div className="component-context-main">
          <section className="panel context-strategy-panel" aria-labelledby="context-strategy-title">
            <div className="component-section-heading">
              <div><span className="panel-label">Changed variable</span><h2 id="context-strategy-title">Choose a context strategy</h2></div>
              <span>{contextStrategies.length} strategies described</span>
            </div>
            <p className="context-envelope-intro">These are named choices for the first executable slice. They are not marked implemented until a run produces evidence.</p>
            <div className="context-strategy-grid">
              {contextStrategies.map((strategy) => <StrategyCard isSelected={strategy.id === selectedStrategy.id} key={strategy.id} onSelect={() => selectStrategy(strategy.id)} strategy={strategy} />)}
            </div>
            <ContextStrategyDetails strategy={selectedStrategy} values={selectedParameterValues} onChange={updateParameter} />
          </section>

          <section className="panel context-case-panel" aria-labelledby="context-case-title">
            <div className="component-section-heading">
              <div><span className="panel-label">Fixed input</span><h2 id="context-case-title">Choose a test case</h2></div>
              <span>{contextCases.length} cases described</span>
            </div>
            <p className="context-envelope-intro">The case supplies the task, fixture, and grading question. It should not change between strategy slots.</p>
            <div className="context-case-grid">
              {contextCases.map((testCase) => <CaseCard isSelected={testCase.id === selectedCase.id} key={testCase.id} onSelect={() => setSelectedCaseId(testCase.id)} testCase={testCase} />)}
            </div>
            <div className="context-selected-case"><span className="component-lab-note-label">Selected task</span><strong>{selectedCase.task}</strong><span>{selectedCase.intendedObservation}</span></div>
          </section>

          <ContextEnvelope selectedCase={selectedCase} />
          <ContextComparison comparisonStrategyIds={comparisonStrategyIds} onAdd={addComparisonSlot} onChange={updateComparisonSlot} onRemove={(index) => setComparisonStrategyIds((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
          <ContextEvidencePreview />
        </div>
      </div>
    </>
  );
}

function ComponentLabDetail({ area }: { area: ComponentAreaDescriptor }) {
  if (area.id === "context-management") return <ContextManagementView area={area} />;

  return (
    <>
      <header className="component-detail-heading">
        <div>
          <span className="eyebrow">Component area</span>
          <div className="component-detail-title-row"><h1>{area.name}</h1><StatusPill status={area.status} /></div>
          <p>{area.summary}</p>
        </div>
      </header>
      <div className="component-context-layout">
        <aside className="panel component-context-sidebar"><div className="component-sidebar-heading"><span className="panel-label">Areas</span><strong>Component Lab</strong></div><AreaNavigation activeAreaId={area.id} /></aside>
        <div className="component-context-main"><PlannedAreaView area={area} /></div>
      </div>
    </>
  );
}

export function ComponentLabView({ areas, detailMode = false, entranceMode = false }: ComponentLabViewProps) {
  if (entranceMode) return <ComponentLabEntrance areas={areas} />;

  const { areaId } = useParams();
  const area = getComponentArea(areaId, areas);
  if (!area) {
    return <div className="page-content component-lab-page"><section className="panel component-planned-panel"><span className="component-planned-mark" aria-hidden="true"><CircleDashed size={20} /></span><h1>Component area not found</h1><p>The selected area is not in the Component Lab catalog.</p><Link className="button button-secondary-light" to={appPaths.components}>View component areas</Link></section></div>;
  }

  return <div className="page-content component-lab-page"><ComponentLabDetail area={area} /></div>;
}
