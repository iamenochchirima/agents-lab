import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import { parseContextConfig, type ContextConfig } from "./config.js";
import {
  ContextAssemblyError,
  type ContextAssemblyInput,
  type ContextAssemblyResult,
  type ContextAssembler,
  type ContextDependencies,
  type ContextMaterial,
  type ContextPlanningMaterial,
  type ContextToolCallMessage,
  type ContextToolExchange,
  type ContextToolResultMessage,
  type ContextSourceEvidence,
  type ContextTokenCount,
  type ContextTokenCounter,
  type ModelMessage,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "deterministic-context-assembler", version: "0.4.0" });

/**
 * Create a request-scoped Context assembler with deterministic ordering and
 * budget selection. No state survives an assembly call.
 */
export function createContextAssembler(config: ContextConfig, dependencies: ContextDependencies): ContextAssembler {
  const parsedConfig = parseContextConfig(config);
  if (!dependencies || !dependencies.tokenCounter || typeof dependencies.tokenCounter.count !== "function") {
    throw new TypeError("Context dependencies require a tokenCounter.count function.");
  }

  const tokenCounter = dependencies.tokenCounter;
  return Object.freeze({
    identity: IDENTITY,
    async assemble(input: ContextAssemblyInput, signal: AbortSignal): Promise<ContextAssemblyResult> {
      if (!signal || typeof signal.aborted !== "boolean") throw invalidInput("A valid AbortSignal is required.");
      assertNotAborted(signal, "Context assembly was cancelled before it began.");
      validateInput(input, signal);

      const instructions = [...input.instructions].map((material) => validateMaterial(material, "instruction"));
      instructions.sort(compareSequenceThenSource);
      const task = validateMaterial(input.task, "task");
      const planningProposal = input.planningProposal === undefined
        ? undefined
        : validatePlanningMaterial(input.planningProposal);
      const turns = [...input.turns].map((material) => validateMaterial(material, "turn"));
      turns.sort(compareSequenceThenSource);
      const candidates = [...input.memoryCandidates].map((material) => validateMaterial(material, "memory"));
      candidates.sort(compareSequenceThenSource);
      const toolExchanges = input.toolExchanges.map(validateToolExchange)
        .sort((left, right) => compareSequenceThenSource(left.assistant, right.assistant));
      const toolExchangeMaterials = toolExchanges.flatMap(({ assistant, results }) => [assistant, ...results]);

      const all = [...instructions, ...candidates, ...turns, task, ...(planningProposal ? [planningProposal] : []), ...toolExchangeMaterials];
      assertUniqueSourceIds(all);
      const availableInputTokens = input.budget.contextWindowTokens
        - input.budget.reservedOutputTokens
        - input.budget.safetyMarginTokens;
      if (availableInputTokens < parsedConfig.minAvailableInputTokens) {
        throw budgetError("The available input-token budget is below the configured minimum.");
      }

      const oversizedCandidates = new Set<string>();
      for (const candidate of candidates) {
        assertNotAborted(signal, "Context assembly was cancelled while validating Memory candidates.");
        if (utf8Bytes(candidate.content) > parsedConfig.maxSourceBytes) oversizedCandidates.add(candidate.sourceId);
      }
      for (const turn of turns) {
        assertNotAborted(signal, "Context assembly was cancelled while validating conversation turns.");
        if (utf8Bytes(turn.content) > parsedConfig.maxSourceBytes) oversizedCandidates.add(turn.sourceId);
      }
      for (const material of toolExchangeMaterials) {
        assertNotAborted(signal, "Context assembly was cancelled while validating tool exchanges.");
        if (utf8Bytes(material.content) > parsedConfig.maxSourceBytes) {
          throw invalidInput(`Required tool exchange source ${JSON.stringify(material.sourceId)} exceeds maxSourceBytes.`);
        }
      }
      for (const required of [...instructions, task]) {
        if (utf8Bytes(required.content) > parsedConfig.maxSourceBytes) {
          throw invalidInput(`Required source ${JSON.stringify(required.sourceId)} exceeds maxSourceBytes.`);
        }
      }
      if (planningProposal && utf8Bytes(planningProposal.content) > parsedConfig.maxSourceBytes) {
        throw invalidInput(`Required Planning source ${JSON.stringify(planningProposal.sourceId)} exceeds maxSourceBytes.`);
      }

      const requiredMaterials = [...instructions, task, ...(planningProposal ? [planningProposal] : []), ...toolExchangeMaterials];
      if (requiredMaterials.length > parsedConfig.maxMessages) {
        throw budgetError("Trusted instructions, the current task, required Planning proposal, and tool exchanges exceed maxMessages.");
      }
      let messages = createMessages([...instructions, task, ...(planningProposal ? [planningProposal] : []), ...toolExchangeMaterials]);
      let tokenCount = countCompleteMessages(tokenCounter, messages, signal);
      if (tokenCount.value > availableInputTokens) {
        throw budgetError("Trusted instructions, the current task, Planning proposal, and tool exchanges do not fit the available input-token budget.");
      }

      const dispositions = new Map<string, { readonly status: "included" } | { readonly status: "omitted"; readonly reason: "budget" | "invalid-source" }>();
      for (const instruction of instructions) dispositions.set(instruction.sourceId, { status: "included" });
      for (const material of toolExchangeMaterials) dispositions.set(material.sourceId, { status: "included" });
      dispositions.set(task.sourceId, { status: "included" });
      if (planningProposal) dispositions.set(planningProposal.sourceId, { status: "included" });

      const selectedTurnsNewestFirst: ContextMaterial[] = [];
      let historyBoundaryReached = false;
      for (const turn of [...turns].reverse()) {
        assertNotAborted(signal, "Context assembly was cancelled while selecting conversation turns.");
        if (historyBoundaryReached) {
          dispositions.set(turn.sourceId, { status: "omitted", reason: "budget" });
          continue;
        }
        if (oversizedCandidates.has(turn.sourceId)) {
          dispositions.set(turn.sourceId, { status: "omitted", reason: "invalid-source" });
          historyBoundaryReached = true;
          continue;
        }
        if (instructions.length + selectedTurnsNewestFirst.length + toolExchangeMaterials.length + 1 + Number(planningProposal !== undefined) > parsedConfig.maxMessages) {
          dispositions.set(turn.sourceId, { status: "omitted", reason: "budget" });
          historyBoundaryReached = true;
          continue;
        }

        const proposedTurns = [...selectedTurnsNewestFirst, turn].sort(compareSequenceThenSource);
        const proposedMessages = createMessages([...instructions, ...proposedTurns, task, ...(planningProposal ? [planningProposal] : []), ...toolExchangeMaterials]);
        const proposedCount = countCompleteMessages(tokenCounter, proposedMessages, signal);
        if (proposedCount.value <= availableInputTokens) {
          selectedTurnsNewestFirst.push(turn);
          dispositions.set(turn.sourceId, { status: "included" });
          messages = proposedMessages;
          tokenCount = proposedCount;
        } else {
          dispositions.set(turn.sourceId, { status: "omitted", reason: "budget" });
          historyBoundaryReached = true;
        }
      }
      const selectedTurns = [...selectedTurnsNewestFirst].sort(compareSequenceThenSource);

      const selectedMemory: ContextMaterial[] = [];
      for (const candidate of candidates) {
        assertNotAborted(signal, "Context assembly was cancelled while selecting Memory candidates.");
        if (oversizedCandidates.has(candidate.sourceId)) {
          dispositions.set(candidate.sourceId, { status: "omitted", reason: "invalid-source" });
          continue;
        }
        if (instructions.length + selectedMemory.length + selectedTurns.length + toolExchangeMaterials.length + 1 + Number(planningProposal !== undefined) > parsedConfig.maxMessages) {
          dispositions.set(candidate.sourceId, { status: "omitted", reason: "budget" });
          continue;
        }

        const proposedMemory = [...selectedMemory, candidate];
        const proposedMessages = createMessages([...instructions, ...proposedMemory, ...selectedTurns, task, ...(planningProposal ? [planningProposal] : []), ...toolExchangeMaterials]);
        const proposedCount = countCompleteMessages(tokenCounter, proposedMessages, signal);
        if (proposedCount.value <= availableInputTokens) {
          selectedMemory.push(candidate);
          dispositions.set(candidate.sourceId, { status: "included" });
          messages = proposedMessages;
          tokenCount = proposedCount;
        } else {
          dispositions.set(candidate.sourceId, { status: "omitted", reason: "budget" });
        }
      }

      assertNotAborted(signal, "Context assembly was cancelled before its result was returned.");
      const sourceLedger = all.map((material): ContextSourceEvidence => Object.freeze({
        sourceId: material.sourceId,
        kind: material.kind,
        role: material.role,
        trust: material.trust,
        provenance: material.provenance,
        disposition: Object.freeze(dispositions.get(material.sourceId)!),
      }));
      const includedSourceIds = messages.flatMap((message) => message.sourceIds);
      const omissions = sourceLedger.flatMap((entry) => entry.disposition.status === "omitted"
        ? [Object.freeze({ sourceId: entry.sourceId, reason: entry.disposition.reason })]
        : []);
      return Object.freeze({
        messages: Object.freeze(messages),
        includedSourceIds: Object.freeze(includedSourceIds),
        omissions: Object.freeze(omissions),
        sourceLedger: Object.freeze(sourceLedger),
        tokenCount: Object.freeze(tokenCount),
      });
    },
  });
}

function validateInput(input: ContextAssemblyInput, signal: AbortSignal): void {
  if (!input || typeof input !== "object") throw invalidInput("Assembly input must be an object.");
  if (!signal || typeof signal.aborted !== "boolean") throw invalidInput("A valid AbortSignal is required.");
  if (!input.scope || typeof input.scope !== "object" || !validIdentifier(input.scope.runId)) {
    throw invalidInput("Assembly scope requires a valid runId.");
  }
  if (!Array.isArray(input.instructions) || !Array.isArray(input.memoryCandidates)
    || !Array.isArray(input.turns) || !Array.isArray(input.toolExchanges)) {
    throw invalidInput("instructions, memoryCandidates, turns, and toolExchanges must be arrays.");
  }
  if (!input.budget || typeof input.budget !== "object") throw invalidInput("A token budget is required.");
  for (const [field, value, minimum] of [
    ["contextWindowTokens", input.budget.contextWindowTokens, 1],
    ["reservedOutputTokens", input.budget.reservedOutputTokens, 0],
    ["safetyMarginTokens", input.budget.safetyMarginTokens, 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) throw invalidInput(`budget.${field} must be an integer of at least ${minimum}.`);
  }
  if (typeof input.budget.tokenizer !== "string" || input.budget.tokenizer.trim().length === 0) {
    throw invalidInput("budget.tokenizer must identify the tokenizer used by the caller.");
  }
}

function validateMaterial(value: ContextMaterial, expectedKind: "instruction" | "task" | "turn" | "memory" | "planning" | "tool-result"): ContextMaterial {
  if (!value || typeof value !== "object") throw invalidInput(`Each ${expectedKind} must be a ContextMaterial object.`);
  if (value.kind !== expectedKind) throw invalidInput(`Source ${String(value.sourceId)} must have kind ${expectedKind}.`);
  if (!validIdentifier(value.sourceId)) throw invalidInput(`${expectedKind} sourceId must be non-empty and contain no surrounding whitespace or control characters.`);
  const toolCalls = "toolCalls" in value && Array.isArray((value as { readonly toolCalls?: unknown }).toolCalls)
    ? (value as { readonly toolCalls: readonly unknown[] }).toolCalls
    : [];
  const allowEmptyAssistantCall = expectedKind === "turn" && value.role === "assistant" && toolCalls.length > 0;
  if (typeof value.content !== "string" || (value.content.trim().length === 0 && !allowEmptyAssistantCall)) {
    throw invalidInput(`Source ${JSON.stringify(value.sourceId)} must contain non-empty text unless it carries a structured assistant tool call.`);
  }
  if (typeof value.sequence !== "number" || !Number.isFinite(value.sequence) || value.sequence < 0) {
    throw invalidInput(`Source ${JSON.stringify(value.sourceId)} must have a finite, non-negative sequence or retrieval rank.`);
  }
  if (value.trust !== "trusted" && value.trust !== "untrusted") throw invalidInput(`Source ${JSON.stringify(value.sourceId)} has an invalid trust label.`);
  const provenance = validateProvenance(value.provenance, value.sourceId);

  if (expectedKind === "instruction") {
    if ((value.role !== "system" && value.role !== "developer") || value.trust !== "trusted") {
      throw invalidInput(`Instruction ${JSON.stringify(value.sourceId)} must be trusted and use the system or developer role.`);
    }
  } else if (expectedKind === "turn") {
    if (value.role !== "user" && value.role !== "assistant") {
      throw invalidInput(`Conversation turn ${JSON.stringify(value.sourceId)} must use the user or assistant role.`);
    }
  } else if (expectedKind === "tool-result") {
    if (value.role !== "tool") throw invalidInput(`Tool result ${JSON.stringify(value.sourceId)} must use the tool role.`);
  } else if (expectedKind === "planning") {
    if (value.role !== "user" || value.trust !== "untrusted") {
      throw invalidInput(`Planning proposal ${JSON.stringify(value.sourceId)} must be untrusted and use the user role.`);
    }
  } else if (value.role !== "user") {
    throw invalidInput(`${expectedKind === "task" ? "Task" : "Memory"} ${JSON.stringify(value.sourceId)} must use the user role.`);
  }
  if (provenance.trust !== undefined && provenance.trust !== value.trust) {
    throw invalidInput(`Source ${JSON.stringify(value.sourceId)} has conflicting trust labels in material and provenance.`);
  }

  return Object.freeze({ ...value, provenance });
}

function validatePlanningMaterial(value: ContextPlanningMaterial): ContextPlanningMaterial {
  return validateMaterial(value, "planning") as ContextPlanningMaterial;
}

function validateToolExchange(value: ContextToolExchange): ContextToolExchange {
  if (!value || typeof value !== "object") throw invalidInput("Each tool exchange must be an object.");
  const assistant = validateToolCallMessage(value.assistant);
  if (!Array.isArray(value.results)) throw invalidInput(`Tool exchange ${JSON.stringify(assistant.sourceId)} must have a results array.`);
  if (assistant.toolCalls.length === 0) throw invalidInput(`Tool exchange ${JSON.stringify(assistant.sourceId)} must contain at least one assistant tool call.`);
  const callsById = new Map(assistant.toolCalls.map((call) => [call.callId, call]));
  const results = value.results.map((result) => validateToolResultMessage(result));
  if (results.length !== callsById.size) {
    throw invalidInput(`Tool exchange ${JSON.stringify(assistant.sourceId)} must include exactly one result for every assistant call.`);
  }
  const seenResults = new Set<string>();
  for (const result of results) {
    const call = callsById.get(result.toolCallId);
    if (!call || call.name !== result.name || seenResults.has(result.toolCallId)) {
      throw invalidInput(`Tool result ${JSON.stringify(result.sourceId)} does not match exactly one assistant tool call.`);
    }
    seenResults.add(result.toolCallId);
  }
  return Object.freeze({ assistant, results: Object.freeze(results) });
}

function validateToolCallMessage(value: ContextToolCallMessage): ContextToolCallMessage {
  if (!value || typeof value !== "object" || value.kind !== "turn" || value.role !== "assistant"
    || !Array.isArray(value.toolCalls)) throw invalidInput("A tool exchange requires a structured assistant turn.");
  const material = validateMaterial(value, "turn");
  const ids = new Set<string>();
  const toolCalls = value.toolCalls.map((call) => {
    if (!call || typeof call !== "object" || !validIdentifier(call.callId) || !validIdentifier(call.name)
      || ids.has(call.callId) || !isJsonValue(call.arguments)) {
      throw invalidInput(`Assistant tool call in ${JSON.stringify(value.sourceId)} is malformed or duplicated.`);
    }
    ids.add(call.callId);
    return Object.freeze({ callId: call.callId, name: call.name, arguments: call.arguments });
  });
  if (toolCalls.length === 0) throw invalidInput(`Assistant tool-call source ${JSON.stringify(value.sourceId)} has no calls.`);
  return Object.freeze({ ...material, kind: "turn", role: "assistant", toolCalls: Object.freeze(toolCalls) }) as ContextToolCallMessage;
}

function validateToolResultMessage(value: ContextToolResultMessage): ContextToolResultMessage {
  if (!value || typeof value !== "object" || value.kind !== "tool-result" || value.role !== "tool"
    || !validIdentifier(value.name) || !validIdentifier(value.toolCallId)) {
    throw invalidInput("A tool exchange result requires a tool name and matching toolCallId.");
  }
  const material = validateMaterial(value, "tool-result");
  return Object.freeze({ ...material, kind: "tool-result", role: "tool", name: value.name, toolCallId: value.toolCallId }) as ContextToolResultMessage;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function validateProvenance(value: unknown, sourceId: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput(`Source ${JSON.stringify(sourceId)} must have provenance as a string map.`);
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right));
  for (const [key, item] of entries) {
    if (key.trim().length === 0 || typeof item !== "string") {
      throw invalidInput(`Source ${JSON.stringify(sourceId)} has invalid provenance; keys must be non-empty and values must be text.`);
    }
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function assertUniqueSourceIds(materials: readonly ContextMaterial[]): void {
  const seen = new Set<string>();
  for (const material of materials) {
    if (seen.has(material.sourceId)) throw invalidInput(`Duplicate Context sourceId ${JSON.stringify(material.sourceId)}.`);
    seen.add(material.sourceId);
  }
}

function createMessages(materials: readonly (ContextMaterial | ContextToolCallMessage | ContextToolResultMessage)[]): ModelMessage[] {
  return materials.map((material) => {
    const sourceIds = Object.freeze([material.sourceId]);
    if ("toolCalls" in material) {
      return Object.freeze({
        role: "assistant" as const,
        content: material.content.length === 0 ? null : material.content,
        toolCalls: material.toolCalls,
        sourceIds,
      });
    }
    if ("toolCallId" in material) {
      return Object.freeze({ role: "tool" as const, content: material.content, name: material.name, toolCallId: material.toolCallId, sourceIds });
    }
    return Object.freeze({
      role: material.role,
      content: material.kind === "instruction" ? material.content : formatSourceData(material),
      sourceIds,
    });
  });
}

function formatSourceData(material: ContextMaterial): string {
  // JSON framing keeps provenance and trust visible while preserving the source
  // as user-role data instead of promoting it to an instruction role.
  return JSON.stringify({
    kind: material.kind,
    sourceId: material.sourceId,
    trust: material.trust,
    provenance: material.provenance,
    content: material.content,
  });
}

function countCompleteMessages(counter: ContextTokenCounter, messages: readonly ModelMessage[], signal: AbortSignal): ContextTokenCount {
  assertNotAborted(signal, "Context assembly was cancelled before token counting.");
  try {
    const value: unknown = counter.count(Object.freeze([...messages]));
    if (!value || typeof value !== "object") throw new TypeError("counter result must be an object");
    const result = value as Record<string, unknown>;
    if (typeof result.value !== "number" || !Number.isFinite(result.value) || result.value < 0
      || typeof result.basis !== "string" || result.basis.trim().length === 0
      || (result.quality !== "exact" && result.quality !== "estimated")) {
      throw new TypeError("counter must return a finite non-negative value, a named basis, and exact or estimated quality");
    }
    assertNotAborted(signal, "Context assembly was cancelled during token counting.");
    return Object.freeze({ value: result.value, basis: result.basis, quality: result.quality });
  } catch (error) {
    if (signal.aborted) throw abortError("Context assembly was cancelled during token counting.");
    throw new ContextAssemblyError(
      "TOKEN_COUNT_UNAVAILABLE",
      `The injected token counter did not return a usable count${error instanceof Error ? `: ${error.message}` : "."}`,
    );
  }
}

function compareSequenceThenSource(left: ContextMaterial, right: ContextMaterial): number {
  return left.sequence - right.sequence || compareText(left.sourceId, right.sourceId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertNotAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw abortError(message);
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function invalidInput(message: string): ContextAssemblyError {
  return new ContextAssemblyError("INVALID_CONTEXT_INPUT", message);
}

function budgetError(message: string): ContextAssemblyError {
  return new ContextAssemblyError("BUDGET_EXHAUSTED", message);
}
