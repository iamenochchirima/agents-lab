import { X, Plus, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  connectionAction, deleteConnection, deleteInstallation, deletePackage, deleteProfile, getManagementSession, getManagementState, getSkillInspection,
  ManagementApiError, installPackage, previewInstallation, saveConnection, savePackage, saveProfile,
  type Approval, type ConnectionRecord, type InstallationPreview, type InstallInput, type ManagementState, type PackageRecord, type ProfileRecord, type Risk, type SafeCredentialSummary, type SkillInspection, type ToolManifest, type ToolSelection,
} from "./managementApi";
import "./management.css";
import { ConnectorDirectory, ConnectorModal } from "./ConnectorDirectory";

type Tab = "Connections" | "Tools" | "Skills" | "Plugins" | "Profiles";
const tabs: Tab[] = ["Connections", "Tools", "Skills", "Plugins", "Profiles"];
const message = (error: unknown) => error instanceof Error ? error.message : "The action could not be completed.";
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 48);
const approvalLabel = (approval: Approval) => approval === "invocation" ? "Review each action" : approval === "tool_grant" ? "Approve before run" : "Allow automatically";

/** Shared administration surface: platform runtimes consume published profiles. */
export function CapabilityManager({ onClose, onChanged, presentation = "dialog" }: { onClose?: () => void; onChanged: () => void; presentation?: "dialog" | "page" }) {
  const titleId = useId();
  const [state, setState] = useState<ManagementState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("Connections");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    if (presentation === "dialog") dialog.current?.focus();
    let active = true;
    void load(() => active);
    return () => { active = false; previousFocus?.focus(); };
  }, []);
  async function load(isActive: () => boolean = () => true) {
    setBusy(true); setError(null); setLoadFailed(false);
    try {
      await getManagementSession();
      const next = await getManagementState();
      if (isActive()) setState(next);
    } catch (cause) {
      if (isActive()) { setLoadFailed(true); setError(message(cause)); }
    } finally { if (isActive()) setBusy(false); }
  }
  async function run(action: () => Promise<void>) { setBusy(true); setError(null); try { await action(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  function publish(value: ManagementState) { setState(value); onChanged(); }
  async function operate(ref: string, action: "discover" | "connect" | "refresh" | "revoke") {
    await run(async () => {
      setAuthorizationUrl(null);
      let result: Awaited<ReturnType<typeof connectionAction>>;
      try { result = await connectionAction(ref, action, state!.revision); }
      catch (cause) {
        if (cause instanceof ManagementApiError && (cause.status === 401 || cause.status === 409)) throw cause;
        await getManagementState().then(publish).catch(() => undefined);
        const name = state!.connections.find(connection => connection.ref === ref)?.displayName ?? "this connection";
        const help = action === "discover" ? "Check the MCP URL and authorize or replace credentials, then try again." : action === "refresh" ? "Check the service and credentials; OAuth accounts may need authorization again." : action === "connect" ? "Check the client settings and allowed issuer, then try again." : "Reload to check access before trying again.";
        throw new Error(`Could not ${action === "discover" ? "discover tools for" : action} ${name}. ${help}`);
      }
      publish(result.state);
      if (result.authorizationUrl) {
        const url = new URL(result.authorizationUrl);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Unsupported authorization address.");
        setAuthorizationUrl(url.toString());
      }
    });
  }
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !busy) onClose?.();
    if (event.key !== "Tab") return;
    const controls = [...dialog.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary")].filter(element => element.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const content = <section className={`cap-manager${presentation === "page" ? " cap-manager-page" : ""}`} ref={dialog} tabIndex={-1} onKeyDown={presentation === "dialog" ? keyDown : undefined} role={presentation === "dialog" ? "dialog" : undefined} aria-modal={presentation === "dialog" ? true : undefined} aria-labelledby={titleId} aria-busy={busy}>
      <header className="cap-manager-header"><div><span className="eyebrow">Agent customization</span>{presentation === "page" ? <h1 id={titleId}>Plugins</h1> : <h2 id={titleId}>Tools, skills and connections</h2>}<p className="cap-manager-muted">Connect tools and choose what your agents can use.</p></div>{presentation === "dialog" && <button className="icon-button" type="button" aria-label="Close capability manager" disabled={busy} onClick={onClose}><X size={18} /></button>}</header>
      {error && <p className="cap-manager-error" role="alert">{error}</p>}
      <nav className="cap-manager-tabs" aria-label="Capability categories">{tabs.map(item => <button key={item} className={item === tab ? "active" : ""} aria-current={item === tab ? "page" : undefined} type="button" onClick={() => { setTab(item); setError(null); }} disabled={busy}>{item === "Connections" ? "Connectors" : item}</button>)}{state && <button className="cap-manager-reload" type="button" disabled={busy} onClick={() => void run(async () => setState(await getManagementState()))}>Reload</button>}</nav>
      {loadFailed ? <div className="cap-manager-body"><p className="cap-manager-muted">The capability service is unavailable. Your saved connectors have not been removed.</p><button type="button" className="button button-primary" disabled={busy} onClick={() => void load()}>Try again</button></div> : !state ? <p className="cap-manager-body" role="status">Loading connections…</p> : <>
        <div className="cap-manager-body">
          {authorizationUrl && <p><a href={authorizationUrl} rel="noreferrer" target="_blank">Continue account authorization</a><span className="cap-manager-muted"> · Refresh the connection after returning.</span></p>}
          {tab === "Connections" && <Connections state={state} busy={busy} run={run} publish={publish} operate={operate} error={error} authorizationUrl={authorizationUrl} />}
          {tab === "Tools" && <Tools state={state} busy={busy} run={run} publish={publish} />}
          {(tab === "Skills" || tab === "Plugins") && <Installations key={tab} state={state} kind={tab} busy={busy} run={run} publish={publish} />}
          {tab === "Profiles" && <Profiles state={state} busy={busy} run={run} publish={publish} />}
        </div>
        <footer className="cap-manager-footer"><span>Saved changes apply to new runs.</span><span>Revision {state.revision}</span></footer>
      </>}
    </section>;
  if (presentation === "page") return content;
  // Dialogs escape the platform content stacking context; pages stay in normal flow.
  return createPortal(<div className="cap-manager-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>{content}</div>, document.body);
}

type Shared = { state: ManagementState; busy: boolean; run: (action: () => Promise<void>) => Promise<void>; publish: (value: ManagementState) => void };

function Tools({ state, busy, run, publish }: Shared) {
  const [editing, setEditing] = useState<PackageRecord | null>(null);
  return <><div className="cap-manager-toolbar"><h3>Connected tools</h3></div>
    {state.packages.filter(item => item.source !== "skills").map(item => <article className="cap-manager-row" key={item.id}><div><strong>{item.displayName ?? item.id}</strong><small>{item.source === "stdio" ? "Managed MCP server" : item.source === "mcp" ? "MCP connection" : "HTTP integration"}{item.enabled === false ? " · disabled" : ""}</small></div>
      {(state.capabilitiesByPackage?.[item.id] ?? []).map(tool => <div className="cap-manager-package" key={tool.name}><span>{tool.name}</span><small>{tool.riskClass} · {approvalLabel(tool.approvalMode ?? "tool_grant")}</small></div>)}
      {(item.source === "mcp" || item.source === "stdio") && <button type="button" className="quiet-button" disabled={busy} onClick={() => setEditing(item)}>Choose tools</button>}
    </article>)}
    {editing && <ToolPackageForm key={editing.id} capabilityPackage={editing} tools={state.discovery?.[editing.source === "stdio" ? editing.id : editing.connectionRef ?? ""] ?? []} state={state} busy={busy} run={run} publish={value => { publish(value); setEditing(null); }} cancel={() => setEditing(null)} />}
  </>;
}

function Connections({ state, busy, run, publish, operate, error, authorizationUrl }: Shared & { operate: (ref: string, action: "discover" | "connect" | "refresh" | "revoke") => Promise<void>; error: string | null; authorizationUrl: string | null }) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectionRecord | "new" | null>(null);
  const [editingPackage, setEditingPackage] = useState<PackageRecord | null>(null);
  const [apiEditor, setApiEditor] = useState(false);
  const selected = state.connections.find(item => item.ref === selectedRef);
  const packages = selected ? state.packages.filter(item => item.connectionRef === selected.ref) : [];
  const counts = Object.fromEntries(state.connections.map(connection => [connection.ref, state.packages.filter(item => item.connectionRef === connection.ref && item.enabled !== false).reduce((total, item) => total + (item.tools?.length ?? state.capabilitiesByPackage?.[item.id]?.length ?? item.operations?.length ?? 0), 0)]));
  function close() { setEditing(null); setEditingPackage(null); setSelectedRef(null); setApiEditor(false); }
  const title = editing ? editing === "new" ? "Add connector" : "Edit connector" : editingPackage ? "Choose tools" : apiEditor ? "Add HTTP integration" : selected?.displayName ?? "Connector";
  return <>
    <ConnectorDirectory connections={state.connections} toolCounts={counts} busy={busy} onAdd={() => setEditing("new")} onSelect={setSelectedRef} />
    {(editing || editingPackage || selected || apiEditor) && <ConnectorModal title={title} busy={busy} onClose={close}>
      {error && <p className="cap-manager-error" role="alert">{error}</p>}
      {authorizationUrl && <p><a href={authorizationUrl} target="_blank" rel="noreferrer">Continue account authorization</a></p>}
      {editing ? <ConnectionForm key={editing === "new" ? "new" : editing.ref} connection={editing === "new" ? undefined : editing} state={state} busy={busy} run={run} publish={value => { publish(value); setEditing(null); }} cancel={() => setEditing(null)} /> : editingPackage ? <ToolPackageForm key={editingPackage.id} capabilityPackage={editingPackage} tools={state.discovery?.[editingPackage.connectionRef ?? ""] ?? []} state={state} busy={busy} run={run} publish={value => { publish(value); setEditingPackage(null); }} cancel={() => setEditingPackage(null)} /> : apiEditor ? <HttpPackageForm state={state} busy={busy} run={run} publish={value => { publish(value); close(); }} /> : selected && <>
        <p className="cap-manager-muted">{selected.status === "available" ? "Connected" : selected.status?.replaceAll("_", " ") ?? "Needs setup"}{!selected.enabled ? " · disabled" : ""}</p>
        <div className="connector-detail-actions"><button type="button" className="button button-primary" disabled={busy} onClick={() => void operate(selected.ref, "discover")}>Discover tools</button>{selected.auth.kind === "oauth" && <button type="button" className="quiet-button" disabled={busy} onClick={() => void operate(selected.ref, "connect")}>Connect account</button>}<button type="button" className="quiet-button" disabled={busy} onClick={() => void operate(selected.ref, "refresh")}>Refresh</button><button type="button" className="quiet-button" disabled={busy} onClick={() => setEditing(selected)}>Edit connection</button></div>
        <h3>Agent tools</h3>{packages.length ? packages.map(item => <div className="cap-manager-package" key={item.id}><span>{item.displayName ?? item.id}<small>{item.tools?.length ?? state.capabilitiesByPackage?.[item.id]?.length ?? item.operations?.length ?? 0} configured tools{item.enabled === false ? " · disabled" : ""}</small></span><button type="button" className="quiet-button" disabled={busy} onClick={() => setEditingPackage(item)}><Settings2 size={14} /> Choose tools</button></div>) : <p className="cap-manager-muted">Discover tools to make them available to agent profiles.</p>}
        <details><summary>Connection details</summary><p className="connector-detail-meta">{selected.resource}</p>{selected.auth.kind !== "anonymous" && <CredentialSummary label="Account credential" credential={selected.credential} />}{selected.clientCredential && <CredentialSummary label="OAuth client secret" credential={selected.clientCredential} />}{selected.reason && <p className="cap-manager-muted">{selected.reason}</p>}</details>
        <details><summary>Disconnect or remove</summary><p className="cap-manager-muted">Disconnecting disables access. Remove dependent packages and profile selections before deleting the connector.</p><div className="cap-manager-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => void operate(selected.ref, "revoke")}>Disconnect</button><button type="button" className="quiet-button" disabled={busy} onClick={() => void run(async () => { publish(await deleteConnection(selected.ref, state.revision)); close(); })}>Delete connector</button></div></details>
      </>}
    </ConnectorModal>}
    <div className="connector-section-label"><button className="quiet-button" type="button" disabled={busy} onClick={() => setApiEditor(true)}>Add an HTTP API integration</button></div>
  </>;
}

function ConnectionForm({ connection, state, busy, run, publish, cancel }: Shared & { connection?: ConnectionRecord; cancel: () => void }) {
  const [name, setName] = useState(connection?.displayName ?? ""); const [resource, setResource] = useState(connection?.resource ?? "");
  const [auth, setAuth] = useState(connection?.auth.kind === "static" ? "static" : connection?.auth.kind ?? "anonymous");
  const [pat, setPat] = useState(""); const [patExpiry, setPatExpiry] = useState(""); const [headers, setHeaders] = useState<{ name: string; value: string }[]>([{ name: "", value: "" }]); const [scopes, setScopes] = useState(connection?.scopes.join(", ") ?? "");
  const [clientId, setClientId] = useState(connection?.auth.kind === "oauth" ? connection.auth.clientId : "auto");
  const [clientSecret, setClientSecret] = useState("");
  const [clientMetadataUrl, setClientMetadataUrl] = useState(connection?.auth.kind === "oauth" ? connection.auth.clientMetadataUrl ?? "" : "");
  const [issuer, setIssuer] = useState(connection?.auth.kind === "oauth" ? connection.auth.issuer ?? "" : "");
  const [redirect, setRedirect] = useState(connection?.auth.kind === "oauth" ? connection.auth.redirectUri : "");
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  async function save(event: FormEvent) {
    event.preventDefault(); const enteredPat = pat, enteredHeaders = headers, enteredClientSecret = clientSecret; setPat(""); setHeaders([{ name: "", value: "" }]); setClientSecret("");
    await run(async () => {
      const ref = connection?.ref ?? `conn_${slug(name)}`;
      let authRecord: ConnectionRecord["auth"] = { kind: "anonymous" };
      if (auth === "stored" || auth === "headers") authRecord = { kind: "stored", credentialRef: connection?.auth.kind === "stored" ? connection.auth.credentialRef : "pending" };
      else if (auth === "static" && connection?.auth.kind === "static") authRecord = connection.auth;
      else if (auth === "oauth") authRecord = { ...(connection?.auth.kind === "oauth" ? connection.auth : {}), kind: "oauth", clientId, redirectUri: redirect || `${location.origin}/api/management/connections/${ref}/callback`, ...(clientMetadataUrl ? { clientMetadataUrl } : {}), ...(issuer ? { issuer, discovery: { kind: "mcp", allowedIssuers: [issuer] } } : {}) };
      const credential = auth === "stored" && enteredPat ? { kind: "personal-access-token" as const, token: enteredPat, ...(patExpiry ? { expiresAt: new Date(patExpiry).toISOString(), expirySource: "user" as const } : {}) } : auth === "headers" && enteredHeaders.length ? { kind: "static-headers" as const, headers: parseSecretHeaders(JSON.stringify(Object.fromEntries(enteredHeaders.map(row => { if (!row.name.trim() || !row.value) throw new Error("Enter a name and value for each secret header."); if (enteredHeaders.filter(other => other.name.toLowerCase() === row.name.toLowerCase()).length > 1) throw new Error("Header names must be unique."); return [row.name.trim(), row.value]; })))) } : auth === "oauth" && enteredClientSecret ? { kind: "oauth-client" as const, clientId, clientSecret: enteredClientSecret } : undefined;
      const next: ConnectionRecord = { ref, displayName: name, provider: connection?.provider ?? "mcp", owner: "local-workspace", resource, scopes: scopes.split(",").map(item => item.trim()).filter(Boolean), enabled, auth: authRecord };
      publish(await saveConnection(state.revision, next, credential));
    });
  }
  return <form className="cap-manager-form cap-manager-editor" onSubmit={save}><h3>{connection ? "Edit connection" : "Add MCP connection"}</h3><label>Name<input value={name} required maxLength={120} onChange={event => setName(event.target.value)} /></label><label>MCP server URL<input type="url" value={resource} required placeholder="https://example.com/mcp" onChange={event => setResource(event.target.value)} /></label><label>Authentication<select value={auth} onChange={event => { setAuth(event.target.value); setPat(""); setHeaders([{ name: "", value: "" }]); setClientSecret(""); }}><option value="anonymous">No authentication</option><option value="stored" disabled={!state.credentialStorageAvailable}>Personal access token</option><option value="headers" disabled={!state.credentialStorageAvailable}>Custom secret headers</option><option value="oauth">Connect an account (OAuth)</option>{connection?.auth.kind === "static" && <option value="static">Existing environment credential</option>}</select></label>
    {!state.credentialStorageAvailable && <p className="cap-manager-muted">Saved credentials require the server credential store to be configured.</p>}
    {auth === "stored" && <><label>{connection?.auth.kind === "stored" ? "Replace token (optional)" : "Personal access token"}<input type="password" autoComplete="off" value={pat} required={connection?.auth.kind !== "stored"} onChange={event => setPat(event.target.value)} /></label>{connection?.credential && <CredentialSummary label="Current token" credential={connection.credential} />}<details><summary>Known token expiration</summary><label>Expiration (optional, local time)<input type="datetime-local" disabled={!pat} value={patExpiry} onChange={event => setPatExpiry(event.target.value)} /></label><p className="cap-manager-muted">Enter the provider's expiration when known. Leaving this empty records an unknown expiration; it does not mean the token never expires.</p></details></>}
    {auth === "headers" && <><div className="connector-header-fields">{headers.map((row, index) => <div className="cap-manager-two-col" key={index}><label>Header name<input required placeholder="X-Api-Key" value={row.name} onChange={event => setHeaders(current => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></label><label>Secret value<input type="password" autoComplete="off" required value={row.value} onChange={event => setHeaders(current => current.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} /></label>{headers.length > 1 && <button type="button" className="quiet-button" onClick={() => setHeaders(current => current.filter((_, position) => position !== index))}>Remove header</button>}</div>)}</div><button type="button" className="quiet-button" disabled={busy || headers.length >= 16} onClick={() => setHeaders(current => [...current, { name: "", value: "" }])}>Add header</button></>}
    {auth === "oauth" && <><label>Client ID<input value={clientId} required placeholder="auto" onChange={event => setClientId(event.target.value)} /></label><p className="cap-manager-muted">Use auto to discover supported client registration, or enter an existing client ID.</p><label>Allowed authorization issuer<input type="url" value={issuer} placeholder="https://accounts.example.com" onChange={event => setIssuer(event.target.value)} /></label><details><summary>OAuth settings</summary><label>Client metadata URL (optional)<input type="url" value={clientMetadataUrl} onChange={event => setClientMetadataUrl(event.target.value)} /></label><label>Replace client secret (optional)<input type="password" autoComplete="off" disabled={!state.credentialStorageAvailable} value={clientSecret} onChange={event => setClientSecret(event.target.value)} /></label><label>Redirect URL<input type="url" value={redirect || `${location.origin}/api/management/connections/${connection?.ref ?? `conn_${slug(name)}`}/callback`} required onChange={event => setRedirect(event.target.value)} /></label><p className="cap-manager-muted">Register this redirect URL with your provider. Authorize the saved connection afterward.</p></details></>}
    <details><summary>Advanced settings</summary><label>Required scopes, separated by commas<input value={scopes} onChange={event => setScopes(event.target.value)} /></label><label className="cap-manager-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Enabled</label></details><div className="cap-manager-actions"><button className="button button-primary" type="submit" disabled={busy}>Save connection</button><button className="quiet-button" type="button" disabled={busy} onClick={cancel}>Cancel</button></div></form>;
}

function ToolPackageForm({ capabilityPackage, tools, state, busy, run, publish, cancel }: Shared & { capabilityPackage: PackageRecord; tools: ToolManifest[]; cancel: () => void }) {
  const choices = initialToolSelections(capabilityPackage, tools, state);
  const [selected, setSelected] = useState<ToolSelection[]>(choices);
  const [connectionRef, setConnectionRef] = useState(capabilityPackage.connectionRef ?? "");
  const discovered = capabilityPackage.source === "stdio" || connectionRef === capabilityPackage.connectionRef ? tools : state.discovery?.[connectionRef] ?? [];
  const remoteTools: ToolManifest[] = discovered.length ? discovered : selected.map(tool => ({ name: tool.remoteName }));
  function update(name: string, change: Partial<ToolSelection>) { setSelected(current => current.map(item => item.remoteName === name ? { ...item, ...change } : item)); }
  return <form className="cap-manager-form cap-manager-editor" onSubmit={event => { event.preventDefault(); void run(async () => publish(await savePackage(state.revision, { ...capabilityPackage, tools: selected, ...(capabilityPackage.source === "mcp" ? { connectionRef: connectionRef || undefined, endpoint: state.connections.find(connection => connection.ref === connectionRef)?.resource ?? capabilityPackage.endpoint } : {}) }))); }}><h3>Choose tools · {capabilityPackage.displayName ?? capabilityPackage.id}</h3>{capabilityPackage.source === "mcp" && <label>Saved connection<select value={connectionRef} onChange={event => setConnectionRef(event.target.value)}><option value="">No saved connection</option>{state.connections.map(connection => <option key={connection.ref} value={connection.ref}>{connection.displayName}{connection.status && connection.status !== "available" ? ` · ${connection.status.replaceAll("_", " ")}` : ""}</option>)}</select></label>}<PackageEnabled capabilityPackage={capabilityPackage} state={state} busy={busy} run={run} publish={publish} /><p className="cap-manager-muted">Select the tools available to profiles. Remote descriptions do not grant permission.</p>
    {!remoteTools.length && <p>{capabilityPackage.source === "stdio" ? "Enable a working server to discover its tools." : "Discover this connection's tools first."}</p>}
    {remoteTools.map(tool => { const choice = selected.find(item => item.remoteName === tool.name); return <div className="cap-manager-tool" key={tool.name}><label className="cap-manager-check"><input type="checkbox" checked={Boolean(choice)} onChange={event => setSelected(current => event.target.checked ? [...current, { remoteName: tool.name, name: defaultToolName(capabilityPackage, tool.name, state), riskClass: "external", approvalMode: "invocation" }] : current.filter(item => item.remoteName !== tool.name))} /> {tool.name}</label>{tool.description && <small>{tool.description}</small>}{choice && <div className="cap-manager-two-col"><label>Effect<select value={choice.riskClass} onChange={event => update(tool.name, { riskClass: event.target.value as Risk })}><option value="read">Reads data</option><option value="write">Changes data</option><option value="external">Other external action</option><option value="pure">Calculation only</option></select></label><label>Approval<select value={choice.approvalMode ?? "tool_grant"} onChange={event => update(tool.name, { approvalMode: event.target.value as Approval })}>{(["invocation", "tool_grant", "automatic"] as Approval[]).map(item => <option key={item} value={item}>{approvalLabel(item)}</option>)}</select></label></div>}</div>; })}
    <div className="cap-manager-actions"><button className="button button-primary" type="submit" disabled={busy}>Save tools</button><button className="quiet-button" type="button" disabled={busy} onClick={cancel}>Cancel</button><button className="quiet-button" type="button" disabled={busy} onClick={() => void run(async () => publish(await deletePackage(capabilityPackage.id, state.revision)))}>Remove package</button></div>
  </form>;
}
function HttpPackageForm({ state, busy, run, publish }: Shared) {
  const [name, setName] = useState(""); const [url, setUrl] = useState(""); const [connection, setConnection] = useState(""); const [operations, setOperations] = useState("[]");
  return <form className="cap-manager-form" onSubmit={event => { event.preventDefault(); void run(async () => { const parsed: unknown = JSON.parse(operations); if (!Array.isArray(parsed)) throw new Error("Operations must be a JSON array."); publish(await savePackage(state.revision, { id: slug(name), displayName: name, version: "1.0.0", source: "http", baseUrl: url, ...(connection ? { connectionRef: connection } : {}), operations: parsed })); }); }}><label>Name<input required value={name} onChange={event => setName(event.target.value)} /></label><label>API base URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} /></label><label>Connection<select value={connection} onChange={event => setConnection(event.target.value)}><option value="">No authentication</option>{state.connections.map(item => <option key={item.ref} value={item.ref}>{item.displayName}</option>)}</select></label><label>Operation definitions (JSON)<textarea rows={5} value={operations} onChange={event => setOperations(event.target.value)} /></label><p className="cap-manager-muted">Define names, methods, paths, schemas, risk and approval for each operation.</p><button className="quiet-button" type="submit" disabled={busy}>Save API integration</button></form>;
}

function Installations({ state, kind, busy, run, publish }: Shared & { kind: "Skills" | "Plugins" }) {
  const [source, setSource] = useState<"archive" | "repository">("archive"); const [input, setInput] = useState<InstallInput>(kind === "Skills" ? { version: "1.0.0" } : {});
  const [preview, setPreview] = useState<InstallationPreview | null>(null); const [filename, setFilename] = useState("");
  const [editingTools, setEditingTools] = useState<PackageRecord | null>(null);
  const [editingStdio, setEditingStdio] = useState<PackageRecord | null>(null);
  const skills = state.packages.filter(item => item.source === "skills");
  function change(next: InstallInput) { setInput(next); setPreview(null); }
  async function upload(file?: File) {
    setPreview(null); setFilename(file?.name ?? ""); if (!file) { setInput({}); return; }
    await run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("Choose an archive smaller than 8 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      setInput(current => ({ id: current.id, version: current.version, archiveBase64: btoa(binary) }));
    });
  }
  const manifest = preview?.manifest && typeof preview.manifest === "object" ? preview.manifest as { id?: string; version?: string; dependencies?: { id: string; version: string }[]; connections?: ConnectionRecord[]; packages?: { id: string; source?: string }[] } : preview;
  return <>
    <h3>{kind === "Skills" ? "Installed skills" : "Installed bundles"}</h3>
    {kind === "Skills" && skills.map(item => <article className="cap-manager-row" key={item.id}><strong>{item.displayName ?? item.id}</strong><small>Version {item.version}</small><PackageEnabled capabilityPackage={item} state={state} busy={busy} run={run} publish={publish} />{(state.skillsByPackage?.[item.id] ?? state.packageSkills?.[item.id] ?? item.skills ?? []).map(skill => <SkillInspector key={`${item.id}@${item.version}:${skill.name}`} packageId={item.id} skill={skill} busy={busy} run={run} />)}</article>)}
    {kind === "Plugins" && state.installations.map(item => <article className="cap-manager-row" key={item.id}><strong>{item.id} · {item.version}</strong><small>{item.packageIds.join(", ")}</small>{state.packages.filter(capabilityPackage => item.packageIds.includes(capabilityPackage.id)).map(capabilityPackage => <div key={capabilityPackage.id} className="cap-manager-package"><span>{capabilityPackage.displayName ?? capabilityPackage.id}</span><PackageEnabled capabilityPackage={capabilityPackage} state={state} busy={busy} run={run} publish={publish} />{capabilityPackage.source === "stdio" && <><button className="quiet-button" type="button" disabled={busy} onClick={() => setEditingTools(capabilityPackage)}>Choose tools</button><button className="quiet-button" type="button" disabled={busy} onClick={() => setEditingStdio(capabilityPackage)}>Edit server</button></>}</div>)}<details><summary>Dependencies and removal</summary><p>{item.dependencies.map(dependency => `${dependency.id}@${dependency.version}`).join(", ") || "No dependencies"}</p><button className="quiet-button" type="button" disabled={busy} onClick={() => void run(async () => publish(await deleteInstallation(item.id, state.revision)))}>Remove installation</button></details></article>)}
    {kind === "Plugins" && state.packages.filter(item => item.source !== "skills" && !state.installations.some(installation => installation.packageIds.includes(item.id))).map(item => <article className="cap-manager-row" key={item.id}><strong>{item.displayName ?? item.id}</strong><small>{item.source} · {item.version}</small><PackageEnabled capabilityPackage={item} state={state} busy={busy} run={run} publish={publish} />{item.source === "stdio" && <div className="cap-manager-actions"><button className="quiet-button" type="button" disabled={busy} onClick={() => setEditingTools(item)}>Choose tools</button><button className="quiet-button" type="button" disabled={busy} onClick={() => setEditingStdio(item)}>Edit server</button></div>}</article>)}
    <form className="cap-manager-form cap-manager-editor" onSubmit={event => { event.preventDefault(); void run(async () => setPreview(await previewInstallation(input))); }}><h3>{kind === "Skills" ? "Import skills" : "Install a plugin bundle"}</h3><label>Source<select value={source} onChange={event => { setSource(event.target.value as typeof source); change({ id: input.id, version: input.version }); setFilename(""); }}><option value="archive">ZIP archive</option><option value="repository">Git repository at a pinned commit</option></select></label>{source === "archive" ? <label>Archive<input type="file" accept=".zip,application/zip" onChange={event => void upload(event.target.files?.[0])} disabled={busy} />{filename && <small>{filename}</small>}</label> : <><label>Repository URL<input type="url" value={input.repositoryUrl ?? ""} required onChange={event => change({ ...input, repositoryUrl: event.target.value })} /></label><label>Exact commit<input value={input.commit ?? ""} required pattern="[a-fA-F0-9]{40,64}" placeholder="Full commit hash" onChange={event => change({ ...input, commit: event.target.value })} /></label></>}
      <details open={kind === "Skills"}><summary>Package identity</summary><label>Package ID{kind === "Plugins" ? " (optional)" : ""}<input required={kind === "Skills"} value={input.id ?? ""} onChange={event => change({ ...input, id: event.target.value })} /></label><label>Version{kind === "Plugins" ? " (optional)" : ""}<input required={kind === "Skills"} value={input.version ?? ""} placeholder="1.0.0" onChange={event => change({ ...input, version: event.target.value })} /></label></details>
      <p className="cap-manager-muted">{kind === "Skills" ? "Import a standard SKILL.md directory with its resources. Scripts are retained as resources; installation does not execute them." : "Bundles declare versioned tools, skills and dependencies. Installation does not execute plugin hooks."}</p><button className="quiet-button" type="submit" disabled={busy || !(input.archiveBase64 || input.repositoryUrl)}>Preview import</button>
    </form>
    {preview && <section className="cap-manager-preview"><h3>Review {manifest?.id ?? "import"} {manifest?.version ?? ""}</h3>{preview.skills?.map(skill => <p key={skill.name}><strong>{skill.name}</strong>{skill.description && <small>{skill.description}</small>}</p>)}{(manifest?.packages ?? preview.packages)?.map(item => <p key={item.id}>{item.id} · {item.source ?? "package"}</p>)}{(manifest?.dependencies ?? []).length > 0 && <p>Dependencies: {manifest!.dependencies!.map(item => `${item.id}@${item.version}`).join(", ")}</p>}{manifest?.connections?.map(connection => <div key={connection.ref}><p><strong>Account setup: {connection.displayName}</strong><small>{connection.resource}</small></p><p className="cap-manager-muted">Edit this connection after installation to add credentials or authorize the account.</p></div>)}{preview.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}{Array.isArray(preview.requiredSecrets) && preview.requiredSecrets.length > 0 && <div><p>Required connection credentials:</p>{preview.requiredSecrets.map((secret, index) => <p key={index}><strong>{typeof secret === "object" && secret && "name" in secret ? String(secret.name) : "Credential"}</strong>{typeof secret === "object" && secret && "description" in secret && <small>{String(secret.description)}</small>}</p>)}</div>}<button className="button button-primary" type="button" disabled={busy} onClick={() => void run(async () => { publish(await installPackage(state.revision, input)); setPreview(null); setInput(kind === "Skills" ? { version: "1.0.0" } : {}); setFilename(""); })}>Install {kind === "Skills" ? "skills" : "bundle"}</button></section>}
    {editingTools && <ToolPackageForm key={`${editingTools.id}@${editingTools.version}`} capabilityPackage={editingTools} tools={state.discovery?.[editingTools.id] ?? []} state={state} busy={busy} run={run} publish={value => { publish(value); setEditingTools(null); }} cancel={() => setEditingTools(null)} />}
    {editingStdio && <section className="cap-manager-editor"><h3>Edit managed server · {editingStdio.displayName ?? editingStdio.id}</h3><StdioForm key={`${editingStdio.id}@${editingStdio.version}`} capabilityPackage={editingStdio} state={state} busy={busy} run={run} publish={value => { publish(value); setEditingStdio(null); }} cancel={() => setEditingStdio(null)} /></section>}
    {kind === "Plugins" && <details><summary>Managed stdio server</summary><StdioForm state={state} busy={busy} run={run} publish={publish} /></details>}
  </>;
}

function PackageEnabled({ capabilityPackage, state, busy, run, publish }: Shared & { capabilityPackage: PackageRecord }) {
  const enabled = capabilityPackage.enabled !== false;
  return <div className="cap-manager-actions"><span className="cap-manager-muted">{enabled ? "Enabled" : "Disabled"}</span><button className="quiet-button" type="button" disabled={busy} onClick={() => void run(async () => publish(await savePackage(state.revision, { ...capabilityPackage, enabled: !enabled })))}>{enabled ? "Disable package" : "Enable package"}</button></div>;
}
function StdioForm({ capabilityPackage, state, busy, run, publish, cancel }: Shared & { capabilityPackage?: PackageRecord; cancel?: () => void }) {
  const [name, setName] = useState(capabilityPackage?.displayName ?? capabilityPackage?.id ?? ""); const [command, setCommand] = useState(capabilityPackage?.command ?? ""); const [args, setArgs] = useState(JSON.stringify(capabilityPackage?.args ?? []));
  const [environment, setEnvironment] = useState<{ key: string; value: string }[]>([]);
  async function submit(event: FormEvent) {
    event.preventDefault(); const entered = environment; setEnvironment([]);
    await run(async () => {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every(arg => typeof arg === "string")) throw new Error("Arguments must be an array of strings.");
      const credentials: Record<string, string> = {};
      for (const row of entered) {
        if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(row.key) || !row.value || row.value.includes("\0")) throw new Error("Each environment credential needs an uppercase variable name and a value.");
        if (Object.hasOwn(credentials, row.key)) throw new Error("Environment variable names must be unique.");
        credentials[row.key] = row.value;
      }
      publish(await savePackage(state.revision, { ...capabilityPackage, id: capabilityPackage?.id ?? slug(name), displayName: name, version: bumpVersion(capabilityPackage?.version), source: "stdio", command, args: parsed }, entered.length ? credentials : undefined));
      setName(""); setCommand(""); setArgs("[]");
    });
  }
  return <form className="cap-manager-form" onSubmit={submit}><p className="cap-manager-muted">Configure an executable you trust. The process host assigns its working directory.</p>{state.stdioAvailable === false && <p>Managed stdio is not enabled on this server.</p>}<label>Name<input required value={name} onChange={event => setName(event.target.value)} /></label><label>Trusted executable<input required value={command} onChange={event => setCommand(event.target.value)} /></label><label>Arguments (JSON array)<textarea value={args} onChange={event => setArgs(event.target.value)} /></label>
    <details><summary>Saved environment credentials</summary><p className="cap-manager-muted">Secrets are encrypted on the server and supplied only to this managed process.</p>{capabilityPackage?.envCredentialRefs && Object.keys(capabilityPackage.envCredentialRefs).length > 0 && <p className="cap-manager-muted">Saved variables: {Object.keys(capabilityPackage.envCredentialRefs).join(", ")}. Values remain masked; enter a variable again to replace it.</p>}{!state.credentialStorageAvailable && <p>Configure the credential store to save process secrets.</p>}{environment.map((row, index) => <div className="cap-manager-environment" key={index}><label>Variable<input value={row.key} required pattern="[A-Z][A-Z0-9_]{0,127}" placeholder="API_KEY" onChange={event => setEnvironment(current => current.map((value, position) => position === index ? { ...value, key: event.target.value } : value))} /></label><label>Secret value<input type="password" autoComplete="off" required value={row.value} onChange={event => setEnvironment(current => current.map((value, position) => position === index ? { ...value, value: event.target.value } : value))} /></label><button className="quiet-button" type="button" aria-label={`Remove environment credential ${index + 1}`} onClick={() => setEnvironment(current => current.filter((_, position) => position !== index))}><X size={14} /></button></div>)}<button className="quiet-button" type="button" disabled={busy || !state.credentialStorageAvailable || environment.length >= 32} onClick={() => setEnvironment(current => [...current, { key: "", value: "" }])}>Add environment credential</button></details>
    <button className="quiet-button" type="submit" disabled={busy || state.stdioAvailable === false}>{capabilityPackage ? "Save stdio server" : "Add stdio server"}</button>{cancel && <button className="quiet-button" type="button" disabled={busy} onClick={cancel}>Cancel</button>}</form>;
}

function Profiles({ state, busy, run, publish }: Shared) {
  const [editing, setEditing] = useState<ProfileRecord | "new" | null>(null);
  const [seed, setSeed] = useState<ProfileRecord | undefined>();
  const [editorKey, setEditorKey] = useState(0);
  function open(profile?: ProfileRecord, duplicate = false) {
    setEditorKey(current => current + 1);
    setSeed(undefined);
    if (duplicate && profile) {
      let name = `${profile.displayName} copy`, index = 2;
      while (state.profiles.some(existing => existing.id === slug(name))) name = `${profile.displayName} copy ${index++}`;
      setSeed({ ...structuredClone(profile), displayName: name }); setEditing("new");
    } else setEditing(profile ?? "new");
  }
  return <><div className="cap-manager-toolbar"><h3>Agent profiles</h3><button className="quiet-button" type="button" disabled={busy} onClick={() => open()}><Plus size={15} /> New profile</button></div>{state.profiles.map(profile => <article className="cap-manager-row" key={profile.id}><div><strong>{profile.displayName}</strong><small>{profile.packages.join(", ") || "No packages"}</small></div><div className="cap-manager-actions"><button className="quiet-button" type="button" disabled={busy} onClick={() => open(profile)}>Edit profile</button><button className="quiet-button" type="button" disabled={busy} onClick={() => open(profile, true)}>Duplicate</button><button className="quiet-button" type="button" disabled={busy} onClick={() => void run(async () => publish(await deleteProfile(profile.id, state.revision)))}>Delete profile</button></div></article>)}{editing && <ProfileForm key={editorKey} profile={editing === "new" ? undefined : editing} seed={seed} state={state} busy={busy} run={run} publish={value => { publish(value); setEditing(null); }} cancel={() => setEditing(null)} />}</>;
}

function ProfileForm({ profile, seed, state, busy, run, publish, cancel }: Shared & { profile?: ProfileRecord; seed?: ProfileRecord; cancel: () => void }) {
  const initial = profile ?? seed;
  const [name, setName] = useState(initial?.displayName ?? ""); const [packages, setPackages] = useState(initial?.packages ?? []); const [tools, setTools] = useState(initial?.tools ?? []); const [skills, setSkills] = useState(initial?.skills ?? []);
  return <form className="cap-manager-form cap-manager-editor" onSubmit={event => { event.preventDefault(); void run(async () => { if (!profile && state.profiles.some(existing => existing.id === slug(name))) throw new Error("Choose a unique name for the new profile."); publish(await saveProfile(state.revision, { ...(profile ?? {}), ...(seed?.description ? { description: seed.description } : {}), id: profile?.id ?? slug(name), version: bumpVersion(profile?.version), displayName: name, packages, tools: tools.filter(tool => !tool.packageId || packages.includes(tool.packageId)), skills: skills.filter(skill => packages.includes(skill.split(":")[0])) })); }); }}><h3>{profile ? "Edit agent profile" : seed ? "Duplicate agent profile" : "New agent profile"}</h3><label>Name<input value={name} required onChange={event => setName(event.target.value)} /></label>
    {state.packages.map(item => { const selected = packages.includes(item.id); const selections = item.tools ?? (state.capabilitiesByPackage?.[item.id] ?? []).map(tool => ({ ...tool, remoteName: tool.name })); const knownSkills = state.skillsByPackage?.[item.id] ?? state.packageSkills?.[item.id] ?? item.skills ?? []; return <section className="cap-manager-tool" key={item.id}><label className="cap-manager-check"><input type="checkbox" checked={selected} onChange={event => { setPackages(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); if (event.target.checked) setTools(current => [...current, ...selections.filter(tool => !current.some(choice => choice.name === tool.name)).map(tool => ({ packageId: item.id, name: tool.name, enabled: true, riskClass: tool.riskClass, approvalMode: tool.approvalMode ?? "invocation" as Approval }))]); }} /> {item.displayName ?? item.id}<small>{item.source}</small></label>{selected && <>
      {selections.map(selection => { const choice = tools.find(tool => tool.name === selection.name); return <div className="cap-manager-profile-tool" key={selection.name}><label className="cap-manager-check"><input type="checkbox" checked={choice?.enabled ?? true} onChange={event => setTools(current => current.some(tool => tool.name === selection.name) ? current.map(tool => tool.name === selection.name ? { ...tool, enabled: event.target.checked } : tool) : [...current, { packageId: item.id, name: selection.name, enabled: event.target.checked, riskClass: selection.riskClass, approvalMode: selection.approvalMode ?? "invocation" }])} />{selection.name}<small>{selection.riskClass}</small></label><select aria-label={`Approval for ${selection.name}`} value={choice?.approvalMode ?? selection.approvalMode ?? "invocation"} onChange={event => setTools(current => current.some(tool => tool.name === selection.name) ? current.map(tool => tool.name === selection.name ? { ...tool, approvalMode: event.target.value as Approval } : tool) : [...current, { packageId: item.id, name: selection.name, enabled: true, riskClass: selection.riskClass, approvalMode: event.target.value as Approval }])}>{(["invocation", "tool_grant", "automatic"] as Approval[]).map(approval => <option key={approval} value={approval}>{approvalLabel(approval)}</option>)}</select></div>; })}
      {knownSkills.map(skill => { const id = `${item.id}:${skill.name}`; return <label className="cap-manager-check" key={id}><input type="checkbox" checked={skills.includes(id)} onChange={event => setSkills(current => event.target.checked ? [...current, id] : current.filter(value => value !== id))} /> Preload {skill.name}</label>; })}
      {item.source === "skills" && !knownSkills.length && <p className="cap-manager-muted">Skill discovery tools will be available. Individual skills appear after package inspection.</p>}
    </>}</section>; })}
    <div className="cap-manager-actions"><button className="button button-primary" type="submit" disabled={busy || !packages.length}>Save profile</button><button className="quiet-button" type="button" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>;
}
function bumpVersion(version?: string) { if (!version) return "1.0.0"; const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version); return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : version; }

function toolName(name: string) { const normalized = name.replace(/[^A-Za-z0-9_-]/g, "_"); return /^[A-Za-z]/.test(normalized) ? normalized : `tool_${normalized}`; }

function parseSecretHeaders(value: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Secret headers must be a valid JSON object."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([name, entry]) => !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || typeof entry !== "string" || /[\r\n]/.test(entry))) throw new Error("Secret headers must map valid header names to single-line text values.");
  return parsed as Record<string, string>;
}

function CredentialSummary({ label, credential }: { label: string; credential?: SafeCredentialSummary }) {
  let expiry = "Expiration unknown";
  if (credential?.expiresAt) {
    const date = new Date(credential.expiresAt);
    if (Number.isFinite(date.getTime())) expiry = `${date.getTime() <= Date.now() ? "Expired" : "Expires"} ${date.toLocaleString()}${credential.expirySource === "user" ? " (entered by you)" : credential.expirySource === "provider" ? " (from provider)" : ""}`;
  }
  return <div className="cap-manager-credential"><strong>{label}</strong><span>{credential?.present ? "•••••••• · Present" : "Not available"}{credential?.externallyManaged ? " · Managed by deployment" : ""}</span>{credential?.present && <small>{expiry}</small>}</div>;
}

function SkillInspector({ packageId, skill, busy, run }: { packageId: string; skill: { name: string; description?: string }; busy: boolean; run: Shared["run"] }) {
  const [inspection, setInspection] = useState<SkillInspection | null>(null);
  return <details className="cap-manager-skill"><summary>{skill.name}</summary><p>{skill.description ?? "No description provided."}</p>{!inspection ? <button type="button" className="quiet-button" disabled={busy} onClick={() => void run(async () => setInspection(await getSkillInspection(packageId, skill.name)))}>Inspect instructions and files</button> : <>
    <details open><summary>Instructions · SKILL.md</summary><pre className="cap-manager-skill-content">{inspection.content}</pre></details>
    <details><summary>Resources · {inspection.files.length} files</summary>{inspection.files.length ? <ul className="cap-manager-skill-files">{inspection.files.map(path => <li key={path}>{path}</li>)}</ul> : <p>No additional resources.</p>}<p className="cap-manager-muted">Resource paths are inspectable metadata. This view does not execute scripts.</p></details>
  </>}</details>;
}

function initialToolSelections(capabilityPackage: PackageRecord, manifests: ToolManifest[], state: ManagementState): ToolSelection[] {
  if (capabilityPackage.tools !== undefined) return capabilityPackage.tools;
  const capabilities = state.capabilitiesByPackage?.[capabilityPackage.id] ?? [];
  return capabilities.flatMap(capability => {
    const remote = manifests.find(tool => capability.name === tool.name || capability.name === toolName(tool.name) || capability.name === modelToolName(tool.name) || capability.name === `${capabilityPackage.id}_${tool.name}`.replace(/[^a-z0-9_-]/g, "_"));
    if (!remote) return [];
    return [{ remoteName: remote.name, name: capability.name, riskClass: capability.riskClass, approvalMode: capability.approvalMode ?? "invocation" }];
  });
}
function defaultToolName(capabilityPackage: PackageRecord, remoteName: string, state: ManagementState) {
  const known = initialToolSelections({ ...capabilityPackage, tools: undefined }, [{ name: remoteName }], state)[0];
  return known?.name ?? `${capabilityPackage.id}_${remoteName}`.replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
}

function modelToolName(name: string) { const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 59); return /^[a-z]/.test(normalized) ? normalized : `tool_${normalized}`; }
