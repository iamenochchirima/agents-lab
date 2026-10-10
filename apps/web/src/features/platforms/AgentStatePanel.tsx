import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Brain, Download, Plus, Search, Sparkles, Upload, X } from "lucide-react";
import { AgentStateApiError, agentStateRequest, type AgentIdentity, type AgentMemoryRecord, type AgentStateView } from "./agentStateApi";
import "./agent-state.css";

type IdentityForm = Pick<AgentIdentity, "name" | "purpose" | "style" | "initiative" | "behavior">;
type MemoryForm = { kind: "fact" | "preference"; title: string; content: string };
const emptyMemory: MemoryForm = { kind: "fact", title: "", content: "" };
/** Workspace identity and factual memory, independent of platform execution configuration. */
export function AgentStatePanel({ onClose }: { readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [tab, setTab] = useState<"identity" | "memory">("identity");
  const [state, setState] = useState<AgentStateView | null>(null);
  const [identity, setIdentity] = useState<IdentityForm | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AgentMemoryRecord | "new" | null>(null);
  const [memory, setMemory] = useState<MemoryForm>(emptyMemory);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const mutation = useRef<{ signature: string; operationId: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const openingElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const controller = new AbortController();
    void agentStateRequest<AgentStateView>("", undefined, controller.signal).then(view => {
      if (!alive.current) return;
      setState(view); setIdentity(identityFields(view.identity)); setRevision(view.identity.revision);
    }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; controller.abort(); dialog.current?.close(); openingElement?.focus(); };
  }, []);
  async function reload(resetDraft = false) {
    setBusy(true); setError(null);
    try {
      const view = await agentStateRequest<AgentStateView>();
      if (!alive.current) return;
      setState(view);
      if (resetDraft || !identity) { setIdentity(identityFields(view.identity)); setRevision(view.identity.revision); setMarkdown(null); setEditing(null); mutation.current = null; }
    } catch (reason) { if (alive.current) setError(message(reason)); }
    finally { if (alive.current) { setBusy(false); setLoading(false); } }
  }
  async function change<T>(path: string, body: Record<string, unknown>, done: (result: T) => void) {
    const signature = JSON.stringify({ path, body });
    if (mutation.current?.signature !== signature) mutation.current = { signature, operationId: crypto.randomUUID() };
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await agentStateRequest<T>(path, { ...body, operationId: mutation.current.operationId });
      if (!alive.current) return;
      mutation.current = null; done(result);
    } catch (reason) {
      if (alive.current) setError(reason instanceof AgentStateApiError && reason.status === 409 ? `${reason.message} Reload to use the latest saved version. Your draft is still here.` : message(reason));
    } finally { if (alive.current) setBusy(false); }
  }
  function saveIdentity(event: FormEvent) {
    event.preventDefault(); if (!identity || revision === null) return;
    void change<{ identity: AgentIdentity }>("/identity", { ...identity, expectedRevision: revision }, result => {
      setState(previous => previous ? { ...previous, identity: result.identity } : previous);
      setIdentity(identityFields(result.identity)); setRevision(result.identity.revision); setNotice("Identity saved. It applies to new chats on every platform.");
    });
  }
  function saveMemory(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    const existing = editing === "new" ? null : editing;
    void change<{ memory: AgentMemoryRecord }>(existing ? `/memory/${encodeURIComponent(existing.id)}` : "/memory", { ...memory, tags: existing?.tags ?? [], ...(existing ? { operation: "update", expectedRevision: existing.revision } : {}) }, result => {
      setState(previous => previous ? { ...previous, memory: [...previous.memory.filter(item => item.id !== result.memory.id), result.memory] } : previous);
      setEditing(null); setMemory(emptyMemory); setNotice(existing ? "Memory updated. Future recall uses this version." : "Memory saved and available across new chats.");
    });
  }
  async function exportMarkdown() {
    setError(null);
    try {
      const { markdown: content } = await agentStateRequest<{ markdown: string }>("/identity/markdown");
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "agent-identity.md"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(message(reason)); }
  }
  const visible = state?.memory.filter(item => `${item.title} ${item.content} ${item.kind}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  return createPortal(<dialog className="agent-state-dialog" ref={dialog} aria-labelledby="agent-state-title" onCancel={event => { event.preventDefault(); close.current(); }} onClick={event => { if (event.target === event.currentTarget) close.current(); }}>
    <section className="agent-state-panel">
      <header className="agent-state-header"><span className="agent-state-symbol"><Sparkles size={22} /></span><div><h2 id="agent-state-title">Your agent</h2><p>Shared identity and memory across platforms.</p></div><button type="button" className="agent-state-icon" aria-label="Close agent settings" onClick={() => close.current()}><X size={20} /></button></header>
      <div className="agent-state-tabs" role="tablist" aria-label="Agent settings" onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "identity" : event.key === "End" ? "memory" : tab === "identity" ? "memory" : "identity"; setTab(next); document.getElementById(`${next}-tab`)?.focus(); }}><button type="button" role="tab" id="identity-tab" tabIndex={tab === "identity" ? 0 : -1} aria-selected={tab === "identity"} aria-controls="agent-state-identity" onClick={() => setTab("identity")}><Sparkles size={16} />Identity</button><button type="button" role="tab" id="memory-tab" tabIndex={tab === "memory" ? 0 : -1} aria-selected={tab === "memory"} aria-controls="agent-state-memory" onClick={() => setTab("memory")}><Brain size={16} />Memory{state && <span>{state.memory.length}</span>}</button></div>
      <div className="agent-state-body">
        {error && <div className="agent-state-error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => void reload(true)}>Reload saved version</button></div>}
        {notice && <p className="agent-state-notice" role="status">{notice}</p>}
        {loading ? <p role="status">Loading agent settings…</p> : !state ? <p>Agent settings are unavailable.</p> : tab === "identity" ? <section role="tabpanel" id="agent-state-identity" aria-labelledby="identity-tab">
          <div className="agent-state-section-heading"><div><h3>How your agent behaves</h3><p>Changes apply to new chats. Existing chats keep their original identity.</p></div><span className="agent-state-revision">Revision {revision}</span></div>
          {identity && <form className="agent-state-form" onSubmit={saveIdentity}>
            <label>Name<input disabled={busy} required maxLength={128} value={identity.name} onChange={event => setIdentity({ ...identity, name: event.target.value })} /></label>
            <label>Purpose<textarea disabled={busy} required rows={2} maxLength={4096} value={identity.purpose} onChange={event => setIdentity({ ...identity, purpose: event.target.value })} /></label>
            <div className="agent-state-field-pair"><label>Communication style<textarea disabled={busy} required rows={3} maxLength={4096} value={identity.style} onChange={event => setIdentity({ ...identity, style: event.target.value })} /></label><label>Initiative<textarea disabled={busy} required rows={3} maxLength={4096} value={identity.initiative} onChange={event => setIdentity({ ...identity, initiative: event.target.value })} /></label></div>
            <label>Behavior<textarea disabled={busy} required rows={3} maxLength={4096} value={identity.behavior} onChange={event => setIdentity({ ...identity, behavior: event.target.value })} /></label>
            <div className="agent-state-actions"><button type="button" disabled={busy} onClick={() => void exportMarkdown()}><Download size={16} />Export Markdown</button><label className="agent-state-upload"><Upload size={16} />Import Markdown<input aria-label="Import identity Markdown file" type="file" accept=".md,.markdown,text/markdown,text/plain" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 20480) { setError("Choose a Markdown file of at most 20 KiB."); return; } void file.text().then(text => { if (alive.current) { setMarkdown(text); setError(null); } }).catch(reason => { if (alive.current) setError(message(reason)); }); }} /></label><button type="submit" className="agent-state-primary" disabled={busy}>{busy ? "Saving…" : "Save identity"}</button></div>
          </form>}
          {markdown !== null && <div className="agent-state-import"><h3>Review imported identity</h3><textarea disabled={busy} rows={7} aria-label="Imported identity Markdown" value={markdown} onChange={event => setMarkdown(event.target.value)} /><div className="agent-state-actions"><button type="button" disabled={busy} onClick={() => setMarkdown(null)}>Cancel import</button><button type="button" className="agent-state-primary" disabled={busy} onClick={() => void change<{ identity: AgentIdentity }>("/identity", { markdown, expectedRevision: revision }, result => { setIdentity(identityFields(result.identity)); setRevision(result.identity.revision); setState(previous => previous ? { ...previous, identity: result.identity } : previous); setMarkdown(null); setNotice("Identity imported. It applies to new chats."); })}>Import identity</button></div></div>}
        </section> : <section role="tabpanel" id="agent-state-memory" aria-labelledby="memory-tab">
          <div className="agent-state-section-heading"><div><h3>Saved memories</h3><p>Facts and preferences you ask the agent to remember.</p></div><button type="button" disabled={busy} onClick={() => { setEditing("new"); setMemory(emptyMemory); }}><Plus size={16} />Add memory</button></div>
          <label className="agent-state-search"><Search size={17} /><input aria-label="Search saved memories" placeholder="Search memories" value={search} onChange={event => setSearch(event.target.value)} /></label>
          {editing && <form className="agent-state-form agent-state-memory-editor" onSubmit={saveMemory}><h3>{editing === "new" ? "Add memory" : "Edit memory"}</h3><div className="agent-state-field-pair"><label>Type<select disabled={busy} value={memory.kind} onChange={event => setMemory({ ...memory, kind: event.target.value as MemoryForm["kind"] })}><option value="fact">Fact or decision</option><option value="preference">Preference</option></select></label><label>Title<input disabled={busy} required maxLength={256} value={memory.title} onChange={event => setMemory({ ...memory, title: event.target.value })} /></label></div><label>Content<textarea disabled={busy} required autoFocus rows={4} maxLength={4096} value={memory.content} onChange={event => setMemory({ ...memory, content: event.target.value })} /></label><div className="agent-state-actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="agent-state-primary" disabled={busy}>{busy ? "Saving…" : "Save memory"}</button></div></form>}
          <div className="agent-state-memory-list">{visible.length ? visible.map(item => <article className="agent-state-memory-card" key={item.id}><div className="agent-state-memory-title"><h4>{item.title}</h4><span>{item.kind === "preference" ? "Preference" : "Fact"}</span></div><p>{item.content}</p><footer><small>Revision {item.revision} · {item.provenance.source === "agent" ? "Saved in chat" : item.provenance.source === "user" ? "Saved by you" : item.provenance.source}</small><div><button type="button" disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => { setEditing(item); setMemory({ kind: item.kind, title: item.title, content: item.content }); }}>Edit</button><button type="button" disabled={busy} aria-label={`Forget ${item.title}`} onClick={() => void change(`/memory/${encodeURIComponent(item.id)}`, { operation: "forget", expectedRevision: item.revision }, () => { setState(previous => previous ? { ...previous, memory: previous.memory.filter(record => record.id !== item.id) } : previous); if (editing !== "new" && editing?.id === item.id) setEditing(null); setNotice("Memory forgotten. Earlier chats and run records still retain their history."); })}>Forget</button></div></footer></article>) : <div className="agent-state-empty"><Brain size={26} /><h3>{search ? "No matching memories" : "Nothing remembered yet"}</h3><p>{search ? "Try a different search." : "Ask the agent to remember something, or add a memory here."}</p></div>}</div>
          <p className="agent-state-footnote">Forgetting prevents future recall. It does not erase earlier conversations or run evidence. Memory never grants tool access.</p>
        </section>}
      </div>
    </section>
  </dialog>, document.body);
}
function identityFields(identity: AgentIdentity): IdentityForm { return { name: identity.name, purpose: identity.purpose, style: identity.style, initiative: identity.initiative, behavior: identity.behavior }; }
function message(error: unknown) { return error instanceof Error ? error.message : "This change could not be completed."; }
