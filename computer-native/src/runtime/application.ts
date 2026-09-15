import type { AppConfig } from "../config/config.js";
import { createModelProvider } from "../models/factory.js";
import { SessionStore } from "../persistence/session-store.js";
import { ToolRegistry } from "../tools/registry.js";
import { Workspace } from "../workspace/workspace.js";
import type { SessionLock } from "../persistence/lock.js";
import type { TranscriptMessage, TurnEvent, TurnResult } from "./contracts.js";
import { runTurn } from "./turn.js";

export interface ChatApplication {
  readonly sessionId: string;
  readonly modelLabel: string;
  readonly providerLabel: string;
  readonly workspaceRoot: string;
  readonly evidenceDirectory: string;
  recoverInterruptedTurns(): Promise<readonly TurnResult[]>;
  readTranscript(): Promise<readonly TranscriptMessage[]>;
  runTurn(userPrompt: string, signal: AbortSignal | undefined, onText?: (text: string) => void, onEvent?: (event: TurnEvent) => void): Promise<TurnResult>;
  close(): Promise<void>;
}
export async function openChatApplication(config: AppConfig, requestedSessionId?: string): Promise<ChatApplication> {
  const session = await SessionStore.open(config.stateDir, requestedSessionId);
  const lock: SessionLock = await session.acquireLock();
  try {
    const provider = createModelProvider(config);
    const workspace = await Workspace.open(config.workspaceRoot, {
      maxFileBytes: config.maxFileBytes,
      maxDirectoryEntries: config.maxDirectoryEntries,
    });
    const tools = new ToolRegistry(workspace, config.maxToolOutputBytes);
    return {
      sessionId: session.metadata.sessionId,
      modelLabel: provider.model,
      providerLabel: provider.model.startsWith(`${provider.provider}/`) ? provider.model : `${provider.provider}/${provider.model}`,
      workspaceRoot: config.workspaceRoot,
      evidenceDirectory: session.sessionDirectory,
      recoverInterruptedTurns: () => session.recoverInterruptedTurns(),
      readTranscript: () => session.readTranscript(),
      runTurn: (userPrompt, signal, onText, onEvent) => runTurn({ session, provider, tools, config, userPrompt, signal, onText, onEvent }),
      close: () => lock.release(),
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}
