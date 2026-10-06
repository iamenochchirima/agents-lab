import {
  ArrowDown,
  ArrowRight,
  Check,
  CircleAlert,
  CircleDashed,
  FlaskConical,
  Info,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
  Target,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { pathForDocument } from "../documentation/documentPaths";
import { appPaths } from "../../routes/paths";
import { getStudioApiHealth } from "../studio/studioApi";
import {
  ContextExperimentApiError,
  getContextExperiment,
  makeContextExperimentRequest,
  runContextExperiment,
} from "./contextExperimentApi";
import { componentAreas, contextCases, contextEvidenceItems, contextStrategies } from "./componentCatalog";
import { getComponentArea } from "./componentModel";
import type {
  ComponentAreaDescriptor,
  ComponentLabStatus,
  ComponentStrategyDescriptor,
} from "./componentTypes";
import type { StudioContextExperimentResponse } from "@agent-harness-lab/studio-http-contract";

interface ComponentLabViewProps {
  areas: readonly ComponentAreaDescriptor[];
  detailMode?: boolean;
  entranceMode?: boolean;
}

type ComparisonState =
  | { kind: "idle" }
  | { kind: "loading"; comparisonId: string }
  | { kind: "running"; comparisonId: string }
  | { kind: "ready"; comparison: StudioContextExperimentResponse }
  | { kind: "error"; comparisonId: string; message: string; code?: string };

type ApiHealthState = { status: "checking" | "available" | "unavailable"; message?: string };

const statusLabels: Readonly<Record<ComponentLabStatus, string>> = {
  planned: "Planned",
  designing: "Designing",
  "ui-preview": "UI preview",
  implemented: "Implemented",
  verified: "Verified",
  blocked: "Blocked",
};

const comparisonStatusLabels: Readonly<Record<string, string>> = {
  running: "Running",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  unknown: "Outcome unknown",
  pending: "Pending",
};

const pinnedBudget = {
  contextWindowTokens: 8192,
  reservedOutputTokens: 512,
  safetyMarginTokens: 256,
  tokenizer: "utf8-bytes-div4-estimate-v1",
} as const;

const fixedTask = contextCases.find((testCase) => testCase.id === "old-important-fact")!;
const implementedStrategies = contextStrategies.filter((strategy) => strategy.status === "implemented");
const plannedStrategies = contextStrategies.filter((strategy) => strategy.status === "planned");

function StatusPill({ status }: { status: ComponentLabStatus }) {
  return <span className={`component-status component-status-${status}`}>{statusLabels[status]}</span>;
}

function ComponentLabEntrance({ areas }: { areas: readonly ComponentAreaDescriptor[] }) {
  return (
    <div className="page-content component-lab-page">
      <header className="component-detail-heading component-entrance-heading">
        <div>
          <span className="eyebrow">Focused experiments</span>
          <h1>Studio components</h1>
          <p>Study one part of an agent harness at a time. Choose an area to inspect its strategies and experiment evidence.</p>
        </div>
        <Link className="text-button component-doc-link" to={pathForDocument("docs/planning/component-lab.md")}>Studio components proposal <ArrowRight aria-hidden="true" size={15} /></Link>
      </header>

      <div className="component-context-layout">
        <aside className="panel component-context-sidebar">
          <div className="component-sidebar-heading"><span className="panel-label">{areas.length} areas</span><strong>Components</strong></div>
          <AreaNavigation activeAreaId="" />
          <div className="component-sidebar-note"><LockKeyhole aria-hidden="true" size={15} /><div><strong>Studio workspace</strong><p>Context Management is the first executable component experiment.</p></div></div>
        </aside>

        <div className="component-context-main">
          <section className="panel component-entrance-panel">
            <span className="panel-label">Start here</span>
            <div className="component-entrance-mark" aria-hidden="true"><FlaskConical size={20} /></div>
            <h2>Choose a component area</h2>
            <p>Each area studies one harness responsibility. Context Management compares two real selection policies against a fixed conversation case.</p>
            <div className="component-entrance-status"><span className="component-status component-status-implemented">Context Management</span><span>Executable comparison available</span></div>
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

function StrategyCard({ strategy, planned = false }: { strategy: ComponentStrategyDescriptor; planned?: boolean }) {
  return (
    <article className={`context-strategy-card ${planned ? "is-unavailable" : "is-selected"}`}>
      <span className="context-strategy-card-top"><span className="context-strategy-radio" aria-hidden="true" /> <StatusPill status={strategy.status} /></span>
      <strong>{strategy.name}</strong>
      <span>{strategy.summary}</span>
      {strategy.identity && <code className="context-strategy-identity">{strategy.identity.implementation.id}@{strategy.identity.implementation.version}</code>}
      {planned && <span className="context-strategy-unavailable">This strategy is not available for execution.</span>}
    </article>
  );
}

function ApiHealthBanner({ health, onRetry }: { health: ApiHealthState; onRetry: () => void }) {
  if (health.status === "available") {
    return <div className="context-api-health is-available" role="status"><span className="context-health-dot" /> Studio API is ready</div>;
  }
  if (health.status === "checking") {
    return <div className="context-api-health" role="status"><LoaderCircle aria-hidden="true" className="context-spinner" size={15} /> Checking the local Studio API…</div>;
  }
  return (
    <div className="context-api-health is-unavailable" role="alert">
      <CircleAlert aria-hidden="true" size={16} />
      <span><strong>Studio API unavailable.</strong> {health.message ?? "Start the local Studio API, then try again."}</span>
      <button className="text-button" onClick={onRetry} type="button"><RotateCw aria-hidden="true" size={14} /> Retry</button>
    </div>
  );
}

function FixedControls({ comparison }: { comparison?: StudioContextExperimentResponse }) {
  const controls = comparison?.sharedControls;
  const budget = controls?.contextBudget ?? pinnedBudget;
  return (
    <section className="panel context-envelope-panel" aria-labelledby="context-envelope-title">
      <div className="component-section-heading">
        <div><span className="panel-label">Experiment controls</span><h2 id="context-envelope-title">Fixed inputs</h2></div>
        <span><LockKeyhole aria-hidden="true" size={14} /> Shared by both runs</span>
      </div>
      <div className="context-envelope-grid context-fixed-controls">
        <div className="context-envelope-field"><span>Case</span><strong>context-stress / old-important-fact-v1</strong><small>Six fixed synthetic prior messages; the server owns the fixture.</small></div>
        <div className="context-envelope-field"><span>Task</span><strong>{fixedTask.task}</strong><small>{controls?.taskId ?? fixedTask.taskId}</small></div>
        <div className="context-envelope-field"><span>Model</span><strong>{controls ? `${controls.model.id}@${controls.model.version}` : "Deterministic Replay"}</strong><small>{controls ? `Parameters: ${compactJson(controls.modelParameters)}` : "Fixed by the reference assembly; no live provider or answer grader."}</small></div>
        <div className="context-envelope-field"><span>Context budget</span><strong>{budget.contextWindowTokens.toLocaleString()} context tokens</strong><small>{budget.reservedOutputTokens} output reserved · {budget.safetyMarginTokens} safety margin · {budget.tokenizer}</small></div>
        <div className="context-envelope-field"><span>Assembly</span><strong>{controls?.assembly.id ?? "Reference assembly"}{controls ? ` · v${controls.assembly.version}` : " · fixed server-side"}</strong><small>{controls?.assembly.mode ?? "All non-Context module choices remain fixed."}</small>
          {controls && <details className="context-json-detail"><summary>Full reference assembly</summary><pre>{prettyJson(controls.assembly)}</pre></details>}
        </div>
      </div>
    </section>
  );
}

function ChangedVariable({ maxRecentMessages, value, onChange, onRun, disabled }: {
  maxRecentMessages: string;
  value: number | null;
  onChange: (next: string) => void;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <section className="panel context-comparison-panel" aria-labelledby="context-comparison-title">
      <div className="component-section-heading">
        <div><span className="panel-label">Changed variable</span><h2 id="context-comparison-title">Recent-message window</h2></div>
        <span>Two fixed strategies</span>
      </div>
      <p className="context-envelope-intro">The baseline considers recent history under the token budget. The alternative first limits prior messages to this window, then applies the same token budget.</p>
      <div className="context-active-strategy-grid">
        {implementedStrategies.map((strategy) => <StrategyCard key={strategy.id} strategy={strategy} />)}
      </div>
      <div className="context-window-run-control">
        <label className="context-window-input">
          <span>Maximum prior messages</span>
          <input aria-describedby="context-window-help" disabled={disabled} max={12} min={1} onChange={(event) => onChange(event.target.value)} step={1} type="number" value={maxRecentMessages} />
          <small id="context-window-help">An integer from 1 to 12. The default is four.</small>
        </label>
        <div className="context-run-action">
          <button className="button button-primary" disabled={disabled || value === null} onClick={onRun} type="button">
            {disabled ? <LoaderCircle aria-hidden="true" className="context-spinner" size={15} /> : <FlaskConical aria-hidden="true" size={15} />}
            {disabled ? "Run in progress" : "Run comparison"}
          </button>
          <span>Each run creates a new comparison ID and two independent run records.</span>
        </div>
      </div>
      {plannedStrategies.length > 0 && (
        <details className="context-planned-strategies">
          <summary>{plannedStrategies.length} other strategies planned</summary>
          <div className="context-planned-strategy-list">{plannedStrategies.map((strategy) => <StrategyCard key={strategy.id} planned strategy={strategy} />)}</div>
        </details>
      )}
    </section>
  );
}

function ContextEvidencePreview() {
  return (
    <section className="panel context-evidence-panel" aria-labelledby="context-evidence-title">
      <div className="component-section-heading">
        <div><span className="panel-label">What the comparison records</span><h2 id="context-evidence-title">Evidence</h2></div>
        <Info aria-hidden="true" size={17} />
      </div>
      <div className="context-evidence-list">
        {contextEvidenceItems.map((item) => <div key={item.label}><span>{item.label}</span><p>{item.description}</p></div>)}
      </div>
      <p className="context-evidence-note"><Target aria-hidden="true" size={15} /> Replay reports the messages it received. This experiment does not score or compare answer quality.</p>
    </section>
  );
}

function ComparisonNotice({ state, onNewRun }: { state: ComparisonState; onNewRun: () => void }) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") return <div className="context-comparison-notice" role="status"><LoaderCircle aria-hidden="true" className="context-spinner" size={16} /> Loading saved comparison <code>{state.comparisonId}</code>…</div>;
  if (state.kind === "running") return <div className="context-comparison-notice is-running" role="status"><LoaderCircle aria-hidden="true" className="context-spinner" size={16} /> Running the two Context strategies. Keep this page open until both results return.</div>;
  if (state.kind === "ready") return null;
  const notFound = state.code === "COMPARISON_NOT_FOUND";
  return (
    <div className="context-comparison-error" role="alert">
      <CircleAlert aria-hidden="true" size={17} />
      <div><strong>{notFound ? "Saved comparison not found" : "Comparison could not be loaded"}</strong><p>{state.message}{state.code ? ` (${state.code})` : ""}</p><small>Comparison ID: <code>{state.comparisonId}</code></small></div>
      <button className="text-button" onClick={onNewRun} type="button">Return to setup</button>
    </div>
  );
}

function ComparisonSummary({ comparison }: { comparison: StudioContextExperimentResponse }) {
  const summary = {
    completed: "Both policies produced terminal run evidence. Compare the sources and exact model messages below.",
    partial: "One policy completed and the other failed. The available run evidence is preserved below.",
    failed: "Both policy runs failed. The failure status and any available evidence are shown below.",
    cancelled: "The request was cancelled before both policy runs completed. Any persisted evidence remains available below.",
    interrupted: "The API stopped before it could finish this comparison. It was not resumed automatically.",
    unknown: "The API cannot establish the final outcome from durable evidence. No result has been inferred.",
    running: "This comparison is still running in the Studio API.",
  }[comparison.status] ?? "The API returned a comparison status that this page does not recognize.";
  return (
    <section className={`context-result-summary status-${comparison.status}`} aria-labelledby="context-result-title">
      <div><span className="panel-label">Saved comparison</span><h2 id="context-result-title">{comparisonStatusLabels[comparison.status] ?? comparison.status}</h2><p>{summary}</p></div>
      <dl><div><dt>Comparison ID</dt><dd><code>{comparison.comparisonId}</code></dd></div><div><dt>Changed variable</dt><dd>{comparison.changedVariable.maxRecentMessages} prior messages</dd></div><div><dt>Created</dt><dd>{formatTimestamp(comparison.createdAt)}</dd></div></dl>
    </section>
  );
}

function VariantEvidence({ variant, index }: { variant: StudioContextExperimentResponse["variants"][number]; index: number }) {
  const evidence = variant.evidence;
  const modelCalls = evidence?.modelCalls ?? [];
  const fallbackContext = evidence?.context;
  const tokenCount = modelCalls[0]?.context.tokenCount ?? fallbackContext?.tokenCount;
  const sourceLedger = modelCalls[0]?.context.sourceLedger ?? fallbackContext?.sourceLedger ?? [];
  const included = sourceLedger.filter((source) => source.disposition.status === "included");
  const omitted = sourceLedger.filter((source) => source.disposition.status === "omitted");
  const contextComponent = evidence?.assembly.components.find((component) => component.area === "context");

  return (
    <article className="context-variant-card" aria-labelledby={`context-variant-${index}-title`}>
      <header className="context-variant-heading">
        <div><span className="panel-label">Strategy {String(index + 1).padStart(2, "0")}</span><h3 id={`context-variant-${index}-title`}>{strategyName(variant.strategy.implementation.id)}</h3><code>{variant.strategy.implementation.id}@{variant.strategy.implementation.version}</code></div>
        <span className={`context-run-status status-${variant.status}`}>{comparisonStatusLabels[variant.status] ?? variant.status}</span>
      </header>
      <dl className="context-variant-identities">
        <div><dt>Package</dt><dd>{variant.strategy.packageName}@{variant.strategy.packageVersion}</dd></div>
        <div><dt>Run ID</dt><dd>{variant.runId ? <code>{variant.runId}</code> : "Not allocated"}</dd></div>
        <div><dt>Context configuration</dt><dd><code>{compactJson(variant.strategy.configuration)}</code></dd></div>
        {contextComponent && <div><dt>Assembly Context</dt><dd>{contextComponent.implementation.id}@{contextComponent.implementation.version}</dd></div>}
      </dl>

      {variant.failure && <div className="context-variant-failure" role="alert"><CircleAlert aria-hidden="true" size={15} /><span>{variant.failure.message} <code>{variant.failure.code}</code></span></div>}
      {!evidence && !variant.failure && <p className="context-evidence-empty">No terminal evidence is available for this variant yet.</p>}
      {evidence && <>
        <section className="context-variant-section">
          <h4>Replay output</h4>
          <p className="context-replay-output">{evidence.assistantMessage.content || "Replay returned no text content."}</p>
          <small>Deterministic Replay · {evidence.model.name} · termination: {evidence.control.termination}</small>
        </section>

        <section className="context-variant-section">
          <h4>Included and omitted sources</h4>
          <div className="context-source-groups">
            <div><h5><Check aria-hidden="true" size={13} /> Included ({included.length})</h5>
              {included.length === 0 ? <p className="context-evidence-empty">No source entries were marked included.</p> : <ul>{included.map((source) => <li key={source.sourceId}><code>{source.sourceId}</code><span>{source.kind} · {source.role}</span></li>)}</ul>}
            </div>
            <div><h5><ArrowDown aria-hidden="true" size={13} /> Omitted ({omitted.length})</h5>
              {omitted.length === 0 ? <p className="context-evidence-empty">No source entries were marked omitted.</p> : <ul>{omitted.map((source) => source.disposition.status === "omitted" ? <li key={source.sourceId}><code>{source.sourceId}</code><span>{source.kind} · {source.disposition.reason}</span></li> : null)}</ul>}
            </div>
          </div>
        </section>

        <section className="context-variant-section">
          <h4>Exact messages passed to Replay</h4>
          {modelCalls.length === 0 ? <p className="context-evidence-empty">No model request was recorded.</p> : modelCalls.map((call, callIndex) => (
            <div className="context-model-call" key={`model-call-${callIndex}`}>
              {modelCalls.length > 1 && <h5>Model call {callIndex + 1}</h5>}
              <ol className="context-exact-messages">{call.request.messages.map((message, messageIndex) => {
                return <li key={`${messageIndex}-${message.role}-${message.toolCallId ?? ""}`}><div><strong>{message.role}</strong><span>{message.name ?? message.toolCallId ?? "Model request message"}</span></div><pre>{messageDetail(message)}</pre></li>;
              })}</ol>
              <p className="context-token-count">Context tokens: {call.context.tokenCount.value.toLocaleString()} · {call.context.tokenCount.quality} · {call.context.tokenCount.basis}</p>
            </div>
          ))}
          {modelCalls.length === 0 && tokenCount && <p className="context-token-count">Context tokens: {tokenCount.value.toLocaleString()} · {tokenCount.quality} · {tokenCount.basis}</p>}
        </section>

        <section className="context-variant-section">
          <h4>Persistence and ordered events</h4>
          <dl className="context-persistence-facts">
            <div><dt>Observability status</dt><dd>{evidence.observability.status}</dd></div>
            <div><dt>Events attempted</dt><dd>{evidence.observability.eventsAttempted}</dd></div>
            <div><dt>Recorder</dt><dd>{evidence.observability.recorder ? `${evidence.observability.recorder.id}@${evidence.observability.recorder.version}` : "No recorder"}</dd></div>
            <div><dt>Flush receipt</dt><dd>{evidence.observability.flushReceipt === null ? "No flush receipt" : "Recorded"}</dd></div>
          </dl>
          {evidence.observability.failure && <p className="context-evidence-warning">{evidence.observability.failure.message}</p>}
          <details className="context-json-detail"><summary>Event append and flush receipts</summary><pre>{prettyJson({ appendReceipts: evidence.observability.appendReceipts, flushReceipt: evidence.observability.flushReceipt })}</pre></details>
          <details className="context-json-detail"><summary>Normalized ordered run evidence</summary><pre>{prettyJson(evidence.runEvidence)}</pre></details>
        </section>
      </>}
    </article>
  );
}

function ComparisonEvidence({ comparison }: { comparison: StudioContextExperimentResponse }) {
  return (
    <section className="context-results" aria-labelledby="context-results-title">
      <div className="component-section-heading"><div><span className="panel-label">Side-by-side run evidence</span><h2 id="context-results-title">Two policy results</h2></div><span>{comparison.variants.length} variants</span></div>
      <div className="context-variant-grid">{comparison.variants.map((variant, index) => <VariantEvidence index={index} key={`${variant.strategy.implementation.id}-${index}`} variant={variant} />)}</div>
    </section>
  );
}

function ContextManagementView({ area }: { area: ComponentAreaDescriptor }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const comparisonId = searchParams.get("comparisonId");
  const [maxRecentMessages, setMaxRecentMessages] = useState("4");
  const [comparisonState, setComparisonState] = useState<ComparisonState>({ kind: "idle" });
  const [health, setHealth] = useState<ApiHealthState>({ status: "checking" });
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const activePostId = useRef<string | null>(null);
  const postController = useRef<AbortController | null>(null);
  const contextPlanPath = pathForDocument("development/implementation-plans/studio/active/context-component-experiment.md");

  useEffect(() => {
    const controller = new AbortController();
    setHealth({ status: "checking" });
    getStudioApiHealth(controller.signal).then(() => {
      if (!controller.signal.aborted) setHealth({ status: "available" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setHealth({ status: "unavailable", message: requestMessage(error) });
    });
    return () => controller.abort();
  }, [healthAttempt]);

  useEffect(() => {
    if (!comparisonId) {
      setComparisonState({ kind: "idle" });
      return;
    }
    if (activePostId.current === comparisonId) return;

    const controller = new AbortController();
    setComparisonState({ kind: "loading", comparisonId });
    getContextExperiment(comparisonId, controller.signal).then((comparison) => {
      if (controller.signal.aborted) return;
      setMaxRecentMessages(String(comparison.changedVariable.maxRecentMessages));
      setComparisonState({ kind: "ready", comparison });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setComparisonState({ kind: "error", comparisonId, message: requestMessage(error), code: error instanceof ContextExperimentApiError ? error.code : undefined });
    });
    return () => controller.abort();
  }, [comparisonId, loadAttempt]);

  useEffect(() => () => postController.current?.abort(), []);

  const parsedWindow = Number(maxRecentMessages);
  const validWindow = Number.isInteger(parsedWindow) && parsedWindow >= 1 && parsedWindow <= 12 ? parsedWindow : null;
  const savedComparison = comparisonState.kind === "ready" ? comparisonState.comparison : undefined;
  const apiUnavailable = health.status !== "available";
  const serverStillRunning = savedComparison?.status === "running";
  const runDisabled = apiUnavailable || comparisonState.kind === "running" || serverStillRunning;

  function updateWindow(next: string) {
    setMaxRecentMessages(next);
    setComparisonState({ kind: "idle" });
    if (comparisonId) setSearchParams((current) => { const nextParams = new URLSearchParams(current); nextParams.delete("comparisonId"); return nextParams; }, { replace: true });
  }

  function retryApi() {
    setHealthAttempt((attempt) => attempt + 1);
    if (comparisonId) setLoadAttempt((attempt) => attempt + 1);
  }

  async function runComparison() {
    if (health.status !== "available" || validWindow === null || runDisabled) return;
    const newComparisonId = globalThis.crypto.randomUUID();
    const controller = new AbortController();
    postController.current?.abort();
    postController.current = controller;
    activePostId.current = newComparisonId;
    setComparisonState({ kind: "running", comparisonId: newComparisonId });
    setSearchParams((current) => { const nextParams = new URLSearchParams(current); nextParams.set("comparisonId", newComparisonId); return nextParams; });
    try {
      const request = makeContextExperimentRequest(newComparisonId, validWindow);
      const comparison = await runContextExperiment(request, controller.signal);
      if (!controller.signal.aborted) setComparisonState({ kind: "ready", comparison });
    } catch (error) {
      if (!controller.signal.aborted) {
        setComparisonState({ kind: "error", comparisonId: newComparisonId, message: requestMessage(error), code: error instanceof ContextExperimentApiError ? error.code : undefined });
      }
    } finally {
      if (postController.current === controller) postController.current = null;
      if (activePostId.current === newComparisonId) activePostId.current = null;
    }
  }

  return (
    <>
      <header className="component-detail-heading">
        <div>
          <span className="eyebrow">Context management</span>
          <div className="component-detail-title-row"><h1>{area.name}</h1><span className="component-status component-status-implemented">Executable</span></div>
          <p>{area.summary} The fixed case compares source selection under two Context implementations; Replay does not grade answer quality.</p>
        </div>
        <div className="component-detail-links">
          {area.document && <Link className="text-button component-doc-link" to={pathForDocument(area.document.documentId)}>{area.document.label} <ArrowRight aria-hidden="true" size={15} /></Link>}
          <Link className="text-button component-doc-link" to={contextPlanPath}>Experiment plan <ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      </header>

      <div className="component-context-layout">
        <aside className="panel component-context-sidebar">
          <div className="component-sidebar-heading"><span className="panel-label">Areas</span><strong>Components</strong></div>
          <AreaNavigation activeAreaId={area.id} />
          <div className="component-sidebar-note"><LockKeyhole aria-hidden="true" size={15} /><div><strong>Fixed workload</strong><p>Only the recent-message window is configurable. The API owns both implementations and run status.</p></div></div>
        </aside>

        <div className="component-context-main">
          <ApiHealthBanner health={health} onRetry={retryApi} />
          <section className="panel context-case-panel" aria-labelledby="context-case-title">
            <div className="component-section-heading"><div><span className="panel-label">Server-owned fixed input</span><h2 id="context-case-title">{fixedTask.name}</h2></div><span>{fixedTask.scenarioId} · fixture v{fixedTask.fixtureVersion}</span></div>
            <p className="context-case-description">{fixedTask.fixtureSummary}</p>
            <div className="context-selected-case"><span className="component-lab-note-label">Fixed task · {fixedTask.taskId}</span><strong>{fixedTask.task}</strong><span>{fixedTask.intendedObservation}</span></div>
          </section>

          <FixedControls comparison={savedComparison} />
          <ChangedVariable disabled={runDisabled} maxRecentMessages={maxRecentMessages} onChange={updateWindow} onRun={() => { void runComparison(); }} value={validWindow} />
          <ComparisonNotice state={comparisonState} onNewRun={() => updateWindow(maxRecentMessages)} />
          {savedComparison && <><ComparisonSummary comparison={savedComparison} /><ComparisonEvidence comparison={savedComparison} /></>}
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
        <aside className="panel component-context-sidebar"><div className="component-sidebar-heading"><span className="panel-label">Areas</span><strong>Components</strong></div><AreaNavigation activeAreaId={area.id} /></aside>
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
    return <div className="page-content component-lab-page"><section className="panel component-planned-panel"><span className="component-planned-mark" aria-hidden="true"><CircleDashed size={20} /></span><h1>Component area not found</h1><p>The selected area is not in the Studio components catalog.</p><Link className="button button-secondary-light" to={appPaths.components}>View component areas</Link></section></div>;
  }

  return <div className="page-content component-lab-page"><ComponentLabDetail area={area} /></div>;
}

function strategyName(id: string): string {
  return contextStrategies.find((strategy) => strategy.identity?.implementation.id === id)?.name ?? id;
}

function messageDetail(message: { content: string | null; name?: string; toolCallId?: string; toolCalls?: readonly unknown[] }): string {
  const sections: string[] = [];
  if (message.content !== null) sections.push(message.content);
  if (message.name) sections.push(`name: ${message.name}`);
  if (message.toolCallId) sections.push(`tool call ID: ${message.toolCallId}`);
  if (message.toolCalls?.length) sections.push(`tool calls:\n${prettyJson(message.toolCalls)}`);
  return sections.join("\n\n") || "No text content";
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? timestamp : date.toLocaleString();
}

function compactJson(value: unknown): string {
  return JSON.stringify(value) ?? "Unavailable";
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "Unavailable";
}

function requestMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The local Studio API request failed.";
}
