import { Check, FileText, Headphones, NotebookPen, Plug, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./connectors.css";

type Connector = { ref: string; displayName: string; provider: string; status?: string; enabled?: boolean };

/** A directory of configured services, shared by read-only and editing sessions. */
export function ConnectorDirectory({ connections, onAdd, onSelect, busy, toolCounts = {} }: { connections: readonly Connector[]; onAdd: () => void; onSelect: (ref: string) => void; busy: boolean; toolCounts?: Record<string, number> }) {
  const [query, setQuery] = useState("");
  const visible = connections.filter(item => `${item.displayName} ${item.provider}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <><div className="connector-toolbar"><h3>Your connectors <span className="cap-manager-muted">{connections.length}</span></h3><div className="connector-toolbar-controls"><label className="connector-search"><Search size={16} /><input aria-label="Search connectors" placeholder="Search connectors" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="button connector-add" type="button" disabled={busy} onClick={onAdd}><Plus size={17} /> Add</button></div></div>
    <div className="connector-grid">{visible.map(connection => {
      const name = connection.displayName.toLowerCase();
      const tone = /memo|note/.test(name) ? "notes" : /document/.test(name) ? "documents" : /support/.test(name) ? "support" : "default";
      const Icon = tone === "notes" ? NotebookPen : tone === "documents" ? FileText : tone === "support" ? Headphones : Plug;
      const connected = connection.enabled !== false && connection.status === "available";
      const status = connection.enabled === false ? "Disabled" : connected ? "Connected" : connection.status === "authorization_required" ? "Sign in" : connection.status === "revoked" ? "Disconnected" : connection.status === "expired" ? "Expired" : connection.status === "connecting" ? "Connecting" : "Needs setup";
      const count = toolCounts[connection.ref];
      return <button className="connector-card" key={connection.ref} type="button" disabled={busy} onClick={() => onSelect(connection.ref)} aria-label={`Manage ${connection.displayName}`}><span className="connector-icon" data-tone={tone}><Icon size={25} strokeWidth={1.6} /></span><span className="connector-card-copy"><strong>{connection.displayName}</strong><span>{count === undefined ? "Connect this service to your agents" : count > 0 ? `${count} ${count === 1 ? "tool" : "tools"} configured for your agents` : "Discover tools to get started"}</span><small>{connection.provider.includes("fixture") ? "Development fixture" : connection.provider === "mcp" ? "MCP connector" : connection.provider === "memos" ? "Memos" : connection.provider}</small></span><span className="connector-card-status" data-status={connected ? "connected" : connection.enabled === false ? "disabled" : "attention"}>{connected && <Check size={13} />} {status}</span></button>;
    })}</div>{!visible.length && <p className="connector-empty">{connections.length ? "No connectors match your search." : "Connect your first service to give your agents more tools."}</p>}
  </>;
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
