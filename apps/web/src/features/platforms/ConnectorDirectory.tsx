import { Check, FileText, Headphones, NotebookPen, Plug, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { guidedConnectorCatalog, type GuidedConnectorPreset } from "./connectorCatalog";
import "./connectors.css";

type Connector = { ref: string; displayName: string; provider: string; resource: string; status?: string; enabled?: boolean };

/** The guided service catalog is the default view; custom MCP connections remain manageable below it. */
export function ConnectorDirectory({ connections, onAdd, onSelect, onConnect, credentialStorageAvailable, busy, toolCounts = {} }: {
  connections: readonly Connector[];
  onAdd: () => void;
  onSelect: (ref: string) => void;
  onConnect: (preset: GuidedConnectorPreset) => void;
  credentialStorageAvailable?: boolean;
  busy: boolean;
  toolCounts?: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.toLowerCase().trim();
  const visiblePresets = guidedConnectorCatalog.filter(item =>
    `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(normalizedQuery),
  );
  const customConnections = connections.filter(connection =>
    !guidedConnectorCatalog.some(preset => normalizeResource(preset.resource) === normalizeResource(connection.resource)),
  ).filter(item => `${item.displayName} ${item.provider}`.toLowerCase().includes(normalizedQuery));

  return <>
    <div className="connector-toolbar">
      <h3>Connectors <span className="cap-manager-muted">{guidedConnectorCatalog.length}</span></h3>
      <div className="connector-toolbar-controls">
        <label className="connector-search"><Search size={16} /><input aria-label="Search connectors" placeholder="Search connectors" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button className="button connector-add" type="button" disabled={busy} onClick={onAdd}><Plus size={17} /> Add</button>
      </div>
    </div>
    <p className="connector-catalog-caption">Connect a service to make its tools available to agents.</p>
    {credentialStorageAvailable === false && <p className="connector-setup-hint" role="status">Account connections need encrypted local credential storage. Configure it in <code>server/.env.capabilities</code>, then restart the local stack. <a href="/docs/guides/capability-management.md">Local setup guide</a></p>}
    <div className="connector-grid">
      {visiblePresets.map(preset => {
        const matching = connections.filter(item => normalizeResource(item.resource) === normalizeResource(preset.resource));
        const existing = matching.find(item => item.enabled !== false && item.status === "available") ?? matching[0];
        const connected = Boolean(existing && existing.enabled !== false && existing.status === "available");
        const mark = connectorMark(preset);
        return <article className="connector-card" key={preset.id}>
          <span className="connector-catalog-mark" data-provider={preset.id} aria-hidden="true">{mark}</span>
          <span className="connector-card-copy"><strong>{preset.name}</strong><span>{preset.description}</span><small>{preset.category} · OAuth</small></span>
          {connected && existing
            ? <button className="connector-card-action is-connected" type="button" disabled={busy} aria-label={`Manage ${preset.name} connection`} title="Manage connection" onClick={() => onSelect(existing.ref)}><Check size={18} /></button>
            : <button className="connector-card-action" type="button" disabled={busy || credentialStorageAvailable === false} aria-label={`${existing ? "Reconnect" : "Connect"} ${preset.name}`} title={credentialStorageAvailable === false ? "Configure local credential storage to connect" : existing ? "Reconnect" : "Connect"} onClick={() => onConnect(preset)}><Plus size={18} /></button>}
        </article>;
      })}
      {visiblePresets.length === 0 && customConnections.length === 0 && <p className="connector-empty">No connectors match “{query.trim()}”.</p>}
    </div>
    {customConnections.length > 0 && <>
      <div className="connector-subheading"><h4>Your custom connections</h4><span>{customConnections.length}</span></div>
      <div className="connector-grid">{customConnections.map(connection => {
        const name = connection.displayName.toLowerCase();
        const tone = /memo|note/.test(name) ? "notes" : /document/.test(name) ? "documents" : /support/.test(name) ? "support" : "default";
        const Icon = tone === "notes" ? NotebookPen : tone === "documents" ? FileText : tone === "support" ? Headphones : Plug;
        const connected = connection.enabled !== false && connection.status === "available";
        const status = connection.enabled === false ? "Disabled" : connected ? "Connected" : connection.status === "authorization_required" ? "Sign in" : connection.status === "revoked" ? "Disconnected" : connection.status === "expired" ? "Expired" : connection.status === "connecting" ? "Connecting" : "Needs setup";
        const count = toolCounts[connection.ref];
        return <button className="connector-card connector-custom-card" key={connection.ref} type="button" disabled={busy} onClick={() => onSelect(connection.ref)} aria-label={`Manage ${connection.displayName}`}><span className="connector-icon" data-tone={tone}><Icon size={25} strokeWidth={1.6} /></span><span className="connector-card-copy"><strong>{connection.displayName}</strong><span>{count === undefined ? "Connect this service to your agents" : count > 0 ? `${count} ${count === 1 ? "tool" : "tools"} configured for your agents` : "Discover tools to get started"}</span><small>{connection.provider === "mcp" ? "Custom MCP server" : connection.provider === "memos" ? "Memos" : connection.provider}</small></span><span className="connector-card-status" data-status={connected ? "connected" : connection.enabled === false ? "disabled" : "attention"}>{connected && <Check size={13} />} {status}</span></button>;
      })}</div>
    </>}
  </>;
}

function normalizeResource(resource: string) { return resource.replace(/\/+$/, "").toLowerCase(); }

function connectorMark(preset: GuidedConnectorPreset) {
  const marks: Record<string, string> = {
    notion: "N", linear: "L", "atlassian-rovo": "A", monday: "m", miro: "M", intercom: "i", posthog: "P",
    "new-relic-us": "NR", cloudflare: "CF", "cloudflare-observability": "CF", railway: "R", supabase: "S", gitlab: "GL", stripe: "S", "wordpress-com": "W",
  };
  return marks[preset.id] ?? preset.name.slice(0, 1).toUpperCase();
}

/** Modal focus stays within the active editor and returns to its opening control. */
export function ConnectorModal({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    const first = dialog.current?.querySelector<HTMLElement>("input, select") ?? dialog.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => { if (root) root.inert = wasInert; document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [title]);
  return createPortal(<div className="connector-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="connector-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} ref={dialog} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && !busy) onClose();
    if (event.key !== "Tab") return;
    const controls = [...dialog.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary")].filter(item => item.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><header className="connector-modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Close connector dialog" disabled={busy} onClick={onClose}><X size={19} /></button></header><div className="connector-modal-body">{children}</div></section></div>, document.body);
}
