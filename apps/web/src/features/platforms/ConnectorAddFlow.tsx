import { ArrowLeft, ArrowRight, Blocks, ExternalLink, Plus, Search } from "lucide-react";
import { useState } from "react";
import {
  connectionAction,
  saveConnection,
  type ManagementState,
} from "./managementApi";
import {
  connectionForConnector,
  guidedConnectorCatalog,
  type ConnectorAccess,
  type GuidedConnectorPreset,
} from "./connectorCatalog";
import "./connectors.css";

type SavedConnector = { ref: string; displayName: string };

export function ConnectorAddFlow({
  state,
  busy,
  run,
  publish,
  onCustom,
  onCancel,
  onAuthorization,
  onComplete,
}: {
  state: ManagementState;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  publish: (state: ManagementState) => void;
  onCustom: () => void;
  onCancel: () => void;
  onAuthorization: (url: string) => void;
  onComplete: () => void;
}) {
  const [preset, setPreset] = useState<GuidedConnectorPreset | null>(null);
  const [access, setAccess] = useState<ConnectorAccess>("read");
  const [saved, setSaved] = useState<SavedConnector | null>(null);
  const [search, setSearch] = useState("");
  const matchingConnectors = guidedConnectorCatalog.filter(item =>
    `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function connect() {
    if (!preset) return;
    await run(async () => {
      let current = state;
      let target = saved;
      if (!target) {
        const ref = uniqueRef(preset);
        const displayName = uniqueDisplayName(preset, state.connections);
        current = await saveConnection(
          state.revision,
          connectionForConnector(preset, access, ref, displayName, location.origin),
        );
        target = { ref, displayName };
        setSaved(target);
        publish(current);
      }

      const result = await connectionAction(target.ref, "connect", current.revision);
      publish(result.state);
      if (!result.authorizationUrl) throw new Error("The provider did not start an account authorization flow.");
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== "https:" && !(authorizationUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(authorizationUrl.hostname))) {
        throw new Error("The provider returned an unsupported authorization address.");
      }
      onAuthorization(authorizationUrl.toString());
      onComplete();
    });
  }

  if (!preset) {
    return <div className="connector-add-flow">
      <div className="connector-catalog-intro">
        <span className="connector-icon"><Blocks size={22} /></span>
        <div><h3>Connect a service</h3><p>Choose a service, then approve access on its sign-in page.</p></div>
      </div>
      <label className="connector-catalog-search">
        <Search size={16} aria-hidden="true" />
        <input aria-label="Search available connectors" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search services" />
      </label>
      <div className="connector-catalog-grid">
        {matchingConnectors.map(item => <button className="connector-catalog-card" type="button" key={item.id} disabled={busy} onClick={() => { setPreset(item); setAccess(item.readOnlyAvailable ? "read" : "read_write"); }}>
          <span className="connector-catalog-mark" data-provider={item.id}>{connectorMark(item)}</span>
          <span className="connector-catalog-copy"><strong>{item.name}</strong><span>{item.description}</span><small>{item.category} · OAuth sign-in</small></span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>)}
        {matchingConnectors.length === 0 && <div className="connector-empty">No services match “{search.trim()}”. Try another name or category.</div>}
      </div>
      <div className="connector-catalog-custom"><span>Looking for another service?</span><button type="button" className="quiet-button" disabled={busy} onClick={onCustom}><Plus size={15} /> Add a custom MCP server</button></div>
      <div className="connector-add-actions"><button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </div>;
  }

  return <div className="connector-add-flow">
    <button className="connector-back" type="button" disabled={busy} onClick={() => { if (saved) return; setPreset(null); setAccess("read"); }}><ArrowLeft size={15} /> All connectors</button>
    <div className="connector-catalog-intro">
      <span className="connector-catalog-mark" data-provider={preset.id}>{connectorMark(preset)}</span>
      <div><h3>{saved ? `${preset.name} is ready to connect` : `Connect ${preset.name}`}</h3><p>{preset.description}</p></div>
    </div>
    {!saved && preset.readOnlyAvailable ? <fieldset className="connector-access-choice" disabled={busy}>
      <legend>What access should the agent have?</legend>
      <label><input type="radio" name="connector-access" checked={access === "read"} onChange={() => setAccess("read")} /><span><strong>{preset.readAccessLabel}</strong><small>Start with search and view tools. You can reconnect later to grant more access.</small></span></label>
      <label><input type="radio" name="connector-access" checked={access === "read_write"} onChange={() => setAccess("read_write")} /><span><strong>{preset.writeAccessLabel}</strong><small>Also allow changes supported by this service. Write actions still require review in the Lab.</small></span></label>
    </fieldset> : !saved ? <div className="connector-access-required"><strong>{preset.writeAccessLabel}</strong><p>{preset.accessNote}</p></div> : <p className="connector-catalog-saved">The connector is saved. Continue to the provider to approve the selected access.</p>}
    <div className="connector-provider-note"><span>Service</span><code>{preset.resource}</code><a href={preset.documentationUrl} target="_blank" rel="noreferrer">Provider details <ExternalLink size={13} /></a></div>
    <div className="connector-add-actions">
      <button className="button connector-add" type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Preparing…" : saved ? "Continue to sign in" : `Continue with ${preset.name}`}<ArrowRight size={16} /></button>
      <button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

function uniqueRef(preset: GuidedConnectorPreset) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `conn_${preset.id.replaceAll("-", "_")}_${suffix}`;
}

function uniqueDisplayName(preset: GuidedConnectorPreset, connections: readonly ManagementState["connections"][number][]) {
  const existing = connections.filter(item => item.provider === preset.provider).length;
  return existing ? `${preset.name} ${existing + 1}` : preset.name;
}

function connectorMark(preset: GuidedConnectorPreset) {
  const marks: Record<string, string> = {
    notion: "N", linear: "L", "atlassian-rovo": "A", monday: "m", miro: "M",
    intercom: "i", posthog: "P", "new-relic-us": "NR", cloudflare: "CF",
    "cloudflare-observability": "CF", railway: "R", supabase: "S", gitlab: "GL",
    stripe: "S", "wordpress-com": "W",
  };
  return marks[preset.id] ?? preset.name.slice(0, 1).toUpperCase();
}
