import type { ModelMessage, ModelRequest, ProviderName, SessionId, TurnId } from "../runtime/contracts.js";
import { ComputerNativeError } from "../runtime/errors.js";

export function buildInitialContext(options: {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly provider: ProviderName;
  readonly model: string;
  readonly initialInstruction: string;
  readonly userPrompt: string;
}): ModelRequest {
  const prompt = options.userPrompt.trim();
  if (prompt.length === 0) {
    throw new ComputerNativeError("invalid-input", "A message is required.");
  }
  const messages: readonly ModelMessage[] = [
    { role: "system", content: options.initialInstruction },
    { role: "user", content: prompt },
  ];
  return {
    sessionId: options.sessionId,
    turnId: options.turnId,
    provider: options.provider,
    model: options.model,
    messages,
  };
}
