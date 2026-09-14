import type { AppConfig } from "../config/config.js";
import { createModelProvider } from "../models/factory.js";
import { SessionStore } from "../persistence/session-store.js";
import type { SessionLock } from "../persistence/lock.js";
import type { TurnResult } from "./contracts.js";
import { runTurn } from "./turn.js";

export interface ChatApplication {
  readonly sessionId: string;
  readonly modelLabel: string;
  recoverInterruptedTurns(): Promise<readonly TurnResult[]>;
  runTurn(userPrompt: string, signal: AbortSignal | undefined, onText: (text: string) => void): Promise<TurnResult>;
  close(): Promise<void>;
}
export async function openChatApplication(config: AppConfig, requestedSessionId?: string): Promise<ChatApplication> {
  const session = await SessionStore.open(config.stateDir, requestedSessionId);
  const lock: SessionLock = await session.acquireLock();
  try {
    const provider = createModelProvider(config);
    return {
      sessionId: session.metadata.sessionId,
      modelLabel: provider.model,
      recoverInterruptedTurns: () => session.recoverInterruptedTurns(),
      runTurn: (userPrompt, signal, onText) => runTurn({ session, provider, config, userPrompt, signal, onText }),
      close: () => lock.release(),
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}
