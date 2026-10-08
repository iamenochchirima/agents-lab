import { useEffect, useState } from "react";
import { getConnections, manageConnection, type ConnectionSummary } from "./platformApi";

/** Safe connection summaries only; tokens never cross this browser boundary. */
export function ConnectionPanel({ selectedRefs, disabled, onChanged }: { readonly selectedRefs: readonly string[]; readonly disabled?: boolean; readonly onChanged: () => void }) {
  const [connections, setConnections] = useState<readonly ConnectionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<{ ref: string; url: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getConnections(controller.signal).then(setConnections).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connections unavailable."); });
    return () => controller.abort();
  }, []);
  async function operate(connection: ConnectionSummary, operation: "connect" | "refresh" | "revoke") {
    setBusy(connection.ref); setError(null); setAuthorization(null);
    try {
      const result = await manageConnection(connection.ref, operation);
      setConnections(current => current.map(item => item.ref === connection.ref ? result.connection : item));
      if (result.authorizationUrl) {
        const url = new URL(result.authorizationUrl);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("The connection returned an unsupported authorization URL.");
        setAuthorization({ ref: connection.ref, url: url.toString() });
      }
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection action failed."); }
    finally { setBusy(null); }
  }
  const selected = connections.filter(connection => selectedRefs.includes(connection.ref));
  const others = connections.filter(connection => !selectedRefs.includes(connection.ref));
  const row = (connection: ConnectionSummary) => <div className="connection-row" key={connection.ref}>
    <div><strong>{connection.displayName}</strong><span className={`connection-status connection-status-${connection.status}`}>{connection.status.replaceAll("_", " ")}</span>{connection.reason && <small>{connection.reason}</small>}</div>
    <div className="connection-actions">
      {connection.status !== "available" && <button className="quiet-button" type="button" disabled={disabled || busy !== null} onClick={() => void operate(connection, "connect")}>{busy === connection.ref ? "Connecting…" : connection.status === "revoked" || connection.status === "expired" ? "Reconnect" : "Connect"}</button>}
      <button className="quiet-button" type="button" disabled={disabled || busy !== null} onClick={() => void operate(connection, "refresh")}>Refresh</button>
      {connection.status === "available" && <button className="quiet-button" type="button" disabled={disabled || busy !== null} onClick={() => void operate(connection, "revoke")}>Revoke</button>}
    </div>
    {authorization?.ref === connection.ref && <a className="quiet-button" href={authorization.url} target="_blank" rel="noreferrer">Continue authorization</a>}
    <details><summary>Connection details</summary><dl><dt>Account</dt><dd>{connection.owner}</dd><dt>Resource</dt><dd>{connection.resource}</dd><dt>Scopes</dt><dd>{connection.scopes.join(", ") || "None"}</dd></dl></details>
  </div>;
  return <div className="connection-panel">
    {selected.length > 0 && <div aria-label="Selected connections">{selected.map(row)}</div>}
    {others.length > 0 && <details><summary>Connections <small>{others.length}</small></summary>{others.map(row)}</details>}
    {error && <p className="chat-availability-error" role="status">{error}</p>}
  </div>;
}
