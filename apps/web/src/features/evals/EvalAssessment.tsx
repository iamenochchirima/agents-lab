import { useState } from "react";
import type { EvalTrialDetail } from "./evalResultsApi";
import { submitEvalAssessment, type EvalAssessmentInput } from "./evalResultsApi";

/** Human judgment is retained separately from the immutable machine verdict. */
export function EvalAssessment({ detail, onSaved }: { detail: EvalTrialDetail; onSaved?: () => void }) {
  const context = detail.assessmentContext;
  const [reviewerLabel, setReviewerLabel] = useState("");
  const [rationale, setRationale] = useState("");
  const [answers, setAnswers] = useState<Record<string, { outcome: "pass" | "fail" | "uncertain"; rationale: string }>>({});
  const [pending, setPending] = useState<EvalAssessmentInput | null>(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const latest = detail.assessments?.at(-1);
  if (!context) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!context?.eligible || !context.evidenceDigest || !context.rubricVersion) return;
    const input = pending ?? {
      assessmentId: `assessment-${crypto.randomUUID()}`,
      evidenceDigest: context.evidenceDigest,
      rubricVersion: context.rubricVersion,
      reviewerLabel: reviewerLabel.trim(), rationale: rationale.trim(),
      answers: context.questions.map(question => ({ questionId: question.id, ...answers[question.id] })),
      ...(latest ? { supersedesAssessmentId: latest.assessmentId } : {}),
    };
    setPending(input); setSaving(true); setError(null);
    try {
      await submitEvalAssessment(detail.invocation.invocationId, detail.case.caseId, detail.case.trial, input);
      setSaved(true); setPending(null); onSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Assessment could not be saved."); }
    finally { setSaving(false); }
  }
  const ready = reviewerLabel.trim().length > 0 && rationale.trim().length > 0 && context.questions.every(question => answers[question.id]?.rationale.trim() && answers[question.id]?.outcome);
  return <section className="evals-assessment" aria-label="Human assessment">
    <h4>Human assessment</h4>
    {detail.assessedOutcome && <p>Recorded assessment: <strong>{detail.assessedOutcome.outcome}</strong>. Original verdict: {detail.case.verdict}.</p>}
    {detail.assessments?.length ? <details><summary>Assessment history ({detail.assessments.length})</summary>{detail.assessments.map(record => <article key={record.assessmentId}>
      <strong>{record.outcome}</strong> · {record.reviewerLabel} · <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time>
      <p>{record.rationale}</p><details><summary>Rubric answers and identity</summary><pre>{JSON.stringify(record, null, 2)}</pre></details>
    </article>)}</details> : null}
    {!context.eligible ? <p>{context.reason ?? "This trial is not eligible for subjective assessment."}</p> : saved ? <p role="status">Assessment saved. The original report is unchanged.</p> : <form onSubmit={event => void submit(event)}>
      <p>{context.rubric}</p>
      <p>Reviewer names are local attribution, not verified account identities. Judge the retained answers using the rubric above.</p>
      <label>Reviewer name<input required maxLength={120} value={reviewerLabel} disabled={saving || pending !== null} onChange={event => setReviewerLabel(event.target.value)} /></label>
      {context.questions.map(question => <fieldset key={question.id} disabled={saving || pending !== null}>
        <legend>{context.questions.length === 1 ? "Apply the retained rubric" : question.prompt}</legend>
        <label>Judgment<select required value={answers[question.id]?.outcome ?? ""} onChange={event => setAnswers(current => ({ ...current, [question.id]: { rationale: current[question.id]?.rationale ?? "", outcome: event.target.value as "pass" | "fail" | "uncertain" } }))}>
          <option value="" disabled>Select a judgment</option><option value="pass">Meets rubric</option><option value="fail">Does not meet rubric</option><option value="uncertain">Uncertain</option>
        </select></label>
        <label>Evidence for judgment<textarea required maxLength={4000} value={answers[question.id]?.rationale ?? ""} onChange={event => setAnswers(current => ({ ...current, [question.id]: { outcome: current[question.id]?.outcome ?? "uncertain", rationale: event.target.value } }))} /></label>
      </fieldset>)}
      <label>Assessment rationale<textarea required maxLength={4000} disabled={saving || pending !== null} value={rationale} onChange={event => setRationale(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={saving || !ready}>{saving ? "Saving…" : pending ? "Retry same assessment" : latest ? "Save revised assessment" : "Save assessment"}</button>
      {pending && !saving && <button type="button" onClick={() => { setPending(null); setError(null); }}>Edit assessment</button>}
    </form>}
  </section>;
}
