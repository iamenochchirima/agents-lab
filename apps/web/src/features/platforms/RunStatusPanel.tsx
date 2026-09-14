import { Ban, CheckCircle2, CircleAlert, Clock3, LoaderCircle, RotateCw, XCircle } from "lucide-react";

import type { RunEvent, RunStatus, RunView } from "./platformApi";

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
        <span>{props.isRefreshing ? "Updating" : "Server state"}</span>
        {canCancel && (
          <button className="quiet-button run-cancel-button" disabled={props.isCancelling} onClick={props.onCancel} type="button">
            {props.isCancelling ? <LoaderCircle aria-hidden="true" className="is-spinning" size={14} /> : <Ban aria-hidden="true" size={14} />}
            {props.isCancelling ? "Cancelling" : "Cancel"}
          </button>
        )}
      </div>

      {props.error && <p className="run-inline-error"><CircleAlert aria-hidden="true" size={15} /> {props.error}</p>}

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
        {props.run.temporalReference && <div><dt>Task queue</dt><dd>{props.run.temporalReference.taskQueue}</dd></div>}
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
        {props.run.temporalReference && (
          <div>
            <span className="run-section-label">Workflow</span>
            <strong title={props.run.temporalReference.workflowId}>{props.run.temporalReference.workflowId}</strong>
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
