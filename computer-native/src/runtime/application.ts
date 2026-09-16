import path from "node:path";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import type { AppConfig } from "../config/config.js";
import { acquireBrowserProfileLease, BrowserArtifactStore, BrowserFilePolicy, BrowserSessionManager, BrowserUrlPolicy, PlaywrightBrowserAdapter, cleanupOrphanedBrowserProfiles, type BrowserApprovalDecision, type BrowserApprovalRequest } from "../browser/index.js";
import { createModelProvider } from "../models/factory.js";
import { listModelProviderSummaries, type ModelProviderSummary } from "../models/registry.js";
import { SessionStore } from "../persistence/session-store.js";
import { ToolRegistry } from "../tools/registry.js";
import { LocalProcessRunner } from "../process/local-runner.js";
import { reconcileRunningProcess } from "../process/recovery.js";
import { ProcessSecurityPolicy } from "../security/process-policy.js";
import type { ProcessApprovalDecision, ProcessApprovalRequest } from "../process/process.js";
import { Workspace } from "../workspace/workspace.js";
import type { SessionLock } from "../persistence/lock.js";
import type { ProviderName, TranscriptMessage, TurnEvent, TurnResult } from "./contracts.js";
import type { MutationApproval, MutationEvent } from "../workspace/mutation.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserToolEvent } from "../tools/registry.js";
import type { MemoryApproval, MemoryEvent, MemorySearchEvidence, MemoryStatus } from "../memory/contracts.js";
import { MemoryStore, type MemoryEvidenceMaintenanceResult } from "../memory/store.js";
import { runTurn } from "./turn.js";

export interface ChatApplication {
  readonly sessionId: string;
  readonly modelLabel: string;
  readonly providerLabel: string;
  readonly providerName: ProviderName;
  readonly modelCapabilities?: ModelProviderSummary["capabilities"];
  readonly availableProviders?: readonly ModelProviderSummary[];
  readonly workspaceRoot: string;
  readonly evidenceDirectory: string;
  readonly toolNames: readonly string[];
  readonly readMemoryStatus?: () => Promise<MemoryStatus>;
  readonly maintainMemoryEvidence?: () => Promise<MemoryEvidenceMaintenanceResult>;
  recoverInterruptedTurns(): Promise<readonly TurnResult[]>;
  readTranscript(): Promise<readonly TranscriptMessage[]>;
  runTurn(userPrompt: string, signal: AbortSignal | undefined, onText?: (text: string) => void, onEvent?: (event: TurnEvent) => void, approveMutation?: MutationApproval, onMutation?: (event: MutationEvent) => void, approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>, onProcess?: (event: ProcessToolEvent) => void, approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>, onBrowser?: (event: BrowserToolEvent) => void, approveMemory?: MemoryApproval, onMemory?: (event: MemoryEvent) => void, onMemorySearch?: (evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">) => void): Promise<TurnResult>;
  close(): Promise<void>;
}
export async function openChatApplication(config: AppConfig, requestedSessionId?: string): Promise<ChatApplication> {
  const session = await SessionStore.open(config.stateDir, requestedSessionId);
  const lock: SessionLock = await session.acquireLock();
  let memory: MemoryStore | undefined;
  try {
    const provider = createModelProvider(config);
    const workspace = await Workspace.open(config.workspaceRoot, {
      maxFileBytes: config.maxFileBytes,
      maxDirectoryEntries: config.maxDirectoryEntries,
      maxTreeEntries: config.maxTreeEntries,
      maxTreeBytes: config.maxTreeBytes,
      maxTreeDepth: config.maxTreeDepth,
    });
    memory = config.memoryEnabled
      ? await MemoryStore.open({
          stateDir: config.stateDir,
          profileId: session.metadata.profileId,
          workspaceId: createHash("sha256").update(config.workspaceRoot, "utf8").digest("hex").slice(0, 32),
          userMaxChars: config.memoryUserMaxChars,
          workspaceMaxChars: config.memoryWorkspaceMaxChars,
          dailyMaxChars: config.memoryDailyMaxChars,
          dailyRetentionDays: config.memoryDailyRetentionDays,
          evidenceRetentionDays: config.memoryEvidenceRetentionDays,
          evidenceMaxEntries: config.memoryEvidenceMaxEntries,
        })
      : undefined;
    const processPolicy = config.processMode === "approval"
      ? new ProcessSecurityPolicy({
          workspace: workspace.policy,
          limits: {
            timeoutMs: config.processDurationMs,
            terminationGraceMs: config.processTerminationGraceMs,
            maxOutputBytes: config.processOutputBytes,
            maxArgumentCount: config.processArgumentCount,
            maxArgumentBytes: config.processArgumentBytes,
          },
        })
      : undefined;
    const browserUrlPolicy = new BrowserUrlPolicy({ allowedLocalHosts: config.browserAllowedLocalHosts });
    const browserAdapter = new PlaywrightBrowserAdapter({
      actionTimeoutMs: config.browserActionTimeoutMs,
      snapshotMaxChars: config.browserSnapshotMaxChars,
      maxSnapshotReferences: config.browserMaxSnapshotReferences,
      urlPolicy: browserUrlPolicy,
    });
    const browserArtifacts = new BrowserArtifactStore(path.join(config.stateDir, "browser-artifacts"), {
      maxScreenshotBytes: config.browserScreenshotMaxBytes,
      maxScreenshotWidth: config.browserScreenshotMaxWidth,
      maxScreenshotHeight: config.browserScreenshotMaxHeight,
      maxDownloadBytes: config.browserDownloadMaxBytes,
    });
    await cleanupOrphanedBrowserProfiles(path.join(config.stateDir, "browser-profiles"), {
      maxAgeMs: config.browserProfileRetentionMs,
      maxEntries: config.browserCleanupMaxEntries,
    });
    await browserArtifacts.cleanupExpired({
      maxAgeMs: config.browserArtifactRetentionMs,
      maxEntries: config.browserCleanupMaxEntries,
    });
    const browserSessions = new BrowserSessionManager(browserAdapter, {
      maxTabs: config.browserMaxTabs,
      readOnlyRetryCount: config.browserReadRetryCount,
      readOnlyTimeoutMs: config.browserActionTimeoutMs,
      sessionTimeoutMs: config.browserSessionTimeoutMs,
      profileDirectory: (sessionId) => path.join(config.stateDir, "browser-profiles", sessionId),
      acquireProfileLease: acquireBrowserProfileLease,
      cleanupProfile: async (profileDirectory) => {
        const profileRoot = path.resolve(config.stateDir, "browser-profiles");
        const target = path.resolve(profileDirectory);
        if (!target.startsWith(`${profileRoot}${path.sep}`)) {
          throw new Error("Browser profile cleanup target escaped the managed profile root.");
        }
        await rm(target, { recursive: true, force: true });
      },
      artifactStore: browserArtifacts,
      urlPolicy: browserUrlPolicy,
    });
    const browserFilePolicy = config.browserEnabled
      ? new BrowserFilePolicy(workspace.policy, { maxUploadBytes: config.browserUploadMaxBytes })
      : undefined;
    const browserToolOptions = config.browserEnabled && browserFilePolicy
      ? {
          manager: browserSessions,
          maxOutputBytes: config.maxToolOutputBytes,
          maxWaitMs: config.browserWaitMaxMs,
          resolveUpload: browserFilePolicy.resolveUpload.bind(browserFilePolicy),
          redactionSecrets: [config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? ""],
        }
      : undefined;
    const tools = new ToolRegistry(
      workspace,
      config.maxToolOutputBytes,
      processPolicy ? { policy: processPolicy, runner: new LocalProcessRunner((prepared) => processPolicy.verify(prepared)), redactionSecrets: config.openRouterApiKey ? [config.openRouterApiKey] : [] } : undefined,
      browserToolOptions,
      memory ? { store: memory, maxResults: config.memoryMaxResults, maxBootstrapChars: config.memoryBootstrapMaxChars } : undefined,
    );
    const activeMemory = memory;
    return {
      sessionId: session.metadata.sessionId,
      modelLabel: provider.model,
      providerLabel: provider.model.startsWith(`${provider.provider}/`) ? provider.model : `${provider.provider}/${provider.model}`,
      providerName: provider.provider,
      modelCapabilities: provider.capabilities,
      availableProviders: listModelProviderSummaries(),
      workspaceRoot: config.workspaceRoot,
      evidenceDirectory: session.sessionDirectory,
      toolNames: tools.definitions.map((definition) => definition.name),
      readMemoryStatus: activeMemory ? () => activeMemory.status() : undefined,
      maintainMemoryEvidence: activeMemory ? () => activeMemory.maintainEvidence() : undefined,
      recoverInterruptedTurns: () => session.recoverInterruptedTurns((record) => workspace.reconcileMutation(record), reconcileRunningProcess, activeMemory ? (record) => activeMemory.reconcileAction(record) : undefined),
      readTranscript: () => session.readTranscript(),
      runTurn: (userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch) => runTurn({ session, provider, tools, memory: activeMemory, config, userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch }),
      close: async () => {
        try {
          await browserSessions.closeAll();
        } finally {
          await activeMemory?.close();
          await lock.release();
        }
      },
    };
  } catch (error) {
    try {
      await memory?.close();
    } finally {
      await lock.release();
    }
    throw error;
  }
}
