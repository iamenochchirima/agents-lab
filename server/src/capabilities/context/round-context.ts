import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateContextBudget } from "./budget.js";
import { compactContext, ContextCompactionError } from "./compaction.js";
import type { ContextMessage, ContextSummaryGenerator } from "./contracts.js";
import { ContextSessionStore } from "./session-store.js";
import { CharacterTokenEstimator } from "./token-counter.js";

/** Transport-neutral projection used by the Temporal Activity and Restate action.
 * It makes no model calls or scheduling decisions; native callers own the summary
 * operation, its deadline, and journaled result. Canonical transcript is untouched.
 */
export type RoundMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls?: readonly { readonly toolCallId: string; readonly name: string; readonly arguments: unknown }[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly name: string; readonly content: string };

export async function prepareRoundContext(input: {
  readonly rootDirectory: string; readonly sessionId: string; readonly runId: string;
  readonly round: number; readonly task: string; readonly messages: readonly RoundMessage[];
  readonly toolSchemas: unknown; readonly forceCompaction?: boolean;
}, summarizer: ContextSummaryGenerator) {
  const store = new ContextSessionStore(input.rootDirectory);
  const session = await store.read(input.sessionId);
  const policy = { reservedOutputTokens: session.reservedOutputTokens, safetyMarginTokens: session.safetyMarginTokens,
    compactionThresholdPercent: session.compactionThresholdPercent, recentMessageGroups: session.recentMessageGroups };
  const counter = new CharacterTokenEstimator();
  const now = new Date().toISOString();
  const originals = new Map<string, RoundMessage>();
  const complete: string[] = [];
  let groupId: string | undefined;
  let expected: readonly string[] = [];
  let received: string[] = [];
  const skills = [...session.skillContexts, ...(session.activeSkillContexts ?? [])];
  const projected: ContextMessage[] = input.messages.map((message, sequence) => {
    const messageId = `round-${input.round}:message-${sequence}`;
    originals.set(messageId, message);
    if (message.role === "assistant" && message.toolCalls?.length) {
      groupId = `round-${input.round}:group-${sequence}`;
      expected = message.toolCalls.map(call => call.toolCallId); received = [];
    } else if (message.role !== "tool") groupId = undefined;
    if (message.role === "tool" && groupId) {
      received.push(message.toolCallId);
      if (expected.length === received.length && expected.every(id => received.includes(id))) complete.push(groupId);
    }
    const content = message.role === "assistant" && message.toolCalls?.length
      ? JSON.stringify({ content: message.content, toolCalls: message.toolCalls }) : message.content ?? "";
    return { schemaVersion: 1, messageId, sessionId: input.sessionId, sequence, role: message.role, content,
      source: skills.some(skill => skill.content === content) ? "skills" : message.role === "system" ? "system" : "transcript",
      createdAt: now, ...(groupId ? { groupId } : {}), metadata: (message.role === "assistant" && message.toolCalls?.length
        ? { toolCallIds: JSON.stringify(expected) } : message.role === "tool" ? { toolCallId: message.toolCallId } : {}) as Readonly<Record<string, string>> };
  });
  for (const skill of skills.filter(skill => !projected.some(message => message.content === skill.content))) {
    projected.push({ schemaVersion: 1, messageId: `round-${input.round}:skill-${skill.digest}`, sessionId: input.sessionId,
      sequence: projected.length, role: "user", content: skill.content, source: "skills", createdAt: now,
      metadata: { skillId: skill.skillId, skillDigest: skill.digest } });
  }
  const schemasId = `round-${input.round}:schemas`;
  projected.push({ schemaVersion: 1, messageId: schemasId, sessionId: input.sessionId, sequence: projected.length,
    role: "system", content: JSON.stringify(input.toolSchemas ?? []), source: "tools", createdAt: now, metadata: { tokenEstimateOnly: "true" } });
  const task = [...projected].reverse().find(message => message.role === "user" && message.content === input.task);
  if (!task) throw new ContextCompactionError("The retained active task is absent from native round context.");
  const before = calculateContextBudget(session.contextWindowTokens, counter.count(projected), policy);
  let retained: readonly ContextMessage[] = projected;
  let compaction = null;
  if (input.forceCompaction || before.pressure === "compaction_due" || before.pressure === "exhausted") {
    const compacted = await compactContext(projected, counter, session.contextWindowTokens, policy, {
      sessionId: input.sessionId, sessionRevision: session.revision, sourceRevision: input.round, currentMessageId: task.messageId,
      completedGroupIds: complete, protectedMessageIds: projected.filter(message => message.source === "skills").map(message => message.messageId),
      trigger: input.forceCompaction ? "provider_overflow" : "preflight", policyVersion: `native-round-v1:${input.runId}`,
    }, summarizer);
    retained = compacted.messages; compaction = compacted.record;
  }
  const budget = calculateContextBudget(session.contextWindowTokens, counter.count(retained), policy);
  if (budget.pressure === "exhausted" || budget.pressure === "unknown") throw new ContextCompactionError("The next native model request exceeds the retained safe context budget.");
  // These private records retain full source observations for inspecting summary
  // loss. A public event contains IDs/budgets only, never skill bodies or raw tools.
  const directory = join(input.rootDirectory, input.sessionId, "native-rounds");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = createHash("sha256").update(`${input.runId}:${input.round}:${Boolean(input.forceCompaction)}`).digest("hex");
  const path = join(directory, `${id}.json`);
  await writeFile(`${path}.tmp`, JSON.stringify({ schemaVersion: 1, runId: input.runId, round: input.round,
    messages: retained, ...(compaction ? { sourceMessages: projected } : {}), budget, compaction,
    skillDigests: skills.map(skill => skill.digest), createdAt: now }), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  const messages: readonly RoundMessage[] = retained.filter(message => message.messageId !== schemasId)
    .map(message => originals.get(message.messageId) ?? { role: message.role === "developer" ? "system" : message.role === "tool" ? "user" : message.role, content: message.content });
  return { messages, budget, compaction, contextRecordId: id };
}
