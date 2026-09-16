import { Ban, CheckCircle2, CircleAlert, Clock3, LoaderCircle, RotateCw, XCircle } from "lucide-react";

import type { ContextProjection, RunEvent, RunStatus, RunView } from "./platformApi";

interface RunStatusPanelProps {
  readonly error: string | null;
  readonly events: readonly RunEvent[];
  readonly isCancelling: boolean;
  readonly isRefreshing: boolean;
  readonly onCancel: () => void;
  readonly run: RunView;
}

const statusLabels: Record<RunStatus, string> = {
  created: "Created",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  reconciliation_required: "Reconciliation required",
};

const statusIcons: Record<RunStatus, typeof Clock3> = {
  created: Clock3,
  queued: Clock3,
  running: LoaderCircle,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: Ban,
  reconciliation_required: CircleAlert,
};

export function RunStatusPanel(props: RunStatusPanelProps) {
  const StatusIcon = statusIcons[props.run.status];
  const canCancel = props.run.status === "created" || props.run.status === "queued" || props.run.status === "running";
  const result = props.run.result;

  return (
    <section aria-live="polite" className="run-status-panel">
      <header className="run-status-header">
        <div>
          <span className="eyebrow">Run</span>
          <h2>{statusLabels[props.run.status]}</h2>
        </div>
        <div className={`run-status-badge run-status-${props.run.status}`}>
          <StatusIcon aria-hidden="true" className={props.run.status === "running" ? "is-spinning" : undefined} size={14} />
          {statusLabels[props.run.status]}
        </div>
      </header>

      <div className="run-status-meta">
        <code>{props.run.runId}</code>
        <span>{props.run.projection.state === "stale" ? "Stale" : props.isRefreshing ? "Updating" : "Server state"}</span>
        {canCancel && (
          <button className="quiet-button run-cancel-button" disabled={props.isCancelling} onClick={props.onCancel} type="button">
            {props.isCancelling ? <LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> : <Ban aria-hidden="true" size={14} />}
            {props.isCancelling ? "Cancelling" : "Cancel"}
          </button>
        )}
      </div>

      {props.run.projection.state === "stale" && (
        <p className="run-projection-stale"><CircleAlert aria-hidden="true" size={14} /> {props.run.projection.reason ?? "The latest platform state is not available."}</p>
      )}

      {props.error && <p className="run-inline-error"><CircleAlert aria-hidden="true" size={15} /> {props.error}</p>}

      {props.run.context && <ContextBudgetMeter context={props.run.context} />}

      {result?.output && (
        <div className="run-output">
          <span className="run-section-label">Output</span>
          <p>{result.output}</p>
        </div>
      )}

      {result?.error && (
        <div className="run-result-error">
          <span className="run-section-label">Result</span>
          <strong>{result.error.code}</strong>
          <p>{result.error.message}</p>
        </div>
      )}

      <dl className="run-manifest-summary">
        <div><dt>Variant</dt><dd>{props.run.manifest.variant}</dd></div>
        <div><dt>Model</dt><dd>{props.run.manifest.model.provider} / {props.run.manifest.model.model}</dd></div>
        {props.run.manifest.selection?.scenarioId && <div><dt>Scenario</dt><dd>{props.run.manifest.selection.scenarioId}</dd></div>}
        {props.run.manifest.selection?.backendProfileId && <div><dt>Server</dt><dd>{props.run.manifest.selection.backendProfileId}</dd></div>}
        {props.run.manifest.selection?.infrastructureId && <div><dt>Infrastructure</dt><dd>{props.run.manifest.selection.infrastructureId}</dd></div>}
        {props.run.manifest.selection?.experimentId && <div><dt>Experiment</dt><dd>{props.run.manifest.selection.experimentId}</dd></div>}
        {props.run.executionReference && <div><dt>Execution</dt><dd>{props.run.executionReference.executionId}</dd></div>}
      </dl>

      <div className="run-evidence-grid">
        <div>
          <span className="run-section-label">Events</span>
          <strong>{props.events.length}</strong>
        </div>
        <div>
          <span className="run-section-label">Attempts</span>
          <strong>{result?.attemptCount ?? "—"}</strong>
        </div>
        {props.run.executionReference && (
          <div>
            <span className="run-section-label">Platform</span>
            <strong title={props.run.executionReference.executionId}>{props.run.executionReference.platform}</strong>
          </div>
        )}
      </div>

      <div className="run-events">
        <div className="run-events-heading">
          <span className="run-section-label">Event timeline</span>
          {props.isRefreshing && <RotateCw aria-label="Refreshing events" className="is-spinning" size={13} />}
        </div>
        {props.events.length === 0 ? (
          <p className="run-events-empty">Waiting for the first event.</p>
        ) : (
          <ol>
            {props.events.map((event) => <RunEventRow event={event} key={event.eventId} />)}
          </ol>
        )}
      </div>
    </section>
  );
}

export function ContextBudgetMeter({ context }: { context: ContextProjection }) {
  const usedPercent = context.budget.contextWindowTokens === null || context.budget.inputTokens === null
    ? null
    : Math.max(0, Math.min(100, Math.floor((context.budget.inputTokens / context.budget.contextWindowTokens) * 100)));
  const remainingPercent = context.budget.remainingPercent === null
    ? null
    : Math.max(0, Math.min(100, context.budget.remainingPercent));
  const pressureLabel = contextPressureLabel(context.budget.pressure);
  const valueLabel = usedPercent === null ? "Usage unknown" : `${usedPercent}% used`;
  const accessibleLabel = usedPercent === null
    ? `Context window usage: ${pressureLabel ?? "unknown"}`
    : `Context window usage: ${valueLabel}, ${Math.round(remainingPercent ?? 0)}% left`;

  return (
    <section aria-label="Context window" className={`run-context run-context-${context.budget.pressure}`}>
      <div className="run-context-heading">
        <div className="run-context-title">
          <span className="run-section-label">{context.scope === "run" ? "Request context" : "Context window"}</span>
          <span className="run-context-tokens">{formatTokenCount(context.budget.inputTokens)} / {formatTokenCount(context.budget.contextWindowTokens)} tokens</span>
        </div>
        <div className="run-context-summary">
          <strong>{valueLabel}</strong>
          {remainingPercent !== null && <span>{Math.round(remainingPercent)}% left</span>}
          {pressureLabel && pressureLabel !== "Unknown" && <span>{pressureLabel}</span>}
        </div>
      </div>
      <div
        aria-label={accessibleLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        {...(usedPercent === null ? {} : { "aria-valuenow": usedPercent })}
        className={`run-context-track ${remainingPercent === null ? "is-unknown" : ""}`}
        role="progressbar"
      >
        <span style={{ width: `${usedPercent ?? 0}%` }} />
      </div>
      <details className="run-context-details">
        <summary>Details</summary>
        <dl>
          <div><dt>Used</dt><dd>{formatTokenCount(context.budget.inputTokens)}</dd></div>
          <div><dt>Limit</dt><dd>{formatTokenCount(context.budget.contextWindowTokens)}</dd></div>
          <div><dt>Reserved</dt><dd>{formatTokenCount(context.budget.reservedOutputTokens)}</dd></div>
          {context.compactionRevision > 0 && <div><dt>Compactions</dt><dd>{context.compactionRevision}</dd></div>}
        </dl>
      </details>
    </section>
  );
}

function contextPressureLabel(pressure: ContextProjection["budget"]["pressure"]): string | null {
  switch (pressure) {
    case "compaction_due":
      return "Compaction due";
    case "compacting":
      return "Compacting";
    case "exhausted":
      return "Exhausted";
    case "unknown":
      return "Unknown";
    case "normal":
      return null;
  }
}

function formatTokenCount(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return value.toLocaleString();
}

function RunEventRow({ event }: { event: RunEvent }) {
  return (
    <li>
      <span className="run-event-sequence">{event.recordedSequence}</span>
      <div>
        <strong>{event.kind}</strong>
        <small>{formatEventTime(event.occurredAt)} · {event.source}</small>
      </div>
    </li>
  );
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
