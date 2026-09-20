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
import type { ContextSnapshot } from "../context/context.js";
import type { MutationApproval, MutationEvent } from "../workspace/mutation.js";
import type { ProcessToolEvent } from "../tools/registry.js";
import type { BrowserToolEvent } from "../tools/registry.js";
import type { ComputerEvent } from "../computer/runner.js";
import type { ComputerApprovalDecision, ComputerApprovalEvent, ComputerApprovalRequest, ComputerEnvironmentKind, ComputerEnvironmentReadiness } from "../computer/contracts.js";
import type { ComputerStrategy } from "../computer/runner.js";
import { CuaEnvironment, inspectCuaReadiness } from "../computer/cua-driver.js";
import { ComputerArtifactStore } from "../computer/artifacts.js";
import type { ComputerRunSummary } from "../computer/inspection.js";
import type { MemoryApproval, MemoryEvent, MemorySearchEvidence, MemoryStatus } from "../memory/contracts.js";
import { MemoryStore, type MemoryEvidenceMaintenanceResult } from "../memory/store.js";
import { SkillRegistry, type SkillCatalog } from "../skills/index.js";
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
  readonly computer: ComputerUiStatus;
  readonly readMemoryStatus?: () => Promise<MemoryStatus>;
  readonly readContextSnapshot: () => Promise<ContextSnapshot | undefined>;
  readonly maintainMemoryEvidence?: () => Promise<MemoryEvidenceMaintenanceResult>;
  readonly readSkills?: () => Promise<SkillCatalog>;
  readonly readComputerRuns?: () => Promise<readonly ComputerRunSummary[]>;
  recoverInterruptedTurns(): Promise<readonly TurnResult[]>;
  readTranscript(): Promise<readonly TranscriptMessage[]>;
  runTurn(userPrompt: string, signal: AbortSignal | undefined, onText?: (text: string) => void, onEvent?: (event: TurnEvent) => void, approveMutation?: MutationApproval, onMutation?: (event: MutationEvent) => void, approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>, onProcess?: (event: ProcessToolEvent) => void, approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>, onBrowser?: (event: BrowserToolEvent) => void, approveMemory?: MemoryApproval, onMemory?: (event: MemoryEvent) => void, onMemorySearch?: (evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">) => void, onComputer?: (event: ComputerEvent) => void, approveComputer?: (request: ComputerApprovalRequest, signal?: AbortSignal) => Promise<ComputerApprovalDecision>, onComputerApproval?: (event: ComputerApprovalEvent) => void): Promise<TurnResult>;
  close(): Promise<void>;
}

export interface ComputerUiStatus {
  readonly enabled: boolean;
  readonly environment?: ComputerEnvironmentKind;
  readonly strategy?: ComputerStrategy;
  readonly model?: string;
  readonly isolated?: boolean;
  readonly visible?: boolean;
  readonly readiness?: ComputerEnvironmentReadiness;
}
export async function openChatApplication(config: AppConfig, requestedSessionId?: string): Promise<ChatApplication> {
  const session = await SessionStore.open(config.stateDir, requestedSessionId, {
    redactionSecrets: [config.openRouterApiKey ?? "", config.computerOpenRouterApiKey ?? "", config.typeSafeApiKey ?? ""].filter(Boolean),
  });
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
      maxPatchSetBytes: config.maxPatchSetBytes,
    });
    const skills = new SkillRegistry(workspace, config.maxToolOutputBytes);
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
      headless: config.computerEnabled && config.computerEnvironment === "browser" ? !config.computerBrowserVisible : true,
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
    await session.cleanupComputerRuns({
      maxAgeMs: config.computerRunRetentionMs,
      maxEntries: config.computerCleanupMaxEntries,
    });
    const computerArtifacts = new ComputerArtifactStore(path.join(config.stateDir, "computer-artifacts"), {
      maxBytes: config.computerArtifactMaxBytes,
      maxWidth: config.computerArtifactMaxWidth,
      maxHeight: config.computerArtifactMaxHeight,
    });
    await computerArtifacts.cleanupExpired({
      maxAgeMs: config.computerArtifactRetentionMs,
      maxEntries: config.computerArtifactCleanupMaxEntries,
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
          redactionSecrets: [config.openRouterApiKey ?? "", config.computerOpenRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "", config.typeSafeApiKey ?? process.env.TYPESAFE_API_KEY ?? ""].filter(Boolean),
        }
      : undefined;
    const computerToolOptions = !config.computerEnabled
      ? undefined
      : config.computerEnvironment === "browser" && browserToolOptions
        ? {
            environment: "browser" as const,
            browser: browserToolOptions,
            strategy: config.computerStrategy,
            openRouterApiKey: config.computerOpenRouterApiKey,
            traditionalModel: config.computerTraditionalModel,
            traditionalVision: config.computerTraditionalVision,
            typeSafeApiKey: config.typeSafeApiKey,
            typeSafeModel: config.computerTypesafeModel,
            maxActions: config.computerMaxActions,
          }
        : config.computerEnvironment === "ubuntu-x11-cua"
          ? {
              environment: "ubuntu-x11-cua" as const,
              strategy: config.computerStrategy,
              openRouterApiKey: config.computerOpenRouterApiKey,
              traditionalModel: config.computerTraditionalModel,
              typeSafeApiKey: config.typeSafeApiKey,
              typeSafeModel: config.computerTypesafeModel,
              maxActions: config.computerMaxActions,
              native: {
                displayId: config.computerCuaDisplayId,
                artifactDirectory: path.join(config.stateDir, "computer-artifacts"),
                artifactStore: computerArtifacts,
                captureArtifacts: config.computerArtifactsEnabled,
                strategy: config.computerStrategy,
                openRouterApiKey: config.computerOpenRouterApiKey,
                traditionalModel: config.computerTraditionalModel,
                traditionalVision: config.computerTraditionalVision,
                typeSafeApiKey: config.typeSafeApiKey,
                typeSafeModel: config.computerTypesafeModel,
                maxActions: config.computerMaxActions,
                maxOutputBytes: config.maxToolOutputBytes,
                createEnvironment: (screenshotPath: string) => new CuaEnvironment({
                  screenshotPath,
                  // Both native strategies receive the exact foreground-window frame
                  // whose coordinates CUA will dispatch. Desktop capture remains an
                  // explicit adapter capability, not an implicit coordinate transform.
                  captureScope: "window",
                  displayId: config.computerCuaDisplayId,
                  environment: { ...process.env, ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: config.computerCuaIsolatedDisplay ? "true" : "false" },
                }),
              },
            }
          : undefined;
    const tools = new ToolRegistry(
      workspace,
      config.maxToolOutputBytes,
      processPolicy ? { policy: processPolicy, runner: new LocalProcessRunner((prepared) => processPolicy.verify(prepared)), redactionSecrets: config.openRouterApiKey ? [config.openRouterApiKey] : [] } : undefined,
      browserToolOptions,
      memory ? { store: memory, maxResults: config.memoryMaxResults, maxBootstrapChars: config.memoryBootstrapMaxChars } : undefined,
      { registry: skills },
      computerToolOptions,
    );
    const activeMemory = memory;
    const computer: ComputerUiStatus = !config.computerEnabled
      ? { enabled: false }
      : config.computerEnvironment === "ubuntu-x11-cua"
        ? {
            enabled: true,
            environment: config.computerEnvironment,
            strategy: config.computerStrategy,
            model: config.computerStrategy === "typesafe" ? config.computerTypesafeModel : config.computerTraditionalModel,
            isolated: config.computerCuaIsolatedDisplay,
            readiness: inspectCuaReadiness({
              environment: { ...process.env, ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: config.computerCuaIsolatedDisplay ? "true" : "false" },
            }),
          }
        : {
            enabled: true,
            environment: config.computerEnvironment,
            strategy: config.computerStrategy,
            model: config.computerStrategy === "typesafe" ? config.computerTypesafeModel : config.computerTraditionalModel,
            visible: config.computerBrowserVisible,
            readiness: { kind: "browser", available: true, isolated: false },
          };
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
      computer,
      readMemoryStatus: activeMemory ? () => activeMemory.status() : undefined,
      readContextSnapshot: () => session.readLatestContextSnapshot(),
      maintainMemoryEvidence: activeMemory ? () => activeMemory.maintainEvidence() : undefined,
      readSkills: () => skills.list(),
      readComputerRuns: () => session.readComputerRunSummaries({ limit: 20 }),
      recoverInterruptedTurns: () => session.recoverInterruptedTurns((record) => workspace.reconcileMutation(record), reconcileRunningProcess, activeMemory ? (record) => activeMemory.reconcileAction(record) : undefined),
      readTranscript: () => session.readTranscript(),
      runTurn: (userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch, onComputer, approveComputer, onComputerApproval) => runTurn({ session, provider, tools, memory: activeMemory, config, userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveComputer, onComputerApproval, approveMemory, onMemory, onMemorySearch, onComputer }),
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
