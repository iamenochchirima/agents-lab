import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { appPaths } from "../../routes/paths";
import { getCapabilityProfiles, type CapabilityProfile, type RunView } from "./platformApi";

const connectedProfileId = "connected-agent";

export function ConnectedCapabilitiesSummary({
  run,
  onProfileLoaded,
}: {
  readonly run: RunView | null;
  readonly onProfileLoaded: (profile: CapabilityProfile | null) => void;
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
  const toolStatus = loading ? "Loading…" : isRecordedRun && !inventory ? "Not recorded for this run" : unavailable ? "Unavailable" : `${toolNames.length} available`;
  const skillStatus = loading ? "Loading…" : isRecordedRun && !inventory ? "Not recorded for this run" : unavailable ? "Unavailable" : `${skillNames.length} available`;

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


    </section>
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
