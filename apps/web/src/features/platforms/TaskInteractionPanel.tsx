import { useEffect, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import { getTaskInteraction, sendTaskInput, type TaskInteraction, type TaskQuestion } from "./taskInteractionApi";

/** Independent polling keeps question controls stable while native run events update. */
export function TaskInteractionPanel({ runId, active }: { runId: string; active: boolean }) {
  const [snapshot, setSnapshot] = useState<TaskInteraction>({ inputs: [], questions: [] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try { const next = await getTaskInteraction(runId, controller.signal); if (!disposed) { setSnapshot(next); setError(null); } }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "Task input is unavailable."); }
      finally { busy = false; }
    };
    void refresh();
    const timer = active ? setInterval(() => void refresh(), 2000) : undefined;
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [runId, active]);
  return <>
    {[...snapshot.questions.map(question => ({ kind: "question" as const, at: question.createdAt, question })),
      ...snapshot.inputs.filter(input => input.kind === "steering").map(input => ({ kind: "instruction" as const, at: input.acceptedAt, input }))]
      .sort((a, b) => a.at.localeCompare(b.at)).map(item => item.kind === "question"
        ? <QuestionCard key={item.question.questionId} runId={runId} question={item.question} answer={snapshot.inputs.find(input => input.inputId === item.question.answerInputId)?.content} onRefresh={async () => setSnapshot(await getTaskInteraction(runId))} />
        : <section className="invocation-review" key={item.input.inputId} aria-label="Task instruction"><span className="eyebrow">Your instruction · {item.input.status === "consumed" ? "Received by agent" : item.input.status === "rejected" ? "Task ended before delivery" : "Saved, awaiting agent"}</span><ChatMarkdown content={item.input.content} /></section>)}
    {error && active && <p role="alert">{error}</p>}
  </>;
}
function QuestionCard({ runId, question, answer, onRefresh }: { runId: string; question: TaskQuestion; answer?: string; onRefresh: () => Promise<void> }) {
  const key = `agentlab.question.${runId}.${question.questionId}`;
  const [draft, setDraft] = useState(() => localStorage.getItem(key) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  async function reply() {
    if (!draft.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await sendTaskInput(runId, { inputId: `answer-${question.questionId}`, kind: "clarification_reply", questionId: question.questionId, content: draft.trim() });
      setSubmitted(true); localStorage.removeItem(key); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Reply could not be delivered."); }
    finally { setBusy(false); }
  }
  const awaiting = question.status === "pending" && !answer && !submitted;
  return <section className="invocation-review" aria-label="Agent question">
    <span className="eyebrow">{question.status === "cancelled" ? "Question cancelled" : awaiting ? "Agent needs your answer" : question.status === "answered" ? "Answer received" : "Answer saved"}</span>
    <ChatMarkdown content={question.question} />
    {answer && <div><span className="eyebrow">Your answer</span><ChatMarkdown content={answer} /></div>}
    {awaiting && <><label>Answer<textarea aria-label="Answer the agent" value={draft} onChange={event => { setDraft(event.target.value); localStorage.setItem(key, event.target.value); }} rows={2} /></label><button className="button button-primary" type="button" disabled={busy || !draft.trim()} onClick={() => void reply()}>{busy ? "Sending" : "Reply"}</button></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
