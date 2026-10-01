import path from "node:path";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config/config.js";
import { BrowserArtifactStore, BrowserFilePolicy, BrowserSessionManager, BrowserUrlPolicy, CuaBrowserAdapter, DEFAULT_CUA_BROWSER_ORIGINS, cleanupOrphanedBrowserProfiles, createCuaBrowserManifest, type BrowserApprovalDecision, type BrowserApprovalRequest, type BrowserInputRoute } from "../browser/index.js";
import { installedCuaSupportsBrowserSelectOption } from "../browser/cua-manifest.js";
import { createModelProvider } from "../models/factory.js";
import { listModelProviderSummaries, type ModelProviderSummary } from "../models/registry.js";
import { SessionStore } from "../persistence/session-store.js";
import { ProcessApprovalPermissions } from "../persistence/process-approval-permissions.js";
import { ComputerApprovalPermissions } from "../persistence/computer-approval-permissions.js";
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
import type { ComputerTaskApprovalDecision, ComputerTaskApprovalRequest } from "../computer/task.js";
import type { CuaAuthorizationCallback } from "../browser/cua-authorization.js";
import type { ComputerStrategyPolicy, ComputerSurfacePolicy } from "../computer/routing.js";
import type { ComputerRunExclusive } from "../computer/router.js";
import { CuaEnvironment, CuaNativeDriverOwner, inspectCuaReadiness } from "../computer/cua-driver.js";
import { createCuaNativeManifest } from "../computer/cua-manifest.js";
import { createTypeSafeModelPreflight } from "../computer/typesafe-preflight.js";
import { ComputerArtifactStore } from "../computer/artifacts.js";
import type { ComputerRunSummary } from "../computer/inspection.js";
import { NATIVE_APPLICATION_CATALOG, type NativeApplicationRequest } from "../computer/native-runner.js";
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
  readonly processPermissions?: ProcessApprovalPermissions;
  readonly computerPermissions?: ComputerApprovalPermissions;
  readonly toolNames: readonly string[];
  readonly computer: ComputerUiStatus;
  readonly readMemoryStatus?: () => Promise<MemoryStatus>;
  readonly readContextSnapshot: () => Promise<ContextSnapshot | undefined>;
  readonly maintainMemoryEvidence?: () => Promise<MemoryEvidenceMaintenanceResult>;
  readonly readSkills?: () => Promise<SkillCatalog>;
  readonly readComputerRuns?: () => Promise<readonly ComputerRunSummary[]>;
  recoverInterruptedTurns(): Promise<readonly TurnResult[]>;
  readTranscript(): Promise<readonly TranscriptMessage[]>;
  runTurn(userPrompt: string, signal: AbortSignal | undefined, onText?: (text: string) => void, onEvent?: (event: TurnEvent) => void, approveMutation?: MutationApproval, onMutation?: (event: MutationEvent) => void, approveProcess?: (request: ProcessApprovalRequest, signal?: AbortSignal) => Promise<ProcessApprovalDecision>, onProcess?: (event: ProcessToolEvent) => void, approveBrowser?: (request: BrowserApprovalRequest, signal?: AbortSignal) => Promise<BrowserApprovalDecision>, onBrowser?: (event: BrowserToolEvent) => void, approveMemory?: MemoryApproval, onMemory?: (event: MemoryEvent) => void, onMemorySearch?: (evidence: Omit<MemorySearchEvidence, "sessionId" | "turnId" | "recordedAt">) => void, onComputer?: (event: ComputerEvent) => void, approveComputer?: (request: ComputerApprovalRequest, signal?: AbortSignal) => Promise<ComputerApprovalDecision>, onComputerApproval?: (event: ComputerApprovalEvent) => void, approveComputerTask?: (request: ComputerTaskApprovalRequest, signal?: AbortSignal) => Promise<ComputerTaskApprovalDecision>, authorizeExistingProfile?: CuaAuthorizationCallback): Promise<TurnResult>;
  close(): Promise<void>;
}

export interface ComputerUiStatus {
  readonly enabled: boolean;
  readonly environment?: ComputerEnvironmentKind;
  readonly surface?: ComputerSurfacePolicy;
  readonly strategy?: ComputerStrategyPolicy;
  readonly model?: string;
  readonly browserInputRoute?: BrowserInputRoute;
  readonly isolated?: boolean;
  readonly visible?: boolean;
  /** Code-owned native identities admitted by the current task compiler. */
  readonly nativeCatalog?: readonly string[];
  readonly readiness?: ComputerEnvironmentReadiness;
}

function createComputerRunQueue(): ComputerRunExclusive {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export async function openChatApplication(config: AppConfig, requestedSessionId?: string): Promise<ChatApplication> {
  const session = await SessionStore.open(config.stateDir, requestedSessionId, {
    redactionSecrets: [config.openRouterApiKey ?? "", config.computerOpenRouterApiKey ?? "", config.typeSafeApiKey ?? ""].filter(Boolean),
  });
  const lock: SessionLock = await session.acquireLock();
  const processPermissions = new ProcessApprovalPermissions(
    config.stateDir,
    session.sessionDirectory,
    session.metadata.sessionId,
    session.metadata.profileId,
  );
  const computerPermissions = new ComputerApprovalPermissions(session.sessionDirectory, session.metadata.sessionId);
  let memory: MemoryStore | undefined;
  let nativeCuaOwner: CuaNativeDriverOwner | undefined;
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
    const typeSafePreflight = config.computerEnabled
      ? createTypeSafeModelPreflight({ apiKey: config.typeSafeApiKey, model: config.computerTypesafeModel })
      : undefined;
    const browserInputRoute: BrowserInputRoute = config.computerBrowserInputRoute;
    // BrowserTools and the native Cua application window are application-owned
    // state. Serialize complete task lifecycles so approval, references,
    // process/window binding, and cleanup cannot interleave across turns.
    const browserRunExclusive = createComputerRunQueue();
    const nativeRunExclusive = createComputerRunQueue();
    const computerRunExclusive = createComputerRunQueue();
    const browserSessionRoot = createHash("sha256").update(session.metadata.sessionId, "utf8").digest("hex").slice(0, 32);
    const selectOptionAvailable = config.browserEnabled
      ? await installedCuaSupportsBrowserSelectOption()
      : false;
    const browserManifest = await createCuaBrowserManifest({
      basePath: path.join(process.cwd(), "config", "cua-browser-capabilities.yaml"),
      outputPath: path.join(config.stateDir, "cua", `browser-capabilities-${browserSessionRoot}.yaml`),
      uploadRoot: path.join(config.stateDir, "cua", "browser-uploads", browserSessionRoot),
      existingProfileEnabled: config.computerExistingProfileEnabled,
      selectOptionAvailable,
    });
    const browserAdapter = new CuaBrowserAdapter({
      manifestPath: browserManifest.manifestPath,
      uploadStagingRoot: browserManifest.uploadRoot,
      allowedOrigins: DEFAULT_CUA_BROWSER_ORIGINS,
      maxSnapshotChars: config.browserSnapshotMaxChars,
      inputRoute: browserInputRoute,
      urlPolicy: browserUrlPolicy,
    });
    // Cua owns live browser profiles. This cleanup only removes orphaned state
    // left by older managed-browser runs and never supplies a profile to Cua.
    const browserArtifacts = new BrowserArtifactStore(path.join(config.stateDir, "browser-artifacts"));
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
    const nativeManifest = config.computerEnabled && config.computerEnvironment === "ubuntu-x11-cua"
      ? await createCuaNativeManifest({
          basePath: path.join(process.cwd(), "config", "cua-native-capabilities.yaml"),
          outputPath: path.join(config.stateDir, "cua", `native-capabilities-${browserSessionRoot}.yaml`),
          screenshotRoot: path.join(config.stateDir, "computer-artifacts", ".scratch"),
        })
      : undefined;
    const nativeCuaDriver = config.computerEnabled && config.computerEnvironment === "ubuntu-x11-cua"
      ? (() => {
          nativeCuaOwner = new CuaNativeDriverOwner({
            manifestPath: nativeManifest!.manifestPath,
          });
          return nativeCuaOwner.acquire();
        })()
      : undefined;
    const sharedNativeCuaDriver = nativeCuaDriver ? await nativeCuaDriver : undefined;
    const browserSessions = new BrowserSessionManager(browserAdapter, {
      maxTabs: config.browserMaxTabs,
      readOnlyRetryCount: config.browserReadRetryCount,
      readOnlyTimeoutMs: config.browserActionTimeoutMs,
      sessionTimeoutMs: config.browserSessionTimeoutMs,
      urlPolicy: browserUrlPolicy,
    });
    const browserFilePolicy = config.browserEnabled
      ? new BrowserFilePolicy(workspace.policy, { maxUploadBytes: config.browserUploadMaxBytes })
      : undefined;
    const browserToolOptions = config.browserEnabled && browserFilePolicy
      ? {
          manager: browserSessions,
          maxOutputBytes: config.maxToolOutputBytes,
          selectOptionAvailable,
          maxWaitMs: config.browserWaitMaxMs,
          inputRoute: browserInputRoute,
          searchProvider: config.browserSearchProvider,
          ...(config.typeSafeApiKey ? { jev: { apiKey: config.typeSafeApiKey, model: config.computerTypesafeModel } } : {}),
          runtimeEvidence: () => browserAdapter.runtimeEvidence(),
          resolveUpload: browserFilePolicy.resolveUpload.bind(browserFilePolicy),
          redactionSecrets: [config.openRouterApiKey ?? "", config.computerOpenRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "", config.typeSafeApiKey ?? process.env.TYPESAFE_API_KEY ?? ""].filter(Boolean),
        }
      : undefined;
    let browserReadiness: ComputerEnvironmentReadiness = {
      kind: "browser",
      available: false,
      isolated: true,
      reason: "Browser Cua readiness has not been proven.",
    };
    if (config.computerEnabled && config.computerSurface !== "desktop" && browserToolOptions !== undefined) {
      try {
        await browserAdapter.preflight();
        browserReadiness = { kind: "browser", available: true, isolated: true };
      } catch (error) {
        browserReadiness = {
          kind: "browser",
          available: false,
          isolated: true,
          reason: error instanceof Error ? error.message.slice(0, 256) : "Browser Cua readiness failed.",
        };
      }
    }
    const computerToolOptions = !config.computerEnabled
      ? undefined
      : config.computerEnvironment === "browser" && browserToolOptions
        ? {
            environment: "browser" as const,
            surface: config.computerSurface,
            browser: browserToolOptions,
            strategy: config.computerStrategy,
            openRouterApiKey: config.computerOpenRouterApiKey,
            traditionalModel: config.computerTraditionalModel,
            traditionalVision: config.computerTraditionalVision,
            typeSafeApiKey: config.typeSafeApiKey,
            typeSafeModel: config.computerTypesafeModel,
            existingProfileEnabled: config.computerExistingProfileEnabled,
            maxActions: config.computerMaxActions,
            taskDeadlineMs: config.computerTaskDurationMs,
            browserInputRoute: config.computerBrowserInputRoute,
            browserAllowedOrigins: DEFAULT_CUA_BROWSER_ORIGINS,
            browserPreflight: () => browserAdapter.preflight(),
            typeSafePreflight,
            browserRunExclusive,
            computerRunExclusive,
          }
        : config.computerEnvironment === "ubuntu-x11-cua"
          ? {
              environment: "ubuntu-x11-cua" as const,
              surface: config.computerSurface,
              browser: browserToolOptions,
              strategy: config.computerStrategy,
              openRouterApiKey: config.computerOpenRouterApiKey,
              traditionalModel: config.computerTraditionalModel,
              typeSafeApiKey: config.typeSafeApiKey,
              typeSafeModel: config.computerTypesafeModel,
              existingProfileEnabled: config.computerExistingProfileEnabled,
              maxActions: config.computerMaxActions,
              taskDeadlineMs: config.computerTaskDurationMs,
              browserInputRoute: config.computerBrowserInputRoute,
              browserAllowedOrigins: DEFAULT_CUA_BROWSER_ORIGINS,
              browserPreflight: () => browserAdapter.preflight(),
              nativePreflight: nativeCuaOwner ? () => nativeCuaOwner!.preflight() : undefined,
              typeSafePreflight,
              browserRunExclusive,
              nativeRunExclusive,
              computerRunExclusive,
              native: {
                displayId: config.computerCuaDisplayId,
                artifactDirectory: path.join(config.stateDir, "computer-artifacts"),
                artifactStore: computerArtifacts,
                captureArtifacts: config.computerArtifactsEnabled,
                openRouterApiKey: config.computerOpenRouterApiKey,
                traditionalModel: config.computerTraditionalModel,
                traditionalVision: config.computerTraditionalVision,
                typeSafeApiKey: config.typeSafeApiKey,
                typeSafeModel: config.computerTypesafeModel,
                maxActions: config.computerMaxActions,
                maxOutputBytes: config.maxToolOutputBytes,
                runtimeEvidence: () => nativeCuaOwner?.runtimeEvidence(),
                createEnvironment: (screenshotPath: string, application?: NativeApplicationRequest) => new CuaEnvironment({
                  screenshotPath,
                  application: application ? { name: application.name, launchPath: application.launchPath } : undefined,
                  manifestPath: nativeManifest!.manifestPath,
                  driver: sharedNativeCuaDriver,
                  shutdownDriver: false,
                  loadSdk: nativeCuaOwner ? () => nativeCuaOwner!.loadSdk() : undefined,
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
            surface: config.computerSurface,
            strategy: config.computerStrategy,
            browserInputRoute: config.computerBrowserInputRoute,
            model: config.computerStrategy === "typesafe"
              ? config.computerTypesafeModel
              : config.computerStrategy === "traditional"
                ? config.computerTraditionalModel
                : config.computerStrategy === "compare"
                  ? `${config.computerTraditionalModel} + ${config.computerTypesafeModel}`
                  : `auto · ${config.computerTypesafeModel} + ${config.computerTraditionalModel}`,
            isolated: config.computerCuaIsolatedDisplay,
            nativeCatalog: NATIVE_APPLICATION_CATALOG.map((application) => application.name),
            readiness: inspectCuaReadiness({
              environment: { ...process.env, ANESU_COMPUTER_CUA_ISOLATED_DISPLAY: config.computerCuaIsolatedDisplay ? "true" : "false" },
            }),
          }
        : {
            enabled: true,
            environment: config.computerEnvironment,
            strategy: config.computerStrategy,
            surface: config.computerSurface,
            browserInputRoute: config.computerBrowserInputRoute,
            model: config.computerStrategy === "typesafe"
              ? config.computerTypesafeModel
              : config.computerStrategy === "traditional"
                ? config.computerTraditionalModel
                : config.computerStrategy === "compare"
                  ? `${config.computerTraditionalModel} + ${config.computerTypesafeModel}`
                  : `auto · ${config.computerTypesafeModel} + ${config.computerTraditionalModel}`,
            visible: config.computerBrowserVisible,
            readiness: browserReadiness,
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
      processPermissions,
      computerPermissions,
      toolNames: tools.definitions.map((definition) => definition.name),
      computer,
      readMemoryStatus: activeMemory ? () => activeMemory.status() : undefined,
      readContextSnapshot: () => session.readLatestContextSnapshot(),
      maintainMemoryEvidence: activeMemory ? () => activeMemory.maintainEvidence() : undefined,
      readSkills: () => skills.list(),
      readComputerRuns: () => session.readComputerRunSummaries({ limit: 20 }),
      recoverInterruptedTurns: () => session.recoverInterruptedTurns((record) => workspace.reconcileMutation(record), reconcileRunningProcess, activeMemory ? (record) => activeMemory.reconcileAction(record) : undefined),
      readTranscript: () => session.readTranscript(),
      runTurn: (userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveMemory, onMemory, onMemorySearch, onComputer, approveComputer, onComputerApproval, approveComputerTask, authorizeExistingProfile) => runTurn({ session, provider, tools, memory: activeMemory, config, userPrompt, signal, onText, onEvent, approveMutation, onMutation, approveProcess, onProcess, approveBrowser, onBrowser, approveComputer, onComputerApproval, approveComputerTask, authorizeExistingProfile, approveMemory, onMemory, onMemorySearch, onComputer }),
      close: async () => {
        let firstError: unknown;
        try {
          await browserSessions.closeAll();
        } catch (error) {
          firstError ??= error;
        }
        try {
          await browserAdapter.shutdown();
        } catch (error) {
          firstError ??= error;
        }
        try {
          await nativeCuaOwner?.shutdown();
        } catch (error) {
          firstError ??= error;
        }
        try {
          await activeMemory?.close();
        } catch (error) {
          firstError ??= error;
        }
        try {
          await lock.release();
        } catch (error) {
          firstError ??= error;
        }
        if (firstError) throw firstError;
      },
    };
  } catch (error) {
    try {
      await memory?.close();
    } finally {
      try {
        await nativeCuaOwner?.shutdown();
      } finally {
        await lock.release();
      }
    }
    throw error;
  }
}
