import type { ModelMessage, ModelRequest, ModelToolDefinition, ProviderName, SessionId, TranscriptMessage, TurnId } from "../runtime/contracts.js";
import { ComputerNativeError } from "../runtime/errors.js";

export const MAX_CONTEXT_HISTORY_MESSAGES = 12;

export function buildInitialContext(options: {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly provider: ProviderName;
  readonly model: string;
  readonly initialInstruction: string;
  readonly userPrompt: string;
  readonly history?: readonly TranscriptMessage[];
  readonly tools?: readonly ModelToolDefinition[];
}): ModelRequest {
  const prompt = options.userPrompt.trim();
  if (prompt.length === 0) {
    throw new ComputerNativeError("invalid-input", "A message is required.");
  }
  const history: readonly ModelMessage[] = (options.history ?? [])
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_CONTEXT_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content }));
  const messages: readonly ModelMessage[] = [
    { role: "system", content: options.initialInstruction },
    ...history,
    { role: "user", content: prompt },
  ];
  return {
    sessionId: options.sessionId,
    turnId: options.turnId,
    provider: options.provider,
    model: options.model,
    messages,
    tools: options.tools,
  };
}
