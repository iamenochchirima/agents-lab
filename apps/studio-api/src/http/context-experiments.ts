import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRunId, createSessionId, createTurnId } from "@agent-harness-lab/agent-protocol";
import { TextTurnExecutionError, type PlanningRunEvidence, type TextTurnObservabilityResult } from "@agent-harness-lab/agent-kernel";
import { ContextAssemblyError, type ContextMaterial } from "@agent-harness-lab/module-context";
import type { MemorySession } from "@agent-harness-lab/module-memory";
import type { OutputActionSink } from "@agent-harness-lab/module-output-actions";
import { createCalculatorAddRegistration, createComputerClickRegistration } from "@agent-harness-lab/module-tool-use";
import {
  createReferenceAgent,
  createReferenceAssemblyDescriptor,
  type ReferenceAgent,
  type ReferenceChatAssembly,
} from "@agent-harness-lab/reference-agent-assembly";
import {
  OLD_IMPORTANT_FACT_FIXTURE,
  OLD_IMPORTANT_FACT_FIXTURE_ID,
  OLD_IMPORTANT_FACT_FIXTURE_VERSION,
  OLD_IMPORTANT_FACT_PRIOR_MESSAGES,
  OLD_IMPORTANT_FACT_TASK,
  OLD_IMPORTANT_FACT_TASK_ID,
  CONTEXT_STRESS_SCENARIO_ID,
} from "@agent-harness-lab/scenario-context-stress";
import {
  STUDIO_CHAT_API_VERSION,
  STUDIO_CONTEXT_EXPERIMENT_API_VERSION,
  STUDIO_CONTEXT_EXPERIMENT_CASE_ID,
  STUDIO_CONTEXT_EXPERIMENT_ID,
  STUDIO_CONTEXT_EXPERIMENT_VERSION,
  STUDIO_CONTEXT_TOKEN_BUDGET,
  STUDIO_CONTEXT_STRATEGY_IDENTITIES,
  isStudioChatAssemblyResponse,
  isStudioChatTurnResponse,
  isStudioContextExperimentError,
  isStudioContextExperimentRequest,
  isStudioContextExperimentResponse,
  type StudioChatAssembly,
  type StudioChatComponentIdentity,
  type StudioChatObservabilityEvidence,
  type StudioChatPlanningEvidence,
  type StudioChatTurnResponse,
  type StudioContextComparisonStatus,
  type StudioContextExperimentError,
  type StudioContextExperimentErrorCode,
  type StudioContextExperimentFailure,
  type StudioContextExperimentRequest,
  type StudioContextExperimentResponse,
  type StudioContextExperimentVariant,
  type StudioContextVariantStatus,
  type StudioJsonValue,
} from "@agent-harness-lab/studio-http-contract";
import type { TextTurnResult } from "@agent-harness-lab/agent-kernel";
import { DEFAULT_STUDIO_RUNS_ROOT } from "../config.js";
import { createRunArtifactStore, type RunArtifactStore } from "./run-artifacts.js";

const API_INSTANCE_ID = randomUUID();
const COMPARISON_PARENT = "context-comparisons";
const COMPARISON_FILE = "comparison.json";
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_RUN_JSON_BYTES = 2 * 1024 * 1024;
const BASELINE_STRATEGY_INDEX = 0 as const;
const WINDOW_STRATEGY_INDEX = 1 as const;

interface StoredVariant {
  readonly strategy: StudioChatComponentIdentity;
  readonly runId: string | null;
  readonly status: StudioContextVariantStatus;
  readonly failure: StudioContextExperimentFailure | null;
}

interface ComparisonManifest {
  readonly schemaVersion: 1;
  readonly comparisonId: string;
  readonly requestFingerprint: string;
  readonly ownerInstanceId: string;
  readonly apiVersion: typeof STUDIO_CONTEXT_EXPERIMENT_API_VERSION;
  readonly experiment: StudioContextExperimentResponse["experiment"];
  readonly case: StudioContextExperimentResponse["case"];
  readonly sharedControls: StudioContextExperimentResponse["sharedControls"];
  readonly changedVariable: StudioContextExperimentResponse["changedVariable"];
  readonly variants: readonly [StoredVariant, StoredVariant];
  readonly status: StudioContextComparisonStatus;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

interface ActiveComparison {
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly callers: Set<object>;
  readonly ready: Promise<void>;
  resolveReady(): void;
  promise: Promise<StudioContextExperimentResponse>;
  settled: boolean;
}

type RunTerminal =
  | { readonly kind: "completed"; readonly response: unknown }
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "missing" }
  | { readonly kind: "unknown" };

export interface StudioContextExperimentVariantRunInput {
  readonly request: StudioContextExperimentRequest;
  readonly strategy: StudioChatComponentIdentity;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly runsRoot: string;
}

/** Internal runner seam for deterministic route-level API checks; production uses the static reference assembly runner. */
export type StudioContextExperimentVariantRunner = (input: StudioContextExperimentVariantRunInput) => Promise<StudioChatTurnResponse>;

class ComparisonPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonPersistenceError";
  }
}

class ComparisonIdReusedError extends Error {
  constructor() {
    super("This comparisonId was already used for a different request.");
    this.name = "ComparisonIdReusedError";
  }
}

class VariantRunFailure extends Error {
  constructor(
    readonly failure: StudioContextExperimentFailure,
    readonly persistenceUnsafe: boolean,
  ) {
    super(failure.message);
    this.name = "VariantRunFailure";
  }
}

/** Owns only comparison manifests; normal run config and result files remain with the run artifact writer. */
class ContextComparisonStore {
  private safeRunsRoot: string | null = null;

  constructor(readonly runsRoot: string) {}

  async prepare(): Promise<void> {
    if (this.safeRunsRoot) return;
    const requestedRoot = resolve(this.runsRoot);
    await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(requestedRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new ComparisonPersistenceError("The configured Studio runs root is not a real directory.");
    const safeRoot = await realpath(requestedRoot);
    const parent = join(safeRoot, COMPARISON_PARENT);
    await mkdir(parent, { mode: 0o700 }).catch((error: unknown) => {
      if (!isErrno(error, "EEXIST")) throw error;
    });
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || (parentInfo.mode & 0o077) !== 0) {
      throw new ComparisonPersistenceError("The comparison store directory is not a private real directory.");
    }
    this.safeRunsRoot = safeRoot;
  }

  get rootDirectory(): string {
    if (!this.safeRunsRoot) throw new ComparisonPersistenceError("The comparison store has not been initialized.");
    return this.safeRunsRoot;
  }

  async create(manifest: ComparisonManifest): Promise<void> {
    await this.prepare();
    if (!isManifest(manifest, manifest.comparisonId)) throw new ComparisonPersistenceError("The initial comparison manifest is invalid.");
    const parent = join(this.rootDirectory, COMPARISON_PARENT);
    const directory = join(parent, manifest.comparisonId);
    await mkdir(directory, { mode: 0o700 });
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
      throw new ComparisonPersistenceError("The new comparison directory is not private and valid.");
    }
    await this.createManifestFile(directory, manifest);
    await syncDirectory(parent);
  }

  async read(comparisonId: string): Promise<ComparisonManifest | null> {
    await this.prepare();
    if (!isUuid(comparisonId)) throw new ComparisonPersistenceError("The comparison ID was invalid at the storage boundary.");
    const directory = this.comparisonDirectory(comparisonId);
    let directoryInfo;
    try {
      directoryInfo = await lstat(directory);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      throw error;
    }
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
      throw new ComparisonPersistenceError("The saved comparison directory is not private and valid.");
    }
    const filePath = join(directory, COMPARISON_FILE);
    let text: string;
    try {
      text = await readPrivateJsonFile(filePath, MAX_MANIFEST_BYTES);
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new ComparisonPersistenceError("The comparison directory has no durable manifest.");
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ComparisonPersistenceError("The saved comparison manifest is not valid JSON.");
    }
    if (!isManifest(parsed, comparisonId)) throw new ComparisonPersistenceError("The saved comparison manifest failed validation.");
    return parsed;
  }

  async write(manifest: ComparisonManifest): Promise<void> {
    await this.prepare();
    if (!isManifest(manifest, manifest.comparisonId)) throw new ComparisonPersistenceError("A comparison update failed manifest validation.");
    const directory = this.comparisonDirectory(manifest.comparisonId);
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
      throw new ComparisonPersistenceError("The comparison directory changed or is not private.");
    }
    const target = join(directory, COMPARISON_FILE);
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink() || (targetInfo.mode & 0o077) !== 0) {
      throw new ComparisonPersistenceError("The comparison manifest path is not a private regular file.");
    }
    const temporary = join(directory, `.comparison-${randomUUID()}.tmp`);
    const serialized = serializeJson(manifest);
    if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) throw new ComparisonPersistenceError("The comparison manifest exceeded its size limit.");
    const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
      await syncDirectory(directory);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async readRunTerminal(runId: string): Promise<RunTerminal> {
    if (!isUuid(runId)) return { kind: "unknown" };
    const runDirectory = join(this.rootDirectory, `run-${encodeURIComponent(runId)}`);
    let directoryInfo;
    try {
      directoryInfo = await lstat(runDirectory);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return { kind: "missing" };
      return { kind: "unknown" };
    }
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) return { kind: "unknown" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readPrivateJsonFile(join(runDirectory, "result.json"), MAX_RUN_JSON_BYTES));
    } catch (error) {
      return isErrno(error, "ENOENT") ? { kind: "missing" } : { kind: "unknown" };
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.runId !== runId || !isTimestamp(parsed.finishedAt)) {
      return { kind: "unknown" };
    }
    if (parsed.status === "completed" && isRecord(parsed.response)) return { kind: "completed", response: parsed.response };
    if (parsed.status === "failed") return { kind: "failed" };
    if (parsed.status === "cancelled") return { kind: "cancelled" };
    return { kind: "unknown" };
  }

  private comparisonDirectory(comparisonId: string): string {
    return join(this.rootDirectory, COMPARISON_PARENT, comparisonId);
  }

  private async createManifestFile(directory: string, manifest: ComparisonManifest): Promise<void> {
    const serialized = serializeJson(manifest);
    if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) throw new ComparisonPersistenceError("The initial comparison manifest exceeded its size limit.");
    const file = join(directory, COMPARISON_FILE);
    const handle = await open(file, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(directory);
  }
}

/** Register the fixed, two-strategy Context comparison endpoints. */
export function registerStudioContextExperimentRoutes(
  app: FastifyInstance,
  runsRoot: string = DEFAULT_STUDIO_RUNS_ROOT,
  runner: StudioContextExperimentVariantRunner = runReferenceContextVariant,
): void {
  const active = new Map<string, ActiveComparison>();
  const store = new ContextComparisonStore(runsRoot);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/context-experiments")) reply.header("cache-control", "no-store");
  });

  app.post<{ Body: unknown; Reply: StudioContextExperimentResponse | StudioContextExperimentError }>("/context-experiments", {
    bodyLimit: 4_096,
    errorHandler(error, _request, reply) {
      if (error.statusCode === 413 || error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return reply.code(400).send(experimentError("INVALID_REQUEST", "The Context experiment request body must be at most 4 KiB."));
      }
      return reply.code(400).send(experimentError("INVALID_REQUEST", "The Context experiment request body is not valid JSON."));
    },
  }, async (request, reply) => {
    const parsed = parseRequestBody(request.body);
    if (parsed.error) return reply.code(400).send(parsed.error);
    const experimentRequest = parsed.request;
    const fingerprint = requestFingerprint(experimentRequest);
    const existing = active.get(experimentRequest.comparisonId);
    if (existing && existing.fingerprint !== fingerprint) {
      return reply.code(409).send(experimentError("COMPARISON_ID_REUSED", "This comparisonId is already active for a different request."));
    }

    const operation = existing ?? createActiveOperation(fingerprint);
    if (!existing) {
      active.set(experimentRequest.comparisonId, operation);
      operation.promise = runOrReuseComparison(experimentRequest, fingerprint, store, runner, operation)
        .finally(() => {
          operation.settled = true;
          if (active.get(experimentRequest.comparisonId) === operation) active.delete(experimentRequest.comparisonId);
        });
      void operation.promise.catch(() => operation.resolveReady());
    }
    return attachPostCaller(request, reply, operation);
  });

  app.get<{ Params: { comparisonId: string }; Reply: StudioContextExperimentResponse | StudioContextExperimentError }>(
    "/context-experiments/:comparisonId",
    async (request, reply) => {
      const { comparisonId } = request.params;
      if (!isUuid(comparisonId)) {
        return reply.code(400).send(experimentError("INVALID_REQUEST", "comparisonId must be a UUID."));
      }
      try {
        const operation = active.get(comparisonId);
        if (operation) await operation.ready;
        let manifest = await store.read(comparisonId);
        if (!manifest) return reply.code(404).send(experimentError("COMPARISON_NOT_FOUND", "No saved Context comparison exists for this ID."));
        if (manifest.status === "running" && (!operation || manifest.ownerInstanceId !== API_INSTANCE_ID)) {
          const ownerChanged = manifest.ownerInstanceId !== API_INSTANCE_ID;
          manifest = await reconcileInterruptedComparison(store, manifest, ownerChanged ? "stale-instance" : "orphaned-local-owner");
        }
        const response = await projectAndRepair(store, manifest);
        return response;
      } catch (error) {
        request.log.error({ err: error }, "Studio Context comparison could not be read");
        return reply.code(500).send(experimentError("COMPARISON_PERSISTENCE_FAILED", "The saved Context comparison could not be read safely."));
      }
    },
  );
}

function createActiveOperation(fingerprint: string): ActiveComparison {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  return {
    fingerprint,
    controller: new AbortController(),
    callers: new Set(),
    ready,
    resolveReady,
    promise: Promise.resolve(null as unknown as StudioContextExperimentResponse),
    settled: false,
  };
}

async function attachPostCaller(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: ActiveComparison,
): Promise<StudioContextExperimentResponse | StudioContextExperimentError> {
  const caller = {};
  operation.callers.add(caller);
  const detach = () => {
    operation.callers.delete(caller);
    if (!operation.settled && operation.callers.size === 0) operation.controller.abort();
  };
  const onAborted = () => detach();
  const onClose = () => { if (!reply.raw.writableEnded) detach(); };
  request.raw.once("aborted", onAborted);
  reply.raw.once("close", onClose);
  try {
    return await operation.promise;
  } catch (error) {
    if (error instanceof ComparisonIdReusedError) {
      return reply.code(409).send(experimentError("COMPARISON_ID_REUSED", error.message));
    }
    request.log.error({ err: error }, "Studio Context comparison could not be completed");
    return reply.code(500).send(experimentError("COMPARISON_PERSISTENCE_FAILED", "The Context comparison could not be persisted safely."));
  } finally {
    request.raw.off("aborted", onAborted);
    reply.raw.off("close", onClose);
    detach();
  }
}

async function runOrReuseComparison(
  request: StudioContextExperimentRequest,
  fingerprint: string,
  store: ContextComparisonStore,
  runner: StudioContextExperimentVariantRunner,
  operation: ActiveComparison,
): Promise<StudioContextExperimentResponse> {
  await store.prepare();
  let manifest = await store.read(request.comparisonId);
  if (manifest) {
    if (manifest.requestFingerprint !== fingerprint) throw new ComparisonIdReusedError();
    operation.resolveReady();
    if (manifest.status === "running") {
      const ownerChanged = manifest.ownerInstanceId !== API_INSTANCE_ID;
      manifest = await reconcileInterruptedComparison(store, manifest, ownerChanged ? "stale-instance" : "orphaned-local-owner");
    }
    return await projectAndRepair(store, manifest);
  }

  const timestamp = now();
  const sharedControls = makeSharedControls();
  const strategies = [
    getContextComponent(sharedControls.assembly, 0),
    makeWindowStrategy(sharedControls.assembly, request.maxRecentMessages),
  ] as const;
  manifest = {
    schemaVersion: 1,
    comparisonId: request.comparisonId,
    requestFingerprint: fingerprint,
    ownerInstanceId: API_INSTANCE_ID,
    apiVersion: STUDIO_CONTEXT_EXPERIMENT_API_VERSION,
    experiment: { id: STUDIO_CONTEXT_EXPERIMENT_ID, version: STUDIO_CONTEXT_EXPERIMENT_VERSION },
    case: { scenarioId: CONTEXT_STRESS_SCENARIO_ID, fixtureId: OLD_IMPORTANT_FACT_FIXTURE_ID, fixtureVersion: OLD_IMPORTANT_FACT_FIXTURE_VERSION },
    sharedControls,
    changedVariable: { id: "max-recent-context-messages", maxRecentMessages: request.maxRecentMessages },
    variants: [
      { strategy: strategies[BASELINE_STRATEGY_INDEX], runId: null, status: "pending", failure: null },
      { strategy: strategies[WINDOW_STRATEGY_INDEX], runId: null, status: "pending", failure: null },
    ],
    status: "running",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  };
  await store.create(manifest);
  operation.resolveReady();

  let cancelled = false;
  for (const index of [BASELINE_STRATEGY_INDEX, WINDOW_STRATEGY_INDEX] as const) {
    if (operation.controller.signal.aborted) {
      cancelled = true;
      manifest = await setVariantTerminal(store, manifest, index, null, "cancelled", {
        code: "VARIANT_CANCELLED", message: "The request callers disconnected before this variant ran.",
      });
      break;
    }
    const runId = randomUUID();
    manifest = await updateManifest(store, manifest, (current) => replaceVariant(current, index, {
      ...current.variants[index], runId, status: "running", failure: null,
    }, "running", null));
    try {
      const evidence = await runner({ request, strategy: manifest.variants[index].strategy, runId, signal: operation.controller.signal, runsRoot: store.runsRoot });
      if (!isStudioChatTurnResponse(evidence) || evidence.runId !== runId
        || !matchesStrategy(evidence.assembly, manifest.variants[index].strategy)) {
        throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "The variant runner returned invalid terminal evidence." }, true);
      }
      const terminal = await store.readRunTerminal(runId);
      if (terminal.kind !== "completed" || !isStudioChatTurnResponse(terminal.response)
        || terminal.response.runId !== runId || !matchesStrategy(terminal.response.assembly, manifest.variants[index].strategy)) {
        throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "The successful run result could not be established from its saved terminal artifact." }, true);
      }
      manifest = await setVariantTerminal(store, manifest, index, runId, "completed", null);
    } catch (error) {
      const terminal = await store.readRunTerminal(runId);
      if (terminal.kind === "completed" && isStudioChatTurnResponse(terminal.response)
        && terminal.response.runId === runId && matchesStrategy(terminal.response.assembly, manifest.variants[index].strategy)) {
        manifest = await setVariantTerminal(store, manifest, index, runId, "completed", null);
        continue;
      }
      if (terminal.kind === "failed" || terminal.kind === "cancelled") {
        const status = terminal.kind;
        const failure: StudioContextExperimentFailure = status === "cancelled"
          ? { code: "VARIANT_CANCELLED", message: "The variant wrote a cancelled terminal run result." }
          : { code: "VARIANT_FAILED", message: "The variant wrote a failed terminal run result." };
        manifest = await setVariantTerminal(store, manifest, index, runId, status, failure);
        if (status === "cancelled") {
          cancelled = true;
          break;
        }
        continue;
      }
      const unsafeFailure = toVariantFailure(error);
      manifest = await setVariantTerminal(store, manifest, index, runId, "unknown", {
        code: unsafeFailure.code === "RUN_ARTIFACT_PERSISTENCE_FAILED" ? unsafeFailure.code : "OUTCOME_UNKNOWN",
        message: unsafeFailure.code === "RUN_ARTIFACT_PERSISTENCE_FAILED"
          ? unsafeFailure.message
          : "No valid terminal run result was available after the variant returned or failed.",
      });
      if (operation.controller.signal.aborted) {
        cancelled = true;
        const otherIndex = index === BASELINE_STRATEGY_INDEX ? WINDOW_STRATEGY_INDEX : BASELINE_STRATEGY_INDEX;
        if (manifest.variants[otherIndex].status === "pending") {
          manifest = await setVariantTerminal(store, manifest, otherIndex, manifest.variants[otherIndex].runId, "cancelled", {
            code: "VARIANT_CANCELLED", message: "The request callers disconnected before this variant ran.",
          });
        }
        break;
      }
      manifest = await updateManifest(store, manifest, (current) => finishManifest(current, "unknown"));
      return await projectAndRepair(store, manifest);
    }
  }

  const status = cancelled ? "cancelled" : deriveTerminalComparisonStatus(manifest.variants);
  manifest = await updateManifest(store, manifest, (current) => finishManifest(current, status));
  return await projectAndRepair(store, manifest);
}

async function setVariantTerminal(
  store: ContextComparisonStore,
  manifest: ComparisonManifest,
  index: 0 | 1,
  runId: string | null,
  status: StudioContextVariantStatus,
  failure: StudioContextExperimentFailure | null,
): Promise<ComparisonManifest> {
  return updateManifest(store, manifest, (current) => {
    const nextVariants = [...current.variants] as [StoredVariant, StoredVariant];
    nextVariants[index] = { ...nextVariants[index], runId, status, failure };
    // A variant can be cancelled before the comparison lifecycle finishes. Keep
    // the manifest running until finishManifest records the final timestamp.
    return { ...current, variants: nextVariants, status: "running", updatedAt: now(), finishedAt: null };
  });
}

async function updateManifest(
  store: ContextComparisonStore,
  manifest: ComparisonManifest,
  update: (current: ComparisonManifest) => ComparisonManifest,
): Promise<ComparisonManifest> {
  const next = update(manifest);
  await store.write(next);
  return next;
}

function replaceVariant(
  manifest: ComparisonManifest,
  index: 0 | 1,
  variant: StoredVariant,
  status: StudioContextComparisonStatus,
  finishedAt: string | null,
): ComparisonManifest {
  const variants = [...manifest.variants] as [StoredVariant, StoredVariant];
  variants[index] = variant;
  return { ...manifest, variants, status, updatedAt: now(), finishedAt };
}

function finishManifest(manifest: ComparisonManifest, status: StudioContextComparisonStatus): ComparisonManifest {
  const finishedAt = now();
  return { ...manifest, status, updatedAt: finishedAt, finishedAt };
}

function deriveTerminalComparisonStatus(variants: readonly [StoredVariant, StoredVariant]): StudioContextComparisonStatus {
  const complete = variants.filter((variant) => variant.status === "completed").length;
  const failed = variants.filter((variant) => variant.status === "failed").length;
  if (complete === 2) return "completed";
  if (complete === 1 && failed === 1) return "partial";
  if (failed === 2) return "failed";
  if (variants.some((variant) => variant.status === "cancelled")) return "cancelled";
  if (variants.some((variant) => variant.status === "unknown")) return "unknown";
  return "interrupted";
}

async function reconcileInterruptedComparison(
  store: ContextComparisonStore,
  manifest: ComparisonManifest,
  _ownership: "stale-instance" | "orphaned-local-owner",
): Promise<ComparisonManifest> {
  if (manifest.status !== "running") return manifest;
  const recovered: [StoredVariant, StoredVariant] = [...manifest.variants] as [StoredVariant, StoredVariant];
  for (const index of [BASELINE_STRATEGY_INDEX, WINDOW_STRATEGY_INDEX] as const) {
    const variant = recovered[index];
    if (!variant.runId) {
      if (variant.status === "cancelled" && variant.failure?.code === "VARIANT_CANCELLED") continue;
      recovered[index] = { ...variant, status: "interrupted", failure: { code: "OUTCOME_UNKNOWN", message: "The API stopped before this variant received a run ID." } };
      continue;
    }
    const terminal = await store.readRunTerminal(variant.runId);
    if (terminal.kind === "completed" && isStudioChatTurnResponse(terminal.response)
      && terminal.response.runId === variant.runId && matchesStrategy(terminal.response.assembly, variant.strategy)) {
      recovered[index] = { ...variant, status: "completed", failure: null };
    } else if (terminal.kind === "failed") {
      recovered[index] = { ...variant, status: "failed", failure: { code: "VARIANT_FAILED", message: "The variant wrote a failed terminal run result before the API stopped." } };
    } else if (terminal.kind === "cancelled") {
      recovered[index] = { ...variant, status: "cancelled", failure: { code: "VARIANT_CANCELLED", message: "The variant wrote a cancelled terminal run result before the API stopped." } };
    } else if (terminal.kind === "missing") {
      recovered[index] = { ...variant, status: "interrupted", failure: { code: "OUTCOME_UNKNOWN", message: "No terminal run result was found after the API stopped." } };
    } else {
      recovered[index] = { ...variant, status: "unknown", failure: { code: "OUTCOME_UNKNOWN", message: "The terminal run result could not be read or validated." } };
    }
  }
  let status = deriveTerminalComparisonStatus(recovered);
  const completed = recovered.filter((variant) => variant.status === "completed").length;
  if (completed === 1 && recovered.some((variant) => variant.status === "interrupted")) status = "interrupted";
  const finishedAt = now();
  const repaired: ComparisonManifest = { ...manifest, variants: recovered, status, updatedAt: finishedAt, finishedAt };
  await store.write(repaired);
  return repaired;
}

async function projectAndRepair(store: ContextComparisonStore, manifest: ComparisonManifest): Promise<StudioContextExperimentResponse> {
  const variants: [StudioContextExperimentVariant, StudioContextExperimentVariant] = [
    { ...manifest.variants[0], evidence: null },
    { ...manifest.variants[1], evidence: null },
  ];
  let repairedVariants = false;
  for (const index of [BASELINE_STRATEGY_INDEX, WINDOW_STRATEGY_INDEX] as const) {
    const stored = manifest.variants[index];
    if (stored.status !== "completed" || !stored.runId) continue;
    const terminal = await store.readRunTerminal(stored.runId);
    if (terminal.kind === "completed" && isStudioChatTurnResponse(terminal.response)
      && terminal.response.runId === stored.runId && matchesStrategy(terminal.response.assembly, stored.strategy)) {
      variants[index] = { ...stored, evidence: terminal.response };
    } else {
      repairedVariants = true;
      const failure: StudioContextExperimentFailure = { code: "OUTCOME_UNKNOWN", message: "The completed run evidence could not be read or validated." };
      const next = [...manifest.variants] as [StoredVariant, StoredVariant];
      next[index] = { ...stored, status: "unknown", failure };
      const status = next.some((variant) => variant.status === "unknown") ? "unknown" : deriveTerminalComparisonStatus(next);
      manifest = { ...manifest, variants: next, status, updatedAt: now(), finishedAt: now() };
      variants[index] = { ...next[index], evidence: null };
    }
  }
  if (repairedVariants) await store.write(manifest);
  const response: StudioContextExperimentResponse = {
    apiVersion: manifest.apiVersion,
    experiment: manifest.experiment,
    comparisonId: manifest.comparisonId,
    status: manifest.status,
    case: manifest.case,
    sharedControls: manifest.sharedControls,
    changedVariable: manifest.changedVariable,
    variants,
    createdAt: manifest.createdAt,
    startedAt: manifest.startedAt,
    updatedAt: manifest.updatedAt,
    finishedAt: manifest.finishedAt,
  };
  if (!isStudioContextExperimentResponse(response)) {
    throw new ComparisonPersistenceError("The stored comparison could not be projected into the current HTTP contract.");
  }
  return response;
}

function makeSharedControls(): StudioContextExperimentResponse["sharedControls"] {
  if (OLD_IMPORTANT_FACT_FIXTURE.scenarioId !== CONTEXT_STRESS_SCENARIO_ID
    || OLD_IMPORTANT_FACT_FIXTURE.fixtureId !== OLD_IMPORTANT_FACT_FIXTURE_ID
    || OLD_IMPORTANT_FACT_FIXTURE.fixtureVersion !== OLD_IMPORTANT_FACT_FIXTURE_VERSION
    || OLD_IMPORTANT_FACT_FIXTURE.task.sourceId !== OLD_IMPORTANT_FACT_TASK_ID
    || OLD_IMPORTANT_FACT_FIXTURE.priorMessages !== OLD_IMPORTANT_FACT_PRIOR_MESSAGES) {
    throw new ComparisonPersistenceError("The installed context-stress fixture does not match its exported identity.");
  }
  const descriptor = createReferenceAssemblyDescriptor({ contextStrategy: "deterministic-context-assembler" });
  const model = descriptor.components.find((component) => component.area === "model-interface");
  if (!model) throw new ComparisonPersistenceError("The reference assembly has no Model Interface selection.");
  const assembly = descriptor as unknown as StudioChatAssembly;
  const controls: StudioContextExperimentResponse["sharedControls"] = {
    taskId: OLD_IMPORTANT_FACT_TASK_ID,
    model: model.implementation,
    modelParameters: model.configuration as Readonly<Record<string, StudioJsonValue>>,
    contextBudget: STUDIO_CONTEXT_TOKEN_BUDGET,
    assembly,
  };
  if (!isStudioChatAssemblyResponse({ apiVersion: STUDIO_CHAT_API_VERSION, assembly })) {
    throw new ComparisonPersistenceError("The reference assembly descriptor does not satisfy the Studio chat contract.");
  }
  return controls;
}

function getContextComponent(assembly: StudioChatAssembly, _index: 0): StudioChatComponentIdentity {
  const component = assembly.components.find((entry) => entry.area === "context");
  if (!component || component.implementation.id !== STUDIO_CONTEXT_STRATEGY_IDENTITIES[0].id) {
    throw new ComparisonPersistenceError("The baseline Context strategy is not registered in the reference assembly.");
  }
  return component;
}

function makeWindowStrategy(baselineAssembly: StudioChatAssembly, maxRecentMessages: number): StudioChatComponentIdentity {
  const descriptor = createReferenceAssemblyDescriptor({ contextStrategy: "fixed-recent-message-window", maxRecentMessages });
  const component = descriptor.components.find((entry) => entry.area === "context");
  if (!component || component.implementation.id !== STUDIO_CONTEXT_STRATEGY_IDENTITIES[1].id) {
    throw new ComparisonPersistenceError("The fixed-window Context strategy is not registered in the reference assembly.");
  }
  const context = component as unknown as StudioChatComponentIdentity;
  const baselineContext = getContextComponent(baselineAssembly, BASELINE_STRATEGY_INDEX);
  if (context.packageName !== baselineContext.packageName || context.packageVersion !== baselineContext.packageVersion) {
    throw new ComparisonPersistenceError("The Context strategies do not use the same module package version.");
  }
  return context;
}

function matchesStrategy(assembly: StudioChatAssembly, strategy: StudioChatComponentIdentity): boolean {
  const context = assembly.components.find((component) => component.area === "context");
  return context !== undefined && sameJson(context, strategy);
}

function requestFingerprint(request: StudioContextExperimentRequest): string {
  const fixedSerialization = JSON.stringify({
    apiVersion: request.apiVersion,
    comparisonId: request.comparisonId,
    caseId: request.caseId,
    maxRecentMessages: request.maxRecentMessages,
    experimentId: STUDIO_CONTEXT_EXPERIMENT_ID,
    experimentVersion: STUDIO_CONTEXT_EXPERIMENT_VERSION,
    scenarioId: CONTEXT_STRESS_SCENARIO_ID,
    fixtureId: OLD_IMPORTANT_FACT_FIXTURE_ID,
    fixtureVersion: OLD_IMPORTANT_FACT_FIXTURE_VERSION,
  });
  return createHash("sha256").update(fixedSerialization).digest("hex");
}

function parseRequestBody(value: unknown): { request: StudioContextExperimentRequest; error?: never } | { request?: never; error: StudioContextExperimentError } {
  if (!isRecord(value)) return { error: experimentError("INVALID_REQUEST", "Expected a JSON Context experiment request object.") };
  if (typeof value.apiVersion === "string" && value.apiVersion !== STUDIO_CONTEXT_EXPERIMENT_API_VERSION) {
    return { error: experimentError("UNSUPPORTED_API_VERSION", "This Context experiment API version is not supported.") };
  }
  if (!isStudioContextExperimentRequest(value)) {
    return { error: experimentError("INVALID_REQUEST", "Expected apiVersion 1, a UUID comparisonId, caseId old-important-fact-v1, and maxRecentMessages from 1 through 12.") };
  }
  return { request: value };
}

function experimentError(code: StudioContextExperimentErrorCode, message: string): StudioContextExperimentError {
  const error = { apiVersion: STUDIO_CONTEXT_EXPERIMENT_API_VERSION, error: { code, message } };
  if (!isStudioContextExperimentError(error)) throw new Error("A Context experiment API error did not satisfy its public contract.");
  return error;
}

function toVariantFailure(error: unknown): StudioContextExperimentFailure {
  if (error instanceof VariantRunFailure) return error.failure;
  if (isAbortError(error)) return { code: "VARIANT_CANCELLED", message: "The variant was cancelled after all POST callers disconnected." };
  if (error instanceof ComparisonPersistenceError) return { code: "RUN_ARTIFACT_PERSISTENCE_FAILED", message: "A required run artifact could not be persisted safely." };
  if (error instanceof ContextAssemblyError) return { code: "VARIANT_FAILED", message: "The Context module could not assemble the selected material." };
  return { code: "VARIANT_FAILED", message: "The selected Context variant did not complete." };
}

async function runReferenceContextVariant(input: StudioContextExperimentVariantRunInput): Promise<StudioChatTurnResponse> {
  const strategy = input.strategy.implementation.id;
  const descriptor = createReferenceAssemblyDescriptor(strategy === STUDIO_CONTEXT_STRATEGY_IDENTITIES[0].id
    ? { contextStrategy: "deterministic-context-assembler" }
    : { contextStrategy: "fixed-recent-message-window", maxRecentMessages: input.request.maxRecentMessages });
  const agent = createReferenceAgent(descriptor);
  if (!matchesStrategy(agent.assembly as unknown as StudioChatAssembly, input.strategy)) {
    throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "The selected assembly did not match the saved strategy identity." }, true);
  }
  const runId = input.runId;
  const turnId = randomUUID();
  const receivedAt = now();
  const conversationId = `context-experiment:${input.request.comparisonId}:${input.strategy.implementation.id}`;
  const requestId = runId;
  const scope = {
    runId: createRunId(runId),
    sessionId: createSessionId(randomUUID()),
    turnId: createTurnId(turnId),
  };
  let artifacts: RunArtifactStore;
  try {
    artifacts = await createRunArtifactStore(input.runsRoot, runId);
  } catch {
    throw new VariantRunFailure({ code: "RUN_ARTIFACT_PERSISTENCE_FAILED", message: "The run directory could not be created safely." }, true);
  }
  const contextComponent = agent.assembly.components.find((component) => component.area === "context");
  const memoryComponent = agent.assembly.components.find((component) => component.area === "memory");
  const modelComponent = agent.assembly.components.find((component) => component.area === "model-interface");
  const toolUseComponent = agent.assembly.components.find((component) => component.area === "tool-use");
  const environmentComponent = agent.assembly.components.find((component) => component.area === "execution-environment");
  const safetyComponent = agent.assembly.components.find((component) => component.area === "safety");
  if (!contextComponent || !memoryComponent || !modelComponent || !toolUseComponent || !environmentComponent || !safetyComponent) {
    throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "The selected assembly is missing a required run component." }, true);
  }
  const actualToolDefinitions = [createCalculatorAddRegistration().definition, createComputerClickRegistration().definition];
  try {
    await artifacts.write("config.json", {
    schemaVersion: 1,
    runId,
    sessionId: scope.sessionId,
    turnId,
    comparisonId: input.request.comparisonId,
    receivedAt,
    startedAt: receivedAt,
    finishedAt: null,
    environment: "studio-local-deterministic",
    randomSeed: null,
    failureInjection: null,
    experiment: { id: STUDIO_CONTEXT_EXPERIMENT_ID, version: STUDIO_CONTEXT_EXPERIMENT_VERSION },
    scenario: {
      id: CONTEXT_STRESS_SCENARIO_ID,
      fixture: { id: OLD_IMPORTANT_FACT_FIXTURE_ID, version: OLD_IMPORTANT_FACT_FIXTURE_VERSION },
      caseId: STUDIO_CONTEXT_EXPERIMENT_CASE_ID,
    },
    assembly: agent.assembly,
    context: contextComponent,
    memory: memoryComponent,
    initialMemoryState: { stateRevision: 0, records: [] },
    task: { taskId: OLD_IMPORTANT_FACT_TASK_ID, sourceId: OLD_IMPORTANT_FACT_TASK.sourceId, content: OLD_IMPORTANT_FACT_TASK.content },
    priorMessages: OLD_IMPORTANT_FACT_PRIOR_MESSAGES,
    contextBudget: STUDIO_CONTEXT_TOKEN_BUDGET,
    model: modelComponent,
    modelParameters: modelComponent.configuration,
    toolUse: toolUseComponent,
    executionEnvironment: environmentComponent,
    effectiveToolDefinitions: actualToolDefinitions,
    effectiveCapabilities: {
      executionEnvironment: (environmentComponent.configuration as Record<string, StudioJsonValue>).allowedCapabilities,
      safety: {
        allowedToolCapabilities: (safetyComponent.configuration as Record<string, StudioJsonValue>).allowedToolCapabilities,
        allowedEnvironmentCapabilities: (safetyComponent.configuration as Record<string, StudioJsonValue>).allowedEnvironmentCapabilities,
      },
    },
    request: { conversationId, requestId, remember: false },
    });
  } catch {
    throw new VariantRunFailure({ code: "RUN_ARTIFACT_PERSISTENCE_FAILED", message: "The run configuration could not be persisted safely." }, true);
  }
  const observability = agent.createObservability(scope, artifacts.rootDirectory);
  const memory: MemorySession = agent.createMemorySession({ ownerId: `studio-context:${input.request.comparisonId}`, sessionId: scope.sessionId });
  let capturedResponse: string | undefined;
  const outputSink: OutputActionSink = {
    async deliver({ proposal }) {
      const payload = proposal.payload;
      if (!isRecord(payload) || typeof payload.text !== "string") {
        return { actionId: proposal.actionId, status: "rejected", reason: "Studio API response sink requires a text payload." };
      }
      capturedResponse = payload.text;
      return { actionId: proposal.actionId, status: "committed", receipt: { sink: "studio-api-response-capture", capturedUtf8Bytes: new TextEncoder().encode(capturedResponse).byteLength } };
    },
  };
  try {
    let result: TextTurnResult;
    try {
      result = await agent.runTurn({
        scope,
        text: OLD_IMPORTANT_FACT_TASK.content,
        source: { sourceId: OLD_IMPORTANT_FACT_TASK.sourceId, kind: "user", trust: "untrusted", receivedAt },
        memory,
        priorTurns: scenarioMaterials(),
        rememberUserMessage: false,
        outputSink,
        observability,
        signal: input.signal,
        idempotencyKey: requestId,
      });
    } catch (error) {
      const partial = error instanceof TextTurnExecutionError ? error.evidence : undefined;
      const persistedObservability = error instanceof TextTurnExecutionError ? error.observability : getObservabilityResult(error);
      const wasCancelled = isAbortError(error);
      try {
        await artifacts.write("result.json", {
          schemaVersion: 1,
          runId,
          turnId,
          finishedAt: now(),
          status: wasCancelled ? "cancelled" : "failed",
          observability: projectObservability(persistedObservability),
          error: { name: error instanceof Error ? error.name : "Error", message: wasCancelled ? "The Context variant was cancelled." : "The Context variant failed." },
          ...(partial ? { partialEvidence: partial } : {}),
        });
      } catch {
        throw new VariantRunFailure({ code: "RUN_ARTIFACT_PERSISTENCE_FAILED", message: "A failed variant result could not be persisted." }, true);
      }
      throw new VariantRunFailure(
        wasCancelled
          ? { code: "VARIANT_CANCELLED", message: "The variant was cancelled after all POST callers disconnected." }
          : { code: "VARIANT_FAILED", message: "The selected Context variant did not complete." },
        false,
      );
    }
    if (capturedResponse === undefined || capturedResponse !== result.finalText) {
      throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "Output Actions did not commit the final response." }, true);
    }
    const response = makeTurnResponse({ result, agent, request: input.request, runId, turnId, requestId, conversationId, receivedAt, capturedResponse });
    try {
      await artifacts.write("result.json", {
        schemaVersion: 1,
        runId,
        turnId,
        finishedAt: now(),
        status: "completed",
        observability: response.observability,
        response,
      });
    } catch {
      throw new VariantRunFailure({ code: "RUN_ARTIFACT_PERSISTENCE_FAILED", message: "The completed run result could not be persisted safely." }, true);
    }
    return response;
  } finally {
    await memory.close();
  }
}

function scenarioMaterials(): ContextMaterial[] {
  return OLD_IMPORTANT_FACT_PRIOR_MESSAGES.map((message) => ({
    sourceId: message.sourceId,
    kind: "turn",
    role: message.role,
    content: message.content,
    sequence: message.sequence,
    trust: "untrusted",
    provenance: {
      scenarioId: CONTEXT_STRESS_SCENARIO_ID,
      fixtureId: OLD_IMPORTANT_FACT_FIXTURE_ID,
      fixtureVersion: OLD_IMPORTANT_FACT_FIXTURE_VERSION,
      sourceKind: "scenario-fixture",
    },
  }));
}

function makeTurnResponse(input: {
  readonly result: TextTurnResult;
  readonly agent: ReferenceAgent;
  readonly request: StudioContextExperimentRequest;
  readonly runId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly receivedAt: string;
  readonly capturedResponse: string;
}): StudioChatTurnResponse {
  const { result } = input;
  const modelResponse = result.modelResponses.at(-1);
  if (!modelResponse) throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "The turn completed without a Model Interface response." }, true);
  const modelCalls = result.modelRequests.map((request, index) => {
    const context = result.contextRequests[index];
    const response = result.modelResponses[index];
    if (!context || !response) throw new VariantRunFailure({ code: "OUTCOME_UNKNOWN", message: "A Model Interface call is missing paired evidence." }, true);
    return Object.freeze({ context, request, response });
  });
  const assistantSourceId = `assistant:${input.turnId}`;
  return Object.freeze({
    apiVersion: STUDIO_CHAT_API_VERSION,
    conversationId: input.conversationId,
    requestId: input.requestId,
    runId: input.runId,
    turnId: input.turnId,
    receivedAt: input.receivedAt,
    assembly: input.agent.assembly as unknown as StudioChatAssembly,
    input: {
      task: result.normalizedInput.task,
      source: { sourceId: result.normalizedInput.source.sourceId, kind: "user", trust: "untrusted", receivedAt: result.normalizedInput.source.receivedAt },
      parts: result.normalizedInput.parts.filter((part) => part.kind === "text"),
    },
    memory: { stateRevision: result.memoryRecall.stateRevision, candidates: result.memoryRecall.candidates, writeReceipt: result.memoryWrite },
    context: result.context,
    planning: projectPlanningEvidence(result.planning),
    modelCalls,
    runEvidence: result.runEvidence.map(toJson),
    observability: projectObservability(result.observability),
    control: {
      termination: result.control.termination,
      modelCalls: result.control.modelCalls,
      toolCalls: result.control.toolCalls,
      observations: result.observations.map(toJson),
    },
    model: {
      provider: modelResponse.provider.provider,
      name: modelResponse.provider.model,
      adapter: modelResponse.provider.adapter,
      ...(modelResponse.provider.requestId ? { requestId: modelResponse.provider.requestId } : {}),
      finishReason: modelResponse.finishReason,
      usage: modelResponse.usage,
      ...(modelResponse.providerDetail === undefined ? {} : { detail: modelResponse.providerDetail as StudioJsonValue }),
    },
    assistantMessage: { sourceId: assistantSourceId, content: input.capturedResponse },
  });
}

function projectPlanningEvidence(evidence: PlanningRunEvidence): StudioChatPlanningEvidence {
  return { module: evidence.module, input: { task: evidence.input.task, context: evidence.input.context, observations: evidence.input.observations }, proposal: evidence.proposal };
}

function projectObservability(value: TextTurnObservabilityResult | null): StudioChatObservabilityEvidence {
  return {
    status: value?.status ?? "not-configured",
    recorder: value?.recorder ?? null,
    eventsAttempted: value?.eventsAttempted ?? 0,
    appendReceipts: value?.appendReceipts.map(toJson) ?? [],
    flushReceipt: value?.flushReceipt ? toJson(value.flushReceipt) : null,
    ...(value?.failure ? { failure: value.failure } : {}),
  };
}

function getObservabilityResult(value: unknown): TextTurnObservabilityResult | null {
  if (!isRecord(value) || !isRecord(value.observability)) return null;
  return value.observability as unknown as TextTurnObservabilityResult;
}

function toJson(value: unknown): StudioJsonValue {
  const json = JSON.stringify(value);
  return json === undefined ? null : JSON.parse(json) as StudioJsonValue;
}

function isAbortError(value: unknown): boolean {
  if (value instanceof Error && value.name === "AbortError") return true;
  if (!isRecord(value) || !("failure" in value)) return false;
  return isAbortError(value.failure);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function now(): string {
  return new Date().toISOString();
}

function isManifest(value: unknown, expectedId: string): value is ComparisonManifest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "comparisonId", "requestFingerprint", "ownerInstanceId", "apiVersion", "experiment", "case",
    "sharedControls", "changedVariable", "variants", "status", "createdAt", "startedAt", "updatedAt", "finishedAt",
  ])) return false;
  if (value.schemaVersion !== 1 || value.comparisonId !== expectedId || !isUuid(value.comparisonId)
    || typeof value.requestFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(value.requestFingerprint)
    || !isUuid(value.ownerInstanceId) || value.apiVersion !== STUDIO_CONTEXT_EXPERIMENT_API_VERSION
    || !isTimestamp(value.createdAt) || !isTimestamp(value.startedAt) || !isTimestamp(value.updatedAt)
    || !(value.finishedAt === null || isTimestamp(value.finishedAt))
    || !["running", "completed", "partial", "failed", "cancelled", "interrupted", "unknown"].includes(String(value.status))) return false;
  if (!isRecord(value.experiment) || !hasExactKeys(value.experiment, ["id", "version"])
    || value.experiment.id !== STUDIO_CONTEXT_EXPERIMENT_ID || value.experiment.version !== STUDIO_CONTEXT_EXPERIMENT_VERSION) return false;
  if (!isRecord(value.case) || !hasExactKeys(value.case, ["scenarioId", "fixtureId", "fixtureVersion"])
    || value.case.scenarioId !== CONTEXT_STRESS_SCENARIO_ID || value.case.fixtureId !== OLD_IMPORTANT_FACT_FIXTURE_ID
    || value.case.fixtureVersion !== OLD_IMPORTANT_FACT_FIXTURE_VERSION) return false;
  if (!isRecord(value.sharedControls) || !hasExactKeys(value.sharedControls, ["taskId", "model", "modelParameters", "contextBudget", "assembly"])
    || value.sharedControls.taskId !== OLD_IMPORTANT_FACT_TASK_ID || !isRecord(value.sharedControls.model)
    || !hasExactKeys(value.sharedControls.model, ["id", "version"])
    || typeof value.sharedControls.model.id !== "string" || typeof value.sharedControls.model.version !== "string"
    || !isRecord(value.sharedControls.modelParameters) || !isJsonValue(value.sharedControls.modelParameters)
    || !isContextBudget(value.sharedControls.contextBudget)
    || !isStudioChatAssemblyResponse({ apiVersion: STUDIO_CHAT_API_VERSION, assembly: value.sharedControls.assembly })) return false;
  const assembly = value.sharedControls.assembly as StudioChatAssembly;
  const expectedBaselineAssembly = createReferenceAssemblyDescriptor({ contextStrategy: "deterministic-context-assembler" });
  if (!sameJson(assembly, expectedBaselineAssembly)) return false;
  const model = assembly.components.find((component) => component.area === "model-interface");
  if (!model || !sameJson(value.sharedControls.model, model.implementation)
    || !sameJson(value.sharedControls.modelParameters, model.configuration)) return false;
  if (!isRecord(value.changedVariable) || !hasExactKeys(value.changedVariable, ["id", "maxRecentMessages"])
    || value.changedVariable.id !== "max-recent-context-messages"
    || !Number.isInteger(value.changedVariable.maxRecentMessages) || (value.changedVariable.maxRecentMessages as number) < 1
    || (value.changedVariable.maxRecentMessages as number) > 12) return false;
  const expectedFingerprint = requestFingerprint({
    apiVersion: STUDIO_CONTEXT_EXPERIMENT_API_VERSION,
    comparisonId: value.comparisonId,
    caseId: STUDIO_CONTEXT_EXPERIMENT_CASE_ID,
    maxRecentMessages: value.changedVariable.maxRecentMessages as number,
  });
  if (value.requestFingerprint !== expectedFingerprint) return false;
  if (!Array.isArray(value.variants) || value.variants.length !== 2
    || !isStoredVariant(value.variants[0], 0, value.changedVariable.maxRecentMessages as number)
    || !isStoredVariant(value.variants[1], 1, value.changedVariable.maxRecentMessages as number)) return false;
  const statuses = value.variants.map((variant) => (variant as StoredVariant).status);
  if (value.status === "running") return value.finishedAt === null;
  if (value.finishedAt === null) return false;
  if (value.status === "completed") return statuses.every((status) => status === "completed");
  if (value.status === "partial") return statuses.filter((status) => status === "completed").length === 1
    && statuses.filter((status) => status === "failed").length === 1;
  if (value.status === "failed") return statuses.every((status) => status === "failed");
  if (value.status === "cancelled") return statuses.some((status) => status === "cancelled");
  if (value.status === "interrupted") return statuses.some((status) => status === "interrupted");
  return statuses.some((status) => status === "unknown");
}

function isStoredVariant(value: unknown, index: 0 | 1, maxRecentMessages: number): value is StoredVariant {
  if (!isRecord(value) || !hasExactKeys(value, ["strategy", "runId", "status", "failure"])) return false;
  const strategy = value.strategy;
  if (!isRecord(strategy) || !hasExactKeys(strategy, ["area", "packageName", "packageVersion", "implementation", "configuration"])
    || strategy.area !== "context" || strategy.packageName !== "@agent-harness-lab/module-context"
    || strategy.packageVersion !== "0.6.0" || !isRecord(strategy.implementation)
    || strategy.implementation.id !== STUDIO_CONTEXT_STRATEGY_IDENTITIES[index].id
    || strategy.implementation.version !== STUDIO_CONTEXT_STRATEGY_IDENTITIES[index].version
    || !isRecord(strategy.configuration) || !isJsonValue(strategy.configuration)) return false;
  const expectedAssembly = index === 0
    ? createReferenceAssemblyDescriptor({ contextStrategy: "deterministic-context-assembler" })
    : createReferenceAssemblyDescriptor({ contextStrategy: "fixed-recent-message-window", maxRecentMessages });
  const expectedStrategy = expectedAssembly.components.find((component) => component.area === "context");
  if (!expectedStrategy || !sameJson(strategy, expectedStrategy)) return false;
  if (!(value.runId === null || isUuid(value.runId))
    || !["pending", "running", "completed", "failed", "cancelled", "interrupted", "unknown"].includes(String(value.status))) return false;
  if (!(value.failure === null || isStoredFailure(value.failure))) return false;
  if (value.status === "pending") return value.runId === null && value.failure === null;
  if (value.status === "running") return isUuid(value.runId) && value.failure === null;
  if (value.status === "completed") return isUuid(value.runId) && value.failure === null;
  return value.failure !== null;
}

function isStoredFailure(value: unknown): value is StudioContextExperimentFailure {
  return isRecord(value) && hasExactKeys(value, ["code", "message"])
    && ["VARIANT_FAILED", "VARIANT_CANCELLED", "RUN_ARTIFACT_PERSISTENCE_FAILED", "OUTCOME_UNKNOWN"].includes(String(value.code))
    && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value.message);
}

function isContextBudget(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["contextWindowTokens", "reservedOutputTokens", "safetyMarginTokens", "tokenizer"])
    && value.contextWindowTokens === STUDIO_CONTEXT_TOKEN_BUDGET.contextWindowTokens
    && value.reservedOutputTokens === STUDIO_CONTEXT_TOKEN_BUDGET.reservedOutputTokens
    && value.safetyMarginTokens === STUDIO_CONTEXT_TOKEN_BUDGET.safetyMarginTokens
    && value.tokenizer === STUDIO_CONTEXT_TOKEN_BUDGET.tokenizer;
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

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value.replace(/Z$/, ""));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readPrivateJsonFile(path: string, maximumBytes: number): Promise<string> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > maximumBytes) {
      throw new ComparisonPersistenceError("A saved JSON artifact is not a private regular file within its size limit.");
    }
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isErrno(value: unknown, code: string): boolean {
  return isRecord(value) && value.code === code;
}
