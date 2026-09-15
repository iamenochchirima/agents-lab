import { ChevronDown, LoaderCircle, Play, Settings2, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";

import { environmentCatalog } from "../environments/environmentCatalog";
import { experimentCatalog } from "../experiments/experimentCatalog";
import { scenarioCatalog } from "../scenarios/scenarioCatalog";
import type { PlatformOutletContext } from "./PlatformWorkspaceLayout";
import { CompareRunModal } from "./CompareRunModal";
import { cancelRun, createRun, getPlatformConnectivity, getRun, getRunEvents, PlatformApiError, type PlatformConnectivity, type RunEvent, type RunView } from "./platformApi";
import { RunStatusPanel } from "./RunStatusPanel";

const RUNNABLE_BASELINE_PLATFORMS = new Set([
  "temporal",
  "restate",
  "langgraph",
  "mastra",
  "inngest",
  "trigger-dev",
  "dbos",
  "hatchet",
  "aws-step-functions",
  "vercel-workflows",
]);

export function PlatformRunnerPage() {
  const { platform } = useOutletContext<PlatformOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [task, setTask] = useState("");
  const [scenarioId, setScenarioId] = useState(scenarioCatalog[0].id);
  const [environmentId, setEnvironmentId] = useState(platform.computerEnvironmentIds[0] ?? "");
  const [backendProfileId, setBackendProfileId] = useState(platform.backendProfiles[0]?.id ?? "");
  const [variantId, setVariantId] = useState(platform.variants[0].id);
  const [infrastructureId, setInfrastructureId] = useState(platform.infrastructure[0]?.id ?? "none");
  const [experimentId, setExperimentId] = useState("none");
  const [provider, setProvider] = useState(RUNNABLE_BASELINE_PLATFORMS.has(platform.id) ? "fake" : "");
  const [model, setModel] = useState(RUNNABLE_BASELINE_PLATFORMS.has(platform.id) ? "fake-success" : "");
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [platformConnectivity, setPlatformConnectivity] = useState<PlatformConnectivity | null>(null);
  const [connectivityError, setConnectivityError] = useState<string | null>(null);
  const eventCursor = useRef(0);
  const runIdFromUrl = searchParams.get("run");

  const environments = useMemo(
    () => environmentCatalog.filter((environment) => platform.computerEnvironmentIds.includes(environment.id)),
    [platform.computerEnvironmentIds],
  );

  const hasRunnableBaseline = RUNNABLE_BASELINE_PLATFORMS.has(platform.id) && variantId === "baseline";
  const isRunnable = hasRunnableBaseline && platformConnectivity?.reachable === true;
  const taskError = task.trim().length === 0 ? "Enter a task prompt." : null;

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;

    setPlatformConnectivity(null);
    setConnectivityError(null);
    if (!RUNNABLE_BASELINE_PLATFORMS.has(platform.id)) {
      return () => controller.abort();
    }

    void getPlatformConnectivity(platform.id, controller.signal)
      .then((connectivity) => {
        if (!stopped) setPlatformConnectivity(connectivity);
      })
      .catch((error) => {
        if (stopped || isAbortError(error)) return;
        setConnectivityError(toUserMessage(error));
      });

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [platform.id]);

  useEffect(() => {
    const activeRunId = run?.runId ?? runIdFromUrl;
    if (!activeRunId) return;
    const targetRunId = activeRunId;

    let stopped = false;
    let timeout: number | undefined;
    const controller = new AbortController();

    async function refresh() {
      try {
        const [nextRun, eventPage] = await Promise.all([
          getRun(targetRunId, controller.signal),
          getRunEvents(targetRunId, eventCursor.current, controller.signal),
        ]);
        if (stopped) return;

        eventCursor.current = Math.max(eventCursor.current, eventPage.nextSequence);
        setRun(nextRun);
        setRunEvents((current) => mergeEvents(mergeEvents(current, nextRun.events), eventPage.events));
        setRunError(null);

        if (!isTerminalStatus(nextRun.status) || eventPage.hasMore) {
          timeout = window.setTimeout(() => void refresh(), 1000);
        }
      } catch (error) {
        if (stopped || isAbortError(error)) return;
        setRunError(toUserMessage(error));
        if (error instanceof PlatformApiError && error.status === 404) return;
        timeout = window.setTimeout(() => void refresh(), 1500);
      }
    }

    void refresh();
    return () => {
      stopped = true;
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [run?.runId, runIdFromUrl]);

  async function submitRun() {
    if (!isRunnable || !task.trim() || !provider.trim() || !model.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setRunError(null);
    const controller = new AbortController();
    try {
      const createdRun = await createRun({
        platform: platform.id,
        variant: variantId,
        task: { kind: "prompt", prompt: task.trim() },
        model: { provider: provider.trim(), model: model.trim() },
      }, controller.signal);
      eventCursor.current = createdRun.events.at(-1)?.recordedSequence ?? 0;
      setRunEvents(createdRun.events.slice());
      setRun(createdRun);
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set("run", createdRun.runId);
      setSearchParams(nextSearchParams, { replace: true });
    } catch (error) {
      setRunError(toUserMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function stopRun() {
    if (!run || isCancelling) return;

    setIsCancelling(true);
    try {
      const cancelledRun = await cancelRun(run.runId, "Cancellation requested from the Platform UI.");
      setRun(cancelledRun);
      setRunEvents((current) => mergeEvents(current, cancelledRun.events));
    } catch (error) {
      setRunError(toUserMessage(error));
    } finally {
      setIsCancelling(false);
    }
  }

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
            <span>{runAvailabilityLabel({ connectivityError, hasRunnableBaseline, isRunnable, platformConnectivity })}</span>
            <button className="button button-primary" disabled={!isRunnable || Boolean(taskError) || isSubmitting} onClick={() => void submitRun()} type="button">
              {isSubmitting ? <LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> : <Play aria-hidden="true" size={14} />} {isSubmitting ? "Starting" : "Run"}
            </button>
          </div>
        </section>

        <section className="runner-controls" aria-label="Run configuration">
          <div className="runner-controls-heading">
            <span><Settings2 aria-hidden="true" size={15} /> Configuration</span>
            <small className={isRunnable ? "runner-connected" : undefined}>{runAvailabilityStatus({ connectivityError, hasRunnableBaseline, isRunnable, platformConnectivity })}</small>
          </div>
          <div className="runner-control-grid">
            {platform.kind === "computer-native" ? (
              <CompactSelect label="Computer environment" value={environmentId} onChange={setEnvironmentId}>
                {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
              </CompactSelect>
            ) : (
              <CompactSelect label="Server" value={backendProfileId} onChange={setBackendProfileId}>
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

        {taskError && task.length > 0 && <p className="runner-validation-error" role="status">{taskError}</p>}
        {runError && !run && <p className="runner-validation-error" role="alert">{runError}</p>}
        {run && <RunStatusPanel error={runError} events={runEvents} isCancelling={isCancelling} isRefreshing={!isTerminalStatus(run.status)} onCancel={() => void stopRun()} run={run} />}
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

function mergeEvents(current: readonly RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  const byId = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.recordedSequence - right.recordedSequence);
}

function isTerminalStatus(status: RunView["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "reconciliation_required";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function toUserMessage(error: unknown): string {
  if (error instanceof PlatformApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The run could not be updated.";
}

function runAvailabilityStatus({
  connectivityError,
  hasRunnableBaseline,
  isRunnable,
  platformConnectivity,
}: {
  connectivityError: string | null;
  hasRunnableBaseline: boolean;
  isRunnable: boolean;
  platformConnectivity: PlatformConnectivity | null;
}): string {
  if (!hasRunnableBaseline) return "Unavailable";
  if (isRunnable) return "Ready";
  if (connectivityError) return "Unavailable";
  if (!platformConnectivity) return "Checking";
  return "Unavailable";
}

function runAvailabilityLabel({
  connectivityError,
  hasRunnableBaseline,
  isRunnable,
  platformConnectivity,
}: {
  connectivityError: string | null;
  hasRunnableBaseline: boolean;
  isRunnable: boolean;
  platformConnectivity: PlatformConnectivity | null;
}): string {
  if (!hasRunnableBaseline) return "This platform is not available yet.";
  if (isRunnable) return "Fake model is selected for the local baseline.";
  if (connectivityError) return connectivityError;
  if (!platformConnectivity) return "Checking platform availability…";
  return platformConnectivity.message;
}

function CompactSelect({ children, label, onChange, value }: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return <label className="compact-control"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{children}</select></label>;
}
