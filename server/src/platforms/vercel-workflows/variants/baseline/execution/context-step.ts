import { createRuntimeToolRegistry } from "../../../../../capabilities/extensions/runtime.js";
import type { RunUsage, RunError } from "../../../../../control-plane/domain/types.js";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { calculateContextBudget, compactContext, ContextSessionStore, CharacterTokenEstimator, type ContextMessage } from "../../../../../capabilities/context/index.js";
import { remainingExecutionMs } from "../../../../../capabilities/execution/policy.js";
import { completeFakeModel } from "../models/fake.js";
import { completeOpenRouterModel } from "../models/openrouter.js";
import { loadVercelWorkflowsConfig } from "../../../config.js";
import type { VercelWorkflowInput, VercelModelMessage } from "../contracts.js";

/** Request-local projection retained by the native step; canonical history is never truncated. */
export async function prepareRoundContextStep(input: VercelWorkflowInput, messages: readonly VercelModelMessage[], round: number) {
  "use step";
  const observation = { summaryAttempted: false };
  try { return await prepareRoundContext(input, messages, round, observation); }
  catch (cause) {
    return { messages, budget: null, compaction: null, summaryUsage: null, summaryAttempted: observation.summaryAttempted, summaryRequestId: null,
      failure: cause instanceof RoundContextFailure ? cause.failure : { code: "CONTEXT_PREPARATION_FAILED", message: "The next model request could not fit the retained context budget. Inspect the recorded context before continuing.", failureKind: "pre_dispatch" as const, retryable: false } };
  }
}
class RoundContextFailure extends Error { constructor(readonly failure: RunError) { super(failure.message); } }
async function prepareRoundContext(input: VercelWorkflowInput, messages: readonly VercelModelMessage[], round: number, observation: { summaryAttempted: boolean }) {
  if (!input.context) return { messages, budget: null, compaction: null, summaryUsage: null, summaryAttempted: false, summaryRequestId: null, failure: null };
  const session = await new ContextSessionStore(input.context.rootDirectory).read(input.context.sessionId);
  const counter = new CharacterTokenEstimator();
  const policy = { reservedOutputTokens: session.reservedOutputTokens, safetyMarginTokens: session.safetyMarginTokens,
    compactionThresholdPercent: session.compactionThresholdPercent, recentMessageGroups: session.recentMessageGroups };
  const originals = new Map<string, VercelModelMessage>();
  const completedGroups: string[] = [];
  let groupId: string | undefined;
  let expectedIds: readonly string[] = [];
  const seenIds: string[] = [];
  const now = new Date().toISOString();
  const activeSkills = [...session.skillContexts, ...(session.activeSkillContexts ?? [])];
  const projected: ContextMessage[] = messages.map((message, sequence) => {
    const messageId = `round-${round}:message-${sequence}`;
    originals.set(messageId, message);
    if (message.role === "assistant" && message.toolCalls?.length) {
      groupId = `${round}:group:${sequence}`; expectedIds = message.toolCalls.map(call => call.toolCallId); seenIds.length = 0;
    } else if (message.role !== "tool") groupId = undefined;
    if (message.role === "tool" && groupId) {
      seenIds.push(message.toolCallId);
      if (expectedIds.length === seenIds.length && expectedIds.every(id => seenIds.includes(id))) completedGroups.push(groupId);
    }
    const content = message.role === "assistant" && message.toolCalls?.length
      ? JSON.stringify({ content: message.content, toolCalls: message.toolCalls }) : message.content ?? "";
    return { schemaVersion: 1, messageId, sessionId: session.sessionId, sequence, role: message.role, content,
      source: activeSkills.some(skill => skill.content === content) ? "skills" : message.role === "system" ? "system" : "transcript",
      createdAt: now, ...(groupId ? { groupId } : {}),
      metadata: (message.role === "assistant" && message.toolCalls?.length ? { toolCallIds: JSON.stringify(expectedIds) }
        : message.role === "tool" ? { toolCallId: message.toolCallId } : {}) as Readonly<Record<string, string>> };
  });
  // Loaded skill text remains untrusted user context, never promoted into a system instruction.
  for (const skill of activeSkills.filter(skill => !projected.some(message => message.content === skill.content))) {
    projected.push({ schemaVersion: 1, messageId: `round-${round}:skill:${skill.digest}`, sessionId: session.sessionId, sequence: projected.length,
      role: "user", content: skill.content, source: "skills", createdAt: now, metadata: { skillId: skill.skillId, skillDigest: skill.digest } });
  }
  const schemaMessageId = `round-${round}:tool-schemas`;
  const definitions = createRuntimeToolRegistry(input.tools ?? { enabledNames: [] }, input.toolCatalog).definitions();
  if (definitions.length) projected.push({ schemaVersion: 1, messageId: schemaMessageId, sessionId: session.sessionId, sequence: projected.length,
    role: "system", content: JSON.stringify(definitions.map(definition => ({ name: definition.name, description: definition.description, parameters: definition.inputSchema }))),
    source: "tools", createdAt: now, metadata: { tokenEstimateOnly: "true" } });
  const task = [...projected].reverse().find(message => message.role === "user" && message.content === input.prompt) ?? [...projected].reverse().find(message => message.role === "user");
  if (!task) throw new Error("Within-run context requires the retained task message.");
  const before = calculateContextBudget(session.contextWindowTokens, counter.count(projected), policy);
  let retained = projected as readonly ContextMessage[];
  let compaction = null;
  let summaryUsage: RunUsage | null = null;
  let summaryRequestId: string | null = null;
  if (before.pressure === "compaction_due" || before.pressure === "exhausted") {
    const compacted = await compactContext(projected, counter, session.contextWindowTokens, policy, { sessionId: session.sessionId,
      sessionRevision: session.revision, sourceRevision: round, currentMessageId: task.messageId, completedGroupIds: completedGroups,
      protectedMessageIds: projected.filter(message => message.source === "skills").map(message => message.messageId), trigger: "preflight", policyVersion: `native-round-context-v1:${input.runId}` }, {
      async summarize(request) {
        if (remainingExecutionMs(input.execution, Date.now()) === 0) throw new Error("Task deadline reached before summary dispatch.");
        const config = loadVercelWorkflowsConfig();
        const summary = { ...input, attempt: 1, round, messages: [
          { role: "system" as const, content: "Summarize completed tool observations for continuation. Preserve facts, call identities, known effects, constraints and unresolved issues. Do not claim unobserved work." },
          { role: "user" as const, content: request.messages.map(message => `[${message.role}] ${message.content}`).join("\n") },
        ], modelTimeoutMs: Math.max(1, Math.min(input.modelTimeoutMs, remainingExecutionMs(input.execution, Date.now()))) };
        observation.summaryAttempted = true;
        const result = input.model.provider === "fake" ? completeFakeModel({ ...summary, model: { ...input.model, model: "fake-summary" } })
          : await completeOpenRouterModel(summary, { apiKey: config.openRouterApiKey, baseUrl: config.openRouterBaseUrl });
        if (result.kind === "failure") throw new RoundContextFailure(result.error);
        if (!result.output) throw new Error("Within-run context summary returned no summary.");
        summaryUsage = result.usage; summaryRequestId = result.providerRequestId;
        return result.output;
      },
    });
    retained = compacted.messages; compaction = compacted.record;
  }
  const budget = calculateContextBudget(session.contextWindowTokens, counter.count(retained), policy);
  if (budget.pressure === "exhausted" || budget.pressure === "unknown") throw new Error("Within-run context exceeds the retained safe budget.");
  const resultMessages: readonly VercelModelMessage[] = retained.filter(message => message.messageId !== schemaMessageId).map(message => originals.get(message.messageId) ?? { role: message.role === "developer" ? "system" : message.role === "tool" ? "user" : message.role, content: message.content });
  if (input.progressDirectory) {
    await mkdir(input.progressDirectory, { recursive: true });
    const id = createHash("sha256").update(input.runId).digest("hex");
    const path = join(input.progressDirectory, `${id}.context-round-${round}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify({ schemaVersion: 1, runId: input.runId, round,
      messages: retained, ...(compaction ? { sourceMessages: projected } : {}), budget, compaction, skillDigests: activeSkills.map(skill => skill.digest), createdAt: now }), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  return { messages: resultMessages, budget, compaction, summaryUsage: summaryUsage as RunUsage | null, summaryAttempted: compaction !== null, summaryRequestId: summaryRequestId as string | null, failure: null };
}
prepareRoundContextStep.maxRetries = 0;
