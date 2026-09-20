import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { getCapabilityProfiles, type CapabilityApproval, type CapabilityProfile } from "./platformApi";

interface CapabilityPickerProps {
  readonly disabled?: boolean;
  readonly onChange: (profileId: string, approvals: readonly CapabilityApproval[]) => void;
  readonly value: string;
}

export function CapabilityPicker({ disabled, onChange, value }: CapabilityPickerProps) {
  const dialogId = useId();
  const [profiles, setProfiles] = useState<readonly CapabilityProfile[]>([]);
  const [failed, setFailed] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<CapabilityProfile | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getCapabilityProfiles(controller.signal)
      .then((next) => setProfiles(next))
      .catch((error) => {
        if (isAbortError(error)) return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const selectedProfile = profiles.find((profile) => profile.id === value);

  function selectProfile(profileId: string): void {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    if (profile.capabilities.some((capability) => capability.risk === "write" || capability.risk === "external")) {
      setPendingProfile(profile);
      return;
    }
    onChange(profile.id, []);
  }

  function decideApproval(decision: CapabilityApproval["decision"]): void {
    if (!pendingProfile) return;
    const writeCapability = pendingProfile.capabilities.find((capability) => capability.risk === "write" || capability.risk === "external");
    if (!writeCapability) return;
    const decidedAt = new Date();
    const expiresAt = new Date(decidedAt.getTime() + 15 * 60 * 1000);
    onChange(pendingProfile.id, [{
      schemaVersion: 1,
      decisionId: createApprovalId(),
      capabilityId: writeCapability.id,
      version: writeCapability.version,
      allowedOperations: writeCapability.operations,
      decision,
      decidedAt: decidedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }]);
    setPendingProfile(null);
  }

  return (
    <>
      <div className="compact-control capability-picker">
        <label htmlFor={`${dialogId}-select`}>Capabilities</label>
        <select aria-label="Capability profile" disabled={disabled || failed || profiles.length === 0} id={`${dialogId}-select`} onChange={(event) => selectProfile(event.target.value)} value={profiles.some((profile) => profile.id === value) ? value : ""}>
          {failed ? <option value="">Unavailable</option> : profiles.length === 0 ? <option value="">Loading</option> : profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}{profile.skills.length > 0 ? ` · ${profile.skills.length} skill` : ""}</option>)}
        </select>
        {selectedProfile && <div className="capability-picker-summary" aria-live="polite">
          <span>{selectedProfile.capabilities.map((capability) => capability.displayName).join(", ")}</span>
          {selectedProfile.skills.length > 0 && <small>{selectedProfile.skills.map((skill) => skill.name).join(", ")}</small>}
        </div>}
      </div>

      {pendingProfile && (
        <div className="model-select-backdrop" onMouseDown={() => setPendingProfile(null)} role="presentation">
          <section aria-labelledby={`${dialogId}-approval-title`} aria-modal="true" className="capability-approval-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header className="model-select-header">
              <div><span className="eyebrow">Approval</span><h2 id={`${dialogId}-approval-title`}>Allow write access?</h2></div>
              <button aria-label="Close approval dialog" className="icon-button" onClick={() => setPendingProfile(null)} type="button"><X aria-hidden="true" size={17} /></button>
            </header>
            <div className="capability-approval-body">
              <AlertTriangle aria-hidden="true" size={18} />
              <p>{pendingProfile.displayName} includes a write-capable capability. Approve it for this run?</p>
              <ul>
                {pendingProfile.capabilities.filter((capability) => capability.risk === "write" || capability.risk === "external").map((capability) => <li key={`${capability.id}@${capability.version}`}><strong>{capability.displayName}</strong><span>{capability.operations.join(", ")}</span></li>)}
              </ul>
            </div>
            <footer className="model-select-footer">
              <button className="quiet-button" onClick={() => decideApproval("denied")} type="button"><X aria-hidden="true" size={14} /> Deny</button>
              <button className="button button-primary" onClick={() => decideApproval("approved")} type="button"><Check aria-hidden="true" size={14} /> Approve</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function createApprovalId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `approval_${random}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
