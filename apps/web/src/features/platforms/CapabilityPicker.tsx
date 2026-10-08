import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { getCapabilityProfiles, type CapabilityApproval, type CapabilityProfile } from "./platformApi";
import { ConnectionPanel } from "./ConnectionPanel";
import { Link, useParams } from "react-router";
import { appPaths } from "../../routes/paths";
import { requiresUpfrontApproval } from "./connectedToolState";
import "./connected-tools.css";

interface CapabilityPickerProps {
  readonly disabled?: boolean;
  readonly onChange: (profileId: string, approvals: readonly CapabilityApproval[]) => void;
  readonly value: string;
  readonly selectedSkillIds?: readonly string[];
  readonly onSkillsChange?: (ids: readonly string[]) => void;
  readonly targets?: readonly string[];
}

export function CapabilityPicker({ disabled, onChange, value, selectedSkillIds = [], onSkillsChange, targets = [] }: CapabilityPickerProps) {
  const dialogId = useId();
  const [profiles, setProfiles] = useState<readonly CapabilityProfile[]>([]);
  const [failed, setFailed] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<CapabilityProfile | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const { platformId } = useParams();

  useEffect(() => {
    const controller = new AbortController();
    void getCapabilityProfiles(controller.signal)
      .then((next) => { setProfiles(next); setFailed(false); })
      .catch((error) => {
        if (isAbortError(error)) return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [catalogRevision]);

  const selectedProfile = profiles.find((profile) => profile.id === value);
  const supported = (profile: CapabilityProfile) => profile.available !== false && (!profile.supportedVariants || targets.every(target => profile.supportedVariants!.includes(target)));

  function selectProfile(profileId: string): void {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile || !supported(profile)) return;
    onSkillsChange?.([]);
    if (profile.capabilities.some(requiresUpfrontApproval)) {
      setPendingProfile(profile);
      return;
    }
    onChange(profile.id, []);
  }

  function decideApproval(decision: CapabilityApproval["decision"]): void {
    if (!pendingProfile) return;
    const writeCapabilities = pendingProfile.capabilities.filter(requiresUpfrontApproval);
    if (writeCapabilities.length === 0) return;
    const decidedAt = new Date();
    const expiresAt = new Date(decidedAt.getTime() + 15 * 60 * 1000);
    onChange(pendingProfile.id, writeCapabilities.map(writeCapability => ({
      schemaVersion: 1,
      decisionId: createApprovalId(),
      capabilityId: writeCapability.id,
      version: writeCapability.version,
      allowedOperations: writeCapability.operations,
      ...(writeCapability.connectionRef ? { connectionRef: writeCapability.connectionRef } : {}),
      decision,
      decidedAt: decidedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })));
    setPendingProfile(null);
  }

  return (
    <>
      <div className="compact-control capability-picker">
        <label htmlFor={`${dialogId}-select`}>Capabilities</label>
        <select aria-label="Capability profile" disabled={disabled || failed || profiles.length === 0} id={`${dialogId}-select`} onChange={(event) => selectProfile(event.target.value)} value={profiles.length ? value : ""}>
          {failed ? <option value="">Unavailable</option> : profiles.length === 0 ? <option value="">Loading</option> : <>{!selectedProfile && <option value={value} disabled>Selected profile unavailable</option>}{profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!supported(profile)}>{profile.displayName}{!supported(profile) ? " · unavailable" : profile.skills.length > 0 ? ` · ${profile.skills.length} skill` : ""}</option>)}</>}
        </select>
        <Link className="quiet-button cap-manager-open" to={appPaths.platformPlugins(platformId ?? "mastra")}>Plugins</Link>
        {selectedProfile && <div className="capability-picker-summary" aria-live="polite">
          {!supported(selectedProfile) && <small>This profile is unavailable for the selected platform variant.</small>}
          <span>{selectedProfile.capabilities.map((capability) => capability.displayName).join(", ")}</span>
          {selectedProfile.capabilities.some(capability => capability.approvalMode === "invocation") && <small>Sensitive actions are reviewed when proposed.</small>}
          {selectedProfile.skills.length > 0 && <small>Preloaded: {selectedProfile.skills.map((skill) => skill.name).join(", ")}</small>}
          {(selectedProfile.availableSkills?.length ?? 0) > 0 && <small>Available skills: {selectedProfile.availableSkills!.map((skill) => skill.name).join(", ")}</small>}
          {onSkillsChange && (selectedProfile.availableSkills?.length ?? 0) > 0 && <label>
            Activate a skill
            <select aria-label="Activate a skill" disabled={disabled} value={selectedSkillIds[0] ?? ""} onChange={event => onSkillsChange(event.target.value ? [event.target.value] : [])}>
              <option value="">Agent chooses</option>
              {selectedProfile.availableSkills!.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </label>}
        </div>}
      </div>
      <ConnectionPanel selectedRefs={[...new Set(selectedProfile?.capabilities.flatMap(capability => capability.connectionRef ? [capability.connectionRef] : []) ?? [])]} disabled={disabled} onChanged={() => setCatalogRevision(current => current + 1)} />

      {pendingProfile && (
        <div className="model-select-backdrop" onMouseDown={() => setPendingProfile(null)} role="presentation">
          <section aria-labelledby={`${dialogId}-approval-title`} aria-modal="true" className="capability-approval-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header className="model-select-header">
              <div><span className="eyebrow">Approval</span><h2 id={`${dialogId}-approval-title`}>Allow tool actions?</h2></div>
              <button aria-label="Close approval dialog" className="icon-button" onClick={() => setPendingProfile(null)} type="button"><X aria-hidden="true" size={17} /></button>
            </header>
            <div className="capability-approval-body">
              <AlertTriangle aria-hidden="true" size={18} />
              <p>{pendingProfile.displayName} includes the actions below. Approve them for this run?</p>
              <ul>
                {pendingProfile.capabilities.filter(requiresUpfrontApproval).map((capability) => <li key={`${capability.id}@${capability.version}`}><strong>{capability.displayName}</strong><span>{capability.operations.join(", ")}</span></li>)}
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
