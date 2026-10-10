import { createHash } from "node:crypto";
import type { HostedToolContribution } from "../extensions/contracts.js";
import type { ToolDefinition } from "../tools/contracts.js";
import { validateToolArguments } from "../extensions/schema.js";

export const ASK_USER_TOOL_NAME = "ask_user";
export const askUserDefinition: ToolDefinition = {
  schemaVersion: 1, name: ASK_USER_TOOL_NAME,
  description: "Ask the user a necessary clarification inside chat and wait durably for their answer. Ask one clear question. This grants no action permission.",
  inputSchema: {type: "object", properties: {question: {type: "string", minLength: 1, maxLength: 16384}}, required: ["question"], additionalProperties: false},
  riskClass: "pure", executionKind: "in_process", approvalMode: "automatic", failurePolicy: "feedback",
  limits: {maxArgumentBytes: 32768, maxResultBytes: 32768, timeoutMs: 30000},
};
/** The native loop handles human waiting. Ordinary host execution fails closed. */
export function taskInteractionContribution(): HostedToolContribution {
  const digest = createHash("sha256").update(JSON.stringify(askUserDefinition)).digest("hex");
  return {descriptor: {definition: askUserDefinition, source: {id: "agentlab/task-interaction", version: "1.0.0", digest}, execution: {kind: "hosted", key: "agentlab/task-interaction/ask_user"}, failurePolicy: "feedback"},
    implementation: {definition: askUserDefinition, validateArguments: value => validateToolArguments(askUserDefinition.inputSchema, value), execute: async () => {throw new Error("ask_user requires native task suspension.");}}};
}
