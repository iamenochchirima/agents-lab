import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateContextBudget, compactContext, ContextSessionStore, CharacterTokenEstimator, type ContextMessage, type ContextSummaryGenerator } from "../../../capabilities/context/index.js";
import type { RunManifest } from "../../../control-plane/domain/types.js";

export interface NativeModelRequest { readonly prompt?: unknown; readonly tools?: unknown; readonly abortSignal?: AbortSignal }
/** Project the SDK's complete tool groups without truncating its native history. */
export async function prepareMastraRoundContext(manifest: RunManifest, root: string, directory: string, round: number,
  input: NativeModelRequest, summarizer: ContextSummaryGenerator) {
  if (!manifest.context.sessionId || !Array.isArray(input.prompt)) return { prompt: input.prompt, budget: null, compaction: null };
  const session = await new ContextSessionStore(root).read(manifest.context.sessionId);
  const policy = { reservedOutputTokens: session.reservedOutputTokens, safetyMarginTokens: session.safetyMarginTokens,
    compactionThresholdPercent: session.compactionThresholdPercent, recentMessageGroups: session.recentMessageGroups };
  const counter = new CharacterTokenEstimator();
  const originals = new Map<string, unknown>();
  const messages = input.prompt.flatMap(message => message.role === "tool" && Array.isArray(message.content)
    ? message.content.map((part: unknown) => ({ ...message, content: [part] })) : [message]);
  const complete: string[] = [];
  const skills = [...session.skillContexts, ...(session.activeSkillContexts ?? [])];
  let group: string | undefined;
  let expected: string[] = [];
  let received: string[] = [];
  let taskMessageId: string | undefined;
  const projected: ContextMessage[] = messages.map((message, sequence) => {
    const parts = Array.isArray(message.content) ? message.content : [];
    const calls = parts.filter((part: { type?: string }) => part.type === "tool-call");
    if (message.role === "assistant" && calls.length) { group = `round-${round}:group-${sequence}`; expected = calls.map((call: { toolCallId: string }) => call.toolCallId); received = []; }
    else if (message.role !== "tool") group = undefined;
    const toolCallId = message.role === "tool" ? parts[0]?.toolCallId : undefined;
    if (group && toolCallId) { received.push(toolCallId); if (expected.length === received.length && expected.every(id => received.includes(id))) complete.push(group); }
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    const text = typeof message.content === "string" ? message.content : parts.filter((part: { type?: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n");
    const messageId = `round-${round}:message-${sequence}`; originals.set(messageId, message);
    if (message.role === "user" && text.includes(manifest.task.prompt)) taskMessageId = messageId;
    return { schemaVersion: 1, messageId, sessionId: session.sessionId, sequence, role: message.role, content,
      source: skills.some(skill => text.includes(skill.content)) ? "skills" : message.role === "system" ? "system" : "transcript",
      createdAt: new Date().toISOString(), ...(group ? { groupId: group } : {}),
      metadata: (calls.length ? { toolCallIds: JSON.stringify(expected) } : toolCallId ? { toolCallId } : {}) as Readonly<Record<string, string>> };
  });
  const schemaId = `round-${round}:tool-schemas`;
  if (input.tools) projected.push({ schemaVersion: 1, messageId: schemaId, sessionId: session.sessionId, sequence: projected.length,
    role: "system", content: JSON.stringify(input.tools), source: "tools", createdAt: new Date().toISOString() });
  const task = projected.find(message => message.messageId === taskMessageId);
  if (!task) throw new Error("The retained Mastra task is absent from native context.");
  const before = calculateContextBudget(session.contextWindowTokens, counter.count(projected), policy);
  let retained = projected as readonly ContextMessage[];
  let compaction = null;
  if (before.pressure === "compaction_due" || before.pressure === "exhausted") {
    const compacted = await compactContext(projected, counter, session.contextWindowTokens, policy,
      { sessionId: session.sessionId, sessionRevision: session.revision, sourceRevision: round, currentMessageId: task.messageId,
        completedGroupIds: complete, protectedMessageIds: projected.filter(message => message.source === "skills").map(message => message.messageId),
        trigger: "preflight", policyVersion: "mastra-native-round-v1" }, summarizer);
    retained = compacted.messages; compaction = compacted.record;
  }
  const budget = calculateContextBudget(session.contextWindowTokens, counter.count(retained), policy);
  if (budget.pressure === "exhausted" || budget.pressure === "unknown") throw new Error("The next Mastra model request exceeds the retained safe context budget.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `context-round-${round}.json`), JSON.stringify({ schemaVersion: 1, runId: manifest.runId, round,
    sourceMessages: projected, messages: retained, budget, compaction, skillDigests: skills.map(skill => skill.digest) }), { mode: 0o600 });
  const prompt = retained.filter(message => message.messageId !== schemaId).map(message => originals.get(message.messageId)
    ?? { role: message.role === "developer" ? "system" : message.role, content: message.content });
  return { prompt, budget, compaction };
}
