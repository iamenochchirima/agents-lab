import { Check, CircleAlert, LoaderCircle, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { experimentCatalog } from "../experiments/experimentCatalog";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import { isRunnableBaseline, platformCatalog } from "./platformCatalog";
import {
  createRun,
  getPlatformConnectivity,
  getRun,
  PlatformApiError,
  type RunSelection,
  type RunStatus,
  type RunView,
} from "./platformApi";

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

type ComparisonPhase = "checking" | "starting" | "running" | RunStatus | "error";

interface ComparisonEntry {
  readonly error?: string;
  readonly phase: ComparisonPhase;
  readonly platformId: string;
  readonly platformName: string;
  readonly run?: RunView;
}

const comparablePlatforms = platformCatalog.filter(
  (platform) => platform.id !== "aws-step-functions" && isRunnableBaseline(platform),
);

export function CompareRunModal(props: CompareRunModalProps) {
  const [platformIds, setPlatformIds] = useState(() => initialComparisonPlatforms(props.initialPlatformId));
  const [scenarioId, setScenarioId] = useState(props.initialScenarioId);
  const [experimentId, setExperimentId] = useState(props.initialExperimentId);
  const [provider, setProvider] = useState(props.initialProvider);
  const [model, setModel] = useState(props.initialModel);
  const [task, setTask] = useState(props.initialTask);
  const [entries, setEntries] = useState<ComparisonEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    setPlatformIds(initialComparisonPlatforms(props.initialPlatformId));
    setScenarioId(props.initialScenarioId);
    setExperimentId(props.initialExperimentId);
    setProvider(props.initialProvider);
    setModel(props.initialModel);
    setTask(props.initialTask);
    setEntries([]);
    setIsRunning(false);
  }, [props.open, props.initialExperimentId, props.initialModel, props.initialPlatformId, props.initialProvider, props.initialScenarioId, props.initialTask]);

  const selectedPlatforms = useMemo(
    () => comparablePlatforms.filter((platform) => platformIds.includes(platform.id)),
    [platformIds],
  );
  const hasActiveRuns = entries.some((entry) => entry.run && !isTerminalStatus(entry.run.status));
  const canRun = selectedPlatforms.length >= 2 && Boolean(task.trim()) && Boolean(provider.trim()) && Boolean(model.trim()) && !isRunning && !hasActiveRuns;

  useEffect(() => {
    if (!props.open || !entries.some((entry) => entry.run && !isTerminalStatus(entry.run.status))) return;

    const timeout = window.setTimeout(() => {
      void Promise.all(entries.map(async (entry) => {
        if (!entry.run || isTerminalStatus(entry.run.status)) return;
        try {
          const run = await getRun(entry.run.runId);
          setEntries((current) => current.map((candidate) => candidate.platformId === entry.platformId ? { ...candidate, phase: run.status, run } : candidate));
        } catch (error) {
          setEntries((current) => current.map((candidate) => candidate.platformId === entry.platformId ? { ...candidate, error: toUserMessage(error) } : candidate));
        }
      }));
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [entries, props.open]);

  if (!props.open) return null;

  function togglePlatform(id: string) {
    setPlatformIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function runComparison() {
    if (!canRun) return;

    const selection: RunSelection = {
      scenarioId,
      ...(experimentId !== "none" ? { experimentId } : {}),
    };
    setIsRunning(true);
    setEntries(selectedPlatforms.map((platform) => ({
      phase: "checking",
      platformId: platform.id,
      platformName: platform.name,
    })));

    await Promise.all(selectedPlatforms.map(async (platform) => {
      try {
        const connectivity = await getPlatformConnectivity(platform.id);
        if (!connectivity.reachable) throw new PlatformApiError(connectivity.message, 503, "PLATFORM_UNAVAILABLE");
        updateEntry(platform.id, { phase: "starting" });
        const variant = platform.variants.find((candidate) => candidate.id === "baseline") ?? platform.variants[0];
        const run = await createRun({
          platform: platform.id,
          variant: variant.id,
          task: { kind: "prompt", prompt: task.trim() },
          model: { provider: provider.trim(), model: model.trim() },
          selection: {
            ...selection,
            ...(platform.backendProfiles[0] ? { backendProfileId: platform.backendProfiles[0].id } : {}),
            ...(platform.infrastructure[0] ? { infrastructureId: platform.infrastructure[0].id } : {}),
          },
        });
        updateEntry(platform.id, { phase: run.status, run });
      } catch (error) {
        updateEntry(platform.id, { error: toUserMessage(error), phase: "error" });
      }
    }));
    setIsRunning(false);
  }

  function updateEntry(platformId: string, patch: Partial<ComparisonEntry>) {
    setEntries((current) => current.map((entry) => entry.platformId === platformId ? { ...entry, ...patch } : entry));
  }

  return (
    <div aria-labelledby="compare-run-title" className="modal-backdrop" onMouseDown={props.onClose} role="presentation">
      <section aria-modal="true" className="compare-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><span className="eyebrow">Compare</span><h2 id="compare-run-title">One task, multiple platforms</h2></div>
          <button aria-label="Close comparison" className="icon-button" onClick={props.onClose} ref={closeButtonRef} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <div className="compare-modal-body">
          <div className="comparison-platform-picker">
            {comparablePlatforms.map((platform) => <label className={platformIds.includes(platform.id) ? "is-selected" : ""} key={platform.id}>
              <input checked={platformIds.includes(platform.id)} onChange={() => togglePlatform(platform.id)} type="checkbox" />
              <span>{platform.name}</span>{platformIds.includes(platform.id) && <Check aria-hidden="true" size={14} />}
            </label>)}
          </div>
          <div className="modal-form-grid">
            <label className="compact-control"><span>Scenario</span><select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarioCatalog.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
            <label className="compact-control"><span>Provider</span><input onChange={(event) => setProvider(event.target.value)} placeholder="Provider" value={provider} /></label>
            <label className="compact-control"><span>Model</span><input onChange={(event) => setModel(event.target.value)} placeholder="Model" value={model} /></label>
            <label className="compact-control"><span>Experiment</span><select value={experimentId} onChange={(event) => setExperimentId(event.target.value)}>{experimentCatalog.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}</select></label>
            <label className="compact-control compare-task-field"><span>Task</span><textarea onChange={(event) => setTask(event.target.value)} placeholder="Describe a task" rows={3} value={task} /></label>
          </div>

          {entries.length > 0 && (
            <div aria-live="polite" className="comparison-results">
              <span className="run-section-label">Runs</span>
              {entries.map((entry) => <div className="comparison-result" key={entry.platformId}>
                <strong>{entry.platformName}</strong>
              <span className={`comparison-result-status comparison-result-${entry.phase}`}>
                  {entry.phase === "checking" || entry.phase === "starting" || entry.phase === "running" ? <LoaderCircle aria-hidden="true" className="is-spinning" size={13} /> : entry.phase === "error" ? <CircleAlert aria-hidden="true" size={13} /> : null}
                  {entry.error ?? entry.run?.status ?? entry.phase}
                </span>
                {entry.run?.result?.output && <small className="comparison-result-output">{entry.run.result.output}</small>}
              </div>)}
            </div>
          )}
        </div>
        <footer><button className="quiet-button" onClick={props.onClose} type="button">Close</button><button className="button button-primary" disabled={!canRun} onClick={() => void runComparison()} type="button"><Play aria-hidden="true" size={14} /> {isRunning ? "Running" : "Run comparison"}</button></footer>
      </section>
    </div>
  );
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "reconciliation_required";
}

function initialComparisonPlatforms(initialPlatformId: string): string[] {
  return comparablePlatforms.some((platform) => platform.id === initialPlatformId)
    ? [initialPlatformId]
    : comparablePlatforms[0] ? [comparablePlatforms[0].id] : [];
}

function toUserMessage(error: unknown): string {
  if (error instanceof PlatformApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The comparison could not be started.";
}
