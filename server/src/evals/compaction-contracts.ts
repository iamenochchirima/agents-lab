import type { ContextSnapshot, ContextMessage } from "../capabilities/context/index.js";
import { gradeExtension, type ExtensionPlatform } from "./extension-contracts.js";

export const COMPACTION_CASE_VERSION = "x05-compaction-v1";
export const COMPACTION_CONSTRAINT = "colour=violet; batch=27; mode=read-only";
export const COMPACTION_PROMPTS = [
  `Remember these constraints for the next turn: ${COMPACTION_CONSTRAINT}. Acknowledge briefly. Harmless padding: ${"cedar ".repeat(1900).trim()}`,
  `Return only a JSON object with keys colour, batch (number), and mode, using the earlier constraints. Harmless padding: ${"birch ".repeat(1300).trim()}`,
] as const;
export interface CompactionReceipt { readonly sequence: number; readonly model: string; readonly messages: readonly { role: string; content: string }[]; readonly output: string; readonly kind: "summary" | "answer" }

/** The answer assertion measures an exact constrained JSON task; it is separate
 * from context delivery and is not a broad semantic language judgment. */
export function gradeCompaction(input: { platform: ExtensionPlatform; deployment: string; snapshot: ContextSnapshot; transcript: readonly ContextMessage[]; receipts: readonly CompactionReceipt[]; output: string | null; sources: readonly string[] }) {
  const { snapshot, transcript, receipts } = input;
  const record = snapshot.compaction;
  const summaries = receipts.filter(receipt => receipt.kind === "summary");
  const lastSummary = summaries.at(-1);
  const lastAnswer = receipts.filter(receipt => receipt.kind === "answer").at(-1);
  const summary = snapshot.messages.find(message => message.messageId === record?.summaryMessageId && message.source === "compaction-summary");
  const sourceMessages = record?.sourceMessageIds.map(id => transcript.find(message => message.messageId === id));
  const summaryInput = lastSummary?.messages.map(message => message.content).join("\n") ?? "";
  let answer: unknown = null;
  try { answer = JSON.parse(input.output ?? ""); } catch { /* Invalid structured answer is a measured failure. */ }
  const expected = { colour: "violet", batch: 27, mode: "read-only" };
  const answerMatches = answer !== null && typeof answer === "object" && !Array.isArray(answer) && Object.keys(answer).length === 3 && Object.entries(expected).every(([key, value]) => (answer as Record<string, unknown>)[key] === value);
  const checks = {
    recordedBudgetBoundary: Boolean(record && ["compaction_due", "exhausted"].includes(record.before.pressure) && record.after.pressure !== "exhausted" && record.before.inputTokens! > record.after.inputTokens! && record.trigger === "preflight"),
    modelBackedSummary: Boolean(lastSummary && summary && summary.content.endsWith(lastSummary.output) && lastSummary.output.trim()),
    summarySourceProvenance: Boolean(record && sourceMessages?.length && sourceMessages.every(message => message && summaryInput.includes(message.content)) && summary?.metadata?.sourceRevision === String(record.sourceRevision) && record.sourceMessageIds.every(id => !record.retainedMessageIds.includes(id))),
    actualPostCompactionRequest: Boolean(summary && lastAnswer && lastSummary && lastAnswer.sequence > lastSummary.sequence && lastAnswer.messages.some(message => message.content === summary.content) && lastAnswer.messages.at(-1)?.content === COMPACTION_PROMPTS[1]),
    constraintsInRequest: Boolean(lastAnswer?.messages.some(message => message.content.includes(COMPACTION_CONSTRAINT)) && summary?.content.includes(COMPACTION_CONSTRAINT)),
    constraintsInAnswer: answerMatches,
  };
  return gradeExtension({ caseId: "X05", platform: input.platform, variant: "baseline", deployment: input.deployment, claimed: true,
    reason: "Scripted local provider exercises the native summarization and post-compaction request path; it does not measure live-model summary quality.",
    observations: Object.entries(checks).map(([check, observed]) => ({ check, observed, sources: input.sources })) });
}
