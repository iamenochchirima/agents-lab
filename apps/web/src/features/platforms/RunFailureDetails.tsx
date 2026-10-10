import type { RunView } from "./platformApi";
import { failureExplanation } from "./failureExplanation";

/** Safe guidance and a bounded, derived phase chain. Raw native errors remain protected evidence. */
export function RunFailureDetails({ run }: { readonly run: RunView }) {
  const explanation = failureExplanation(run);
  if (!explanation) return null;
  return <section className="chat-run-failure" aria-label="Failure explanation">
    <p>{explanation.guidance}</p>
    <details className="chat-activity"><summary>Failure details</summary>
      <ol>{explanation.chain.map((cause, index) => <li key={index}><strong>{cause.phase}</strong><small>{cause.category} · <code>{cause.code}</code></small></li>)}</ol>
    </details>
  </section>;
}
