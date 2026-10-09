import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { appPaths } from "../../routes/paths";
import { getCapabilityProfiles, type CapabilityApproval, type CapabilityProfile, type RunView } from "./platformApi";
import { requiresUpfrontApproval } from "./connectedToolState";

const connectedProfileId = "connected-agent";

export function ConnectedCapabilitiesSummary({
  run,
  approvals,
  reviewOpen,
  onProfileLoaded,
  onReviewCancel,
  onApprovalDecision,
}: {
  readonly run: RunView | null;
  readonly approvals: readonly CapabilityApproval[];
  readonly reviewOpen: boolean;
  readonly onProfileLoaded: (profile: CapabilityProfile | null) => void;
  readonly onReviewCancel: () => void;
  readonly onApprovalDecision: (decision: CapabilityApproval["decision"]) => void;
}) {
  const { platformId } = useParams();
  const [profile, setProfile] = useState<CapabilityProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void getCapabilityProfiles(controller.signal)
      .then(profiles => {
        if (controller.signal.aborted) return;
        const connected = profiles.find(candidate => candidate.id === connectedProfileId) ?? null;
        setProfile(connected);
        setUnavailable(!connected || connected.available === false);
        setLoading(false);
        onProfileLoaded(connected);
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setProfile(null);
        setUnavailable(true);
        setLoading(false);
        onProfileLoaded(null);
      });
    return () => controller.abort();
  }, [onProfileLoaded]);

  const inventory = run?.manifest.capabilities?.inventory;
  const isRecordedRun = run !== null;
  const toolNames = inventory
    ? unique(inventory.sources.flatMap(source => source.tools.map(tool => tool.name)))
    : profile?.capabilities.map(capability => capability.displayName) ?? [];
  const skillNames = inventory
    ? unique(inventory.skills.map(skill => skill.name))
    : profile ? unique([...profile.skills, ...(profile.availableSkills ?? [])].map(skill => skill.name)) : [];
  const requiredCapabilities = profile?.capabilities.filter(requiresUpfrontApproval) ?? [];
  const hasApprovalForAll = requiredCapabilities.every(capability => approvals.some(approval => approval.capabilityId === capability.id
    && approval.version === capability.version
    && Date.parse(approval.expiresAt) > Date.now()));
  const toolStatus = loading ? "Loading…" : isRecordedRun && !inventory ? "Not recorded for this run" : unavailable ? "Unavailable" : `${toolNames.length} available`;
  const skillStatus = loading ? "Loading…" : isRecordedRun && !inventory ? "Not recorded for this run" : unavailable ? "Unavailable" : `${skillNames.length} available`;

  function decideApproval(decision: CapabilityApproval["decision"]): void {
    onApprovalDecision(decision);
  }

  return (
    <section className="chat-connected-capabilities" aria-label="Tools and skills">
      <div>
        <strong>Tools</strong>
        <span>{toolStatus}</span>
        {!loading && toolNames.length > 0 && <details className="chat-capability-list">
          <summary>View tools</summary>
          <ul>{toolNames.map(name => <li key={name}>{name}</li>)}</ul>
        </details>}
      </div>
      <div>
        <strong>Skills</strong>
        <span>{skillStatus}</span>
        {!loading && skillNames.length > 0 && <details className="chat-capability-list">
          <summary>View skills</summary>
          <ul>{skillNames.map(name => <li key={name}>{name}</li>)}</ul>
        </details>}
      </div>
      <Link className="quiet-button cap-manager-open" to={appPaths.platformPlugins(platformId ?? "mastra")}>Plugins</Link>

      {reviewOpen && requiredCapabilities.length > 0 && !hasApprovalForAll && <div className="model-select-backdrop" role="presentation">
        <section aria-labelledby="connected-approval-title" aria-modal="true" className="capability-approval-dialog" role="dialog">
          <header className="model-select-header">
            <div><span className="eyebrow">Tool access</span><h2 id="connected-approval-title">Allow connected actions?</h2></div>
            <button aria-label="Close approval dialog" className="icon-button" onClick={onReviewCancel} type="button"><X aria-hidden="true" size={17} /></button>
          </header>
          <div className="capability-approval-body">
            <AlertTriangle aria-hidden="true" size={18} />
            <p>These connected tools need approval for this run. Approving enables them for this run; individual actions can still require review.</p>
            <ul>{requiredCapabilities.map(capability => <li key={`${capability.id}@${capability.version}`}><strong>{capability.displayName}</strong><span>{capability.operations.join(", ")}</span></li>)}</ul>
          </div>
          <footer className="model-select-footer">
            <button className="quiet-button" onClick={() => decideApproval("denied")} type="button"><X aria-hidden="true" size={14} /> Deny</button>
            <button className="button button-primary" onClick={() => decideApproval("approved")} type="button"><Check aria-hidden="true" size={14} /> Approve for this run</button>
          </footer>
        </section>
      </div>}
    </section>
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
